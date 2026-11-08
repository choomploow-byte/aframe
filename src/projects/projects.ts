/**
 * Projects on disk: `projects/<id>/project.aframe.json` (+ `.bak`). Everything goes through the
 * `HomeApi`, so the same code runs against the Tauri commands, the dev HTTP adapter and, in tests,
 * a real temp directory.
 */
import { createEmptyDoc, loadDoc, serializeDoc } from '@core/doc';
import { generateId } from '@core/ids';
import type { Doc, OpError, Warning } from '@core/types';
import { BRAND } from '../brand';
import type { HomeApi } from '../platform/fs';
import type { FileStat } from '../platform/fs-types';

export const PROJECT_ID = /^p_[A-Za-z0-9]{3,16}$/;

export const isProjectId = (id: string): boolean => PROJECT_ID.test(id);

export const projectDir = (id: string): string => `projects/${id}`;
export const projectFile = (id: string): string => `${projectDir(id)}/${BRAND.projectFileName}`;
export const backupFile = (id: string): string => `${projectFile(id)}.bak`;

function assertId(id: string): void {
  if (!isProjectId(id)) throw new Error(`"${id}" is not a project id`);
}

export interface ProjectInfo {
  id: string;
  name: string;
  /** Last modified time of the project file (ms since the epoch). */
  updatedAtMs: number;
  size: number;
  /** The file could not be read as a project (still listed, so it can be restored or deleted). */
  unreadable: boolean;
}

/** Name from the start of a project file without parsing (or even loading) the whole thing. */
export function nameFromHead(head: string): string | null {
  const m = /"name"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(head);
  if (!m?.[1]) return null;
  try {
    const v: unknown = JSON.parse(m[1]);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Newest first. Never throws for one bad project: it is listed as unreadable. */
export async function listProjects(fs: HomeApi): Promise<ProjectInfo[]> {
  const entries = await fs.list('projects');
  const out: ProjectInfo[] = [];
  for (const e of entries) {
    if (!e.isDir || !isProjectId(e.name)) continue;
    const file = projectFile(e.name);
    let stat: FileStat | null = null;
    try {
      stat = await fs.stat(file);
    } catch {
      /* listed below as unreadable */
    }
    if (stat === null) {
      // A folder without a project file: only worth showing if a backup could restore it.
      const bak = await fs.stat(backupFile(e.name)).catch(() => null);
      if (bak !== null)
        out.push({ id: e.name, name: e.name, updatedAtMs: bak.mtimeMs, size: 0, unreadable: true });
      continue;
    }
    let name: string | null = null;
    try {
      const head = await fs.readHead(file, 4096);
      name = head === null ? null : nameFromHead(head);
    } catch {
      /* unreadable */
    }
    out.push({
      id: e.name,
      name: name ?? e.name,
      updatedAtMs: stat.mtimeMs,
      size: stat.size,
      unreadable: name === null,
    });
  }
  return out.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export type OpenFailure =
  | { ok: false; reason: 'missing' }
  | { ok: false; reason: 'invalid'; errors: OpError[]; canRestore: boolean }
  | { ok: false; reason: 'too-new'; errors: OpError[] };

export interface Opened {
  ok: true;
  id: string;
  doc: Doc;
  warnings: Warning[];
  /** The file was written by an older schema and upgraded in memory (saved on the next edit). */
  migrated: boolean;
  /** `rev` as stored in the file, which is what the next compare-and-write expects. */
  diskRev: number | null;
  stat: FileStat | null;
}

export type OpenResult = Opened | OpenFailure;

/** Parses and validates project file text. */
export function parseProjectText(text: string): ReturnType<typeof loadDoc> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          code: 'INVALID_VALUE',
          message: `The project file is not valid JSON (${e instanceof Error ? e.message : 'parse error'}).`,
        },
      ],
    };
  }
  return loadDoc(json);
}

export async function openProject(fs: HomeApi, id: string): Promise<OpenResult> {
  assertId(id);
  const text = await fs.readText(projectFile(id));
  if (text === null) {
    // A project folder whose main file vanished but whose backup is intact is recoverable.
    const bak = await fs.readText(backupFile(id));
    if (bak !== null && parseProjectText(bak).ok) {
      return {
        ok: false,
        reason: 'invalid',
        errors: [{ code: 'INVALID_VALUE', message: 'The project file is missing.' }],
        canRestore: true,
      };
    }
    return { ok: false, reason: 'missing' };
  }
  const parsed = parseProjectText(text);
  if (!parsed.ok) {
    if (parsed.errors.some((e) => e.code === 'SCHEMA_NEWER')) {
      return { ok: false, reason: 'too-new', errors: parsed.errors };
    }
    const bak = await fs.readText(backupFile(id));
    return {
      ok: false,
      reason: 'invalid',
      errors: parsed.errors,
      canRestore: bak !== null && parseProjectText(bak).ok,
    };
  }
  return {
    ok: true,
    id,
    doc: parsed.doc,
    warnings: parsed.warnings,
    migrated: parsed.migrated,
    diskRev: revOf(text),
    stat: await fs.stat(projectFile(id)),
  };
}

export function revOf(text: string): number | null {
  try {
    const v = JSON.parse(text) as { rev?: unknown };
    return typeof v.rev === 'number' ? v.rev : null;
  } catch {
    return null;
  }
}

/** Writes a new project file (never overwrites: the id must be unused). */
export async function createProject(fs: HomeApi, doc: Doc): Promise<void> {
  assertId(doc.id);
  if ((await fs.stat(projectFile(doc.id))) !== null)
    throw new Error(`Project ${doc.id} already exists.`);
  const r = await fs.writeDoc(projectFile(doc.id), serializeDoc(doc), null);
  if (!r.ok) throw new Error('Could not create the project file.');
}

/** An id no existing project folder uses. */
export async function freshProjectId(
  fs: HomeApi,
  rng: () => number = Math.random,
): Promise<string> {
  const taken = new Set((await fs.list('projects')).map((e) => e.name));
  return generateId('p', taken, rng);
}

export async function newProject(fs: HomeApi, name = 'Untitled'): Promise<Doc> {
  const doc = createEmptyDoc({ id: await freshProjectId(fs), name });
  await createProject(fs, doc);
  return doc;
}

/** A copy of `source` as a new project (the sample, an imported file): new id, fresh timestamps. */
export async function newProjectFrom(fs: HomeApi, source: Doc, name?: string): Promise<Doc> {
  const now = new Date().toISOString();
  const doc: Doc = {
    ...source,
    id: await freshProjectId(fs),
    name: name ?? source.name,
    rev: 1,
    meta: { createdAt: now, updatedAt: now, lastWriter: 'app' },
  };
  await createProject(fs, doc);
  return doc;
}

/** Puts the last valid version (`.bak`) back as the project file. */
export async function restoreBackup(fs: HomeApi, id: string): Promise<boolean> {
  assertId(id);
  const bak = await fs.readText(backupFile(id));
  if (bak === null || !parseProjectText(bak).ok) return false;
  // A plain atomic write: the file being replaced is unreadable, so there is no rev to compare.
  await fs.writeText(projectFile(id), bak);
  return true;
}

/** Renames a project that is not open (an open one is renamed through the store and autosaved). */
export async function renameProjectOnDisk(fs: HomeApi, id: string, name: string): Promise<boolean> {
  assertId(id);
  const opened = await openProject(fs, id);
  if (!opened.ok) return false;
  const next: Doc = {
    ...opened.doc,
    name,
    rev: opened.doc.rev + 1,
    meta: { ...opened.doc.meta, updatedAt: new Date().toISOString(), lastWriter: 'app' },
  };
  const r = await fs.writeDoc(projectFile(id), serializeDoc(next), opened.diskRev);
  return r.ok;
}

/** Permanently deletes a project folder (the caller confirms first). */
export async function deleteProject(fs: HomeApi, id: string): Promise<void> {
  assertId(id);
  await fs.remove(projectDir(id));
}

// --- the one small settings file the webview owns ------------------------------------------

export interface Settings {
  lastProject?: string;
}

export async function readSettings(fs: HomeApi): Promise<Settings> {
  try {
    const text = await fs.readText('settings.json');
    if (text === null) return {};
    const v = JSON.parse(text) as Record<string, unknown>;
    return typeof v.lastProject === 'string' && isProjectId(v.lastProject)
      ? { lastProject: v.lastProject }
      : {};
  } catch {
    return {}; // unreadable settings never block startup
  }
}

export async function writeSettings(fs: HomeApi, settings: Settings): Promise<void> {
  await fs.writeText('settings.json', `${JSON.stringify(settings, null, 2)}\n`);
}
