import { applyChanges } from '../apply';
import { addAsset } from '../assets';
import { CoreError } from '../errors';
import { lookupId } from '../ops';
import type { Doc, NodeSpec, Op } from '../types';
import type { ImportResult } from './types';

export interface Imported {
  doc: Doc;
  /** The id of the frame that was added. */
  nodeId: string;
}

/** Replaces `ref:<name>` asset references in a spec with real asset ids, adding the assets to the doc. */
function bindAssets(doc: Doc, result: ImportResult, spec: NodeSpec): { doc: Doc; spec: NodeSpec } {
  const ids = new Map<string, string>();
  let next = doc;
  for (const asset of result.assets) {
    const added = addAsset(next, asset.bytes);
    next = added.doc;
    ids.set(asset.ref, added.assetId);
  }
  const walk = (s: NodeSpec): NodeSpec => {
    const out: NodeSpec = { ...s };
    if (typeof s.assetId === 'string' && s.assetId.startsWith('ref:')) {
      const id = ids.get(s.assetId.slice(4));
      if (id === undefined) {
        delete out.assetId;
        out.type = 'rect';
        out.fill = '#e5e5e5';
      } else out.assetId = id;
    }
    if (s.children) out.children = s.children.map(walk);
    return out;
  };
  return { doc: next, spec: walk(spec) };
}

/** Puts an import into a document as one undoable batch (the caller commits the returned doc). */
export function applyImport(
  doc: Doc,
  result: ImportResult,
  options: { parentId?: string; x?: number; y?: number } = {},
): Imported {
  if (result.spec === null) {
    throw new CoreError('INVALID_VALUE', 'Nothing in that file could be imported.');
  }
  const parentId =
    options.parentId === undefined ? doc.rootId : lookupId(doc.nodes, options.parentId);
  const { doc: withAssets, spec } = bindAssets(doc, result, result.spec);
  const placed: NodeSpec = {
    ...spec,
    ...(parentId === doc.rootId && options.x !== undefined ? { x: options.x } : {}),
    ...(parentId === doc.rootId && options.y !== undefined ? { y: options.y } : {}),
  };
  const ops: Op[] = [{ op: 'create', parentId, node: placed }];
  const applied = applyChanges(withAssets, ops);
  if (!applied.ok) {
    throw new CoreError(
      'INVALID_VALUE',
      `The import could not be placed: ${applied.errors[0]?.message ?? 'unknown error'}`,
    );
  }
  const nodeId = applied.created[0];
  if (nodeId === undefined) throw new CoreError('INTERNAL', 'The import created nothing.');
  return { doc: applied.doc, nodeId };
}
