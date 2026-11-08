import { innerMasterOf, type PreviewOverlay } from '@core/components';
import { lookupId } from '@core/ops';
import type { ComponentState, Doc, Node } from '@core/types';

/**
 * The rules of the interactive preview, kept apart from the screen so they can be tested: which
 * thing under the pointer is a "unit" that reacts (an instance of a component, or a component
 * nested in a card), what state it shows, which tab is selected, and where a link goes.
 */
export interface Unit {
  id: string;
  /** 'instance' is a placed component; 'inner' is a component nested inside another one. */
  kind: 'instance' | 'inner';
  /** The master whose states it shows. */
  masterId: string;
  /** What kind of control the master says it is (button, tab, slot, card...). */
  controlKind: string;
}

/** The innermost reacting thing at or above a layer, or null. Disabled instances do not react. */
export function unitAt(doc: Doc, nodeId: string): Unit | null {
  let cur: Node | undefined = doc.nodes[nodeId];
  while (cur) {
    if (cur.instanceOf !== undefined) {
      const master = doc.nodes[cur.instanceOf];
      if (master?.component === undefined || cur.state === 'disabled') return null;
      return {
        id: cur.id,
        kind: 'instance',
        masterId: master.id,
        controlKind: master.component.kind,
      };
    }
    const inner = innerMasterOf(doc.nodes, cur);
    if (inner?.component) {
      return { id: cur.id, kind: 'inner', masterId: inner.id, controlKind: inner.component.kind };
    }
    cur = cur.parentId === null ? undefined : doc.nodes[cur.parentId];
  }
  return null;
}

/** Tabs and slots are chosen one at a time among the siblings made from the same component. */
export const isChoice = (u: Unit): boolean => u.controlKind === 'tab' || u.controlKind === 'slot';

/** The key that groups siblings in one choice: same parent, same component. */
export const groupKey = (doc: Doc, u: Unit): string =>
  `${doc.nodes[u.id]?.parentId ?? ''}|${u.masterId}`;

export interface PreviewInput {
  hover: string | null;
  pressed: string | null;
  /** The person's picks: group key -> the chosen unit. */
  choice: Readonly<Record<string, string>>;
  /** Layers shown or hidden by following links. */
  shown: Readonly<Record<string, boolean>>;
}

/** Whether a unit is selected: the person's pick in its group, else what the design says. */
export function isSelected(doc: Doc, u: Unit, choice: Readonly<Record<string, string>>): boolean {
  const picked = choice[groupKey(doc, u)];
  if (picked !== undefined) return picked === u.id;
  return u.kind === 'instance' && doc.nodes[u.id]?.state === 'selected';
}

/** The overlay for the document given where the pointer is and what has been picked. */
export function overlayFor(doc: Doc, input: PreviewInput): PreviewOverlay {
  const states: Record<string, ComponentState> = {};
  const inner: Record<string, ComponentState> = {};
  const put = (u: Unit | null, state: ComponentState): void => {
    if (!u) return;
    (u.kind === 'instance' ? states : inner)[u.id] = state;
  };
  // Choices first (a chosen tab stays selected), then hover, then press: the latest wins.
  const groups = new Map<string, Unit[]>();
  for (const id of Object.keys(doc.nodes)) {
    const u = unitAt(doc, id);
    if (u && u.id === id && isChoice(u)) {
      const list = groups.get(groupKey(doc, u)) ?? [];
      list.push(u);
      groups.set(groupKey(doc, u), list);
    }
  }
  for (const list of groups.values()) {
    for (const u of list) if (isSelected(doc, u, input.choice)) put(u, 'selected');
  }
  if (input.hover !== null) {
    const u = unitAt(doc, input.hover);
    if (u && !(isChoice(u) && isSelected(doc, u, input.choice))) put(u, 'hover');
  }
  if (input.pressed !== null) put(unitAt(doc, input.pressed), 'pressed');
  return { states, inner, visible: input.shown };
}

export type LinkResult =
  | { kind: 'frame'; frameId: string }
  | { kind: 'show'; shown: Record<string, boolean> }
  | { kind: 'missing'; target: string }
  | null;

/** The nearest `#link` at or above a layer, as the text after the #. */
export function linkAt(doc: Doc, nodeId: string): string | null {
  let cur: Node | undefined = doc.nodes[nodeId];
  while (cur) {
    if (typeof cur.href === 'string' && cur.href.startsWith('#') && cur.href.length > 1) {
      try {
        return decodeURIComponent(cur.href.slice(1));
      } catch {
        return cur.href.slice(1);
      }
    }
    cur = cur.parentId === null ? undefined : doc.nodes[cur.parentId];
  }
  return null;
}

/** A layer by id or by name (case-insensitive), preferring a top-level frame when names repeat. */
export function findTarget(doc: Doc, ref: string): Node | null {
  const byId = doc.nodes[lookupId(doc.nodes, ref)];
  if (byId && byId.id !== doc.rootId) return byId;
  const wanted = ref.trim().toLowerCase();
  const named = Object.values(doc.nodes).filter(
    (n) => n.id !== doc.rootId && n.name.trim().toLowerCase() === wanted,
  );
  return named.find((n) => n.parentId === doc.rootId) ?? named[0] ?? null;
}

/**
 * What following a link does. A top-level frame is navigated to. A layer inside the frame on show
 * is revealed, and its siblings that other links point at are hidden: that is how a tab shows its
 * panel and hides the others.
 */
export function followLink(doc: Doc, ref: string): LinkResult {
  const target = findTarget(doc, ref);
  if (!target) return { kind: 'missing', target: ref };
  if (target.parentId === doc.rootId) return { kind: 'frame', frameId: target.id };
  const linked = new Set<string>();
  for (const n of Object.values(doc.nodes)) {
    if (typeof n.href === 'string' && n.href.startsWith('#') && n.href.length > 1) {
      const t = findTarget(doc, linkText(n.href));
      if (t) linked.add(t.id);
    }
  }
  const parent = target.parentId === null ? undefined : doc.nodes[target.parentId];
  const shown: Record<string, boolean> = { [target.id]: true };
  for (const sibling of parent?.children ?? []) {
    if (sibling !== target.id && linked.has(sibling)) shown[sibling] = false;
  }
  return { kind: 'show', shown };
}

function linkText(href: string): string {
  try {
    return decodeURIComponent(href.slice(1));
  } catch {
    return href.slice(1);
  }
}
