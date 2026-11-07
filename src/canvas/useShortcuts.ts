import { useEffect } from 'react';
import { store } from '../store/store';
import { getCanvasApi } from './canvas-api';
import { handleKeyDown, type ShortcutContext } from './shortcuts';

/** The context shortcuts and the command palette run commands with, built from the live canvas. */
export function currentShortcutContext(): ShortcutContext {
  const api = getCanvasApi();
  const measure = api?.measure ?? (() => null);
  return { store, api, env: { store, measure } };
}

/** Wires the shortcut registry to the window. Mount once. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      handleKeyDown(e, currentShortcutContext());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
