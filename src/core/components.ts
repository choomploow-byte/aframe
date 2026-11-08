/**
 * Reusable components (docs/04 "Components"): a master frame is defined once and placed as
 * instances that follow it.
 *
 * The document stays a flat node map, so everything downstream (the canvas, screenshots, outline,
 * lint, export) treats an instance as an ordinary frame with ordinary children. The instance's
 * layers are *derived*: `syncInstance` rebuilds them from the master, the state's patches and the
 * instance's own overrides, keeping their ids stable so selections and annotations survive.
 *
 *   master root   { component: { kind, states? } }
 *   instance root { instanceOf, state?, overrides? }      owns x, y, name, locked, visible
 *   instance layer { from: <master layer id> }            props derived, never edited directly
 *
 * Editing a layer inside an instance is stored as an override on the instance root (see
 * `recordOverride`), so it survives later edits to the master.
 */
import { CoreError } from './errors';
import { generateId, type Rng } from './ids';
import type { ComponentState, Doc, LayerPatches, Node } from './types';
import { deepEqual } from './util';

export const SELF = '$self';

/** Props an instance root keeps for itself: its position and bookkeeping, not the master's look. */
const ROOT_OWNED = new Set(['x', 'y', 'name', 'locked', 'visible']);
/** Never copied from the master to an instance. */
const NOT_COPIED = new Set([
  'id',
  'type',
  'parentId',
  'children',
  'component',
  'instanceOf',
  'state',
  'overrides',
  'from',
]);

/** What a part of core that edits nodes must provide so components can rewrite instances. */
export interface NodeSpace {
  nodes: Record<string, Node>;
  used: Set<string>;
  rng: Rng;
  /** Store a changed node (the owner records it as touched). */
  put(node: Node): void;
  /** A node was created / removed by the sync (the owner keeps its bookkeeping). */
  created(id: string): void;
  removed(id: string): void;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export const isMaster = (n: Node | undefined): boolean => n?.component !== undefined;
export const isInstanceRoot = (n: Node | undefined): boolean => n?.instanceOf !== undefined;

/** The instance root that owns `node` (a layer inside an instance), or null. */
export function instanceRootOf(nodes: Record<string, Node>, node: Node): Node | null {
  let cur: Node | undefined = node;
  while (cur) {
    if (cur.instanceOf !== undefined) return cur;
    cur = cur.parentId === null ? undefined : nodes[cur.parentId];
  }
  return null;
}

/** The master root that contains `node` (or is it), or null. */
export function masterRootOf(nodes: Record<string, Node>, node: Node): Node | null {
  let cur: Node | undefined = node;
  while (cur) {
    if (cur.component !== undefined) return cur;
    cur = cur.parentId === null ? undefined : nodes[cur.parentId];
  }
  return null;
}

/** Descendants in document order (parents before children), excluding the node itself. */
export function descendantsOf(nodes: Record<string, Node>, id: string): Node[] {
  const out: Node[] = [];
  const visit = (nid: string): void => {
    for (const c of nodes[nid]?.children ?? []) {
      const child = nodes[c];
      if (!child) continue;
      out.push(child);
      visit(c);
    }
  };
  visit(id);
  return out;
}

/**
 * Whether master `masterId` contains, at any depth through the instances inside it, an instance of
 * `targetId` (or is `targetId` itself). Used to refuse nesting that would loop.
 */
export function masterDependsOn(
  nodes: Record<string, Node>,
  masterId: string,
  targetId: string,
): boolean {
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (id === targetId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return [nodes[id], ...descendantsOf(nodes, id)].some(
      (n) => n?.instanceOf !== undefined && n.instanceOf !== id && visit(n.instanceOf),
    );
  };
  return visit(masterId);
}

export function instancesOf(nodes: Record<string, Node>, masterId: string): Node[] {
  return Object.values(nodes).filter((n) => n.instanceOf === masterId);
}

/**
 * Turns a layer reference into a layer id of the master: `$self`/`self`/`root`, an id (with or
 * without `n_`), or a layer name that is unique inside the master.
 */
export function resolveLayerKey(
  nodes: Record<string, Node>,
  masterId: string,
  key: string,
): string {
  if (key === SELF || key === 'self' || key === 'root') return SELF;
  const layers = [nodes[masterId], ...descendantsOf(nodes, masterId)].filter(
    (n): n is Node => n !== undefined,
  );
  const byId = layers.find((n) => n.id === key || n.id === `n_${key}`);
  if (byId) return byId.id === masterId ? SELF : byId.id;
  const named = layers.filter((n) => n.name === key);
  if (named.length === 1 && named[0]) return named[0].id === masterId ? SELF : named[0].id;
  const names = layers
    .map((n) => `"${n.name}" (${n.id})`)
    .slice(0, 12)
    .join(', ');
  throw new CoreError(
    'NOT_FOUND',
    named.length > 1
      ? `Layer name "${key}" is ambiguous in component ${masterId}.`
      : `Component ${masterId} has no layer "${key}".`,
    named.length > 1
      ? `Use a layer id instead: ${named.map((n) => n.id).join(', ')}.`
      : `Layers: ${names}. Use $self for the component itself.`,
  );
}

// ---------------------------------------------------------------------------
// Deriving an instance from its master
// ---------------------------------------------------------------------------

function layerProps(
  master: Node,
  ...patches: (Record<string, unknown> | undefined)[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(master)) if (!NOT_COPIED.has(k)) out[k] = v;
  for (const patch of patches) {
    if (!patch) continue;
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete out[k];
      else out[k] = v;
    }
  }
  return out;
}

/** Removes instance bookkeeping, leaving the content as ordinary frames ("detach"). */
export function detachInstance(space: NodeSpace, rootId: string): void {
  const root = space.nodes[rootId];
  if (!root) return;
  const next: Record<string, unknown> = { ...root };
  delete next.instanceOf;
  delete next.state;
  delete next.overrides;
  space.put(next as unknown as Node);
  for (const layer of descendantsOf(space.nodes, rootId)) {
    if (layer.from === undefined) continue;
    const copy: Record<string, unknown> = { ...layer };
    delete copy.from;
    space.put(copy as unknown as Node);
  }
}

function putIfChanged(space: NodeSpace, next: Node): void {
  const prev = space.nodes[next.id];
  if (prev && deepEqual(prev, next)) return;
  space.put(next);
}

/**
 * Rebuilds an instance's layers from its master. Layers keep their ids (matched by `from`), new
 * master layers get fresh ids, layers the master no longer has are removed. A master that is gone
 * detaches the instance instead, so its content is never lost.
 */
export function syncInstance(space: NodeSpace, rootId: string): void {
  const root = space.nodes[rootId];
  if (!root || root.instanceOf === undefined) return;
  const master = space.nodes[root.instanceOf];
  if (!master || master.component === undefined || master.id === root.id) {
    detachInstance(space, rootId);
    return;
  }
  const state: ComponentState = root.state ?? 'default';
  const statePatches: LayerPatches =
    state === 'default' ? {} : (master.component.states?.[state] ?? {});
  const own = root.overrides ?? {};

  const reuse = new Map<string, string>();
  const before = descendantsOf(space.nodes, rootId);
  for (const layer of before) if (layer.from !== undefined) reuse.set(layer.from, layer.id);

  const kept = new Set<string>();
  const build = (masterLayerId: string, parentId: string): string => {
    const m = space.nodes[masterLayerId] as Node;
    let id = reuse.get(masterLayerId);
    if (id === undefined) {
      id = generateId('n', space.used, space.rng);
      space.used.add(id);
      space.created(id);
    }
    kept.add(id);
    const childIds = m.children.map((c) => build(c, id));
    const props = layerProps(m, statePatches[masterLayerId], own[masterLayerId]);
    putIfChanged(space, {
      ...(props as object),
      id,
      type: m.type,
      parentId,
      children: childIds,
      from: masterLayerId,
    } as Node);
    return id;
  };
  const childIds = master.children.map((c) => build(c, rootId));

  const rootProps = layerProps(master, statePatches[SELF], own[SELF]);
  const next: Record<string, unknown> = {
    ...rootProps,
    id: root.id,
    type: master.type,
    parentId: root.parentId,
    children: childIds,
    instanceOf: root.instanceOf,
  };
  for (const key of ROOT_OWNED) {
    if (key in root) next[key] = (root as unknown as Record<string, unknown>)[key];
    else delete next[key];
  }
  if (root.state !== undefined) next.state = root.state;
  if (root.overrides !== undefined) {
    // Drop overrides for layers the master no longer has.
    const live = new Set<string>([SELF, ...reuse.keys(), ...master.children]);
    for (const layer of descendantsOf(space.nodes, master.id)) live.add(layer.id);
    const pruned: LayerPatches = {};
    for (const [k, v] of Object.entries(root.overrides)) if (live.has(k)) pruned[k] = v;
    if (Object.keys(pruned).length > 0) next.overrides = pruned;
  }
  putIfChanged(space, next as unknown as Node);

  for (const layer of before) {
    if (kept.has(layer.id)) continue;
    delete space.nodes[layer.id];
    space.removed(layer.id);
  }
}

/** Applies a master's state patches to the master's own layers (for screenshots of a master). */
function paintMasterState(space: NodeSpace, masterId: string, state: ComponentState): void {
  const master = space.nodes[masterId];
  const patches = master?.component?.states?.[state as Exclude<ComponentState, 'default'>];
  if (!master || !patches) return;
  for (const [key, patch] of Object.entries(patches)) {
    const target = space.nodes[key === SELF ? masterId : key];
    if (!target) continue;
    const next: Record<string, unknown> = { ...target };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    space.put(next as unknown as Node);
  }
}

// ---------------------------------------------------------------------------
// Settling a batch of edits
// ---------------------------------------------------------------------------

/**
 * After a batch: rebuild every instance whose master changed, and every instance that was edited
 * itself (state, overrides, a new instanceOf). Cheap when no component is involved.
 */
export function settleComponents(
  space: NodeSpace,
  touched: ReadonlySet<string>,
  deleted: ReadonlySet<string>,
  base: Record<string, Node>,
): void {
  const nodes = space.nodes;
  const masters = new Set<string>();
  const instances = new Set<string>();

  for (const id of touched) {
    const node = nodes[id];
    if (!node) continue;
    if (node.instanceOf !== undefined) instances.add(id);
    // A touched layer inside a master (or the master) means its instances are stale.
    if (base[id]?.component !== undefined && node.component === undefined) masters.add(id);
    if (node.from === undefined) {
      const m = masterRootOf(nodes, node);
      if (m) masters.add(m.id);
    }
  }
  // A deleted master leaves orphans: sync detaches them.
  for (const id of deleted) if (base[id]?.component !== undefined) masters.add(id);
  if (masters.size > 0) {
    for (const n of Object.values(nodes)) {
      if (n.instanceOf !== undefined && masters.has(n.instanceOf)) instances.add(n.id);
    }
  }
  // An instance inside a master (a Buy button in a card) changes what that master looks like, so the
  // master's own instances are rebuilt too, and so on up. Nesting is a tree, so this ends.
  const queue = [...instances];
  const pending = new Set(queue);
  for (let steps = 0; queue.length > 0 && steps < 500; steps += 1) {
    const id = queue.shift() as string;
    pending.delete(id);
    syncInstance(space, id);
    const node = nodes[id];
    const holder = node ? masterRootOf(nodes, node) : null;
    if (!holder) continue;
    for (const other of Object.values(nodes)) {
      if (other.instanceOf === holder.id && other.id !== id && !pending.has(other.id)) {
        pending.add(other.id);
        queue.push(other.id);
      }
    }
  }
}

/** Every instance in the document rebuilt from its master (after a merge or a file load). */
export function syncAllInstances(doc: Doc, rng: Rng = Math.random): Doc {
  const instances = Object.values(doc.nodes).filter((n) => n.instanceOf !== undefined);
  if (instances.length === 0) return doc;
  const nodes = { ...doc.nodes };
  const used = new Set(Object.keys(nodes));
  let changed: boolean;
  let anyChange = false;
  const space: NodeSpace = {
    nodes,
    used,
    rng,
    put: (n) => {
      nodes[n.id] = n;
      changed = true;
    },
    created: () => {
      changed = true;
    },
    removed: () => {
      changed = true;
    },
  };
  // Instances inside masters feed other instances, so go round until nothing changes any more
  // (as many rounds as the nesting is deep, plus one to confirm).
  for (let round = 0; round < 8; round += 1) {
    changed = false;
    for (const inst of instances) syncInstance(space, inst.id);
    if (!changed) break;
    anyChange = true;
  }
  if (!anyChange) return doc;
  // The page's child list may reference removed nodes only through instances, which sync keeps whole.
  return { ...doc, nodes };
}

/**
 * The document as it would look with components showing `state` inside `rootIds` (instances switch,
 * masters take their state patches). Nothing is saved; this feeds screenshots. Returns the same
 * document when no component is involved.
 */
export function docInState(doc: Doc, state: ComponentState, rootIds: readonly string[]): Doc {
  const nodes = { ...doc.nodes };
  const space: NodeSpace = {
    nodes,
    used: new Set(Object.keys(nodes)),
    rng: Math.random,
    put: (n) => {
      nodes[n.id] = n;
    },
    created: () => undefined,
    removed: () => undefined,
  };
  let touched = false;
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = nodes[id];
    if (!node) return;
    if (node.instanceOf !== undefined) {
      touched = true;
      space.put({ ...node, state });
      syncInstance(space, id);
      return; // its layers are rebuilt by the sync
    }
    if (node.component !== undefined && state !== 'default') {
      touched = true;
      paintMasterState(space, id, state);
    }
    for (const c of node.children) visit(c);
  };
  for (const id of rootIds) visit(id);
  return touched ? { ...doc, nodes } : doc;
}

// ---------------------------------------------------------------------------
// Preview: the document as it looks while a person hovers, presses and clicks
// ---------------------------------------------------------------------------

/** What the interactive preview has changed on top of the design. Nothing here is saved. */
export interface PreviewOverlay {
  /** Instance roots showing a state (hover, pressed, selected...). */
  states: Readonly<Record<string, ComponentState>>;
  /** Copies of a component that sits inside another component (a Buy button in a card) showing a state. */
  inner: Readonly<Record<string, ComponentState>>;
  /** Layers shown or hidden (a tab's panel). */
  visible: Readonly<Record<string, boolean>>;
}

/** The master an inner copy was made from, when `node` is the root of a component nested in a card. */
export function innerMasterOf(nodes: Record<string, Node>, node: Node): Node | null {
  if (node.from === undefined) return null;
  const inside = nodes[node.from];
  const master = inside?.instanceOf === undefined ? undefined : nodes[inside.instanceOf];
  return master?.component === undefined ? null : master;
}

/**
 * The document with the overlay applied: instances switched to their state, nested components
 * restyled from their own master's state, and layers shown or hidden. Returns the same document
 * when the overlay is empty.
 */
export function docForPreview(doc: Doc, overlay: PreviewOverlay): Doc {
  const nodes = { ...doc.nodes };
  const space: NodeSpace = {
    nodes,
    used: new Set(Object.keys(nodes)),
    rng: Math.random,
    put: (n) => {
      nodes[n.id] = n;
    },
    created: () => undefined,
    removed: () => undefined,
  };
  let changed = false;
  for (const [id, state] of Object.entries(overlay.states)) {
    const node = nodes[id];
    if (node?.instanceOf === undefined) continue;
    space.put({ ...node, state });
    syncInstance(space, id);
    changed = true;
  }
  for (const [id, state] of Object.entries(overlay.inner)) {
    const root = nodes[id];
    const master = root ? innerMasterOf(nodes, root) : null;
    if (!root || !master || state === 'default') continue;
    const patches = master.component?.states?.[state] ?? {};
    for (const layer of [root, ...descendantsOf(nodes, id)]) {
      const key = layer.id === id ? SELF : nodes[layer.from ?? '']?.from;
      const patch = key === undefined ? undefined : patches[key];
      if (!patch) continue;
      const next: Record<string, unknown> = { ...layer };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      space.put(next as unknown as Node);
      changed = true;
    }
  }
  for (const [id, visible] of Object.entries(overlay.visible)) {
    const node = nodes[id];
    if (!node || node.visible === visible) continue;
    space.put({ ...node, visible });
    changed = true;
  }
  return changed ? { ...doc, nodes } : doc;
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/** Merges `patch` into the override for one layer of an instance. `null` values mean "remove". */
export function mergeOverride(
  overrides: LayerPatches | undefined,
  layerKey: string,
  patch: Record<string, unknown>,
): LayerPatches {
  const next: LayerPatches = { ...(overrides ?? {}) };
  next[layerKey] = { ...(next[layerKey] ?? {}), ...patch };
  return next;
}

export const ROOT_OWNED_KEYS: ReadonlySet<string> = ROOT_OWNED;
