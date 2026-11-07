import { DEFAULT_TOKENS } from './tokens';
import type { Doc, Node, NodeType, Tokens } from './types';
import { SCHEMA_VERSION } from './types';

/** A node as it may arrive from a tool or a file: only `id` and `type` are required. */
export type LooseNode = Partial<Node> & { id: string; type: NodeType };

const TYPE_LABEL: Record<NodeType, string> = {
  page: 'Page',
  frame: 'Frame',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  text: 'Text',
  image: 'Image',
  icon: 'Icon',
};

const NAME_SNIPPET = 30;

/** The name a node gets when none is given; text nodes are named after their content. */
export function deriveName(type: NodeType, text: string | undefined, icon?: string): string {
  if (type === 'icon' && icon) return `Icon ${icon}`;
  if (type === 'text' && text) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine)
      return oneLine.length > NAME_SNIPPET ? `${oneLine.slice(0, NAME_SNIPPET)}…` : oneLine;
  }
  return TYPE_LABEL[type];
}

function defaultSize(type: NodeType, layout: Node['layout']): Pick<Node, 'w' | 'h'> {
  switch (type) {
    case 'page':
      return { w: 0, h: 0 };
    case 'text':
      return { w: 'hug', h: 'hug' };
    case 'frame':
      return layout === 'row' || layout === 'column' ? { w: 'hug', h: 'hug' } : { w: 100, h: 100 };
    case 'line':
      return { w: 100, h: 1 };
    case 'icon':
      return { w: 24, h: 24 };
    case 'rect':
    case 'ellipse':
    case 'image':
      return { w: 100, h: 100 };
  }
}

/**
 * Fills defaults so tools can send sparse input (docs/04 Phase 1 decision 10). Idempotent, and
 * a no-op on an already complete node. Unknown keys are kept (forward compatibility).
 */
export function normalizeNode(input: LooseNode): Node {
  const { w: dw, h: dh } = defaultSize(input.type, input.layout);
  const node: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    name: input.name ?? deriveName(input.type, input.text, input.icon),
    parentId: input.parentId ?? null,
    children: input.children ?? [],
    x: input.x ?? 0,
    y: input.y ?? 0,
    w: input.w ?? dw,
    h: input.h ?? dh,
    visible: input.visible ?? true,
    locked: input.locked ?? false,
    opacity: input.opacity ?? 1,
  };

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && !(key in node)) node[key] = value;
  }

  const setDefault = (key: string, value: unknown): void => {
    if (node[key] === undefined) node[key] = value;
  };

  if (input.type === 'frame') {
    setDefault('layout', 'none');
    setDefault('gap', 0);
    setDefault('padding', [0, 0, 0, 0]);
    setDefault('align', 'start');
    setDefault('justify', 'start');
    setDefault('clip', false);
  } else if (input.type === 'text') {
    setDefault('text', '');
    setDefault('fontSize', 16);
    setDefault('fontWeight', 400);
    setDefault('lineHeight', 1.4);
  } else if (input.type === 'image') {
    setDefault('fit', 'cover');
  }

  return node as unknown as Node;
}

export interface LooseDoc extends Partial<Omit<Doc, 'nodes' | 'schema' | 'tokens'>> {
  schema?: number;
  nodes: Record<string, LooseNode>;
  tokens?: Partial<Tokens>;
}

export function normalizeTokens(input: Partial<Tokens> | undefined): Tokens {
  return {
    colors: input?.colors ?? {},
    fonts: input?.fonts ?? {},
    spacing: input?.spacing ?? [...DEFAULT_TOKENS.spacing],
    radii: input?.radii ?? {},
  };
}

/** Normalises every node and fills document-level defaults. Does not validate. */
export function normalizeDoc(input: LooseDoc, now: string = new Date(0).toISOString()): Doc {
  const nodes: Record<string, Node> = {};
  for (const [key, node] of Object.entries(input.nodes)) nodes[key] = normalizeNode(node);
  return {
    schema: SCHEMA_VERSION,
    rev: input.rev ?? 1,
    id: input.id ?? '',
    name: input.name ?? 'Untitled',
    rootId: input.rootId ?? '',
    nodes,
    tokens: normalizeTokens(input.tokens),
    annotations: input.annotations ?? [],
    references: input.references ?? [],
    assets: input.assets ?? {},
    meta: input.meta ?? { createdAt: now, updatedAt: now, lastWriter: 'app' },
  };
}
