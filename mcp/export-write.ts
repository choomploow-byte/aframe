/**
 * Writing an export to a folder the user named (docs/18). The agent controls both the folder and
 * the file names, so this is a confinement point:
 *  - the folder must be absolute and not a system, credentials or too-broad place (judged on its
 *    real path, after symlinks), and never the home folder itself;
 *  - every file name is a short relative path of plain names: no `..`, drive letters, dot-files,
 *    Windows device names, nothing nested deeper than a few folders;
 *  - nothing that is a symlink or junction is followed, written through or replaced;
 *  - existing files are only replaced with `overwrite`, unless the bytes are identical, and a
 *    conflict stops the whole export before anything is written;
 *  - each file is written beside its target and renamed into place, so a crash never leaves half a file.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreError } from '../src/core/errors';
import { exportFilesProblem, exportRootProblem } from '../src/core/export/paths';

export interface WriteReport {
  /** The real folder written into. */
  root: string;
  written: string[];
  /** Already there with identical content. */
  unchanged: string[];
}

export interface WriteOptions {
  overwrite?: boolean;
  /** The user's home folder (a test can change it). */
  home?: string;
}

function refuse(message: string, hint?: string): never {
  throw new CoreError(
    'PATH_NOT_ALLOWED',
    message,
    hint ?? 'Ask the user for a project folder (not a system or hidden folder) and try again.',
  );
}

/** Resolves the folder's real path, even if its last parts do not exist yet. */
async function realRootOf(input: string): Promise<string> {
  const absolute = path.resolve(input);
  const missing: string[] = [];
  let cur = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      const st = await fs.stat(real);
      if (!st.isDirectory()) refuse(`${cur} is a file, not a folder.`);
      return path.join(real, ...missing.reverse());
    } catch (e) {
      if (e instanceof CoreError) throw e;
      const parent = path.dirname(cur);
      if (parent === cur) refuse(`${input} is not a usable folder.`);
      missing.push(path.basename(cur));
      cur = parent;
    }
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && Buffer.from(a).equals(Buffer.from(b));

const bytesOf = (content: string | Uint8Array): Uint8Array =>
  typeof content === 'string' ? Buffer.from(content, 'utf8') : content;

/** lstat that says "nothing there" as null. */
async function lstatOrNull(p: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeUserFiles(
  rootInput: string,
  files: Record<string, string | Uint8Array>,
  options: WriteOptions = {},
): Promise<WriteReport> {
  if (typeof rootInput !== 'string' || rootInput.includes('\0') || !path.isAbsolute(rootInput)) {
    refuse(
      'The folder must be an absolute path.',
      'Ask the user which project folder to write into, e.g. C:\\Users\\me\\app\\src\\design.',
    );
  }
  const root = await realRootOf(rootInput);
  const home = options.home ?? os.homedir();
  let realHome = home;
  try {
    realHome = await fs.realpath(home);
  } catch {
    /* no home to compare with */
  }
  if (root === realHome) refuse('That is your home folder; choose a project folder inside it.');
  const segments = root.slice(path.parse(root).root.length).split(path.sep).filter(Boolean);
  const rootProblem = exportRootProblem(segments);
  if (rootProblem !== null) refuse(`Refusing to write there: ${rootProblem}.`);

  const filesProblem = exportFilesProblem(files);
  if (filesProblem !== null) refuse(`Refusing this export: ${filesProblem}.`);

  // Plan everything first: nothing is written if any file is a problem.
  const plan: { rel: string; target: string; bytes: Uint8Array; same: boolean }[] = [];
  const conflicts: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, ...rel.split('/'));
    // No part of the way may be a link (the root itself was resolved above).
    let cur = root;
    for (const part of rel.split('/').slice(0, -1)) {
      cur = path.join(cur, part);
      const st = await lstatOrNull(cur);
      if (st?.isSymbolicLink()) refuse(`${rel}: ${part} is a link, which is never followed.`);
      if (st && !st.isDirectory()) refuse(`${rel}: ${part} exists and is not a folder.`);
    }
    const bytes = bytesOf(content);
    const st = await lstatOrNull(target);
    let same = false;
    if (st) {
      if (st.isSymbolicLink()) refuse(`${rel} is a link, which is never replaced.`);
      if (!st.isFile()) refuse(`${rel} exists and is not a file.`);
      same = sameBytes(new Uint8Array(await fs.readFile(target)), bytes);
      if (!same && options.overwrite !== true) conflicts.push(rel);
    }
    plan.push({ rel, target, bytes, same });
  }
  if (conflicts.length > 0) {
    throw new CoreError(
      'FILE_EXISTS',
      `${conflicts.length} file${conflicts.length === 1 ? '' : 's'} already exist${conflicts.length === 1 ? 's' : ''} with different content: ${conflicts.slice(0, 8).join(', ')}${conflicts.length > 8 ? ', ...' : ''}. Nothing was written.`,
      'Ask the user whether to replace them, then call again with overwrite: true. Or export into an empty folder.',
    );
  }

  const written: string[] = [];
  const unchanged: string[] = [];
  for (const item of plan) {
    if (item.same) {
      unchanged.push(item.rel);
      continue;
    }
    await fs.mkdir(path.dirname(item.target), { recursive: true });
    const tmp = path.join(
      path.dirname(item.target),
      `.aframe-${randomBytes(6).toString('hex')}.tmp`,
    );
    try {
      await fs.writeFile(tmp, item.bytes, { flag: 'wx' });
      await fs.rename(tmp, item.target);
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
    written.push(item.rel);
  }
  return { root, written, unchanged };
}
