import { create } from 'zustand';
import type { ShapeTool } from '@core/pixelart';

/**
 * What the Pixel Art editor is showing right now. None of this is part of the design or its undo
 * history: the open view, the chosen tool and colour, the zoom and where the canvas sits.
 */
export type PixelTool = 'pencil' | 'eraser' | 'fill' | 'picker' | ShapeTool;

export const PIXEL_TOOLS: readonly { id: PixelTool; label: string; key: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'P' },
  { id: 'eraser', label: 'Eraser', key: 'E' },
  { id: 'fill', label: 'Fill', key: 'F' },
  { id: 'line', label: 'Line', key: 'L' },
  { id: 'rect', label: 'Rectangle outline', key: 'R' },
  { id: 'rectFilled', label: 'Filled rectangle', key: 'Shift+R' },
  { id: 'picker', label: 'Colour picker', key: 'I' },
];

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;

export interface PixelUi {
  open: boolean;
  tool: PixelTool;
  /** The palette index drawing uses. */
  color: number;
  zoom: number;
  pan: { x: number; y: number };
  grid: boolean;
  mirrorX: boolean;
  mirrorY: boolean;
  exportScale: number;
  /** The start screen (new canvas / open a file) is showing instead of the editor. */
  starting: boolean;
}

export const usePixelUi = create<PixelUi>(() => ({
  open: false,
  tool: 'pencil',
  color: 1,
  zoom: 16,
  pan: { x: 0, y: 0 },
  grid: true,
  mirrorX: false,
  mirrorY: false,
  exportScale: 8,
  starting: false,
}));

export const setPixelUi = (patch: Partial<PixelUi>): void => usePixelUi.setState(patch);

export const clampZoom = (z: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z)));

/** A zoom that fits the canvas in the view with some room (never below 1, never above 32). */
export function fitZoom(canvasW: number, canvasH: number, viewW: number, viewH: number): number {
  const z = Math.floor(Math.min((viewW - 48) / canvasW, (viewH - 48) / canvasH));
  return Math.min(32, Math.max(MIN_ZOOM, Number.isFinite(z) ? z : MIN_ZOOM));
}

export function openPixelEditor(): void {
  setPixelUi({ open: true });
}

export function closePixelEditor(): void {
  setPixelUi({ open: false, starting: false });
}
