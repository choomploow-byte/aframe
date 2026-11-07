import { describe, expect, it } from 'vitest';
import { CoreError } from './errors';
import { seededRng } from './ids';
import { createNode, deleteNode, duplicateNode, moveNode, updateNode } from './ops';
import { deepFreeze, sampleDoc } from './testing';
import type { Doc, NodeSpec } from './types';

const doc = (): Doc => deepFreeze(sampleDoc());

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof CoreError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

describe('createNode', () => {
  it('appends a normalised node to a frame and shares untouched nodes', () => {
    const d = doc();
    const out = createNode(d, 'n_frame', { type: 'rect', fill: '#fff' }, { rng: seededRng(1) });
    const created = out.doc.nodes[out.rootId]!;
    expect(created).toMatchObject({
      type: 'rect',
      parentId: 'n_frame',
      fill: '#fff',
      w: 100,
      h: 100,
      visible: true,
    });
    expect(out.created).toEqual([out.rootId]);
    expect(out.doc.nodes.n_frame!.children).toEqual(['n_title', 'n_row', out.rootId]);
    // Structural sharing: only the parent and the new node are new objects.
    expect(out.doc.nodes.n_title).toBe(d.nodes.n_title);
    expect(out.doc.nodes.n_row).toBe(d.nodes.n_row);
    expect(out.doc.nodes.n_other).toBe(d.nodes.n_other);
    expect(out.doc.nodes.n_frame).not.toBe(d.nodes.n_frame);
    expect(d.nodes.n_frame!.children).toEqual(['n_title', 'n_row']); // input untouched
  });

  it('inserts at an index, including 0 and the end', () => {
    const d = doc();
    const first = createNode(d, 'n_frame', { type: 'rect' }, { index: 0 });
    expect(first.doc.nodes.n_frame!.children[0]).toBe(first.rootId);
    const last = createNode(d, 'n_frame', { type: 'rect' }, { index: 2 });
    expect(last.doc.nodes.n_frame!.children[2]).toBe(last.rootId);
  });

  it('creates nested children with tempIds and an explicit id', () => {
    const spec: NodeSpec = {
      type: 'frame',
      tempId: 'hero',
      layout: 'column',
      children: [
        { type: 'text', text: 'Hi', tempId: 'headline' },
        { type: 'rect', id: 'n_fixed1' },
      ],
    };
    const out = createNode(doc(), 'n_other', spec, { rng: seededRng(5) });
    expect(out.created).toHaveLength(3);
    expect(out.created[0]).toBe(out.rootId);
    expect(out.idMap.hero).toBe(out.rootId);
    const hero = out.doc.nodes[out.rootId]!;
    expect(hero.children).toEqual([out.idMap.headline, 'n_fixed1']);
    expect(out.doc.nodes.n_fixed1).toMatchObject({ parentId: out.rootId });
  });

  it('can create under the page (an artboard)', () => {
    const out = createNode(doc(), 'n_page1', { type: 'frame', x: 10, y: 20, w: 300, h: 200 });
    expect(out.doc.nodes.n_page1!.children.at(-1)).toBe(out.rootId);
  });

  it('rejects bad parents, types and values with actionable errors', () => {
    const d = doc();
    expect(codeOf(() => createNode(d, 'n_missing', { type: 'rect' }))).toBe('NOT_FOUND');
    expect(codeOf(() => createNode(d, 'n_title', { type: 'rect' }))).toBe('BAD_PARENT');
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'page' as never }))).toBe('INVALID_VALUE');
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'blob' as never }))).toBe('INVALID_VALUE');
    expect(codeOf(() => createNode(d, 'n_frame', 'rect' as never))).toBe('INVALID_VALUE');
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'rect', opacity: 5 }))).toBe(
      'INVALID_VALUE',
    );
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'rect', fontSize: 12 }))).toBe(
      'INVALID_VALUE',
    );
    expect(
      codeOf(() => createNode(d, 'n_frame', { type: 'rect', children: [{ type: 'rect' }] })),
    ).toBe('BAD_PARENT');
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'frame', children: 'x' as never }))).toBe(
      'INVALID_VALUE',
    );
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'rect' }, { index: 9 }))).toBe(
      'INVALID_VALUE',
    );
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'rect' }, { index: -1 }))).toBe(
      'INVALID_VALUE',
    );
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'rect' }, { index: 0.5 }))).toBe(
      'INVALID_VALUE',
    );
  });

  it('puts the failing path and a hint on the error', () => {
    try {
      createNode(doc(), 'n_title', { type: 'rect' });
    } catch (e) {
      expect(e).toBeInstanceOf(CoreError);
      expect((e as CoreError).message).toBe(
        'Parent n_title is a text node; only frames can have children.',
      );
      expect((e as CoreError).hint).toMatch(/n_frame/);
    }
    try {
      createNode(doc(), 'n_frame', { type: 'frame', children: [{ type: 'rect', fill: 'url(x)' }] });
    } catch (e) {
      expect((e as CoreError).path).toBe('node.children.0.fill');
    }
  });

  it('rejects invalid or clashing ids and tempIds', () => {
    const d = doc();
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'rect', id: 'BAD' }))).toBe(
      'INVALID_VALUE',
    );
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'rect', id: 'n_title' }))).toBe(
      'INVALID_VALUE',
    );
    expect(codeOf(() => createNode(d, 'n_frame', { type: 'rect', tempId: '1x' }))).toBe(
      'INVALID_VALUE',
    );
    expect(
      codeOf(() =>
        createNode(d, 'n_frame', {
          type: 'frame',
          tempId: 'a',
          children: [{ type: 'rect', tempId: 'a' }],
        }),
      ),
    ).toBe('INVALID_VALUE');
  });

  it('refuses absurd nesting and sizes', () => {
    let spec: NodeSpec = { type: 'rect' };
    for (let i = 0; i < 70; i += 1) spec = { type: 'frame', children: [spec] };
    expect(codeOf(() => createNode(doc(), 'n_frame', spec))).toBe('LIMIT_EXCEEDED');

    const wide: NodeSpec = {
      type: 'frame',
      children: Array.from({ length: 2001 }, () => ({ type: 'rect' as const })),
    };
    expect(codeOf(() => createNode(doc(), 'n_frame', wide))).toBe('LIMIT_EXCEEDED');
  });

  it('never reuses ids inside one call', () => {
    const spec: NodeSpec = {
      type: 'frame',
      children: Array.from({ length: 200 }, () => ({ type: 'rect' as const })),
    };
    const out = createNode(doc(), 'n_frame', spec, { rng: () => 0.25 });
    expect(new Set(out.created).size).toBe(out.created.length);
  });
});

describe('updateNode', () => {
  it('sets properties and shares everything else', () => {
    const d = doc();
    const next = updateNode(d, 'n_title', { text: 'New', fontSize: 30 });
    expect(next.nodes.n_title).toMatchObject({ text: 'New', fontSize: 30 });
    expect(next.nodes.n_frame).toBe(d.nodes.n_frame);
    expect(d.nodes.n_title).toMatchObject({ text: 'Title', fontSize: 24 });
  });

  it('removes optional properties with null', () => {
    const d = updateNode(doc(), 'n_rectA', { fill: '#fff', stroke: '#000' });
    const next = updateNode(d, 'n_rectA', { fill: null });
    expect(next.nodes.n_rectA).not.toHaveProperty('fill');
    expect(next.nodes.n_rectA).toHaveProperty('stroke', '#000');
  });

  it('returns the same document when nothing changes', () => {
    const d = doc();
    expect(updateNode(d, 'n_title', { text: 'Title' })).toBe(d);
    expect(updateNode(d, 'n_title', {})).toBe(d);
    expect(updateNode(d, 'n_rectA', { fill: null })).toBe(d); // removing what is not there
  });

  it('renames text layers that still have an auto name, but not custom names', () => {
    const d = doc();
    const auto = updateNode(d, 'n_title', { text: 'Fresh copy' });
    expect(auto.nodes.n_title!.name).toBe('Fresh copy');
    const custom = updateNode(updateNode(d, 'n_title', { name: 'Headline' }), 'n_title', {
      text: 'Other',
    });
    expect(custom.nodes.n_title!.name).toBe('Headline');
    const both = updateNode(d, 'n_title', { text: 'Other', name: 'Mine' });
    expect(both.nodes.n_title!.name).toBe('Mine');
  });

  it('allows renaming the page but nothing else on it', () => {
    const d = doc();
    expect(updateNode(d, 'n_page1', { name: 'Home' }).nodes.n_page1!.name).toBe('Home');
    expect(codeOf(() => updateNode(d, 'n_page1', { opacity: 0.5 }))).toBe('INVALID_VALUE');
  });

  it('rejects unknown nodes, bad patches and wrong-type props', () => {
    const d = doc();
    expect(codeOf(() => updateNode(d, 'n_missing', { fill: '#fff' }))).toBe('NOT_FOUND');
    expect(codeOf(() => updateNode(d, 'n_title', 'x' as never))).toBe('INVALID_VALUE');
    expect(codeOf(() => updateNode(d, 'n_title', { layout: 'row' }))).toBe('INVALID_VALUE');
    expect(codeOf(() => updateNode(d, 'n_title', { opacity: null }))).toBe('INVALID_VALUE');
    expect(codeOf(() => updateNode(d, 'n_title', { type: 'rect' } as never))).toBe('INVALID_VALUE');
    expect(codeOf(() => updateNode(d, 'n_title', { children: [] } as never))).toBe('INVALID_VALUE');
  });
});

describe('deleteNode', () => {
  it('removes the subtree and its entry in the parent', () => {
    const d = doc();
    const out = deleteNode(d, 'n_row');
    expect(out.deleted).toEqual(['n_row', 'n_rectA', 'n_rectB']);
    expect(Object.keys(out.doc.nodes).sort()).toEqual(['n_frame', 'n_other', 'n_page1', 'n_title']);
    expect(out.doc.nodes.n_frame!.children).toEqual(['n_title']);
    expect(out.doc.nodes.n_title).toBe(d.nodes.n_title);
  });

  it('refuses the page and unknown nodes', () => {
    expect(codeOf(() => deleteNode(doc(), 'n_page1'))).toBe('INVALID_VALUE');
    expect(codeOf(() => deleteNode(doc(), 'n_gone1'))).toBe('NOT_FOUND');
  });

  it('unpins annotations that pointed at deleted nodes but keeps untouched ones', () => {
    const base = sampleDoc();
    const withPins: Doc = deepFreeze({
      ...base,
      annotations: [
        {
          id: 'a_pin01',
          nodeId: 'n_rectA',
          x: 5,
          y: 6,
          text: 'x',
          author: 'user',
          status: 'open',
          createdAt: 't',
        },
        {
          id: 'a_pin02',
          nodeId: 'n_title',
          x: 1,
          y: 2,
          text: 'y',
          author: 'user',
          status: 'open',
          createdAt: 't',
        },
        { id: 'a_pin03', x: 3, y: 4, text: 'z', author: 'user', status: 'open', createdAt: 't' },
      ],
    });
    const out = deleteNode(withPins, 'n_row').doc;
    expect(out.annotations[0]).toEqual({
      id: 'a_pin01',
      x: 5,
      y: 6,
      text: 'x',
      author: 'user',
      status: 'open',
      createdAt: 't',
    });
    expect(out.annotations[1]).toBe(withPins.annotations[1]);
    expect(out.annotations[2]).toBe(withPins.annotations[2]);
  });
});

describe('moveNode', () => {
  it('reorders inside the same parent', () => {
    const d = doc();
    const next = moveNode(d, 'n_title', 'n_frame', 1);
    expect(next.nodes.n_frame!.children).toEqual(['n_row', 'n_title']);
    expect(moveNode(d, 'n_title', 'n_frame').nodes.n_frame!.children).toEqual(['n_row', 'n_title']);
    expect(moveNode(d, 'n_title', 'n_frame', 0)).toBe(d); // already there: no change
  });

  it('moves between parents and updates parentId', () => {
    const d = doc();
    const next = moveNode(d, 'n_rectA', 'n_other', 0);
    expect(next.nodes.n_rectA!.parentId).toBe('n_other');
    expect(next.nodes.n_other!.children).toEqual(['n_rectA']);
    expect(next.nodes.n_row!.children).toEqual(['n_rectB']);
    expect(next.nodes.n_rectB).toBe(d.nodes.n_rectB);
  });

  it('rejects cycles, bad parents, bad indexes and the page', () => {
    const d = doc();
    expect(codeOf(() => moveNode(d, 'n_frame', 'n_frame'))).toBe('CYCLE');
    expect(codeOf(() => moveNode(d, 'n_frame', 'n_rectA'))).toBe('BAD_PARENT');
    expect(codeOf(() => moveNode(d, 'n_frame', 'n_row'))).toBe('CYCLE');
    expect(codeOf(() => moveNode(d, 'n_row', 'n_title'))).toBe('BAD_PARENT');
    expect(codeOf(() => moveNode(d, 'n_rectA', 'n_other', 5))).toBe('INVALID_VALUE');
    expect(codeOf(() => moveNode(d, 'n_rectA', 'n_row', 2))).toBe('INVALID_VALUE'); // max is 1 after removal
    expect(codeOf(() => moveNode(d, 'n_page1', 'n_other'))).toBe('INVALID_VALUE');
    expect(codeOf(() => moveNode(d, 'n_gone1', 'n_other'))).toBe('NOT_FOUND');
    expect(codeOf(() => moveNode(d, 'n_rectA', 'n_gone1'))).toBe('NOT_FOUND');
  });
});

describe('duplicateNode', () => {
  it('deep copies with fresh ids and places the copy after the original', () => {
    const d = doc();
    const out = duplicateNode(d, 'n_row', { rng: seededRng(3) });
    expect(out.created).toHaveLength(3);
    expect(out.created[0]).toBe(out.rootId);
    const copy = out.doc.nodes[out.rootId]!;
    expect(copy).toMatchObject({ type: 'frame', name: 'Row', layout: 'row', parentId: 'n_frame' });
    expect(copy.children).toHaveLength(2);
    for (const childId of copy.children) {
      expect(out.doc.nodes[childId]!.parentId).toBe(out.rootId);
      expect(['n_rectA', 'n_rectB']).not.toContain(childId);
    }
    expect(out.doc.nodes.n_frame!.children).toEqual(['n_title', 'n_row', out.rootId]);
    expect(out.doc.nodes.n_row).toBe(d.nodes.n_row);
  });

  it('inserts right after the original, not at the end', () => {
    const d = doc();
    const out = duplicateNode(d, 'n_title');
    expect(out.doc.nodes.n_frame!.children).toEqual(['n_title', out.rootId, 'n_row']);
  });

  it('applies an offset to the copy only', () => {
    const d = doc();
    const out = duplicateNode(d, 'n_other', { offset: { x: 20, y: 30 } });
    expect(out.doc.nodes[out.rootId]).toMatchObject({ x: 520, y: 30 });
    expect(out.doc.nodes.n_other).toMatchObject({ x: 500, y: 0 });
  });

  it('can copy into another parent, appended', () => {
    const out = duplicateNode(doc(), 'n_title', { parentId: 'n_other' });
    expect(out.doc.nodes.n_other!.children).toEqual([out.rootId]);
    expect(out.doc.nodes.n_frame!.children).toEqual(['n_title', 'n_row']);
  });

  it('rejects the page, cycles, bad targets and bad offsets', () => {
    const d = doc();
    expect(codeOf(() => duplicateNode(d, 'n_page1'))).toBe('INVALID_VALUE');
    expect(codeOf(() => duplicateNode(d, 'n_gone1'))).toBe('NOT_FOUND');
    expect(codeOf(() => duplicateNode(d, 'n_frame', { parentId: 'n_row' }))).toBe('CYCLE');
    expect(codeOf(() => duplicateNode(d, 'n_frame', { parentId: 'n_frame' }))).toBe('CYCLE');
    expect(codeOf(() => duplicateNode(d, 'n_title', { parentId: 'n_rectA' }))).toBe('BAD_PARENT');
    expect(codeOf(() => duplicateNode(d, 'n_title', { offset: { x: Number.NaN, y: 0 } }))).toBe(
      'INVALID_VALUE',
    );
    expect(codeOf(() => duplicateNode(d, 'n_title', { offset: 'x' as never }))).toBe(
      'INVALID_VALUE',
    );
  });
});
