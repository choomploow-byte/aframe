import { CoreError } from './errors';
import type { Doc, Node, NodeSpec } from './types';

/**
 * A node subtree as a `NodeSpec` (no ids), ready to be pasted with a `create` op. Used by copy and
 * paste, "copy as code" later and the eval harness. Ids are dropped on purpose: pasting must never
 * collide with, or silently alias, the original.
 */
export function extractSpec(doc: Doc, id: string): NodeSpec {
  const node = doc.nodes[id];
  if (!node) throw new CoreError('NOT_FOUND', `Node ${id} does not exist.`);
  if (node.type === 'page') {
    throw new CoreError(
      'INVALID_VALUE',
      'The page node cannot be copied.',
      'Copy its frames instead.',
    );
  }
  const spec: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'id' || key === 'parentId' || key === 'children' || value === undefined) continue;
    spec[key] = value;
  }
  if (node.children.length > 0) {
    spec.children = node.children.map((child) => extractSpec(doc, child));
  }
  return spec as unknown as NodeSpec;
}

/** Drops ids whose ancestor is also in the list, so a selection of a frame and its text copies once. */
export function topmostIds(
  nodes: Readonly<Record<string, Node>>,
  ids: readonly string[],
): string[] {
  const wanted = new Set(ids);
  return ids.filter((id) => {
    let parent = nodes[id]?.parentId;
    while (parent !== null && parent !== undefined) {
      if (wanted.has(parent)) return false;
      parent = nodes[parent]?.parentId;
    }
    return true;
  });
}

/** Specs for a selection, in document order (back to front within each parent). */
export function extractSpecs(doc: Doc, ids: readonly string[]): NodeSpec[] {
  const tops = topmostIds(doc.nodes, ids).filter((id) => doc.nodes[id] !== undefined);
  const order = (id: string): number => {
    const parentId = doc.nodes[id]?.parentId;
    const siblings = parentId ? (doc.nodes[parentId]?.children ?? []) : [];
    return siblings.indexOf(id);
  };
  const sorted = [...tops].sort((a, b) => {
    const pa = doc.nodes[a]?.parentId ?? '';
    const pb = doc.nodes[b]?.parentId ?? '';
    return pa === pb ? order(a) - order(b) : 0;
  });
  return sorted.map((id) => extractSpec(doc, id));
}
