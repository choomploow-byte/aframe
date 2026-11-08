import { inferAutoLayout, type LayoutRect } from '@core/autolayout';
import { extractSpecs, topmostIds } from '@core/clipboard';
import { isEffectivelyLocked } from '@core/tree';
import type { Doc, Node, NodeSpec, Op } from '@core/types';
import type { StoreApi } from 'zustand/vanilla';
import { round2, unionRects, type Point, type Rect } from '../canvas/geometry';
import type { AFrameState } from './store';

/**
 * Editing commands: everything a shortcut, menu or toolbar can do to the document. Each one
 * builds core ops and dispatches them as ONE undoable step. They know nothing about the DOM:
 * anything that needs real layout (hug/fill sizes) asks the injected `measure`.
 */
export type Store = StoreApi<AFrameState>;

/** World-space rect of a rendered node (the page maps to the origin), or null if not rendered. */
export type MeasureFn = (id: string) => Rect | null;

export interface Env {
  store: Store;
  measure: MeasureFn;
}

const DUPLICATE_OFFSET = 16;
const ARTBOARD_GAP = 40;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isFlexFrame(node: Node | undefined): boolean {
  return node?.type === 'frame' && (node.layout === 'row' || node.layout === 'column');
}

function isContainer(node: Node | undefined): node is Node {
  return node !== undefined && (node.type === 'frame' || node.type === 'page');
}

/** Selected nodes, minus descendants of other selected nodes and minus locked ones. */
function editableTops(doc: Doc, ids: readonly string[]): string[] {
  return topmostIds(doc.nodes, ids).filter(
    (id) => doc.nodes[id] !== undefined && id !== doc.rootId && !isEffectivelyLocked(doc.nodes, id),
  );
}

function state(store: Store): AFrameState {
  return store.getState();
}

/** Ids among `created` whose parent is not itself newly created: the roots of copies/pastes. */
export function rootsOf(doc: Doc, created: readonly string[]): string[] {
  const set = new Set(created);
  return created.filter((id) => {
    const parent = doc.nodes[id]?.parentId;
    return parent === null || parent === undefined || !set.has(parent);
  });
}

/** Size a node occupies, preferring what is rendered, falling back to the stored numbers. */
function sizeOf(node: Node, measure: MeasureFn): { w: number; h: number } {
  const m = measure(node.id);
  if (m) return { w: m.w, h: m.h };
  return { w: typeof node.w === 'number' ? node.w : 0, h: typeof node.h === 'number' ? node.h : 0 };
}

// ---------------------------------------------------------------------------
// Delete / duplicate / clipboard
// ---------------------------------------------------------------------------

export function deleteSelection(store: Store): boolean {
  const s = state(store);
  const ids = editableTops(s.doc, s.selection);
  if (ids.length === 0) return false;
  const res = s.dispatch(
    ids.map((id): Op => ({ op: 'delete', id })),
    { label: ids.length === 1 ? 'Delete' : `Delete ${ids.length} layers` },
  );
  return res.ok;
}

export function duplicateSelection(env: Env): boolean {
  const { store, measure } = env;
  const s = state(store);
  const ids = topmostIds(s.doc.nodes, s.selection).filter(
    (id) => id !== s.doc.rootId && s.doc.nodes[id],
  );
  if (ids.length === 0) return false;
  const ops = ids.map((id): Op => {
    const node = s.doc.nodes[id] as Node;
    const parent = node.parentId ? s.doc.nodes[node.parentId] : undefined;
    if (isFlexFrame(parent)) return { op: 'duplicate', id };
    if (parent?.type === 'page') {
      // Artboards go to the right of the original rather than on top of it.
      return { op: 'duplicate', id, offset: { x: sizeOf(node, measure).w + ARTBOARD_GAP, y: 0 } };
    }
    return { op: 'duplicate', id, offset: { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET } };
  });
  const res = s.dispatch(ops, {
    label: 'Duplicate',
    select: (r) => rootsOf(r.doc, r.created),
  });
  return res.ok;
}

export function copySelection(store: Store): NodeSpec[] | null {
  const s = state(store);
  const ids = s.selection.filter((id) => s.doc.nodes[id] && id !== s.doc.rootId);
  if (ids.length === 0) return null;
  const specs = extractSpecs(s.doc, ids);
  s.setClipboard(specs);
  return specs;
}

export function cutSelection(store: Store): NodeSpec[] | null {
  const specs = copySelection(store);
  if (specs) deleteSelection(store);
  return specs;
}

/** Where pasted nodes go: into a selected frame, next to a selected leaf, else onto the page. */
function pasteParent(doc: Doc, selection: readonly string[]): Node {
  const first = selection[0] ? doc.nodes[selection[0]] : undefined;
  if (first && isContainer(first) && first.type === 'frame') return first;
  const parent = first?.parentId ? doc.nodes[first.parentId] : undefined;
  return parent ?? (doc.nodes[doc.rootId] as Node);
}

/**
 * Pastes `specs` (default: the store's clipboard). With `at` (a world point) the group's top-left
 * lands there; otherwise it is nudged down-right so it does not hide the original.
 */
export function pasteClipboard(
  env: Env,
  options: { specs?: NodeSpec[]; at?: Point } = {},
): boolean {
  const { store, measure } = env;
  const s = state(store);
  const specs = options.specs ?? s.clipboard;
  if (!specs || specs.length === 0) return false;

  const parent = pasteParent(s.doc, s.selection);
  const flex = isFlexFrame(parent);
  let shift = { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET };
  if (options.at && !flex) {
    const origin = parent.type === 'page' ? { x: 0, y: 0 } : (measure(parent.id) ?? { x: 0, y: 0 });
    const tl = unionRects(specs.map((sp) => ({ x: sp.x ?? 0, y: sp.y ?? 0, w: 1, h: 1 })));
    shift = {
      x: options.at.x - origin.x - (tl?.x ?? 0),
      y: options.at.y - origin.y - (tl?.y ?? 0),
    };
  }

  const ops = specs.map((spec, i): Op => {
    const node: NodeSpec = { ...spec, tempId: `paste${i}` };
    if (!flex) {
      node.x = round2((spec.x ?? 0) + shift.x);
      node.y = round2((spec.y ?? 0) + shift.y);
    }
    return { op: 'create', parentId: parent.id, node };
  });
  const res = s.dispatch(ops, {
    label: 'Paste',
    select: (r) => specs.map((_, i) => r.idMap[`paste${i}`] as string),
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------

export type ReorderMode = 'forward' | 'backward' | 'front' | 'back';

export function reorderSelection(store: Store, mode: ReorderMode): boolean {
  const s = state(store);
  const ids = editableTops(s.doc, s.selection);
  if (ids.length === 0) return false;

  // Simulate on copies of the children arrays so each op's index is valid at the moment it runs.
  const sim = new Map<string, string[]>();
  const childrenOf = (parentId: string): string[] => {
    let list = sim.get(parentId);
    if (!list) {
      list = [...(s.doc.nodes[parentId]?.children ?? [])];
      sim.set(parentId, list);
    }
    return list;
  };
  const ops: Op[] = [];
  const indexIn = (id: string): number => {
    const parentId = s.doc.nodes[id]?.parentId ?? '';
    return childrenOf(parentId).indexOf(id);
  };
  // Process so that relative order within the selection survives.
  const ordered = [...ids].sort((a, b) =>
    mode === 'forward' || mode === 'back' ? indexIn(b) - indexIn(a) : indexIn(a) - indexIn(b),
  );
  for (const id of ordered) {
    const parentId = s.doc.nodes[id]?.parentId;
    if (!parentId) continue;
    const list = childrenOf(parentId);
    const from = list.indexOf(id);
    const last = list.length - 1;
    const to =
      mode === 'forward'
        ? Math.min(from + 1, last)
        : mode === 'backward'
          ? Math.max(from - 1, 0)
          : mode === 'front'
            ? last
            : 0;
    if (to === from) continue;
    list.splice(from, 1);
    list.splice(to, 0, id);
    ops.push({ op: 'move', id, parentId, index: to });
  }
  if (ops.length === 0) return false;
  const label = {
    forward: 'Bring forward',
    backward: 'Send backward',
    front: 'Bring to front',
    back: 'Send to back',
  }[mode];
  return s.dispatch(ops, { label }).ok;
}

// ---------------------------------------------------------------------------
// Structure: wrap in frame, add auto-layout
// ---------------------------------------------------------------------------

/** Wraps the selection in a new frame (Ctrl+G). Needs every selected node to share one parent. */
export function wrapSelectionInFrame(env: Env): boolean {
  const { store, measure } = env;
  const s = state(store);
  const ids = editableTops(s.doc, s.selection);
  if (ids.length === 0) return false;
  const parentId = s.doc.nodes[ids[0] as string]?.parentId;
  if (!parentId || ids.some((id) => s.doc.nodes[id]?.parentId !== parentId)) return false;
  const parent = s.doc.nodes[parentId] as Node;
  const siblings = parent.children;
  const sorted = [...ids].sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b));
  const indexes = sorted.map((id) => siblings.indexOf(id));

  const ops: Op[] = [];
  if (isFlexFrame(parent)) {
    ops.push({
      op: 'create',
      parentId,
      index: Math.min(...indexes),
      node: {
        type: 'frame',
        tempId: 'wrap',
        name: 'Frame',
        w: 'hug',
        h: 'hug',
        layout: parent.layout === 'row' ? 'row' : 'column',
        gap: sorted.length > 1 ? (parent.gap ?? 0) : 0,
      },
    });
    for (const id of sorted) ops.push({ op: 'move', id, parentId: '$wrap' });
  } else {
    const rects: Rect[] = sorted.map((id) => {
      const n = s.doc.nodes[id] as Node;
      const { w, h } = sizeOf(n, measure);
      return { x: n.x, y: n.y, w, h };
    });
    const box = unionRects(rects) as Rect;
    ops.push({
      op: 'create',
      parentId,
      index: Math.max(...indexes),
      node: {
        type: 'frame',
        tempId: 'wrap',
        name: 'Frame',
        x: round2(box.x),
        y: round2(box.y),
        w: Math.max(1, round2(box.w)),
        h: Math.max(1, round2(box.h)),
        layout: 'none',
      },
    });
    for (const id of sorted) {
      const n = s.doc.nodes[id] as Node;
      ops.push({ op: 'move', id, parentId: '$wrap' });
      ops.push({ op: 'update', id, set: { x: round2(n.x - box.x), y: round2(n.y - box.y) } });
    }
  }
  return s.dispatch(ops, { label: 'Wrap in frame', select: (r) => [r.idMap.wrap as string] }).ok;
}

/** Plan + apply auto-layout to a frame that currently positions its children freely. */
function applyAutoLayoutToFrame(env: Env, frameId: string): boolean {
  const { store, measure } = env;
  const s = state(store);
  const frame = s.doc.nodes[frameId];
  if (!frame || frame.type !== 'frame' || isFlexFrame(frame)) return false;

  const size = sizeOf(frame, measure);
  const rects: LayoutRect[] = frame.children.map((id) => {
    const n = s.doc.nodes[id] as Node;
    const { w, h } = sizeOf(n, measure);
    return { id, x: n.x, y: n.y, w, h };
  });
  const plan = inferAutoLayout(size, rects);

  const ops: Op[] = [
    {
      op: 'update',
      id: frameId,
      set: {
        layout: plan.layout,
        gap: plan.gap,
        padding: plan.padding,
        align: plan.align,
        justify: 'start',
      },
    },
  ];
  plan.order.forEach((id, index) => {
    if (frame.children[index] !== id) ops.push({ op: 'move', id, parentId: frameId, index });
  });
  return s.dispatch(ops, { label: 'Add auto layout' }).ok;
}

/** Ctrl+Alt+A: auto-layout on the selected frame, or wrap the selection in one first. One undo step. */
export function addAutoLayout(env: Env): boolean {
  const { store } = env;
  const s = state(store);
  const only = s.selection.length === 1 ? s.doc.nodes[s.selection[0] as string] : undefined;
  if (only?.type === 'frame') {
    if (isFlexFrame(only)) return false;
    return applyAutoLayoutToFrame(env, only.id);
  }
  if (s.selection.length === 0) return false;

  s.beginTransaction('Add auto layout');
  try {
    if (!wrapSelectionInFrame(env)) return false;
    const frameId = state(store).selection[0];
    if (!frameId) return false;
    const wrapped = state(store).doc.nodes[frameId];
    // Wrapping inside a flex parent already yields a flex frame; nothing more to infer.
    return isFlexFrame(wrapped) ? true : applyAutoLayoutToFrame(env, frameId);
  } finally {
    s.endTransaction();
  }
}

// ---------------------------------------------------------------------------
// Nudge and keyboard navigation
// ---------------------------------------------------------------------------

/** Arrow keys: moves free-positioned, unlocked nodes. Auto-layout children are not nudged. */
export function nudgeSelection(store: Store, dx: number, dy: number): boolean {
  const s = state(store);
  const ops: Op[] = [];
  for (const id of editableTops(s.doc, s.selection)) {
    const n = s.doc.nodes[id] as Node;
    const parent = n.parentId ? s.doc.nodes[n.parentId] : undefined;
    if (isFlexFrame(parent)) continue;
    ops.push({ op: 'update', id, set: { x: round2(n.x + dx), y: round2(n.y + dy) } });
  }
  if (ops.length === 0) return false;
  return s.dispatch(ops, { label: 'Nudge', key: 'nudge' }).ok;
}

/** Tab / Shift+Tab: the next or previous sibling (wrapping); with no selection, the first artboard. */
export function selectSibling(store: Store, dir: 1 | -1): string | null {
  const s = state(store);
  const current = s.selection[0] ? s.doc.nodes[s.selection[0]] : undefined;
  const parent = current?.parentId ? s.doc.nodes[current.parentId] : s.doc.nodes[s.doc.rootId];
  const list = (parent?.children ?? []).filter((id) => s.doc.nodes[id]?.visible !== false);
  if (list.length === 0) return null;
  const at = current ? list.indexOf(current.id) : -1;
  const next = list[(at + dir + list.length) % list.length];
  if (next === undefined) return null;
  s.setSelection([next]);
  return next;
}

/** Esc: step up to the parent; at artboard level, clear the selection. */
export function selectParent(store: Store): void {
  const s = state(store);
  const current = s.selection[0] ? s.doc.nodes[s.selection[0]] : undefined;
  const parent = current?.parentId ? s.doc.nodes[current.parentId] : undefined;
  s.setSelection(parent && parent.type !== 'page' ? [parent.id] : []);
}

/** Enter: into the first child of a frame, or start editing a text node. */
export function enterSelection(store: Store): 'edit' | 'child' | null {
  const s = state(store);
  const current = s.selection[0] ? s.doc.nodes[s.selection[0]] : undefined;
  if (!current) return null;
  if (current.type === 'text') {
    s.setEditingTextId(current.id);
    return 'edit';
  }
  const first = current.children[0];
  if (first) {
    s.setSelection([first]);
    return 'child';
  }
  return null;
}

/** Ctrl+A: every sibling of the selection, or every artboard. */
export function selectAll(store: Store): void {
  const s = state(store);
  const current = s.selection[0] ? s.doc.nodes[s.selection[0]] : undefined;
  const parent = current?.parentId ? s.doc.nodes[current.parentId] : s.doc.nodes[s.doc.rootId];
  s.setSelection((parent?.children ?? []).filter((id) => s.doc.nodes[id]?.visible !== false));
}

// ---------------------------------------------------------------------------
// Creating nodes with the draw tools
// ---------------------------------------------------------------------------

export type DrawKind = 'frame' | 'rect' | 'ellipse' | 'text';

const COLOR_FALLBACK: Record<string, string> = {
  surface2: '#FFFFFF',
  border: '#E8E6DC',
  text: '#1F1E1D',
};

/** `$name` when the document defines that colour token, else a literal, so new nodes never warn. */
function colour(doc: Doc, token: string): string {
  return doc.tokens.colors[token] !== undefined
    ? `$${token}`
    : (COLOR_FALLBACK[token] ?? '#000000');
}

/** Click without dragging creates these sizes. */
export const DEFAULT_DRAW_SIZE: Record<DrawKind, { w: number; h: number }> = {
  frame: { w: 390, h: 844 },
  rect: { w: 100, h: 100 },
  ellipse: { w: 100, h: 100 },
  text: { w: 0, h: 0 },
};

/** Node spec for a drawn shape: sensible defaults that use the document's tokens. */
export function drawSpec(doc: Doc, kind: DrawKind, rect: Rect, inFlow: boolean): NodeSpec {
  const place = inFlow ? {} : { x: round2(rect.x), y: round2(rect.y) };
  switch (kind) {
    case 'frame':
      return {
        type: 'frame',
        name: 'Frame',
        ...place,
        w: Math.max(1, round2(rect.w)),
        h: Math.max(1, round2(rect.h)),
        layout: 'none',
        fill: colour(doc, 'surface2'),
        tempId: 'draw',
      };
    case 'rect':
    case 'ellipse':
      return {
        type: kind,
        name: kind === 'rect' ? 'Rectangle' : 'Ellipse',
        ...place,
        w: Math.max(1, round2(rect.w)),
        h: Math.max(1, round2(rect.h)),
        fill: colour(doc, 'border'),
        tempId: 'draw',
      };
    case 'text':
      return {
        type: 'text',
        ...place,
        text: '',
        color: colour(doc, 'text'),
        ...(doc.tokens.fonts.body !== undefined ? { fontFamily: '$font.body' } : {}),
        tempId: 'draw',
      };
  }
}

/** A device-sized artboard centred on `center` (a world point). */
export function addArtboard(
  store: Store,
  preset: { label: string; w: number; h: number },
  center: Point,
): boolean {
  const s = state(store);
  const spec: NodeSpec = {
    type: 'frame',
    name: preset.label,
    x: round2(center.x - preset.w / 2),
    y: round2(center.y - preset.h / 2),
    w: preset.w,
    h: preset.h,
    layout: 'none',
    fill: colour(s.doc, 'surface2'),
    tempId: 'artboard',
  };
  return s.dispatch([{ op: 'create', parentId: s.doc.rootId, node: spec }], {
    label: `Add ${preset.label} frame`,
    select: (r) => [r.idMap.artboard as string],
  }).ok;
}
