/**
 * "Add auto-layout" (Ctrl+Alt+A): infer a row/column layout from where children currently sit.
 * Pure geometry in the frame's own coordinate space; the caller measures and applies the plan.
 */
export interface LayoutRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AutoLayoutPlan {
  layout: 'row' | 'column';
  /** Child ids in visual order, to be applied with move ops. */
  order: string[];
  gap: number;
  /** top, right, bottom, left */
  padding: [number, number, number, number];
  /** Cross-axis alignment shared by the children, or 'start' when they do not agree. */
  align: 'start' | 'center' | 'end';
}

const ALIGN_TOLERANCE = 1;

/**
 * Nearest multiple of 4 when within 1px of it (the designers' grid), else the nearest integer.
 * A wider tolerance would snap every value (nothing is more than 2px from a multiple of 4) and
 * visibly move things that were deliberately placed.
 */
function tidy(value: number): number {
  const v = Math.max(0, value);
  const snapped = Math.round(v / 4) * 4;
  return Math.abs(snapped - v) <= 1 ? snapped : Math.round(v);
}

function overlap(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function inferAutoLayout(
  frame: { w: number; h: number },
  children: readonly LayoutRect[],
): AutoLayoutPlan {
  if (children.length === 0) {
    return { layout: 'column', order: [], gap: 0, padding: [0, 0, 0, 0], align: 'start' };
  }

  // Direction: children that share a horizontal band form a row, those that share a vertical
  // band form a column. Ties fall back to which way the group is wider.
  let rowPairs = 0;
  let columnPairs = 0;
  for (let i = 0; i < children.length; i += 1) {
    for (let j = i + 1; j < children.length; j += 1) {
      const a = children[i] as LayoutRect;
      const b = children[j] as LayoutRect;
      const vertical = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
      const horizontal = overlap(a.x, a.x + a.w, b.x, b.x + b.w);
      if (vertical > 0.5 * Math.min(a.h, b.h)) rowPairs += 1;
      if (horizontal > 0.5 * Math.min(a.w, b.w)) columnPairs += 1;
    }
  }
  const minX = Math.min(...children.map((c) => c.x));
  const minY = Math.min(...children.map((c) => c.y));
  const maxX = Math.max(...children.map((c) => c.x + c.w));
  const maxY = Math.max(...children.map((c) => c.y + c.h));
  let layout: 'row' | 'column';
  if (rowPairs !== columnPairs) layout = rowPairs > columnPairs ? 'row' : 'column';
  else layout = maxX - minX > maxY - minY ? 'row' : 'column';

  const main = (c: LayoutRect): number => (layout === 'row' ? c.x : c.y);
  const cross = (c: LayoutRect): number => (layout === 'row' ? c.y : c.x);
  const mainSize = (c: LayoutRect): number => (layout === 'row' ? c.w : c.h);
  const crossSize = (c: LayoutRect): number => (layout === 'row' ? c.h : c.w);

  const ordered = [...children].sort((a, b) => main(a) - main(b) || cross(a) - cross(b));
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1] as LayoutRect;
    const next = ordered[i] as LayoutRect;
    gaps.push(Math.max(0, main(next) - (main(prev) + mainSize(prev))));
  }

  const starts = ordered.map(cross);
  const centers = ordered.map((c) => cross(c) + crossSize(c) / 2);
  const ends = ordered.map((c) => cross(c) + crossSize(c));
  const same = (values: number[]): boolean =>
    Math.max(...values) - Math.min(...values) <= ALIGN_TOLERANCE;
  let align: AutoLayoutPlan['align'] = 'start';
  if (ordered.length > 1 && !same(starts)) {
    if (same(centers)) align = 'center';
    else if (same(ends)) align = 'end';
  }

  return {
    layout,
    order: ordered.map((c) => c.id),
    gap: tidy(median(gaps)),
    padding: [tidy(minY), tidy(frame.w - maxX), tidy(frame.h - maxY), tidy(minX)],
    align,
  };
}
