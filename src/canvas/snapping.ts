import type { Guide } from '../store/store';
import { bottom, centerX, centerY, right, round2, type Rect } from './geometry';

export interface SnapResult {
  /** Offset to add to the moving rect so it sits on the snapped lines. */
  dx: number;
  dy: number;
  guides: Guide[];
}

const EPS = 0.01;

function xLines(r: Rect): number[] {
  return [r.x, centerX(r), right(r)];
}
function yLines(r: Rect): number[] {
  return [r.y, centerY(r), bottom(r)];
}

/** Best (smallest-distance) snap of any `own` line onto any `target` line within `threshold`. */
function bestSnap(own: number[], targets: number[], threshold: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (const o of own) {
    for (const t of targets) {
      const d = t - o;
      if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(bestDist)) {
        best = d;
        bestDist = d;
      }
    }
  }
  return bestDist === Infinity ? 0 : best;
}

/**
 * Snaps a moving rectangle to the edges and centres of `targets` (siblings and the parent), all in
 * world units. `threshold` is the snap distance in world units (6 screen px / zoom). Returns the
 * correction plus the guides to draw, spanning the moving rect and every target that lines up.
 */
function alignSnap(moving: Rect, targets: readonly Rect[], threshold: number): SnapResult {
  if (targets.length === 0) return { dx: 0, dy: 0, guides: [] };

  const dx = bestSnap(xLines(moving), targets.flatMap(xLines), threshold);
  const dy = bestSnap(yLines(moving), targets.flatMap(yLines), threshold);
  const snapped: Rect = { ...moving, x: moving.x + dx, y: moving.y + dy };

  const guides: Guide[] = [];
  const seen = new Set<string>();
  const add = (axis: 'x' | 'y', at: number, lo: number, hi: number): void => {
    const key = `${axis}:${Math.round(at * 100)}`;
    if (seen.has(key)) return;
    seen.add(key);
    guides.push({ axis, at, from: lo, to: hi });
  };

  if (
    dx !== 0 ||
    targets.some((t) => xLines(t).some((l) => xLines(snapped).some((m) => Math.abs(l - m) < EPS)))
  ) {
    for (const line of xLines(snapped)) {
      const matches = targets.filter((t) => xLines(t).some((l) => Math.abs(l - line) < EPS));
      if (matches.length === 0) continue;
      const tops = [snapped.y, ...matches.map((t) => t.y)];
      const bottoms = [bottom(snapped), ...matches.map(bottom)];
      add('x', line, Math.min(...tops), Math.max(...bottoms));
    }
  }
  if (
    dy !== 0 ||
    targets.some((t) => yLines(t).some((l) => yLines(snapped).some((m) => Math.abs(l - m) < EPS)))
  ) {
    for (const line of yLines(snapped)) {
      const matches = targets.filter((t) => yLines(t).some((l) => Math.abs(l - line) < EPS));
      if (matches.length === 0) continue;
      const lefts = [snapped.x, ...matches.map((t) => t.x)];
      const rights = [right(snapped), ...matches.map(right)];
      add('y', line, Math.min(...lefts), Math.max(...rights));
    }
  }
  return { dx, dy, guides };
}

// ---------------------------------------------------------------------------
// Options, equal spacing, grid and resize snapping
// ---------------------------------------------------------------------------

/** What the user has switched on (canvas/snap-settings.ts). Snapping is a view aid: nothing here is saved in the design. */
export interface SnapOptions {
  /** Edges and centres line up with other layers and the parent frame. */
  objects: boolean;
  /** Equal gaps: centre between two neighbours, or repeat a gap that already exists. */
  spacing: boolean;
  /** World grid in px (0 = off); used on an axis nothing else snapped. */
  grid: number;
}

const OBJECTS_ONLY: SnapOptions = { objects: true, spacing: false, grid: 0 };

const transpose = (r: Rect): Rect => ({ x: r.y, y: r.x, w: r.h, h: r.w });

/**
 * Equal-spacing snap along x for a rect among `targets`, using the targets that share its row. Either
 * centres it between its left and right neighbours, or makes its gap to a neighbour equal to a gap
 * that already exists between two other layers. Markers are the gaps to draw (with their size).
 */
function spacingX(
  moving: Rect,
  targets: readonly Rect[],
  threshold: number,
): { d: number; markers: Guide[] } | null {
  const row = targets
    .filter((t) => t.y < bottom(moving) && bottom(t) > moving.y)
    .sort((a, b) => a.x - b.x);
  if (row.length === 0) return null;
  const left = [...row]
    .filter((t) => right(t) <= moving.x + EPS)
    .sort((a, b) => right(b) - right(a))[0];
  const rightNb = row.find((t) => t.x >= right(moving) - EPS);
  const gaps: { a: Rect; b: Rect; g: number }[] = [];
  for (let i = 0; i + 1 < row.length; i += 1) {
    const a = row[i] as Rect;
    const b = row[i + 1] as Rect;
    if (b.x - right(a) > 0.5) gaps.push({ a, b, g: b.x - right(a) });
  }
  interface Cand {
    x: number;
    ref?: { a: Rect; b: Rect };
  }
  const cands: Cand[] = [];
  if (left && rightNb && rightNb.x - right(left) >= moving.w) {
    cands.push({ x: right(left) + (rightNb.x - right(left) - moving.w) / 2 });
  }
  for (const { a, b, g } of gaps) {
    if (left) cands.push({ x: right(left) + g, ref: { a, b } });
    if (rightNb) cands.push({ x: rightNb.x - g - moving.w, ref: { a, b } });
  }
  let best: Cand | undefined;
  for (const c of cands) {
    if (Math.abs(c.x - moving.x) > threshold) continue;
    if (!best || Math.abs(c.x - moving.x) < Math.abs(best.x - moving.x)) best = c;
  }
  if (!best) return null;
  const at = round2(moving.y + moving.h / 2);
  const final = best.x;
  const markers: Guide[] = [];
  const mark = (from: number, to: number, y: number): void => {
    if (to - from > 0.5) {
      markers.push({ axis: 'y', at: y, from, to, kind: 'gap', label: String(round2(to - from)) });
    }
  };
  if (left) mark(right(left), final, at);
  if (rightNb) mark(final + moving.w, rightNb.x, at);
  if (best.ref) mark(right(best.ref.a), best.ref.b.x, round2(best.ref.a.y + best.ref.a.h / 2));
  return { d: final - moving.x, markers };
}

const flipGuide = (g: Guide): Guide => ({ ...g, axis: g.axis === 'x' ? 'y' : 'x' });

/**
 * Snaps a moving rectangle the way the user asked: onto other layers' edges and centres, into equal
 * gaps, and onto a grid. With no options only edges and centres are used.
 */
export function snapMove(
  moving: Rect,
  targets: readonly Rect[],
  threshold: number,
  options: SnapOptions = OBJECTS_ONLY,
): SnapResult {
  let dx = 0;
  let dy = 0;
  const guides: Guide[] = [];
  let xDone = false;
  let yDone = false;
  if (options.objects) {
    const a = alignSnap(moving, targets, threshold);
    dx = a.dx;
    dy = a.dy;
    guides.push(...a.guides);
    xDone = a.dx !== 0 || a.guides.some((g) => g.axis === 'x');
    yDone = a.dy !== 0 || a.guides.some((g) => g.axis === 'y');
  }
  if (options.spacing && targets.length > 0) {
    if (!xDone) {
      const r = spacingX({ ...moving, y: moving.y + dy }, targets, threshold);
      if (r) {
        dx = r.d;
        guides.push(...r.markers);
        xDone = true;
      }
    }
    if (!yDone) {
      const r = spacingX(
        transpose({ ...moving, x: moving.x + dx }),
        targets.map(transpose),
        threshold,
      );
      if (r) {
        dy = r.d;
        guides.push(...r.markers.map(flipGuide));
        yDone = true;
      }
    }
  }
  if (options.grid > 0) {
    const g = options.grid;
    if (!xDone) {
      const d = Math.round((moving.x + dx) / g) * g - (moving.x + dx);
      if (Math.abs(d) <= threshold) dx += d;
    }
    if (!yDone) {
      const d = Math.round((moving.y + dy) / g) * g - (moving.y + dy);
      if (Math.abs(d) <= threshold) dy += d;
    }
  }
  return { dx: round2(dx), dy: round2(dy), guides };
}

export interface MovedEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

interface EdgeHit {
  d: number;
  side: 'lo' | 'hi';
  line: number;
}

function bestEdge(
  edges: { at: number; side: 'lo' | 'hi' }[],
  lines: (r: Rect) => number[],
  targets: readonly Rect[],
  threshold: number,
  options: SnapOptions,
): EdgeHit | null {
  let best: EdgeHit | null = null;
  for (const e of edges) {
    if (options.objects) {
      for (const t of targets) {
        for (const l of lines(t)) {
          const d = l - e.at;
          if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) {
            best = { d, side: e.side, line: l };
          }
        }
      }
    }
    if (!best && options.grid > 0) {
      const d = Math.round(e.at / options.grid) * options.grid - e.at;
      if (Math.abs(d) <= threshold) best = { d, side: e.side, line: e.at + d };
    }
  }
  return best;
}

/**
 * Snaps the edges being dragged in a resize (the others stay put) onto other layers' edges and
 * centres, or the grid. Returns the corrected rect and the guides to draw.
 */
export function snapEdges(
  rect: Rect,
  moved: MovedEdges,
  targets: readonly Rect[],
  threshold: number,
  options: SnapOptions = OBJECTS_ONLY,
): { rect: Rect; guides: Guide[] } {
  let { x, y, w, h } = rect;
  const guides: Guide[] = [];
  const xEdges: { at: number; side: 'lo' | 'hi' }[] = [];
  if (moved.left) xEdges.push({ at: x, side: 'lo' });
  if (moved.right) xEdges.push({ at: x + w, side: 'hi' });
  const sx = bestEdge(xEdges, xLines, targets, threshold, options);
  if (sx) {
    if (sx.side === 'lo') {
      x += sx.d;
      w -= sx.d;
    } else w += sx.d;
    const hits = targets.filter((t) => xLines(t).some((l) => Math.abs(l - sx.line) < EPS));
    guides.push({
      axis: 'x',
      at: sx.line,
      from: Math.min(y, ...hits.map((t) => t.y)),
      to: Math.max(y + h, ...hits.map(bottom)),
    });
  }
  const yEdges: { at: number; side: 'lo' | 'hi' }[] = [];
  if (moved.top) yEdges.push({ at: y, side: 'lo' });
  if (moved.bottom) yEdges.push({ at: y + h, side: 'hi' });
  const sy = bestEdge(yEdges, yLines, targets, threshold, options);
  if (sy) {
    if (sy.side === 'lo') {
      y += sy.d;
      h -= sy.d;
    } else h += sy.d;
    const hits = targets.filter((t) => yLines(t).some((l) => Math.abs(l - sy.line) < EPS));
    guides.push({
      axis: 'y',
      at: sy.line,
      from: Math.min(x, ...hits.map((t) => t.x)),
      to: Math.max(x + w, ...hits.map(right)),
    });
  }
  return { rect: { x: round2(x), y: round2(y), w: round2(w), h: round2(h) }, guides };
}
