// A stand-in for the AFrame app, for the MCP integration tests: keeps app-state.json's heartbeat
// fresh and answers bridge requests the way the real app does (docs/06), so the server's screenshot
// and live-selection paths can be tested without a window.
import { PNG } from 'pngjs';
import type { HomeFs } from '../../mcp/home-fs';

export interface FakeApp {
  stop(): Promise<void>;
  /** Requests received, in order. */
  seen: { type: string; params: Record<string, unknown>; project?: string }[];
  setSelection(ids: string[]): Promise<void>;
  setProject(id: string | null): Promise<void>;
  /** Stop answering (the server must time out) while the heartbeat continues. */
  mute(on: boolean): void;
}

export function noisePng(w = 8, h = 6): string {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = (i * 7) % 256;
    png.data[i + 1] = 120;
    png.data[i + 2] = 200;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

export async function startFakeApp(home: HomeFs, project: string | null): Promise<FakeApp> {
  let selection: string[] = [];
  let current = project;
  let muted = false;
  const seen: FakeApp['seen'] = [];
  const handled = new Set<string>();

  const beat = async (): Promise<void> => {
    await home.write(
      'app-state.json',
      JSON.stringify({
        appHeartbeat: new Date().toISOString(),
        appPid: process.pid,
        appVersion: 'test',
        currentProject: current,
        selection,
      }),
    );
  };
  await beat();

  const respond = async (id: string, body: Record<string, unknown>): Promise<void> => {
    await home.write(
      `responses/${id}.json`,
      JSON.stringify({ id, completedAt: new Date().toISOString(), ...body }),
    );
  };

  const tick = async (): Promise<void> => {
    await beat();
    if (muted) return;
    for (const e of await home.list('requests')) {
      if (!/^req_[A-Za-z0-9]+\.json$/.test(e.name) || handled.has(e.name)) continue;
      handled.add(e.name);
      const text = await home.read(`requests/${e.name}`);
      if (text === null) continue;
      const req = JSON.parse(text) as {
        id: string;
        type: string;
        params?: Record<string, unknown>;
        project?: string;
      };
      seen.push({
        type: req.type,
        params: req.params ?? {},
        ...(req.project === undefined ? {} : { project: req.project }),
      });
      if (req.project && current && req.project !== current && req.type !== 'open_project') {
        await respond(req.id, {
          ok: false,
          error: { code: 'PROJECT_NOT_OPEN', message: 'Another project is open in the app.' },
        });
      } else if (req.type === 'screenshot') {
        await respond(req.id, { ok: true, result: { pngBase64: noisePng(), width: 8, height: 6 } });
      } else if (req.type === 'export_image') {
        const svg = req.params?.format === 'svg';
        await respond(req.id, {
          ok: true,
          result: {
            dataBase64: svg
              ? Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')
              : noisePng(),
            mime: svg ? 'image/svg+xml' : 'image/png',
            width: 8,
            height: 6,
          },
        });
      } else if (req.type === 'get_node_bounds') {
        await respond(req.id, {
          ok: true,
          result: { bounds: { x: 1, y: 2, width: 30, height: 40 } },
        });
      } else if (req.type === 'open_project') {
        const target = req.params?.project;
        current = typeof target === 'string' ? target : current;
        await respond(req.id, { ok: true, result: { project: current } });
      } else {
        await respond(req.id, {
          ok: false,
          error: { code: 'NOT_IMPLEMENTED', message: `${req.type} is not available yet` },
        });
      }
    }
  };
  const timer = setInterval(() => void tick().catch(() => undefined), 80);

  return {
    seen,
    mute: (on) => void (muted = on),
    setSelection: async (ids) => {
      selection = ids;
      await beat();
    },
    setProject: async (id) => {
      current = id;
      await beat();
    },
    stop: () => {
      clearInterval(timer);
      return Promise.resolve();
    },
  };
}
