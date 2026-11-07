import { isEffectivelyLocked } from '@core/tree';
import { propsFor } from '@core/props';
import type { Doc, Node, NodePatch, NodePropKey, Tokens } from '@core/types';
import type { Rect } from '../canvas/geometry';
import { store } from '../store/store';
import { updateProps, updatePropsEach } from '../store/panel-commands';
import { commonValue } from './mixed';

/**
 * What every Properties section needs, computed once per render from the selection: the nodes, how
 * their values compare (shared or "Mixed"), and functions that write back as one undo step.
 */
export interface PropCtx {
  nodes: Node[];
  ids: string[];
  single: Node | null;
  tokens: Tokens;
  doc: Doc;
  /** Every selected node is locked: fields are shown but disabled. */
  locked: boolean;
  /** Every selected node sits inside an auto-layout frame, so x/y are controlled by the layout. */
  allInFlow: boolean;
  get: <K extends NodePropKey>(
    key: K,
  ) => { applicable: boolean; mixed: boolean; value: Node[K] | undefined };
  set: (patch: NodePatch, label: string, key?: string) => void;
  setEach: (fn: (n: Node) => NodePatch | null, label: string, key?: string) => void;
  measure: (id: string) => Rect | null;
}

export function buildPropCtx(
  doc: Doc,
  selection: readonly string[],
  measure: (id: string) => Rect | null,
): PropCtx | null {
  const nodes = selection
    .map((id) => doc.nodes[id])
    .filter((n): n is Node => n !== undefined && n.id !== doc.rootId);
  if (nodes.length === 0) return null;
  const ids = nodes.map((n) => n.id);
  const isFlexChild = (n: Node): boolean => {
    const p = n.parentId ? doc.nodes[n.parentId] : undefined;
    return p?.type === 'frame' && (p.layout === 'row' || p.layout === 'column');
  };
  const options = (label: string, key?: string): { label: string; key?: string } =>
    key === undefined ? { label } : { label, key };
  return {
    nodes,
    ids,
    single: nodes.length === 1 ? (nodes[0] as Node) : null,
    tokens: doc.tokens,
    doc,
    locked: nodes.every((n) => isEffectivelyLocked(doc.nodes, n.id)),
    allInFlow: nodes.every(isFlexChild),
    get: (key) => {
      const applicable = nodes.filter((n) => propsFor(n.type).includes(key));
      const common = commonValue(applicable.map((n) => n[key]));
      return { applicable: applicable.length > 0, mixed: common.mixed, value: common.value };
    },
    set: (patch, label, key) => void updateProps(store, ids, patch, options(label, key)),
    setEach: (fn, label, key) => void updatePropsEach(store, ids, fn, options(label, key)),
    measure,
  };
}
