import { useSyncExternalStore } from 'react';

/**
 * Light / dark / follow-the-system. The choice is remembered in localStorage and applied as
 * `data-theme` on <html>. `public/theme-init.js` applies it before first paint, so there is no flash
 * of the wrong theme; this module keeps it in sync afterwards.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_KEY = 'atelier.theme';
const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system'; // private windows and blocked storage must not break the app
  }
}

let current: ThemePreference = read();

export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function setThemePreference(pref: ThemePreference): void {
  current = pref;
  try {
    if (pref === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* not persisted, still applied for this session */
  }
  applyTheme(pref);
  for (const l of listeners) l();
}

export const nextTheme = (pref: ThemePreference): ThemePreference =>
  pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => 'system',
  );
}

/** The theme actually showing right now ("system" resolved). */
export function resolvedTheme(pref: ThemePreference = current): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
