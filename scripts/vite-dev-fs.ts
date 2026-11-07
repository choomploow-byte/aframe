/**
 * Dev-only file adapter: the same operations as the Tauri commands, over HTTP, so the whole app
 * (projects, autosave, sync with files other processes change) runs in a normal browser during
 * `vite dev` and in the browser tests. The logic is `mcp/home-fs.ts`, shared with the MCP server,
 * so it cannot drift from what the desktop app does.
 *
 * Not part of any build: `apply: 'serve'`. Default home is `~/.atelier-dev`, never the real one.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import { BRAND } from '../src/brand';
import { FsError } from '../src/platform/fs-types';
import { ensureLayout, HomeFs, resolveHomeDir } from '../mcp/home-fs';

const MAX_BODY = 64 * 1024 * 1024;
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Only the dev server's own page may call the adapter (a custom header forces a CORS preflight,
 * which this plugin never approves, so other websites cannot reach it). */
function allowed(req: IncomingMessage): boolean {
  if (req.method !== 'POST') return false;
  if (req.headers['x-atelier-dev'] !== '1') return false;
  const host = String(req.headers.host ?? '');
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(origin))
    return false;
  return true;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new FsError('IO', 'request too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string') throw new FsError('IO', `${name} must be a string`);
  return v;
};

export function atelierDevFs(): Plugin {
  const root = resolveHomeDir(process.env, path.join(os.homedir(), `${BRAND.homeDirName}-dev`));
  const home = new HomeFs(root);
  let ready: Promise<void> | null = null;
  let snapshot = { currentProject: null as string | null, selection: [] as string[] };
  let lastStateWrite = 0;

  const writeState = async (): Promise<void> => {
    const body = {
      appHeartbeat: new Date().toISOString(),
      appPid: process.pid,
      appVersion: 'dev',
      currentProject: snapshot.currentProject,
      selection: snapshot.selection,
    };
    await home.write('app-state.json', JSON.stringify(body));
    lastStateWrite = Date.now();
  };

  const handle = async (op: string, body: Record<string, unknown>): Promise<unknown> => {
    ready ??= ensureLayout(home);
    await ready;
    switch (op) {
      case 'home':
        return home.root;
      case 'read':
        return home.read(str(body.path, 'path'));
      case 'read_head':
        return home.readHead(str(body.path, 'path'), Number(body.max ?? 4096));
      case 'write':
        return home.write(str(body.path, 'path'), str(body.content, 'content'));
      case 'write_doc': {
        const expect = body.expectRev;
        return home.writeDoc(
          str(body.path, 'path'),
          str(body.content, 'content'),
          typeof expect === 'number' ? expect : null,
        );
      }
      case 'list':
        return home.list(str(body.path, 'path'));
      case 'remove':
        return home.remove(str(body.path, 'path'));
      case 'stat':
        return home.stat(str(body.path, 'path'));
      case 'app_state_set': {
        const project = typeof body.currentProject === 'string' ? body.currentProject : null;
        const selection = Array.isArray(body.selection) ? body.selection : [];
        snapshot = {
          currentProject: project !== null && VALID_ID.test(project) ? project : null,
          selection: selection
            .filter((s): s is string => typeof s === 'string' && VALID_ID.test(s))
            .slice(0, 500),
        };
        // The page calls this every couple of seconds while it is open: that is the dev heartbeat.
        if (Date.now() - lastStateWrite >= 200) await writeState();
        return null;
      }
      case 'bridge_resync':
      case 'app_quit':
        return null;
      default:
        throw new FsError('IO', `unknown operation ${op}`);
    }
  };

  return {
    name: 'atelier-dev-fs',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fs', (req: IncomingMessage, res: ServerResponse) => {
        const send = (status: number, payload: unknown): void => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };
        if (!allowed(req)) return send(403, { error: { code: 'IO', message: 'forbidden' } });
        const op = (req.url ?? '').replace(/^\//, '').split('?')[0] ?? '';
        readJson(req)
          .then((body) => handle(op, body))
          .then((result) => send(200, { result: result ?? null }))
          .catch((e: unknown) => {
            const code = e instanceof FsError ? e.code : 'IO';
            send(400, { error: { code, message: e instanceof Error ? e.message : String(e) } });
          });
      });
    },
  };
}
