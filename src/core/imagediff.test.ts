import { describe, expect, it } from 'vitest';
import { diffPixels } from './imagediff';

const solid = (w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    out.set([rgb[0], rgb[1], rgb[2], 255], i * 4);
  }
  return out;
};

describe('diffPixels', () => {
  it('identical pictures match completely', () => {
    const a = solid(40, 30, [10, 20, 30]);
    const { report, diff } = diffPixels(a, a, 40, 30);
    expect(report.matchPercent).toBe(100);
    expect(report.meanDifferencePercent).toBe(0);
    expect(report.worstRegions).toEqual([]);
    expect(diff).toHaveLength(40 * 30 * 4);
    expect(diff[3]).toBe(255);
  });

  it('counts a changed block and says where it is', () => {
    const w = 40;
    const h = 30;
    const a = solid(w, h, [0, 0, 0]);
    const b = solid(w, h, [0, 0, 0]);
    // Paint the bottom-right quarter white in the reference.
    for (let y = h / 2; y < h; y += 1) {
      for (let x = w / 2; x < w; x += 1) b.set([255, 255, 255, 255], (y * w + x) * 4);
    }
    const { report, diff } = diffPixels(a, b, w, h);
    expect(report.matchPercent).toBe(75);
    expect(report.worstRegions[0]?.where).toBe('bottom right');
    expect(report.worstRegions[0]?.mismatchPercent).toBe(100);
    // A differing pixel is red-ish, a matching one grey.
    const bad = ((h - 1) * w + (w - 1)) * 4;
    expect(diff[bad]).toBeGreaterThan(diff[bad + 1] as number);
    expect(diff[0]).toBe(diff[1]);
  });

  it('ignores tiny differences within the tolerance', () => {
    const a = solid(10, 10, [100, 100, 100]);
    const b = solid(10, 10, [110, 105, 100]);
    expect(diffPixels(a, b, 10, 10, 24).report.matchPercent).toBe(100);
    expect(diffPixels(a, b, 10, 10, 5).report.matchPercent).toBe(0);
  });

  it('refuses pictures of the wrong size', () => {
    expect(() => diffPixels(solid(2, 2, [0, 0, 0]), solid(3, 3, [0, 0, 0]), 2, 2)).toThrow();
  });
});
