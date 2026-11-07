/**
 * Three-way merge of project documents (docs/06 "Conflict handling").
 *
 *   base   = the document as last known to be on disk (what both sides started from)
 *   local  = what is on screen now (the user's unsaved edits on top of base)
 *   remote = what is on disk now (an agent or a script changed it)
 *
 * The rule is property-level and deliberately simple: for every node, every property, every token:
 * if only one side changed it, that change wins; if both changed it to different things, the
 * REMOTE value wins and the node is reported so the UI can say "AI updated X". Nothing here ever
 * throws or returns an invalid document: if the merged result would be inconsistent (a cycle, a
 * missing root, schema errors) the remote document is returned with mode 'remote-fallback' and the
 * caller's undo history still holds the local state.
 *
 * Pure, and structure-sharing: a node nobody touched keeps its object identity.
 */
import { deepEqual } from './util';
import type { Annotation, Doc, Node, Reference } from './types';
import { validateDoc } from './validate';

export type MergeMode =
  /** Nothing local to keep: the remote document, unchanged. */
  | 'remote'
  /** Nothing remote to take: the local document, unchanged. */
  | 'local'
  /** Both sides changed different things: a combined document. */
  | 'merged'
  /** The combination was inconsistent, so the remote document was taken whole. */
  | 'remote-fallback';

export interface MergeResult {
  doc: Doc;
  mode: MergeMode;
  /** Node ids where a local change was overruled by a different remote change (or deletion). */
  conflicts: string[];
}

interface Pick<T> {
  value: T;
  conflict: boolean;
}

function pick3<T>(base: T, local: T, remote: T): Pick<T> {
  if (deepEqual(local, base)) return { value: remote, conflict: false };
  if (deepEqual(remote, base) || deepEqual(local, remote)) return { value: local, conflict: false };
  return { value: remote, conflict: true };
}

type Rec<V> = Record<string, V>;

/** Key-by-key three-way merge of two maps; a missing key means "absent". */
function mergeRecord<V>(
  base: Rec<V>,
  local: Rec<V>,
  remote: Rec<V>,
  onConflict?: (key: string) => void,
): Rec<V> {
  if (local === base) return remote;
  if (remote === base) return local;
  const out: Rec<V> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const key of keys) {
    const { value, conflict } = pick3(base[key], local[key], remote[key]);
    if (conflict) onConflict?.(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Content equality of two documents, ignoring `rev` and `meta` (which change on every save). */
export function sameContent(a: Doc, b: Doc): boolean {
  if (a === b) return true;
  return (
    a.name === b.name &&
    a.rootId === b.rootId &&
    deepEqual(a.nodes, b.nodes) &&
    deepEqual(a.tokens, b.tokens) &&
    deepEqual(a.annotations, b.annotations) &&
    deepEqual(a.references, b.references) &&
    deepEqual(a.assets, b.assets)
  );
}

/** Which node ids differ between two documents (added, removed or changed). */
export function changedNodeIds(from: Doc, to: Doc): string[] {
  if (from.nodes === to.nodes) return [];
  const ids = new Set([...Object.keys(from.nodes), ...Object.keys(to.nodes)]);
  return [...ids].filter((id) => !deepEqual(from.nodes[id], to.nodes[id]));
}

function mergeNodeProps(
  base: Node | undefined,
  local: Node,
  remote: Node,
): { node: Node; conflict: boolean } {
  const b = (base ?? {}) as unknown as Rec<unknown>;
  const l = local as unknown as Rec<unknown>;
  const r = remote as unknown as Rec<unknown>;
  const out: Rec<unknown> = {};
  let conflict = false;
  for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
    if (key === 'children') continue; // rebuilt from parentId below
    const p = pick3(b[key], l[key], r[key]);
    if (p.conflict) conflict = true;
    if (p.value !== undefined) out[key] = p.value;
  }
  out.children = remote.children;
  return { node: out as unknown as Node, conflict };
}

function mergeById<T extends { id: string }>(
  base: readonly T[],
  local: readonly T[],
  remote: readonly T[],
): T[] {
  if (local === base) return [...remote];
  if (remote === base) return [...local];
  const toMap = (list: readonly T[]): Rec<T> => Object.fromEntries(list.map((x) => [x.id, x]));
  const merged = mergeRecord(toMap(base), toMap(local), toMap(remote));
  // Remote order first, then what only exists locally.
  const order = [...remote.map((x) => x.id), ...local.map((x) => x.id)];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of order) {
    const item = merged[id];
    if (item !== undefined && !seen.has(id)) {
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}

export function mergeDocs(base: Doc, local: Doc, remote: Doc): MergeResult {
  if (sameContent(local, base)) return { doc: remote, mode: 'remote', conflicts: [] };
  if (sameContent(remote, base) || sameContent(local, remote)) {
    // Keep the local document, but make sure it can still be saved over what is on disk.
    const rev = Math.max(local.rev, remote.rev + 1);
    return { doc: rev === local.rev ? local : { ...local, rev }, mode: 'local', conflicts: [] };
  }
  if (local.rootId !== remote.rootId || local.id !== remote.id) return fallback(remote, []);

  const conflicts = new Set<string>();

  // --- nodes ----------------------------------------------------------------------------------
  const ids = new Set([
    ...Object.keys(base.nodes),
    ...Object.keys(local.nodes),
    ...Object.keys(remote.nodes),
  ]);
  const merged: Rec<Node> = {};
  for (const id of ids) {
    const b = base.nodes[id];
    const l = local.nodes[id];
    const r = remote.nodes[id];
    let m: Node | undefined;
    if (deepEqual(l, b)) m = r;
    else if (deepEqual(r, b) || deepEqual(l, r)) m = l;
    else if (l === undefined || r === undefined) {
      m = r; // one side deleted what the other changed: the remote side wins
      conflicts.add(id);
    } else {
      const res = mergeNodeProps(b, l, r);
      m = res.node;
      if (res.conflict) conflicts.add(id);
    }
    if (m !== undefined) merged[id] = m;
  }

  // --- drop orphans (their parent is gone), then rebuild each children list -----------------------
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, node] of Object.entries(merged)) {
      if (id === remote.rootId) continue;
      if (node.parentId === null || merged[node.parentId] === undefined) {
        conflicts.add(id);
        delete merged[id];
        changed = true;
      }
    }
  }
  if (merged[remote.rootId] === undefined) return fallback(remote, [...conflicts]);

  const members = new Map<string, string[]>();
  for (const [id, node] of Object.entries(merged)) {
    if (id === remote.rootId || node.parentId === null) continue;
    const list = members.get(node.parentId) ?? [];
    list.push(id);
    members.set(node.parentId, list);
  }
  const nodes: Rec<Node> = {};
  for (const [id, node] of Object.entries(merged)) {
    const mine = new Set(members.get(id) ?? []);
    const cb = base.nodes[id]?.children;
    const cl = local.nodes[id]?.children;
    const cr = remote.nodes[id]?.children;
    // Order from whichever side reordered; remote if both did; then anything not listed.
    const preferred =
      cl !== undefined && cb !== undefined && deepEqual(cl, cb)
        ? cr
        : cr !== undefined && cb !== undefined && deepEqual(cr, cb)
          ? cl
          : cr;
    const order = [...(preferred ?? []), ...(cl ?? []), ...(cr ?? []), ...mine];
    const seen = new Set<string>();
    const children: string[] = [];
    for (const c of order) {
      if (mine.has(c) && !seen.has(c)) {
        seen.add(c);
        children.push(c);
      }
    }
    nodes[id] = deepEqual(node.children, children) ? node : { ...node, children };
  }

  // Every node must reach the root by following parentId (otherwise two moves made a cycle).
  for (const id of Object.keys(nodes)) {
    let at: string | null = id;
    let hops = 0;
    while (at !== null && at !== remote.rootId) {
      at = nodes[at]?.parentId ?? null;
      if (++hops > Object.keys(nodes).length) return fallback(remote, [...conflicts]);
    }
    if (at === null) return fallback(remote, [...conflicts]);
  }

  // --- the rest of the document ----------------------------------------------------------------
  const name = pick3(base.name, local.name, remote.name).value;
  const tokens = {
    colors: mergeRecord(base.tokens.colors, local.tokens.colors, remote.tokens.colors),
    fonts: mergeRecord(base.tokens.fonts, local.tokens.fonts, remote.tokens.fonts),
    radii: mergeRecord(base.tokens.radii, local.tokens.radii, remote.tokens.radii),
    spacing: pick3(base.tokens.spacing, local.tokens.spacing, remote.tokens.spacing).value,
  };
  const doc: Doc = {
    ...remote,
    name,
    nodes,
    tokens,
    annotations: mergeById<Annotation>(base.annotations, local.annotations, remote.annotations),
    references: mergeById<Reference>(base.references, local.references, remote.references),
    assets: mergeRecord(base.assets, local.assets, remote.assets),
    rev: Math.max(local.rev, remote.rev, base.rev) + 1,
    meta: {
      ...remote.meta,
      updatedAt:
        local.meta.updatedAt > remote.meta.updatedAt ? local.meta.updatedAt : remote.meta.updatedAt,
      lastWriter: 'app',
    },
  };

  const check = validateDoc(doc);
  if (!check.ok) return fallback(remote, [...conflicts]);
  return { doc, mode: 'merged', conflicts: [...conflicts] };
}

function fallback(remote: Doc, conflicts: string[]): MergeResult {
  return { doc: remote, mode: 'remote-fallback', conflicts };
}
