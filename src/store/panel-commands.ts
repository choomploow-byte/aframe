import { addAsset, assetInfo, imageNodeSpec, type ImageInfo } from '@core/assets';
import { toOpError } from '@core/errors';
import { propsFor } from '@core/props';
import type { Doc, Node, NodePatch, NodeSpec, Op } from '@core/types';
import { round2, type Point } from '../canvas/geometry';
import { type Env, type Store } from './commands';

/** Commands used by the panels (Layers, Properties, Assets). Like `commands.ts`: one undo step each. */

/**
 * Sets properties on every selected node that supports them, so a multi-selection of a frame and
 * a text can change `fill` together without the text rejecting `layout`. Rapid edits with the same
 * `key` (scrubbing a number) merge into one undo step.
 */
export function updateProps(
  store: Store,
  ids: readonly string[],
  patch: NodePatch,
  options: { label?: string; key?: string } = {},
): boolean {
  const s = store.getState();
  const ops: Op[] = [];
  for (const id of ids) {
    const node = s.doc.nodes[id];
    if (!node || id === s.doc.rootId) continue;
    const allowed = propsFor(node.type);
    const set = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    if (Object.keys(set).length > 0) ops.push({ op: 'update', id, set: set });
  }
  if (ops.length === 0) return false;
  const dispatchOptions: { label: string; key?: string } = {
    label: options.label ?? 'Edit properties',
  };
  if (options.key !== undefined) dispatchOptions.key = options.key;
  return s.dispatch(ops, dispatchOptions).ok;
}

/**
 * Like `updateProps`, but the patch can differ per node (switching width mode to "fixed" uses each
 * node's own rendered size). Return null from `patchFor` to leave a node alone.
 */
export function updatePropsEach(
  store: Store,
  ids: readonly string[],
  patchFor: (node: Node) => NodePatch | null,
  options: { label?: string; key?: string } = {},
): boolean {
  const s = store.getState();
  const ops: Op[] = [];
  for (const id of ids) {
    const node = s.doc.nodes[id];
    if (!node || id === s.doc.rootId) continue;
    const patch = patchFor(node);
    if (!patch) continue;
    const allowed = propsFor(node.type);
    const set = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    if (Object.keys(set).length > 0) ops.push({ op: 'update', id, set: set });
  }
  if (ops.length === 0) return false;
  const dispatchOptions: { label: string; key?: string } = {
    label: options.label ?? 'Edit properties',
  };
  if (options.key !== undefined) dispatchOptions.key = options.key;
  return s.dispatch(ops, dispatchOptions).ok;
}

export function renameLayer(store: Store, id: string, name: string): boolean {
  const trimmed = name.trim();
  const node = store.getState().doc.nodes[id];
  if (!node || trimmed === '' || trimmed === node.name) return false;
  return store.getState().dispatch([{ op: 'update', id, set: { name: trimmed.slice(0, 200) } }], {
    label: 'Rename layer',
  }).ok;
}

/** Hide/show or lock/unlock layers. Hiding a selection hides all of it; mixed states become "on". */
export function setLayerFlag(
  store: Store,
  ids: readonly string[],
  flag: 'visible' | 'locked',
  value: boolean,
): boolean {
  const label = flag === 'visible' ? (value ? 'Show' : 'Hide') : value ? 'Lock' : 'Unlock';
  return updateProps(store, ids, { [flag]: value }, { label });
}

export function toggleLayerFlag(store: Store, id: string, flag: 'visible' | 'locked'): boolean {
  const node = store.getState().doc.nodes[id];
  if (!node) return false;
  return setLayerFlag(store, [id], flag, !node[flag]);
}

export function renameProject(store: Store, name: string): boolean {
  const trimmed = name.trim().slice(0, 120);
  if (trimmed === '' || trimmed === store.getState().doc.name) return false;
  return store.getState().edit((doc) => ({ ...doc, name: trimmed }), 'Rename project').ok;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface ImageSource {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export type ImportOutcome =
  | { ok: true; name: string; assetId: string; nodeId?: string }
  | { ok: false; name: string; message: string; hint?: string };

/** Where an inserted image goes: into the selected frame, else next to the selection, else the page. */
function insertionParent(doc: Doc, selection: readonly string[]): Node {
  const first = selection[0] ? doc.nodes[selection[0]] : undefined;
  if (first?.type === 'frame') return first;
  const parent = first?.parentId ? doc.nodes[first.parentId] : undefined;
  return parent ?? (doc.nodes[doc.rootId] as Node);
}

function isFlex(node: Node): boolean {
  return node.type === 'frame' && (node.layout === 'row' || node.layout === 'column');
}

/** Places an already stored asset on the canvas as an image layer and selects it. */
export function insertAsset(env: Env, assetId: string, at?: Point): string | null {
  const { store, measure } = env;
  const s = store.getState();
  const info: ImageInfo | null = assetInfo(s.doc, assetId);
  if (!info) return null;
  const parent = insertionParent(s.doc, s.selection);
  const spec: NodeSpec = imageNodeSpec(assetId, info);
  if (!isFlex(parent)) {
    const origin = parent.type === 'page' ? { x: 0, y: 0 } : (measure(parent.id) ?? { x: 0, y: 0 });
    const w = typeof spec.w === 'number' ? spec.w : 0;
    const h = typeof spec.h === 'number' ? spec.h : 0;
    const centre = at ?? { x: origin.x + 120 + w / 2, y: origin.y + 120 + h / 2 };
    spec.x = round2(centre.x - w / 2 - origin.x);
    spec.y = round2(centre.y - h / 2 - origin.y);
  }
  const res = s.dispatch([{ op: 'create', parentId: parent.id, node: spec }], {
    label: 'Add image',
    select: (r) => [r.idMap.img as string],
  });
  return res.ok ? (store.getState().selection[0] ?? null) : null;
}

/**
 * Imports image files (picker, drop or paste): validated by their bytes and size, stored in the
 * document, and, if `insert`, placed on the canvas. Each file is one undo step. Failures come back
 * per file, never as an exception, so one bad file does not stop the others.
 */
export async function importImages(
  env: Env,
  files: readonly ImageSource[],
  options: { insert: boolean; at?: Point },
): Promise<ImportOutcome[]> {
  const { store } = env;
  const outcomes: ImportOutcome[] = [];
  let offset = 0;
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let assetId = '';
      store.getState().beginTransaction('Add image');
      try {
        const added = store.getState().edit((doc) => {
          const res = addAsset(doc, bytes);
          assetId = res.assetId;
          return res.doc;
        }, 'Add image');
        if (!added.ok) {
          store.getState().cancelTransaction();
          outcomes.push({
            ok: false,
            name: file.name,
            message: added.error.message,
            ...(added.error.hint ? { hint: added.error.hint } : {}),
          });
          continue;
        }
        let nodeId: string | undefined;
        if (options.insert) {
          const at = options.at
            ? { x: options.at.x + offset, y: options.at.y + offset }
            : undefined;
          nodeId = insertAsset(env, assetId, at) ?? undefined;
          offset += 24;
        }
        store.getState().endTransaction();
        outcomes.push({ ok: true, name: file.name, assetId, ...(nodeId ? { nodeId } : {}) });
      } catch (err) {
        store.getState().cancelTransaction();
        throw err;
      }
    } catch (err) {
      const e = toOpError(err);
      outcomes.push({
        ok: false,
        name: file.name,
        message: e.message,
        ...(e.hint ? { hint: e.hint } : {}),
      });
    }
  }
  return outcomes;
}
