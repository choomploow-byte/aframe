import type { Viewport } from '../store/store';
import type { Point, Rect } from './geometry';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;
/** Zoom stops for the keyboard and the zoom menu. */
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8, 16, 32, 64] as const;

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Canvas-relative screen point -> world coordinates. */
export function screenToWorld(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

export function worldToScreen(vp: Viewport, p: Point): Point {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}

export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, x: vp.x + dx, y: vp.y + dy };
}

/** Sets the zoom while keeping the world point under `anchor` (a screen point) where it is. */
export function zoomAt(vp: Viewport, nextZoom: number, anchor: Point): Viewport {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(vp, anchor);
  return { zoom, x: anchor.x - world.x * zoom, y: anchor.y - world.y * zoom };
}

/**
 * Wheel/pinch delta -> zoom factor. Browsers report pinch as ctrl+wheel with small deltas; a mouse
 * wheel notch is ~100. The exponential keeps zooming symmetric (in then out returns to the start).
 */
export function wheelZoomFactor(deltaY: number): number {
  const clamped = Math.max(-300, Math.min(300, deltaY));
  return Math.exp(-clamped * 0.01);
}

/** The next/previous stop from `ZOOM_STEPS` relative to the current zoom (dir: 1 in, -1 out). */
export function nextZoomStep(zoom: number, dir: 1 | -1): number {
  const eps = 1e-6;
  if (dir === 1) return ZOOM_STEPS.find((z) => z > zoom + eps) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - eps) ?? MIN_ZOOM;
}

/** Viewport that shows `rect` (world) centred in a view of the given size, with padding. */
export function fitRect(
  rect: Rect,
  view: { w: number; h: number },
  options: { padding?: number; maxZoom?: number } = {},
): Viewport {
  const padding = options.padding ?? 64;
  const maxZoom = options.maxZoom ?? 2;
  const availW = Math.max(1, view.w - padding * 2);
  const availH = Math.max(1, view.h - padding * 2);
  const zoom = clampZoom(
    Math.min(maxZoom, availW / Math.max(1, rect.w), availH / Math.max(1, rect.h)),
  );
  return {
    zoom,
    x: (view.w - rect.w * zoom) / 2 - rect.x * zoom,
    y: (view.h - rect.h * zoom) / 2 - rect.y * zoom,
  };
}
