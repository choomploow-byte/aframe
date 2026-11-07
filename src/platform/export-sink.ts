/**
 * Where an export goes. The desktop app saves into a folder the user picks in the system dialog (the
 * page never names a folder: see src-tauri/src/export.rs); a browser build hands over a download
 * (one file as itself, several as a .zip).
 */
import { bytesToBase64 } from '@core/assets';
import { exportFilesProblem } from '@core/export/paths';
import { zipStore } from '@core/export/zip';

export interface SinkFile {
  path: string;
  content: string | Uint8Array;
}

export type SaveOutcome =
  | { kind: 'saved'; where: string; written: string[]; unchanged: string[] }
  | { kind: 'conflict'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

export interface ExportSink {
  /** 'folder' saves into a chosen folder; 'download' hands the browser a file. */
  readonly kind: 'folder' | 'download';
  /** The folder picked earlier this session, if any (folder sinks only). */
  folder(): Promise<string | null>;
  /** Opens the system folder dialog. Null if the user cancelled. */
  pickFolder(): Promise<string | null>;
  /** Saves the files. `suggestedName` names the download in a browser. */
  save(
    files: readonly SinkFile[],
    options: { overwrite: boolean; suggestedName: string },
  ): Promise<SaveOutcome>;
}

const messageOf = (e: unknown): string =>
  typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);

async function tauriSink(): Promise<ExportSink> {
  const { invoke } = await import('@tauri-apps/api/core');
  return {
    kind: 'folder',
    folder: () => invoke<string | null>('export_folder'),
    pickFolder: async () => {
      try {
        return await invoke<string | null>('export_pick_folder');
      } catch (e) {
        throw new Error(messageOf(e), { cause: e });
      }
    },
    save: async (files, options) => {
      if ((await invoke<string | null>('export_folder')) === null) return { kind: 'cancelled' };
      const payload = files.map((f) =>
        typeof f.content === 'string'
          ? { path: f.path, text: f.content }
          : { path: f.path, base64: bytesToBase64(f.content) },
      );
      try {
        const r = await invoke<{ root: string; written: string[]; unchanged: string[] }>(
          'export_files',
          { files: payload, overwrite: options.overwrite },
        );
        return { kind: 'saved', where: r.root, written: r.written, unchanged: r.unchanged };
      } catch (e) {
        const message = messageOf(e);
        return message.startsWith('FILE_EXISTS')
          ? { kind: 'conflict', message: message.replace(/^FILE_EXISTS:\s*/, '') }
          : { kind: 'failed', message };
      }
    },
  };
}

function download(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const MIME: Record<string, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  html: 'text/html',
  css: 'text/css',
  tsx: 'text/plain',
  md: 'text/markdown',
};

const browserSink: ExportSink = {
  kind: 'download',
  folder: () => Promise.resolve(null),
  pickFolder: () => Promise.resolve(null),
  save: (files, options) => {
    const problem = exportFilesProblem(Object.fromEntries(files.map((f) => [f.path, f.content])));
    if (problem !== null) return Promise.resolve({ kind: 'failed', message: problem });
    const only = files.length === 1 ? files[0] : undefined;
    if (only) {
      const ext = only.path.split('.').pop() ?? '';
      const bytes =
        typeof only.content === 'string' ? new TextEncoder().encode(only.content) : only.content;
      download(
        only.path.split('/').pop() ?? only.path,
        bytes,
        MIME[ext] ?? 'application/octet-stream',
      );
      return Promise.resolve({
        kind: 'saved',
        where: 'your downloads',
        written: [only.path],
        unchanged: [],
      });
    }
    const name = `${options.suggestedName}.zip`;
    download(name, zipStore(files), 'application/zip');
    return Promise.resolve({
      kind: 'saved',
      where: `your downloads (${name})`,
      written: files.map((f) => f.path),
      unchanged: [],
    });
  },
};

let sink: Promise<ExportSink> | null = null;

export function getExportSink(): Promise<ExportSink> {
  sink ??=
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
      ? tauriSink()
      : Promise.resolve(browserSink);
  return sink;
}
