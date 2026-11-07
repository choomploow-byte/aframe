import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOKENS,
  findTokenIssues,
  isOnSpacingScale,
  isTokenRef,
  nearestSpacing,
  parseTokenRef,
  resolveColor,
  resolveFont,
  resolveRadius,
  type TokenIssue,
} from './tokens';
import type { Node, Tokens } from './types';
import { normalizeNode } from './normalize';

const tokens: Tokens = {
  colors: {
    primary: '#C96442',
    brand: '$primary',
    loopA: '$loopB',
    loopB: '$loopA',
    bad: '$nope',
    wrongType: '$font.body',
  },
  fonts: { heading: 'Fraunces', body: 'Inter', alias: '$font.body', loop: '$font.loop' },
  spacing: [4, 8, 16, 24],
  radii: { md: 10 },
};

describe('parseTokenRef', () => {
  it('classifies references by group', () => {
    expect(parseTokenRef('$primary')).toEqual({ group: 'color', name: 'primary', raw: '$primary' });
    expect(parseTokenRef('$font.heading')).toEqual({
      group: 'font',
      name: 'heading',
      raw: '$font.heading',
    });
    expect(parseTokenRef('$radius.md')?.group).toBe('radius');
  });

  it('returns null for malformed references', () => {
    for (const bad of ['$', '$1abc', '$a.b', '$font.', 'primary', '$font.a.b']) {
      expect(parseTokenRef(bad)).toBeNull();
    }
  });

  it('isTokenRef only checks the sigil', () => {
    expect(isTokenRef('$x')).toBe(true);
    expect(isTokenRef('#fff')).toBe(false);
    expect(isTokenRef(3)).toBe(false);
  });
});

describe('resolveColor', () => {
  it('passes literal colours through and ignores empty values', () => {
    expect(resolveColor('#112233', tokens)).toBe('#112233');
    expect(resolveColor('rgba(0,0,0,0.5)', tokens)).toBe('rgba(0,0,0,0.5)');
    expect(resolveColor(undefined, tokens)).toBeUndefined();
    expect(resolveColor('', tokens)).toBeUndefined();
  });

  it('resolves tokens and one level of alias', () => {
    expect(resolveColor('$primary', tokens)).toBe('#C96442');
    expect(resolveColor('$brand', tokens)).toBe('#C96442');
  });

  it('resolves tokens inside gradients', () => {
    expect(resolveColor('linear-gradient(90deg, $primary, #fff)', tokens)).toBe(
      'linear-gradient(90deg, #C96442, #fff)',
    );
  });

  it('reports unknown, cyclic, malformed and wrong-type tokens instead of throwing', () => {
    const cases: [string, TokenIssue['reason']][] = [
      ['$missing', 'UNKNOWN'],
      ['$bad', 'UNKNOWN'],
      ['$loopA', 'CYCLE'],
      ['$wrongType', 'WRONG_TYPE'],
      ['$font.body', 'WRONG_TYPE'],
    ];
    for (const [value, reason] of cases) {
      const issues: TokenIssue[] = [];
      expect(resolveColor(value, tokens, issues)).toBeUndefined();
      expect(issues.map((i) => i.reason)).toContain(reason);
    }
  });

  it('does not resolve prototype members as tokens', () => {
    const issues: TokenIssue[] = [];
    expect(resolveColor('$constructor', tokens, issues)).toBeUndefined();
    expect(resolveColor('$__proto__', tokens, issues)).toBeUndefined();
    expect(issues.map((i) => i.reason)).toEqual(['UNKNOWN', 'MALFORMED']);
  });

  it('works when no issues array is supplied', () => {
    expect(resolveColor('$missing', tokens)).toBeUndefined();
  });
});

describe('resolveFont', () => {
  it('resolves $font tokens, aliases and plain names', () => {
    expect(resolveFont('$font.heading', tokens)).toBe('Fraunces');
    expect(resolveFont('$font.alias', tokens)).toBe('Inter');
    expect(resolveFont('DM Sans', tokens)).toBe('DM Sans');
    expect(resolveFont(undefined, tokens)).toBeUndefined();
  });

  it('reports problems', () => {
    const issues: TokenIssue[] = [];
    expect(resolveFont('$font.missing', tokens, issues)).toBeUndefined();
    expect(resolveFont('$primary', tokens, issues)).toBeUndefined();
    expect(resolveFont('$', tokens, issues)).toBeUndefined();
    expect(resolveFont('$font.loop', tokens, issues)).toBeUndefined();
    expect(issues.map((i) => i.reason)).toEqual(['UNKNOWN', 'WRONG_TYPE', 'MALFORMED', 'CYCLE']);
  });
});

describe('resolveRadius', () => {
  it('passes numbers and tuples, resolves tokens', () => {
    expect(resolveRadius(8, tokens)).toBe(8);
    expect(resolveRadius([1, 2, 3, 4], tokens)).toEqual([1, 2, 3, 4]);
    expect(resolveRadius('$radius.md', tokens)).toBe(10);
    expect(resolveRadius(undefined, tokens)).toBeUndefined();
  });

  it('reports problems', () => {
    const issues: TokenIssue[] = [];
    expect(resolveRadius('$radius.zzz', tokens, issues)).toBeUndefined();
    expect(resolveRadius('$primary', tokens, issues)).toBeUndefined();
    expect(resolveRadius('md', tokens, issues)).toBeUndefined();
    expect(issues.map((i) => i.reason)).toEqual(['UNKNOWN', 'WRONG_TYPE', 'MALFORMED']);
  });
});

describe('findTokenIssues', () => {
  it('scans every token-bearing property', () => {
    const node: Node = normalizeNode({
      id: 'n_test1',
      type: 'text',
      fill: '$nofill',
      stroke: '$nostroke',
      color: '$nocolor',
      fontFamily: '$font.nofont',
      radius: '$radius.noradius',
      shadow: [{ x: 0, y: 1, blur: 2, spread: 0, color: '$noshadow' }],
    });
    expect(findTokenIssues(node, DEFAULT_TOKENS).map((i) => i.token)).toEqual([
      '$nofill',
      '$nostroke',
      '$nocolor',
      '$font.nofont',
      '$radius.noradius',
      '$noshadow',
    ]);
  });

  it('is empty for a clean node', () => {
    const node = normalizeNode({
      id: 'n_test2',
      type: 'rect',
      fill: '$primary',
      radius: '$radius.md',
    });
    expect(findTokenIssues(node, DEFAULT_TOKENS)).toEqual([]);
  });
});

describe('spacing helpers', () => {
  it('accepts scale values and multiples of 4', () => {
    expect(isOnSpacingScale(8, tokens)).toBe(true);
    expect(isOnSpacingScale(20, tokens)).toBe(true); // multiple of 4
    expect(isOnSpacingScale(13, tokens)).toBe(false);
    expect(isOnSpacingScale(2.5, { ...tokens, spacing: [2.5] })).toBe(true);
  });

  it('finds the nearest scale value, ties to the smaller', () => {
    expect(nearestSpacing(10, tokens)).toBe(8);
    expect(nearestSpacing(12, tokens)).toBe(8); // tie between 8 and 16
    expect(nearestSpacing(100, tokens)).toBe(24);
    expect(nearestSpacing(13, { ...tokens, spacing: [] })).toBe(12);
  });
});
