import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** Which context menu is open and where. One at a time, shared by the canvas and the layers list. */
export type MenuSource = 'canvas' | 'layers';

interface MenuState {
  open: { x: number; y: number; source: MenuSource } | null;
  show: (x: number, y: number, source: MenuSource) => void;
  close: () => void;
}

export const menuStore = createStore<MenuState>()((set) => ({
  open: null,
  show: (x, y, source) => set({ open: { x, y, source } }),
  close: () => set({ open: null }),
}));

export const openContextMenu = (x: number, y: number, source: MenuSource): void =>
  menuStore.getState().show(x, y, source);

export function useOpenMenu(): MenuState['open'] {
  return useStore(menuStore, (s) => s.open);
}
