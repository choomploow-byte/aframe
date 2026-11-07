import type { Viewport } from '../store/store';
import type { Rect } from './geometry';
import { screenToWorld } from './viewport';

/**
 * Reads where nodes really are by asking the DOM, so handles stay exact under auto-layout, hug and
 * fill sizing, nested frames and any zoom (docs/03 §3). `getBoundingClientRect` returns the
 * transformed box, so no manual inverse of the world transform is needed for screen rects.
 *
 * Pitfall: the browser reports the axis-aligned bounds, so once rotation exists (v0.2) a rotated
 * node's handles need the element's own transform rather than this rect.
 */
export interface Measurer {
  /** The canvas element; screen rects are relative to its top-left corner. */
  readonly container: HTMLElement;
  element(id: string): HTMLElement | null;
  /** Rect in canvas-relative screen pixels. */
  screenRect(id: string): Rect | null;
  /** Rect in world units (what `x`, `y`, `w`, `h` mean in the document). */
  worldRect(id: string): Rect | null;
  /** Canvas size in screen pixels. */
  size(): { w: number; h: number };
}

export function createMeasurer(
  container: HTMLElement,
  getViewport: () => Viewport,
  getRootId: () => string,
): Measurer {
  const element = (id: string): HTMLElement | null =>
    container.querySelector<HTMLElement>(`[data-node-id="${id}"]`);

  const screenRect = (id: string): Rect | null => {
    const el = element(id);
    if (!el) return null;
    const origin = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
  };

  return {
    container,
    element,
    screenRect,
    worldRect: (id) => {
      if (id === getRootId()) return { x: 0, y: 0, w: 0, h: 0 };
      const s = screenRect(id);
      if (!s) return null;
      const vp = getViewport();
      const topLeft = screenToWorld(vp, { x: s.x, y: s.y });
      return { x: topLeft.x, y: topLeft.y, w: s.w / vp.zoom, h: s.h / vp.zoom };
    },
    size: () => {
      const r = container.getBoundingClientRect();
      return { w: r.width, h: r.height };
    },
  };
}
