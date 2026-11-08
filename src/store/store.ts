import { applyChanges } from '@core/apply';
import { bumpRev, createEmptyDoc } from '@core/doc';
import { toOpError } from '@core/errors';
import type { ApplyOk, ApplyResult, Doc, NodeSpec, Op, OpError } from '@core/types';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { EMPTY_HISTORY, record, redo as redoStep, undo as undoStep, type History } from './history';

export type ToolId =
  'select' | 'frame' | 'rect' | 'ellipse' | 'text' | 'image' | 'annotate' | 'hand';

export interface Viewport {
  /** Screen position of the world origin, in px. */
  x: number;
  y: number;
  zoom: number;
}

/** A rectangle in screen space (px, relative to the canvas element). */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A snapping guide in world coordinates. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
}

/** Short-lived gesture feedback drawn by the overlay; never part of the document or history. */
export interface Transient {
  guides: readonly Guide[];
  marquee: ScreenRect | null;
  draw: { rect: ScreenRect; label: string } | null;
  /** Insertion indicator while reordering inside an auto-layout frame (screen rect, thin). */
  insertion: ScreenRect | null;
  /** Outline following the cursor while dragging an auto-layout child. */
  ghost: ScreenRect | null;
}

export const NO_TRANSIENT: Transient = {
  guides: [],
  marquee: null,
  draw: null,
  insertion: null,
  ghost: null,
};

export interface DispatchOptions {
  label?: string;
  /** Rapid dispatches with the same key merge into one undo step (drag, nudge). */
  key?: string;
  /** Selection after a successful dispatch; by default the current selection minus deleted nodes. */
  select?: (result: ApplyOk) => string[];
}

export type EditResult = { ok: true } | { ok: false; error: OpError };

export interface AFrameState {
  doc: Doc;
  selection: string[];
  tool: ToolId;
  viewport: Viewport;
  editingTextId: string | null;
  hover: string | null;
  history: History;
  /** While set, dispatches do not create history entries; `endTransaction` records one. */
  transaction: { before: Doc; label: string } | null;
  clipboard: NodeSpec[] | null;
  transient: Transient;
  /** Debug HUD (fps, node count), toggled with Ctrl+Alt+D. */
  hud: boolean;

  dispatch: (ops: readonly Op[], options?: DispatchOptions) => ApplyResult;
  /** Replaces the document with one produced elsewhere (an agent, a sync merge) as one undo step. */
  commitExternal: (next: Doc, label: string) => void;
  /**
   * Installs a document that already is the new truth (read from disk, or merged with it) exactly as
   * it is: no `rev` bump, no writer stamp, because it is not a local edit. One undo step, so the
   * user can step back over an agent's change (`history: false` for a bookkeeping change that is not
   * one, like restamping `rev`). Selection and viewport are kept.
   */
  adoptExternal: (next: Doc, label: string, options?: { history?: boolean }) => void;
  /**
   * Applies a pure document change that is not a node op (tokens, assets, project name) as one
   * undo step. `change` may throw a `CoreError`; the document is then left untouched.
   */
  edit: (change: (doc: Doc) => Doc, label: string, key?: string) => EditResult;
  /** Loads a document and forgets history (opening a project). */
  loadDoc: (doc: Doc) => void;
  undo: () => string | null;
  redo: () => string | null;
  beginTransaction: (label: string) => void;
  endTransaction: () => void;
  /** Ends a transaction and restores the document as it was when it began. */
  cancelTransaction: () => void;

  setSelection: (ids: readonly string[]) => void;
  toggleSelection: (id: string) => void;
  setTool: (tool: ToolId) => void;
  setViewport: (viewport: Viewport) => void;
  setEditingTextId: (id: string | null) => void;
  setHover: (id: string | null) => void;
  setClipboard: (specs: NodeSpec[] | null) => void;
  setTransient: (patch: Partial<Transient>) => void;
  clearTransient: () => void;
  toggleHud: () => void;
}

export interface StoreOptions {
  doc?: Doc;
  /** Milliseconds clock for history coalescing; injectable for tests. */
  now?: () => number;
  /** ISO timestamp for `meta.updatedAt`; injectable for tests. */
  isoNow?: () => string;
}

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

function existing(doc: Doc, ids: readonly string[]): string[] {
  return ids.filter((id) => doc.nodes[id] !== undefined && id !== doc.rootId);
}

/**
 * A document restored from history (undo, redo, a cancelled gesture) is still a *new revision* of
 * what is on disk: content comes from the snapshot, `rev` from the present, plus one. (Using the
 * snapshot's own rev would let it fall behind the current one, and the file's rev must only grow.)
 */
function restored(current: Doc, target: Doc, at: string): Doc {
  return bumpRev({ ...target, rev: current.rev }, 'app', at);
}

export function createAFrameStore(options: StoreOptions = {}): StoreApi<AFrameState> {
  const now = options.now ?? ((): number => Date.now());
  const isoNow = options.isoNow ?? ((): string => new Date().toISOString());

  return createStore<AFrameState>()((set, get) => {
    /** Installs `next` as the document, recording history unless a transaction is open. */
    const install = (
      next: Doc,
      label: string,
      key: string | undefined,
      select?: string[],
    ): void => {
      const s = get();
      const stamped = bumpRev(next, 'app', isoNow());
      const history =
        s.transaction === null
          ? record(
              s.history,
              s.doc,
              label,
              key === undefined ? { now: now() } : { now: now(), key },
            )
          : s.history;
      set({ doc: stamped, history, selection: existing(stamped, select ?? s.selection) });
    };

    return {
      doc: options.doc ?? createEmptyDoc({ name: 'Untitled' }),
      selection: [],
      tool: 'select',
      viewport: DEFAULT_VIEWPORT,
      editingTextId: null,
      hover: null,
      history: EMPTY_HISTORY,
      transaction: null,
      clipboard: null,
      transient: NO_TRANSIENT,
      hud: false,

      dispatch: (ops, dispatchOptions = {}) => {
        const result = applyChanges(get().doc, ops);
        if (!result.ok || result.doc === get().doc) return result;
        install(
          result.doc,
          dispatchOptions.label ?? 'Edit',
          dispatchOptions.key,
          dispatchOptions.select?.(result),
        );
        return result;
      },

      commitExternal: (next, label) => {
        if (next === get().doc) return;
        install(next, label, undefined);
      },

      adoptExternal: (next, label, adoptOptions = {}) => {
        const s = get();
        if (next === s.doc) return;
        const history =
          s.transaction === null && adoptOptions.history !== false
            ? record(s.history, s.doc, label, { now: now() })
            : s.history;
        set({ doc: next, history, selection: existing(next, s.selection) });
      },

      edit: (change, label, key) => {
        try {
          const next = change(get().doc);
          if (next !== get().doc) install(next, label, key);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: toOpError(err) };
        }
      },

      loadDoc: (doc) =>
        set({
          doc,
          history: EMPTY_HISTORY,
          transaction: null,
          selection: [],
          editingTextId: null,
          hover: null,
          transient: NO_TRANSIENT,
        }),

      undo: () => {
        const s = get();
        const step = undoStep(s.history, s.doc);
        if (!step) return null;
        // A restored document is still a *new revision* (docs/06: rev only ever grows).
        const doc = restored(s.doc, step.doc, isoNow());
        set({
          doc,
          history: step.history,
          selection: existing(doc, s.selection),
          editingTextId: null,
          transaction: null,
        });
        return step.label;
      },

      redo: () => {
        const s = get();
        const step = redoStep(s.history, s.doc);
        if (!step) return null;
        const doc = restored(s.doc, step.doc, isoNow());
        set({
          doc,
          history: step.history,
          selection: existing(doc, s.selection),
          editingTextId: null,
          transaction: null,
        });
        return step.label;
      },

      beginTransaction: (label) => {
        const s = get();
        if (s.transaction === null) set({ transaction: { before: s.doc, label } });
      },

      endTransaction: () => {
        const s = get();
        const tx = s.transaction;
        if (tx === null) return;
        const changed = s.doc !== tx.before;
        set({
          transaction: null,
          history: changed ? record(s.history, tx.before, tx.label, { now: now() }) : s.history,
        });
      },

      cancelTransaction: () => {
        const s = get();
        const tx = s.transaction;
        if (tx === null) return;
        const doc = s.doc === tx.before ? s.doc : restored(s.doc, tx.before, isoNow());
        set({ doc, transaction: null, selection: existing(doc, s.selection), editingTextId: null });
      },

      setSelection: (ids) => set((s) => ({ selection: existing(s.doc, [...new Set(ids)]) })),
      toggleSelection: (id) =>
        set((s) => ({
          selection: s.selection.includes(id)
            ? s.selection.filter((x) => x !== id)
            : existing(s.doc, [...s.selection, id]),
        })),
      setTool: (tool) => set({ tool }),
      setViewport: (viewport) => set({ viewport }),
      setEditingTextId: (id) => set({ editingTextId: id }),
      setHover: (id) => set((s) => (s.hover === id ? s : { hover: id })),
      setClipboard: (specs) => set({ clipboard: specs }),
      setTransient: (patch) => set((s) => ({ transient: { ...s.transient, ...patch } })),
      clearTransient: () => set({ transient: NO_TRANSIENT }),
      toggleHud: () => set((s) => ({ hud: !s.hud })),
    };
  });
}

/** The app's store. Tests build their own with `createAFrameStore`. */
export const store = createAFrameStore();

export function useAFrame<T>(selector: (state: AFrameState) => T): T {
  return useStore(store, selector);
}
