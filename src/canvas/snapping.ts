import type { Guide } from '../store/store';
import { bottom, centerX, centerY, right, type Rect } from './geometry';

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
export function snapMove(moving: Rect, targets: readonly Rect[], threshold: number): SnapResult {
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
