/**
 * Comparing two pictures of the same size: how much of the design matches the reference, and where
 * it does not. Pure (it works on RGBA byte arrays), so the maths is tested without a browser; the
 * app decodes the pictures and calls it (src/canvas/compare-reference.ts).
 */

export interface DiffRegion {
  /** Where, in words: "top left", "middle", "bottom right"... */
  where: string;
  /** In picture pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Share of this region's pixels that differ by more than the tolerance, 0-100. */
  mismatchPercent: number;
}

export interface DiffReport {
  width: number;
  height: number;
  /** Share of pixels that match within the tolerance, 0-100 (100 = identical). */
  matchPercent: number;
  /** Average colour distance, 0-100 (0 = identical). */
  meanDifferencePercent: number;
  /** The worst places, worst first (at most 4, only those that differ). */
  worstRegions: DiffRegion[];
}

const COLS = 3;
const ROWS = 3;
const COL_NAME = ['left', 'centre', 'right'];
const ROW_NAME = ['top', 'middle', 'bottom'];

function whereName(col: number, row: number): string {
  const r = ROW_NAME[row] ?? '';
  const c = COL_NAME[col] ?? '';
  if (r === 'middle' && c === 'centre') return 'centre';
  return `${r} ${c}`;
}

/**
 * `a` is the design, `b` the reference, both RGBA of `width` x `height`. `tolerance` is the largest
 * per-channel difference (0-255) still counted as a match (small differences are anti-aliasing).
 * Returns a picture that shows the design dimmed with every difference painted red (stronger red =
 * bigger difference), and the numbers.
 */
export function diffPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = 24,
): { diff: Uint8ClampedArray; report: DiffReport } {
  const total = width * height;
  if (a.length !== total * 4 || b.length !== total * 4) {
    throw new Error('Both pictures must be width x height RGBA.');
  }
  const diff = new Uint8ClampedArray(total * 4);
  const cellMismatch = new Array<number>(COLS * ROWS).fill(0);
  const cellTotal = new Array<number>(COLS * ROWS).fill(0);
  let mismatched = 0;
  let distance = 0;
  for (let y = 0; y < height; y += 1) {
    const row = Math.min(ROWS - 1, Math.floor((y * ROWS) / height));
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const dr = Math.abs((a[i] as number) - (b[i] as number));
      const dg = Math.abs((a[i + 1] as number) - (b[i + 1] as number));
      const db = Math.abs((a[i + 2] as number) - (b[i + 2] as number));
      const d = Math.max(dr, dg, db);
      distance += (dr + dg + db) / 3;
      const cell = row * COLS + Math.min(COLS - 1, Math.floor((x * COLS) / width));
      cellTotal[cell] = (cellTotal[cell] as number) + 1;
      // The design, dimmed and grey, so the differences stand out on top of it.
      const grey =
        ((a[i] as number) * 0.3 + (a[i + 1] as number) * 0.59 + (a[i + 2] as number) * 0.11) *
          0.35 +
        40;
      if (d > tolerance) {
        mismatched += 1;
        cellMismatch[cell] = (cellMismatch[cell] as number) + 1;
        const strength = Math.min(1, 0.45 + d / 255);
        diff[i] = grey + (255 - grey) * strength;
        diff[i + 1] = grey * (1 - strength) + 40 * strength;
        diff[i + 2] = grey * (1 - strength) + 40 * strength;
      } else {
        diff[i] = grey;
        diff[i + 1] = grey;
        diff[i + 2] = grey;
      }
      diff[i + 3] = 255;
    }
  }
  const regions: DiffRegion[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = row * COLS + col;
      const count = cellTotal[cell] as number;
      if (count === 0) continue;
      const percent = ((cellMismatch[cell] as number) / count) * 100;
      if (percent < 1) continue;
      const x0 = Math.floor((col * width) / COLS);
      const x1 = Math.floor(((col + 1) * width) / COLS);
      const y0 = Math.floor((row * height) / ROWS);
      const y1 = Math.floor(((row + 1) * height) / ROWS);
      regions.push({
        where: whereName(col, row),
        x: x0,
        y: y0,
        w: x1 - x0,
        h: y1 - y0,
        mismatchPercent: Math.round(percent * 10) / 10,
      });
    }
  }
  regions.sort((p, q) => q.mismatchPercent - p.mismatchPercent);
  return {
    diff,
    report: {
      width,
      height,
      matchPercent: total === 0 ? 100 : Math.round((1 - mismatched / total) * 1000) / 10,
      meanDifferencePercent: total === 0 ? 0 : Math.round((distance / total / 255) * 1000) / 10,
      worstRegions: regions.slice(0, 4),
    },
  };
}
