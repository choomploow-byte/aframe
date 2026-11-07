import { createEmptyDoc } from '@core/doc';
import type { Doc } from '@core/types';
import { describe, expect, it } from 'vitest';
import { COALESCE_WINDOW_MS, EMPTY_HISTORY, MAX_HISTORY, record, redo, undo } from './history';

const docN = (n: number): Doc => ({ ...createEmptyDoc({ id: 'p_hist1', now: 't' }), rev: n });

describe('history', () => {
  it('records entries and clears the redo stack', () => {
    let h = record(EMPTY_HISTORY, docN(1), 'A', { now: 0 });
    h = record(h, docN(2), 'B', { now: 1000 });
    expect(h.past.map((e) => e.label)).toEqual(['A', 'B']);
    const undone = undo(h, docN(3));
    expect(undone?.history.future).toHaveLength(1);
    const after = record(undone!.history, docN(2), 'C', { now: 2000 });
    expect(after.future).toEqual([]);
  });

  it('undo returns the earlier doc and queues the current one for redo; redo reverses it', () => {
    const h = record(EMPTY_HISTORY, docN(1), 'Move', { now: 0 });
    const u = undo(h, docN(2));
    expect(u?.doc.rev).toBe(1);
    expect(u?.label).toBe('Move');
    expect(u?.history.past).toEqual([]);
    const r = redo(u!.history, u!.doc);
    expect(r?.doc.rev).toBe(2);
    expect(r?.history.future).toEqual([]);
    expect(r?.history.past).toHaveLength(1);
  });

  it('reports nothing to undo or redo on empty stacks', () => {
    expect(undo(EMPTY_HISTORY, docN(1))).toBeNull();
    expect(redo(EMPTY_HISTORY, docN(1))).toBeNull();
  });

  it('coalesces rapid edits that share a key, keeping the first "before"', () => {
    let h = record(EMPTY_HISTORY, docN(1), 'Move', { key: 'drag', now: 0 });
    h = record(h, docN(2), 'Move', { key: 'drag', now: 100 });
    h = record(h, docN(3), 'Move', { key: 'drag', now: 250 });
    expect(h.past).toHaveLength(1);
    expect(h.past[0]?.doc.rev).toBe(1);
    expect(h.past[0]?.at).toBe(250);
  });

  it('starts a new entry after the window, for a different key, or without a key', () => {
    let h = record(EMPTY_HISTORY, docN(1), 'Nudge', { key: 'nudge', now: 0 });
    h = record(h, docN(2), 'Nudge', { key: 'nudge', now: COALESCE_WINDOW_MS + 1 });
    expect(h.past).toHaveLength(2);
    h = record(h, docN(3), 'Move', { key: 'drag', now: COALESCE_WINDOW_MS + 2 });
    expect(h.past).toHaveLength(3);
    h = record(h, docN(4), 'Edit', { now: COALESCE_WINDOW_MS + 3 });
    h = record(h, docN(5), 'Edit', { now: COALESCE_WINDOW_MS + 4 });
    expect(h.past).toHaveLength(5);
  });

  it('keeps extending a long gesture as long as each step is within the window', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < 50; i += 1) {
      h = record(h, docN(i), 'Drag', { key: 'drag', now: i * 100 });
    }
    expect(h.past).toHaveLength(1);
    expect(h.past[0]?.doc.rev).toBe(0);
  });

  it('does not coalesce into a boundary created by undo/redo', () => {
    let h = record(EMPTY_HISTORY, docN(1), 'Nudge', { key: 'nudge', now: 0 });
    const u = undo(h, docN(2))!;
    const r = redo(u.history, u.doc)!;
    h = record(r.history, docN(2), 'Nudge', { key: 'nudge', now: 10 });
    expect(h.past).toHaveLength(2);
  });

  it('caps the stack, dropping the oldest entries', () => {
    let h = EMPTY_HISTORY;
    for (let i = 0; i < MAX_HISTORY + 25; i += 1) {
      h = record(h, docN(i), `E${i}`, { now: i * 1000 });
    }
    expect(h.past).toHaveLength(MAX_HISTORY);
    expect(h.past[0]?.label).toBe('E25');
    expect(record(EMPTY_HISTORY, docN(1), 'a', { now: 0 }).past).toHaveLength(1);
    const small = record(record(EMPTY_HISTORY, docN(1), 'a', { now: 0, max: 1 }), docN(2), 'b', {
      now: 1000,
      max: 1,
    });
    expect(small.past.map((e) => e.label)).toEqual(['b']);
  });
});
