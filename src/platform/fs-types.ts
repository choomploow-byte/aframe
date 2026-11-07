/** Shapes shared by every file adapter (Tauri commands, the dev HTTP adapter, the Node module). */

export interface FileStat {
  /** Modified time in ms since the epoch. */
  mtimeMs: number;
  size: number;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

/** The outcome of a compare-and-write of a project document. */
export interface DocWrite {
  ok: boolean;
  /** The file moved on since `expectRev`; nothing was written. */
  conflict: boolean;
  /** `rev` of the file as it is now. */
  diskRev: number | null;
  stat: FileStat | null;
}

/** Errors from a file adapter carry a stable code the UI can show a sentence for. */
export class FsError extends Error {
  constructor(
    readonly code: 'LOCKED' | 'ESCAPE' | 'IO',
    message: string,
  ) {
    super(message);
    this.name = 'FsError';
  }
}
