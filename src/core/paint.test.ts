import { describe, expect, it } from 'vitest';
import { normalizeNode } from './normalize';
import { effectShadows, patternCss } from './paint';
import { cssToString, nodeToCss } from './style';
import { DEFAULT_TOKENS } from './tokens';
import type { Node, Tokens } from './types';
import { propIssues } from './validate';

const tokens: Tokens = {
  ...DEFAULT_TOKENS,
  colors: { ...DEFAULT_TOKENS.colors, gold: '#FFC83D', panel: '#2D2250' },
};
const mk = (props: Partial<Node> & { type: Node['type'] }): Node =>
  normalizeNode({ id: 'n_test1', parentId: 'n_page1', ...props });
const css = (props: Partial<Node> & { type: Node['type'] }) =>
  nodeToCss(mk(props), undefined, tokens);

describe('pattern fills', () => {
  it('draws stripes with angle, thickness, gap, colour and opacity', () => {
    const out = css({
      type: 'rect',
      fill: { pattern: 'stripes', color: '#FF0000', size: 4, spacing: 6, angle: 30, opacity: 0.5 },
    });
    expect(out.backgroundImage).toBe(
      'repeating-linear-gradient(30deg, rgba(255, 0, 0, 0.5) 0px, rgba(255, 0, 0, 0.5) 4px, transparent 4px, transparent 10px)',
    );
    expect(out.backgroundColor).toBeUndefined();
  });

  it('defaults stripes to 45 degrees with the gap equal to the thickness', () => {
    const out = css({ type: 'rect', fill: { pattern: 'stripes', color: '#000000', size: 8 } });
    expect(out.backgroundImage).toContain('repeating-linear-gradient(45deg');
    expect(out.backgroundImage).toContain('8px, transparent 8px, transparent 16px');
  });

  it('draws halftone as two half-cell offset dot grids', () => {
    const out = css({
      type: 'rect',
      fill: { pattern: 'halftone', color: '$primary', size: 6, opacity: 0.25 },
    });
    expect(out.backgroundImage?.match(/radial-gradient/g)).toHaveLength(2);
    expect(out.backgroundImage).toContain('rgba(91, 60, 176, 0.25) 3px');
    // spacing defaults to twice the dot size
    expect(out.backgroundSize).toBe('12px 12px, 12px 12px');
    expect(out.backgroundPosition).toBe('0 0, 6px 6px');
  });

  it('draws sunburst rays that meet without a seam', () => {
    const out = css({
      type: 'rect',
      fill: { pattern: 'sunburst', color: '#FFFFFF', size: 7, spacing: 7 },
    });
    // 360 / 14 = 25.7 -> 26 rays of 13.846 degrees
    expect(out.backgroundImage).toContain('repeating-conic-gradient(from 0deg at 50% 50%');
    expect(out.backgroundImage).toContain('6.923deg');
    expect(out.backgroundImage).toContain('13.846deg');
  });

  it('draws noise as one tiled SVG image and nothing else may carry a url()', () => {
    const out = css({
      type: 'rect',
      fill: { pattern: 'noise', color: '#000000', opacity: 0.2, size: 2 },
    });
    expect(out.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,[A-Za-z0-9%._~!*'()-]+"\)$/);
    expect(out.backgroundSize).toBe('160px 160px');
    expect(decodeURIComponent(out.backgroundImage ?? '')).toContain('feTurbulence');
    // The noise survives cssToString (it is the one allowed url) ...
    expect(cssToString(out)).toContain('background-image: url("data:image/svg+xml,');
    // ... while a url() from anywhere else is still dropped.
    expect(cssToString({ backgroundImage: 'url(https://evil.example/x.png)' })).toBe('');
    expect(cssToString({ backgroundImage: `${out.backgroundImage}, url(//evil)` })).toBe('');
  });

  it('puts a solid background under the pattern and a gradient into the layers', () => {
    const solid = css({
      type: 'frame',
      fill: { pattern: 'stripes', color: '#FFFFFF', size: 2, background: '$panel' },
    });
    expect(solid.backgroundColor).toBe('#2D2250');
    const gradient = css({
      type: 'frame',
      fill: {
        pattern: 'stripes',
        color: '#FFFFFF',
        size: 2,
        background: 'linear-gradient(90deg, #000000, #FFFFFF)',
      },
    });
    expect(gradient.backgroundImage).toMatch(/repeating-linear-gradient.*, linear-gradient\(90deg/);
  });

  it("follows the node radius and clipping because it is the node's own background", () => {
    const out = css({
      type: 'frame',
      radius: 24,
      clip: true,
      fill: { pattern: 'halftone', color: '#FFFFFF', size: 3 },
    });
    expect(out.borderRadius).toBe('24px');
    expect(out.overflow).toBe('hidden');
    expect(out.backgroundImage).toBeDefined();
  });

  it('reports an unknown token and draws no pattern', () => {
    const issues: { token: string }[] = [];
    const out = patternCss({ pattern: 'stripes', color: '$nope' }, tokens, issues as never);
    expect(out).toEqual({});
    expect(issues[0]?.token).toBe('$nope');
  });

  it('is validated, with the shape named in the error', () => {
    const bad = propIssues({ fill: { pattern: 'plaid', color: '#000' } }, 'rect');
    expect(bad[0]?.hint).toMatch(/pattern to be one of stripes, halftone, sunburst, noise/);
    expect(propIssues({ fill: { pattern: 'stripes', color: 'red' } }, 'rect')[0]?.hint).toMatch(
      /pattern.color to be a colour/,
    );
    expect(
      propIssues({ fill: { pattern: 'stripes', color: '#000', opacity: 2 } }, 'rect'),
    ).toHaveLength(1);
    expect(
      propIssues({ fill: { pattern: 'stripes', color: '#000', extra: 1 } }, 'rect'),
    ).toHaveLength(1);
    expect(
      propIssues(
        { fill: { pattern: 'halftone', color: '$primary', size: 6, opacity: 0.25 } },
        'rect',
      ),
    ).toEqual([]);
  });
});

describe('effect presets', () => {
  const shadows = (effects: Node['effects'], fill?: string) => effectShadows(effects, fill, tokens);

  it('builds each preset from named shadow layers', () => {
    expect(shadows(['bevel-raised'])).toEqual([
      'inset 0 2px 0 0 rgba(255, 255, 255, 0.35)',
      'inset 0 -3px 0 0 rgba(0, 0, 0, 0.28)',
      '0 1px 2px 0 rgba(0, 0, 0, 0.25)',
    ]);
    expect(shadows(['bevel-pressed'])[0]).toBe('inset 0 3px 6px 0 rgba(0, 0, 0, 0.38)');
    expect(shadows(['gloss-top'])).toHaveLength(2);
    expect(shadows(['inner-glow'])[0]).toBe('inset 0 0 14px 2px rgba(255, 255, 255, 0.55)');
    expect(shadows(['hard-3d-bottom'], '#FFB020')[0]).toBe('0 4px 0 0 rgba(158, 109, 20, 1)');
  });

  it('scales with intensity and caps alpha at 1', () => {
    expect(shadows([{ preset: 'bevel-raised', intensity: 2 }])[0]).toBe(
      'inset 0 4px 0 0 rgba(255, 255, 255, 0.7)',
    );
    expect(shadows([{ preset: 'bevel-raised', intensity: 3 }])[0]).toBe(
      'inset 0 6px 0 0 rgba(255, 255, 255, 1)',
    );
    expect(shadows([{ preset: 'gloss-top', intensity: 0 }])).toEqual([]);
  });

  it('tints inner-glow and the 3D ledge with a colour token', () => {
    expect(shadows([{ preset: 'inner-glow', color: '$gold' }])[0]).toBe(
      'inset 0 0 14px 2px rgba(255, 200, 61, 0.55)',
    );
    expect(shadows([{ preset: 'hard-3d-bottom', color: '$gold' }])[0]).toBe('0 4px 0 0 #FFC83D');
    // an unresolvable colour skips the effect rather than guessing
    expect(shadows([{ preset: 'inner-glow', color: '$missing' }])).toEqual([]);
  });

  it('makes a darker ledge from a token fill or a safe default for gradients', () => {
    const node = css({ type: 'frame', fill: '$primary', effects: ['hard-3d-bottom'] });
    expect(node.boxShadow).toMatch(/^0 4px 0 0 rgba\(56, 37, 109, 1\), /);
    const grad = css({
      type: 'frame',
      fill: 'linear-gradient(#000000, #FFFFFF)',
      effects: ['hard-3d-bottom'],
    });
    expect(grad.boxShadow).toMatch(/^0 4px 0 0 rgba\(0, 0, 0, 0.35\)/);
  });

  it('combines with explicit shadows (shadow first) and validates', () => {
    const out = css({
      type: 'frame',
      shadow: [{ x: 0, y: 2, blur: 4, spread: 0, color: '#000000' }],
      effects: ['gloss-top'],
    });
    expect(out.boxShadow?.startsWith('0px 2px 4px 0px #000000, inset 0 1px 0 0')).toBe(true);
    expect(propIssues({ effects: ['shiny'] }, 'frame')[0]?.hint).toMatch(/bevel-raised/);
    expect(propIssues({ effects: [{ preset: 'gloss-top', intensity: 9 }] }, 'frame')).toHaveLength(
      1,
    );
    expect(
      propIssues({ effects: ['bevel-raised', { preset: 'inner-glow', color: '$gold' }] }, 'frame'),
    ).toEqual([]);
  });
});

describe('text and icons', () => {
  it('never draws a box around text: a shadow becomes a glyph shadow and effects are ignored', () => {
    const out = css({
      type: 'text',
      text: 'Hi',
      shadow: [
        { x: 1, y: 2, blur: 3, spread: 9, color: '#000000' },
        { x: 0, y: 0, blur: 4, spread: 0, color: '#FFFFFF', inset: true },
      ],
      effects: ['bevel-raised'],
    });
    expect(out.boxShadow).toBeUndefined();
    expect(out.textShadow).toBe('1px 2px 3px #000000');
  });

  it('colours an icon through its color property, tokens included', () => {
    const out = css({ type: 'icon', icon: 'coins', color: '$gold' });
    expect(out.color).toBe('#FFC83D');
    expect(out.width).toBe('24px');
    expect(out.height).toBe('24px');
  });

  it('does not fake a bold the font does not have', () => {
    const lilita = css({ type: 'text', text: 'Play', fontFamily: 'Lilita One', fontWeight: 700 });
    expect(lilita.fontSynthesis).toBe('none');
    expect(
      css({ type: 'text', text: 'x', fontFamily: 'Fredoka', fontWeight: 700 }).fontSynthesis,
    ).toBeUndefined();
    expect(css({ type: 'text', text: 'x', fontFamily: 'Inter', fontWeight: 900 }).fontWeight).toBe(
      '900',
    );
    expect(
      css({ type: 'text', text: 'x', fontFamily: 'Georgia', fontWeight: 900 }).fontSynthesis,
    ).toBeUndefined();
  });
});
