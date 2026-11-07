import type { Doc } from '@core/types';

/**
 * Undo history as a stack of earlier documents. Because core edits replace only the nodes they
 * touch (structural sharing), a snapshot costs a few object references, not a copy (docs/03 §4).
 */
export interface HistoryEntry {
  /** The document as it was *before* the change this entry describes. */
  doc: Doc;
  label: string;
  /** Rapid edits with the same key (drag, nudge, typing) merge into one entry. */
  key?: string;
  /** Time of the latest change merged into this entry. */
  at: number;
}

export interface History {
  past: readonly HistoryEntry[];
  future: readonly HistoryEntry[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };
export const COALESCE_WINDOW_MS = 300;
export const MAX_HISTORY = 200;

export interface RecordOptions {
  key?: string;
  now: number;
  windowMs?: number;
  max?: number;
}

/** Records that `before` was replaced by something newer. Clears the redo stack. */
export function record(
  history: History,
  before: Doc,
  label: string,
  options: RecordOptions,
): History {
  const { key, now, windowMs = COALESCE_WINDOW_MS, max = MAX_HISTORY } = options;
  const last = history.past.at(-1);
  if (key !== undefined && last?.key === key && now - last.at <= windowMs) {
    // Same gesture, still going: keep the original "before" and just extend the window.
    return { past: [...history.past.slice(0, -1), { ...last, at: now }], future: [] };
  }
  const entry: HistoryEntry =
    key === undefined ? { doc: before, label, at: now } : { doc: before, label, key, at: now };
  const past = [...history.past, entry];
  return { past: past.length > max ? past.slice(past.length - max) : past, future: [] };
}

export interface Step {
  history: History;
  /** The document to show now. */
  doc: Doc;
  label: string;
}

/** Steps back. `current` goes onto the redo stack. Null when there is nothing to undo. */
export function undo(history: History, current: Doc): Step | null {
  const entry = history.past.at(-1);
  if (!entry) return null;
  return {
    doc: entry.doc,
    label: entry.label,
    history: {
      past: history.past.slice(0, -1),
      // Never coalesce across an undo: the redo entry is a boundary of its own.
      future: [...history.future, { doc: current, label: entry.label, at: 0 }],
    },
  };
}

export function redo(history: History, current: Doc): Step | null {
  const entry = history.future.at(-1);
  if (!entry) return null;
  return {
    doc: entry.doc,
    label: entry.label,
    history: {
      past: [...history.past, { doc: current, label: entry.label, at: 0 }],
      future: history.future.slice(0, -1),
    },
  };
}
