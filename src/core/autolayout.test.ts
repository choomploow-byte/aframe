import { describe, expect, it } from 'vitest';
import { inferAutoLayout, type LayoutRect } from './autolayout';

const r = (id: string, x: number, y: number, w: number, h: number): LayoutRect => ({
  id,
  x,
  y,
  w,
  h,
});

describe('inferAutoLayout', () => {
  it('finds a row, its order, gap and padding', () => {
    const plan = inferAutoLayout({ w: 312, h: 100 }, [
      r('c', 212, 20, 80, 60),
      r('a', 20, 20, 80, 60),
      r('b', 116, 20, 80, 60),
    ]);
    expect(plan).toEqual({
      layout: 'row',
      order: ['a', 'b', 'c'],
      gap: 16,
      padding: [20, 20, 20, 20],
      align: 'start',
    });
  });

  it('finds a column with an even gap', () => {
    const plan = inferAutoLayout({ w: 200, h: 300 }, [
      r('a', 16, 16, 168, 40),
      r('b', 16, 72, 168, 40),
      r('c', 16, 128, 168, 40),
    ]);
    expect(plan).toMatchObject({
      layout: 'column',
      order: ['a', 'b', 'c'],
      gap: 16,
      align: 'start',
    });
    expect(plan.padding).toEqual([16, 16, 132, 16]);
  });

  it('detects cross-axis centre and end alignment', () => {
    const centred = inferAutoLayout({ w: 300, h: 200 }, [
      r('a', 100, 0, 100, 40),
      r('b', 50, 50, 200, 40),
      r('c', 125, 100, 50, 40),
    ]);
    expect(centred).toMatchObject({ layout: 'column', align: 'center' });
    const ended = inferAutoLayout({ w: 300, h: 200 }, [
      r('a', 200, 0, 100, 40),
      r('b', 100, 50, 200, 40),
    ]);
    expect(ended).toMatchObject({ layout: 'column', align: 'end' });
  });

  it('falls back to start alignment when children do not agree', () => {
    const plan = inferAutoLayout({ w: 300, h: 200 }, [
      r('a', 0, 0, 100, 40),
      r('b', 37, 50, 90, 40),
    ]);
    expect(plan.align).toBe('start');
  });

  it('breaks direction ties by the shape of the group', () => {
    // Two diagonal boxes: no shared band either way; wider than tall -> row.
    expect(
      inferAutoLayout({ w: 400, h: 400 }, [r('a', 0, 0, 100, 20), r('b', 200, 100, 100, 20)])
        .layout,
    ).toBe('row');
    expect(
      inferAutoLayout({ w: 400, h: 400 }, [r('a', 0, 0, 20, 100), r('b', 100, 200, 20, 100)])
        .layout,
    ).toBe('column');
  });

  it('handles one child and none', () => {
    expect(inferAutoLayout({ w: 100, h: 100 }, [r('a', 10, 10, 80, 80)])).toEqual({
      layout: 'column',
      order: ['a'],
      gap: 0,
      padding: [10, 10, 10, 10],
      align: 'start',
    });
    expect(inferAutoLayout({ w: 100, h: 100 }, [])).toEqual({
      layout: 'column',
      order: [],
      gap: 0,
      padding: [0, 0, 0, 0],
      align: 'start',
    });
  });

  it('never returns negative padding or gap (overlapping or overflowing children)', () => {
    const plan = inferAutoLayout({ w: 100, h: 100 }, [
      r('a', -10, 0, 80, 40),
      r('b', 40, 20, 80, 40),
    ]);
    expect(plan.gap).toBeGreaterThanOrEqual(0);
    for (const p of plan.padding) expect(p).toBeGreaterThanOrEqual(0);
  });

  it('snaps near-grid values to multiples of 4 and keeps odd ones', () => {
    const plan = inferAutoLayout({ w: 200, h: 100 }, [
      r('a', 15, 11, 50, 50),
      r('b', 83, 11, 50, 50),
    ]);
    expect(plan.padding[3]).toBe(16); // 15 is within 1px of 16
    expect(plan.gap).toBe(18); // 2px from the nearest multiple of 4: deliberate, so kept
  });
});
