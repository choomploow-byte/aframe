import { deepFreeze, sampleDoc } from '@core/testing';
import { describe, expect, it } from 'vitest';
import { beginTextEdit, cancelTextEdit, commitTextEdit } from './text-edit';
import { createAFrameStore } from './store';

function setup() {
  let t = 0;
  const store = createAFrameStore({ doc: deepFreeze(sampleDoc()), now: () => (t += 1000) });
  return { store, get: () => store.getState() };
}

describe('text editing', () => {
  it('commits typed text as one undo step', () => {
    const { store, get } = setup();
    beginTextEdit(store, 'n_title');
    expect(get().editingTextId).toBe('n_title');
    commitTextEdit(store, 'n_title', 'Hello\nWorld');
    expect(get().doc.nodes.n_title?.text).toBe('Hello\nWorld'); // newlines survive
    expect(get().editingTextId).toBeNull();
    expect(get().history.past.map((e) => e.label)).toEqual(['Edit text']);
    get().undo();
    expect(get().doc.nodes.n_title?.text).toBe('Title');
  });

  it('records nothing when the text did not change', () => {
    const { store, get } = setup();
    beginTextEdit(store, 'n_title');
    commitTextEdit(store, 'n_title', 'Title');
    expect(get().history.past).toHaveLength(0);
  });

  it('deletes a text node that was emptied', () => {
    const { store, get } = setup();
    beginTextEdit(store, 'n_title');
    commitTextEdit(store, 'n_title', '   \n ');
    expect(get().doc.nodes.n_title).toBeUndefined();
    expect(get().history.past.map((e) => e.label)).toEqual(['Delete empty text']);
  });

  it('cancels creation entirely when a just-created text node is left empty', () => {
    const { store, get } = setup();
    const before = get().doc;
    get().beginTransaction('Add text');
    get().dispatch(
      [{ op: 'create', parentId: 'n_other', node: { type: 'text', text: '', tempId: 't' } }],
      { select: (r) => [r.idMap.t as string] },
    );
    const [id] = get().selection;
    beginTextEdit(store, id as string);
    commitTextEdit(store, id as string, '');
    // Content is restored exactly (same nodes), under a newer rev: revisions only ever grow.
    expect(get().doc.nodes).toBe(before.nodes);
    expect(get().doc.rev).toBeGreaterThan(before.rev);
    expect(get().history.past).toHaveLength(0);
    expect(get().transaction).toBeNull();
  });

  it('records create + type as a single step for a just-created text node', () => {
    const { store, get } = setup();
    get().beginTransaction('Add text');
    get().dispatch(
      [{ op: 'create', parentId: 'n_other', node: { type: 'text', text: '', tempId: 't' } }],
      { select: (r) => [r.idMap.t as string] },
    );
    const [id] = get().selection as [string];
    beginTextEdit(store, id);
    commitTextEdit(store, id, 'Fresh');
    expect(get().doc.nodes[id]?.text).toBe('Fresh');
    expect(get().history.past.map((e) => e.label)).toEqual(['Add text']);
    get().undo();
    expect(get().doc.nodes[id]).toBeUndefined();
  });

  it('ignores a second commit (blur after Escape) and handles a vanished node', () => {
    const { store, get } = setup();
    beginTextEdit(store, 'n_title');
    commitTextEdit(store, 'n_title', 'One');
    commitTextEdit(store, 'n_title', 'Two');
    expect(get().doc.nodes.n_title?.text).toBe('One');

    beginTextEdit(store, 'n_other');
    get().dispatch([{ op: 'delete', id: 'n_other' }]);
    commitTextEdit(store, 'n_other', 'x'); // node is gone: no crash, no change
    expect(get().editingTextId).toBeNull();
  });

  it('cancelTextEdit leaves the text alone and closes any open transaction', () => {
    const { store, get } = setup();
    get().beginTransaction('Add text');
    beginTextEdit(store, 'n_title');
    cancelTextEdit(store);
    expect(get().editingTextId).toBeNull();
    expect(get().transaction).toBeNull();
    expect(get().doc.nodes.n_title?.text).toBe('Title');
  });
});
