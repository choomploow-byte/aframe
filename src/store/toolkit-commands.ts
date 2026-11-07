import { instanceRootOf, masterRootOf } from '@core/components';
import type { ComponentKind, Doc, Node, NodeSpec } from '@core/types';
import { round2, type Point } from '../canvas/geometry';
import type { Store } from './commands';

/**
 * Commands for the icon and component panels: insert an icon or an instance, make a frame a
 * component, detach an instance. Each is ONE undoable step, built from core ops.
 */

const isFlex = (n: Node | undefined): boolean =>
  n?.type === 'frame' && (n.layout === 'row' || n.layout === 'column');

/** Nothing can be added inside a component or one of its instances: those take the page instead. */
const insideComponent = (doc: Doc, n: Node): boolean =>
  instanceRootOf(doc.nodes, n) !== null || masterRootOf(doc.nodes, n) !== null;

/** A selected frame, else the parent of what is selected, else the page; never inside a component. */
function insertionParent(doc: Doc, selection: readonly string[]): Node {
  const page = doc.nodes[doc.rootId] as Node;
  const first = selection[0] ? doc.nodes[selection[0]] : undefined;
  const candidates: (Node | undefined)[] = [
    first?.type === 'frame' ? first : undefined,
    first?.parentId ? doc.nodes[first.parentId] : undefined,
  ];
  for (const c of candidates) {
    if (c && (c.type === 'frame' || c.type === 'page') && !insideComponent(doc, c)) return c;
  }
  return page;
}

function insert(store: Store, spec: NodeSpec, label: string, center: Point | null): boolean {
  const s = store.getState();
  const parent = insertionParent(s.doc, s.selection);
  const node: NodeSpec = { ...spec, tempId: 'inserted' };
  // x/y only mean something where the parent places children by hand; in auto-layout they are ignored.
  if (!isFlex(parent) && center) {
    const onPage = parent.type === 'page';
    node.x = round2(onPage ? center.x - (typeof spec.w === 'number' ? spec.w : 0) / 2 : 16);
    node.y = round2(onPage ? center.y - (typeof spec.h === 'number' ? spec.h : 0) / 2 : 16);
  }
  return s.dispatch([{ op: 'create', parentId: parent.id, node }], {
    label,
    select: (r) => [r.idMap.inserted as string],
  }).ok;
}

export function insertIcon(store: Store, name: string, center: Point | null): boolean {
  return insert(
    store,
    { type: 'icon', icon: name, w: 32, h: 32, color: '$text', name: `Icon ${name}` },
    `Add icon ${name}`,
    center,
  );
}

export function insertInstance(store: Store, masterId: string, center: Point | null): boolean {
  const master = store.getState().doc.nodes[masterId];
  if (master?.component === undefined) return false;
  return insert(
    store,
    { type: 'frame', name: master.name, instanceOf: masterId },
    `Add ${master.name}`,
    center,
  );
}

/** Makes the selected frame a master component. */
export function makeComponent(store: Store, id: string, kind: ComponentKind): boolean {
  const s = store.getState();
  return s.dispatch([{ op: 'update', id, set: { component: { kind } } }], {
    label: 'Create component',
  }).ok;
}

/** Turns an instance back into ordinary frames. */
export function detachInstanceCommand(store: Store, id: string): boolean {
  return store
    .getState()
    .dispatch([{ op: 'update', id, set: { instanceOf: null } }], { label: 'Detach instance' }).ok;
}

/** Stops a frame being a master; its instances become ordinary frames. */
export function removeComponent(store: Store, id: string): boolean {
  return store
    .getState()
    .dispatch([{ op: 'update', id, set: { component: null } }], { label: 'Remove component' }).ok;
}
