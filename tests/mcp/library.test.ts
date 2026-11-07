import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand } from '../../mcp/cli';
import { realEnv } from '../../mcp/install';
import { Library } from '../../mcp/library';

const BUNDLE = path.resolve(
  fileURLToPath(new URL('../../mcp/dist/atelier-mcp.mjs', import.meta.url)),
);

let dir: string;
let home: string;
let source: string;
const clients: Client[] = [];

function png(r: number, g: number, b: number, size = 8): Buffer {
  const img = new PNG({ width: size, height: size });
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  }
  return PNG.sync.write(img);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-lib-'));
  home = path.join(dir, 'home');
  source = path.join(dir, 'assets');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
  fs.writeFileSync(
    path.join(source, '0d81e230-4024-40fc-bedd-4b5f85586509_Mask_group_13.png'),
    png(255, 0, 0),
  );
  fs.writeFileSync(path.join(source, 'halftone.png'), png(0, 255, 0, 16));
  fs.writeFileSync(path.join(source, 'Halftone (1).png'), png(0, 255, 0, 16)); // the same picture again
  fs.writeFileSync(path.join(source, 'nested', 'sunburst1.png'), png(0, 0, 255));
  fs.writeFileSync(
    path.join(source, 'icon.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
  );
  fs.writeFileSync(path.join(source, 'notes.txt'), 'not an image');
  fs.writeFileSync(path.join(source, 'fake.png'), 'this is text pretending to be a png');
  fs.writeFileSync(path.join(source, '..%2f..%2fevil.png'), png(1, 2, 3));
});
afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Library.add', () => {
  it('copies images in by their bytes, names them safely, and reports what it did not add', () => {
    const lib = new Library(home);
    const report = lib.add(source);
    const ids = report.added.map((e) => e.id).sort();
    // a hostile-looking file name becomes a harmless slug (no dots, slashes or percent signs)
    expect(ids).toEqual(['2f-2fevil', 'halftone', 'icon', 'mask-group-13', 'sunburst1']);
    expect(report.duplicates).toHaveLength(1); // the second copy of the same picture
    expect(report.skipped.map((s) => s.file).sort()).toEqual(['fake.png', 'notes.txt']);

    // everything landed inside the library folder, under safe names
    const files = fs.readdirSync(lib.dir).sort();
    expect(files).toEqual(
      [
        '2f-2fevil.png',
        'halftone.png',
        'icon.svg',
        'index.json',
        'mask-group-13.png',
        'sunburst1.png',
      ].sort(),
    );
    expect(fs.existsSync(path.join(dir, 'evil.png'))).toBe(false);
    const mask = lib.list().find((e) => e.id === 'mask-group-13');
    expect(mask).toMatchObject({
      name: 'Mask group 13',
      category: 'shape',
      mime: 'image/png',
      width: 8,
      height: 8,
    });
    expect(lib.list().find((e) => e.id === 'icon')?.mime).toBe('image/svg+xml');
  });

  it('is safe to run again: nothing is added twice', () => {
    const lib = new Library(home);
    lib.add(source);
    const again = lib.add(source);
    expect(again.added).toEqual([]);
    expect(again.duplicates.length).toBeGreaterThanOrEqual(5);
    expect(lib.list()).toHaveLength(5);
  });

  it('numbers a clashing name, and refuses something that is not a folder', () => {
    const lib = new Library(home);
    lib.add(source);
    const second = path.join(dir, 'more');
    fs.mkdirSync(second);
    fs.writeFileSync(path.join(second, 'halftone.png'), png(9, 9, 9, 12)); // a different picture, same name
    const report = lib.add(second);
    expect(report.added.map((e) => e.id)).toEqual(['halftone-2']);
    expect(() => lib.add(path.join(source, 'halftone.png'))).toThrow(/not a folder/);
    expect(() => lib.add(path.join(dir, 'nowhere'))).toThrow(/not a folder/);
  });

  it('reads an asset by id only; an id that is not in the index reads nothing', () => {
    const lib = new Library(home);
    lib.add(source);
    expect(lib.read('halftone')?.bytes.length).toBeGreaterThan(50);
    expect(lib.read('../../index')).toBeNull();
    expect(lib.read('index.json')).toBeNull();
    // a tampered index cannot point outside the folder
    const index = JSON.parse(fs.readFileSync(path.join(lib.dir, 'index.json'), 'utf8')) as {
      id: string;
      file: string;
    }[];
    index.push({ ...(index[0] as object), id: 'bad', file: '../../secret.png' });
    fs.writeFileSync(path.join(lib.dir, 'index.json'), JSON.stringify(index));
    expect(lib.read('bad')).toBeNull();
    expect(lib.list().some((e) => e.id === 'bad')).toBe(false);
  });
});

describe('the library command', () => {
  it('adds and lists from the command line', () => {
    const out: string[] = [];
    const env = realEnv(BUNDLE, home);
    expect(runCommand(['library', 'add', source], env, { out: (l) => out.push(l) })).toBe(0);
    expect(out.join('\n')).toMatch(/added 5/);
    expect(out.join('\n')).toMatch(/skipped notes\.txt/);
    out.length = 0;
    expect(runCommand(['library', 'list'], env, { out: (l) => out.push(l) })).toBe(0);
    expect(out[0]).toMatch(/^5 assets/);
    expect(
      runCommand(['library', 'add', path.join(dir, 'nowhere')], env, { out: () => undefined }),
    ).toBe(1);
    expect(runCommand(['library'], env, { out: () => undefined })).toBe(2);
  });
});

describe('the library tools, through the built server', () => {
  async function connect(): Promise<Client> {
    const client = new Client({ name: 'lib-test', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [BUNDLE],
        env: { ...process.env, ATELIER_HOME: home },
        stderr: 'pipe',
      }),
    );
    clients.push(client);
    return client;
  }
  const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
    const r = (await c.callTool({ name, arguments: args })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = r.content.find((x) => x.type === 'text')?.text ?? '';
    let json: Record<string, any> = {};
    try {
      json = JSON.parse(text) as Record<string, any>;
    } catch {
      /* not JSON */
    }
    return { isError: r.isError === true, text, json };
  };

  it('searches, places an asset once however often it is used, and explains a wrong id', async () => {
    new Library(home).add(source);
    const c = await connect();
    const found = await call(c, 'search_library', { query: 'halftone' });
    expect(found.json.assets.map((a: { id: string }) => a.id)).toContain('halftone');
    expect(found.json.categories).toMatchObject({ halftone: 1, shape: 1, sunburst: 1 });
    const none = await call(c, 'search_library', { query: 'zebra' });
    expect(none.json.total).toBe(0);
    expect(none.json.hint).toMatch(/Nothing matches/);

    await call(c, 'create_project', { name: 'Lib project', template: 'blank' });
    const projects = (await call(c, 'list_projects')).json.projects as { id: string }[];
    await call(c, 'open_project', { project: projects[0]?.id });
    const frame = await call(c, 'apply_changes', {
      operations: [
        {
          op: 'create',
          parentId: (await call(c, 'get_design', { depth: 0 })).json.root.id,
          node: { type: 'frame', name: 'Card', w: 300, h: 200, x: 0, y: 0 },
        },
      ],
    });
    const parentId = frame.json.created[0] as string;

    const first = await call(c, 'use_library_asset', {
      id: 'halftone',
      parentId,
      w: 300,
      h: 200,
      opacity: 0.3,
    });
    expect(first.isError, first.text).toBe(false);
    expect(first.json.reusedAsset).toBe(false);
    const second = await call(c, 'use_library_asset', {
      id: 'halftone',
      parentId,
      name: 'Texture 2',
    });
    expect(second.json.reusedAsset).toBe(true);
    expect(second.json.assetId).toBe(first.json.assetId);

    const node = (await call(c, 'get_node', { nodeId: first.json.nodeId })).json.node;
    expect(node).toMatchObject({
      type: 'image',
      name: 'Halftone', // (the copy with a capital H was read first; both are the same picture)
      w: 300,
      h: 200,
      fit: 'fill',
      opacity: 0.3,
      assetId: first.json.assetId,
    });
    const doc = (await call(c, 'get_design', { depth: 0 })).json;
    expect(doc.counts.byType.image).toBe(2);

    const wrong = await call(c, 'use_library_asset', { id: 'half-tone' });
    expect(wrong.isError).toBe(true);
    expect(wrong.json.code).toBe('NOT_FOUND');
    expect(wrong.json.hint).toMatch(/halftone/);
    const traversal = await call(c, 'use_library_asset', { id: '../../etc/passwd' });
    expect(traversal.json.code).toBe('NOT_FOUND');
  }, 60_000);

  it('says the library is empty, and how to fill it', async () => {
    const c = await connect();
    const r = await call(c, 'search_library', {});
    expect(r.json.total).toBe(0);
    expect(r.json.hint).toMatch(/library add/);
  }, 30_000);
});
