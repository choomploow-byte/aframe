import { isInSubtree } from '@core/tree';
import { topmostIds } from '@core/clipboard';
import type { Doc, Node, NodeType, Op } from '@core/types';

/**
 * The Layers panel without any DOM: which rows are visible, and what a drop means. Rows are shown
 * top-most layer first (the reverse of `children`, which is back-to-front, docs/04).
 */
export interface LayerRow {
  id: string;
  parentId: string;
  depth: number;
  name: string;
  type: NodeType;
  visible: boolean;
  locked: boolean;
  hasChildren: boolean;
  expanded: boolean;
}

export function buildRows(doc: Doc, expanded: ReadonlySet<string>, filter = ''): LayerRow[] {
  const needle = filter.trim().toLowerCase();
  const root = doc.nodes[doc.rootId];
  if (!root) return [];

  // With a filter: keep matching nodes and the ancestors that lead to them, all expanded.
  let keep: Set<string> | null = null;
  if (needle !== '') {
    keep = new Set<string>();
    for (const node of Object.values(doc.nodes)) {
      if (node.id === doc.rootId || !node.name.toLowerCase().includes(needle)) continue;
      let current: Node | undefined = node;
      while (current && current.id !== doc.rootId && !keep.has(current.id)) {
        keep.add(current.id);
        current = current.parentId ? doc.nodes[current.parentId] : undefined;
      }
    }
  }

  const rows: LayerRow[] = [];
  const visit = (parent: Node, depth: number): void => {
    for (let i = parent.children.length - 1; i >= 0; i -= 1) {
      const node = doc.nodes[parent.children[i] as string];
      if (!node || (keep && !keep.has(node.id))) continue;
      const isOpen = keep !== null || expanded.has(node.id);
      rows.push({
        id: node.id,
        parentId: parent.id,
        depth,
        name: node.name,
        type: node.type,
        visible: node.visible,
        locked: node.locked,
        hasChildren: node.children.length > 0,
        expanded: node.children.length > 0 && isOpen,
      });
      if (node.children.length > 0 && isOpen) visit(node, depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}

/** The set plus every ancestor of the given nodes, so a selected layer is never hidden in a collapsed branch. */
export function withAncestorsExpanded(
  doc: Doc,
  ids: readonly string[],
  expanded: ReadonlySet<string>,
): Set<string> {
  const next = new Set(expanded);
  for (const id of ids) {
    let parent = doc.nodes[id]?.parentId;
    while (parent !== null && parent !== undefined && parent !== doc.rootId) {
      next.add(parent);
      parent = doc.nodes[parent]?.parentId;
    }
  }
  return next;
}

/** Ids of the rows between two rows, inclusive (shift-click range selection). */
export function rangeBetween(rows: readonly LayerRow[], a: string, b: string): string[] {
  const i = rows.findIndex((r) => r.id === a);
  const j = rows.findIndex((r) => r.id === b);
  if (i === -1 || j === -1) return [b];
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1).map((r) => r.id);
}

/** Where a dragged row lands relative to the row it is dropped on. */
export type DropPosition = 'above' | 'below' | 'inside';

/**
 * The move ops for dropping `dragIds` (in display order) on `targetId`, or null if the drop is not
 * allowed (onto itself or its own subtree, "inside" a non-container). The dragged layers keep their
 * relative stacking. Indexes are computed against a simulation, so the batch is correct even when
 * some dragged nodes already live in the destination.
 */
export function dropOps(
  doc: Doc,
  dragIds: readonly string[],
  targetId: string,
  position: DropPosition,
): Op[] | null {
  const target = doc.nodes[targetId];
  if (!target || targetId === doc.rootId) return null;
  const tops = topmostIds(doc.nodes, dragIds).filter((id) => id !== doc.rootId && doc.nodes[id]);
  if (tops.length === 0) return null;
  if (tops.some((id) => isInSubtree(doc.nodes, targetId, id))) return null; // onto itself or a descendant

  const destId = position === 'inside' ? targetId : target.parentId;
  const dest = destId ? doc.nodes[destId] : undefined;
  if (!dest || (dest.type !== 'frame' && dest.type !== 'page')) return null;

  // Dragged layers bottom-to-top, the order they stack in.
  const block = [...tops].sort((a, b) => dragIds.indexOf(b) - dragIds.indexOf(a));
  const sim = [...dest.children];
  const ops: Op[] = [];
  block.forEach((id, k) => {
    const at = sim.indexOf(id);
    if (at !== -1) sim.splice(at, 1);
    let index: number;
    if (k > 0) index = sim.indexOf(block[k - 1] as string) + 1;
    else if (position === 'inside') index = sim.length;
    else if (position === 'above') index = sim.indexOf(targetId) + 1;
    else index = sim.indexOf(targetId);
    sim.splice(index, 0, id);
    ops.push({ op: 'move', id, parentId: dest.id, index });
  });
  return ops;
}

/** Whether `id` could host children, for drop-inside highlighting. */
export function isContainer(doc: Doc, id: string): boolean {
  const type = doc.nodes[id]?.type;
  return type === 'frame' || type === 'page';
}
