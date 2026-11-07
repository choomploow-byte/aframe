import { CoreError } from './errors';
import type { Doc, Node, NodeType } from './types';

/**
 * Compact, LLM-readable view of the document for `get_design` (docs/05): breadth-first so the
 * top levels always survive a node cap, with explicit markers where anything was cut.
 */
export type OutlineDetail = 'outline' | 'full';

export interface OutlineOptions {
  /** Start here instead of at the page. */
  nodeId?: string;
  /** Levels of descendants to show below the start node (default 4, max 32). */
  depth?: number;
  detail?: OutlineDetail;
  /** Hard cap on nodes shown (default 500 for outline, 200 for full). */
  maxNodes?: number;
}

export type OutlineNode = { id: string; type: NodeType; name: string } & Record<string, unknown> & {
    children?: OutlineNode[];
    /** Children not shown because the depth limit was reached. */
    childCount?: number;
    /** Children not shown because the node cap was reached. */
    moreChildren?: number;
  };

export interface Outline {
  rev: number;
  docId: string;
  name: string;
  root: OutlineNode;
  counts: {
    nodes: number;
    byType: Partial<Record<NodeType, number>>;
    openAnnotations: number;
    references: number;
  };
  /** Token names only; `get_tokens` has the values. */
  tokens: { colors: string[]; fonts: string[]; radii: string[]; spacing: number[] };
  shownNodes: number;
  truncated: boolean;
}

const DEFAULT_DEPTH = 4;
const MAX_DEPTH = 32;
const TEXT_SNIPPET = 80;

function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > TEXT_SNIPPET ? `${oneLine.slice(0, TEXT_SNIPPET)}…` : oneLine;
}

function setIf(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) out[key] = value;
}

function outlineOf(node: Node, parent: Node | undefined): OutlineNode {
  const out: Record<string, unknown> = { id: node.id, type: node.type, name: node.name };
  // x,y only mean something where the parent positions children absolutely.
  const inFlow =
    parent?.type === 'frame' && (parent.layout === 'row' || parent.layout === 'column');
  const absolute = !inFlow;
  if (node.type !== 'page') {
    if (absolute) {
      out.x = node.x;
      out.y = node.y;
    }
    out.w = node.w;
    out.h = node.h;
  }
  if (node.type === 'frame' && node.layout && node.layout !== 'none') {
    out.layout = node.layout;
    if (node.gap) out.gap = node.gap;
    if (node.padding?.some((p) => p !== 0)) out.padding = node.padding;
    if (node.align && node.align !== 'start') out.align = node.align;
    if (node.justify && node.justify !== 'start') out.justify = node.justify;
    if (node.wrap) out.wrap = true;
  }
  if (node.type === 'frame' && node.clip) out.clip = true;
  setIf(out, 'fill', node.fill);
  setIf(out, 'stroke', node.stroke);
  setIf(out, 'radius', node.radius);
  if (node.shadow && node.shadow.length > 0) out.shadows = node.shadow.length;
  if (node.type === 'text') {
    setIf(out, 'text', node.text === undefined ? undefined : snippet(node.text));
    setIf(out, 'fontFamily', node.fontFamily);
    setIf(out, 'fontSize', node.fontSize);
    setIf(out, 'fontWeight', node.fontWeight);
    setIf(out, 'color', node.color);
  }
  if (node.type === 'image') setIf(out, 'assetId', node.assetId);
  if (node.type === 'icon') {
    setIf(out, 'icon', node.icon);
    setIf(out, 'color', node.color);
  }
  if (node.effects && node.effects.length > 0) out.effects = node.effects;
  if (node.component) {
    out.component = {
      kind: node.component.kind,
      states: Object.keys(node.component.states ?? {}),
    };
  }
  if (node.instanceOf !== undefined) {
    out.instanceOf = node.instanceOf;
    if (node.state !== undefined && node.state !== 'default') out.state = node.state;
    const overridden = Object.keys(node.overrides ?? {}).length;
    if (overridden > 0) out.overrides = overridden;
  }
  // A layer inside an instance is derived from its master: say so, so an agent edits the right thing.
  if (node.from !== undefined) out.from = node.from;
  setIf(out, 'role', node.role);
  if (node.opacity !== 1) out.opacity = node.opacity;
  if (!node.visible) out.visible = false;
  if (node.locked) out.locked = true;
  return out as OutlineNode;
}

function fullOf(node: Node): OutlineNode {
  // Everything on the node; `children` is replaced by nested nodes or a count, and `parentId`
  // is implied by the nesting.
  const out: Record<string, unknown> = { ...node };
  delete out.children;
  delete out.parentId;
  return out as OutlineNode;
}

export function getOutline(doc: Doc, options: OutlineOptions = {}): Outline {
  const detail = options.detail ?? 'outline';
  const depth = Math.min(Math.max(Math.trunc(options.depth ?? DEFAULT_DEPTH), 0), MAX_DEPTH);
  const maxNodes = Math.max(1, options.maxNodes ?? (detail === 'full' ? 200 : 500));
  const startId = options.nodeId ?? doc.rootId;
  const start = doc.nodes[startId];
  if (!start) {
    throw new CoreError(
      'NOT_FOUND',
      `Node ${startId} does not exist.`,
      'Call get_design without nodeId to see the top level.',
    );
  }

  const make = (node: Node, parent: Node | undefined): OutlineNode =>
    detail === 'full' ? fullOf(node) : outlineOf(node, parent);

  const root = make(start, start.parentId ? doc.nodes[start.parentId] : undefined);
  const queue: { node: Node; out: OutlineNode; level: number }[] = [
    { node: start, out: root, level: 0 },
  ];
  let shown = 1;
  let truncated = false;

  for (let head = 0; head < queue.length; head += 1) {
    const { node, out, level } = queue[head] as (typeof queue)[number];
    if (node.children.length === 0) continue;
    if (level >= depth) {
      out.childCount = node.children.length;
      truncated = true;
      continue;
    }
    out.children = [];
    for (const [i, childId] of node.children.entries()) {
      const child = doc.nodes[childId];
      if (!child) continue;
      if (shown >= maxNodes) {
        out.moreChildren = node.children.length - i;
        truncated = true;
        break;
      }
      const childOut = make(child, node);
      out.children.push(childOut);
      queue.push({ node: child, out: childOut, level: level + 1 });
      shown += 1;
    }
  }

  const byType: Partial<Record<NodeType, number>> = {};
  const all = Object.values(doc.nodes);
  for (const n of all) byType[n.type] = (byType[n.type] ?? 0) + 1;

  return {
    rev: doc.rev,
    docId: doc.id,
    name: doc.name,
    root,
    counts: {
      nodes: all.length,
      byType,
      openAnnotations: doc.annotations.filter((a) => a.status === 'open').length,
      references: doc.references.length,
    },
    tokens: {
      colors: Object.keys(doc.tokens.colors),
      fonts: Object.keys(doc.tokens.fonts),
      radii: Object.keys(doc.tokens.radii),
      spacing: doc.tokens.spacing,
    },
    shownNodes: shown,
    truncated,
  };
}
