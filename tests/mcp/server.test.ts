// Integration test: the built MCP bundle, driven by the real SDK client over stdio, against a
// throwaway ATELIER_HOME and a fake app. Covers the tool surface, atomicity, the app bridge,
// confinement of file reads, concurrent writers, and stdout hygiene.
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HomeFs } from '../../mcp/home-fs';
import { PNG } from 'pngjs';
import { noisePng, startFakeApp, type FakeApp } from './fake-app';

const BUNDLE = fileURLToPath(new URL('../../mcp/dist/atelier-mcp.mjs', import.meta.url));

let dir: string;
let homeDir: string;
let home: HomeFs;
const clients: Client[] = [];

async function connect(env: Record<string, string> = {}): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE],
    env: { ...process.env, ATELIER_HOME: homeDir, ...env },
    stderr: 'pipe',
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

type Result = {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  isError?: boolean;
};
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as Result;
  const text = r.content.find((c) => c.type === 'text')?.text ?? '';
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text) as Record<string, any>;
  } catch {
    /* an SDK validation message, not JSON */
  }
  return { ...r, text, json, images: r.content.filter((c) => c.type === 'image') };
}
const ok = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = await call(client, name, args);
  if (r.isError) throw new Error(`${name} failed: ${r.text}`);
  return r;
};

beforeAll(async () => {
  await fs.access(BUNDLE);
});
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atelier-mcp-'));
  homeDir = path.join(dir, 'home');
  home = new HomeFs(homeDir);
  await home.ensure();
});
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined);
  await fs.rm(dir, { recursive: true, force: true });
});
afterAll(() => undefined);

describe('the protocol surface', () => {
  it('initialises, sends instructions, and lists every tool with a schema that has `project`', async () => {
    const c = await connect();
    expect(c.getServerVersion()).toMatchObject({ name: 'atelier' });
    const instructions = c.getInstructions() ?? '';
    expect(instructions).toContain('get_design');
    expect(instructions).toContain('screenshot');
    expect(instructions.split(/\s+/).length).toBeLessThan(420);

    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'add_annotation',
        'add_reference',
        'apply_changes',
        'create_project',
        'export_code',
        'export_image',
        'get_annotations',
        'get_design',
        'get_node',
        'get_reference',
        'get_selection',
        'get_tokens',
        'import_image',
        'lint_design',
        'list_projects',
        'list_references',
        'list_skills',
        'load_skill',
        'open_project',
        'resolve_annotation',
        'screenshot',
        'set_tokens',
      ].sort(),
    );
    for (const t of tools) {
      expect((t.inputSchema as { properties?: Record<string, unknown> }).properties).toHaveProperty(
        'project',
      );
      expect(t.description?.length ?? 0).toBeGreaterThan(30);
    }
    const shot = tools.find((t) => t.name === 'screenshot');
    expect(shot?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'apply_changes')?.annotations?.readOnlyHint).toBe(false);
  });

  it('serves skills and prompts, and the skills are the real ones', async () => {
    const c = await connect();
    const skills = (await ok(c, 'list_skills')).json.skills as { name: string }[];
    expect(skills.map((s) => s.name)).toEqual(
      expect.arrayContaining(['design-fundamentals', 'typography', 'color']),
    );
    const fundamentals = await ok(c, 'load_skill', { name: 'design-fundamentals' });
    expect(fundamentals.json.markdown).toContain('design-fundamentals');
    const missing = await call(c, 'load_skill', { name: 'nope' });
    expect(missing.isError).toBe(true);
    expect(missing.json).toMatchObject({
      code: 'NOT_FOUND',
      hint: expect.stringContaining('design-fundamentals'),
    });

    const prompts = await c.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toEqual(
      expect.arrayContaining(['improve-design', 'match-reference', 'critique']),
    );
    const p = await c.getPrompt({ name: 'improve-design' });
    expect(JSON.stringify(p.messages)).toContain('get_design');

    const resources = await c.listResources();
    expect(resources.resources.some((r) => r.uri === 'atelier://skills/typography')).toBe(true);
    const read = await c.readResource({ uri: 'atelier://skills/typography' });
    expect(JSON.stringify(read.contents)).toContain('Typography'.slice(0, 4));
  });

  it('never writes anything but protocol messages to stdout', async () => {
    const child = spawn(process.execPath, [BUNDLE], {
      env: { ...process.env, ATELIER_HOME: homeDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } })}\n`,
    );
    await new Promise((r) => setTimeout(r, 1500));
    child.stdin.end();
    await new Promise((r) => child.once('exit', r));
    const lines = out.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines)
      expect(() => JSON.parse(line), `stdout line: ${line.slice(0, 80)}`).not.toThrow();
    expect(err).toContain('atelier-mcp');
  });
});

describe('projects', () => {
  it('create, list, open, and address projects by id or name; the default is the newest', async () => {
    const c = await connect();
    expect((await call(c, 'get_design')).json).toMatchObject({
      code: 'NOT_FOUND',
      hint: expect.stringContaining('create_project'),
    });

    const a = (await ok(c, 'create_project', { name: 'Landing One', template: 'landing' })).json
      .project;
    await new Promise((r) => setTimeout(r, 30));
    const b = (await ok(c, 'create_project', { name: 'Scratch' })).json.project;
    expect(a.frames).toBe(1);
    expect(b.frames).toBe(0);

    const list = (await ok(c, 'list_projects')).json.projects as { id: string; name: string }[];
    expect(list.map((p) => p.name)).toEqual(['Scratch', 'Landing One']);

    expect((await ok(c, 'get_design')).json.name).toBe('Scratch'); // newest by default
    expect((await ok(c, 'get_design', { project: 'Landing One' })).json.name).toBe('Landing One');
    expect((await ok(c, 'get_design', { project: a.id })).json.name).toBe('Landing One');
    expect((await ok(c, 'get_design', { project: 'land' })).json.name).toBe('Landing One'); // unique prefix
    const unknown = await call(c, 'get_design', { project: 'Nope' });
    expect(unknown.json).toMatchObject({
      code: 'NOT_FOUND',
      hint: expect.stringContaining('Scratch'),
    });

    await ok(c, 'open_project', { project: 'Landing One' });
    expect((await ok(c, 'get_design')).json.name).toBe('Landing One'); // now the session's current project
  });

  it('refuses a bad template and a missing project with actionable messages', async () => {
    const c = await connect();
    expect((await call(c, 'create_project', { name: 'x', template: 'spaceship' })).isError).toBe(
      true,
    );
    await ok(c, 'create_project', { name: 'x' });
    expect((await call(c, 'open_project', { project: 'zzz' })).json.code).toBe('NOT_FOUND');
  });
});

describe('editing', () => {
  async function setup() {
    const c = await connect();
    const p = (await ok(c, 'create_project', { name: 'Edit me' })).json.project;
    const page = (await ok(c, 'get_design')).json.root.id as string;
    return { c, p, page };
  }
  const file = (id: string) => path.join(homeDir, 'projects', id, 'project.atelier.json');

  it('builds a section with one nested batch, writes the file, and bumps rev as the agent', async () => {
    const { c, p, page } = await setup();
    const r = await ok(c, 'apply_changes', {
      label: 'Hero',
      operations: [
        {
          op: 'create',
          parentId: page,
          node: {
            type: 'frame',
            tempId: 'hero',
            name: 'Hero',
            w: 800,
            h: 'hug',
            layout: 'column',
            gap: 16,
            padding: [32, 32, 32, 32],
            fill: '$surface',
            children: [
              {
                type: 'text',
                name: 'Headline',
                text: 'Hello',
                fontSize: 40,
                fontFamily: '$font.heading',
                color: '$text',
              },
              {
                type: 'frame',
                name: 'Button',
                role: 'button',
                padding: [12, 24, 12, 24],
                fill: '$primary',
                radius: '$radius.md',
                children: [{ type: 'text', text: 'Go', color: '#ffffff' }],
              },
            ],
          },
        },
      ],
    });
    expect(r.json.created).toHaveLength(4);
    expect(r.json.rev).toBe(2);
    const onDisk = JSON.parse(await fs.readFile(file(p.id), 'utf8'));
    expect(onDisk.rev).toBe(2);
    expect(onDisk.meta.lastWriter).toBe('mcp');
    expect(Object.values<any>(onDisk.nodes).some((n) => n.name === 'Headline')).toBe(true);

    const outline = (await ok(c, 'get_design', { depth: 6 })).json;
    expect(JSON.stringify(outline)).toContain('Headline');
    const node = (await ok(c, 'get_node', { nodeId: r.json.created[0] })).json;
    expect(node.node.name).toBe('Hero');
    expect(node.boundsAvailable).toBe(true);
    expect(node.bounds).toBeNull(); // no app running
  });

  it('is atomic: a bad operation anywhere leaves the file untouched and names the failing op', async () => {
    const { c, p, page } = await setup();
    const before = await fs.readFile(file(p.id), 'utf8');
    const bad = await call(c, 'apply_changes', {
      operations: [
        { op: 'create', parentId: page, node: { type: 'frame', name: 'Fine' } },
        { op: 'create', parentId: page, node: { type: 'frame', name: 'Also fine' } },
        { op: 'update', id: 'n_doesnt', set: { x: 1 } },
      ],
    });
    expect(bad.isError).toBe(true);
    expect(bad.json).toMatchObject({ code: 'NOT_FOUND', op: 2 });
    expect(await fs.readFile(file(p.id), 'utf8')).toBe(before);
    const invalid = await call(c, 'apply_changes', {
      operations: [
        { op: 'create', parentId: page, node: { type: 'frame', fill: 'url(javascript:alert(1))' } },
      ],
    });
    expect(invalid.isError).toBe(true);
    expect(await fs.readFile(file(p.id), 'utf8')).toBe(before);
  });

  it('SDK-level validation turns malformed input into a readable error', async () => {
    const { c } = await setup();
    const r = await call(c, 'apply_changes', { operations: 'not a list' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('operations');
  });

  it('tokens, annotations and lint work end to end', async () => {
    const { c } = await setup();
    await ok(c, 'set_tokens', { colors: { brand: '#112233' }, radii: { pill: 99 } });
    expect((await ok(c, 'get_tokens')).json.colors.brand).toBe('#112233');

    const a = (await ok(c, 'add_annotation', { text: 'Why serif?', x: 10, y: 20 })).json.id;
    expect((await ok(c, 'get_annotations')).json.count).toBe(1);
    await ok(c, 'resolve_annotation', { id: a, reply: 'For warmth' });
    expect((await ok(c, 'get_annotations')).json.count).toBe(0);

    const page = (await ok(c, 'get_design')).json.root.id as string;
    await ok(c, 'apply_changes', {
      operations: [
        {
          op: 'create',
          parentId: page,
          node: {
            type: 'frame',
            name: 'Frame',
            w: 300,
            h: 200,
            layout: 'none',
            fill: '#ffffff',
            children: [{ type: 'text', text: 'pale', color: '#f0f0f0', fontSize: 9 }],
          },
        },
      ],
    });
    const lint = (await ok(c, 'lint_design')).json;
    const rules = (lint.findings as { rule: string }[]).map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(['contrast', 'text-size']));
    expect(lint.counts.error).toBeGreaterThan(0);
  });

  it('export tools are present but say they are not built yet', async () => {
    const { c } = await setup();
    const r = await call(c, 'export_code', {
      nodeId: 'n_x',
      framework: 'html',
      outDir: path.join(dir, 'out'),
    });
    expect(r.json).toMatchObject({ code: 'NOT_IMPLEMENTED' });
    await expect(fs.access(path.join(dir, 'out'))).rejects.toBeTruthy(); // nothing was written
  });

  it('two server processes editing the same project at once lose nothing', async () => {
    const { c, p, page } = await setup();
    const c2 = await connect();
    const add = (client: Client, tag: string, i: number) =>
      ok(client, 'apply_changes', {
        project: p.id,
        operations: [
          { op: 'create', parentId: page, node: { type: 'frame', name: `${tag}-${i}` } },
        ],
      });
    const jobs: Promise<unknown>[] = [];
    for (let i = 0; i < 12; i++) jobs.push(add(c, 'a', i), add(c2, 'b', i));
    await Promise.all(jobs);
    const doc = JSON.parse(await fs.readFile(file(p.id), 'utf8'));
    const names = Object.values<any>(doc.nodes).map((n) => n.name);
    for (const tag of ['a', 'b'])
      for (let i = 0; i < 12; i++) expect(names, `${tag}-${i}`).toContain(`${tag}-${i}`);
    expect(doc.rev).toBe(1 + 24);
  }, 120_000);
});

describe('the app bridge', () => {
  let app: FakeApp | null = null;
  afterEach(async () => {
    await app?.stop();
    app = null;
  });

  it('screenshot without the app is a clear, actionable error (and other tools still work)', async () => {
    const c = await connect();
    await ok(c, 'create_project', { name: 'No app' });
    const r = await call(c, 'screenshot');
    expect(r.isError).toBe(true);
    expect(r.json).toMatchObject({
      code: 'APP_NOT_RUNNING',
      hint: expect.stringContaining('open Atelier'),
    });
    expect((await ok(c, 'get_design')).json.name).toBe('No app');
    expect((await ok(c, 'get_selection')).json).toMatchObject({ appOnline: false, ids: [] });
  });

  it('a stale heartbeat counts as not running', async () => {
    const c = await connect();
    await ok(c, 'create_project', { name: 'x' });
    await home.write(
      'app-state.json',
      JSON.stringify({
        appHeartbeat: new Date(Date.now() - 60_000).toISOString(),
        appPid: 1,
        appVersion: 't',
        currentProject: null,
        selection: [],
      }),
    );
    expect((await call(c, 'screenshot')).json.code).toBe('APP_NOT_RUNNING');
  });

  it('screenshot returns the PNG as an image, with size and a saved file for hosts that cannot show images', async () => {
    const c = await connect();
    const p = (await ok(c, 'create_project', { name: 'Shot', template: 'landing' })).json.project;
    app = await startFakeApp(home, p.id);
    const frame = (await ok(c, 'get_design')).json.root.children[0].id as string;
    const r = await ok(c, 'screenshot', {
      nodeId: frame,
      scale: 2,
      maxWidth: 1000,
      annotations: true,
    });
    expect(r.json).toMatchObject({ width: 8, height: 6 });
    expect(r.images).toHaveLength(1);
    expect(r.images[0]?.mimeType).toBe('image/png');
    expect(r.images[0]?.data).toBe(noisePng());
    const saved = String(r.json.path);
    expect(saved.startsWith(homeDir)).toBe(true);
    const png = PNG.sync.read(await fs.readFile(saved));
    expect([png.width, png.height]).toEqual([8, 6]);
    expect(app.seen.at(-1)).toMatchObject({
      type: 'screenshot',
      project: p.id,
      params: { nodeId: frame, scale: 2, maxWidth: 1000, annotations: true },
    });

    const pathOnly = await ok(c, 'screenshot', { returnImage: false });
    expect(pathOnly.images).toHaveLength(0);
    expect(pathOnly.json.path).toBeTruthy();
  });

  it('keeps only the newest 20 screenshot files', async () => {
    const c = await connect();
    const p = (await ok(c, 'create_project', { name: 'Many' })).json.project;
    app = await startFakeApp(home, p.id);
    for (let i = 0; i < 23; i++) await ok(c, 'screenshot', { returnImage: false });
    const files = (await home.list('exports/screenshots')).filter((e) => e.name.endsWith('.png'));
    expect(files.length).toBe(20);
  }, 120_000);

  it('times out clearly when the app is alive but silent, and cleans up its request', async () => {
    const c = await connect();
    const p = (await ok(c, 'create_project', { name: 'Slow' })).json.project;
    app = await startFakeApp(home, p.id);
    app.mute(true);
    const t0 = Date.now();
    const r = await call(c, 'screenshot');
    expect(r.json).toMatchObject({ code: 'TIMEOUT', hint: expect.stringContaining('window') });
    expect(Date.now() - t0).toBeGreaterThan(14_000);
    expect((await home.list('requests')).filter((e) => e.name.startsWith('req_'))).toHaveLength(0);
  }, 60_000);

  it('asking about a project the app does not have open says how to fix it', async () => {
    const c = await connect();
    const a = (await ok(c, 'create_project', { name: 'A' })).json.project;
    const b = (await ok(c, 'create_project', { name: 'B' })).json.project;
    app = await startFakeApp(home, a.id);
    const r = await call(c, 'screenshot', { project: b.id });
    expect(r.json).toMatchObject({
      code: 'NOT_FOUND',
      hint: expect.stringContaining('open_project'),
    });
  });

  it('get_selection and get_node bounds come from the live app', async () => {
    const c = await connect();
    const p = (await ok(c, 'create_project', { name: 'Sel', template: 'landing' })).json.project;
    app = await startFakeApp(home, p.id);
    const frameId = (await ok(c, 'get_design')).json.root.children[0].id as string;
    await app.setSelection([frameId, 'n_ghost']);
    const sel = (await ok(c, 'get_selection')).json;
    expect(sel).toMatchObject({ appOnline: true, ids: [frameId] });
    expect(sel.nodes[0].id).toBe(frameId);
    const node = (await ok(c, 'get_node', { nodeId: frameId })).json;
    expect(node.bounds).toEqual({ x: 1, y: 2, width: 30, height: 40 });
    // The selection belongs to the project the app has open; another project sees none of it.
    const other = (await ok(c, 'create_project', { name: 'Other' })).json.project;
    expect((await ok(c, 'get_selection', { project: other.id })).json.ids).toEqual([]);
  });

  it('open_project switches the running app too', async () => {
    const c = await connect();
    const a = (await ok(c, 'create_project', { name: 'A' })).json.project;
    const b = (await ok(c, 'create_project', { name: 'B' })).json.project;
    app = await startFakeApp(home, a.id);
    await ok(c, 'open_project', { project: b.id });
    expect(app.seen.some((s) => s.type === 'open_project' && s.params.project === b.id)).toBe(true);
    // The app publishes its new project on its next heartbeat.
    let published = '';
    for (let i = 0; i < 30 && published !== b.id; i++) {
      published = JSON.parse((await home.read('app-state.json')) ?? '{}').currentProject;
      if (published !== b.id) await new Promise((r) => setTimeout(r, 100));
    }
    expect(published).toBe(b.id);
  });

  it('an app that is open on a project makes it the default for tools', async () => {
    const c = await connect();
    const a = (await ok(c, 'create_project', { name: 'First' })).json.project;
    await new Promise((r) => setTimeout(r, 30));
    await ok(c, 'create_project', { name: 'Newest' });
    app = await startFakeApp(home, a.id);
    expect((await ok(c, 'get_design')).json.name).toBe('First');
  });
});

describe('file reads are confined (docs/18)', () => {
  const imageDir = () => path.join(dir, 'pics');
  async function png(name: string, where = imageDir()): Promise<string> {
    await fs.mkdir(where, { recursive: true });
    const file = path.join(where, name);
    await fs.writeFile(file, Buffer.from(noisePng(4, 4), 'base64'));
    return file;
  }
  async function project(c: Client) {
    return (await ok(c, 'create_project', { name: 'Files' })).json.project as { id: string };
  }

  it('imports a real image as a node and as a reference, and the app can use both', async () => {
    const c = await connect();
    await project(c);
    const file = await png('logo.png');
    const r = await ok(c, 'import_image', { path: file, name: 'Logo' });
    expect(r.json.nodeId).toBeTruthy();
    const ref = await ok(c, 'add_reference', {
      path: file,
      name: 'Mood',
      note: 'colours only',
      scope: 'style',
    });
    expect(ref.json.referenceId).toBeTruthy();
    const got = await ok(c, 'get_reference', { id: ref.json.referenceId });
    expect(got.images[0]?.mimeType).toBe('image/png');
    expect((await ok(c, 'list_references')).json.references[0]).toMatchObject({
      name: 'Mood',
      note: 'colours only',
    });
  });

  it('refuses relative paths, traversal, directories, non-images, disguised files and missing files', async () => {
    const c = await connect();
    await project(c);
    await png('ok.png');
    const refuse = async (p: string, code: string) => {
      const r = await call(c, 'import_image', { path: p });
      expect(r.isError, p).toBe(true);
      expect(r.json.code, `${p}: ${r.text}`).toBe(code);
    };
    await refuse('pics/ok.png', 'PATH_NOT_ALLOWED');
    await refuse(
      `${imageDir()}${path.sep}..${path.sep}..${path.sep}etc${path.sep}passwd`,
      'NOT_FOUND',
    );
    await refuse(imageDir(), 'PATH_NOT_ALLOWED'); // a directory
    const text = path.join(imageDir(), 'notes.txt');
    await fs.writeFile(text, 'hello');
    await refuse(text, 'PATH_NOT_ALLOWED');
    const disguised = path.join(imageDir(), 'evil.png');
    await fs.writeFile(disguised, 'MZ this is a program, not a picture');
    await refuse(disguised, 'INVALID_VALUE');
    await refuse(path.join(imageDir(), 'missing.png'), 'NOT_FOUND');
  });

  it('refuses hidden and credential folders even for real images', async () => {
    const c = await connect();
    await project(c);
    for (const bad of ['.ssh', '.aws', '.hidden-stuff']) {
      const file = await png('secret.png', path.join(dir, bad));
      const r = await call(c, 'import_image', { path: file });
      expect(r.json.code, bad).toBe('PATH_NOT_ALLOWED');
    }
  });

  it('follows no symlink out of a good folder into a bad one', async () => {
    const c = await connect();
    await project(c);
    const secret = await png('inside.png', path.join(dir, '.ssh'));
    const link = path.join(imageDir(), 'innocent.png');
    await fs.mkdir(imageDir(), { recursive: true });
    try {
      await fs.symlink(secret, link, 'file');
    } catch {
      return; // symlinks are not allowed for this account
    }
    expect((await call(c, 'import_image', { path: link })).json.code).toBe('PATH_NOT_ALLOWED');
  });

  it('rejects files over the size cap before reading them', async () => {
    const c = await connect();
    await project(c);
    const big = path.join(imageDir(), 'huge.png');
    await fs.mkdir(imageDir(), { recursive: true });
    const fh = await fs.open(big, 'w');
    await fh.truncate(21 * 1024 * 1024);
    await fh.close();
    expect((await call(c, 'import_image', { path: big })).json.code).toBe('LIMIT_EXCEEDED');
  });

  it('images stored in the project are data, and an SVG with a script is just an image asset', async () => {
    const c = await connect();
    const p = await project(c);
    const svg = path.join(imageDir(), 'x.svg');
    await fs.mkdir(imageDir(), { recursive: true });
    await fs.writeFile(
      svg,
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>1</script></svg>',
    );
    const r = await ok(c, 'import_image', { path: svg });
    expect(r.json.nodeId).toBeTruthy();
    const doc = JSON.parse(
      await fs.readFile(path.join(homeDir, 'projects', p.id, 'project.atelier.json'), 'utf8'),
    );
    expect(Object.values<string>(doc.assets)[0]).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe('presence', () => {
  it('writes agents/<pid>.json on connect, touches it on each call, and removes it on exit', async () => {
    const c = await connect();
    await ok(c, 'create_project', { name: 'P' });
    const files = (await home.list('agents')).filter((e) => e.name.endsWith('.json'));
    expect(files).toHaveLength(1);
    const first = JSON.parse((await home.read(`agents/${files[0]?.name}`)) ?? '{}');
    expect(first).toMatchObject({ version: '0.1.0' });
    await new Promise((r) => setTimeout(r, 1100));
    await ok(c, 'get_design');
    await new Promise((r) => setTimeout(r, 200));
    const second = JSON.parse((await home.read(`agents/${files[0]?.name}`)) ?? '{}');
    expect(Date.parse(second.lastAgentSeen)).toBeGreaterThan(Date.parse(first.lastAgentSeen));
    await c.close();
    clients.length = 0;
    await new Promise((r) => setTimeout(r, 800));
    expect((await home.list('agents')).filter((e) => e.name.endsWith('.json'))).toHaveLength(0);
  }, 30_000);
});
