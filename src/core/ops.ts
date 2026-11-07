import { CoreError } from './errors';
import { generateId, isValidId, isValidTempId, type Rng } from './ids';
import { deriveName, normalizeNode } from './normalize';
import { CONTAINER_TYPES, CREATABLE_TYPES } from './props';
import { descendantIds, isEffectivelyLocked, isInSubtree } from './tree';
import type { Doc, Node, NodePatch, NodeSpec, Warning } from './types';
import { deepEqual, isFiniteNumber, isPlainObject } from './util';
import { propIssues } from './validate';

export const LIMITS = {
  /** Operations per `apply_changes` batch (docs/05). */
  maxOps: 500,
  /** Nodes one batch may create (nested creates and duplicates count). */
  maxNodesPerBatch: 2000,
  /** Nesting depth of a `NodeSpec` tree; guards the recursion against hostile input. */
  maxDepth: 64,
} as const;

/**
 * Working state for a sequence of ops. Node objects are replaced, never mutated, so everything
 * untouched keeps its identity (structural sharing); only the node *map* is copied, once.
 * Internal to core: callers use the pure wrappers below or `applyChanges`.
 */
export interface Draft {
  readonly base: Doc;
  readonly nodes: Record<string, Node>;
  readonly rng: Rng;
  /** Every node id that ever existed in this draft, so ids are never reused within a batch. */
  readonly used: Set<string>;
  readonly touched: Set<string>;
  readonly created: string[];
  readonly deleted: Set<string>;
  readonly idMap: Record<string, string>;
  readonly warnings: Warning[];
  budget: number;
  dirty: boolean;
}

export function beginDraft(base: Doc, rng: Rng = Math.random): Draft {
  return {
    base,
    nodes: { ...base.nodes },
    rng,
    used: new Set(Object.keys(base.nodes)),
    touched: new Set(),
    created: [],
    deleted: new Set(),
    idMap: {},
    warnings: [],
    budget: LIMITS.maxNodesPerBatch,
    dirty: false,
  };
}

/** The document after the draft's changes; the same object when nothing changed. */
export function finishDraft(d: Draft): Doc {
  if (!d.dirty) return d.base;
  let annotations = d.base.annotations;
  if (d.deleted.size > 0) {
    // Deleting a node must not leave pins pointing at nothing; the pin keeps its x/y.
    annotations = annotations.map((a) => {
      if (a.nodeId === undefined || !d.deleted.has(a.nodeId)) return a;
      const unpinned = { ...a };
      delete unpinned.nodeId;
      return unpinned;
    });
  }
  return { ...d.base, nodes: d.nodes, annotations };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function put(d: Draft, node: Node): void {
  d.nodes[node.id] = node;
  d.touched.add(node.id);
  d.dirty = true;
}

function getNode(d: Draft, id: string): Node {
  const node = d.nodes[id];
  if (!node) {
    throw new CoreError(
      'NOT_FOUND',
      `Node ${id} does not exist.`,
      'Call get_design to see the current node ids.',
    );
  }
  return node;
}

/** `$tempId` -> the id a create op earlier in this batch gave it; real ids pass through. */
export function resolveRef(d: Draft, ref: string, path: string): string {
  if (!ref.startsWith('$')) return ref;
  const real = Object.prototype.hasOwnProperty.call(d.idMap, ref.slice(1))
    ? d.idMap[ref.slice(1)]
    : undefined;
  if (real === undefined) {
    throw new CoreError(
      'NOT_FOUND',
      `Unknown tempId '${ref}'.`,
      'A tempId can only be used by ops that come after the create op that defines it.',
      path,
    );
  }
  return real;
}

function assertContainer(node: Node): void {
  if (!CONTAINER_TYPES.includes(node.type)) {
    throw new CoreError(
      'BAD_PARENT',
      `Parent ${node.id} is a ${node.type} node; only frames can have children.`,
      node.parentId
        ? `Create the node inside ${node.parentId} (the frame that holds it) instead.`
        : 'Create the node inside a frame.',
    );
  }
}

function checkIndex(index: number | undefined, max: number, path: string): void {
  if (index === undefined) return;
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new CoreError(
      'INVALID_VALUE',
      `index ${String(index)} is out of range.`,
      `Use an integer from 0 to ${max}, or omit index to append.`,
      path,
    );
  }
}

function throwFirstIssue(issues: ReturnType<typeof propIssues>): void {
  const first = issues[0];
  if (first) throw new CoreError(first.code, first.message, first.hint, first.path);
}

function warnLocked(d: Draft, id: string, verb: string): void {
  if (!isEffectivelyLocked(d.nodes, id)) return;
  if (d.warnings.some((w) => w.code === 'LOCKED_NODE' && w.nodeId === id)) return;
  d.warnings.push({
    code: 'LOCKED_NODE',
    nodeId: id,
    message: `Node ${id} is locked in the editor; it was ${verb} anyway (locks only affect the UI).`,
  });
}

function spend(d: Draft, count = 1): void {
  d.budget -= count;
  if (d.budget < 0) {
    throw new CoreError(
      'LIMIT_EXCEEDED',
      `A batch may create at most ${LIMITS.maxNodesPerBatch} nodes.`,
      'Split the work into several apply_changes calls.',
    );
  }
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

function buildSubtree(
  d: Draft,
  spec: unknown,
  parentId: string,
  depth: number,
  path: string,
): string {
  if (!isPlainObject(spec)) {
    throw new CoreError('INVALID_VALUE', 'A node must be an object.', undefined, path);
  }
  if (depth > LIMITS.maxDepth) {
    throw new CoreError(
      'LIMIT_EXCEEDED',
      `Nodes are nested deeper than ${LIMITS.maxDepth} levels.`,
      undefined,
      path,
    );
  }
  const { type, id, tempId, children, ...props } = spec;
  if (typeof type !== 'string' || !CREATABLE_TYPES.includes(type as NodeSpec['type'])) {
    throw new CoreError(
      'INVALID_VALUE',
      `Invalid node type ${JSON.stringify(type)}.`,
      `type must be one of: ${CREATABLE_TYPES.join(', ')}.`,
      `${path}.type`,
    );
  }
  const nodeType = type as NodeSpec['type'];
  throwFirstIssue(propIssues(props, nodeType, { path }));

  if (children !== undefined) {
    if (!Array.isArray(children)) {
      throw new CoreError(
        'INVALID_VALUE',
        'children must be an array of nodes.',
        undefined,
        `${path}.children`,
      );
    }
    if (children.length > 0 && nodeType !== 'frame') {
      throw new CoreError(
        'BAD_PARENT',
        `A ${nodeType} node cannot have children.`,
        'Only frames can contain other nodes; wrap the content in a frame.',
        `${path}.children`,
      );
    }
  }

  spend(d);
  let newId: string;
  if (id !== undefined) {
    if (!isValidId(id, 'n')) {
      throw new CoreError(
        'INVALID_VALUE',
        `Invalid node id ${JSON.stringify(id)}.`,
        "Omit id to have one generated, or use the form 'n_abcde'.",
        `${path}.id`,
      );
    }
    if (d.used.has(id)) {
      throw new CoreError(
        'INVALID_VALUE',
        `Node id ${id} already exists.`,
        'Omit id to have one generated.',
        `${path}.id`,
      );
    }
    newId = id;
  } else {
    newId = generateId('n', d.used, d.rng);
  }
  d.used.add(newId);

  if (tempId !== undefined) {
    if (!isValidTempId(tempId)) {
      throw new CoreError(
        'INVALID_VALUE',
        `Invalid tempId ${JSON.stringify(tempId)}.`,
        'Use letters, digits, - and _, starting with a letter.',
        `${path}.tempId`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(d.idMap, tempId)) {
      throw new CoreError(
        'INVALID_VALUE',
        `tempId '${tempId}' is used more than once.`,
        undefined,
        `${path}.tempId`,
      );
    }
    d.idMap[tempId] = newId;
  }

  d.created.push(newId);
  const childIds = (Array.isArray(children) ? (children as unknown[]) : []).map((child, i) =>
    buildSubtree(d, child, newId, depth + 1, `${path}.children.${i}`),
  );
  put(
    d,
    normalizeNode({
      ...(props as Partial<Node>),
      id: newId,
      type: nodeType,
      parentId,
      children: childIds,
    }),
  );
  return newId;
}

/** Creates `spec` (and any nested `children`) under `parentRef`. Returns the new root id. */
export function draftCreate(d: Draft, parentRef: string, spec: unknown, index?: number): string {
  const parentId = resolveRef(d, parentRef, 'parentId');
  const parent = getNode(d, parentId);
  assertContainer(parent);
  checkIndex(index, parent.children.length, 'index');
  const newId = buildSubtree(d, spec, parentId, 0, 'node');
  const latest = getNode(d, parentId);
  const siblings = [...latest.children];
  siblings.splice(index ?? siblings.length, 0, newId);
  put(d, { ...latest, children: siblings });
  return newId;
}

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

export function draftUpdate(d: Draft, idRef: string, patch: unknown): void {
  const id = resolveRef(d, idRef, 'id');
  const node = getNode(d, id);
  if (!isPlainObject(patch)) {
    throw new CoreError(
      'INVALID_VALUE',
      "'set' must be an object of properties to change.",
      undefined,
      'set',
    );
  }
  if (node.type === 'page' && Object.keys(patch).some((k) => k !== 'name')) {
    throw new CoreError(
      'INVALID_VALUE',
      'The page node can only be renamed.',
      'Change the frames on the page instead.',
      'set',
    );
  }
  throwFirstIssue(propIssues(patch, node.type, { allowNull: true, path: 'set' }));

  const next: Record<string, unknown> = { ...node };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  // A text layer still carrying its auto-generated name follows its content.
  if (
    node.type === 'text' &&
    'text' in patch &&
    !('name' in patch) &&
    node.name === deriveName('text', node.text)
  ) {
    next.name = deriveName('text', typeof patch.text === 'string' ? patch.text : undefined);
  }
  if (deepEqual(next, node)) return;
  warnLocked(d, id, 'edited');
  put(d, next as unknown as Node);
}

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

/** Deletes the node and everything below it. Returns the removed ids (the node first). */
export function draftDelete(d: Draft, idRef: string): string[] {
  const id = resolveRef(d, idRef, 'id');
  const node = getNode(d, id);
  if (node.parentId === null) {
    throw new CoreError(
      'INVALID_VALUE',
      'The page node cannot be deleted.',
      'Delete its frames instead.',
      'id',
    );
  }
  warnLocked(d, id, 'deleted');
  const removed = [id, ...descendantIds(d.nodes, id)];
  const parent = getNode(d, node.parentId);
  put(d, { ...parent, children: parent.children.filter((c) => c !== id) });
  for (const gone of removed) {
    delete d.nodes[gone];
    d.deleted.add(gone);
  }
  return removed;
}

// ---------------------------------------------------------------------------
// move
// ---------------------------------------------------------------------------

export function draftMove(d: Draft, idRef: string, parentRef: string, index?: number): void {
  const id = resolveRef(d, idRef, 'id');
  const newParentId = resolveRef(d, parentRef, 'parentId');
  const node = getNode(d, id);
  if (node.parentId === null) {
    throw new CoreError('INVALID_VALUE', 'The page node cannot be moved.', undefined, 'id');
  }
  const newParent = getNode(d, newParentId);
  assertContainer(newParent);
  if (isInSubtree(d.nodes, newParentId, id)) {
    throw new CoreError(
      'CYCLE',
      `Cannot move ${id} into ${newParentId}: that would put a node inside itself.`,
      'Choose a parent that is not the node or one of its descendants.',
      'parentId',
    );
  }
  const oldParent = getNode(d, node.parentId);
  const sameParent = oldParent.id === newParent.id;
  const targetChildren = (sameParent ? oldParent : newParent).children.filter((c) => c !== id);
  checkIndex(index, targetChildren.length, 'index');
  const at = index ?? targetChildren.length;

  warnLocked(d, id, 'moved');
  const reordered = [...targetChildren.slice(0, at), id, ...targetChildren.slice(at)];
  if (sameParent) {
    if (!deepEqual(reordered, oldParent.children)) put(d, { ...oldParent, children: reordered });
    return;
  }
  put(d, { ...oldParent, children: oldParent.children.filter((c) => c !== id) });
  put(d, { ...newParent, children: reordered });
  put(d, { ...node, parentId: newParentId });
}

// ---------------------------------------------------------------------------
// duplicate
// ---------------------------------------------------------------------------

function copySubtree(d: Draft, sourceId: string, parentId: string): string {
  const source = getNode(d, sourceId);
  spend(d);
  const newId = generateId('n', d.used, d.rng);
  d.used.add(newId);
  d.created.push(newId);
  const children = source.children.map((c) => copySubtree(d, c, newId));
  put(d, { ...source, id: newId, parentId, children });
  return newId;
}

/** Deep-copies a node. Returns the new root id; all new ids are appended to `d.created`. */
export function draftDuplicate(
  d: Draft,
  idRef: string,
  parentRef?: string,
  offset?: { x: number; y: number },
): string {
  const id = resolveRef(d, idRef, 'id');
  const node = getNode(d, id);
  if (node.parentId === null) {
    throw new CoreError('INVALID_VALUE', 'The page node cannot be duplicated.', undefined, 'id');
  }
  if (
    offset !== undefined &&
    !(isPlainObject(offset) && isFiniteNumber(offset.x) && isFiniteNumber(offset.y))
  ) {
    throw new CoreError('INVALID_VALUE', 'offset must be { x, y } numbers.', undefined, 'offset');
  }
  const targetId = parentRef === undefined ? node.parentId : resolveRef(d, parentRef, 'parentId');
  const target = getNode(d, targetId);
  assertContainer(target);
  if (isInSubtree(d.nodes, targetId, id)) {
    throw new CoreError(
      'CYCLE',
      `Cannot duplicate ${id} into ${targetId}: that is the node itself or one of its descendants.`,
      undefined,
      'parentId',
    );
  }
  const copyId = copySubtree(d, id, targetId);
  if (offset !== undefined) {
    const copy = getNode(d, copyId);
    put(d, { ...copy, x: copy.x + offset.x, y: copy.y + offset.y });
  }
  const latest = getNode(d, targetId);
  const siblings = [...latest.children];
  // Next to the original when staying in the same parent, otherwise on top.
  const at = parentRef === undefined ? siblings.indexOf(id) + 1 : siblings.length;
  siblings.splice(at, 0, copyId);
  put(d, { ...latest, children: siblings });
  return copyId;
}

// ---------------------------------------------------------------------------
// Pure wrappers: Doc in, new Doc out (throw CoreError on invalid input)
// ---------------------------------------------------------------------------

export interface CreateResult {
  doc: Doc;
  /** The new root node's id. */
  rootId: string;
  /** Every id created (root first, then descendants in order). */
  created: string[];
  idMap: Record<string, string>;
}

export function createNode(
  doc: Doc,
  parentId: string,
  spec: NodeSpec,
  options: { index?: number; rng?: Rng } = {},
): CreateResult {
  const d = beginDraft(doc, options.rng);
  const rootId = draftCreate(d, parentId, spec, options.index);
  return { doc: finishDraft(d), rootId, created: [...d.created], idMap: { ...d.idMap } };
}

export function updateNode(doc: Doc, id: string, patch: NodePatch): Doc {
  const d = beginDraft(doc);
  draftUpdate(d, id, patch);
  return finishDraft(d);
}

export function deleteNode(doc: Doc, id: string): { doc: Doc; deleted: string[] } {
  const d = beginDraft(doc);
  const deleted = draftDelete(d, id);
  return { doc: finishDraft(d), deleted };
}

export function moveNode(doc: Doc, id: string, parentId: string, index?: number): Doc {
  const d = beginDraft(doc);
  draftMove(d, id, parentId, index);
  return finishDraft(d);
}

export function duplicateNode(
  doc: Doc,
  id: string,
  options: { parentId?: string; offset?: { x: number; y: number }; rng?: Rng } = {},
): { doc: Doc; rootId: string; created: string[] } {
  const d = beginDraft(doc, options.rng);
  const rootId = draftDuplicate(d, id, options.parentId, options.offset);
  return { doc: finishDraft(d), rootId, created: [...d.created] };
}
