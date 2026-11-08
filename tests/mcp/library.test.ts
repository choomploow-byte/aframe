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
import type { LibraryEntry } from '../../src/core/library';

const BUNDLE = path.resolve(
  fileURLToPath(new URL('../../mcp/dist/aframe-mcp.mjs', import.meta.url)),
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aframe-lib-'));
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

const svg = (w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}"/></svg>`;

function makePacks(): string {
  const root = path.join(dir, 'newassets');
  const put = (rel: string, data: Buffer | string): void => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  };
  // a Basic GUI bundle: every PNG has an SVG twin in an SVG folder
  put('Basic_GUI_Bundle/BoxesBanners/Box_Blue_Rounded.png', png(1, 1, 1, 9));
  put('Basic_GUI_Bundle/BoxesBanners/SVG/Box_Blue_Rounded.svg', svg(300, 200));
  put('Basic_GUI_Bundle/BoxesBanners/Banner_Red.png', png(2, 2, 2, 9));
  put('Basic_GUI_Bundle/BoxesBanners/SVG/Banner_Red.svg', svg(400, 100));
  put('Basic_GUI_Bundle/Sliders/SlimSlider_Green_Scoller.png', png(3, 3, 3, 9)); // no SVG twin
  put('Basic_GUI_Bundle/Sliders/.DS_Store', 'junk');
  // an icon pack five folders deep, with a small and a large size of each icon
  const pack = 'Free Icon Pack v3.1 (Basic)/Item/Axe';
  put(`${pack}/256px/Axe 1st 256px.png`, png(4, 4, 4, 128));
  put(`${pack}/64px/Axe 1st 64px.png`, png(5, 5, 5, 4));
  // a size folder with nothing bigger beside it stays
  put('Eggs Icon Pack v2 (Basic)/Dragon Egg/64w/Dragon Egg 64px.png', png(6, 6, 6, 4));
  return root;
}

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

describe('Library.add with icon packs', () => {
  it('prefers the SVG to its PNG twin and the largest size, and reads pack and group', () => {
    const lib = new Library(home);
    const report = lib.add(makePacks());
    expect(report.twins.sort()).toEqual([
      'Axe 1st 64px.png',
      'Banner_Red.png',
      'Box_Blue_Rounded.png',
    ]);
    expect(report.skipped).toEqual([]); // .DS_Store is ignored without a word
    expect(report.added.map((e) => e.id).sort()).toEqual([
      'axe-1st',
      'banner-red',
      'box-blue-rounded',
      'dragon-egg',
      'slim-slider-green-scroller',
    ]);

    const byId = (id: string) => lib.list().find((e) => e.id === id) as LibraryEntry;
    expect(byId('box-blue-rounded')).toMatchObject({
      mime: 'image/svg+xml',
      width: 300,
      height: 200,
      pack: 'Basic GUI',
      group: 'Boxes Banners',
      category: 'panel',
    });
    expect(byId('banner-red')).toMatchObject({ category: 'banner', width: 400, height: 100 });
    expect(byId('slim-slider-green-scroller')).toMatchObject({
      mime: 'image/png',
      pack: 'Basic GUI',
      group: 'Sliders',
      category: 'slider',
    });
    expect(byId('axe-1st')).toMatchObject({
      pack: 'Free Icon Pack',
      group: 'Item',
      category: 'item',
      width: 128,
    });
    expect(byId('axe-1st').tags).toEqual(expect.arrayContaining(['axe', 'item', 'free']));
    expect(byId('dragon-egg')).toMatchObject({
      pack: 'Eggs',
      group: 'Dragon Egg',
      category: 'egg',
    });

    // the folder holds only what was added, under safe names, plus the index
    expect(fs.readdirSync(lib.dir).sort()).toEqual(
      [
        'axe-1st.png',
        'banner-red.svg',
        'box-blue-rounded.svg',
        'dragon-egg.png',
        'index.json',
        'slim-slider-green-scroller.png',
      ].sort(),
    );
  });

  it('adds nothing twice when run again, and an old index without packs still loads', () => {
    const lib = new Library(home);
    const root = makePacks();
    lib.add(root);
    const again = lib.add(root);
    expect(again.added).toEqual([]);
    expect(lib.list()).toHaveLength(5);

    // an index written before packs existed
    const legacy = path.join(dir, 'old-home');
    fs.mkdirSync(path.join(legacy, 'library'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'library', 'halftone.png'), png(7, 7, 7));
    fs.writeFileSync(
      path.join(legacy, 'library', 'index.json'),
      JSON.stringify([
        {
          id: 'halftone',
          name: 'halftone',
          file: 'halftone.png',
          category: 'halftone',
          tags: ['halftone'],
          mime: 'image/png',
          width: 8,
          height: 8,
          bytes: 10,
          sha256: 'x',
        },
      ]),
    );
    const old = new Library(legacy);
    expect(old.list()).toHaveLength(1);
    expect(old.read('halftone')?.entry.pack).toBeUndefined();
  });

  it('adds a few thousand files quickly', () => {
    const big = path.join(dir, 'big');
    fs.mkdirSync(path.join(big, 'Pack', 'Group'), { recursive: true });
    for (let i = 0; i < 600; i += 1) {
      fs.writeFileSync(
        path.join(big, 'Pack', 'Group', `Icon ${i}.png`),
        png(i % 256, i >> 8, 9, 2 + (i % 5)),
      );
    }
    const started = Date.now();
    const report = new Library(home).add(big);
    expect(report.added.length + report.duplicates.length).toBe(600);
    expect(Date.now() - started).toBeLessThan(8000);
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
        env: { ...process.env, AFRAME_HOME: home },
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

  it('browses packs, filters by pack, and places parts with sensible fit and size', async () => {
    new Library(home).add(makePacks());
    const c = await connect();
    const all = await call(c, 'search_library', {});
    expect(all.json.categories).toMatchObject({ panel: 1, banner: 1, slider: 1, item: 1, egg: 1 });
    const gui = (
      all.json.packs as { pack: string; count: number; groups: Record<string, number> }[]
    ).find((p) => p.pack === 'Basic GUI');
    expect(gui).toMatchObject({ count: 3, groups: { 'Boxes Banners': 2, Sliders: 1 } });

    const onlyGui = await call(c, 'search_library', { pack: 'basic', group: 'sliders' });
    expect(onlyGui.json.assets.map((a: { id: string }) => a.id)).toEqual([
      'slim-slider-green-scroller',
    ]);
    const blue = await call(c, 'search_library', { query: 'blue box' });
    expect(blue.json.assets[0]).toMatchObject({
      id: 'box-blue-rounded',
      size: '300x200',
      pack: 'Basic GUI',
    });

    await call(c, 'create_project', { name: 'Parts', template: 'blank' });
    const projects = (await call(c, 'list_projects')).json.projects as { id: string }[];
    await call(c, 'open_project', { project: projects[0]?.id });
    const root = (await call(c, 'get_design', { depth: 0 })).json.root.id as string;
    const frame = await call(c, 'apply_changes', {
      operations: [
        { op: 'create', parentId: root, node: { type: 'frame', name: 'Screen', w: 800, h: 600 } },
      ],
    });
    const parentId = frame.json.created[0] as string;
    const place = async (args: Record<string, unknown>) => {
      const r = await call(c, 'use_library_asset', { parentId, ...args });
      expect(r.isError, r.text).toBe(false);
      return (await call(c, 'get_node', { nodeId: r.json.nodeId })).json.node;
    };

    // a panel (an SVG) keeps its proportions, fills its box, and is as sharp as any size
    expect(await place({ id: 'box-blue-rounded' })).toMatchObject({ w: 300, h: 200, fit: 'fill' });
    expect(await place({ id: 'box-blue-rounded', w: 600 })).toMatchObject({
      w: 600,
      h: 400,
      fit: 'fill',
    });
    // an icon is shown whole and starts small
    expect(await place({ id: 'axe-1st' })).toMatchObject({ w: 96, h: 96, fit: 'contain' });
    expect(await place({ id: 'axe-1st', w: 200, h: 100 })).toMatchObject({ fit: 'contain' });
    expect(await place({ id: 'axe-1st', fit: 'cover' })).toMatchObject({ fit: 'cover' });
  }, 60_000);

  it('says the library is empty, and how to fill it', async () => {
    const c = await connect();
    const r = await call(c, 'search_library', {});
    expect(r.json.total).toBe(0);
    expect(r.json.hint).toMatch(/library add/);
  }, 30_000);
});
