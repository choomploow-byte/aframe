import { runTool } from '@core/tools';
import { deepFreeze, sampleDoc } from '@core/testing';
import type { Node, Op } from '@core/types';
import { describe, expect, it } from 'vitest';
import { createStoreContext } from './context';
import { createAFrameStore } from './store';

function setup() {
  let t = 0;
  const store = createAFrameStore({
    doc: deepFreeze(sampleDoc()),
    now: () => t,
    isoNow: () => '2026-04-04T00:00:00.000Z',
  });
  return { store, advance: (ms: number) => (t += ms) };
}

const move = (x: number): Op => ({ op: 'update', id: 'n_other', set: { x } });

describe('dispatch', () => {
  it('applies ops through core, bumps rev, stamps the writer, and records history', () => {
    const { store } = setup();
    const res = store.getState().dispatch([move(600)], { label: 'Move' });
    expect(res.ok).toBe(true);
    const s = store.getState();
    expect(s.doc.nodes.n_other?.x).toBe(600);
    expect(s.doc.rev).toBe(2);
    expect(s.doc.meta).toMatchObject({ lastWriter: 'app', updatedAt: '2026-04-04T00:00:00.000Z' });
    expect(s.history.past.map((e) => e.label)).toEqual(['Move']);
  });

  it('leaves everything alone when a batch fails', () => {
    const { store } = setup();
    const before = store.getState().doc;
    const res = store.getState().dispatch([{ op: 'update', id: 'n_gone1', set: { x: 1 } }]);
    expect(res).toMatchObject({ ok: false, errors: [{ code: 'NOT_FOUND' }] });
    expect(store.getState().doc).toBe(before);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('does not bump rev or record history for a no-op', () => {
    const { store } = setup();
    store.getState().dispatch([{ op: 'update', id: 'n_other', set: { x: 500 } }]);
    expect(store.getState().doc.rev).toBe(1);
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('drops deleted nodes from the selection and can select what was created', () => {
    const { store } = setup();
    store.getState().setSelection(['n_title', 'n_other']);
    store.getState().dispatch([{ op: 'delete', id: 'n_other' }]);
    expect(store.getState().selection).toEqual(['n_title']);

    store
      .getState()
      .dispatch([{ op: 'create', parentId: 'n_frame', node: { type: 'rect', tempId: 'r1' } }], {
        select: (r) => [r.idMap.r1 as string],
      });
    const [id] = store.getState().selection;
    expect(store.getState().doc.nodes[id as string]?.type).toBe('rect');
  });
});

describe('undo / redo', () => {
  it('walks back and forth, restoring content but always moving rev forward', () => {
    const { store, advance } = setup();
    const { dispatch, undo, redo } = store.getState();
    dispatch([move(600)], { label: 'A' });
    advance(1000);
    dispatch([move(700)], { label: 'B' });
    expect(store.getState().doc.nodes.n_other?.x).toBe(700);

    expect(undo()).toBe('B');
    expect(store.getState().doc.nodes.n_other?.x).toBe(600);
    expect(undo()).toBe('A');
    expect(store.getState().doc.nodes.n_other?.x).toBe(500);
    expect(undo()).toBeNull();

    expect(redo()).toBe('A');
    expect(redo()).toBe('B');
    expect(store.getState().doc.nodes.n_other?.x).toBe(700);
    expect(redo()).toBeNull();
    expect(store.getState().doc.rev).toBeGreaterThan(3);
  });

  it('rev strictly grows through every undo, redo and cancelled gesture', () => {
    const { store, advance } = setup();
    const { dispatch, undo, redo, beginTransaction, cancelTransaction } = store.getState();
    const revs: number[] = [store.getState().doc.rev];
    const note = (): void => void revs.push(store.getState().doc.rev);
    for (const x of [600, 700, 800]) {
      dispatch([move(x)]);
      advance(1000);
      note();
    }
    undo();
    note();
    undo();
    note();
    redo();
    note();
    beginTransaction('drag');
    dispatch([move(900)]);
    note();
    cancelTransaction();
    note();
    for (let i = 1; i < revs.length; i++) {
      expect(revs[i], `step ${i}: ${revs.join(', ')}`).toBeGreaterThan(revs[i - 1] as number);
    }
  });

  it('a new edit after undo clears redo', () => {
    const { store, advance } = setup();
    store.getState().dispatch([move(600)]);
    advance(1000);
    store.getState().undo();
    store.getState().dispatch([move(650)]);
    expect(store.getState().redo()).toBeNull();
  });

  it('keeps only still-existing nodes selected and closes text editing', () => {
    const { store, advance } = setup();
    store
      .getState()
      .dispatch([{ op: 'create', parentId: 'n_other', node: { type: 'rect', tempId: 'x' } }], {
        select: (r) => [r.idMap.x as string],
      });
    advance(1000);
    store.getState().setEditingTextId('n_title');
    store.getState().undo();
    expect(store.getState().selection).toEqual([]);
    expect(store.getState().editingTextId).toBeNull();
  });

  it('merges rapid same-key dispatches into one undo step (drag/nudge)', () => {
    const { store, advance } = setup();
    for (let i = 1; i <= 20; i += 1) {
      store.getState().dispatch([move(500 + i)], { label: 'Move', key: 'drag' });
      advance(16);
    }
    expect(store.getState().history.past).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().doc.nodes.n_other?.x).toBe(500);
  });
});

describe('transactions', () => {
  it('turn many dispatches into a single undo step', () => {
    const { store } = setup();
    const s = store.getState();
    s.beginTransaction('AI: improve layout');
    s.dispatch([move(600)], { label: 'ignored' });
    s.dispatch([{ op: 'update', id: 'n_title', set: { text: 'Hi' } }]);
    expect(store.getState().history.past).toHaveLength(0);
    s.endTransaction();
    expect(store.getState().history.past.map((e) => e.label)).toEqual(['AI: improve layout']);
    s.undo();
    expect(store.getState().doc.nodes.n_other?.x).toBe(500);
    expect(store.getState().doc.nodes.n_title?.text).toBe('Title');
  });

  it('record nothing when nothing changed, and ignore a nested begin or a stray end', () => {
    const { store } = setup();
    const s = store.getState();
    s.endTransaction();
    s.beginTransaction('outer');
    s.beginTransaction('inner');
    expect(store.getState().transaction?.label).toBe('outer');
    s.endTransaction();
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('can be cancelled, restoring the document', () => {
    const { store } = setup();
    const s = store.getState();
    s.beginTransaction('drag');
    s.dispatch([move(900)]);
    s.cancelTransaction();
    expect(store.getState().doc.nodes.n_other?.x).toBe(500);
    expect(store.getState().transaction).toBeNull();
    expect(store.getState().history.past).toHaveLength(0);
    s.cancelTransaction(); // nothing open: harmless
  });

  it('cancel without edits keeps the same document object', () => {
    const { store } = setup();
    const before = store.getState().doc;
    store.getState().beginTransaction('x');
    store.getState().cancelTransaction();
    expect(store.getState().doc).toBe(before);
  });
});

describe('external commits and loading', () => {
  it('records an external change as one labelled undo step', () => {
    const { store } = setup();
    const doc = store.getState().doc;
    const next = { ...doc, name: 'Renamed by agent' };
    store.getState().commitExternal(next, 'AI change');
    expect(store.getState().doc.name).toBe('Renamed by agent');
    expect(store.getState().history.past.map((e) => e.label)).toEqual(['AI change']);
    store.getState().commitExternal(store.getState().doc, 'same'); // identical: ignored
    expect(store.getState().history.past).toHaveLength(1);
  });

  it('loadDoc swaps the document and forgets history, selection and gestures', () => {
    const { store } = setup();
    store.getState().dispatch([move(600)]);
    store.getState().setSelection(['n_other']);
    store.getState().setTransient({ guides: [{ axis: 'x', at: 1, from: 0, to: 2 }] });
    store.getState().loadDoc(sampleDoc());
    const s = store.getState();
    expect(s.history.past).toEqual([]);
    expect(s.selection).toEqual([]);
    expect(s.transient.guides).toEqual([]);
  });
});

describe('selection, tool and view state', () => {
  it('dedupes, ignores unknown ids and the page, and toggles', () => {
    const { store } = setup();
    const s = store.getState();
    s.setSelection(['n_title', 'n_title', 'n_gone1', 'n_page1']);
    expect(store.getState().selection).toEqual(['n_title']);
    s.toggleSelection('n_other');
    expect(store.getState().selection).toEqual(['n_title', 'n_other']);
    s.toggleSelection('n_title');
    expect(store.getState().selection).toEqual(['n_other']);
  });

  it('holds tool, viewport, hover, clipboard and transient gesture feedback', () => {
    const { store } = setup();
    const s = store.getState();
    s.setTool('rect');
    s.setViewport({ x: 10, y: 20, zoom: 2 });
    s.setHover('n_title');
    s.setClipboard([{ type: 'rect' }]);
    s.setTransient({ marquee: { x: 0, y: 0, w: 5, h: 5 } });
    expect(store.getState()).toMatchObject({
      tool: 'rect',
      viewport: { zoom: 2 },
      hover: 'n_title',
      clipboard: [{ type: 'rect' }],
      transient: { marquee: { w: 5 } },
    });
    s.clearTransient();
    expect(store.getState().transient.marquee).toBeNull();
    const same = store.getState();
    s.setHover('n_title');
    expect(store.getState()).toBe(same); // unchanged hover does not notify subscribers
  });
});

describe('createStoreContext (the chat agent edits the live store)', () => {
  it('runs tools against the store: one undoable step per apply_changes', async () => {
    const { store } = setup();
    const ctx = createStoreContext(store);
    store.getState().setSelection(['n_title']);
    expect(await ctx.getSelection?.()).toEqual(['n_title']);

    const res = await runTool(ctx, 'apply_changes', {
      label: 'Warm it up',
      operations: [{ op: 'update', id: 'n_title', set: { fontSize: 40 } }],
    });
    expect(res.ok).toBe(true);
    expect(store.getState().doc.nodes.n_title?.fontSize).toBe(40);
    expect(store.getState().history.past.map((e) => e.label)).toEqual(['Warm it up']);
    store.getState().undo();
    expect(store.getState().doc.nodes.n_title?.fontSize).toBe(24);
  });

  it('uses a default label and passes extras through', async () => {
    const { store } = setup();
    const ctx = createStoreContext(store, { getNodeBounds: () => Promise.resolve(null) });
    expect('getNodeBounds' in ctx).toBe(true);
    await ctx.commit({ ...store.getState().doc, name: 'x' });
    expect(store.getState().history.past[0]?.label).toBe('AI change');
  });
});

describe('adoptExternal', () => {
  it('installs the document as-is (no rev bump, no writer stamp) as one undo step', () => {
    const { store } = setup();
    const before = store.getState().doc;
    const remote = {
      ...before,
      rev: 7,
      meta: { ...before.meta, lastWriter: 'mcp' as const },
      nodes: { ...before.nodes, n_other: { ...(before.nodes.n_other as Node), x: 123 } },
    };
    store.getState().adoptExternal(remote, 'AI change');
    const s = store.getState();
    expect(s.doc).toBe(remote);
    expect(s.doc.rev).toBe(7);
    expect(s.doc.meta.lastWriter).toBe('mcp');
    expect(s.history.past.map((h) => h.label)).toEqual(['AI change']);
    // Undo steps back over the agent's change, and that is a new revision after rev 7.
    store.getState().undo();
    expect(store.getState().doc.nodes.n_other?.x).toBe(500);
    expect(store.getState().doc.rev).toBeGreaterThan(7);
  });

  it('keeps the selection (minus nodes that no longer exist) and ignores an identical document', () => {
    const { store } = setup();
    store.getState().setSelection(['n_other']);
    store.getState().adoptExternal(store.getState().doc, 'noop');
    expect(store.getState().history.past).toHaveLength(0);
    const rest = Object.fromEntries(
      Object.entries(store.getState().doc.nodes).filter(([id]) => id !== 'n_other'),
    );
    store.getState().adoptExternal({ ...store.getState().doc, nodes: rest }, 'AI change');
    expect(store.getState().selection).toEqual([]);
  });
});
