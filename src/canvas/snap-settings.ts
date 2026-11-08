import { create } from 'zustand';
import type { SnapOptions } from './snapping';

/**
 * Snapping preferences for the human view. They live in this browser/app profile, never in the
 * design and never in front of the AI tools: an agent places things exactly where it says.
 */
export interface SnapSettings extends SnapOptions {
  /** Master switch (also toggled with Shift+S; holding Ctrl while dragging turns snapping off). */
  enabled: boolean;
}

const KEY = 'aframe.snap';
const DEFAULTS: SnapSettings = { enabled: true, objects: true, spacing: true, grid: 0 };

function load(): SnapSettings {
  try {
    const raw = JSON.parse(
      globalThis.localStorage?.getItem(KEY) ?? 'null',
    ) as Partial<SnapSettings> | null;
    if (!raw || typeof raw !== 'object') return DEFAULTS;
    const grid = typeof raw.grid === 'number' && raw.grid >= 0 && raw.grid <= 256 ? raw.grid : 0;
    return {
      enabled: raw.enabled !== false,
      objects: raw.objects !== false,
      spacing: raw.spacing !== false,
      grid,
    };
  } catch {
    return DEFAULTS;
  }
}

export const useSnapSettings = create<SnapSettings>(() => load());

export function setSnapSettings(patch: Partial<SnapSettings>): void {
  useSnapSettings.setState(patch);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(useSnapSettings.getState()));
  } catch {
    /* private mode: the setting just does not persist */
  }
}

/** The options to snap with right now, or null while snapping is off. */
export function activeSnap(): SnapOptions | null {
  const s = useSnapSettings.getState();
  if (!s.enabled || (!s.objects && !s.spacing && s.grid === 0)) return null;
  return { objects: s.objects, spacing: s.spacing, grid: s.grid };
}
