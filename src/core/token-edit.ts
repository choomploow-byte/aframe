import { CoreError } from './errors';
import { parseTokenRef, resolveColor, resolveFont, resolveRadius, type TokenGroup } from './tokens';
import type { Doc, Node, TextStyle, Tokens } from './types';
import { isValidColor, propIssues, TEXT_STYLE_NAME } from './validate';
import { TEXT_STYLE_KEYS } from './types';

/**
 * Editing design tokens as a document operation (`set_tokens`, the Tokens panel). Renaming keeps
 * every reference working; deleting "detaches" references by writing the literal value back, so
 * removing a token never leaves the design with unresolvable `$names`.
 */
export interface TokenPatch {
  /** `null` removes a token. */
  colors?: Record<string, string | null>;
  fonts?: Record<string, string | null>;
  spacing?: number[];
  radii?: Record<string, number | null>;
  /** `null` removes a text style. */
  textStyles?: Record<string, TextStyle | null>;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const FONT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
const GROUP_KEY = { color: 'colors', font: 'fonts', radius: 'radii' } as const;

function badName(name: string): CoreError {
  return new CoreError(
    'INVALID_VALUE',
    `'${name}' is not a valid token name.`,
    'Use letters, digits, - and _, starting with a letter (e.g. "primary", "surface-2").',
  );
}

function validateColorToken(name: string, value: string): void {
  if (!isValidColor(value)) {
    throw new CoreError(
      'INVALID_VALUE',
      `Invalid colour for token '${name}': ${String(value)}.`,
      'Use #RRGGBB[AA], rgb()/hsl(), or $other.',
    );
  }
}

/** Applies a patch (merge semantics) after validating every entry. Pure. */
export function mergeTokens(tokens: Tokens, patch: TokenPatch): Tokens {
  const next: Tokens = {
    colors: { ...tokens.colors },
    fonts: { ...tokens.fonts },
    spacing: tokens.spacing,
    radii: { ...tokens.radii },
    ...(tokens.textStyles === undefined ? {} : { textStyles: { ...tokens.textStyles } }),
  };
  for (const [name, value] of Object.entries(patch.colors ?? {})) {
    if (!NAME_RE.test(name)) throw badName(name);
    if (value === null) delete next.colors[name];
    else {
      validateColorToken(name, value);
      next.colors[name] = value;
    }
  }
  for (const [name, value] of Object.entries(patch.fonts ?? {})) {
    if (!NAME_RE.test(name)) throw badName(name);
    if (value === null) delete next.fonts[name];
    else if (!FONT_RE.test(value) && parseTokenRef(value)?.group !== 'font') {
      throw new CoreError(
        'INVALID_VALUE',
        `Invalid font for token '${name}': ${value}.`,
        'Use a plain family name like "Inter".',
      );
    } else next.fonts[name] = value;
  }
  for (const [name, value] of Object.entries(patch.radii ?? {})) {
    if (!NAME_RE.test(name)) throw badName(name);
    if (value === null) delete next.radii[name];
    else if (!Number.isFinite(value) || value < 0 || value > 100000) {
      throw new CoreError(
        'INVALID_VALUE',
        `Invalid radius for token '${name}': ${value}.`,
        'Use a number of 0 or more.',
      );
    } else next.radii[name] = value;
  }
  for (const [name, value] of Object.entries(patch.textStyles ?? {})) {
    if (!TEXT_STYLE_NAME.test(name)) {
      throw new CoreError(
        'INVALID_VALUE',
        `'${name}' is not a valid text style name.`,
        'Use letters, digits, spaces, - and _, starting with a letter (e.g. "Title Outline").',
      );
    }
    const styles: Record<string, TextStyle> = { ...(next.textStyles ?? {}) };
    if (value === null) delete styles[name];
    else {
      const unknown = Object.keys(value).filter(
        (k) => !(TEXT_STYLE_KEYS as readonly string[]).includes(k),
      );
      const issue =
        unknown.length > 0
          ? `unknown setting ${unknown.join(', ')}`
          : propIssues({ ...value }, 'text')[0]?.message;
      if (issue !== undefined) {
        throw new CoreError(
          'INVALID_VALUE',
          `Invalid text style '${name}': ${issue}`,
          `A text style sets: ${TEXT_STYLE_KEYS.join(', ')}.`,
        );
      }
      styles[name] = value;
    }
    if (Object.keys(styles).length > 0) next.textStyles = styles;
    else delete next.textStyles;
  }
  if (patch.spacing !== undefined) {
    if (
      !patch.spacing.every((n) => Number.isFinite(n) && n >= 0 && n <= 100000) ||
      patch.spacing.length > 40
    ) {
      throw new CoreError('INVALID_VALUE', 'spacing must be up to 40 numbers of 0 or more.');
    }
    next.spacing = [...patch.spacing];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Walking token references
// ---------------------------------------------------------------------------

const INLINE_COLOR_REF = /\$[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)?/g;

/** Rewrites every colour reference in a colour string; unchanged strings come back identical. */
function mapColorString(value: string, fn: (ref: string) => string): string {
  return value.replace(INLINE_COLOR_REF, (m) => (parseTokenRef(m)?.group === 'color' ? fn(m) : m));
}

type RefMapper = (group: TokenGroup, name: string, raw: string) => string;

/** A node with `map` applied to every token reference it holds; the same object if none changed. */
function mapNodeRefs(node: Node, map: RefMapper): Node {
  let changed = false;
  const out: Record<string, unknown> = { ...node };
  const colour = (key: 'fill' | 'stroke' | 'color'): void => {
    const v = node[key];
    if (typeof v !== 'string') return;
    const next = mapColorString(v, (raw) => map('color', raw.slice(1), raw));
    if (next !== v) {
      out[key] = next;
      changed = true;
    }
  };
  colour('fill');
  colour('stroke');
  colour('color');
  if (typeof node.fontFamily === 'string' && parseTokenRef(node.fontFamily)?.group === 'font') {
    const next = map('font', node.fontFamily.slice('$font.'.length), node.fontFamily);
    if (next !== node.fontFamily) {
      out.fontFamily = next;
      changed = true;
    }
  }
  if (typeof node.radius === 'string' && parseTokenRef(node.radius)?.group === 'radius') {
    const next = map('radius', node.radius.slice('$radius.'.length), node.radius);
    if (next !== node.radius) {
      // A detached radius becomes a number.
      out.radius = /^\d+(\.\d+)?$/.test(next) ? Number(next) : next;
      changed = true;
    }
  }
  if (node.shadow) {
    const shadows = node.shadow.map((s) => {
      const next = mapColorString(s.color, (raw) => map('color', raw.slice(1), raw));
      return next === s.color ? s : { ...s, color: next };
    });
    if (shadows.some((s, i) => s !== node.shadow?.[i])) {
      out.shadow = shadows;
      changed = true;
    }
  }
  return changed ? (out as unknown as Node) : node;
}

function mapDocRefs(doc: Doc, map: RefMapper): Doc {
  let nodesChanged = false;
  const nodes: Record<string, Node> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    const next = mapNodeRefs(node, map);
    nodes[id] = next;
    if (next !== node) nodesChanged = true;
  }

  // Aliases inside the token table itself ("brand": "$primary").
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.tokens.colors))
    colors[k] = mapColorString(v, (raw) => map('color', raw.slice(1), raw));
  const fonts: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc.tokens.fonts)) {
    fonts[k] = parseTokenRef(v)?.group === 'font' ? map('font', v.slice('$font.'.length), v) : v;
  }
  const tokensChanged =
    Object.entries(colors).some(([k, v]) => v !== doc.tokens.colors[k]) ||
    Object.entries(fonts).some(([k, v]) => v !== doc.tokens.fonts[k]);

  return {
    ...doc,
    nodes: nodesChanged ? nodes : doc.nodes,
    tokens: tokensChanged ? { ...doc.tokens, colors, fonts } : doc.tokens,
  };
}

// ---------------------------------------------------------------------------
// Rename, delete, usage
// ---------------------------------------------------------------------------

const PREFIX: Record<TokenGroup, string> = { color: '$', font: '$font.', radius: '$radius.' };

export function renameToken(doc: Doc, group: TokenGroup, from: string, to: string): Doc {
  const key = GROUP_KEY[group];
  const table = doc.tokens[key] as Record<string, unknown>;
  if (!Object.hasOwn(table, from))
    throw new CoreError('NOT_FOUND', `Token '${from}' does not exist.`);
  if (!NAME_RE.test(to)) throw badName(to);
  if (to === from) return doc;
  if (Object.hasOwn(table, to))
    throw new CoreError('INVALID_VALUE', `A ${group} token named '${to}' already exists.`);

  const renamed = mapDocRefs(doc, (g, name, raw) =>
    g === group && name === from ? `${PREFIX[group]}${to}` : raw,
  );
  const renamedTable: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(renamed.tokens[key] as Record<string, unknown>))
    renamedTable[k === from ? to : k] = v;
  return { ...renamed, tokens: { ...renamed.tokens, [key]: renamedTable } };
}

/**
 * Removes a token. Every reference to it is replaced by the literal value it had, so nothing in
 * the design changes appearance. A token that others alias is resolved through them first.
 */
export function deleteToken(doc: Doc, group: TokenGroup, name: string): Doc {
  const key = GROUP_KEY[group];
  const table = doc.tokens[key] as Record<string, unknown>;
  if (!Object.hasOwn(table, name))
    throw new CoreError('NOT_FOUND', `Token '${name}' does not exist.`);

  const literal = (raw: string): string => {
    if (group === 'color') return resolveColor(raw, doc.tokens) ?? raw;
    if (group === 'font') return resolveFont(raw, doc.tokens) ?? raw;
    const r = resolveRadius(raw, doc.tokens);
    return typeof r === 'number' ? String(r) : raw;
  };
  const detached = mapDocRefs(doc, (g, n, raw) => (g === group && n === name ? literal(raw) : raw));
  const rest: Record<string, unknown> = { ...(detached.tokens[key] as Record<string, unknown>) };
  delete rest[name];
  return { ...detached, tokens: { ...detached.tokens, [key]: rest } };
}

export interface TokenUsage {
  color: Record<string, number>;
  font: Record<string, number>;
  radius: Record<string, number>;
}

/** How many properties reference each token (including aliases from other tokens). */
export function tokenUsage(doc: Doc): TokenUsage {
  const usage: TokenUsage = { color: {}, font: {}, radius: {} };
  const bump = (g: TokenGroup, name: string, raw: string): string => {
    usage[g][name] = (usage[g][name] ?? 0) + 1;
    return raw;
  };
  mapDocRefs(doc, bump);
  return usage;
}
