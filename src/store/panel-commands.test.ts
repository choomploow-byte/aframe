import { buildDoc, deepFreeze, sampleDoc, type TestSpec } from '@core/testing';
import type { Doc, Node } from '@core/types';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../canvas/geometry';
import type { Env } from './commands';
import {
  importImages,
  insertAsset,
  renameLayer,
  renameProject,
  setLayerFlag,
  toggleLayerFlag,
  updateProps,
  updatePropsEach,
  type ImageSource,
} from './panel-commands';
import { createAtelierStore } from './store';

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
const file = (name: string, bytes: Uint8Array): ImageSource => ({
  name,
  arrayBuffer: () =>
    Promise.resolve(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ),
});

function measureFrom(getDoc: () => Doc) {
  return (id: string): Rect | null => {
    const doc = getDoc();
    let n: Node | undefined = doc.nodes[id];
    if (!n || typeof n.w !== 'number' || typeof n.h !== 'number') return null;
    const r = { x: 0, y: 0, w: n.w, h: n.h };
    while (n && n.type !== 'page') {
      r.x += n.x;
      r.y += n.y;
      n = n.parentId ? doc.nodes[n.parentId] : undefined;
    }
    return r;
  };
}

function setup(specs?: TestSpec[]) {
  let t = 0;
  const store = createAtelierStore({
    doc: deepFreeze(specs ? buildDoc(specs) : sampleDoc()),
    now: () => t,
    isoNow: () => '2026-06-06T00:00:00.000Z',
  });
  const env: Env = { store, measure: measureFrom(() => store.getState().doc) };
  return { store, env, get: () => store.getState(), advance: (ms: number) => (t += ms) };
}

describe('updateProps', () => {
  it('sets a property on every selected node, once per undo step', () => {
    const { store, get } = setup();
    expect(updateProps(store, ['n_recta', 'n_rectb'], { fill: '#112233' }, { label: 'Fill' })).toBe(
      true,
    );
    expect(get().doc.nodes.n_recta?.fill).toBe('#112233');
    expect(get().doc.nodes.n_rectb?.fill).toBe('#112233');
    expect(get().history.past.map((e) => e.label)).toEqual(['Fill']);
  });

  it('skips nodes the property does not apply to instead of failing the whole edit', () => {
    const { store, get } = setup();
    // fontSize belongs to text only; layout to frames only; opacity to everything.
    updateProps(store, ['n_title', 'n_recta', 'n_frame'], {
      fontSize: 40,
      layout: 'row',
      opacity: 0.5,
    });
    expect(get().doc.nodes.n_title).toMatchObject({ fontSize: 40, opacity: 0.5 });
    expect(get().doc.nodes.n_title).not.toHaveProperty('layout');
    expect(get().doc.nodes.n_recta).toMatchObject({ opacity: 0.5 });
    expect(get().doc.nodes.n_recta).not.toHaveProperty('fontSize');
    expect(get().doc.nodes.n_frame).toMatchObject({ layout: 'row', opacity: 0.5 });
  });

  it('merges a scrub (same key, rapid) into one undo step and removes properties with null', () => {
    const { store, get, advance } = setup();
    for (let i = 1; i <= 10; i += 1) {
      updateProps(store, ['n_title'], { fontSize: 24 + i }, { key: 'fontSize' });
      advance(20);
    }
    expect(get().history.past).toHaveLength(1);
    get().undo();
    expect(get().doc.nodes.n_title?.fontSize).toBe(24);
    updateProps(store, ['n_title'], { fontSize: null }); // optional on the node: removable
    expect(get().doc.nodes.n_title).not.toHaveProperty('fontSize');
  });

  it('does nothing for nothing: empty ids, the page, unknown ids, no applicable keys', () => {
    const { store, get } = setup();
    expect(updateProps(store, [], { opacity: 1 })).toBe(false);
    expect(updateProps(store, ['n_page1', 'n_gone1'], { opacity: 0.5 })).toBe(false);
    expect(updateProps(store, ['n_recta'], { fontSize: 12 })).toBe(false);
    expect(get().history.past).toHaveLength(0);
  });

  it('returns false when the value is rejected by core', () => {
    const { store, get } = setup();
    expect(updateProps(store, ['n_recta'], { opacity: 5 })).toBe(false);
    expect(get().doc.nodes.n_recta?.opacity).toBe(1);
  });
});

describe('updatePropsEach', () => {
  it('gives each node its own patch and skips nodes that return null', () => {
    const { store, get } = setup();
    updatePropsEach(
      store,
      ['n_recta', 'n_rectb', 'n_title'],
      (n) => (n.id === 'n_title' ? null : { x: n.id === 'n_recta' ? 5 : 9 }),
      { label: 'Spread' },
    );
    expect(get().doc.nodes.n_recta?.x).toBe(5);
    expect(get().doc.nodes.n_rectb?.x).toBe(9);
    expect(get().doc.nodes.n_title?.x).toBe(0);
    expect(get().history.past.map((e) => e.label)).toEqual(['Spread']);
  });

  it('filters inapplicable keys and does nothing when no patch survives', () => {
    const { store, get } = setup();
    expect(updatePropsEach(store, ['n_recta'], () => ({ fontSize: 10 }))).toBe(false);
    expect(updatePropsEach(store, ['n_page1', 'n_gone1'], () => ({ opacity: 0.5 }))).toBe(false);
    expect(updatePropsEach(store, [], () => ({ opacity: 0.5 }))).toBe(false);
    expect(get().history.past).toHaveLength(0);
  });

  it('coalesces rapid edits with the same key', () => {
    const { store, get, advance } = setup();
    for (let i = 0; i < 5; i += 1) {
      updatePropsEach(store, ['n_recta'], () => ({ w: 50 + i }), { key: 'w' });
      advance(30);
    }
    expect(get().history.past).toHaveLength(1);
  });
});

describe('layer commands', () => {
  it('renames, trimming and refusing empty or unchanged names', () => {
    const { store, get } = setup();
    expect(renameLayer(store, 'n_title', '  Headline  ')).toBe(true);
    expect(get().doc.nodes.n_title?.name).toBe('Headline');
    expect(renameLayer(store, 'n_title', 'Headline')).toBe(false);
    expect(renameLayer(store, 'n_title', '   ')).toBe(false);
    expect(renameLayer(store, 'n_gone1', 'x')).toBe(false);
    expect(renameLayer(store, 'n_title', 'x'.repeat(500))).toBe(true);
    expect(get().doc.nodes.n_title?.name).toHaveLength(200);
  });

  it('hides, shows, locks and unlocks, with matching undo labels', () => {
    const { store, get } = setup();
    expect(toggleLayerFlag(store, 'n_recta', 'visible')).toBe(true);
    expect(get().doc.nodes.n_recta?.visible).toBe(false);
    toggleLayerFlag(store, 'n_recta', 'visible');
    expect(get().doc.nodes.n_recta?.visible).toBe(true);
    toggleLayerFlag(store, 'n_recta', 'locked');
    expect(get().doc.nodes.n_recta?.locked).toBe(true);
    expect(get().history.past.map((e) => e.label)).toEqual(['Hide', 'Show', 'Lock']);
    expect(toggleLayerFlag(store, 'n_gone1', 'locked')).toBe(false);
    setLayerFlag(store, ['n_recta', 'n_rectb'], 'locked', false);
    expect(get().doc.nodes.n_recta?.locked).toBe(false);
    expect(get().history.past.at(-1)?.label).toBe('Unlock');
  });

  it('renames the project as an undoable step', () => {
    const { store, get } = setup();
    expect(renameProject(store, '  My app  ')).toBe(true);
    expect(get().doc.name).toBe('My app');
    expect(renameProject(store, 'My app')).toBe(false);
    expect(renameProject(store, '  ')).toBe(false);
    get().undo();
    expect(get().doc.name).toBe('Untitled');
  });
});

describe('importImages / insertAsset', () => {
  it('stores a valid image, places it on the page and selects it, as one undo step', async () => {
    const { env, get } = setup();
    const out = await importImages(env, [file('hero.png', png(1600, 800))], {
      insert: true,
      at: { x: 1000, y: 500 },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ ok: true, name: 'hero.png' });
    const node = get().doc.nodes[get().selection[0] as string];
    expect(node).toMatchObject({
      type: 'image',
      w: 480,
      h: 240,
      parentId: 'n_page1',
      x: 760,
      y: 380,
    });
    expect(Object.keys(get().doc.assets)).toHaveLength(1);
    expect(get().history.past).toHaveLength(1);
    get().undo();
    expect(Object.keys(get().doc.assets)).toHaveLength(0);
    expect(get().doc.nodes[node?.id ?? '']).toBeUndefined();
  });

  it('imports without inserting (the Assets tab "add" button)', async () => {
    const { env, get } = setup();
    const out = await importImages(env, [file('a.png', png(10, 10))], { insert: false });
    expect(out[0]).toMatchObject({ ok: true });
    expect(Object.keys(get().doc.assets)).toHaveLength(1);
    expect(get().selection).toEqual([]);
    expect(Object.keys(get().doc.nodes)).toHaveLength(7);
  });

  it('reports bad and oversize files individually and still imports the good ones', async () => {
    const { env, get } = setup();
    const out = await importImages(
      env,
      [
        file('notes.txt', new TextEncoder().encode('hello')),
        file('ok.png', png(20, 20)),
        file('boom.png', png(1, 1)),
      ],
      { insert: false },
    );
    expect(out[0]).toMatchObject({
      ok: false,
      name: 'notes.txt',
      message: "That file isn't a supported image.",
      hint: 'Use PNG, JPEG, GIF, WebP or SVG.',
    });
    expect(out[1]).toMatchObject({ ok: true });
    expect(out[2]).toMatchObject({ ok: true });
    expect(Object.keys(get().doc.assets)).toHaveLength(2);
    expect(get().history.past).toHaveLength(2);
    expect(get().transaction).toBeNull();
  });

  it('survives a file whose bytes cannot be read', async () => {
    const { env, get } = setup();
    const broken: ImageSource = {
      name: 'x.png',
      arrayBuffer: () => Promise.reject(new Error('disk gone')),
    };
    const out = await importImages(env, [broken], { insert: true });
    expect(out[0]).toMatchObject({
      ok: false,
      message: expect.stringContaining('disk gone') as string,
    });
    expect(get().transaction).toBeNull();
    expect(get().history.past).toHaveLength(0);
  });

  it('places several images at an offset so they do not sit on top of each other', async () => {
    const { env, get } = setup();
    await importImages(env, [file('a.png', png(100, 100)), file('b.png', png(100, 100))], {
      insert: true,
      at: { x: 500, y: 500 },
    });
    const images = Object.values(get().doc.nodes).filter((n) => n.type === 'image');
    expect(images.map((n) => [n.x, n.y])).toEqual([
      [450, 450],
      [474, 474],
    ]);
  });

  it('inserts into the selected frame at a position relative to it, and without a position inside auto-layout', async () => {
    const { env, get } = setup([
      { id: 'n_box01', type: 'frame', layout: 'none', x: 200, y: 100, w: 500, h: 400 },
      { id: 'n_flex1', type: 'frame', layout: 'row', x: 900, y: 100 },
    ]);
    const imported = await importImages(env, [file('a.png', png(100, 100))], { insert: false });
    const assetId = (imported[0] as { assetId: string }).assetId;

    get().setSelection(['n_box01']);
    const free = insertAsset(env, assetId, { x: 450, y: 300 }); // world centre of the image
    expect(get().doc.nodes[free as string]).toMatchObject({ parentId: 'n_box01', x: 200, y: 150 });

    get().setSelection(['n_flex1']);
    const flowed = insertAsset(env, assetId);
    expect(get().doc.nodes[flowed as string]).toMatchObject({ parentId: 'n_flex1', x: 0, y: 0 });

    get().setSelection([free as string]);
    const sibling = insertAsset(env, assetId);
    expect(get().doc.nodes[sibling as string]?.parentId).toBe('n_box01'); // next to a selected leaf
  });

  it('insertAsset returns null for unknown assets', () => {
    const { env } = setup();
    expect(insertAsset(env, 'img_nope1')).toBeNull();
  });
});
