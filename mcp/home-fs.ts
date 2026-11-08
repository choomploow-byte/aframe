/**
 * The Atelier home directory from Node: the same operations, confinement and write protocol as the
 * Rust commands in src-tauri/src (home.rs, fsops.rs, lock.rs), so a browser dev session and the MCP
 * server (Phase 5) behave exactly like the desktop app. Docs/06 is the protocol; keep these in step.
 *
 * Node only. Not imported by the webview bundle.
 */
import fs from 'node:fs/promises';
import { closeSync, existsSync, fsyncSync, openSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BRAND } from '../src/brand';
import { FsError, type DirEntry, type DocWrite, type FileStat } from '../src/platform/fs-types';

export const LOCK_STALE_MS = 5_000;
export const LOCK_WAIT_MS = 3_000;

export type Crash = 'during-tmp' | 'after-tmp' | 'after-backup';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let tmpCounter = 0;

export function resolveHomeDir(env: NodeJS.ProcessEnv = process.env, fallback?: string): string {
  const fromEnv = env[BRAND.homeEnvVar];
  if (fromEnv) return fromEnv;
  return fallback ?? path.join(os.homedir(), BRAND.homeDirName);
}

const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | undefined)?.code;

export interface HomeFsOptions {
  /** A project lock older than this belongs to a dead process (default 5 s). */
  lockStaleMs?: number;
  /** How long a writer waits for the lock before giving up (default 3 s). */
  lockWaitMs?: number;
}

export class HomeFs {
  constructor(
    readonly root: string,
    private readonly options: HomeFsOptions = {},
  ) {}

  /** Creates the home folder (private to the user where the OS supports it). */
  async ensure(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
  }

  /** Relative path -> full path inside the home. Rejects anything that could leave it. */
  confine(rel: string, options: { target?: boolean } = {}): string {
    if (rel.includes('\0')) throw new FsError('ESCAPE', 'invalid path');
    if (path.isAbsolute(rel) || rel.startsWith('/') || rel.startsWith('\\')) {
      throw new FsError('ESCAPE', 'absolute paths are not allowed');
    }
    // Both separators on every platform, so "a\..\b" is a traversal even on a POSIX test machine.
    const parts = rel.split(/[\\/]+/).filter((p) => p !== '' && p !== '.');
    for (const p of parts) {
      if (p === '..' || p.includes(':')) throw new FsError('ESCAPE', 'invalid path component');
    }
    if (options.target && parts.length === 0) {
      throw new FsError('ESCAPE', 'a file or folder inside the home is required');
    }
    const full = path.join(this.root, ...parts);

    // Symlink escape: the deepest existing ancestor must still be inside the real home.
    let probe = full;
    while (!existsSync(probe)) {
      const up = path.dirname(probe);
      if (up === probe) break;
      probe = up;
    }
    let realHome: string;
    try {
      realHome = realpathSync(this.root);
    } catch {
      return full; // home not created yet: nothing can have been linked out of it
    }
    const realProbe = realpathSync(probe);
    const inside = realProbe === realHome || realProbe.startsWith(realHome + path.sep);
    if (!inside) throw new FsError('ESCAPE', 'path escapes the Atelier home directory');
    return full;
  }

  async read(rel: string): Promise<string | null> {
    try {
      return await fs.readFile(this.confine(rel), 'utf8');
    } catch (e) {
      if (code(e) === 'ENOENT') return null;
      throw e;
    }
  }

  async readHead(rel: string, max: number): Promise<string | null> {
    let fh;
    try {
      fh = await fs.open(this.confine(rel), 'r');
    } catch (e) {
      if (code(e) === 'ENOENT') return null;
      throw e;
    }
    try {
      const buf = Buffer.alloc(Math.min(max, 1 << 20));
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  }

  async list(rel: string): Promise<DirEntry[]> {
    const full = this.confine(rel);
    let names: string[];
    try {
      names = await fs.readdir(full);
    } catch (e) {
      if (code(e) === 'ENOENT') return [];
      throw e;
    }
    const out: DirEntry[] = [];
    for (const name of names.sort()) {
      try {
        const st = await fs.stat(path.join(full, name));
        out.push({ name, isDir: st.isDirectory(), size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
      } catch {
        /* vanished between readdir and stat */
      }
    }
    return out;
  }

  async stat(rel: string): Promise<FileStat | null> {
    try {
      const st = await fs.stat(this.confine(rel));
      return { mtimeMs: Math.floor(st.mtimeMs), size: st.size };
    } catch (e) {
      if (code(e) === 'ENOENT') return null;
      throw e;
    }
  }

  async remove(rel: string): Promise<void> {
    await fs.rm(this.confine(rel, { target: true }), {
      recursive: true,
      force: true,
      maxRetries: 8, // Windows: a folder can be briefly held by a scanner
      retryDelay: 60,
    });
  }

  /** Atomic write of binary data (screenshots). */
  async writeBytes(rel: string, bytes: Uint8Array): Promise<FileStat> {
    const full = this.confine(rel, { target: true });
    await writeAtomic(full, bytes);
    const st = await fs.stat(full);
    return { mtimeMs: Math.floor(st.mtimeMs), size: st.size };
  }

  /** Plain atomic write (state files, responses). */
  async write(rel: string, content: string): Promise<FileStat> {
    const full = this.confine(rel, { target: true });
    await writeAtomic(full, content);
    const st = await fs.stat(full);
    return { mtimeMs: Math.floor(st.mtimeMs), size: st.size };
  }

  /**
   * Project document write: compare-and-write on `rev` under the project lock, previous version
   * kept as `.bak` (only if it was itself a valid document). See fsops.rs `write_doc`.
   */
  async writeDoc(
    rel: string,
    content: string,
    expectRev: number | null = null,
    crash?: Crash,
  ): Promise<DocWrite> {
    const full = this.confine(rel, { target: true });
    const dir = path.dirname(full);
    await fs.mkdir(dir, { recursive: true });
    const release = await acquireLock(path.join(dir, '.lock'), {
      staleMs: this.options.lockStaleMs,
      waitMs: this.options.lockWaitMs,
    });
    try {
      let existing: string | null = null;
      try {
        existing = await fs.readFile(full, 'utf8');
      } catch (e) {
        if (code(e) !== 'ENOENT') throw e;
      }
      const existingRev = existing === null ? null : parseRev(existing);
      if (expectRev !== null && existing !== null && existingRev !== expectRev) {
        return { ok: false, conflict: true, diskRev: existingRev, stat: await this.statFull(full) };
      }
      if (existing !== null && existingRev !== null) await writeAtomic(`${full}.bak`, existing);
      if (crash === 'after-backup') throw new Error('simulated crash');
      await writeAtomic(full, content, crash);
      return {
        ok: true,
        conflict: false,
        diskRev: parseRev(content),
        stat: await this.statFull(full),
      };
    } finally {
      await release();
    }
  }

  private async statFull(full: string): Promise<FileStat | null> {
    try {
      const st = await fs.stat(full);
      return { mtimeMs: Math.floor(st.mtimeMs), size: st.size };
    } catch {
      return null;
    }
  }
}

/** `rev` of a project document's text, or null if it is not valid JSON with a numeric `rev`. */
export function parseRev(text: string): number | null {
  try {
    const v: unknown = JSON.parse(text);
    const rev = (v as { rev?: unknown } | null)?.rev;
    return typeof rev === 'number' && Number.isInteger(rev) && rev >= 0 ? rev : null;
  } catch {
    return null;
  }
}

/** temp file + fsync + rename, with a retry for Windows (a scanner or sync client holding the file). */
export async function writeAtomic(
  target: string,
  content: string | Uint8Array,
  crash?: Crash,
): Promise<void> {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${tmpCounter++}.tmp`);
  try {
    if (crash === 'during-tmp') {
      await fs.writeFile(tmp, content.slice(0, Math.floor(content.length / 2)));
      throw new Error('simulated crash');
    }
    await fs.writeFile(tmp, content);
    const fd = openSync(tmp, 'r+');
    try {
      fsyncSync(fd); // on disk before it becomes the document
    } finally {
      closeSync(fd);
    }
    if (crash === 'after-tmp') throw new Error('simulated crash');
    await renameWithRetry(tmp, target);
  } catch (e) {
    // A real crash leaves the temp file behind; an ordinary error cleans up after itself.
    if (!(e instanceof Error && e.message === 'simulated crash')) await fs.rm(tmp, { force: true });
    throw e;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  let last: unknown;
  // Up to ~1.5 s: an antivirus scan or a sync client can hold a file for longer than you'd think.
  for (let i = 0; i < 14; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (e) {
      last = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code(e) ?? '')) throw e;
      await sleep(Math.min(40 + i * 15, 150));
    }
  }
  throw new FsError('IO', `could not replace the file: ${String(last)}`);
}

/** Exclusive `.lock` file; a lock older than LOCK_STALE_MS belongs to a dead process. */
export async function acquireLock(
  lockPath: string,
  options: { waitMs?: number; staleMs?: number } = {},
): Promise<() => Promise<void>> {
  const waitMs = options.waitMs ?? LOCK_WAIT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const started = Date.now();
  for (;;) {
    try {
      const fh = await fs.open(lockPath, 'wx');
      await fh.writeFile(JSON.stringify({ pid: process.pid }));
      await fh.close();
      return async () => {
        await fs.rm(lockPath, { force: true });
      };
    } catch (e) {
      // Windows says EPERM/EACCES (not EEXIST) while the other side is deleting the lock file.
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(code(e) ?? '')) throw e;
      try {
        const st = await fs.stat(lockPath);
        if (Date.now() - st.mtimeMs > staleMs) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch {
        /* gone already: try again */
      }
      if (Date.now() - started >= waitMs) {
        throw new FsError('LOCKED', 'another Atelier process is writing this project');
      }
      await sleep(15);
    }
  }
}

/** Deletes leftover `.tmp` files from writes that were cut short (older than `maxAgeMs`). */
export async function sweepTempFiles(dir: string, maxAgeMs = 120_000): Promise<number> {
  let removed = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) removed += await sweepTempFiles(p, maxAgeMs);
    else if (e.name.startsWith('.') && e.name.endsWith('.tmp')) {
      try {
        const st = await fs.stat(p);
        if (Date.now() - st.mtimeMs >= maxAgeMs) {
          await fs.rm(p, { force: true });
          removed += 1;
        }
      } catch {
        /* gone */
      }
    }
  }
  return removed;
}

/** Folders under the home (mirrors layout.rs). */
export const HOME_DIRS = [
  'projects',
  'requests',
  'responses',
  'mcp',
  'skills',
  'exports',
  'logs',
  'agents',
] as const;

/** Marker on the first line of generated files, so a later phase may replace them. */
export const GENERATED_MARKER = 'atelier-generated';

const MCP_PLACEHOLDER = `// ${GENERATED_MARKER} placeholder. The real MCP server is bundled here in Phase 5.
console.error('Atelier MCP server: not installed yet (this build has no MCP bundle).');
process.exit(1);
`;
const SKILLS_README = `<!-- ${GENERATED_MARKER} -->
Skills are markdown files the AI agent loads on demand. Put your own \`*.md\` files here: each
needs a frontmatter block with \`name\` (lowercase letters, digits and dashes) and \`description\`.
A skill of yours with the same name as one of Atelier's replaces it. See skills/README.md in the
repository for the format.
`;

/** Creates the folders and placeholder files; never overwrites an existing file. */
export async function ensureLayout(home: HomeFs): Promise<void> {
  await home.ensure();
  for (const d of HOME_DIRS) await fs.mkdir(home.confine(d), { recursive: true });
  for (const [rel, text] of [
    ['mcp/atelier-mcp.mjs', MCP_PLACEHOLDER],
    ['skills/README.md', SKILLS_README],
  ] as const) {
    if ((await home.stat(rel)) === null) await home.write(rel, text);
  }
  await sweepTempFiles(home.root);
}
