import { describe, expect, it } from 'vitest';
import { normalizeNode, type LooseNode } from './normalize';
import { cssPropertyName, cssToString, fontStack, GLOBAL_RESET_CSS, nodeToCss } from './style';
import { DEFAULT_TOKENS, type TokenIssue } from './tokens';
import type { Node } from './types';

const page = normalizeNode({ id: 'n_page1', type: 'page' });
const absFrame = normalizeNode({ id: 'n_abs01', type: 'frame', layout: 'none' });
const row = normalizeNode({ id: 'n_row01', type: 'frame', layout: 'row' });
const column = normalizeNode({ id: 'n_col01', type: 'frame', layout: 'column' });

const node = (input: Omit<LooseNode, 'id'>): Node => normalizeNode({ id: 'n_test1', ...input });
// `null` = no parent (the page itself, or a subtree rendered alone); the default is an absolute frame.
const css = (n: Node, parent: Node | null = absFrame, issues?: TokenIssue[]) =>
  nodeToCss(n, parent ?? undefined, DEFAULT_TOKENS, issues);

describe('positioning', () => {
  it('page: a plain positioning context', () => {
    expect(css(page, null)).toEqual({ position: 'relative' });
  });

  it('fixed child of the page or a layout:none frame is absolute at x,y', () => {
    const rect = node({ type: 'rect', x: 12.5, y: -4, w: 80, h: 40 });
    const expected = {
      position: 'absolute',
      left: '12.5px',
      top: '-4px',
      width: '80px',
      height: '40px',
    };
    expect(css(rect, page)).toEqual(expected);
    expect(css(rect, absFrame)).toEqual(expected);
  });

  it('a subtree rendered on its own has no placement', () => {
    expect(css(node({ type: 'rect', w: 80, h: 40 }), null)).toEqual({
      width: '80px',
      height: '40px',
    });
    expect(css(node({ type: 'frame', w: 10, h: 10 }), null)).toMatchObject({
      position: 'relative',
    });
  });

  it('x,y are ignored inside auto-layout parents', () => {
    const rect = node({ type: 'rect', x: 99, y: 99, w: 80, h: 40 });
    expect(css(rect, row)).toEqual({ width: '80px', flex: '0 0 auto', height: '40px' });
    expect(css(rect, column)).toEqual({ width: '80px', height: '40px', flex: '0 0 auto' });
  });
});

describe('sizing (hug / fill / fixed on both axes)', () => {
  it('absolute parent: fill is 100%, hug is auto', () => {
    expect(css(node({ type: 'rect', w: 'fill', h: 'fill' }))).toMatchObject({
      width: '100%',
      height: '100%',
    });
    const hug = css(node({ type: 'frame', layout: 'row', w: 'hug', h: 'hug' }));
    expect(hug).not.toHaveProperty('width');
    expect(hug).not.toHaveProperty('height');
  });

  it('row parent: main axis (width)', () => {
    expect(css(node({ type: 'rect', w: 'fill', h: 20 }), row)).toEqual({
      flex: '1 1 0',
      minWidth: '0',
      height: '20px',
    });
    expect(css(node({ type: 'rect', w: 'hug', h: 20 }), row)).toEqual({
      flex: '0 0 auto',
      height: '20px',
    });
    expect(css(node({ type: 'rect', w: 30, h: 20 }), row)).toMatchObject({
      width: '30px',
      flex: '0 0 auto',
    });
  });

  it('row parent: cross axis (height)', () => {
    expect(css(node({ type: 'rect', w: 30, h: 'fill' }), row)).toMatchObject({
      alignSelf: 'stretch',
    });
    expect(css(node({ type: 'rect', w: 30, h: 'fill' }), row)).not.toHaveProperty('height');
    expect(css(node({ type: 'rect', w: 30, h: 'hug' }), row)).not.toHaveProperty('alignSelf');
    expect(css(node({ type: 'rect', w: 30, h: 'hug' }), row)).not.toHaveProperty('height');
  });

  it('column parent: main axis (height) and cross axis (width)', () => {
    const fillBoth = css(node({ type: 'rect', w: 'fill', h: 'fill' }), column);
    expect(fillBoth).toEqual({ alignSelf: 'stretch', flex: '1 1 0' });
    expect(fillBoth).not.toHaveProperty('minHeight'); // see docs/04 decision 5 and css-probe
    expect(css(node({ type: 'rect', w: 'hug', h: 'hug' }), column)).toEqual({ flex: '0 0 auto' });
    expect(css(node({ type: 'rect', w: 40, h: 50 }), column)).toEqual({
      width: '40px',
      height: '50px',
      flex: '0 0 auto',
    });
  });

  it('wrap does not change per-child sizing', () => {
    const wrapRow = normalizeNode({ id: 'n_wrap1', type: 'frame', layout: 'row', wrap: true });
    expect(css(node({ type: 'rect', w: 90, h: 30 }), wrapRow)).toEqual({
      width: '90px',
      flex: '0 0 auto',
      height: '30px',
    });
  });
});

describe('frame layout', () => {
  it('row/column frames map 1:1 to flexbox', () => {
    const f = node({
      type: 'frame',
      layout: 'column',
      gap: 12,
      padding: [8, 16, 8, 16],
      align: 'center',
      justify: 'between',
      wrap: true,
      clip: true,
      w: 300,
      h: 'hug',
    });
    expect(css(f, absFrame)).toEqual({
      position: 'absolute',
      left: '0px',
      top: '0px',
      width: '300px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '8px 16px 8px 16px',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      overflow: 'hidden',
    });
  });

  it('omits default noise: zero gap/padding, start justify, no wrap', () => {
    const out = css(node({ type: 'frame', layout: 'row', w: 'hug', h: 'hug' }), null);
    expect(out).toEqual({ display: 'flex', flexDirection: 'row', alignItems: 'flex-start' });
  });

  it.each([
    ['start', 'flex-start'],
    ['center', 'center'],
    ['end', 'flex-end'],
    ['stretch', 'stretch'],
  ] as const)('align %s -> align-items %s', (align, expected) => {
    expect(css(node({ type: 'frame', layout: 'row', align }), null).alignItems).toBe(expected);
  });

  it.each([
    ['center', 'center'],
    ['end', 'flex-end'],
    ['between', 'space-between'],
  ] as const)('justify %s -> justify-content %s', (justify, expected) => {
    expect(css(node({ type: 'frame', layout: 'row', justify }), null).justifyContent).toBe(
      expected,
    );
  });

  it('layout:none frames ignore gap/padding/align and just clip', () => {
    const out = css(
      node({ type: 'frame', layout: 'none', gap: 9, padding: [1, 2, 3, 4], clip: true }),
      null,
    );
    expect(out).toEqual({
      position: 'relative',
      width: '100px',
      height: '100px',
      overflow: 'hidden',
    });
  });

  it('a flex frame inside a flex parent is not made position:relative', () => {
    expect(
      css(node({ type: 'frame', layout: 'row', w: 'hug', h: 'hug' }), column),
    ).not.toHaveProperty('position');
    expect(css(node({ type: 'frame', layout: 'none', w: 50, h: 50 }), column)).toMatchObject({
      position: 'relative',
    });
  });
});

describe('appearance', () => {
  it('solid, token and gradient fills', () => {
    expect(css(node({ type: 'rect', fill: '#112233' })).backgroundColor).toBe('#112233');
    expect(css(node({ type: 'rect', fill: '$primary' })).backgroundColor).toBe('#5B3CB0');
    const grad = css(node({ type: 'rect', fill: 'linear-gradient(90deg, $primary, #fff)' }));
    expect(grad.backgroundImage).toBe('linear-gradient(90deg, #5B3CB0, #fff)');
    expect(grad).not.toHaveProperty('backgroundColor');
    expect(css(node({ type: 'rect', fill: 'radial-gradient(circle, #000, #fff)' }))).toHaveProperty(
      'backgroundImage',
    );
  });

  it('unknown tokens are dropped and reported', () => {
    const issues: TokenIssue[] = [];
    const out = css(node({ type: 'rect', fill: '$nope', stroke: '$nada' }), absFrame, issues);
    expect(out).not.toHaveProperty('backgroundColor');
    expect(out).not.toHaveProperty('outline');
    expect(issues.map((i) => i.token)).toEqual(['$nope', '$nada']);
    expect(() => css(node({ type: 'rect', fill: '$nope' }))).not.toThrow();
  });

  it('stroke inside / center / outside via outline', () => {
    const base = { type: 'rect', stroke: '#000', strokeWidth: 4 } as const;
    expect(css(node({ ...base, strokeAlign: 'inside' }))).toMatchObject({
      outline: '4px solid #000',
      outlineOffset: '-4px',
    });
    expect(css(node({ ...base }))).toMatchObject({
      outline: '4px solid #000',
      outlineOffset: '-4px',
    }); // inside is the default
    expect(css(node({ ...base, strokeAlign: 'center' }))).toMatchObject({
      outline: '4px solid #000',
      outlineOffset: '-2px',
    });
    const outside = css(node({ ...base, strokeAlign: 'outside' }));
    expect(outside.outline).toBe('4px solid #000');
    expect(outside).not.toHaveProperty('outlineOffset');
  });

  it('strokeWidth defaults to 1 with a stroke; 0 or no stroke means none', () => {
    expect(css(node({ type: 'rect', stroke: '#000' })).outline).toBe('1px solid #000');
    expect(css(node({ type: 'rect', stroke: '#000', strokeWidth: 0 }))).not.toHaveProperty(
      'outline',
    );
    expect(css(node({ type: 'rect', strokeWidth: 3 }))).not.toHaveProperty('outline');
  });

  it('radius: number, token, tuple, zero and ellipse', () => {
    expect(css(node({ type: 'rect', radius: 8 })).borderRadius).toBe('8px');
    expect(css(node({ type: 'rect', radius: '$radius.md' })).borderRadius).toBe('10px');
    expect(css(node({ type: 'rect', radius: [1, 2, 3, 4] })).borderRadius).toBe('1px 2px 3px 4px');
    expect(css(node({ type: 'rect', radius: 0 }))).not.toHaveProperty('borderRadius');
    expect(css(node({ type: 'ellipse', radius: 4 })).borderRadius).toBe('50%');
  });

  it('shadows, blur, opacity, rotation and visibility', () => {
    const out = css(
      node({
        type: 'rect',
        shadow: [
          { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.1)' },
          { x: 0, y: 0, blur: 0, spread: 1, color: '$border', inset: true },
          { x: 1, y: 1, blur: 1, spread: 1, color: '$missing' },
        ],
        blur: 2,
        backdropBlur: 8,
        opacity: 0.5,
        rotation: 12.5,
      }),
    );
    expect(out.boxShadow).toBe('0px 4px 12px 0px rgba(0,0,0,0.1), inset 0px 0px 0px 1px #E8E6DC');
    expect(out.filter).toBe('blur(2px)');
    expect(out.backdropFilter).toBe('blur(8px)');
    expect(out.WebkitBackdropFilter).toBe('blur(8px)');
    expect(out.opacity).toBe('0.5');
    expect(out.transform).toBe('rotate(12.5deg)');
    expect(css(node({ type: 'rect', visible: false })).display).toBe('none');
    expect(css(node({ type: 'frame', layout: 'row', visible: false })).display).toBe('none');
    expect(
      css(node({ type: 'rect', shadow: [{ x: 0, y: 0, blur: 0, spread: 0, color: '$missing' }] })),
    ).not.toHaveProperty('boxShadow');
  });

  it('images: block + object-fit', () => {
    expect(css(node({ type: 'image', w: 200, h: 100 }))).toMatchObject({
      display: 'block',
      objectFit: 'cover',
    });
    expect(css(node({ type: 'image', fit: 'contain' })).objectFit).toBe('contain');
  });

  it('lines are bars coloured by stroke, then fill, and never get an outline', () => {
    const line = css(node({ type: 'line', w: 200, h: 2, stroke: '$border', strokeWidth: 9 }));
    expect(line).toMatchObject({ width: '200px', height: '2px', backgroundColor: '#E8E6DC' });
    expect(line).not.toHaveProperty('outline');
    expect(css(node({ type: 'line', fill: '#000' })).backgroundColor).toBe('#000');
    expect(css(node({ type: 'line' }))).not.toHaveProperty('backgroundColor');
  });

  it('formats numbers compactly', () => {
    expect(css(node({ type: 'rect', x: 0.30000000000000004, y: -0, w: 1.23456, h: 2 })).left).toBe(
      '0.3px',
    );
    expect(css(node({ type: 'rect', x: 0, y: -0 })).top).toBe('0px');
    expect(css(node({ type: 'rect', w: 1.23456 })).width).toBe('1.235px');
  });
});

describe('text', () => {
  it('hug width = one line; typography is mapped and tokens resolved', () => {
    const t = node({
      type: 'text',
      text: 'Hello',
      fontFamily: '$font.heading',
      fontSize: 48,
      fontWeight: 700,
      lineHeight: 1.08,
      letterSpacing: -0.02,
      textAlign: 'center',
      textTransform: 'uppercase',
      color: '$text',
    });
    expect(css(t, column)).toEqual({
      flex: '0 0 auto',
      fontFamily: '"Fraunces", Georgia, serif',
      fontSize: '48px',
      fontWeight: '700',
      lineHeight: '1.08',
      letterSpacing: '-0.02em',
      textAlign: 'center',
      textTransform: 'uppercase',
      color: '#1F1E1D',
      whiteSpace: 'pre',
    });
  });

  it('numeric or fill width wraps', () => {
    const fixed = css(node({ type: 'text', w: 200 }), absFrame);
    expect(fixed).toMatchObject({
      width: '200px',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
    });
    const fill = css(node({ type: 'text', w: 'fill' }), row);
    expect(fill).toMatchObject({ flex: '1 1 0', minWidth: '0', whiteSpace: 'pre-wrap' });
  });

  it('omits unset typography and the none transform', () => {
    const out = css(node({ type: 'text', textTransform: 'none' }), null);
    expect(out).toEqual({
      fontSize: '16px',
      fontWeight: '400',
      lineHeight: '1.4',
      whiteSpace: 'pre',
    });
  });

  it('fontStack picks a generic fallback and strips quote characters', () => {
    expect(fontStack('Inter')).toBe('"Inter", system-ui, -apple-system, "Segoe UI", sans-serif');
    expect(fontStack('Playfair Display')).toMatch(/serif$/);
    expect(fontStack('JetBrains Mono')).toMatch(/monospace$/);
    expect(fontStack('Ev"il\\')).toBe('"Evil", system-ui, -apple-system, "Segoe UI", sans-serif');
  });

  it('plain font names pass through', () => {
    expect(css(node({ type: 'text', fontFamily: 'DM Sans' }), null).fontFamily).toMatch(
      /^"DM Sans"/,
    );
  });
});

describe('cssToString', () => {
  it('kebab-cases keys and handles vendor prefixes', () => {
    expect(cssPropertyName('backgroundColor')).toBe('background-color');
    expect(cssPropertyName('WebkitBackdropFilter')).toBe('-webkit-backdrop-filter');
    expect(cssToString({ marginTop: '4px', WebkitBackdropFilter: 'blur(2px)' })).toBe(
      'margin-top: 4px; -webkit-backdrop-filter: blur(2px);',
    );
    expect(cssToString({ a: '1', b: '2' }, { separator: '\n' })).toBe('a: 1;\nb: 2;');
    expect(cssToString({})).toBe('');
  });

  it('drops values that could break out of a declaration or load resources', () => {
    expect(
      cssToString({
        ok: '1px',
        a: 'red; background: url(x)',
        b: 'url(https://evil.test/x)',
        c: 'x}</style>',
        d: 'expression(1)',
        e: '@import "x"',
        f: 'a\\b',
      }),
    ).toBe('ok: 1px;');
  });

  it('GLOBAL_RESET_CSS carries the box-sizing contract', () => {
    expect(GLOBAL_RESET_CSS).toContain('box-sizing:border-box');
  });
});

describe('game-UI looks: flip, colour adjustments, outlined and gradient lettering', () => {
  it('flips combine with rotation', () => {
    expect(css(node({ type: 'rect', w: 10, h: 10, flipX: true }), page).transform).toBe(
      'scale(-1, 1)',
    );
    expect(
      css(node({ type: 'rect', w: 10, h: 10, rotation: 30, flipX: true, flipY: true }), page)
        .transform,
    ).toBe('rotate(30deg) scale(-1, -1)');
  });

  it('colour adjustments become one filter, next to blur, and unchanged values add nothing', () => {
    const adjusted = css(
      node({ type: 'image', w: 10, h: 10, blur: 2, hue: 120, saturation: 1.4, brightness: 1 }),
      page,
    );
    expect(adjusted.filter).toBe('blur(2px) hue-rotate(120deg) saturate(1.4)');
    expect(css(node({ type: 'image', w: 10, h: 10, contrast: 1 }), page).filter).toBeUndefined();
  });

  it('a text outline is drawn behind the fill and is the visible thickness', () => {
    const t = css(
      node({
        type: 'text',
        text: 'PLAY',
        color: '#fff',
        textStroke: '#120B24',
        textStrokeWidth: 4,
      }),
      column,
    );
    expect(t.WebkitTextStroke).toBe('8px #120B24');
    expect(t.paintOrder).toBe('stroke fill');
    expect(t.color).toBe('#fff');
  });

  it('gradient lettering clips the gradient to the glyphs and moves shadows to a drop-shadow', () => {
    const t = css(
      node({
        type: 'text',
        text: 'GOLD',
        color: 'linear-gradient(180deg, #FFE27A, #FFB020)',
        shadow: [{ x: 0, y: 3, blur: 0, spread: 0, color: '#120B24' }],
      }),
      column,
    );
    expect(t.backgroundImage).toContain('linear-gradient');
    expect(t.backgroundClip).toBe('text');
    expect(t.color).toBe('transparent');
    expect(t.textShadow).toBeUndefined();
    expect(t.filter).toBe('drop-shadow(0px 3px 0px #120B24)');
  });
});

describe('tiled images', () => {
  it('a tiled image repeats from the corner at the tile size, with no object-fit', () => {
    const css1 = css(
      node({ type: 'image', w: 200, h: 100, fit: 'tile', tileSize: 32, assetId: 'img_ab12c' }),
      page,
    );
    expect(css1).toMatchObject({
      backgroundRepeat: 'repeat',
      backgroundSize: '32px auto',
      backgroundPosition: '0 0',
    });
    expect(css1.objectFit).toBeUndefined();
    expect(css(node({ type: 'image', w: 8, h: 8, fit: 'tile' }), page).backgroundSize).toBe('auto');
  });

  it('cssToString lets an exported asset url through and still refuses other urls', () => {
    expect(cssToString({ backgroundImage: 'url(assets/stone-tile.png)' })).toContain(
      'assets/stone-tile.png',
    );
    expect(cssToString({ backgroundImage: 'url(https://evil.test/x.png)' })).toBe('');
    expect(cssToString({ backgroundImage: 'url(assets/../x.png)' })).toBe('');
  });
});

describe('blend modes', () => {
  it('writes mix-blend-mode, and nothing for normal', () => {
    expect(css(node({ type: 'rect', w: 10, h: 10, blendMode: 'overlay' }), page).mixBlendMode).toBe(
      'overlay',
    );
    expect(
      css(node({ type: 'rect', w: 10, h: 10, blendMode: 'normal' }), page).mixBlendMode,
    ).toBeUndefined();
  });
});

describe('shared text styles', () => {
  const tokens = {
    ...DEFAULT_TOKENS,
    textStyles: {
      'Title Outline': {
        fontFamily: 'Lilita One',
        fontSize: 48,
        color: '#FFFFFF',
        textStroke: '#120B24',
        textStrokeWidth: 4,
      },
    },
  };
  const label = node({
    type: 'text',
    text: 'PLAY',
    fontSize: 12,
    color: '#000000',
    textStyle: 'Title Outline',
  });

  it("the style replaces the layer's own typography, the layer keeps its text", () => {
    const out = nodeToCss(label, page, tokens);
    expect(out.fontSize).toBe('48px');
    expect(out.color).toBe('#FFFFFF');
    expect(out.WebkitTextStroke).toBe('8px #120B24');
    expect(out.fontFamily).toContain('Lilita One');
  });

  it('editing the style changes every layer that uses it', () => {
    const bigger = { ...tokens, textStyles: { 'Title Outline': { fontSize: 60 } } };
    expect(nodeToCss(label, page, bigger).fontSize).toBe('60px');
  });

  it('an unknown style name leaves the layer as it is', () => {
    const lone = node({ type: 'text', text: 'x', fontSize: 12, textStyle: 'Nope' });
    expect(nodeToCss(lone, page, tokens).fontSize).toBe('12px');
  });
});
