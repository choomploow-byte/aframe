import { applyChanges } from '@core/apply';
import { buildDoc, deepFreeze, sampleDoc } from '@core/testing';
import type { Doc } from '@core/types';
import { describe, expect, it } from 'vitest';
import { fuzzyScore, rankItems } from './fuzzy';
import { buildGradient, DEFAULT_GRADIENT, isGradient, parseGradient } from './gradient';
import {
  buildRows,
  dropOps,
  isContainer,
  rangeBetween,
  withAncestorsExpanded,
} from './layers-model';
import { evaluateExpression } from './math';
import { commonValue } from './mixed';

describe('evaluateExpression', () => {
  it.each([
    ['16', 16],
    ['16*2', 32],
    ['(100-8)/2', 46],
    ['-4+10%3', -3],
    [' 2 + 3 * 4 ', 14],
    ['12.5', 12.5],
    ['.5*4', 2],
    ['10px', 10],
    ['1,5*2', 3],
    ['--3', 3],
    ['+7', 7],
    ['2*(3+(4-1))', 12],
    ['1/3', 1 / 3],
  ])('%s = %s', (text, expected) => {
    expect(evaluateExpression(text)).toBeCloseTo(expected, 9);
  });

  it.each([
    '',
    '   ',
    'abc',
    '1+',
    '*2',
    '(1',
    '1)',
    '1/0',
    '5%0',
    '1 2',
    '2**3',
    'alert(1)',
    'process.exit()',
    '1e3',
    'x'.repeat(200),
    `${'('.repeat(40)}1${')'.repeat(40)}`,
  ])('rejects %j', (text) => {
    expect(evaluateExpression(text)).toBeNull();
  });
});

describe('fuzzy', () => {
  it('matches subsequences case-insensitively and ranks tighter matches first', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('zzz', 'Add frame')).toBeNull();
    expect(fuzzyScore('af', 'Add frame')).not.toBeNull();
    expect(fuzzyScore('frame', 'Frame tool')! > fuzzyScore('frame', 'Add a frame tool')!).toBe(
      true,
    );
    expect(fuzzyScore('ud', 'Undo')! > fuzzyScore('ud', 'Duplicate selection')!).toBe(true);
  });

  it('rankItems drops non-matches, orders by score, and is stable for ties', () => {
    const items = ['Undo', 'Redo', 'Duplicate', 'Delete'];
    expect(rankItems(items, 'do', (s) => s)).toEqual(['Undo', 'Redo']);
    expect(rankItems(items, 'de', (s) => s)[0]).toBe('Delete');
    expect(rankItems(items, '', (s) => s)).toEqual(items);
    expect(rankItems(['b1', 'b2', 'b3'], 'b', (s) => s)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('gradient model', () => {
  it('builds and parses the canonical forms and round-trips them', () => {
    const css = buildGradient(DEFAULT_GRADIENT);
    expect(css).toBe('linear-gradient(90deg, #5B3CB0 0%, #ECE6F8 100%)');
    expect(parseGradient(css)).toEqual(DEFAULT_GRADIENT);
    const radial = buildGradient({
      kind: 'radial',
      angle: 0,
      stops: [
        { color: '$primary', at: 0 },
        { color: 'rgba(0,0,0,0.5)', at: 55.555 },
      ],
    });
    expect(radial).toBe('radial-gradient(circle, $primary 0%, rgba(0,0,0,0.5) 55.56%)');
    expect(parseGradient(radial)).toMatchObject({
      kind: 'radial',
      stops: [
        { color: '$primary', at: 0 },
        { color: 'rgba(0,0,0,0.5)', at: 55.56 },
      ],
    });
  });

  it('reads angles, missing stop positions and token or rgb colours', () => {
    expect(parseGradient('linear-gradient(45deg, #fff, $mid, rgb(1,2,3))')).toEqual({
      kind: 'linear',
      angle: 45,
      stops: [
        { color: '#fff', at: 0 },
        { color: '$mid', at: 50 },
        { color: 'rgb(1,2,3)', at: 100 },
      ],
    });
    expect(parseGradient('linear-gradient(#000 10%, #fff 90%)')?.angle).toBe(90);
  });

  it('leaves anything it cannot read to the raw field', () => {
    for (const odd of [
      'linear-gradient(to right, #fff, #000)',
      'linear-gradient(#fff)',
      'conic-gradient(#fff, #000)',
      'radial-gradient(at top, #fff, #000)',
      '#fff',
      '',
    ]) {
      expect(parseGradient(odd), odd).toBeNull();
    }
  });

  it('clamps stop positions when building and detects gradient strings', () => {
    expect(
      buildGradient({
        kind: 'linear',
        angle: 0,
        stops: [
          { color: '#fff', at: -10 },
          { color: '#000', at: 250 },
        ],
      }),
    ).toBe('linear-gradient(0deg, #fff 0%, #000 100%)');
    expect(isGradient('linear-gradient(0deg, #fff 0%, #000 100%)')).toBe(true);
    expect(isGradient('radial-gradient(circle, #fff 0%, #000 100%)')).toBe(true);
    expect(isGradient('#fff')).toBe(false);
    expect(isGradient(undefined)).toBe(false);
  });
});

describe('commonValue', () => {
  it('reports one shared value, or mixed', () => {
    expect(commonValue([])).toEqual({ mixed: false, value: undefined });
    expect(commonValue([4, 4, 4])).toEqual({ mixed: false, value: 4 });
    expect(commonValue([4, 5])).toEqual({ mixed: true, value: undefined });
    expect(
      commonValue([
        [1, 2],
        [1, 2],
      ]),
    ).toEqual({ mixed: false, value: [1, 2] });
    expect(
      commonValue([
        [1, 2],
        [1, 3],
      ]).mixed,
    ).toBe(true);
    expect(commonValue([undefined, undefined])).toEqual({ mixed: false, value: undefined });
    expect(commonValue([undefined, 'x']).mixed).toBe(true);
  });
});

describe('layers model', () => {
  const doc = deepFreeze(sampleDoc());
  const open = (...ids: string[]) => new Set(ids);

  it('lists top-most layers first and respects collapsed branches', () => {
    const rows = buildRows(doc, open());
    expect(rows.map((r) => [r.id, r.depth, r.expanded])).toEqual([
      ['n_other', 0, false],
      ['n_frame', 0, false],
    ]);
    const all = buildRows(doc, open('n_frame', 'n_row1'));
    expect(all.map((r) => r.id)).toEqual([
      'n_other',
      'n_frame',
      'n_row1',
      'n_rectb',
      'n_recta',
      'n_title',
    ]);
    expect(all.find((r) => r.id === 'n_rectb')).toMatchObject({
      depth: 2,
      parentId: 'n_row1',
      hasChildren: false,
    });
    expect(all.find((r) => r.id === 'n_frame')).toMatchObject({
      hasChildren: true,
      expanded: true,
      name: 'Card',
    });
  });

  it('filters by name, keeping the ancestors of matches expanded', () => {
    // Layer names, not ids: the row frame is called "Row", its children "A" and "B".
    const rows = buildRows(doc, open(), 'row');
    expect(rows.map((r) => r.id)).toEqual(['n_frame', 'n_row1']);
    expect(buildRows(doc, open(), 'B').map((r) => r.id)).toEqual(['n_frame', 'n_row1', 'n_rectb']);
    expect(buildRows(doc, open(), '  CARD ').map((r) => r.id)).toEqual(['n_frame']);
    expect(buildRows(doc, open(), 'nothing like it')).toEqual([]);
  });

  it('shows hidden and locked state', () => {
    const edited = applyChanges(doc, [
      { op: 'update', id: 'n_title', set: { visible: false, locked: true } },
    ]);
    if (!edited.ok) throw new Error('setup');
    const row = buildRows(edited.doc, open('n_frame')).find((r) => r.id === 'n_title');
    expect(row).toMatchObject({ visible: false, locked: true });
  });

  it('expands the ancestors of the selection', () => {
    expect([...withAncestorsExpanded(doc, ['n_recta'], open())].sort()).toEqual([
      'n_frame',
      'n_row1',
    ]);
    expect([...withAncestorsExpanded(doc, ['n_frame'], open('x'))]).toEqual(['x']);
  });

  it('computes shift-click ranges in either direction', () => {
    const rows = buildRows(doc, open('n_frame', 'n_row1'));
    expect(rangeBetween(rows, 'n_frame', 'n_recta')).toEqual([
      'n_frame',
      'n_row1',
      'n_rectb',
      'n_recta',
    ]);
    expect(rangeBetween(rows, 'n_recta', 'n_frame')).toEqual([
      'n_frame',
      'n_row1',
      'n_rectb',
      'n_recta',
    ]);
    expect(rangeBetween(rows, 'gone', 'n_recta')).toEqual(['n_recta']);
  });

  it('knows containers', () => {
    expect(isContainer(doc, 'n_frame')).toBe(true);
    expect(isContainer(doc, 'n_title')).toBe(false);
    expect(isContainer(doc, 'n_page1')).toBe(true);
    expect(isContainer(doc, 'nope')).toBe(false);
  });
});

/** Applies drop ops and returns the resulting children of a parent. */
function after(doc: Doc, ops: ReturnType<typeof dropOps>, parent: string): string[] {
  if (!ops) throw new Error('expected ops');
  const res = applyChanges(doc, ops);
  if (!res.ok) throw new Error(JSON.stringify(res.errors));
  return res.doc.nodes[parent]?.children ?? [];
}

describe('dropOps', () => {
  // Stack, bottom to top: a b c d e. Display (top first): e d c b a.
  const stack = deepFreeze(
    buildDoc([
      {
        id: 'n_box01',
        type: 'frame',
        children: ['a', 'b', 'c', 'd', 'e'].map((k) => ({
          id: `n_item${k}`,
          type: 'rect' as const,
        })),
      },
      { id: 'n_box02', type: 'frame', children: [{ id: 'n_far01', type: 'rect' }] },
    ]),
  );
  const ids = (...k: string[]) => k.map((x) => `n_item${x}`);

  it('dropping above a row puts the layer higher in the stack', () => {
    expect(after(stack, dropOps(stack, ids('a'), 'n_itemd', 'above'), 'n_box01')).toEqual(
      ids('b', 'c', 'd', 'a', 'e'),
    );
    expect(after(stack, dropOps(stack, ids('a'), 'n_iteme', 'above'), 'n_box01')).toEqual(
      ids('b', 'c', 'd', 'e', 'a'),
    );
  });

  it('dropping below a row puts it lower', () => {
    expect(after(stack, dropOps(stack, ids('e'), 'n_itemb', 'below'), 'n_box01')).toEqual(
      ids('a', 'e', 'b', 'c', 'd'),
    );
    expect(after(stack, dropOps(stack, ids('e'), 'n_itema', 'below'), 'n_box01')).toEqual(
      ids('e', 'a', 'b', 'c', 'd'),
    );
  });

  it('dropping inside a frame adds on top; moving across parents works', () => {
    expect(after(stack, dropOps(stack, ids('a'), 'n_box02', 'inside'), 'n_box02')).toEqual([
      'n_far01',
      'n_itema',
    ]);
    expect(after(stack, dropOps(stack, ids('a'), 'n_box02', 'inside'), 'n_box01')).toEqual(
      ids('b', 'c', 'd', 'e'),
    );
    expect(after(stack, dropOps(stack, ids('c'), 'n_far01', 'below'), 'n_box02')).toEqual([
      'n_itemc',
      'n_far01',
    ]);
  });

  it('keeps the relative stacking of several dragged layers (given in display order)', () => {
    // Display order e..a; dragging d and b (display: d then b) above c keeps d over b.
    const out = after(stack, dropOps(stack, ids('d', 'b'), 'n_itemc', 'above'), 'n_box01');
    expect(out).toEqual(ids('a', 'c', 'b', 'd', 'e'));
    const inside = after(stack, dropOps(stack, ids('e', 'a'), 'n_box02', 'inside'), 'n_box02');
    expect(inside).toEqual(['n_far01', 'n_itema', 'n_iteme']);
  });

  it('a no-op reorder still produces valid ops', () => {
    expect(after(stack, dropOps(stack, ids('c'), 'n_itemd', 'below'), 'n_box01')).toEqual(
      ids('a', 'b', 'c', 'd', 'e'),
    );
  });

  it('refuses invalid drops', () => {
    const nested = deepFreeze(sampleDoc());
    expect(dropOps(nested, ['n_frame'], 'n_recta', 'inside')).toBeNull(); // into its own descendant
    expect(dropOps(nested, ['n_frame'], 'n_frame', 'above')).toBeNull(); // onto itself
    expect(dropOps(nested, ['n_title'], 'n_recta', 'inside')).toBeNull(); // a rectangle cannot hold children
    expect(dropOps(nested, ['n_page1'], 'n_other', 'above')).toBeNull();
    expect(dropOps(nested, ['n_title'], 'n_page1', 'above')).toBeNull();
    expect(dropOps(nested, ['n_title'], 'gone', 'above')).toBeNull();
    expect(dropOps(nested, [], 'n_other', 'above')).toBeNull();
    expect(dropOps(nested, ['n_gone1'], 'n_other', 'above')).toBeNull();
  });

  it('treats a dragged frame and its descendants as one drag', () => {
    const out = dropOps(sampleDoc(), ['n_frame', 'n_title'], 'n_other', 'inside');
    expect(out).toHaveLength(1);
  });
});
