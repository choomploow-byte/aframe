import { describe, expect, it, vi } from 'vitest';
import { showToast, toastStore } from './toast';

describe('toasts', () => {
  it('keeps at most three, newest last, and clear() drops them all', () => {
    toastStore.getState().clear();
    for (const n of [1, 2, 3, 4]) showToast(`m${n}`, { kind: 'info' });
    expect(toastStore.getState().toasts.map((t) => t.message)).toEqual(['m2', 'm3', 'm4']);
    toastStore.getState().clear();
    expect(toastStore.getState().toasts).toEqual([]);
  });

  it('dismisses itself after its duration', () => {
    vi.useFakeTimers();
    toastStore.getState().clear();
    showToast('soon gone');
    expect(toastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4600);
    expect(toastStore.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it('errors stay longer than info toasts', () => {
    vi.useFakeTimers();
    toastStore.getState().clear();
    showToast('bad', { kind: 'error' });
    vi.advanceTimersByTime(4600);
    expect(toastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    expect(toastStore.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });
});
