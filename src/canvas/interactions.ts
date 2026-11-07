import { isEffectivelyLocked } from '@core/tree';
import { topmostIds } from '@core/clipboard';
import type { Node, Op } from '@core/types';
import { DEFAULT_DRAW_SIZE, drawSpec, rootsOf, type DrawKind, type Store } from '../store/commands';
import { beginTextEdit } from '../store/text-edit';
import {
  bottom,
  intersects,
  rectFromPoints,
  right,
  round2,
  translate,
  unionRects,
  type Point,
  type Rect,
} from './geometry';
import type { Measurer } from './measure';
import { chainTo, enterTarget, pickTarget } from './pick';
import { snapMove } from './snapping';
import { panBy, screenToWorld, wheelZoomFactor, zoomAt } from './viewport';

/**
 * The pointer state machine for the canvas: pan, select/marquee, move, reorder (auto-layout),
 * resize and the draw tools. It speaks to the document only through store actions, so every
 * gesture is one undo step, and it reads geometry only through the measurer.
 */

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type Handle = (typeof HANDLES)[number];

const DRAG_THRESHOLD = 3; // px
const SNAP_PX = 6;
const DRAW_KINDS: ReadonlySet<string> = new Set(['frame', 'rect', 'ellipse', 'text']);

type Gesture =
  | { kind: 'pan'; origin: Point; viewport: { x: number; y: number; zoom: number } }
  | {
      kind: 'marquee';
      origin: Point;
      shift: boolean;
      base: string[];
      /** Parent whose children are candidates; null = artboards. */
      scope: string | null;
      /** Selected on release if the pointer never moved (clicking an artboard's background). */
      clickSelect: string | null;
    }
  | {
      kind: 'draw';
      draw: DrawKind;
      origin: Point;
      parentId: string;
      inFlow: boolean;
      started: boolean;
    }
  | {
      kind: 'move';
      origin: Point;
      ids: string[];
      start: Map<string, Point>;
      groupWorld: Rect | null;
      targets: Rect[];
      started: boolean;
      alt: boolean;
      /** Release without dragging narrows a multi-selection to this node. */
      narrowTo: string | null;
    }
  | {
      kind: 'reorder';
      origin: Point;
      id: string;
      parentId: string;
      axis: 'row' | 'column';
      fromIndex: number;
      toIndex: number;
      started: boolean;
      startScreen: Rect;
      others: { id: string; rect: Rect }[];
    }
  | {
      kind: 'resize';
      origin: Point;
      handle: Handle;
      id: string;
      flex: boolean;
      startWorld: Rect;
      startModel: Point;
      started: boolean;
    };

interface Deps {
  container: HTMLElement;
  store: Store;
  measurer: Measurer;
}

function isFlexFrame(n: Node | undefined): boolean {
  return n?.type === 'frame' && (n.layout === 'row' || n.layout === 'column');
}

export function attachInteractions(deps: Deps): {
  detach: () => void;
  cancelGesture: () => boolean;
} {
  const { container, store, measurer } = deps;
  let gesture: Gesture | null = null;
  let spaceDown = false;
  let raf = 0;
  let last: { p: Point; shift: boolean; alt: boolean; ctrl: boolean } | null = null;

  const state = () => store.getState();
  const rectOfContainer = (): DOMRect => container.getBoundingClientRect();
  const point = (e: { clientX: number; clientY: number }): Point => {
    const r = rectOfContainer();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: Point): Point => screenToWorld(state().viewport, p);
  const setCursor = (): void => {
    const s = state();
    let cursor = 'default';
    if (gesture?.kind === 'pan' || spaceDown || s.tool === 'hand')
      cursor = gesture?.kind === 'pan' ? 'grabbing' : 'grab';
    else if (DRAW_KINDS.has(s.tool)) cursor = s.tool === 'text' ? 'text' : 'crosshair';
    container.dataset.cursor = cursor;
  };

  const editableIds = (): string[] => {
    const s = state();
    return topmostIds(s.doc.nodes, s.selection).filter(
      (id) => s.doc.nodes[id] && id !== s.doc.rootId && !isEffectivelyLocked(s.doc.nodes, id),
    );
  };

  // -------------------------------------------------------------------------
  // Hit testing
  // -------------------------------------------------------------------------

  const chainAt = (target: EventTarget | null): string[] => {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-node-id]');
    const id = el?.dataset.nodeId;
    return id ? chainTo(state().doc.nodes, id) : [];
  };

  /** The frame (or page) a new node should be created in, given where the pointer is. */
  const containerForDraw = (chain: readonly string[]): string => {
    const { doc } = state();
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const id = chain[i] as string;
      if (doc.nodes[id]?.type === 'frame') return id;
    }
    return doc.rootId;
  };

  // -------------------------------------------------------------------------
  // Gesture starts
  // -------------------------------------------------------------------------

  const startMove = (origin: Point, narrowTo: string | null, alt: boolean): void => {
    const s = state();
    const ids = editableIds().filter(
      (id) => !isFlexFrame(s.doc.nodes[s.doc.nodes[id]?.parentId ?? '']),
    );
    const flexIds = editableIds().filter((id) => !ids.includes(id));
    // A single auto-layout child is reordered rather than moved freely.
    if (ids.length === 0 && flexIds.length === 1) {
      const id = flexIds[0] as string;
      const node = s.doc.nodes[id] as Node;
      const parent = s.doc.nodes[node.parentId ?? ''] as Node;
      const startScreen = measurer.screenRect(id);
      if (!startScreen) return;
      const others = parent.children
        .filter((c) => c !== id && s.doc.nodes[c]?.visible !== false)
        .map((c) => ({ id: c, rect: measurer.screenRect(c) }))
        .filter((o): o is { id: string; rect: Rect } => o.rect !== null);
      gesture = {
        kind: 'reorder',
        origin,
        id,
        parentId: parent.id,
        axis: parent.layout === 'row' ? 'row' : 'column',
        fromIndex: parent.children.indexOf(id),
        toIndex: parent.children.indexOf(id),
        started: false,
        startScreen,
        others,
      };
      return;
    }
    if (ids.length === 0) return;
    const start = new Map(
      ids.map((id) => [id, { x: (s.doc.nodes[id] as Node).x, y: (s.doc.nodes[id] as Node).y }]),
    );
    const groupWorld = unionRects(
      ids.map((id) => measurer.worldRect(id)).filter((r): r is Rect => r !== null),
    );
    const first = s.doc.nodes[ids[0] as string] as Node;
    const parent = s.doc.nodes[first.parentId ?? ''];
    const targets: Rect[] = [];
    if (parent) {
      for (const sib of parent.children) {
        if (ids.includes(sib) || s.doc.nodes[sib]?.visible === false) continue;
        const r = measurer.worldRect(sib);
        if (r) targets.push(r);
      }
      if (parent.type !== 'page') {
        const pr = measurer.worldRect(parent.id);
        if (pr) targets.push(pr);
      }
    }
    gesture = {
      kind: 'move',
      origin,
      ids,
      start,
      groupWorld,
      targets,
      started: false,
      alt,
      narrowTo,
    };
  };

  const startResize = (handle: Handle, origin: Point): void => {
    const s = state();
    const id = s.selection[0];
    if (s.selection.length !== 1 || !id) return;
    const node = s.doc.nodes[id];
    if (!node || isEffectivelyLocked(s.doc.nodes, id)) return;
    const startWorld = measurer.worldRect(id);
    if (!startWorld) return;
    const flex = isFlexFrame(s.doc.nodes[node.parentId ?? '']);
    gesture = {
      kind: 'resize',
      origin,
      handle,
      id,
      flex,
      startWorld,
      startModel: { x: node.x, y: node.y },
      started: false,
    };
  };

  const startSelect = (e: PointerEvent, origin: Point): void => {
    const s = state();
    const chain = chainAt(e.target);
    if (chain.length === 0) {
      gesture = {
        kind: 'marquee',
        origin,
        shift: e.shiftKey,
        base: e.shiftKey ? [...s.selection] : [],
        scope: null,
        clickSelect: null,
      };
      if (!e.shiftKey) s.setSelection([]);
      return;
    }
    if (chain.length === 1) {
      const artboard = chain[0] as string;
      if (s.selection.includes(artboard) && !e.shiftKey) {
        startMove(origin, null, e.altKey);
        return;
      }
      // An unselected artboard's own background: click selects it, dragging marquee-selects its children.
      gesture = {
        kind: 'marquee',
        origin,
        shift: e.shiftKey,
        base: e.shiftKey ? [...s.selection] : [],
        scope: artboard,
        clickSelect: artboard,
      };
      return;
    }
    const picked = pickTarget({
      chain,
      selected: s.selection,
      nodes: s.doc.nodes,
      deep: e.ctrlKey || e.metaKey,
    });
    if (!picked) return;
    const wasSelected = s.selection.includes(picked);
    if (e.shiftKey) {
      s.toggleSelection(picked);
      if (!state().selection.includes(picked)) return;
    } else if (!wasSelected) {
      s.setSelection([picked]);
    }
    startMove(
      origin,
      !e.shiftKey && wasSelected && s.selection.length > 1 ? picked : null,
      e.altKey,
    );
  };

  const startDraw = (e: PointerEvent, origin: Point): void => {
    const s = state();
    const draw = s.tool as DrawKind;
    const parentId = containerForDraw(chainAt(e.target));
    const parent = s.doc.nodes[parentId];
    gesture = { kind: 'draw', draw, origin, parentId, inFlow: isFlexFrame(parent), started: false };
  };

  // -------------------------------------------------------------------------
  // Per-frame updates
  // -------------------------------------------------------------------------

  const updateMove = (
    g: Extract<Gesture, { kind: 'move' }>,
    p: Point,
    mods: { shift: boolean; ctrl: boolean },
  ): void => {
    const s = state();
    if (!g.started) {
      if (Math.hypot(p.x - g.origin.x, p.y - g.origin.y) < DRAG_THRESHOLD) return;
      g.started = true;
      s.beginTransaction('Move');
      if (g.alt) {
        const res = s.dispatch(
          g.ids.map((id): Op => ({ op: 'duplicate', id })),
          { select: (r) => rootsOf(r.doc, r.created) },
        );
        if (res.ok) {
          const copies = state().selection;
          if (copies.length === g.ids.length) {
            g.ids = copies;
            g.start = new Map(
              copies.map((id) => [
                id,
                { x: (state().doc.nodes[id] as Node).x, y: (state().doc.nodes[id] as Node).y },
              ]),
            );
          }
        }
      }
    }
    const zoom = s.viewport.zoom;
    let dx = (p.x - g.origin.x) / zoom;
    let dy = (p.y - g.origin.y) / zoom;
    if (mods.shift) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    let sx = 0;
    let sy = 0;
    let guides: ReturnType<typeof snapMove>['guides'] = [];
    if (!mods.ctrl && g.groupWorld) {
      const snap = snapMove(translate(g.groupWorld, dx, dy), g.targets, SNAP_PX / zoom);
      sx = snap.dx;
      sy = snap.dy;
      guides = snap.guides;
    }
    s.dispatch(
      g.ids.map((id): Op => {
        const st = g.start.get(id) as Point;
        return { op: 'update', id, set: { x: round2(st.x + dx + sx), y: round2(st.y + dy + sy) } };
      }),
      { label: 'Move' },
    );
    s.setTransient({ guides });
  };

  const updateReorder = (g: Extract<Gesture, { kind: 'reorder' }>, p: Point): void => {
    const s = state();
    if (!g.started) {
      if (Math.hypot(p.x - g.origin.x, p.y - g.origin.y) < DRAG_THRESHOLD) return;
      g.started = true;
    }
    const along = g.axis === 'row' ? p.x : p.y;
    const centre = (r: Rect): number => (g.axis === 'row' ? r.x + r.w / 2 : r.y + r.h / 2);
    g.toIndex = g.others.filter((o) => centre(o.rect) < along).length;

    let insertion: Rect;
    const at = g.others[g.toIndex];
    const prev = g.others[g.toIndex - 1];
    if (g.axis === 'row') {
      const ref = at ?? prev ?? { rect: g.startScreen };
      const x = at ? at.rect.x : prev ? right(prev.rect) : g.startScreen.x;
      insertion = { x: x - 1.5, y: ref.rect.y, w: 3, h: ref.rect.h };
    } else {
      const ref = at ?? prev ?? { rect: g.startScreen };
      const y = at ? at.rect.y : prev ? bottom(prev.rect) : g.startScreen.y;
      insertion = { x: ref.rect.x, y: y - 1.5, w: ref.rect.w, h: 3 };
    }
    s.setTransient({
      insertion,
      ghost: translate(g.startScreen, p.x - g.origin.x, p.y - g.origin.y),
    });
  };

  const updateResize = (
    g: Extract<Gesture, { kind: 'resize' }>,
    p: Point,
    mods: { shift: boolean; alt: boolean },
  ): void => {
    const s = state();
    if (!g.started) {
      if (Math.hypot(p.x - g.origin.x, p.y - g.origin.y) < 2) return;
      g.started = true;
      s.beginTransaction('Resize');
    }
    const zoom = s.viewport.zoom;
    const dx = (p.x - g.origin.x) / zoom;
    const dy = (p.y - g.origin.y) / zoom;
    const r0 = g.startWorld;
    const west = g.handle.includes('w');
    const east = g.handle.includes('e');
    const north = g.handle.includes('n');
    const south = g.handle.includes('s');

    let left = r0.x + (west ? dx : 0);
    let rightEdge = r0.x + r0.w + (east ? dx : 0);
    let top = r0.y + (north ? dy : 0);
    let bottomEdge = r0.y + r0.h + (south ? dy : 0);
    if (mods.alt) {
      // From the centre: the opposite edge moves the other way.
      if (west) rightEdge = r0.x + r0.w - dx;
      if (east) left = r0.x - dx;
      if (north) bottomEdge = r0.y + r0.h - dy;
      if (south) top = r0.y - dy;
    }
    const corner = (west || east) && (north || south);
    if (mods.shift && corner && r0.w > 0 && r0.h > 0) {
      const ratio = r0.w / r0.h;
      let w = rightEdge - left;
      let h = bottomEdge - top;
      if (Math.abs(w / r0.w - 1) > Math.abs(h / r0.h - 1)) h = w / ratio;
      else w = h * ratio;
      if (west) left = rightEdge - w;
      else rightEdge = left + w;
      if (north) top = bottomEdge - h;
      else bottomEdge = top + h;
    }
    // Never collapse: keep the edge opposite the handle fixed and stop at 1 world px.
    if (rightEdge - left < 1) {
      if (west) left = rightEdge - 1;
      else rightEdge = left + 1;
    }
    if (bottomEdge - top < 1) {
      if (north) top = bottomEdge - 1;
      else bottomEdge = top + 1;
    }

    const set: Record<string, number> = {};
    if (west || east) set.w = round2(rightEdge - left);
    if (north || south) set.h = round2(bottomEdge - top);
    if (!g.flex) {
      // x/y are relative to the parent, so apply how far the top-left corner moved.
      set.x = round2(g.startModel.x + (left - r0.x));
      set.y = round2(g.startModel.y + (top - r0.y));
    }
    s.dispatch([{ op: 'update', id: g.id, set }], { label: 'Resize' });
  };

  const updateDraw = (g: Extract<Gesture, { kind: 'draw' }>, p: Point): void => {
    if (!g.started) {
      if (Math.hypot(p.x - g.origin.x, p.y - g.origin.y) < DRAG_THRESHOLD) return;
      g.started = true;
    }
    const rect = rectFromPoints(g.origin, p);
    const zoom = state().viewport.zoom;
    state().setTransient({
      draw: { rect, label: `${Math.round(rect.w / zoom)} × ${Math.round(rect.h / zoom)}` },
    });
  };

  const updateMarquee = (g: Extract<Gesture, { kind: 'marquee' }>, p: Point): void => {
    if (
      Math.hypot(p.x - g.origin.x, p.y - g.origin.y) < DRAG_THRESHOLD &&
      state().transient.marquee === null
    )
      return;
    state().setTransient({ marquee: rectFromPoints(g.origin, p) });
  };

  const flush = (): void => {
    raf = 0;
    const g = gesture;
    const l = last;
    if (!g || !l) return;
    switch (g.kind) {
      case 'pan':
        state().setViewport(panBy(g.viewport, l.p.x - g.origin.x, l.p.y - g.origin.y));
        break;
      case 'move':
        updateMove(g, l.p, l);
        break;
      case 'reorder':
        updateReorder(g, l.p);
        break;
      case 'resize':
        updateResize(g, l.p, l);
        break;
      case 'draw':
        updateDraw(g, l.p);
        break;
      case 'marquee':
        updateMarquee(g, l.p);
        break;
    }
  };

  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(flush);
  };

  // -------------------------------------------------------------------------
  // Gesture ends
  // -------------------------------------------------------------------------

  const finishDraw = (g: Extract<Gesture, { kind: 'draw' }>, p: Point): void => {
    const s = state();
    const zoom = s.viewport.zoom;
    const parent = s.doc.nodes[g.parentId];
    if (!parent) return;
    const parentOrigin =
      parent.type === 'page' ? { x: 0, y: 0 } : (measurer.worldRect(g.parentId) ?? { x: 0, y: 0 });
    const a = toWorld(g.origin);
    const b = toWorld(p);
    let rect: Rect;
    if (g.started) {
      rect = rectFromPoints(a, b);
    } else {
      const size = DEFAULT_DRAW_SIZE[g.draw];
      rect = { x: a.x, y: a.y, w: size.w, h: size.h };
    }
    rect = { ...rect, x: rect.x - parentOrigin.x, y: rect.y - parentOrigin.y };
    if (g.started && (rect.w * zoom < 2 || rect.h * zoom < 2) && g.draw !== 'text') return;

    const spec = drawSpec(s.doc, g.draw, rect, g.inFlow);
    if (g.draw === 'text') {
      if (g.started && rect.w >= 8) spec.w = round2(rect.w);
      s.beginTransaction('Add text');
    } else {
      s.beginTransaction(`Add ${g.draw === 'rect' ? 'rectangle' : g.draw}`);
    }
    const res = s.dispatch([{ op: 'create', parentId: g.parentId, node: spec }], {
      select: (r) => [r.idMap.draw as string],
    });
    if (!res.ok) {
      s.cancelTransaction();
      return;
    }
    s.setTool('select');
    if (g.draw === 'text') {
      const [id] = state().selection;
      if (id) beginTextEdit(store, id);
    } else {
      s.endTransaction();
    }
  };

  const finishMarquee = (g: Extract<Gesture, { kind: 'marquee' }>): void => {
    const s = state();
    const box = s.transient.marquee;
    if (!box) {
      if (g.clickSelect) s.setSelection(g.shift ? [...g.base, g.clickSelect] : [g.clickSelect]);
      return;
    }
    const scopeIds =
      g.scope === null
        ? (s.doc.nodes[s.doc.rootId]?.children ?? [])
        : (s.doc.nodes[g.scope]?.children ?? []);
    const hit = scopeIds.filter((id) => {
      if (s.doc.nodes[id]?.visible === false) return false;
      const r = measurer.screenRect(id);
      return r !== null && intersects(r, box);
    });
    s.setSelection(g.shift ? [...new Set([...g.base, ...hit])] : hit);
  };

  const finishMove = (g: Extract<Gesture, { kind: 'move' }>): void => {
    const s = state();
    if (g.started) s.endTransaction();
    else if (g.narrowTo) s.setSelection([g.narrowTo]);
  };

  const finishReorder = (g: Extract<Gesture, { kind: 'reorder' }>): void => {
    const s = state();
    if (g.started && g.toIndex !== g.fromIndex) {
      s.dispatch([{ op: 'move', id: g.id, parentId: g.parentId, index: g.toIndex }], {
        label: 'Reorder',
      });
    }
  };

  const endGesture = (e?: PointerEvent): void => {
    const g = gesture;
    gesture = null;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (g && e) {
      const p = point(e);
      switch (g.kind) {
        case 'draw':
          finishDraw(g, p);
          break;
        case 'marquee':
          finishMarquee(g);
          break;
        case 'move':
          // Apply the last pointer position before closing, so a quick flick is not lost.
          if (g.started && last) updateMove(g, p, last);
          finishMove(g);
          break;
        case 'reorder':
          if (g.started) updateReorder(g, p);
          finishReorder(g);
          break;
        case 'resize':
          if (g.started) updateResize(g, p, { shift: e.shiftKey, alt: e.altKey });
          if (g.started) state().endTransaction();
          break;
        case 'pan':
          break;
      }
    }
    state().clearTransient();
    setCursor();
  };

  const cancelGesture = (): boolean => {
    const g = gesture;
    if (!g) return false;
    gesture = null;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    const s = state();
    if ((g.kind === 'move' || g.kind === 'resize') && g.started) s.cancelTransaction();
    s.clearTransient();
    setCursor();
    return true;
  };

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest('[contenteditable="plaintext-only"], [data-ui]')) return;
    // Clicking the canvas gives it keyboard focus (even where a gesture cancels the default), so Tab
    // and the arrow keys act on the canvas from here, and leave it again when focus moves elsewhere.
    container.focus({ preventScroll: true });
    const s = state();
    const p = point(e);
    container.setPointerCapture(e.pointerId);
    last = { p, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };

    if (e.button === 1 || spaceDown || s.tool === 'hand') {
      gesture = { kind: 'pan', origin: p, viewport: s.viewport };
      e.preventDefault();
      setCursor();
      return;
    }
    if (e.button !== 0) return;

    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as
      Handle | undefined;
    if (handle) {
      startResize(handle, p);
      return;
    }
    const label = target.closest<HTMLElement>('[data-artboard-label]')?.dataset.artboardLabel;
    if (label) {
      if (e.shiftKey) s.toggleSelection(label);
      else if (!s.selection.includes(label)) s.setSelection([label]);
      startMove(p, null, e.altKey);
      return;
    }
    if (DRAW_KINDS.has(s.tool)) {
      startDraw(e, p);
      return;
    }
    if (s.tool === 'select') startSelect(e, p);
  };

  const hoverAt = (e: PointerEvent): void => {
    const s = state();
    if (s.tool !== 'select' || spaceDown) {
      s.setHover(null);
      return;
    }
    const chain = chainAt(e.target);
    s.setHover(
      pickTarget({
        chain,
        selected: s.selection,
        nodes: s.doc.nodes,
        deep: e.ctrlKey || e.metaKey,
      }),
    );
  };

  const onPointerMove = (e: PointerEvent): void => {
    last = { p: point(e), shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
    if (!gesture) {
      if (e.buttons === 0) hoverAt(e);
      return;
    }
    schedule();
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    if (gesture) endGesture(e);
  };

  const onPointerCancel = (): void => {
    cancelGesture();
  };

  const onDoubleClick = (e: MouseEvent): void => {
    // Pointer capture (taken on pointerdown) retargets this event to the canvas element itself,
    // so ask the document what is really under the pointer.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const target = (under ?? e.target) as HTMLElement;
    if (target.closest('[contenteditable="plaintext-only"], [data-ui], [data-handle]')) return;
    const s = state();
    if (s.tool !== 'select') return;
    const chain = chainAt(under);
    const next = enterTarget({ chain, selected: s.selection });
    if (!next) return;
    s.setSelection([next]);
    if (s.doc.nodes[next]?.type === 'text' && !isEffectivelyLocked(s.doc.nodes, next)) {
      s.beginTransaction('Edit text');
      beginTextEdit(store, next);
    }
  };

  const onWheel = (e: WheelEvent): void => {
    if ((e.target as HTMLElement).closest('[data-ui]')) return;
    e.preventDefault();
    const s = state();
    if (e.ctrlKey || e.metaKey) {
      // Pinch on a trackpad arrives as ctrl+wheel as well.
      s.setViewport(zoomAt(s.viewport, s.viewport.zoom * wheelZoomFactor(e.deltaY), point(e)));
    } else {
      const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
      s.setViewport(panBy(s.viewport, -dx, -dy));
    }
  };

  const isTyping = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !isTyping(e.target) && !spaceDown) {
      spaceDown = true;
      e.preventDefault();
      setCursor();
    }
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && spaceDown) {
      spaceDown = false;
      setCursor();
    }
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);
  container.addEventListener('dblclick', onDoubleClick);
  container.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.tool !== prev.tool) setCursor();
  });
  setCursor();

  return {
    cancelGesture,
    detach: () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
      container.removeEventListener('dblclick', onDoubleClick);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      unsubscribe();
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
