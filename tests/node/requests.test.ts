import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BridgeService,
  parseRequest,
  REQUEST_TYPES,
  RequestError,
  type BridgeHandlers,
} from '../../src/sync/requests';
import { createTestAdapter, type TestAdapter } from './helpers/node-adapter';

let dir: string;
let fsx: TestAdapter;
let order: string[];
let opened: string[];
let handlers: BridgeHandlers;
let bridge: BridgeService;

const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const req = (
  id: string,
  extra: Record<string, unknown> = {},
): { name: string; content: string } => ({
  name: `${id}.json`,
  content: JSON.stringify({ id, createdAt: new Date(NOW).toISOString(), ...extra }),
});
const response = async (id: string): Promise<Record<string, unknown> | null> => {
  const text = await fsx.readText(`responses/${id}.json`);
  return text === null ? null : (JSON.parse(text) as Record<string, unknown>);
};
const send = async (file: { name: string; content: string }): Promise<void> => {
  await fsx.writeText(`requests/${file.name}`, file.content);
  await bridge.handle(file.name, file.content);
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-bridge-'));
  fsx = createTestAdapter(path.join(dir, 'home'));
  await fsx.home_.ensure();
  order = [];
  opened = [];
  handlers = {
    flush: () => {
      order.push('flush');
      return Promise.resolve();
    },
    currentProject: () => 'p_open1',
    selection: () => ['n_a1b2c3'],
    openProject: (id) => {
      opened.push(id);
      return Promise.resolve(id === 'p_missing' ? `Project ${id} does not exist.` : null);
    },
  };
  bridge = new BridgeService(fsx, handlers, () => NOW);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('requests', () => {
  it('answers ping and removes the request file', async () => {
    await send(req('req_ping1', { type: 'ping' }));
    expect(await response('req_ping1')).toMatchObject({
      id: 'req_ping1',
      ok: true,
      result: { pong: true, project: 'p_open1' },
    });
    expect(await fsx.stat('requests/req_ping1.json')).toBeNull();
  });

  it('saves pending edits before answering (an agent must see what the user just did)', async () => {
    await send(req('req_sel01', { type: 'get_selection' }));
    expect(order).toEqual(['flush']);
    expect(await response('req_sel01')).toMatchObject({
      ok: true,
      result: { selection: ['n_a1b2c3'] },
    });
  });

  it('handles each request once, even if the file is announced twice', async () => {
    const file = req('req_twice', { type: 'ping' });
    await send(file);
    await send(file);
    expect(order).toEqual(['flush']);
  });

  it('switches project on request, and reports a missing one', async () => {
    await send(req('req_open1', { type: 'open_project', params: { project: 'p_abc12' } }));
    expect(opened).toEqual(['p_abc12']);
    expect(await response('req_open1')).toMatchObject({ ok: true, result: { project: 'p_abc12' } });
    await send(req('req_open2', { type: 'open_project', params: { project: 'p_missing' } }));
    expect(await response('req_open2')).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });

  it('never trusts params: a project that is not an id is rejected before anything runs', async () => {
    for (const [n, project] of [
      ['req_bad01', '../../etc'],
      ['req_bad02', 42],
      ['req_bad03', undefined],
    ] as const) {
      await send(req(n, { type: 'open_project', params: { project } }));
      expect(await response(n)).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    }
    expect(opened).toEqual([]);
  });

  it('unknown types are refused; planned types say they are not built yet', async () => {
    await send(req('req_unk01', { type: 'rm -rf /' }));
    expect(await response('req_unk01')).toMatchObject({
      ok: false,
      error: { code: 'UNKNOWN_TYPE' },
    });
    await send(req('req_shot1', { type: 'screenshot', params: { nodeId: 'n_x' } }));
    expect(await response('req_shot1')).toMatchObject({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });
    expect(REQUEST_TYPES).toContain('screenshot');
  });

  it('malformed requests get a clear error when the id can be trusted, and are dropped when not', async () => {
    await send({ name: 'req_junk1.json', content: '{ not json' });
    expect(await response('req_junk1')).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
    await send({
      name: 'req_mism1.json',
      content: JSON.stringify({ id: 'req_other', type: 'ping' }),
    });
    expect(await response('req_mism1')).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
    expect(await response('req_other')).toBeNull();
    await send({ name: 'not-a-request.json', content: '{}' });
    expect(await fsx.stat('responses/not-a-request.json')).toBeNull();
    expect(await fsx.stat('requests/req_junk1.json')).toBeNull();
  });

  it('stale requests are discarded without an answer', async () => {
    const old = {
      name: 'req_old01.json',
      content: JSON.stringify({
        id: 'req_old01',
        type: 'ping',
        createdAt: new Date(NOW - 5 * 60_000).toISOString(),
      }),
    };
    await send(old);
    expect(await response('req_old01')).toBeNull();
    expect(await fsx.stat('requests/req_old01.json')).toBeNull();
  });

  it('a failing handler becomes an error response, not a hang', async () => {
    handlers.flush = () => Promise.reject(new Error('disk on fire'));
    await send(req('req_fail1', { type: 'ping' }));
    expect(await response('req_fail1')).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL', message: 'disk on fire' },
    });
  });

  it('receives requests through the adapter once started, and stops when asked', async () => {
    const stop = bridge.start();
    fsx.emitRequest(req('req_live1', { type: 'ping' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(await response('req_live1')).toMatchObject({ ok: true });
    stop();
    fsx.emitRequest(req('req_live2', { type: 'ping' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(await response('req_live2')).toBeNull();
  });
});

describe('screenshots and bounds', () => {
  it('answers a screenshot with the PNG the handler produced, after saving', async () => {
    handlers.screenshot = (params) => {
      order.push(`shot ${JSON.stringify(params)}`);
      return Promise.resolve({ pngBase64: 'AAAA', width: 10, height: 20 });
    };
    await send(
      req('req_shot2', {
        type: 'screenshot',
        project: 'p_open1',
        params: { nodeId: 'n_a', scale: 2 },
      }),
    );
    expect(order).toEqual(['flush', 'shot {"nodeId":"n_a","scale":2}']);
    expect(await response('req_shot2')).toMatchObject({
      ok: true,
      result: { pngBase64: 'AAAA', width: 10, height: 20 },
    });
  });

  it('refuses a request for a project that is not the open one', async () => {
    handlers.screenshot = () => Promise.reject(new Error('must not run'));
    await send(req('req_wrong', { type: 'screenshot', project: 'p_other9' }));
    expect(await response('req_wrong')).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_OPEN' },
    });
    await send(req('req_wsel1', { type: 'get_selection', project: 'p_other9' }));
    expect(await response('req_wsel1')).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_OPEN' },
    });
    // No project named: the open one is meant.
    handlers.screenshot = () => Promise.resolve({ pngBase64: 'B', width: 1, height: 1 });
    await send(req('req_nopro', { type: 'screenshot' }));
    expect(await response('req_nopro')).toMatchObject({ ok: true });
  });

  it('passes a handler’s own error code through (a node that is not drawn)', async () => {
    handlers.screenshot = () =>
      Promise.reject(new RequestError('NOT_FOUND', 'Node n_x is not drawn.'));
    await send(req('req_nf001', { type: 'screenshot', params: { nodeId: 'n_x' } }));
    expect(await response('req_nf001')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Node n_x is not drawn.' },
    });
  });

  it('get_node_bounds returns the rectangle, and refuses a missing or oversized id', async () => {
    handlers.nodeBounds = (id) =>
      Promise.resolve(id === 'n_a' ? { x: 1, y: 2, width: 3, height: 4 } : null);
    await send(req('req_bnd01', { type: 'get_node_bounds', params: { nodeId: 'n_a' } }));
    expect(await response('req_bnd01')).toMatchObject({
      ok: true,
      result: { bounds: { x: 1, y: 2, width: 3, height: 4 } },
    });
    await send(req('req_bnd02', { type: 'get_node_bounds', params: { nodeId: 'n_none' } }));
    expect(await response('req_bnd02')).toMatchObject({ ok: true, result: { bounds: null } });
    await send(req('req_bnd03', { type: 'get_node_bounds', params: { nodeId: 'x'.repeat(200) } }));
    expect(await response('req_bnd03')).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
    await send(req('req_bnd04', { type: 'get_node_bounds', params: {} }));
    expect(await response('req_bnd04')).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('export_image is still planned', async () => {
    await send(req('req_exp01', { type: 'export_image' }));
    expect(await response('req_exp01')).toMatchObject({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });
  });
});

describe('parseRequest', () => {
  it('requires the id inside to match the file name', () => {
    expect(parseRequest('req_a1.json', '{"id":"req_a1","type":"ping"}', NOW).ok).toBe(true);
    expect(parseRequest('req_a1.json', '{"id":"req_b2","type":"ping"}', NOW).ok).toBe(false);
    expect(parseRequest('req_a1.json', '[]', NOW).ok).toBe(false);
    expect(parseRequest('req_a1.json', '{"id":"req_a1","type":"ping","params":[]}', NOW).ok).toBe(
      false,
    );
  });
});
