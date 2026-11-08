/**
 * What every MCP tool call runs against: which project, how its file is read and written, and the
 * connection to the app. A `ToolContext` is built per call (so nothing is cached between calls:
 * "always re-read the file immediately before mutating", docs/05), and a tool is re-run from a
 * fresh read if another writer got in between (compare-and-write on `rev`, docs/06).
 */
import path from 'node:path';
import { bumpRev, serializeDoc } from '../src/core/doc';
import type { Skill } from '../src/core/skills';
import { isBetaOn, parseBetaSettings, type BetaFeatureId } from '../src/core/beta';
import { CoreError } from '../src/core/errors';
import { createTemplateDoc, TEMPLATES, type TemplateName } from '../src/core/templates';
import type { Tool, ToolResult } from '../src/core/tool-kit';
import type {
  CompareReferenceResult,
  Doc,
  ProjectSummary,
  ScreenshotOptions,
  ScreenshotResult,
  ToolContext,
  ToolProjects,
} from '../src/core/types';
import { validateDoc } from '../src/core/validate';
import {
  createProject,
  freshProjectId,
  listProjects,
  parseProjectText,
  projectFile,
  revOf,
  type ProjectInfo,
} from '../src/projects/projects';
import type { HomeApi } from '../src/platform/fs';
import { BridgeClient } from './bridge';
import { writeUserFiles } from './export-write';
import { allSkills } from './user-skills';
import { createImageReader } from './files';
import { Library } from './library';
import { SKILLS } from './generated';
import type { HomeFs } from './home-fs';
import { homeApiFromHomeFs } from './node-api';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const MAX_SCREENSHOT_FILES = 20;
const COUNT_FRAMES_FOR = 20;

export interface EnvOptions {
  /** Recorded in `agents/<pid>.json` and shown by the app. */
  onProjectChange?: (id: string) => void;
}

class ConflictContext {
  conflicted = false;
}

export class McpEnv {
  readonly api: HomeApi;
  readonly bridge: BridgeClient;
  /** Set by open_project when the app is not running (the app's own choice wins when it is). */
  sessionProject: string | null = null;

  constructor(
    readonly home: HomeFs,
    options: EnvOptions & { now?: () => number } = {},
  ) {
    this.api = homeApiFromHomeFs(home);
    this.bridge = new BridgeClient(home, options.now);
    this.onProjectChange = options.onProjectChange;
  }
  private readonly onProjectChange: ((id: string) => void) | undefined;

  // ---- which project --------------------------------------------------------------------------

  async listAll(): Promise<ProjectInfo[]> {
    return (await listProjects(this.api)).filter((p) => !p.unreadable);
  }

  /** Explicit (id or name) > this session's open_project > what the app has open > newest. */
  async resolve(ref?: string): Promise<ProjectInfo> {
    const all = await this.listAll();
    const names = (): string =>
      all.length === 0
        ? 'none yet'
        : all
            .slice(0, 8)
            .map((p) => `${p.name} (${p.id})`)
            .join(', ');
    if (all.length === 0) {
      throw new CoreError(
        'NOT_FOUND',
        'There are no AFrame projects yet.',
        'Open the AFrame app once, or call create_project.',
      );
    }
    if (ref !== undefined && ref !== '') {
      const byId = all.find((p) => p.id === ref);
      if (byId) return byId;
      const lower = ref.toLowerCase();
      const exact = all.filter((p) => p.name.toLowerCase() === lower);
      if (exact.length === 1) return exact[0] as ProjectInfo;
      const prefix = all.filter((p) => p.name.toLowerCase().startsWith(lower));
      if (exact.length === 0 && prefix.length === 1) return prefix[0] as ProjectInfo;
      throw new CoreError(
        'NOT_FOUND',
        exact.length > 1 || prefix.length > 1
          ? `"${ref}" matches more than one project.`
          : `No project "${ref}".`,
        `Use a project id. Projects: ${names()}.`,
      );
    }
    const app = await this.bridge.readState();
    const candidates = [this.sessionProject, app?.currentProject ?? null];
    for (const id of candidates) {
      const hit = id === null ? undefined : all.find((p) => p.id === id);
      if (hit) return hit;
    }
    return all[0] as ProjectInfo;
  }

  // ---- project tools --------------------------------------------------------------------------

  private async summary(p: ProjectInfo, count: boolean): Promise<ProjectSummary> {
    let frames: number | null = null;
    if (count) {
      const text = await this.home.read(projectFile(p.id)).catch(() => null);
      const parsed = text === null ? null : parseProjectText(text);
      if (parsed?.ok)
        frames =
          parsed.doc.nodes[parsed.doc.rootId]?.children.filter(
            (c) => parsed.doc.nodes[c]?.type === 'frame',
          ).length ?? 0;
    }
    return { id: p.id, name: p.name, updatedAt: new Date(p.updatedAtMs).toISOString(), frames };
  }

  readonly projects: ToolProjects = {
    list: async () => {
      const all = await this.listAll();
      return Promise.all(all.map((p, i) => this.summary(p, i < COUNT_FRAMES_FOR)));
    },
    create: async (name, template) => {
      if (!(TEMPLATES as readonly string[]).includes(template)) {
        throw new CoreError(
          'INVALID_VALUE',
          `Unknown template "${template}".`,
          `Use one of: ${TEMPLATES.join(', ')}.`,
        );
      }
      const doc = createTemplateDoc(template as TemplateName, {
        name,
        id: await freshProjectId(this.api),
      });
      doc.meta.lastWriter = 'mcp';
      await createProject(this.api, doc);
      return this.summary(
        { id: doc.id, name: doc.name, updatedAtMs: Date.now(), size: 0, unreadable: false },
        true,
      );
    },
    open: async (ref) => {
      const p = await this.resolve(ref);
      if (await this.bridge.appOnline()) {
        // The app switches itself (and publishes the new current project).
        await this.bridge.request('open_project', { project: p.id });
      }
      this.sessionProject = p.id;
      this.onProjectChange?.(p.id);
      return this.summary(p, true);
    },
  };

  // ---- the context a tool runs against --------------------------------------------------------

  context(ref?: string): ToolContext & { readonly conflicted: boolean } {
    const state = new ConflictContext();
    let projectId: string | null = null;
    let lastRev: number | null = null;
    let cached: Doc | null = null;
    const id = async (): Promise<string> => (projectId ??= (await this.resolve(ref)).id);

    const read = async (): Promise<Doc> => {
      const pid = await id();
      const text = await this.home.read(projectFile(pid));
      if (text === null)
        throw new CoreError(
          'NOT_FOUND',
          `The project file for ${pid} is missing.`,
          'Open the project in AFrame to restore it.',
        );
      const parsed = parseProjectText(text);
      if (!parsed.ok) {
        const first = parsed.errors[0];
        if (first?.code === 'SCHEMA_NEWER')
          throw new CoreError(
            'SCHEMA_NEWER',
            'This project was saved by a newer AFrame.',
            'Update AFrame.',
          );
        throw new CoreError(
          'INVALID_VALUE',
          `The project file is damaged: ${first?.message ?? 'unreadable'}.`,
          'Open it in AFrame: it offers to restore the previous version.',
        );
      }
      lastRev = revOf(text);
      return parsed.doc;
    };

    return {
      get conflicted() {
        return state.conflicted;
      },
      getDoc: async () => (cached ??= await read()),
      commit: async (next) => {
        const stamped = bumpRev(next, 'mcp');
        const check = validateDoc(stamped);
        if (!check.ok)
          throw new CoreError(
            'INTERNAL',
            `Refusing to save an invalid document: ${check.errors[0]?.message ?? ''}`,
          );
        const pid = await id();
        const res = await this.home.writeDoc(projectFile(pid), serializeDoc(stamped), lastRev);
        if (!res.ok) {
          state.conflicted = true; // someone else wrote first: the caller re-runs from a fresh read
          throw new CoreError('INTERNAL', 'The project changed while it was being edited.');
        }
        lastRev = res.diskRev;
        cached = stamped;
      },
      appOnline: () => this.bridge.appOnline(),
      getSelection: async () => {
        const live = await this.bridge.live();
        return live && live.currentProject === (await id()) ? live.selection : [];
      },
      getNodeBounds: async (nodeId) => {
        if (!(await this.bridge.appOnline())) return null;
        try {
          const r = (await this.bridge.request(
            'get_node_bounds',
            { nodeId },
            { project: await id(), timeoutMs: 5000 },
          )) as { bounds?: unknown } | null;
          const b = r?.bounds as
            { x: number; y: number; width: number; height: number } | null | undefined;
          return b ?? null;
        } catch {
          return null;
        }
      },
      screenshot: async (opts: ScreenshotOptions): Promise<ScreenshotResult> => {
        const r = (await this.bridge.request(
          'screenshot',
          { ...opts },
          { project: await id(), timeoutMs: opts.scale === 2 ? 30_000 : 15_000 },
        )) as {
          pngBase64?: string;
          width?: number;
          height?: number;
        };
        if (
          typeof r?.pngBase64 !== 'string' ||
          typeof r.width !== 'number' ||
          typeof r.height !== 'number'
        ) {
          throw new CoreError('INTERNAL', 'The app returned an unreadable screenshot.');
        }
        const file = await this.saveScreenshot(r.pngBase64);
        return { pngBase64: r.pngBase64, width: r.width, height: r.height, path: file };
      },
      readUserFile: createImageReader({ aframeHome: this.home.root }),
      writeUserFiles: (root, files, options) => writeUserFiles(root, files, options ?? {}),
      compareReference: async (opts) => {
        const r = (await this.bridge.request(
          'compare_reference',
          { ...opts },
          { project: await id(), timeoutMs: 60_000 },
        )) as CompareReferenceResult | null;
        if (typeof r?.diffPngBase64 !== 'string' || typeof r.matchPercent !== 'number') {
          throw new CoreError('INTERNAL', 'The app returned an unreadable comparison.');
        }
        return r;
      },
      exportImage: async (opts) => {
        const r = (await this.bridge.request(
          'export_image',
          { ...opts },
          { project: await id(), timeoutMs: 60_000 },
        )) as { dataBase64?: unknown; width?: unknown; height?: unknown } | null;
        if (
          typeof r?.dataBase64 !== 'string' ||
          typeof r.width !== 'number' ||
          typeof r.height !== 'number'
        ) {
          throw new CoreError('INTERNAL', 'The app returned an unreadable image.');
        }
        return {
          bytes: new Uint8Array(Buffer.from(r.dataBase64, 'base64')),
          width: r.width,
          height: r.height,
        };
      },
      library: {
        list: () => new Library(this.home.root).list(),
        read: (id) => Promise.resolve(new Library(this.home.root).read(id)),
      },
      projects: this.projects,
      betaEnabled: (feature) => this.betaOn(feature),
      skills: {
        list: () =>
          this.skillList().map((s) => ({
            name: s.name,
            description: s.source === 'user' ? `${s.description} (your own)` : s.description,
          })),
        load: (name) => this.skillList().find((s) => s.name === name)?.body ?? null,
      },
    };
  }

  /**
   * Whether a beta feature is switched on in AFrame's Settings. The app writes the switches to
   * settings.json in the home; they are read fresh (a few milliseconds) so flipping one takes effect
   * without restarting anything. Unreadable means off.
   */
  async betaOn(feature: string): Promise<boolean> {
    try {
      const text = await this.home.read('settings.json');
      if (text === null) return false;
      const raw = JSON.parse(text) as { beta?: unknown };
      return isBetaOn(parseBetaSettings(raw.beta), feature as BetaFeatureId);
    } catch {
      return false;
    }
  }

  /** Shipped skills and the ones in ~/.aframe/skills (theirs win), read fresh each time. */
  skillList(): Skill[] {
    return allSkills(
      this.home.root,
      SKILLS.map((s) => ({ ...s, source: 'shipped' as const })),
    );
  }

  /** Keeps the PNG for hosts that cannot show images; the newest 20 are kept. Returns the absolute path. */
  async saveScreenshot(pngBase64: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const rel = `exports/screenshots/shot-${stamp}-${Math.random().toString(36).slice(2, 6)}.png`;
    await this.home.writeBytes(rel, Buffer.from(pngBase64, 'base64'));
    try {
      const files = (await this.home.list('exports/screenshots')).filter(
        (e) => !e.isDir && e.name.endsWith('.png'),
      );
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const old of files.slice(MAX_SCREENSHOT_FILES))
        await this.home.remove(`exports/screenshots/${old.name}`).catch(() => undefined);
    } catch {
      /* housekeeping only */
    }
    return path.join(this.home.root, rel);
  }

  /** Tool runs in this process take turns (a host may call several tools in parallel). */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Runs a tool. Edits queue behind each other inside this process, and if a writer in ANOTHER
   * process got in between a tool's read and its write, the tool runs again from a fresh read.
   * Anything that waits on the app (screenshots) does not hold the queue.
   */
  run(tool: Tool, input: unknown, ref?: string): Promise<ToolResult> {
    if (tool.name === 'screenshot') return this.runOnce(tool, input, ref);
    const turn = this.queue.then(() => this.runOnce(tool, input, ref));
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async runOnce(tool: Tool, input: unknown, ref?: string): Promise<ToolResult> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const ctx = this.context(ref);
      const result = await tool.run(ctx, input);
      if (!ctx.conflicted) return result;
      await sleep(10 + Math.random() * 20 * (attempt + 1)); // jitter, so two processes do not collide in step
    }
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'The project kept changing while the edit was applied.',
        hint: 'Retry the call.',
      },
    };
  }
}
