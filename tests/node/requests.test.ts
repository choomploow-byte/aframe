import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BridgeService,
  parseRequest,
  REQUEST_TYPES,
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
