import { describe, expect, it } from 'vitest';
import {
  addAnnotation,
  addressNotesPrompt,
  openAnnotations,
  placeAnnotations,
  removeAnnotation,
  updateAnnotation,
  type NodeLocator,
} from './annotations';
import { applyChanges } from './apply';
import { createEmptyDoc } from './doc';
import { seededRng } from './ids';
import { createMemoryContext } from './memory-context';
import { runTool } from './tools';
import type { Doc } from './types';
import { validateDoc } from './validate';

const rng = seededRng(5);
const withButton = (): { doc: Doc; frame: string; button: string } => {
  const base = createEmptyDoc({ id: 'p_ann01', now: '2026-01-01T00:00:00.000Z', rng });
  const r = applyChanges(base, [
    {
      op: 'create',
      parentId: base.rootId,
      node: {
        type: 'frame',
        name: 'Screen',
        x: 100,
        y: 50,
        w: 400,
        h: 300,
        layout: 'none',
        children: [{ type: 'rect', name: 'Button', x: 20, y: 30, w: 120, h: 40 }],
      },
    },
  ]);
  if (!r.ok) throw new Error('setup');
  return { doc: r.doc, frame: r.created[0] as string, button: r.created[1] as string };
};

describe('annotation operations', () => {
  it('adds, edits, resolves, replies and removes, always as a valid document', () => {
    const { doc, button } = withButton();
    const added = addAnnotation(doc, {
      text: '  make this pop  ',
      author: 'user',
      x: 130,
      y: 90,
      nodeId: button,
      offset: { x: 10, y: 8 },
      now: '2026-02-02T00:00:00.000Z',
    });
    expect(added.doc.annotations[0]).toMatchObject({
      text: 'make this pop',
      status: 'open',
      author: 'user',
      offset: { x: 10, y: 8 },
    });
    expect(validateDoc(added.doc).ok).toBe(true);

    const resolved = updateAnnotation(added.doc, added.id, {
      status: 'resolved',
      reply: ' Added a glow. ',
    });
    expect(resolved.annotations[0]).toMatchObject({ status: 'resolved', reply: 'Added a glow.' });
    const cleared = updateAnnotation(resolved, added.id, {
      reply: null,
      status: 'open',
      text: 'bolder',
    });
    expect(cleared.annotations[0]?.reply).toBeUndefined();
    expect(cleared.annotations[0]).toMatchObject({ status: 'open', text: 'bolder' });
    expect(removeAnnotation(cleared, added.id).annotations).toEqual([]);
    expect(removeAnnotation(cleared, 'a_nope1')).toBe(cleared);
  });

  it('refuses an empty note, a long one, an unknown node and an unknown id', () => {
    const { doc } = withButton();
    const base = { author: 'user' as const, x: 0, y: 0 };
    expect(() => addAnnotation(doc, { ...base, text: '   ' })).toThrow(/empty/);
    expect(() => addAnnotation(doc, { ...base, text: 'x'.repeat(2001) })).toThrow(/2000/);
    expect(() => addAnnotation(doc, { ...base, text: 'hi', nodeId: 'n_nope1' })).toThrow(
      /does not exist/,
    );
    expect(() => updateAnnotation(doc, 'a_nope1', { status: 'resolved' })).toThrow(
      /does not exist/,
    );
  });

  it('validation rejects an offset with no node and a bad region', () => {
    const { doc } = withButton();
    const common = { x: 1, y: 1, text: 't', author: 'user', status: 'open', createdAt: 'x' };
    const bad = {
      ...doc,
      annotations: [
        { id: 'a_bad01', ...common, offset: { x: 1, y: 1 } },
        { id: 'a_bad02', ...common, rect: { x: 1, y: 1, w: -4, h: 2 } },
      ],
    } as unknown as Doc;
    const v = validateDoc(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const messages = v.errors.map((e) => e.message).join('|');
      expect(messages).toMatch(/offset needs a nodeId/);
      expect(messages).toMatch(/rect must be/);
    }
  });

  it('numbers open notes in order and leaves resolved ones without a number', () => {
    const { doc } = withButton();
    let d = doc;
    for (const text of ['one', 'two', 'three']) {
      d = addAnnotation(d, { text, author: 'user', x: 0, y: 0 }).doc;
    }
    d = updateAnnotation(d, d.annotations[1]?.id as string, { status: 'resolved' });
    expect(placeAnnotations(d.annotations, () => null).map((p) => p.number)).toEqual([1, null, 2]);
    expect(openAnnotations(d)).toHaveLength(2);
    expect(addressNotesPrompt(1)).toBe('in aframe, address my open annotation');
    expect(addressNotesPrompt(3)).toBe('in aframe, address my open annotations');
  });
});

describe('where a pin is', () => {
  const at =
    (box: { x: number; y: number; w: number; h: number } | null): NodeLocator =>
    () =>
      box;

  it('follows its node: moved, resized or reflowed, the pin keeps its place inside the box', () => {
    const { doc, button } = withButton();
    const d = addAnnotation(doc, {
      text: 'n',
      author: 'user',
      x: 130,
      y: 90,
      nodeId: button,
      offset: { x: 10, y: 8 },
    }).doc;
    expect(placeAnnotations(d.annotations, at({ x: 120, y: 80, w: 120, h: 40 }))[0]).toMatchObject({
      x: 130,
      y: 88,
      detached: false,
    });
    // the button moves 200px right and 100px down: the pin goes with it
    expect(placeAnnotations(d.annotations, at({ x: 320, y: 180, w: 120, h: 40 }))[0]).toMatchObject(
      {
        x: 330,
        y: 188,
      },
    );
  });

  it('keeps a region the same size while it follows', () => {
    const { doc, button } = withButton();
    const d = addAnnotation(doc, {
      text: 'region',
      author: 'user',
      x: 130,
      y: 90,
      rect: { x: 130, y: 90, w: 60, h: 30 },
      nodeId: button,
      offset: { x: 10, y: 8 },
    }).doc;
    const [p] = placeAnnotations(d.annotations, at({ x: 500, y: 500, w: 10, h: 10 }));
    expect(p?.rect).toEqual({ x: 510, y: 508, w: 60, h: 30 });
  });

  it('falls back to the saved position when the node is gone or the note has no node', () => {
    const { doc, button } = withButton();
    const d = addAnnotation(doc, {
      text: 'n',
      author: 'user',
      x: 130,
      y: 90,
      nodeId: button,
      offset: { x: 10, y: 8 },
    }).doc;
    expect(placeAnnotations(d.annotations, at(null))[0]).toMatchObject({
      x: 130,
      y: 90,
      detached: true,
    });
    const free = addAnnotation(doc, { text: 'free', author: 'user', x: 7, y: 9 }).doc;
    expect(placeAnnotations(free.annotations, at({ x: 1, y: 1, w: 1, h: 1 }))[0]).toMatchObject({
      x: 7,
      y: 9,
      detached: false,
    });
  });

  it('survives deleting the node: the pin is kept, unattached, at its saved spot', () => {
    const { doc, button } = withButton();
    const d = addAnnotation(doc, {
      text: 'n',
      author: 'user',
      x: 130,
      y: 90,
      nodeId: button,
      offset: { x: 10, y: 8 },
    }).doc;
    const del = applyChanges(d, [{ op: 'delete', id: button }]);
    expect(del.ok).toBe(true);
    if (!del.ok) return;
    expect(del.doc.annotations[0]).toMatchObject({ x: 130, y: 90 });
    expect(del.doc.annotations[0]?.nodeId).toBeUndefined();
  });
});

describe('the annotation tools', () => {
  const ctx = (doc: Doc) => createMemoryContext(doc, { now: () => '2026-03-03T00:00:00.000Z' });

  it('add_annotation pins to a node with an offset; get_annotations shows node and frame', async () => {
    const { doc, button, frame } = withButton();
    const c = ctx(doc);
    const added = await runTool(c, 'add_annotation', {
      text: 'Why serif',
      nodeId: button.slice(2),
      x: 6,
      y: 4,
    });
    expect(added).toMatchObject({ ok: true });
    expect((await c.getDoc()).annotations[0]).toMatchObject({
      nodeId: button,
      offset: { x: 6, y: 4 },
      author: 'agent',
      x: 26,
      y: 34,
    });
    const got = await runTool(c, 'get_annotations', {});
    const list = (got as { data: { annotations: Record<string, unknown>[] } }).data.annotations;
    expect(list[0]?.node).toMatchObject({ id: button, name: 'Button' });
    expect(list[0]?.parentFrame).toMatchObject({ id: frame, name: 'Screen' });
    expect(list[0]?.number).toBe(1);
    expect(await runTool(c, 'add_annotation', { text: 'x', nodeId: 'n_nope1' })).toMatchObject({
      ok: false,
    });
    expect(await runTool(c, 'add_annotation', { text: 'free note', x: 40, y: 50 })).toMatchObject({
      ok: true,
    });
    const second = (await c.getDoc()).annotations[1];
    expect(second).toMatchObject({ x: 40, y: 50 });
    expect(second?.offset).toBeUndefined();
  });

  it('resolve_annotation closes a note with a reply', async () => {
    const { doc, button } = withButton();
    const seeded = addAnnotation(doc, {
      text: 'make it pop',
      author: 'user',
      x: 0,
      y: 0,
      nodeId: button,
      offset: { x: 1, y: 1 },
    }).doc;
    const c = ctx(seeded);
    const id = (await c.getDoc()).annotations[0]?.id as string;
    expect(await runTool(c, 'resolve_annotation', { id, reply: 'Added a glow.' })).toMatchObject({
      ok: true,
    });
    expect((await c.getDoc()).annotations[0]).toMatchObject({
      status: 'resolved',
      reply: 'Added a glow.',
    });
  });
});
