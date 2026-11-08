/**
 * Arranging layers: align, distribute, grid, match size, group and ungroup. Each function reads the
 * document and returns the edit as ordinary `Op`s, so the editor, the MCP tools and the undo
 * history all go through `applyChanges` (atomic, validated). Nothing here touches a document.
 *
 * Align, distribute and grid place layers by x/y, so they only make sense for layers whose parent
 * is the page or a `layout: "none"` frame (in auto-layout the parent decides, via gap/align/justify).
 */
import { applyChanges } from './apply';
import { CoreError } from './errors';
import { lookupId } from './ops';
import type { Doc, Node, Op } from './types';

export type AlignEdge = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface Placed {
  node: Node;
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = (v: number): number => Math.round(v * 100) / 100;

export function isFreeParent(parent: Node | undefined): boolean {
  return (
    parent !== undefined &&
    (parent.type === 'page' || parent.layout === 'none' || parent.layout === undefined)
  );
}

/** Resolves ids, requires one shared free parent and fixed sizes. Throws a CoreError with a hint. */
export function placedNodes(doc: Doc, ids: readonly string[], min = 1): Placed[] {
  const unique = [...new Set(ids.map((id) => lookupId(doc.nodes, id)))];
  if (unique.length < min) {
    throw new CoreError(
      'INVALID_VALUE',
      `This needs at least ${min} layer${min === 1 ? '' : 's'}; got ${unique.length}.`,
    );
  }
  const nodes = unique.map((id) => doc.nodes[id] as Node);
  const parentId = nodes[0]?.parentId ?? null;
  if (nodes.some((n) => n.parentId !== parentId || n.parentId === null)) {
    throw new CoreError(
      'BAD_PARENT',
      'The layers must all be inside the same frame (or all on the page).',
      'Group them first, or pick layers that share a parent.',
    );
  }
  const parent = doc.nodes[parentId as string];
  if (!isFreeParent(parent)) {
    throw new CoreError(
      'BAD_PARENT',
      `"${parent?.name ?? 'The parent'}" uses auto-layout, which positions its children itself.`,
      'Change gap, align or justify on the parent frame, or set its layout to "none" first.',
    );
  }
  return nodes.map((node) => {
    if (typeof node.w !== 'number' || typeof node.h !== 'number') {
      throw new CoreError(
        'INVALID_VALUE',
        `"${node.name}" has a ${node.w === 'fill' || node.h === 'fill' ? 'fill' : 'hug'} size, so its position cannot be worked out.`,
        'Give it a fixed width and height first (update w and h).',
      );
    }
    return { node, x: node.x, y: node.y, w: node.w, h: node.h };
  });
}

const moveOp = (p: Placed, x: number, y: number): Op[] =>
  round(x) === p.x && round(y) === p.y
    ? []
    : [{ op: 'update', id: p.node.id, set: { x: round(x), y: round(y) } }];

function bounds(list: readonly Placed[]): { x: number; y: number; w: number; h: number } {
  const x = Math.min(...list.map((p) => p.x));
  const y = Math.min(...list.map((p) => p.y));
  const r = Math.max(...list.map((p) => p.x + p.w));
  const b = Math.max(...list.map((p) => p.y + p.h));
  return { x, y, w: r - x, h: b - y };
}

/** Aligns to the edge/centre of the whole selection (or of the parent, with `toParent`; one layer needs it). */
export function alignOps(
  doc: Doc,
  ids: readonly string[],
  edge: AlignEdge,
  toParent = false,
): Op[] {
  const list = placedNodes(doc, ids, toParent ? 1 : 2);
  let box = bounds(list);
  if (toParent) {
    const parent = doc.nodes[list[0]?.node.parentId as string] as Node;
    if (typeof parent.w !== 'number' || typeof parent.h !== 'number') {
      throw new CoreError(
        'INVALID_VALUE',
        `"${parent.name}" has no fixed size to align to.`,
        'Give the parent a fixed width and height, or align the layers to each other.',
      );
    }
    box = { x: 0, y: 0, w: parent.w, h: parent.h };
  }
  return list.flatMap((p) => {
    switch (edge) {
      case 'left':
        return moveOp(p, box.x, p.y);
      case 'center':
        return moveOp(p, box.x + (box.w - p.w) / 2, p.y);
      case 'right':
        return moveOp(p, box.x + box.w - p.w, p.y);
      case 'top':
        return moveOp(p, p.x, box.y);
      case 'middle':
        return moveOp(p, p.x, box.y + (box.h - p.h) / 2);
      case 'bottom':
        return moveOp(p, p.x, box.y + box.h - p.h);
    }
  });
}

/**
 * Evens out the gaps along an axis. Without `gap` the outermost layers stay put and the ones
 * between them are spread evenly; with `gap` the layers are packed that far apart, starting from
 * the first one.
 */
export function distributeOps(
  doc: Doc,
  ids: readonly string[],
  axis: 'horizontal' | 'vertical',
  gap?: number,
): Op[] {
  const list = placedNodes(doc, ids, gap === undefined ? 3 : 2);
  const horizontal = axis === 'horizontal';
  const pos = (p: Placed): number => (horizontal ? p.x : p.y);
  const size = (p: Placed): number => (horizontal ? p.w : p.h);
  const sorted = [...list].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0] as Placed;
  const last = sorted[sorted.length - 1] as Placed;
  const step =
    gap ??
    (pos(last) + size(last) - pos(first) - sorted.reduce((sum, p) => sum + size(p), 0)) /
      (sorted.length - 1);
  let cursor = pos(first);
  return sorted.flatMap((p) => {
    const at = cursor;
    cursor += size(p) + step;
    return horizontal ? moveOp(p, at, p.y) : moveOp(p, p.x, at);
  });
}

/** Lays the layers out in a grid, in the order given, from the top-left of their combined box. */
export function gridOps(
  doc: Doc,
  ids: readonly string[],
  columns: number,
  gapX = 16,
  gapY = gapX,
): Op[] {
  const list = placedNodes(doc, ids, 1);
  const cols = Math.max(1, Math.min(Math.round(columns), list.length));
  const origin = bounds(list);
  const cellW = Math.max(...list.map((p) => p.w));
  const cellH = Math.max(...list.map((p) => p.h));
  return list.flatMap((p, i) =>
    moveOp(
      p,
      origin.x + (i % cols) * (cellW + gapX) + (cellW - p.w) / 2,
      origin.y + Math.floor(i / cols) * (cellH + gapY) + (cellH - p.h) / 2,
    ),
  );
}

/** Gives layers the same width and/or height: the largest, the first one's, or a number. */
export function matchSizeOps(
  doc: Doc,
  ids: readonly string[],
  dimension: 'w' | 'h' | 'both',
  to: 'largest' | 'first' | number = 'largest',
): Op[] {
  const list = placedNodes(doc, ids, 2);
  const pick = (key: 'w' | 'h'): number =>
    typeof to === 'number'
      ? to
      : to === 'first'
        ? (list[0] as Placed)[key]
        : Math.max(...list.map((p) => p[key]));
  const w = dimension === 'h' ? undefined : pick('w');
  const h = dimension === 'w' ? undefined : pick('h');
  return list.flatMap((p) => {
    const set: Record<string, number> = {};
    if (w !== undefined && w !== p.w) set.w = w;
    if (h !== undefined && h !== p.h) set.h = h;
    return Object.keys(set).length > 0 ? [{ op: 'update' as const, id: p.node.id, set }] : [];
  });
}

export interface GroupOptions {
  name?: string;
  /** 'none' keeps every layer where it is; row/column turns the group into an auto-layout frame. */
  layout?: 'none' | 'row' | 'column';
  gap?: number;
}

/** Wraps the layers in a new frame at their combined bounds. */
export function groupOps(doc: Doc, ids: readonly string[], options: GroupOptions = {}): Op[] {
  const list = placedNodes(doc, ids, 1);
  const first = list[0] as Placed;
  const parent = doc.nodes[first.node.parentId as string] as Node;
  // Back-to-front order of the parent decides stacking inside the group.
  const ordered = [...list].sort(
    (a, b) => parent.children.indexOf(a.node.id) - parent.children.indexOf(b.node.id),
  );
  const box = bounds(list);
  const top = Math.max(...ordered.map((p) => parent.children.indexOf(p.node.id)));
  const layout = options.layout ?? 'none';
  const flow = layout !== 'none';
  const along = [...list].sort((a, b) => (layout === 'row' ? a.x - b.x : a.y - b.y));
  const gap =
    options.gap ??
    (flow && along.length > 1
      ? Math.max(
          0,
          Math.round(
            layout === 'row'
              ? (along[1] as Placed).x - ((along[0] as Placed).x + (along[0] as Placed).w)
              : (along[1] as Placed).y - ((along[0] as Placed).y + (along[0] as Placed).h),
          ),
        )
      : 0);
  const ops: Op[] = [
    {
      op: 'create',
      parentId: parent.id,
      index: top + 1,
      node: {
        type: 'frame',
        tempId: 'group',
        name: options.name ?? 'Group',
        layout,
        x: round(box.x),
        y: round(box.y),
        w: flow ? 'hug' : round(box.w),
        h: flow ? 'hug' : round(box.h),
        ...(flow ? { gap } : {}),
      },
    },
  ];
  const sequence = flow ? along : ordered;
  for (const p of sequence) {
    ops.push({ op: 'move', id: p.node.id, parentId: '$group' });
    if (!flow)
      ops.push({
        op: 'update',
        id: p.node.id,
        set: { x: round(p.x - box.x), y: round(p.y - box.y) },
      });
  }
  return ops;
}

/** Moves a frame's children up into its parent (in place) and removes the frame. */
export function ungroupOps(doc: Doc, id: string): Op[] {
  const frameId = lookupId(doc.nodes, id);
  const frame = doc.nodes[frameId] as Node;
  if (frame.type !== 'frame') {
    throw new CoreError(
      'INVALID_VALUE',
      `"${frame.name}" is not a frame, so it cannot be ungrouped.`,
    );
  }
  if (frame.component !== undefined || frame.instanceOf !== undefined) {
    throw new CoreError(
      'INVALID_VALUE',
      `"${frame.name}" is a component, so its layers cannot be released.`,
      'Detach the instance first (update instanceOf to null), or edit the master.',
    );
  }
  const parent = doc.nodes[frame.parentId as string];
  if (!parent) throw new CoreError('INVALID_VALUE', 'The page cannot be ungrouped.');
  const at = parent.children.indexOf(frameId);
  const free = isFreeParent(parent);
  const offsets = new Map<string, { x: number; y: number }>();
  if (free) {
    if (frame.layout === 'row' || frame.layout === 'column') {
      // Work out where auto-layout put each child (fixed sizes only).
      const [pt, , , pl] = frame.padding ?? [0, 0, 0, 0];
      let cursor = frame.layout === 'row' ? pl : pt;
      for (const childId of frame.children) {
        const child = doc.nodes[childId] as Node;
        if (typeof child.w !== 'number' || typeof child.h !== 'number') {
          throw new CoreError(
            'INVALID_VALUE',
            `"${child.name}" has a hug or fill size, so its place after ungrouping cannot be worked out.`,
            'Give the children fixed sizes first, or keep the frame.',
          );
        }
        offsets.set(childId, frame.layout === 'row' ? { x: cursor, y: pt } : { x: pl, y: cursor });
        cursor += (frame.layout === 'row' ? child.w : child.h) + (frame.gap ?? 0);
      }
    } else {
      for (const childId of frame.children) {
        const child = doc.nodes[childId] as Node;
        offsets.set(childId, { x: child.x, y: child.y });
      }
    }
  }
  const ops: Op[] = [];
  frame.children.forEach((childId, i) => {
    ops.push({ op: 'move', id: childId, parentId: parent.id, index: at + i });
    const o = offsets.get(childId);
    if (free && o)
      ops.push({
        op: 'update',
        id: childId,
        set: { x: round(frame.x + o.x), y: round(frame.y + o.y) },
      });
  });
  ops.push({ op: 'delete', id: frameId });
  return ops;
}

export interface RepeatOptions {
  /** Total number of copies including the original (2..100). */
  count: number;
  direction?: 'row' | 'column' | 'grid';
  columns?: number;
  /** Space between copies when the parent places by x/y (in auto-layout the parent's gap is used). */
  gap?: number;
  /** Per-copy content, keyed by layer name: text layers get text, icon layers get an icon name. */
  values?: Record<string, readonly string[]>;
}

function layerByName(doc: Doc, rootId: string, name: string): Node | undefined {
  const stack = [rootId];
  while (stack.length > 0) {
    const node = doc.nodes[stack.shift() as string];
    if (!node) continue;
    if (node.name === name) return node;
    stack.push(...node.children);
  }
  return undefined;
}

/**
 * Duplicates a layer into a row, column or grid of identical siblings and fills each copy with its
 * own text or icon. Returns the new document and the ids in order (original first).
 */
export function repeatLayer(
  doc: Doc,
  id: string,
  options: RepeatOptions,
): { doc: Doc; ids: string[]; warnings: string[] } {
  const rootId = lookupId(doc.nodes, id);
  const original = doc.nodes[rootId] as Node;
  const count = Math.round(options.count);
  if (!(count >= 2 && count <= 100)) {
    throw new CoreError('INVALID_VALUE', 'count must be a whole number from 2 to 100.');
  }
  const parent = doc.nodes[original.parentId as string];
  if (!parent) throw new CoreError('INVALID_VALUE', 'The page cannot be repeated.');
  const free = isFreeParent(parent);
  const direction = options.direction ?? 'row';
  const warnings: string[] = [];
  let current = doc;
  const ids = [rootId];
  for (let i = 1; i < count; i += 1) {
    const result = applyChanges(current, [{ op: 'duplicate', id: ids[i - 1] as string }]);
    if (!result.ok) {
      const first = result.errors[0];
      throw new CoreError(
        first?.code ?? 'INTERNAL',
        first?.message ?? 'Duplicating failed.',
        first?.hint,
      );
    }
    current = result.doc;
    ids.push(result.created[0] as string);
  }
  const ops: Op[] = [];
  if (free && typeof original.w === 'number' && typeof original.h === 'number') {
    const gap = options.gap ?? 16;
    const cols =
      direction === 'grid'
        ? Math.max(1, Math.round(options.columns ?? Math.ceil(Math.sqrt(count))))
        : direction === 'row'
          ? count
          : 1;
    ids.forEach((copy, i) => {
      const x = original.x + (i % cols) * ((original.w as number) + gap);
      const y = original.y + Math.floor(i / cols) * ((original.h as number) + gap);
      ops.push({ op: 'update', id: copy, set: { x, y } });
    });
  } else if (!free) {
    if (direction === 'grid') {
      warnings.push(
        `The parent "${parent.name}" uses auto-layout, so the copies follow its ${parent.layout} direction. Turn on wrap in the parent for a grid.`,
      );
    }
  } else {
    warnings.push(
      'The layer has a hug or fill size, so the copies were stacked on top of each other.',
    );
  }
  for (const [layer, list] of Object.entries(options.values ?? {})) {
    ids.forEach((copy, i) => {
      const value = list[i];
      if (value === undefined) return;
      const target = layerByName(current, copy, layer);
      if (!target) {
        if (i === 0) warnings.push(`No layer named "${layer}" inside the repeated layer.`);
        return;
      }
      if (target.type === 'text') ops.push({ op: 'update', id: target.id, set: { text: value } });
      else if (target.type === 'icon')
        ops.push({ op: 'update', id: target.id, set: { icon: value } });
      else if (i === 0)
        warnings.push(`Layer "${layer}" is a ${target.type}, which cannot take a value.`);
    });
  }
  if (ops.length > 0) {
    const result = applyChanges(current, ops);
    if (!result.ok) {
      const first = result.errors[0];
      throw new CoreError(
        first?.code ?? 'INTERNAL',
        first?.message ?? 'Filling the copies failed.',
        first?.hint,
      );
    }
    current = result.doc;
  }
  return { doc: current, ids, warnings };
}
