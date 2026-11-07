/**
 * A `HomeApi` (what the webview's project code talks to) backed by the Node file module. The MCP
 * server uses it to reuse `src/projects/projects.ts` (list, open, create, rename) unchanged, so the
 * app and the server cannot disagree about what a project is or how it is read and written.
 */
import type { HomeApi } from '../src/platform/fs';
import type { HomeFs } from './home-fs';

export function homeApiFromHomeFs(home: HomeFs): HomeApi {
  const none = (): void => undefined;
  return {
    kind: 'test',
    home: () => Promise.resolve(home.root),
    readText: (p) => home.read(p),
    readHead: (p, max) => home.readHead(p, max),
    writeText: (p, c) => home.write(p, c),
    writeDoc: (p, c, e) => home.writeDoc(p, c, e),
    list: (p) => home.list(p),
    remove: (p) => home.remove(p),
    stat: (p) => home.stat(p),
    // Only the app reports state, requests and closing; a server has nothing to say here.
    reportAppState: () => Promise.resolve(),
    bridgeResync: () => Promise.resolve(),
    onRequest: () => none,
    onCloseRequested: () => none,
    quit: () => Promise.resolve(),
  };
}
