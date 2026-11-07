import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { bumpRev } from './doc';
import { seededRng } from './ids';
import { changedNodeIds, mergeDocs, sameContent } from './merge';
import { deepFreeze, sampleDoc } from './testing';
import type { Doc, Op } from './types';
import { validateDoc } from './validate';

const base = deepFreeze(sampleDoc());

/** Applies ops the way a writer would: edit, then bump rev. */
function edit(doc: Doc, ops: Op[], writer: 'app' | 'mcp' = 'app'): Doc {
  const r = applyChanges(doc, ops);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return bumpRev(r.doc, writer, '2026-02-02T00:00:00.000Z');
}
const set = (id: string, props: Record<string, unknown>): Op => ({ op: 'update', id, set: props });
const node = (doc: Doc, id: string) => doc.nodes[id];

describe('trivial cases', () => {
  it('local untouched: the remote document is taken as it is', () => {
    const remote = edit(base, [set('n_other', { x: 900 })], 'mcp');
    const r = mergeDocs(base, base, remote);
    expect(r.mode).toBe('remote');
    expect(r.doc).toBe(remote);
    expect(r.conflicts).toEqual([]);
  });

  it('remote untouched (only a rev bump): the local document is kept', () => {
    const local = edit(base, [set('n_other', { x: 700 })]);
    const remote = { ...base, rev: 40 };
    const r = mergeDocs(base, local, remote);
    expect(r.mode).toBe('local');
    expect(node(r.doc, 'n_other')?.x).toBe(700);
    expect(r.doc.rev).toBeGreaterThan(40); // still saveable over what is on disk
  });

  it('both sides made the same edit', () => {
    const a = edit(base, [set('n_other', { x: 700 })]);
    const b = edit(base, [set('n_other', { x: 700 })], 'mcp');
    expect(mergeDocs(base, a, b).mode).toBe('local');
  });
});

describe('three-way merge', () => {
  it('keeps both when the sides edited different nodes', () => {
    const local = edit(base, [set('n_other', { x: 700 })]);
    const remote = edit(base, [set('n_title', { text: 'Hello from the agent' })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(r.mode).toBe('merged');
    expect(node(r.doc, 'n_other')?.x).toBe(700);
    expect(node(r.doc, 'n_title')).toMatchObject({ text: 'Hello from the agent' });
    expect(r.conflicts).toEqual([]);
    expect(validateDoc(r.doc).ok).toBe(true);
  });

  it('keeps both when the sides edited different properties of the same node', () => {
    const local = edit(base, [set('n_title', { fontSize: 40 })]);
    const remote = edit(base, [set('n_title', { color: '#ff0000' })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(node(r.doc, 'n_title')).toMatchObject({ fontSize: 40, color: '#ff0000' });
    expect(r.conflicts).toEqual([]);
  });

  it('the remote value wins when both changed the same property, and the node is reported', () => {
    const local = edit(base, [set('n_other', { x: 700 })]);
    const remote = edit(base, [set('n_other', { x: 123 })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(node(r.doc, 'n_other')?.x).toBe(123);
    expect(r.conflicts).toEqual(['n_other']);
  });

  it('a property removed on one side stays removed', () => {
    const withColor = edit(base, [set('n_title', { color: '#112233' })]);
    const local = edit(withColor, [set('n_other', { x: 1 })]);
    const remote = edit(withColor, [set('n_title', { color: null })], 'mcp');
    const r = mergeDocs(withColor, local, remote);
    expect(node(r.doc, 'n_title')?.color).toBeUndefined();
    expect(node(r.doc, 'n_other')?.x).toBe(1);
  });

  it('merged document is a new revision after both, stamped as written by the app', () => {
    const local = edit(base, [set('n_other', { x: 700 })]);
    const remote = edit(
      edit(base, [set('n_title', { text: 'a' })], 'mcp'),
      [set('n_title', { text: 'b' })],
      'mcp',
    );
    const r = mergeDocs(base, local, remote);
    expect(r.doc.rev).toBeGreaterThan(Math.max(local.rev, remote.rev));
    expect(r.doc.meta.lastWriter).toBe('app');
  });

  it('untouched nodes keep their identity (cheap, and history stays small)', () => {
    const local = edit(base, [set('n_other', { x: 700 })]);
    const remote = edit(base, [set('n_title', { text: 'x' })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(r.doc.nodes.n_recta).toBe(base.nodes.n_recta);
    expect(r.doc.nodes.n_other).toBe(local.nodes.n_other);
    expect(r.doc.nodes.n_title).toBe(remote.nodes.n_title);
  });
});

describe('structure', () => {
  const addRect = (parent: string, name: string): Op => ({
    op: 'create',
    parentId: parent,
    node: { type: 'rect', name, w: 10, h: 10 },
  });

  it('both sides added children to the same parent: both are there, remote first', () => {
    const local = edit(base, [addRect('n_row1', 'Local rect')]);
    const remote = edit(base, [addRect('n_row1', 'Remote rect')], 'mcp');
    const r = mergeDocs(base, local, remote);
    const names = (node(r.doc, 'n_row1')?.children ?? []).map((id) => node(r.doc, id)?.name);
    expect(names).toEqual(['A', 'B', 'Remote rect', 'Local rect']);
    expect(validateDoc(r.doc).ok).toBe(true);
  });

  it('a delete on one side and an unrelated edit on the other both apply', () => {
    const local = edit(base, [{ op: 'delete', id: 'n_recta' }]);
    const remote = edit(base, [set('n_other', { x: 5 })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(r.doc.nodes.n_recta).toBeUndefined();
    expect(node(r.doc, 'n_row1')?.children).toEqual(['n_rectb']);
    expect(node(r.doc, 'n_other')?.x).toBe(5);
  });

  it('only one side reordered: that order is kept', () => {
    const local = edit(base, [{ op: 'move', id: 'n_recta', parentId: 'n_row1', index: 1 }]);
    const remote = edit(base, [set('n_other', { x: 5 })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(node(r.doc, 'n_row1')?.children).toEqual(['n_rectb', 'n_recta']);
  });

  it('a move on one side and an edit of the same node on the other both apply', () => {
    const local = edit(base, [{ op: 'move', id: 'n_recta', parentId: 'n_frame' }]);
    const remote = edit(base, [set('n_recta', { fill: '#00ff00' })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(node(r.doc, 'n_recta')).toMatchObject({ parentId: 'n_frame', fill: '#00ff00' });
    expect(node(r.doc, 'n_frame')?.children).toContain('n_recta');
    expect(node(r.doc, 'n_row1')?.children).not.toContain('n_recta');
  });

  it('remote deleted a frame the user added a child to: the child goes with it and is reported', () => {
    const local = edit(base, [addRect('n_row1', 'Mine')]);
    const remote = edit(base, [{ op: 'delete', id: 'n_row1' }], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(r.doc.nodes.n_row1).toBeUndefined();
    expect(Object.values(r.doc.nodes).some((n) => n.name === 'Mine')).toBe(false);
    expect(r.conflicts).toContain('n_row1');
    expect(validateDoc(r.doc).ok).toBe(true);
  });

  it('user deleted a node the agent edited: remote wins and the node stays', () => {
    const local = edit(base, [{ op: 'delete', id: 'n_title' }]);
    const remote = edit(base, [set('n_title', { text: 'Edited' })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(node(r.doc, 'n_title')?.text).toBe('Edited');
    expect(r.conflicts).toEqual(['n_title']);
    expect(node(r.doc, 'n_frame')?.children).toContain('n_title');
  });

  it('two moves that would make a cycle fall back to the remote document', () => {
    // Each move is fine on its own; together n_frame and n_other would contain each other.
    const local = edit(base, [{ op: 'move', id: 'n_frame', parentId: 'n_other' }]);
    const remote = edit(base, [{ op: 'move', id: 'n_other', parentId: 'n_frame' }], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(r.mode).toBe('remote-fallback');
    expect(r.doc).toBe(remote);
    expect(validateDoc(r.doc).ok).toBe(true);
  });
});

describe('tokens, name, assets, annotations', () => {
  it('merges tokens key by key', () => {
    const local = edit(base, []);
    const l: Doc = {
      ...local,
      tokens: { ...local.tokens, colors: { ...local.tokens.colors, mine: '#111111' } },
    };
    const remote: Doc = bumpRev(
      { ...base, tokens: { ...base.tokens, colors: { ...base.tokens.colors, theirs: '#222222' } } },
      'mcp',
    );
    const r = mergeDocs(base, l, remote);
    expect(r.doc.tokens.colors).toMatchObject({ mine: '#111111', theirs: '#222222' });
  });

  it('a renamed project on one side and an edit on the other both apply', () => {
    const local: Doc = { ...edit(base, [set('n_other', { x: 9 })]), name: 'Renamed' };
    const remote = edit(base, [set('n_title', { text: 'T' })], 'mcp');
    const r = mergeDocs(base, local, remote);
    expect(r.doc.name).toBe('Renamed');
    expect(node(r.doc, 'n_title')?.text).toBe('T');
  });

  it('assets added on both sides are both kept', () => {
    const l: Doc = bumpRev({ ...base, assets: { a_one: 'data:image/png;base64,AAAA' } }, 'app');
    const r2: Doc = bumpRev({ ...base, assets: { a_two: 'data:image/png;base64,BBBB' } }, 'mcp');
    const r = mergeDocs(base, l, r2);
    expect(Object.keys(r.doc.assets).sort()).toEqual(['a_one', 'a_two']);
  });

  it('annotations from both sides survive, remote order first', () => {
    const note = (id: string, text: string) => ({
      id,
      x: 0,
      y: 0,
      text,
      author: 'user' as const,
      status: 'open' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const l: Doc = bumpRev({ ...base, annotations: [note('a_mine1', 'mine')] }, 'app');
    const r2: Doc = bumpRev({ ...base, annotations: [note('a_their1', 'theirs')] }, 'mcp');
    expect(mergeDocs(base, l, r2).doc.annotations.map((a) => a.id)).toEqual([
      'a_their1',
      'a_mine1',
    ]);
  });
});

describe('helpers', () => {
  it('sameContent ignores rev and meta', () => {
    expect(sameContent(base, bumpRev(base, 'mcp', '2030-01-01T00:00:00.000Z'))).toBe(true);
    expect(sameContent(base, edit(base, [set('n_other', { x: 1 })]))).toBe(false);
  });

  it('changedNodeIds lists added, removed and changed nodes', () => {
    const next = edit(base, [set('n_other', { x: 1 }), { op: 'delete', id: 'n_recta' }]);
    expect(changedNodeIds(base, next).sort()).toEqual(['n_other', 'n_recta', 'n_row1']);
    expect(changedNodeIds(base, base)).toEqual([]);
  });
});

describe('random scenarios', () => {
  /** A few random, valid edits. Independent for each side. */
  function randomEdits(doc: Doc, rng: () => number, writer: 'app' | 'mcp'): Doc {
    let cur = doc;
    const count = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const ids = Object.keys(cur.nodes).filter((id) => id !== cur.rootId);
      const frames = Object.values(cur.nodes)
        .filter((n) => n.type === 'frame' || n.id === cur.rootId)
        .map((n) => n.id);
      const pickOf = <T>(list: T[]): T => list[Math.floor(rng() * list.length)] as T;
      const roll = rng();
      const ops: Op[] =
        roll < 0.45
          ? [set(pickOf(ids), { x: Math.floor(rng() * 500) })]
          : roll < 0.65
            ? [set(pickOf(ids), { opacity: Math.round(rng() * 10) / 10 })]
            : roll < 0.8
              ? [
                  {
                    op: 'create',
                    parentId: pickOf(frames),
                    node: { type: 'rect', w: 10, h: 10, name: `r${Math.floor(rng() * 1e6)}` },
                  },
                ]
              : roll < 0.9
                ? [{ op: 'delete', id: pickOf(ids) }]
                : [{ op: 'move', id: pickOf(ids), parentId: pickOf(frames) }];
      const r = applyChanges(cur, ops);
      if (r.ok) cur = bumpRev(r.doc, writer, '2026-03-03T00:00:00.000Z');
    }
    return cur;
  }

  it('always returns a valid document with a newer rev than both sides (300 scenarios)', () => {
    const rng = seededRng(2024);
    let merged = 0;
    let clean = 0;
    for (let i = 0; i < 300; i++) {
      const local = randomEdits(base, rng, 'app');
      const remote = randomEdits(base, rng, 'mcp');
      const r = mergeDocs(base, local, remote);
      const check = validateDoc(r.doc);
      expect(check.ok, `scenario ${i}: ${r.mode}`).toBe(true);
      if (r.mode === 'merged') {
        merged += 1;
        expect(r.doc.rev).toBeGreaterThan(Math.max(local.rev, remote.rev));
        if (r.conflicts.length === 0) {
          clean += 1;
          // With no conflict, every node only the user touched is exactly as the user left it.
          for (const id of changedNodeIds(base, local)) {
            if (!changedNodeIds(base, remote).includes(id) && local.nodes[id] !== undefined) {
              const want = { ...local.nodes[id] } as Record<string, unknown>;
              const got = { ...r.doc.nodes[id]! } as Record<string, unknown>;
              if (r.doc.nodes[id] !== undefined) {
                delete want.children;
                delete got.children;
                delete want.parentId;
                delete got.parentId;
                expect(got, `scenario ${i}, node ${id}`).toEqual(want);
              }
            }
          }
        }
      }
    }
    expect(merged).toBeGreaterThan(100); // the generator really exercises the merge path
    expect(clean).toBeGreaterThan(30);
  });
});
