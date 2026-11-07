/**
 * Rules for the files an export may create. Pure, so the Node writer (MCP server) and the app's UI
 * apply the same ones; the desktop app's Rust command repeats them (its tests mirror this file).
 * An export is a handful of source files with plain names, so the rules are strict: anything else
 * is an attack or a bug, not a design.
 */

export const MAX_EXPORT_FILES = 200;
export const MAX_EXPORT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_EXPORT_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_DEPTH = 4;
const MAX_PATH_LENGTH = 120;

/** Names Windows treats as devices, in any extension. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._ @-]*$/; // '@' for retina names such as hero@2x.png

/** Why a relative path may not be written, or null when it is fine. */
export function exportPathProblem(rel: string): string | null {
  if (rel === '' || rel.length > MAX_PATH_LENGTH) return 'the path is empty or too long';
  if (rel.includes('\\') || rel.includes(':') || rel.includes('\0')) {
    return 'the path uses a backslash, a colon or a control character';
  }
  if (rel.startsWith('/')) return 'the path is absolute';
  const parts = rel.split('/');
  if (parts.length > MAX_DEPTH) return 'the path is nested too deeply';
  for (const part of parts) {
    if (part === '.' || part === '..') return 'the path climbs out of the folder';
    if (!SEGMENT.test(part)) return 'a name starts with a dot or has unusual characters';
    if (/[. ]$/.test(part)) return 'a name ends with a dot or a space';
    if (RESERVED.test(part)) return `"${part}" is a reserved name on Windows`;
  }
  return null;
}

/** Folders that hold credentials or application data, wherever they sit in the path. */
const BLOCKED_ANYWHERE = new Set([
  '.ssh',
  '.aws',
  '.gnupg',
  '.azure',
  '.kube',
  '.docker',
  '.npm',
  '.git',
  '.config',
  'keychains',
  'credentials',
  'appdata',
]);
/** System folders, as the first folder under the drive or filesystem root. */
const BLOCKED_TOP = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'etc',
  'usr',
  'bin',
  'sbin',
  'var',
  'system',
  'library',
  'proc',
  'sys',
  'boot',
]);

/**
 * Why a destination folder may not be used, or null. `segments` are the folders of its real path
 * (symlinks resolved) without the drive or filesystem root: `C:\Users\me\app` is `Users, me, app`.
 * The caller also refuses the user's home folder itself.
 */
export function exportRootProblem(segments: readonly string[]): string | null {
  if (segments.length < 2) return 'that folder is too broad: choose a project folder';
  const top = segments[0]?.toLowerCase() ?? '';
  if (BLOCKED_TOP.has(top)) return `"${segments[0]}" is a system folder`;
  for (const s of segments) {
    if (BLOCKED_ANYWHERE.has(s.toLowerCase())) return `"${s}" is a system or credentials folder`;
  }
  return null;
}

/** The first problem across a whole export, or null. */
export function exportFilesProblem(
  files: Readonly<Record<string, string | Uint8Array>>,
): string | null {
  const names = Object.keys(files);
  if (names.length === 0) return 'there is nothing to write';
  if (names.length > MAX_EXPORT_FILES) return `more than ${MAX_EXPORT_FILES} files`;
  const seen = new Set<string>();
  let total = 0;
  for (const name of names) {
    const problem = exportPathProblem(name);
    if (problem !== null) return `${JSON.stringify(name.slice(0, 60))}: ${problem}`;
    const key = name.toLowerCase();
    if (seen.has(key)) return `${JSON.stringify(name)} appears twice (names are case-insensitive)`;
    seen.add(key);
    const content = files[name] as string | Uint8Array;
    const size = typeof content === 'string' ? content.length * 3 : content.byteLength;
    if (size > MAX_EXPORT_FILE_BYTES) return `${JSON.stringify(name)} is too large`;
    total += size;
  }
  return total > MAX_EXPORT_TOTAL_BYTES ? 'the export is too large' : null;
}
