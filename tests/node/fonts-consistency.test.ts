import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOG } from '../../src/core/fonts';

/** The font catalogue the tools describe must be exactly what the canvas registers (fonts.css). */
describe('bundled fonts', () => {
  const css = readFileSync('src/canvas/fonts.css', 'utf8');
  const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const body = m[1] ?? '';
    return {
      family: /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? '',
      weight: /font-weight:\s*([\d ]+);/.exec(body)?.[1]?.trim() ?? '',
    };
  });

  it('registers every family the catalogue lists, and nothing else', () => {
    expect([...new Set(faces.map((f) => f.family))].sort()).toEqual(
      FONT_CATALOG.map((f) => f.name).sort(),
    );
  });

  it('registers each family with the weights the catalogue promises', () => {
    for (const font of FONT_CATALOG) {
      const weights = new Set(faces.filter((f) => f.family === font.name).map((f) => f.weight));
      expect(weights.size, font.name).toBe(1);
      const [lo, hi] = font.weights;
      const expected = font.variable ? `${lo} ${hi}` : String(lo);
      // DM Sans ships 100-1000; the catalogue stops at the 900 the editor offers.
      const got = [...weights][0] ?? '';
      if (font.name === 'DM Sans') expect(got).toBe('100 1000');
      else expect(got, font.name).toBe(expected);
    }
  });

  it('keeps display faces to woff2 only', () => {
    expect(css).not.toMatch(/lilita-one[^)]*\.woff\)/);
  });
});
