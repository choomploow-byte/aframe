import { describe, expect, it } from 'vitest';
import { CoreError } from './errors';
import { deleteToken, mergeTokens, renameToken, tokenUsage } from './token-edit';
import { DEFAULT_TOKENS, findTokenIssues } from './tokens';
import { buildDoc, deepFreeze } from './testing';
import type { Doc, Tokens } from './types';

const tokens: Tokens = deepFreeze(JSON.parse(JSON.stringify(DEFAULT_TOKENS)) as Tokens);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof CoreError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
}

describe('mergeTokens', () => {
  it('adds, changes and removes entries, leaving the input alone', () => {
    const next = mergeTokens(tokens, {
      colors: { primary: '#112233', accent2: '$primary', muted: null },
      fonts: { display: 'DM Sans', mono: null },
      radii: { pill: 999, sm: null },
      spacing: [2, 4, 8],
    });
    expect(next.colors.primary).toBe('#112233');
    expect(next.colors.accent2).toBe('$primary');
    expect(next.colors).not.toHaveProperty('muted');
    expect(next.fonts).toEqual({ heading: 'Fraunces', body: 'Inter', display: 'DM Sans' });
    expect(next.radii.pill).toBe(999);
    expect(next.radii).not.toHaveProperty('sm');
    expect(next.spacing).toEqual([2, 4, 8]);
    expect(tokens.colors.primary).toBe('#5B3CB0');
  });

  it('an empty patch changes nothing', () => {
    expect(mergeTokens(tokens, {})).toEqual(tokens);
  });

  it('rejects bad names and values with INVALID_VALUE', () => {
    for (const patch of [
      { colors: { '1bad': '#fff' } },
      { colors: { 'has space': '#fff' } },
      { colors: { x: 'url(evil)' } },
      { colors: { x: 'red' } },
      { fonts: { x: 'Bad;Font' } },
      { fonts: { 'a.b': 'Inter' } },
      { radii: { x: -1 } },
      { radii: { x: Number.NaN } },
      { spacing: [4, -2] },
      { spacing: Array.from({ length: 41 }, () => 4) },
    ]) {
      expect(
        codeOf(() => mergeTokens(tokens, patch as never)),
        JSON.stringify(patch),
      ).toBe('INVALID_VALUE');
    }
    expect(mergeTokens(tokens, { fonts: { alias: '$font.body' } }).fonts.alias).toBe('$font.body');
  });
});

function design(): Doc {
  return deepFreeze({
    ...buildDoc([
      {
        id: 'n_card1',
        type: 'frame',
        fill: '$surface2',
        stroke: '$border',
        radius: '$radius.md',
        shadow: [{ x: 0, y: 2, blur: 8, spread: 0, color: '$primary' }],
        children: [
          { id: 'n_head1', type: 'text', text: 'Hi', color: '$text', fontFamily: '$font.heading' },
          {
            id: 'n_btn01',
            type: 'rect',
            fill: 'linear-gradient(90deg, $primary, $primarySoft)',
            radius: 8,
          },
          { id: 'n_btn02', type: 'rect', fill: '$primary', radius: '$radius.md' },
        ],
      },
    ]),
    tokens: { ...tokens, colors: { ...tokens.colors, brand: '$primary' } },
  });
}

describe('tokenUsage', () => {
  it('counts references on nodes, in gradients, shadows and aliases', () => {
    const u = tokenUsage(design());
    expect(u.color.primary).toBe(4); // gradient, shadow, button fill, the "brand" alias
    expect(u.color.primarySoft).toBe(1);
    expect(u.color.surface2).toBe(1);
    expect(u.font.heading).toBe(1);
    expect(u.radius.md).toBe(2);
    expect(u.color.unused).toBeUndefined();
  });
});

describe('renameToken', () => {
  it('moves the token and every reference, keeping the design resolvable', () => {
    const doc = design();
    const next = renameToken(doc, 'color', 'primary', 'accent');
    expect(next.tokens.colors.accent).toBe('#5B3CB0');
    expect(next.tokens.colors).not.toHaveProperty('primary');
    expect(next.tokens.colors.brand).toBe('$accent');
    expect(next.nodes.n_btn02?.fill).toBe('$accent');
    expect(next.nodes.n_btn01?.fill).toBe('linear-gradient(90deg, $accent, $primarySoft)');
    expect(next.nodes.n_card1?.shadow?.[0]?.color).toBe('$accent');
    for (const n of Object.values(next.nodes)) expect(findTokenIssues(n, next.tokens)).toEqual([]);
    // Structural sharing: nodes that referenced nothing keep their identity.
    expect(next.nodes.n_head1).toBe(doc.nodes.n_head1);
    expect(next.nodes.n_page1).toBe(doc.nodes.n_page1);
  });

  it('works for fonts and radii, and keeps the table order', () => {
    const doc = design();
    const f = renameToken(doc, 'font', 'heading', 'display');
    expect(f.nodes.n_head1?.fontFamily).toBe('$font.display');
    expect(Object.keys(f.tokens.fonts)).toEqual(['display', 'body', 'mono']);
    const r = renameToken(doc, 'radius', 'md', 'rounded');
    expect(r.nodes.n_card1?.radius).toBe('$radius.rounded');
    expect(r.nodes.n_btn02?.radius).toBe('$radius.rounded');
  });

  it('a rename to the same name is a no-op; collisions and unknowns are errors', () => {
    const doc = design();
    expect(renameToken(doc, 'color', 'primary', 'primary')).toBe(doc);
    expect(codeOf(() => renameToken(doc, 'color', 'primary', 'text'))).toBe('INVALID_VALUE');
    expect(codeOf(() => renameToken(doc, 'color', 'nope', 'x'))).toBe('NOT_FOUND');
    expect(codeOf(() => renameToken(doc, 'color', 'primary', '1x'))).toBe('INVALID_VALUE');
    // `muted` exists as a colour but not as a font: groups are separate namespaces.
    expect(codeOf(() => renameToken(doc, 'font', 'muted', 'x'))).toBe('NOT_FOUND');
    expect(renameToken(doc, 'font', 'mono', 'text').tokens.fonts).toHaveProperty('text');
  });
});

describe('deleteToken', () => {
  it('writes the literal value back wherever the token was used', () => {
    const doc = design();
    const next = deleteToken(doc, 'color', 'primary');
    expect(next.tokens.colors).not.toHaveProperty('primary');
    expect(next.nodes.n_btn02?.fill).toBe('#5B3CB0');
    // Only the deleted token is detached; the other stop still references its token.
    expect(next.nodes.n_btn01?.fill).toBe('linear-gradient(90deg, #5B3CB0, $primarySoft)');
    expect(next.nodes.n_card1?.shadow?.[0]?.color).toBe('#5B3CB0');
    expect(next.tokens.colors.brand).toBe('#5B3CB0'); // the alias is detached too
    for (const n of Object.values(next.nodes)) expect(findTokenIssues(n, next.tokens)).toEqual([]);
  });

  it('turns a deleted radius token into a plain number and a font token into its family', () => {
    const doc = design();
    const r = deleteToken(doc, 'radius', 'md');
    expect(r.nodes.n_card1?.radius).toBe(10);
    expect(r.nodes.n_btn02?.radius).toBe(10);
    const f = deleteToken(doc, 'font', 'heading');
    expect(f.nodes.n_head1?.fontFamily).toBe('Fraunces');
  });

  it('refuses unknown tokens', () => {
    expect(codeOf(() => deleteToken(design(), 'color', 'nope'))).toBe('NOT_FOUND');
  });

  it('deleting an unused token only removes it', () => {
    const doc = design();
    const next = deleteToken(doc, 'color', 'muted');
    expect(next.nodes).toBe(doc.nodes);
    expect(next.tokens.colors).not.toHaveProperty('muted');
  });
});

describe('text styles', () => {
  it('adds, changes and removes a style, and refuses a bad one', () => {
    const t0 = DEFAULT_TOKENS;
    const t1 = mergeTokens(t0, {
      textStyles: { 'Title Outline': { fontSize: 48, textStroke: '#000000', textStrokeWidth: 3 } },
    });
    expect(t1.textStyles?.['Title Outline']?.fontSize).toBe(48);
    const t2 = mergeTokens(t1, { textStyles: { 'Title Outline': null } });
    expect(t2.textStyles).toBeUndefined();
    expect(() => mergeTokens(t0, { textStyles: { 'bad/name': { fontSize: 10 } } })).toThrow(
      /valid text style name/,
    );
    expect(() => mergeTokens(t0, { textStyles: { Ok: { fontSize: -4 } } })).toThrow(
      /Invalid text style/,
    );
    expect(() => mergeTokens(t0, { textStyles: { Ok: { fill: '#fff' } as never } })).toThrow(
      /unknown setting/,
    );
  });
});
