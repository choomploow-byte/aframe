import type { Node } from '@core/types';

type Nodes = Readonly<Record<string, Node>>;

/** Depth below the page: artboards (top-level frames) are 0. */
export function depthOf(nodes: Nodes, id: string): number {
  let depth = -1;
  let current: string | null | undefined = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const parentId: string | null | undefined = nodes[current]?.parentId;
    if (parentId !== null && parentId !== undefined) depth += 1;
    current = parentId;
  }
  return Math.max(0, depth);
}

/** Ids from the artboard down to the node under the pointer (page excluded). */
export function chainTo(nodes: Nodes, id: string): string[] {
  const chain: string[] = [];
  let current: string | null | undefined = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const node: Node | undefined = nodes[current];
    if (!node || node.type === 'page') break;
    chain.unshift(current);
    current = node.parentId;
  }
  return chain;
}

/**
 * Which node a click selects. Like Figma: with nothing selected, clicking content picks the
 * artboard's direct child; once something is selected, clicks pick at that same depth, so you can
 * click around siblings without diving; double-click goes one level deeper; Ctrl/Cmd+click goes
 * straight to the deepest node. `chain[0]` is the artboard.
 */
export function pickTarget(args: {
  chain: readonly string[];
  selected: readonly string[];
  nodes: Nodes;
  deep?: boolean;
}): string | null {
  const { chain, selected, nodes, deep = false } = args;
  if (chain.length === 0) return null;
  if (deep) return chain[chain.length - 1] ?? null;
  const first = selected[0];
  const wanted = first === undefined ? 1 : Math.max(1, depthOf(nodes, first));
  return chain[Math.min(wanted, chain.length - 1)] ?? null;
}

/** Double-click: one level below the selected node if it is on the chain, else the first child level. */
export function enterTarget(args: {
  chain: readonly string[];
  selected: readonly string[];
}): string | null {
  const { chain, selected } = args;
  if (chain.length === 0) return null;
  const index = selected[0] === undefined ? -1 : chain.indexOf(selected[0]);
  const next = index === -1 ? 1 : index + 1;
  return chain[Math.min(next, chain.length - 1)] ?? null;
}
