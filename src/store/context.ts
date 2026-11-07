import type { ToolContext } from '@core/types';
import type { StoreApi } from 'zustand/vanilla';
import type { AtelierState } from './store';

/**
 * The in-app `ToolContext` (docs/03 §2): the chat agent reads and writes the live store, so its
 * edits are undoable like any other and the canvas updates immediately. Screenshots are added by
 * the canvas once it exists (Phase 5).
 */
export function createStoreContext(
  store: StoreApi<AtelierState>,
  extras: Partial<ToolContext> = {},
): ToolContext {
  return {
    ...extras,
    getDoc: () => store.getState().doc,
    commit: (next, meta) => {
      store.getState().commitExternal(next, meta?.label ?? 'AI change');
    },
    getSelection: () => [...store.getState().selection],
  };
}
