// A HomeApi backed by the real Node file module (mcp/home-fs.ts) in a temp directory, so the sync
// and project tests run against the real write protocol (atomic rename, lock, compare-and-write).
import type { AppStateReport, BridgeRequestFile, HomeApi } from '../../../src/platform/fs';
import { HomeFs } from '../../../mcp/home-fs';

export interface TestAdapter extends HomeApi {
  readonly home_: HomeFs;
  /** Every call made, in order: "writeDoc projects/p_x/project.aframe.json". */
  readonly calls: string[];
  readonly reported: AppStateReport[];
  /** Make the next `n` writeDoc calls throw `error`. */
  failNextWrites(n: number, error: Error): void;
  emitRequest(req: BridgeRequestFile): void;
}

export function createTestAdapter(root: string): TestAdapter {
  const home = new HomeFs(root, { lockStaleMs: 300, lockWaitMs: 1500 });
  const calls: string[] = [];
  const reported: AppStateReport[] = [];
  const requestListeners = new Set<(r: BridgeRequestFile) => void>();
  let failures = 0;
  let failure: Error | null = null;
  const log = (name: string, path?: string): void =>
    void calls.push(path ? `${name} ${path}` : name);

  return {
    kind: 'test',
    home_: home,
    calls,
    reported,
    failNextWrites(n, error) {
      failures = n;
      failure = error;
    },
    emitRequest(req) {
      for (const l of requestListeners) l(req);
    },
    home: () => Promise.resolve(home.root),
    readText: (p) => (log('readText', p), home.read(p)),
    readHead: (p, max) => (log('readHead', p), home.readHead(p, max)),
    writeText: (p, c) => (log('writeText', p), home.write(p, c)),
    writeDoc: (p, c, e) => {
      log('writeDoc', p);
      if (failures > 0 && failure) {
        failures -= 1;
        return Promise.reject(failure);
      }
      return home.writeDoc(p, c, e);
    },
    list: (p) => (log('list', p), home.list(p)),
    remove: (p) => (log('remove', p), home.remove(p)),
    stat: (p) => home.stat(p),
    reportAppState: (s) => {
      reported.push({ currentProject: s.currentProject, selection: [...s.selection] });
      return Promise.resolve();
    },
    bridgeResync: () => Promise.resolve(),
    onRequest: (cb) => {
      requestListeners.add(cb);
      return () => requestListeners.delete(cb);
    },
    onCloseRequested: () => () => undefined,
    quit: () => Promise.resolve(),
  };
}
