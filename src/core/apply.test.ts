import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { seededRng } from './ids';
import { deepFreeze, sampleDoc } from './testing';
import type { ApplyResult, Doc, Op } from './types';

const doc = (): Doc => deepFreeze(sampleDoc());

function ok(result: ApplyResult) {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result;
}

function failure(result: ApplyResult) {
  if (result.ok) throw new Error('expected a failure');
  return result.errors;
}

describe('applyChanges: happy path', () => {
  it('creates a nested hero with tempIds referenced by later ops, in one batch', () => {
    const ops: Op[] = [
      {
        op: 'create',
        parentId: 'n_page1',
        node: {
          type: 'frame',
          tempId: 'hero',
          name: 'Hero',
          layout: 'column',
          gap: 24,
          children: [
            { type: 'text', tempId: 'headline', text: 'Design faster' },
            {
              type: 'frame',
              tempId: 'cta',
              layout: 'row',
              children: [{ type: 'rect', tempId: 'btn' }],
            },
          ],
        },
      },
      { op: 'update', id: '$headline', set: { fontSize: 48 } },
      {
        op: 'create',
        parentId: '$cta',
        node: { type: 'text', text: 'Get started', tempId: 'label' },
      },
      { op: 'move', id: '$label', parentId: '$cta', index: 0 },
    ];
    const res = ok(applyChanges(doc(), ops, { rng: seededRng(11) }));
    expect(Object.keys(res.idMap).sort()).toEqual(['btn', 'cta', 'headline', 'hero', 'label']);
    const headline = res.doc.nodes[res.idMap.headline!]!;
    expect(headline).toMatchObject({ text: 'Design faster', fontSize: 48 });
    const cta = res.doc.nodes[res.idMap.cta!]!;
    expect(cta.children).toEqual([res.idMap.label, res.idMap.btn]);
    expect(res.created).toHaveLength(5);
    expect(res.created[0]).toBe(res.idMap.hero);
    expect(res.changed).toEqual(['n_page1']); // the page gained a child; headline was created, not changed
    expect(res.deleted).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('reports changed (own props or children), created and deleted nodes', () => {
    const ops: Op[] = [
      { op: 'update', id: 'n_title', set: { text: 'Hello' } },
      { op: 'delete', id: 'n_rectB' },
      { op: 'create', parentId: 'n_other', node: { type: 'rect', id: 'n_new01' } },
    ];
    const res = ok(applyChanges(doc(), ops));
    expect(res.created).toEqual(['n_new01']);
    expect(res.deleted).toEqual(['n_rectB']);
    expect([...res.changed].sort()).toEqual(['n_other', 'n_row', 'n_title']);
  });

  it('nets out nodes created and deleted in the same batch, and updates that are reverted', () => {
    const ops: Op[] = [
      { op: 'create', parentId: 'n_other', node: { type: 'rect', id: 'n_temp1' } },
      { op: 'delete', id: 'n_temp1' },
      { op: 'update', id: 'n_title', set: { text: 'X' } },
      { op: 'update', id: 'n_title', set: { text: 'Title' } },
    ];
    const res = ok(applyChanges(doc(), ops));
    expect(res.created).toEqual([]);
    expect(res.deleted).toEqual([]);
    expect(res.changed).toEqual([]);
  });

  it('returns the very same document for an empty or no-op batch', () => {
    const d = doc();
    expect(ok(applyChanges(d, [])).doc).toBe(d);
    expect(ok(applyChanges(d, [{ op: 'update', id: 'n_title', set: { text: 'Title' } }])).doc).toBe(
      d,
    );
  });

  it('does not touch rev or meta', () => {
    const d = doc();
    const res = ok(applyChanges(d, [{ op: 'delete', id: 'n_other' }]));
    expect(res.doc.rev).toBe(d.rev);
    expect(res.doc.meta).toBe(d.meta);
  });

  it('is deterministic with a seeded rng', () => {
    const ops: Op[] = [{ op: 'create', parentId: 'n_other', node: { type: 'rect' } }];
    expect(ok(applyChanges(doc(), ops, { rng: seededRng(8) })).created).toEqual(
      ok(applyChanges(doc(), ops, { rng: seededRng(8) })).created,
    );
  });

  it('duplicates, and lets later ops use the original ids', () => {
    const res = ok(
      applyChanges(doc(), [
        { op: 'duplicate', id: 'n_row', offset: { x: 5, y: 5 } },
        { op: 'update', id: 'n_row', set: { gap: 3 } },
      ]),
    );
    expect(res.created).toHaveLength(3);
    expect(res.doc.nodes.n_row).toMatchObject({ gap: 3 });
  });
});

describe('applyChanges: atomic failure', () => {
  it('applies nothing when op #5 fails, and reports its index', () => {
    const d = doc();
    const snapshot = JSON.stringify(d);
    const ops: Op[] = [
      { op: 'create', parentId: 'n_other', node: { type: 'rect', id: 'n_aaaa1' } },
      { op: 'update', id: 'n_title', set: { text: 'Changed' } },
      { op: 'delete', id: 'n_rectB' },
      { op: 'move', id: 'n_rectA', parentId: 'n_other' },
      { op: 'update', id: 'n_title', set: { opacity: 7 } }, // op index 4: invalid
      { op: 'create', parentId: 'n_other', node: { type: 'rect', id: 'n_zzzz1' } },
    ];
    const errors = failure(applyChanges(d, ops));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ op: 4, code: 'INVALID_VALUE', path: 'set.opacity' });
    expect(JSON.stringify(d)).toBe(snapshot); // frozen input proves nothing was mutated either
  });

  it.each<[string, Op, string]>([
    ['unknown parent', { op: 'create', parentId: 'n_gone1', node: { type: 'rect' } }, 'NOT_FOUND'],
    ['text as parent', { op: 'create', parentId: 'n_title', node: { type: 'rect' } }, 'BAD_PARENT'],
    ['cycle', { op: 'move', id: 'n_frame', parentId: 'n_row' }, 'CYCLE'],
    ['unknown node', { op: 'update', id: 'n_gone1', set: { fill: '#fff' } }, 'NOT_FOUND'],
    ['unknown tempId', { op: 'update', id: '$ghost', set: { fill: '#fff' } }, 'NOT_FOUND'],
    ['bad value', { op: 'update', id: 'n_title', set: { fill: 'url(x)' } }, 'INVALID_VALUE'],
  ])('maps %s to %s', (_name, op, code) => {
    expect(failure(applyChanges(doc(), [op]))[0]?.code).toBe(code);
  });

  it('rejects a tempId used before it is defined, or defined twice', () => {
    const early: Op[] = [
      { op: 'update', id: '$later', set: { fill: '#fff' } },
      { op: 'create', parentId: 'n_other', node: { type: 'rect', tempId: 'later' } },
    ];
    expect(failure(applyChanges(doc(), early))[0]).toMatchObject({ op: 0, code: 'NOT_FOUND' });
    const twice: Op[] = [
      { op: 'create', parentId: 'n_other', node: { type: 'rect', tempId: 'dup' } },
      { op: 'create', parentId: 'n_other', node: { type: 'rect', tempId: 'dup' } },
    ];
    expect(failure(applyChanges(doc(), twice))[0]).toMatchObject({ op: 1, code: 'INVALID_VALUE' });
  });

  it('fails when a later op depends on a node an earlier op deleted', () => {
    const ops: Op[] = [
      { op: 'delete', id: 'n_row' },
      { op: 'update', id: 'n_rectA', set: { fill: '#fff' } },
    ];
    expect(failure(applyChanges(doc(), ops))[0]).toMatchObject({ op: 1, code: 'NOT_FOUND' });
  });
});

describe('applyChanges: malformed input and limits', () => {
  const bad = (op: unknown) => failure(applyChanges(doc(), [op as Op]))[0];

  it('rejects malformed operations with a pointer to the fix', () => {
    expect(bad(5)).toMatchObject({ op: 0, code: 'INVALID_VALUE' });
    expect(bad(null)).toMatchObject({ code: 'INVALID_VALUE' });
    expect(bad({ op: 'explode' })).toMatchObject({ code: 'INVALID_VALUE', path: 'op' });
    expect(bad({ op: 'toString' })).toMatchObject({ code: 'INVALID_VALUE', path: 'op' });
    expect(bad({})).toMatchObject({ code: 'INVALID_VALUE' });
    expect(bad({ op: 'update', id: 'n_title', properties: { fill: '#fff' } })?.message).toMatch(
      /Unknown field 'properties'/,
    );
    expect(bad({ op: 'update', id: 'n_title' })).toMatchObject({ path: 'set' });
    expect(bad({ op: 'update', set: {} })).toMatchObject({ path: 'id' });
    expect(bad({ op: 'update', id: '', set: {} })).toMatchObject({ path: 'id' });
    expect(bad({ op: 'create', parentId: 'n_other' })).toMatchObject({ path: 'node' });
    expect(bad({ op: 'create', node: { type: 'rect' } })).toMatchObject({ path: 'parentId' });
    expect(
      bad({ op: 'create', parentId: 'n_other', index: 'x', node: { type: 'rect' } }),
    ).toMatchObject({ path: 'index' });
    expect(bad({ op: 'move', id: 'n_rectA' })).toMatchObject({ path: 'parentId' });
    expect(bad({ op: 'delete' })).toMatchObject({ path: 'id' });
    expect(bad({ op: 'duplicate', id: 'n_rectA', parentId: 5 })).toMatchObject({
      path: 'parentId',
    });
  });

  it('rejects a non-array operations value', () => {
    expect(failure(applyChanges(doc(), 'nope' as never))[0]?.code).toBe('INVALID_VALUE');
  });

  it('enforces the op limit (500 by default, configurable)', () => {
    const op: Op = { op: 'update', id: 'n_title', set: { text: 'x' } };
    expect(
      failure(
        applyChanges(
          doc(),
          Array.from({ length: 501 }, () => op),
        ),
      )[0],
    ).toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(
      ok(
        applyChanges(
          doc(),
          Array.from({ length: 500 }, () => op),
        ),
      ).ok,
    ).toBe(true);
    expect(failure(applyChanges(doc(), [op, op, op], { maxOps: 2 }))[0]?.code).toBe(
      'LIMIT_EXCEEDED',
    );
  });

  it('enforces the per-batch node budget across ops', () => {
    const big: Op = {
      op: 'create',
      parentId: 'n_other',
      node: {
        type: 'frame',
        children: Array.from({ length: 900 }, () => ({ type: 'rect' as const })),
      },
    };
    expect(failure(applyChanges(doc(), [big, big, big]))[0]).toMatchObject({
      op: 2,
      code: 'LIMIT_EXCEEDED',
    });
  });
});

describe('applyChanges: warnings', () => {
  it('warns (but still applies) when editing locked nodes, once per node', () => {
    const base = sampleDoc();
    const locked = deepFreeze({
      ...base,
      nodes: { ...base.nodes, n_frame: { ...base.nodes.n_frame!, locked: true } },
    });
    const res = ok(
      applyChanges(locked, [
        { op: 'update', id: 'n_title', set: { text: 'a' } }, // inside a locked frame
        { op: 'update', id: 'n_title', set: { text: 'b' } },
        { op: 'move', id: 'n_rectA', parentId: 'n_other' },
        { op: 'delete', id: 'n_frame' },
      ]),
    );
    expect(res.doc.nodes.n_frame).toBeUndefined();
    const nodes = res.warnings.filter((w) => w.code === 'LOCKED_NODE').map((w) => w.nodeId);
    expect(nodes).toEqual(['n_title', 'n_rectA', 'n_frame']);
    expect(res.warnings[0]?.message).toMatch(/locked in the editor/);
  });

  it('warns about unknown tokens on created and changed nodes only', () => {
    const base = sampleDoc();
    const withBadAlias = deepFreeze({
      ...base,
      tokens: { ...base.tokens, colors: { ...base.tokens.colors, bad: '$font.body' } },
    });
    const res = ok(
      applyChanges(withBadAlias, [
        { op: 'create', parentId: 'n_other', node: { type: 'rect', id: 'n_tok01', fill: '$nope' } },
        { op: 'update', id: 'n_title', set: { color: '$text', fontFamily: '$font.nofont' } },
        { op: 'update', id: 'n_rectA', set: { fill: '$bad' } },
      ]),
    );
    expect(res.warnings.map((w) => [w.code, w.nodeId])).toEqual([
      ['UNKNOWN_TOKEN', 'n_tok01'],
      ['UNKNOWN_TOKEN', 'n_title'],
      ['UNKNOWN_TOKEN', 'n_rectA'],
    ]);
    expect(res.warnings[0]?.message).toMatch(/\$nope is not defined/);
    expect(res.warnings[2]?.message).toMatch(/cannot be used here \(wrong type\)/);
  });
});
