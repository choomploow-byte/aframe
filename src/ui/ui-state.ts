import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Which modal is open. At most one; opening another replaces it. */
export type DialogId =
  | 'palette'
  | 'shortcuts'
  | 'connect'
  | 'projects'
  | 'recover'
  | 'export'
  | 'settings'
  | 'lint'
  | 'import';

interface UiState {
  dialog: DialogId | null;
  open: (id: DialogId) => void;
  close: () => void;
}

export const uiStore = createStore<UiState>()((set) => ({
  dialog: null,
  open: (id) => set({ dialog: id }),
  close: () => set({ dialog: null }),
}));

export const openDialog = (id: DialogId): void => uiStore.getState().open(id);
export const closeDialog = (): void => uiStore.getState().close();

export function useDialog(): DialogId | null {
  return useStore(uiStore, (s) => s.dialog);
}
