import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { lintDesign, type Finding } from './lint';
import { snapSpacing } from './lint-extra';
import { buildDoc } from './testing';
import type { Doc, Op } from './types';

const find = (doc: Doc, rule: string, nodeId?: string): Finding[] =>
  lintDesign(doc, nodeId).findings.filter((f) => f.rule === rule);

/** Applies a finding's fixOps and returns the new document (or throws if they do not apply). */
function applyFix(doc: Doc, finding: Finding): Doc {
  expect(finding.fixOps, `${finding.rule} has fix ops`).toBeDefined();
  const result = applyChanges(doc, finding.fixOps as Op[]);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

const board = (children: object[], extra: object = {}) =>
  buildDoc([
    {
      id: 'n_board',
      type: 'frame',
      name: 'Board',
      layout: 'column',
      w: 800,
      fill: '#ffffff',
      ...extra,
      children: children as never[],
    },
  ]);

describe('seeded problems are found, and their fixes work', () => {
  it('low contrast', () => {
    const doc = board([
      { id: 'n_t', type: 'text', name: 'Hint', text: 'Faint', color: '#cccccc', fontSize: 16 },
    ]);
    const [f] = find(doc, 'contrast');
    expect(f?.severity).toBe('error'); // 1.6:1
    const fixed = applyFix(doc, f as Finding);
    expect(find(fixed, 'contrast')).toHaveLength(0);
    expect(fixed.nodes.n_t?.color).toBe('#111111');
  });

  it('white text on a dark fill gets white, not black', () => {
    const doc = board(
      [{ id: 'n_t', type: 'text', name: 'Hint', text: 'Dim', color: '#444444', fontSize: 16 }],
      { fill: '#101010' },
    );
    const fixed = applyFix(doc, find(doc, 'contrast')[0] as Finding);
    expect(fixed.nodes.n_t?.color).toBe('#ffffff');
    expect(find(fixed, 'contrast')).toHaveLength(0);
  });

  it('10px text', () => {
    const doc = board([
      { id: 'n_t', type: 'text', name: 'Fine print', text: 'tiny', fontSize: 10 },
    ]);
    const [f] = find(doc, 'text-size');
    expect(f).toBeDefined();
    expect(find(applyFix(doc, f as Finding), 'text-size')).toHaveLength(0);
  });

  it('13px text is fine on a desktop board but too small on a phone', () => {
    const text = [{ id: 'n_t', type: 'text', name: 'Body', text: 'hello', fontSize: 13 }];
    expect(find(board(text), 'text-size')).toHaveLength(0);
    const phone = board(text, { w: 390 });
    const [f] = find(phone, 'text-size');
    expect(f?.message).toContain('on a phone');
    expect(applyFix(phone, f as Finding).nodes.n_t?.fontSize).toBe(14);
  });

  it('off-scale spacing snaps to the scale', () => {
    const doc = board([], { gap: 13, padding: [5, 21, 5, 21] });
    const found = find(doc, 'spacing-scale');
    expect(found).toHaveLength(2);
    let fixed = doc;
    for (const f of found) fixed = applyFix(fixed, f);
    expect(find(fixed, 'spacing-scale')).toHaveLength(0);
    expect(fixed.nodes.n_board?.gap).toBe(12);
    expect(fixed.nodes.n_board?.padding).toEqual([4, 20, 4, 20]);
  });

  it('a tiny tap target', () => {
    const doc = board([{ id: 'n_b', type: 'frame', name: 'Go', role: 'button', w: 24, h: 20 }]);
    const [f] = find(doc, 'tap-target');
    expect(f).toBeDefined();
    const fixed = applyFix(doc, f as Finding);
    expect(find(fixed, 'tap-target')).toHaveLength(0);
    expect(fixed.nodes.n_b).toMatchObject({ w: 40, h: 40 });
  });

  it('a child hanging out of a free-placed parent', () => {
    const doc = board([{ id: 'n_c', type: 'rect', name: 'Badge', x: 90, y: 5, w: 40, h: 20 }], {
      layout: 'none',
      w: 100,
      h: 100,
    });
    expect(find(doc, 'overflow')).toHaveLength(1);
  });

  it('three different radii among buttons: the odd ones get the first one', () => {
    const doc = board([
      { id: 'n_a', type: 'frame', name: 'A', role: 'button', radius: 8, w: 100, h: 40 },
      { id: 'n_b', type: 'frame', name: 'B', role: 'button', radius: 8, w: 100, h: 40 },
      { id: 'n_c', type: 'frame', name: 'C', role: 'button', radius: 20, w: 100, h: 40 },
    ]);
    const [f] = find(doc, 'radius-consistency');
    expect(f?.nodeId).toBe('n_c');
    const fixed = applyFix(doc, f as Finding);
    expect(find(fixed, 'radius-consistency')).toHaveLength(0);
  });

  it('a colour that is a token written out', () => {
    const doc = board([{ id: 'n_r', type: 'rect', name: 'Panel', w: 10, h: 10, fill: '#c96442' }]);
    const withToken: Doc = {
      ...doc,
      tokens: { ...doc.tokens, colors: { ...doc.tokens.colors, brand: '#c96442' } },
    };
    const f = find(withToken, 'use-token').find((x) => x.nodeId === 'n_r');
    expect(f).toBeDefined();
    expect(applyFix(withToken, f as Finding).nodes.n_r?.fill).toBe('$brand');
  });
});

describe('rules added in Phase 9', () => {
  it('too many fonts and sizes in one board', () => {
    const fonts = ['Inter', 'DM Sans', 'Fraunces'];
    const doc = board(
      fonts.map((family, i) => ({
        id: `n_f${i}`,
        type: 'text',
        name: `T${i}`,
        text: 'x',
        fontFamily: family,
        fontSize: 12 + i * 4,
      })),
    );
    const [f] = find(doc, 'too-many-fonts');
    expect(f?.nodeId).toBe('n_board');
    expect(f?.message).toContain('3 font families');
  });

  it('six text sizes is too many even with one family', () => {
    const doc = board(
      [12, 14, 16, 20, 28, 40].map((size) => ({
        id: `n_${size}`,
        type: 'text',
        name: `S${size}`,
        text: 'x',
        fontSize: size,
      })),
    );
    expect(find(doc, 'too-many-fonts')).toHaveLength(1);
    expect(
      find(
        board(
          [12, 14, 16, 20, 28].map((size) => ({
            id: `n_${size}`,
            type: 'text',
            name: `S${size}`,
            text: 'x',
            fontSize: size,
          })),
        ),
        'too-many-fonts',
      ),
    ).toHaveLength(0);
  });

  it('a long paragraph in a very wide box, fixed by narrowing it', () => {
    const para = 'word '.repeat(40);
    const doc = board([
      { id: 'n_p', type: 'text', name: 'Para', text: para, fontSize: 16, w: 1000 },
    ]);
    const [f] = find(doc, 'line-length');
    expect(f).toBeDefined();
    const fixed = applyFix(doc, f as Finding);
    expect(find(fixed, 'line-length')).toHaveLength(0);
    expect(fixed.nodes.n_p?.w).toBe(520);
  });

  it('short text in a wide box is fine', () => {
    const doc = board([
      { id: 'n_p', type: 'text', name: 'Title', text: 'Short title', fontSize: 16, w: 1000 },
    ]);
    expect(find(doc, 'line-length')).toHaveLength(0);
  });

  it('near-miss alignment of free-placed siblings', () => {
    const doc = board(
      [
        { id: 'n_a', type: 'rect', name: 'A', x: 40, y: 0, w: 20, h: 20 },
        { id: 'n_b', type: 'rect', name: 'B', x: 42, y: 40, w: 20, h: 20 },
        { id: 'n_c', type: 'rect', name: 'C', x: 200, y: 80, w: 20, h: 20 },
      ],
      { layout: 'none', w: 400, h: 200 },
    );
    const found = find(doc, 'unaligned');
    expect(found).toHaveLength(1);
    expect(found[0]?.nodeId).toBe('n_b');
    expect(find(applyFix(doc, found[0] as Finding), 'unaligned')).toHaveLength(0);
  });

  it('exact alignment and clearly different positions are not flagged', () => {
    const doc = board(
      [
        { id: 'n_a', type: 'rect', name: 'A', x: 40, y: 0, w: 20, h: 20 },
        { id: 'n_b', type: 'rect', name: 'B', x: 40, y: 40, w: 20, h: 20 },
        { id: 'n_c', type: 'rect', name: 'C', x: 100, y: 80, w: 20, h: 20 },
      ],
      { layout: 'none', w: 400, h: 200 },
    );
    expect(find(doc, 'unaligned')).toHaveLength(0);
  });

  it('text pressed against text with no gap', () => {
    const doc = board(
      [
        { id: 'n_a', type: 'text', name: 'Title', text: 'Title' },
        { id: 'n_b', type: 'text', name: 'Subtitle', text: 'Subtitle' },
      ],
      { gap: 0 },
    );
    const [f] = find(doc, 'touching');
    expect(f?.nodeId).toBe('n_board');
    expect(find(applyFix(doc, f as Finding), 'touching')).toHaveLength(0);
  });

  it('a gap, or shapes instead of text, are fine', () => {
    expect(
      find(
        board(
          [
            { id: 'n_a', type: 'text', name: 'A', text: 'A' },
            { id: 'n_b', type: 'text', name: 'B', text: 'B' },
          ],
          { gap: 8 },
        ),
        'touching',
      ),
    ).toHaveLength(0);
    expect(
      find(
        board(
          [
            { id: 'n_a', type: 'rect', name: 'A', w: 5, h: 5 },
            { id: 'n_b', type: 'rect', name: 'B', w: 5, h: 5 },
          ],
          { gap: 0 },
        ),
        'touching',
      ),
    ).toHaveLength(0);
  });
});

describe('snapSpacing', () => {
  it('prefers a token when it is closer than a multiple of 4', () => {
    expect(snapSpacing(13, [4, 8, 12, 16])).toBe(12);
    expect(snapSpacing(5, [])).toBe(4);
    expect(snapSpacing(22, [4, 8, 12, 16, 24])).toBe(24);
  });
});

describe('every fix the linter offers applies cleanly', () => {
  it('on a deliberately bad design, all fixOps are valid and remove their finding', () => {
    let doc = board(
      [
        { id: 'n_a', type: 'text', name: 'Hint', text: 'Faint', color: '#dddddd', fontSize: 9 },
        { id: 'n_b', type: 'text', name: 'Sub', text: 'Sub', fontSize: 16 },
        { id: 'n_c', type: 'frame', name: 'Go', role: 'button', w: 20, h: 18 },
      ],
      { gap: 0, padding: [7, 7, 7, 7] },
    );
    const before = lintDesign(doc).findings.filter((f) => f.fixOps !== undefined);
    expect(before.length).toBeGreaterThanOrEqual(4);
    for (const f of before) {
      const next = applyChanges(doc, f.fixOps as Op[]);
      expect(next.ok, `${f.rule}: ${JSON.stringify(next)}`).toBe(true);
      if (next.ok) doc = next.doc;
    }
    const after = lintDesign(doc).findings.filter((f) => f.fixOps !== undefined);
    expect(after.length).toBeLessThan(before.length);
  });
});
