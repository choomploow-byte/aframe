/**
 * Reading image files a user or agent names by path (docs/18). The agent controls the path, so this
 * is the confinement point: images only (extension, then the real content check in core), a size
 * cap checked before reading, no directories, no secret-looking places, and the real path (after
 * symlinks) is what gets checked.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_IMAGE_BYTES } from '../src/core/assets';
import { CoreError } from '../src/core/errors';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
/** Folders that hold credentials, whatever the file is called. */
const SECRET_DIRS = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.azure',
  '.kube',
  '.docker',
  '.npm',
  '.config',
  'keychains',
  'credentials',
]);

export interface ReaderOptions {
  /** The Atelier home: it contains dot-folders of its own (screenshots live there) and is allowed. */
  atelierHome: string;
}

function refuse(message: string, hint?: string): never {
  throw new CoreError(
    'PATH_NOT_ALLOWED',
    message,
    hint ??
      'Give the absolute path of a PNG, JPEG, GIF, WebP or SVG image that is not in a hidden or system folder.',
  );
}

/** Checks a path without reading it. Returns the real path to read. */
export async function checkImagePath(input: string, options: ReaderOptions): Promise<string> {
  if (input.includes('\0')) refuse('That path is not valid.');
  if (!path.isAbsolute(input))
    refuse(
      'The path must be absolute.',
      'Use a full path such as C:\\Users\\me\\Pictures\\ref.png or /Users/me/ref.png.',
    );
  let real: string;
  try {
    real = await fs.realpath(input);
  } catch {
    throw new CoreError('NOT_FOUND', `No file at ${input}.`, 'Check the path.');
  }
  const ext = path.extname(real).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) refuse(`${path.basename(real)} is not an image file.`);

  let home: string | null = null;
  try {
    home = await fs.realpath(options.atelierHome);
  } catch {
    /* no home yet */
  }
  const inHome = home !== null && (real === home || real.startsWith(home + path.sep));
  if (!inHome) {
    const parts = real.split(path.sep).slice(0, -1);
    const hidden = parts.find((p) => p.startsWith('.') && p !== '.' && p !== '..');
    const secret = parts.find((p) => SECRET_DIRS.has(p.toLowerCase()));
    if (hidden !== undefined || secret !== undefined) {
      refuse(`Files in ${hidden ?? secret} are not readable by this tool.`);
    }
  }
  const st = await fs.stat(real);
  if (!st.isFile()) refuse('That path is not a file.');
  if (st.size > MAX_IMAGE_BYTES) {
    throw new CoreError(
      'LIMIT_EXCEEDED',
      `That image is ${(st.size / 1048576).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1048576} MB.`,
      'Resize or compress it first.',
    );
  }
  return real;
}

export function createImageReader(options: ReaderOptions): (p: string) => Promise<Uint8Array> {
  return async (p) => new Uint8Array(await fs.readFile(await checkImagePath(p, options)));
}
