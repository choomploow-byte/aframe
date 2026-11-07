/**
 * The webview's whole view of the disk: one typed API, two adapters.
 *
 *  - Tauri: the confined commands in src-tauri (every path relative to `~/.atelier`).
 *  - Dev HTTP: the same operations behind `/__fs/*` in `vite dev` (scripts/vite-dev-fs.ts), so the
 *    app runs in a normal browser for development and the browser tests.
 *
 * Nothing else in the app talks to the disk. Paths are always relative to the Atelier home.
 */
import { FsError, type DirEntry, type DocWrite, type FileStat } from './fs-types';

export interface AppStateReport {
  currentProject: string | null;
  selection: readonly string[];
}

/** An agent request file as found by the native watcher (docs/06). */
export interface BridgeRequestFile {
  name: string;
  content: string;
}

export interface HomeApi {
  readonly kind: 'tauri' | 'dev-http' | 'test';
  home(): Promise<string>;
  readText(path: string): Promise<string | null>;
  /** The first `max` bytes (enough to read a project's name without its embedded images). */
  readHead(path: string, max: number): Promise<string | null>;
  writeText(path: string, content: string): Promise<FileStat>;
  /** Compare-and-write of a project document on `rev`; see DocWrite. */
  writeDoc(path: string, content: string, expectRev: number | null): Promise<DocWrite>;
  list(path: string): Promise<DirEntry[]>;
  remove(path: string): Promise<void>;
  stat(path: string): Promise<FileStat | null>;
  /** Tells the native side what is open; it publishes this in `app-state.json`. */
  reportAppState(state: AppStateReport): Promise<void>;
  /** Asks for agent requests that arrived before the page was listening to be announced again. */
  bridgeResync(): Promise<void>;
  /** Called for every new agent request file. Returns an unsubscribe function. */
  onRequest(cb: (req: BridgeRequestFile) => void): () => void;
  /** The window is closing: save, then call `quit`. */
  onCloseRequested(cb: () => void): () => void;
  quit(): Promise<void>;
}

function toFsError(e: unknown): FsError {
  if (e instanceof FsError) return e;
  const message = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
  if (message.startsWith('LOCKED')) return new FsError('LOCKED', message);
  if (/escape|absolute path|invalid path/i.test(message)) return new FsError('ESCAPE', message);
  return new FsError('IO', message);
}

// ---------------------------------------------------------------------------
// Tauri
// ---------------------------------------------------------------------------

async function createTauriFs(): Promise<HomeApi> {
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const call = async <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await invoke<T>(cmd, args);
    } catch (e) {
      throw toFsError(e);
    }
  };
  const subscribe = <T>(event: string, cb: (payload: T) => void): (() => void) => {
    let off: (() => void) | null = null;
    let cancelled = false;
    void listen<T>(event, (e) => cb(e.payload)).then((fn) => {
      if (cancelled) fn();
      else off = fn;
    });
    return () => {
      cancelled = true;
      off?.();
    };
  };
  return {
    kind: 'tauri',
    home: () => call('atelier_home'),
    readText: (path) => call('fs_read', { path }),
    readHead: (path, max) => call('fs_read_head', { path, max }),
    writeText: (path, content) => call('fs_write', { path, content }),
    writeDoc: (path, content, expectRev) => call('fs_write_doc', { path, content, expectRev }),
    list: (path) => call('fs_list', { path }),
    remove: (path) => call('fs_remove', { path }),
    stat: (path) => call('fs_stat', { path }),
    reportAppState: (s) =>
      call('app_state_set', { currentProject: s.currentProject, selection: [...s.selection] }),
    bridgeResync: () => call('bridge_resync'),
    onRequest: (cb) => subscribe<BridgeRequestFile>('atelier://request', cb),
    onCloseRequested: (cb) => subscribe<null>('atelier://close-requested', () => cb()),
    quit: () => call('app_quit'),
  };
}

// ---------------------------------------------------------------------------
// Dev HTTP (vite dev)
// ---------------------------------------------------------------------------

const REQUEST_NAME = /^req_[A-Za-z0-9]{1,40}\.json$/;

function createDevFs(): HomeApi {
  const call = async <T>(op: string, body: Record<string, unknown> = {}): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`/__fs/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-atelier-dev': '1' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new FsError('IO', `The dev file server is not reachable: ${String(e)}`);
    }
    const json = (await res.json()) as {
      result?: T;
      error?: { code: FsError['code']; message: string };
    };
    if (!res.ok || json.error) {
      throw new FsError(json.error?.code ?? 'IO', json.error?.message ?? `HTTP ${res.status}`);
    }
    return json.result as T;
  };
  return {
    kind: 'dev-http',
    home: () => call('home'),
    readText: (path) => call('read', { path }),
    readHead: (path, max) => call('read_head', { path, max }),
    writeText: (path, content) => call('write', { path, content }),
    writeDoc: (path, content, expectRev) => call('write_doc', { path, content, expectRev }),
    list: (path) => call('list', { path }),
    remove: (path) => call('remove', { path }),
    stat: (path) => call('stat', { path }),
    reportAppState: (s) =>
      call('app_state_set', { currentProject: s.currentProject, selection: [...s.selection] }),
    bridgeResync: () => call('bridge_resync'),
    onRequest: (cb) => {
      // No native thread in a browser: poll like the desktop watcher does (250 ms).
      const seen = new Set<string>();
      let busy = false;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        void (async () => {
          try {
            const entries = await call<DirEntry[]>('list', { path: 'requests' });
            const names = new Set(entries.map((e) => e.name));
            for (const n of seen) if (!names.has(n)) seen.delete(n);
            for (const e of entries) {
              if (e.isDir || !REQUEST_NAME.test(e.name) || seen.has(e.name) || e.size > 256 * 1024)
                continue;
              seen.add(e.name);
              const content = await call<string | null>('read', { path: `requests/${e.name}` });
              if (content !== null) cb({ name: e.name, content });
            }
          } catch {
            /* the dev server restarted; try again next tick */
          } finally {
            busy = false;
          }
        })();
      }, 250);
      return () => clearInterval(timer);
    },
    onCloseRequested: (cb) => {
      window.addEventListener('pagehide', cb);
      return () => window.removeEventListener('pagehide', cb);
    },
    quit: () => Promise.resolve(),
  };
}

// ---------------------------------------------------------------------------

let current: Promise<HomeApi> | null = null;

/** The file adapter for this runtime, created once. */
export function getFs(): Promise<HomeApi> {
  current ??=
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
      ? createTauriFs()
      : Promise.resolve(createDevFs());
  return current;
}

/** Tests and the e2e harness swap the adapter. */
export function setFsForTests(api: HomeApi | null): void {
  current = api ? Promise.resolve(api) : null;
}
