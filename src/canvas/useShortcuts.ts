import { useEffect } from 'react';
import { store } from '../store/store';
import { getCanvasApi } from './canvas-api';
import { handleKeyDown } from './shortcuts';

/** Wires the shortcut registry to the window. Mount once. */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const api = getCanvasApi();
      const measure = api?.measure ?? (() => null);
      handleKeyDown(e, { store, api, env: { store, measure } });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
