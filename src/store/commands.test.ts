import { buildDoc, deepFreeze, sampleDoc, type TestSpec } from '@core/testing';
import type { Doc, Node } from '@core/types';
import { describe, expect, it } from 'vitest';
import type { Rect } from '../canvas/geometry';
import {
  addArtboard,
  addAutoLayout,
  copySelection,
  cutSelection,
  deleteSelection,
  drawSpec,
  duplicateSelection,
  enterSelection,
  nudgeSelection,
  pasteClipboard,
  reorderSelection,
  selectAll,
  selectParent,
  selectSibling,
  wrapSelectionInFrame,
  type Env,
} from './commands';
import { createAtelierStore } from './store';

/** World rect from the stored numbers (works for the fixed-size layouts these tests use). */
function numericMeasure(getDoc: () => Doc) {
  return (id: string): Rect | null => {
    const doc = getDoc();
    let n: Node | undefined = doc.nodes[id];
    if (!n || typeof n.w !== 'number' || typeof n.h !== 'number') return null;
    const rect = { x: 0, y: 0, w: n.w, h: n.h };
    while (n && n.type !== 'page') {
      rect.x += n.x;
      rect.y += n.y;
      n = n.parentId ? doc.nodes[n.parentId] : undefined;
    }
    return rect;
  };
}

function setup(specs?: TestSpec[]) {
  let t = 0;
  const store = createAtelierStore({
    doc: deepFreeze(specs ? buildDoc(specs) : sampleDoc()),
    now: () => t,
    isoNow: () => '2026-05-05T00:00:00.000Z',
  });
  const env: Env = { store, measure: numericMeasure(() => store.getState().doc) };
  const get = () => store.getState();
  const node = (id: string): Node => {
    const n = get().doc.nodes[id];
    if (!n) throw new Error(`no node ${id}`);
    return n;
  };
  return { store, env, get, node, advance: (ms: number) => (t += ms) };
}

/** Three free-positioned rects inside one artboard: z-order a < b < c. */
const board = (): TestSpec[] => [
  {
    id: 'n_board',
    type: 'frame',
    layout: 'none',
    x: 100,
    y: 100,
    w: 600,
    h: 400,
    children: [
      { id: 'n_aaaa1', type: 'rect', x: 20, y: 30, w: 100, h: 50 },
      { id: 'n_bbbb1', type: 'rect', x: 200, y: 30, w: 100, h: 50 },
      { id: 'n_cccc1', type: 'rect', x: 380, y: 30, w: 100, h: 50 },
    ],
  },
];

describe('delete / duplicate', () => {
  it('deletes the selection as one undo step, once per top-most node', () => {
    const { store, get } = setup();
    get().setSelection(['n_frame', 'n_title', 'n_other']);
    expect(deleteSelection(store)).toBe(true);
    expect(Object.keys(get().doc.nodes)).toEqual(['n_page1']);
    expect(get().history.past).toHaveLength(1);
    get().undo();
    expect(Object.keys(get().doc.nodes)).toHaveLength(7);
  });

  it('skips locked nodes and does nothing for an empty selection', () => {
    const { store, get } = setup();
    expect(deleteSelection(store)).toBe(false);
    get().dispatch([{ op: 'update', id: 'n_title', set: { locked: true } }]);
    get().setSelection(['n_title']);
    expect(deleteSelection(store)).toBe(false);
    expect(get().doc.nodes.n_title).toBeDefined();
  });

  it('duplicates free-positioned nodes with a small offset and selects the copies', () => {
    const { env, get, node } = setup(board());
    get().setSelection(['n_aaaa1', 'n_bbbb1']);
    expect(duplicateSelection(env)).toBe(true);
    const copies = get().selection;
    expect(copies).toHaveLength(2);
    expect(node(copies[0] as string)).toMatchObject({ x: 36, y: 46, type: 'rect' });
    expect(node(copies[1] as string)).toMatchObject({ x: 216, y: 46 });
    expect(get().history.past).toHaveLength(1);
  });

  it('puts a duplicated artboard to the right of the original, copies of subtrees get fresh ids', () => {
    const { env, get, node } = setup();
    get().setSelection(['n_frame']);
    duplicateSelection(env);
    const [copy] = get().selection;
    expect(node(copy as string)).toMatchObject({ x: 440, y: 0, name: 'Card' }); // 400 wide + 40 gap
    expect(node(copy as string).children).toHaveLength(2);
    expect(get().selection).toHaveLength(1); // only the root of the copy is selected
  });

  it('duplicates auto-layout children in place in the flow (no offset)', () => {
    const { env, get, node } = setup();
    get().setSelection(['n_title']);
    duplicateSelection(env);
    expect(node('n_frame').children).toHaveLength(3);
    expect(node('n_frame').children[0]).toBe('n_title');
    expect(node(get().selection[0] as string)).toMatchObject({ text: 'Title' });
    expect(duplicateSelection({ ...env, store: setup().store })).toBe(false);
  });
});

describe('copy / cut / paste', () => {
  it('copies to the store clipboard without ids', () => {
    const { store, get } = setup();
    expect(copySelection(store)).toBeNull();
    get().setSelection(['n_row1']);
    const specs = copySelection(store);
    expect(specs).toHaveLength(1);
    expect(get().clipboard).toBe(specs);
    expect(JSON.stringify(specs)).not.toMatch(/n_(row1|recta|rectb)/);
  });

  it('pastes into a selected frame, free-positioned with an offset', () => {
    const { env, store, get, node } = setup(board());
    get().setSelection(['n_aaaa1']);
    copySelection(store);
    get().setSelection(['n_board']);
    expect(pasteClipboard(env)).toBe(true);
    const [pasted] = get().selection;
    expect(node(pasted as string)).toMatchObject({ parentId: 'n_board', x: 36, y: 46 });
  });

  it('pastes next to a selected leaf (into its parent) and onto the page when nothing is selected', () => {
    const { env, store, get, node } = setup(board());
    get().setSelection(['n_aaaa1']);
    copySelection(store);
    get().setSelection(['n_bbbb1']);
    pasteClipboard(env);
    expect(node(get().selection[0] as string).parentId).toBe('n_board');

    get().setSelection([]);
    pasteClipboard(env, { at: { x: 1000, y: 800 } });
    const onPage = node(get().selection[0] as string);
    expect(onPage.parentId).toBe('n_page1');
    expect(onPage).toMatchObject({ x: 1000, y: 800 }); // top-left lands on the cursor
  });

  it('places the pasted group relative to its parent origin when pasting at a point into a frame', () => {
    const { env, store, get, node } = setup(board());
    get().setSelection(['n_aaaa1', 'n_bbbb1']);
    copySelection(store);
    get().setSelection(['n_board']);
    pasteClipboard(env, { at: { x: 150, y: 160 } }); // world; board origin is (100,100)
    const [a, b] = get().selection;
    expect(node(a as string)).toMatchObject({ x: 50, y: 60 });
    expect(node(b as string)).toMatchObject({ x: 230, y: 60 }); // keeps the 180px spacing
  });

  it('pastes into an auto-layout frame without positions', () => {
    const { env, store, get, node } = setup();
    get().setSelection(['n_recta']);
    copySelection(store);
    get().setSelection(['n_row1']);
    pasteClipboard(env);
    const pasted = node(get().selection[0] as string);
    expect(pasted.parentId).toBe('n_row1');
    expect(node('n_row1').children).toHaveLength(3);
  });

  it('cuts (copy + delete) and refuses to paste an empty clipboard', () => {
    const { env, store, get } = setup(board());
    expect(pasteClipboard(env)).toBe(false);
    get().setSelection(['n_cccc1']);
    expect(cutSelection(store)).toHaveLength(1);
    expect(get().doc.nodes.n_cccc1).toBeUndefined();
    get().setSelection(['n_board']);
    expect(pasteClipboard(env)).toBe(true);
    expect(pasteClipboard(env, { specs: [] })).toBe(false);
  });
});

describe('z-order', () => {
  const order = (get: () => { doc: Doc }) => get().doc.nodes.n_board?.children;

  it('forward / backward move one step, front / back go to the ends', () => {
    const { store, get } = setup(board());
    get().setSelection(['n_aaaa1']);
    reorderSelection(store, 'forward');
    expect(order(get)).toEqual(['n_bbbb1', 'n_aaaa1', 'n_cccc1']);
    reorderSelection(store, 'front');
    expect(order(get)).toEqual(['n_bbbb1', 'n_cccc1', 'n_aaaa1']);
    reorderSelection(store, 'backward');
    expect(order(get)).toEqual(['n_bbbb1', 'n_aaaa1', 'n_cccc1']);
    reorderSelection(store, 'back');
    expect(order(get)).toEqual(['n_aaaa1', 'n_bbbb1', 'n_cccc1']);
  });

  it('does nothing at the ends, and keeps the relative order of a multi-selection', () => {
    const { store, get } = setup(board());
    get().setSelection(['n_cccc1']);
    expect(reorderSelection(store, 'forward')).toBe(false);
    expect(reorderSelection(store, 'front')).toBe(false);
    get().setSelection(['n_aaaa1', 'n_bbbb1']);
    reorderSelection(store, 'front');
    expect(order(get)).toEqual(['n_cccc1', 'n_aaaa1', 'n_bbbb1']);
    reorderSelection(store, 'back');
    expect(order(get)).toEqual(['n_aaaa1', 'n_bbbb1', 'n_cccc1']);
    get().setSelection(['n_aaaa1', 'n_bbbb1']);
    reorderSelection(store, 'forward');
    expect(order(get)).toEqual(['n_cccc1', 'n_aaaa1', 'n_bbbb1']);
    expect(reorderSelection(setup().store, 'forward')).toBe(false);
  });

  it('is a single undo step', () => {
    const { store, get } = setup(board());
    get().setSelection(['n_aaaa1', 'n_bbbb1']);
    reorderSelection(store, 'front');
    expect(get().history.past).toHaveLength(1);
    get().undo();
    expect(order(get)).toEqual(['n_aaaa1', 'n_bbbb1', 'n_cccc1']);
  });
});

describe('wrap in frame', () => {
  it('wraps free-positioned nodes keeping them where they are', () => {
    const { env, get, node } = setup(board());
    get().setSelection(['n_aaaa1', 'n_cccc1']);
    expect(wrapSelectionInFrame(env)).toBe(true);
    const [frameId] = get().selection;
    const frame = node(frameId as string);
    expect(frame).toMatchObject({
      type: 'frame',
      parentId: 'n_board',
      x: 20,
      y: 30,
      w: 460,
      h: 50,
      layout: 'none',
    });
    expect(frame.children).toEqual(['n_aaaa1', 'n_cccc1']);
    expect(node('n_aaaa1')).toMatchObject({ x: 0, y: 0, parentId: frameId });
    expect(node('n_cccc1')).toMatchObject({ x: 360, y: 0 });
    // The frame sits at the top-most selected node's place in the z-order.
    expect(node('n_board').children).toEqual(['n_bbbb1', frameId]);
    expect(get().history.past).toHaveLength(1);
  });

  it('wraps inside an auto-layout parent in the same slot with the parent direction', () => {
    const { env, get, node } = setup();
    get().setSelection(['n_title']);
    wrapSelectionInFrame(env);
    const [frameId] = get().selection;
    expect(node(frameId as string)).toMatchObject({
      w: 'hug',
      h: 'hug',
      layout: 'column',
      parentId: 'n_frame',
    });
    expect(node('n_frame').children).toEqual([frameId, 'n_row1']);
    expect(node('n_title').parentId).toBe(frameId);
  });

  it('refuses selections from different parents and locked or empty selections', () => {
    const { env, get } = setup();
    expect(wrapSelectionInFrame(env)).toBe(false);
    get().setSelection(['n_title', 'n_other']);
    expect(wrapSelectionInFrame(env)).toBe(false);
  });
});

describe('add auto-layout', () => {
  const row = (): TestSpec[] => [
    {
      id: 'n_board',
      type: 'frame',
      layout: 'none',
      x: 0,
      y: 0,
      w: 412,
      h: 100,
      children: [
        { id: 'n_cccc1', type: 'rect', x: 312, y: 20, w: 80, h: 60 },
        { id: 'n_aaaa1', type: 'rect', x: 20, y: 20, w: 80, h: 60 },
        { id: 'n_bbbb1', type: 'rect', x: 116, y: 20, w: 80, h: 60 },
        { id: 'n_dddd1', type: 'rect', x: 212, y: 20, w: 80, h: 60 },
      ],
    },
  ];

  it('turns a free-positioned frame into a row, in visual order, in one undo step', () => {
    const { env, get, node } = setup(row());
    get().setSelection(['n_board']);
    expect(addAutoLayout(env)).toBe(true);
    expect(node('n_board')).toMatchObject({
      layout: 'row',
      gap: 16,
      padding: [20, 20, 20, 20],
      align: 'start',
      justify: 'start',
    });
    expect(node('n_board').children).toEqual(['n_aaaa1', 'n_bbbb1', 'n_dddd1', 'n_cccc1']);
    expect(get().history.past).toHaveLength(1);
    get().undo();
    expect(node('n_board').layout).toBe('none');
    expect(node('n_board').children[0]).toBe('n_cccc1');
  });

  it('wraps non-frame selections first, still as a single undo step', () => {
    const { env, get, node } = setup(row());
    get().setSelection(['n_aaaa1', 'n_bbbb1']);
    expect(addAutoLayout(env)).toBe(true);
    const [frameId] = get().selection;
    expect(node(frameId as string)).toMatchObject({ type: 'frame', layout: 'row', gap: 16 });
    expect(node(frameId as string).children).toEqual(['n_aaaa1', 'n_bbbb1']);
    expect(get().history.past).toHaveLength(1);
  });

  it('does nothing for an existing auto-layout frame or an empty selection', () => {
    const { env, get } = setup();
    expect(addAutoLayout(env)).toBe(false);
    get().setSelection(['n_frame']);
    expect(addAutoLayout(env)).toBe(false);
  });

  it('wrapping inside a flex parent already yields an auto-layout frame', () => {
    const { env, get, node } = setup();
    get().setSelection(['n_title']);
    expect(addAutoLayout(env)).toBe(true);
    expect(node(get().selection[0] as string).layout).toBe('column');
    expect(get().history.past).toHaveLength(1);
  });

  it('leaves the document untouched when wrapping is impossible', () => {
    const { env, get } = setup();
    get().setSelection(['n_title', 'n_other']);
    const before = get().doc;
    expect(addAutoLayout(env)).toBe(false);
    expect(get().doc).toBe(before);
    expect(get().transaction).toBeNull();
  });
});

describe('nudge', () => {
  it('moves free-positioned nodes and merges rapid presses into one undo step', () => {
    const { store, get, node, advance } = setup(board());
    get().setSelection(['n_aaaa1', 'n_bbbb1']);
    for (let i = 0; i < 5; i += 1) {
      nudgeSelection(store, 10, 0);
      advance(50);
    }
    expect(node('n_aaaa1').x).toBe(70);
    expect(node('n_bbbb1').x).toBe(250);
    expect(get().history.past).toHaveLength(1);
    get().undo();
    expect(node('n_aaaa1').x).toBe(20);
  });

  it('ignores auto-layout children, locked nodes and empty selections', () => {
    const { store, get } = setup();
    expect(nudgeSelection(store, 1, 0)).toBe(false);
    get().setSelection(['n_title']);
    expect(nudgeSelection(store, 1, 0)).toBe(false);
    get().dispatch([{ op: 'update', id: 'n_other', set: { locked: true } }]);
    get().setSelection(['n_other']);
    expect(nudgeSelection(store, 1, 0)).toBe(false);
  });
});

describe('keyboard navigation', () => {
  it('Tab walks siblings and wraps; with no selection it starts at the first artboard', () => {
    const { store, get } = setup();
    expect(selectSibling(store, 1)).toBe('n_frame');
    expect(selectSibling(store, 1)).toBe('n_other');
    expect(selectSibling(store, 1)).toBe('n_frame');
    expect(selectSibling(store, -1)).toBe('n_other');
    get().setSelection(['n_title']);
    expect(selectSibling(store, 1)).toBe('n_row1');
    expect(selectSibling(setup(board()).store, 1)).toBe('n_board');
  });

  it('Tab skips hidden nodes', () => {
    const { store, get } = setup();
    get().dispatch([{ op: 'update', id: 'n_other', set: { visible: false } }]);
    get().setSelection(['n_frame']);
    expect(selectSibling(store, 1)).toBe('n_frame');
  });

  it('Esc steps to the parent and finally clears', () => {
    const { store, get } = setup();
    get().setSelection(['n_recta']);
    selectParent(store);
    expect(get().selection).toEqual(['n_row1']);
    selectParent(store);
    expect(get().selection).toEqual(['n_frame']);
    selectParent(store);
    expect(get().selection).toEqual([]);
  });

  it('Enter edits text or dives into a frame; Ctrl+A selects the siblings', () => {
    const { store, get } = setup();
    expect(enterSelection(store)).toBeNull();
    get().setSelection(['n_frame']);
    expect(enterSelection(store)).toBe('child');
    expect(get().selection).toEqual(['n_title']);
    expect(enterSelection(store)).toBe('edit');
    expect(get().editingTextId).toBe('n_title');
    get().setSelection(['n_recta']);
    expect(enterSelection(store)).toBeNull(); // a leaf rectangle: nothing to enter
    selectAll(store);
    expect(get().selection).toEqual(['n_recta', 'n_rectb']);
    get().setSelection([]);
    selectAll(store);
    expect(get().selection).toEqual(['n_frame', 'n_other']);
  });
});

describe('drawing defaults', () => {
  it('uses document tokens when they exist and literals when they do not', () => {
    const doc = sampleDoc();
    const rect = { x: 10.123, y: 20, w: 99.999, h: 0.2 };
    expect(drawSpec(doc, 'rect', rect, false)).toMatchObject({
      type: 'rect',
      x: 10.12,
      y: 20,
      w: 100,
      h: 1,
      fill: '$border',
    });
    const bare = { ...doc, tokens: { ...doc.tokens, colors: {}, fonts: {} } };
    expect(drawSpec(bare, 'rect', rect, false)).toMatchObject({ fill: '#E8E6DC' });
    expect(drawSpec(bare, 'frame', rect, false)).toMatchObject({ fill: '#FFFFFF', layout: 'none' });
    const text = drawSpec(doc, 'text', rect, false);
    expect(text).toMatchObject({
      type: 'text',
      text: '',
      color: '$text',
      fontFamily: '$font.body',
    });
    expect(drawSpec(bare, 'text', rect, false)).not.toHaveProperty('fontFamily');
  });

  it('omits the position for children of auto-layout frames', () => {
    const spec = drawSpec(sampleDoc(), 'ellipse', { x: 5, y: 6, w: 7, h: 8 }, true);
    expect(spec).not.toHaveProperty('x');
    expect(spec).toMatchObject({ type: 'ellipse', w: 7, h: 8 });
  });

  it('adds a device artboard centred on a point and selects it', () => {
    const { store, get, node } = setup();
    expect(addArtboard(store, { label: 'Mobile', w: 390, h: 844 }, { x: 1000, y: 500 })).toBe(true);
    const [id] = get().selection;
    expect(node(id as string)).toMatchObject({
      name: 'Mobile',
      x: 805,
      y: 78,
      w: 390,
      h: 844,
      parentId: 'n_page1',
    });
    expect(get().history.past.map((e) => e.label)).toEqual(['Add Mobile frame']);
  });
});
