/**
 * The operations behind `define_component`, `create_instance` and `component_list`: whole-document
 * functions built on the same draft the editing ops use, so they are atomic, validated and
 * follow the same rules (instances sync; a master may hold instances of other masters).
 */
import { descendantsOf, instancesOf, resolveLayerKey, SELF } from './components';
import { CoreError } from './errors';
import type { Rng } from './ids';
import { beginDraft, draftCreate, draftUpdate, finishDraft, lookupId } from './ops';
import { propsFor } from './props';
import { propIssues } from './validate';
import type { ComponentKind, ComponentState, Doc, LayerPatches, Node, Warning } from './types';

export const NON_DEFAULT_STATES = ['hover', 'pressed', 'disabled', 'selected'] as const;
export type NonDefaultState = (typeof NON_DEFAULT_STATES)[number];

/** Properties worth changing per layer, by layer type, for `component_list`. */
function editableProps(type: Node['type']): string[] {
  switch (type) {
    case 'text':
      return ['text', 'color', 'fontSize', 'fontWeight', 'visible'];
    case 'icon':
      return ['icon', 'color', 'w', 'h', 'visible'];
    case 'image':
      return ['assetId', 'fit', 'visible'];
    case 'frame':
      return ['fill', 'stroke', 'effects', 'opacity', 'visible'];
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'page':
      return ['fill', 'stroke', 'opacity', 'visible'];
  }
}

export interface ComponentSummary {
  id: string;
  name: string;
  kind: ComponentKind;
  w: Node['w'];
  h: Node['h'];
  /** The states with their own look besides default. */
  states: string[];
  layers: { id: string; name: string; type: Node['type']; editable: string[] }[];
  instances: { id: string; name: string; state: ComponentState; parentId: string | null }[];
}

export function listComponents(doc: Doc, kind?: ComponentKind): ComponentSummary[] {
  const out: ComponentSummary[] = [];
  for (const node of Object.values(doc.nodes)) {
    if (node.component === undefined) continue;
    if (kind !== undefined && node.component.kind !== kind) continue;
    out.push({
      id: node.id,
      name: node.name,
      kind: node.component.kind,
      w: node.w,
      h: node.h,
      states: Object.entries(node.component.states ?? {})
        .filter(([, patches]) => patches !== undefined && Object.keys(patches).length > 0)
        .map(([state]) => state),
      layers: descendantsOf(doc.nodes, node.id).map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        editable: editableProps(l.type),
      })),
      instances: instancesOf(doc.nodes, node.id).map((i) => ({
        id: i.id,
        name: i.name,
        state: i.state ?? 'default',
        parentId: i.parentId,
      })),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Finds a master by id (with or without `n_`) or by an exact, unique name. */
export function findMaster(doc: Doc, ref: string): Node {
  const byId = doc.nodes[lookupId(doc.nodes, ref)];
  if (byId?.component !== undefined) return byId;
  const named = Object.values(doc.nodes).filter((n) => n.component !== undefined && n.name === ref);
  if (named.length === 1 && named[0]) return named[0];
  const masters = listComponents(doc).map((c) => `"${c.name}" (${c.id})`);
  throw new CoreError(
    'NOT_FOUND',
    named.length > 1
      ? `Several components are named "${ref}".`
      : `"${ref}" is not a master component.`,
    named.length > 1
      ? `Use an id: ${named.map((n) => n.id).join(', ')}.`
      : masters.length > 0
        ? `Components: ${masters.join(', ')}. Make a new one with define_component.`
        : 'This design has no components yet; make one with define_component.',
  );
}

function resolvePatches(
  nodes: Doc['nodes'],
  masterId: string,
  doc: Doc,
  input: Record<string, Record<string, unknown>>,
  where: string,
): LayerPatches {
  const out: LayerPatches = {};
  for (const [key, patch] of Object.entries(input)) {
    const layerId = resolveLayerKey(nodes, masterId, key);
    const layer = nodes[layerId === SELF ? masterId : layerId];
    if (!layer) continue;
    const issues = propIssues(patch, layer.type, {
      allowNull: true,
      path: `${where}.${key}`,
      tokens: doc.tokens,
    });
    const first = issues[0];
    if (first) {
      throw new CoreError(first.code, first.message, first.hint, first.path);
    }
    const bad = Object.keys(patch).find((k) => !propsFor(layer.type).includes(k));
    if (bad !== undefined) {
      throw new CoreError('INVALID_VALUE', `'${bad}' does not apply to layer "${layer.name}".`);
    }
    out[layerId] = { ...(out[layerId] ?? {}), ...patch };
  }
  return out;
}

export interface DefineComponentInput {
  nodeId: string;
  kind?: ComponentKind;
  name?: string;
  /** State -> layer (id, name or $self) -> property changes. `null` removes a state. */
  states?: Partial<Record<NonDefaultState, Record<string, Record<string, unknown>> | null>>;
}

export function defineComponent(
  doc: Doc,
  input: DefineComponentInput,
  rng?: Rng,
): { doc: Doc; componentId: string; warnings: Warning[] } {
  const d = beginDraft(doc, rng);
  const id = lookupId(d.nodes, input.nodeId);
  const node = d.nodes[id];
  if (!node) {
    throw new CoreError(
      'NOT_FOUND',
      `Node ${input.nodeId} does not exist.`,
      'Call get_design for ids.',
    );
  }
  if (node.type !== 'frame') {
    throw new CoreError(
      'INVALID_VALUE',
      `${id} is a ${node.type}; only a frame can become a component.`,
      'Wrap it in a frame first.',
    );
  }
  const existing = node.component;
  const kind: ComponentKind =
    input.kind ??
    existing?.kind ??
    (node.role === 'button' ? 'button' : node.role === 'card' ? 'card' : 'custom');

  const states: Record<string, LayerPatches> = {};
  for (const [state, patches] of Object.entries(existing?.states ?? {})) {
    if (patches) states[state] = patches;
  }
  for (const [state, patches] of Object.entries(input.states ?? {})) {
    if (patches === null) {
      delete states[state];
      continue;
    }
    if (patches === undefined) continue;
    const resolved = resolvePatches(d.nodes, id, doc, patches, `states.${state}`);
    const merged: LayerPatches = { ...(states[state] ?? {}) };
    for (const [layer, patch] of Object.entries(resolved)) {
      merged[layer] = { ...(merged[layer] ?? {}), ...patch };
    }
    states[state] = merged;
  }
  const component = {
    kind,
    ...(Object.keys(states).length > 0 ? { states } : {}),
  };
  draftUpdate(d, id, { component, ...(input.name === undefined ? {} : { name: input.name }) });
  return { doc: finishDraft(d), componentId: id, warnings: d.warnings };
}

export interface CreateInstanceInput {
  /** A master's id or name. */
  component: string;
  parentId?: string;
  x?: number;
  y?: number;
  name?: string;
  state?: ComponentState;
  /** Layer (id, name or $self) -> property changes for this instance only. */
  overrides?: Record<string, Record<string, unknown>>;
}

export function createInstance(
  doc: Doc,
  input: CreateInstanceInput,
  rng?: Rng,
): {
  doc: Doc;
  instanceId: string;
  created: string[];
  layers: Record<string, string>;
  warnings: Warning[];
} {
  const master = findMaster(doc, input.component);
  const d = beginDraft(doc, rng);
  const parentId = input.parentId === undefined ? doc.rootId : lookupId(d.nodes, input.parentId);
  const overrides =
    input.overrides === undefined
      ? undefined
      : resolvePatches(d.nodes, master.id, doc, input.overrides, 'overrides');
  const onPage = parentId === doc.rootId;
  // By default an instance on the page lands beside its master, not on top of it.
  const gap = 40;
  const x =
    input.x ?? (onPage ? master.x + (typeof master.w === 'number' ? master.w : 200) + gap : 0);
  const y = input.y ?? (onPage ? master.y : 0);
  const rootId = draftCreate(d, parentId, {
    type: 'frame',
    name: input.name ?? master.name,
    x,
    y,
    instanceOf: master.id,
    ...(input.state === undefined || input.state === 'default' ? {} : { state: input.state }),
    ...(overrides === undefined || Object.keys(overrides).length === 0 ? {} : { overrides }),
  });
  const next = finishDraft(d);
  const layers: Record<string, string> = {};
  for (const layer of descendantsOf(next.nodes, rootId)) {
    layers[layer.name in layers ? `${layer.name} (${layer.id})` : layer.name] = layer.id;
  }
  const created = [rootId, ...descendantsOf(next.nodes, rootId).map((l) => l.id)];
  return { doc: next, instanceId: rootId, created, layers, warnings: d.warnings };
}
