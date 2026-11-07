import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Transient messages with an optional action ("Image added" / Undo). Announced to screen readers
 * through the live region in `Toasts.tsx`. A tiny store of its own: toasts are not document state.
 */
export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  show: (
    toast: Omit<Toast, 'id' | 'kind'> & { kind?: Toast['kind'] },
    durationMs?: number,
  ) => number;
  dismiss: (id: number) => void;
  /** Drops every toast (used when another document opens: their Undo would act on the wrong one). */
  clear: () => void;
}

const MAX_VISIBLE = 3;
let nextId = 1;

export const toastStore = createStore<ToastState>()((set, get) => ({
  toasts: [],
  show: (toast, durationMs = toast.kind === 'error' ? 8000 : 4500) => {
    const id = nextId++;
    const next: Toast = { ...toast, kind: toast.kind ?? 'info', id };
    set((s) => ({ toasts: [...s.toasts, next].slice(-MAX_VISIBLE) }));
    if (durationMs > 0) setTimeout(() => get().dismiss(id), durationMs);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export const showToast = (
  message: string,
  options: { kind?: Toast['kind']; action?: Toast['action'] } = {},
): number => toastStore.getState().show({ message, ...options });

export function useToasts(): Toast[] {
  return useStore(toastStore, (s) => s.toasts);
}
