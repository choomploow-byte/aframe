import type { MeasureFn } from '../store/commands';
import type { Point } from './geometry';

/**
 * What the toolbar, shortcuts and dev tools can ask of the one mounted canvas. A module-level
 * holder is enough: there is a single canvas per window.
 */
export interface CanvasApi {
  measure: MeasureFn;
  viewSize: () => { w: number; h: number };
  fitAll: () => void;
  fitSelection: () => void;
  zoomTo: (zoom: number) => void;
  zoomStep: (dir: 1 | -1) => void;
  /** The centre of the visible area in world coordinates. */
  viewCenter: () => Point;
  /** Abandons an in-progress drag/draw (Esc). Returns true if there was one. */
  cancelGesture: () => boolean;
}

let current: CanvasApi | null = null;

export function setCanvasApi(api: CanvasApi | null): void {
  current = api;
}

export function getCanvasApi(): CanvasApi | null {
  return current;
}
