/**
 * The app side of the agent bridge (docs/06 "Request/response"): things only the live app can do.
 *
 * An agent drops `requests/req_<id>.json`; the native watcher hands it to us; we answer with
 * `responses/<id>.json` and delete the request. Request files are UNTRUSTED DATA: the `type` is
 * checked against an allow-list, params are validated field by field, and nothing in a request is
 * ever executed or used as a path. Unfinished request types answer NOT_IMPLEMENTED so an agent gets
 * a clear error instead of a timeout.
 */
import type { HomeApi } from '../platform/fs';
import { isProjectId } from '../projects/projects';

const REQUEST_ID = /^req_[A-Za-z0-9]{1,40}$/;
const MAX_AGE_MS = 120_000;
const MAX_HANDLED = 1000;

/** Implemented now. */
export const LIVE_TYPES = [
  'ping',
  'get_selection',
  'open_project',
  'screenshot',
  'get_node_bounds',
  'export_image',
] as const;
/** Allowed, but built in a later phase. */
export const PLANNED_TYPES: readonly string[] = [];
/** Request types that are about the project open on screen (a request for another one is refused). */
const PROJECT_BOUND = new Set(['get_selection', 'screenshot', 'get_node_bounds', 'export_image']);
export const REQUEST_TYPES: readonly string[] = [...LIVE_TYPES, ...PLANNED_TYPES];

export type BridgeResult =
  { ok: true; result: unknown } | { ok: false; error: { code: string; message: string } };

export interface BridgeHandlers {
  /** Save pending edits first: an agent must see what the user just did. */
  flush(): Promise<void>;
  currentProject(): string | null;
  selection(): string[];
  /** Switches the open project. Returns a message if it could not be opened. */
  openProject(id: string): Promise<string | null>;
  /** Renders the design or a node to a PNG (needs the canvas on screen). */
  screenshot?(
    params: Record<string, unknown>,
  ): Promise<{ pngBase64: string; width: number; height: number }>;
  /** Renders a node to the bytes of a PNG or SVG file (needs the canvas on screen). */
  exportImage?(params: Record<string, unknown>): Promise<{
    dataBase64: string;
    mime: string;
    width: number;
    height: number;
  }>;
  /** A node's rectangle on the canvas in world units, or null if it is not drawn. */
  nodeBounds?(
    nodeId: string,
  ): Promise<{ x: number; y: number; width: number; height: number } | null>;
}

/** A handler failing in a way the agent should read: becomes `{ ok:false, error:{ code, message } }`. */
export class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ParsedRequest {
  id: string;
  type: string;
  params: Record<string, unknown>;
  /** The project the agent means (ids only; anything else is ignored). */
  project: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseRequest(
  fileName: string,
  text: string,
  now: number = Date.now(),
):
  | { ok: true; request: ParsedRequest }
  | { ok: false; id: string | null; stale?: boolean; message: string } {
  const idFromName = /^(req_[A-Za-z0-9]{1,40})\.json$/.exec(fileName)?.[1] ?? null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, id: idFromName, message: 'The request is not valid JSON.' };
  }
  if (!isObject(json))
    return { ok: false, id: idFromName, message: 'The request must be a JSON object.' };
  const { id, type, params, createdAt, project } = json;
  if (typeof id !== 'string' || !REQUEST_ID.test(id) || id !== idFromName) {
    return {
      ok: false,
      id: idFromName,
      message: 'The request id is missing or does not match its file name.',
    };
  }
  if (typeof type !== 'string') return { ok: false, id, message: 'The request has no type.' };
  if (typeof createdAt === 'string') {
    const at = Date.parse(createdAt);
    if (Number.isFinite(at) && now - at > MAX_AGE_MS) {
      return { ok: false, id, stale: true, message: 'The request is too old.' };
    }
  }
  if (params !== undefined && !isObject(params)) {
    return { ok: false, id, message: 'The request params must be an object.' };
  }
  return {
    ok: true,
    request: {
      id,
      type,
      params: params ?? {},
      project: typeof project === 'string' && isProjectId(project) ? project : null,
    },
  };
}

export class BridgeService {
  private readonly handled = new Set<string>();
  private off: (() => void) | null = null;

  constructor(
    private readonly fs: HomeApi,
    private readonly handlers: BridgeHandlers,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(): () => void {
    this.stop();
    this.off = this.fs.onRequest((file) => void this.handle(file.name, file.content));
    void this.fs.bridgeResync().catch(() => undefined); // requests that arrived before we listened
    return () => this.stop();
  }

  stop(): void {
    this.off?.();
    this.off = null;
  }

  /** Handles one request file. Never throws: every outcome is a response (or silence for stale files). */
  async handle(fileName: string, text: string): Promise<void> {
    const parsed = parseRequest(fileName, text, this.now());
    if (!parsed.ok) {
      if (parsed.id !== null && !parsed.stale) {
        await this.respond(parsed.id, fileName, {
          ok: false,
          error: { code: 'BAD_REQUEST', message: parsed.message },
        });
      } else {
        await this.discard(fileName);
      }
      return;
    }
    const { id, type, params, project } = parsed.request;
    if (this.handled.has(id)) return;
    this.handled.add(id);
    if (this.handled.size > MAX_HANDLED)
      this.handled.delete(this.handled.values().next().value as string);

    let result: BridgeResult;
    try {
      await this.handlers.flush();
      result = await this.run(type, params, project);
    } catch (e) {
      result = {
        ok: false,
        error: {
          code: e instanceof RequestError ? e.code : 'INTERNAL',
          message: e instanceof Error ? e.message : String(e),
        },
      };
    }
    await this.respond(id, fileName, result);
  }

  private async run(
    type: string,
    params: Record<string, unknown>,
    project: string | null,
  ): Promise<BridgeResult> {
    if (!REQUEST_TYPES.includes(type)) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_TYPE', message: `Unknown request type "${type.slice(0, 40)}".` },
      };
    }
    if (PROJECT_BOUND.has(type) && project !== null && project !== this.handlers.currentProject()) {
      return {
        ok: false,
        error: {
          code: 'PROJECT_NOT_OPEN',
          message: 'That project is not the one open in AFrame right now.',
        },
      };
    }
    switch (type) {
      case 'ping':
        return { ok: true, result: { pong: true, project: this.handlers.currentProject() } };
      case 'get_selection':
        return {
          ok: true,
          result: { project: this.handlers.currentProject(), selection: this.handlers.selection() },
        };
      case 'open_project': {
        const project = params.project;
        if (typeof project !== 'string' || !isProjectId(project)) {
          return {
            ok: false,
            error: { code: 'BAD_REQUEST', message: 'params.project must be a project id.' },
          };
        }
        const problem = await this.handlers.openProject(project);
        return problem === null
          ? { ok: true, result: { project } }
          : { ok: false, error: { code: 'PROJECT_NOT_FOUND', message: problem } };
      }
      case 'screenshot': {
        if (!this.handlers.screenshot) return notBuilt(type);
        return { ok: true, result: await this.handlers.screenshot(params) };
      }
      case 'export_image': {
        if (!this.handlers.exportImage) return notBuilt(type);
        return { ok: true, result: await this.handlers.exportImage(params) };
      }
      case 'get_node_bounds': {
        const nodeId = params.nodeId;
        if (
          typeof nodeId !== 'string' ||
          nodeId.length === 0 ||
          nodeId.length > 64 ||
          !this.handlers.nodeBounds
        ) {
          return {
            ok: false,
            error: { code: 'BAD_REQUEST', message: 'params.nodeId must be a node id.' },
          };
        }
        return { ok: true, result: { bounds: await this.handlers.nodeBounds(nodeId) } };
      }
      default:
        return {
          ok: false,
          error: {
            code: 'NOT_IMPLEMENTED',
            message: `"${type}" is not available in this version of AFrame yet.`,
          },
        };
    }
  }

  private async respond(id: string, fileName: string, result: BridgeResult): Promise<void> {
    const body = JSON.stringify({ id, completedAt: new Date(this.now()).toISOString(), ...result });
    try {
      await this.fs.writeText(`responses/${id}.json`, body);
    } finally {
      await this.discard(fileName);
    }
  }

  private async discard(fileName: string): Promise<void> {
    try {
      await this.fs.remove(`requests/${fileName}`);
    } catch {
      /* already gone, or a name the native side refused: nothing to clean up */
    }
  }
}

function notBuilt(type: string): BridgeResult {
  return {
    ok: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: `"${type}" is not available in this version of AFrame yet.`,
    },
  };
}
