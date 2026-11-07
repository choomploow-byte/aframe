import type { Doc, Node } from './types';

type NodeMap = Readonly<Record<string, Node>>;

/** Ids of every node below `id`, parents before children. Iterative and cycle-safe. */
export function descendantIds(nodes: NodeMap, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack: string[] = [...(nodes[id]?.children ?? [])].reverse();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    out.push(current);
    const children = nodes[current]?.children ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i] as string);
  }
  return out;
}

/** True if `id` is `ancestorId` or lives somewhere below it. */
export function isInSubtree(nodes: NodeMap, id: string, ancestorId: string): boolean {
  let current: string | null | undefined = id;
  const seen = new Set<string>();
  while (current !== null && current !== undefined && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = nodes[current]?.parentId;
  }
  return false;
}

/** Ancestors of `id`, nearest first, ending at the root. */
export function ancestorIds(nodes: NodeMap, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let current = nodes[id]?.parentId;
  while (current !== null && current !== undefined && !seen.has(current)) {
    out.push(current);
    seen.add(current);
    current = nodes[current]?.parentId;
  }
  return out;
}

/** A node is effectively locked if it or any ancestor is locked (lock is UI-only, docs/04). */
export function isEffectivelyLocked(nodes: NodeMap, id: string): boolean {
  if (nodes[id]?.locked) return true;
  return ancestorIds(nodes, id).some((a) => nodes[a]?.locked === true);
}

export function getRoot(doc: Doc): Node {
  const root = doc.nodes[doc.rootId];
  if (!root) throw new Error(`Document ${doc.id} has no root node ${doc.rootId}`);
  return root;
}

/** Top-level frames (artboards): the page's children. */
export function getArtboards(doc: Doc): Node[] {
  return getRoot(doc)
    .children.map((id) => doc.nodes[id])
    .filter((n): n is Node => n !== undefined);
}
