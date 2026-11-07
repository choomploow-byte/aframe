import { isValidId } from './ids';
import { CONTAINER_TYPES, NODE_TYPES, ownersOf, propsFor, REQUIRED_PROPS } from './props';
import { parseTokenRef } from './tokens';
import type { Doc, NodeType, OpError, Warning } from './types';
import { SCHEMA_VERSION } from './types';
import { isFiniteNumber, isPlainObject } from './util';

/** One problem found by a validator. Converted to `OpError` by callers that know the op index. */
export interface Issue {
  code: OpError['code'];
  message: string;
  hint?: string;
  path?: string;
}

const MAX_COLOR_LENGTH = 500;
const HEX_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// Everything a colour or gradient needs, and nothing that can escape a CSS declaration
// (no quotes, semicolons, braces, backslashes, angle brackets, `@`, `!`).
const SAFE_COLOR_CHARS_RE = /^[#%\w\s.,()/$+-]+$/;
const ALLOWED_COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'linear-gradient',
  'radial-gradient',
]);
const FUNCTION_RE = /([A-Za-z-]+)\(/g;
const INLINE_TOKEN_RE = /\$[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)?/g;
const FONT_FAMILY_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,99}$/;
const HREF_RE = /^(?:#|\/|\.{1,2}\/|https?:\/\/|mailto:|tel:)/i;
const PROP_KEY_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

function balancedParens(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * Accepts `#hex`, `rgb[a]()`, `hsl[a]()`, `transparent`, a `$color` token, and
 * `linear-gradient()`/`radial-gradient()` (which may contain `$color` tokens). Rejects everything
 * else, in particular `url()`, `expression()`, `var()`, quotes and statement separators.
 */
export function isValidColor(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_COLOR_LENGTH) {
    return false;
  }
  if (HEX_RE.test(value) || value === 'transparent') return true;
  if (value.startsWith('$')) return parseTokenRef(value)?.group === 'color';
  if (!SAFE_COLOR_CHARS_RE.test(value) || !balancedParens(value)) return false;

  const lower = value.toLowerCase();
  const funcs = [...lower.matchAll(FUNCTION_RE)].map((m) => m[1] ?? '');
  const first = /^[a-z-]+\(/.exec(lower);
  if (!first || funcs.length === 0) return false;
  if (!funcs.every((f) => ALLOWED_COLOR_FUNCTIONS.has(f))) return false;

  for (const match of value.matchAll(INLINE_TOKEN_RE)) {
    if (parseTokenRef(match[0])?.group !== 'color') return false;
  }
  return !value.replace(INLINE_TOKEN_RE, '').includes('$');
}

export function isValidHref(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 2000 && HREF_RE.test(value);
}

type Check = (value: unknown) => string | null;

const num =
  (min: number, max: number, what: string): Check =>
  (v) =>
    isFiniteNumber(v) && v >= min && v <= max ? null : `a number from ${min} to ${max} (${what})`;
const positive =
  (max: number): Check =>
  (v) =>
    isFiniteNumber(v) && v > 0 && v <= max ? null : `a number greater than 0 and at most ${max}`;
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'true or false');
const color: Check = (v) =>
  isValidColor(v) ? null : 'a colour: #RRGGBB[AA], rgb()/hsl(), a $token, or a gradient';
const oneOf =
  (...options: string[]): Check =>
  (v) =>
    typeof v === 'string' && options.includes(v) ? null : `one of ${options.join(', ')}`;
const str =
  (maxLength: number): Check =>
  (v) =>
    typeof v === 'string' && v.length <= maxLength
      ? null
      : `a string of at most ${maxLength} characters`;

const size: Check = (v) =>
  v === 'hug' || v === 'fill' || (isFiniteNumber(v) && v > 0 && v <= 100_000)
    ? null
    : "'hug', 'fill' or a number greater than 0";

const radius: Check = (v) => {
  if (isFiniteNumber(v)) return v >= 0 && v <= 100_000 ? null : 'a number of 0 or more';
  if (typeof v === 'string') {
    return parseTokenRef(v)?.group === 'radius'
      ? null
      : "a number, a '$radius.<name>' token or [tl, tr, br, bl]";
  }
  if (Array.isArray(v) && v.length === 4 && v.every((n) => isFiniteNumber(n) && n >= 0))
    return null;
  return "a number, a '$radius.<name>' token or four numbers [tl, tr, br, bl]";
};

const padding: Check = (v) =>
  Array.isArray(v) && v.length === 4 && v.every((n) => isFiniteNumber(n) && n >= 0 && n <= 100_000)
    ? null
    : 'four numbers [top, right, bottom, left], each 0 or more';

const shadow: Check = (v) => {
  const shape = 'an array of { x, y, blur, spread, color, inset? } (at most 20)';
  if (!Array.isArray(v) || v.length > 20) return shape;
  for (const s of v) {
    if (!isPlainObject(s)) return shape;
    const keys = Object.keys(s);
    if (keys.some((k) => !['x', 'y', 'blur', 'spread', 'color', 'inset'].includes(k))) return shape;
    if (!isFiniteNumber(s.x) || !isFiniteNumber(s.y) || !isFiniteNumber(s.spread)) return shape;
    if (!isFiniteNumber(s.blur) || s.blur < 0) return shape;
    if (!isValidColor(s.color)) return shape;
    if (s.inset !== undefined && typeof s.inset !== 'boolean') return shape;
  }
  return null;
};

const fontFamily: Check = (v) => {
  if (typeof v !== 'string') return "a font name or a '$font.<name>' token";
  if (v.startsWith('$')) {
    return parseTokenRef(v)?.group === 'font' ? null : "a '$font.<name>' token";
  }
  return FONT_FAMILY_RE.test(v) ? null : 'a plain font family name (letters, digits, spaces)';
};

const customProps: Check = (v) => {
  const shape = 'an object of short string key/value pairs (at most 50)';
  if (!isPlainObject(v)) return shape;
  const entries = Object.entries(v);
  if (entries.length > 50) return shape;
  return entries.every(
    ([k, val]) => PROP_KEY_RE.test(k) && typeof val === 'string' && val.length <= 500,
  )
    ? null
    : shape;
};

const CHECKS: Record<string, Check> = {
  name: (v) =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= 200
      ? null
      : 'a non-empty string of at most 200 characters',
  x: num(-1_000_000, 1_000_000, 'px'),
  y: num(-1_000_000, 1_000_000, 'px'),
  w: size,
  h: size,
  rotation: num(-360_000, 360_000, 'degrees'),
  visible: bool,
  locked: bool,
  opacity: num(0, 1, 'opacity'),
  fill: color,
  stroke: color,
  strokeWidth: num(0, 1000, 'px'),
  strokeAlign: oneOf('inside', 'center', 'outside'),
  radius,
  shadow,
  blur: num(0, 1000, 'px'),
  backdropBlur: num(0, 1000, 'px'),
  role: oneOf('button', 'input', 'link', 'nav', 'section', 'heading', 'card', 'list', 'icon'),
  href: (v) =>
    isValidHref(v) ? null : 'a URL starting with https://, http://, mailto:, tel:, /, ./, ../ or #',
  props: customProps,
  layout: oneOf('none', 'row', 'column'),
  gap: num(0, 100_000, 'px'),
  padding,
  align: oneOf('start', 'center', 'end', 'stretch'),
  justify: oneOf('start', 'center', 'end', 'between'),
  wrap: bool,
  clip: bool,
  text: str(20_000),
  fontFamily,
  fontSize: positive(1000),
  fontWeight: (v) =>
    Number.isInteger(v) && (v as number) >= 100 && (v as number) <= 900
      ? null
      : 'an integer from 100 to 900',
  lineHeight: positive(20),
  letterSpacing: num(-10, 10, 'em'),
  textAlign: oneOf('left', 'center', 'right', 'justify'),
  color,
  textTransform: oneOf('none', 'uppercase', 'capitalize'),
  assetId: (v) => (isValidId(v, 'img') ? null : "an asset id like 'img_ab12c'"),
  fit: oneOf('cover', 'contain', 'fill'),
};

const STRUCTURAL_KEYS = new Set(['id', 'type', 'parentId', 'children', 'tempId']);

function show(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  } catch {
    return String(value);
  }
}

export interface PropIssueOptions {
  /** Accept `null` as "remove this optional property" (update patches). */
  allowNull?: boolean;
  /** Path prefix for issue paths, e.g. `node` or `set`. */
  path?: string;
}

/** Checks node properties against the node type. Returns every problem found. */
export function propIssues(
  props: Record<string, unknown>,
  type: NodeType,
  options: PropIssueOptions = {},
): Issue[] {
  const issues: Issue[] = [];
  const allowed = propsFor(type);
  const where = (key: string): string => (options.path ? `${options.path}.${key}` : key);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (STRUCTURAL_KEYS.has(key)) {
      issues.push({
        code: 'INVALID_VALUE',
        message: `'${key}' cannot be set here.`,
        hint:
          key === 'parentId' || key === 'children'
            ? "Use a 'move' op to change where a node lives."
            : "A node's id and type are fixed when it is created.",
        path: where(key),
      });
      continue;
    }
    const check = CHECKS[key];
    if (!check) {
      issues.push({
        code: 'INVALID_VALUE',
        message: `Unknown property '${key}'.`,
        hint: `Valid properties for a ${type} node: ${allowed.join(', ')}.`,
        path: where(key),
      });
      continue;
    }
    if (!allowed.includes(key)) {
      const owner = ownersOf(key);
      issues.push({
        code: 'INVALID_VALUE',
        message: `'${key}' does not apply to ${type} nodes.`,
        hint: owner
          ? `'${key}' only applies to ${owner} nodes.`
          : `Valid properties for a ${type} node: ${allowed.join(', ')}.`,
        path: where(key),
      });
      continue;
    }
    if (value === null) {
      if (options.allowNull && !REQUIRED_PROPS.has(key)) continue;
      issues.push({
        code: 'INVALID_VALUE',
        message: `'${key}' cannot be removed.`,
        hint: options.allowNull ? `'${key}' is required; set a new value instead.` : undefined,
        path: where(key),
      });
      continue;
    }
    const problem = check(value);
    if (problem !== null) {
      issues.push({
        code: 'INVALID_VALUE',
        message: `Invalid value for '${key}': ${show(value)}.`,
        hint: `Expected ${problem}.`,
        path: where(key),
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Whole-document validation
// ---------------------------------------------------------------------------

export type ValidationResult =
  { ok: true; warnings: Warning[] } | { ok: false; errors: OpError[]; warnings: Warning[] };

const MAX_DOC_ERRORS = 50;

function isStringRecord(v: unknown): v is Record<string, string> {
  return isPlainObject(v) && Object.values(v).every((x) => typeof x === 'string');
}

function isNumberRecord(v: unknown): v is Record<string, number> {
  return isPlainObject(v) && Object.values(v).every((x) => isFiniteNumber(x));
}

/** Validates a document that has already been normalised. Never throws. */
export function validateDoc(input: unknown): ValidationResult {
  const errors: OpError[] = [];
  const warnings: Warning[] = [];
  const fail = (
    message: string,
    path?: string,
    code: OpError['code'] = 'INVALID_VALUE',
    hint?: string,
  ): void => {
    if (errors.length >= MAX_DOC_ERRORS) return;
    const e: OpError = { code, message };
    if (path !== undefined) e.path = path;
    if (hint !== undefined) e.hint = hint;
    errors.push(e);
  };

  if (!isPlainObject(input)) {
    fail('The document must be an object.');
    return { ok: false, errors, warnings };
  }
  const doc = input;

  if (doc.schema !== SCHEMA_VERSION) {
    if (isFiniteNumber(doc.schema) && doc.schema > SCHEMA_VERSION) {
      fail(
        `Document schema ${doc.schema} is newer than this app understands.`,
        'schema',
        'SCHEMA_NEWER',
        'Update Atelier.',
      );
    } else {
      fail(`Unsupported document schema ${show(doc.schema)}.`, 'schema');
    }
  }
  if (!Number.isInteger(doc.rev) || (doc.rev as number) < 0)
    fail('rev must be a non-negative integer.', 'rev');
  if (typeof doc.id !== 'string' || doc.id === '') fail('id must be a non-empty string.', 'id');
  if (typeof doc.name !== 'string') fail('name must be a string.', 'name');
  if (typeof doc.rootId !== 'string') fail('rootId must be a string.', 'rootId');

  validateTokensShape(doc.tokens, fail);
  validateAnnotations(doc.annotations, fail);
  validateReferences(doc.references, doc.assets, fail);

  if (!isStringRecord(doc.assets)) fail('assets must map asset ids to data URLs.', 'assets');
  if (!isPlainObject(doc.meta)) fail('meta must be an object.', 'meta');

  if (!isPlainObject(doc.nodes)) {
    fail('nodes must be an object.', 'nodes');
    return { ok: false, errors, warnings };
  }
  validateNodes(
    doc as unknown as Pick<Doc, 'nodes' | 'rootId'> & { assets: unknown },
    fail,
    warnings,
  );

  return errors.length === 0 ? { ok: true, warnings } : { ok: false, errors, warnings };
}

type Fail = (message: string, path?: string, code?: OpError['code'], hint?: string) => void;

function validateTokensShape(tokens: unknown, fail: Fail): void {
  if (!isPlainObject(tokens)) return fail('tokens must be an object.', 'tokens');
  if (
    !isStringRecord(tokens.colors) ||
    !Object.values(tokens.colors).every((c) => isValidColor(c))
  ) {
    fail('tokens.colors must map names to valid colours.', 'tokens.colors');
  }
  if (!isStringRecord(tokens.fonts))
    fail('tokens.fonts must map names to font families.', 'tokens.fonts');
  if (!Array.isArray(tokens.spacing) || !tokens.spacing.every((n) => isFiniteNumber(n) && n >= 0)) {
    fail('tokens.spacing must be an array of numbers.', 'tokens.spacing');
  }
  if (!isNumberRecord(tokens.radii))
    fail('tokens.radii must map names to numbers.', 'tokens.radii');
}

function validateAnnotations(list: unknown, fail: Fail): void {
  if (!Array.isArray(list)) return fail('annotations must be an array.', 'annotations');
  list.forEach((a: unknown, i) => {
    const p = `annotations.${i}`;
    if (!isPlainObject(a)) return fail('Annotation must be an object.', p);
    if (!isValidId(a.id, 'a')) fail('Annotation id must look like a_xxxxx.', `${p}.id`);
    if (typeof a.text !== 'string') fail('Annotation text must be a string.', `${p}.text`);
    if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y)) fail('Annotation x/y must be numbers.', p);
    if (a.author !== 'user' && a.author !== 'agent')
      fail("author must be 'user' or 'agent'.", `${p}.author`);
    if (a.status !== 'open' && a.status !== 'resolved')
      fail("status must be 'open' or 'resolved'.", `${p}.status`);
    if (a.nodeId !== undefined && typeof a.nodeId !== 'string')
      fail('nodeId must be a string.', `${p}.nodeId`);
    if (a.reply !== undefined && typeof a.reply !== 'string')
      fail('reply must be a string.', `${p}.reply`);
    if (typeof a.createdAt !== 'string') fail('createdAt must be a string.', `${p}.createdAt`);
  });
}

function validateReferences(list: unknown, assets: unknown, fail: Fail): void {
  if (!Array.isArray(list)) return fail('references must be an array.', 'references');
  list.forEach((r: unknown, i) => {
    const p = `references.${i}`;
    if (!isPlainObject(r)) return fail('Reference must be an object.', p);
    if (!isValidId(r.id, 'r')) fail('Reference id must look like r_xxxxx.', `${p}.id`);
    if (typeof r.name !== 'string') fail('Reference name must be a string.', `${p}.name`);
    if (typeof r.assetId !== 'string') fail('Reference assetId must be a string.', `${p}.assetId`);
    else if (isPlainObject(assets) && !(r.assetId in assets)) {
      fail(`Reference points to missing asset ${r.assetId}.`, `${p}.assetId`);
    }
    if (r.scope !== undefined && !['style', 'layout', 'everything'].includes(r.scope as string)) {
      fail("scope must be 'style', 'layout' or 'everything'.", `${p}.scope`);
    }
  });
}

function validateNodes(
  doc: { nodes: Record<string, unknown>; rootId: unknown; assets: unknown },
  fail: Fail,
  warnings: Warning[],
): void {
  const nodes = doc.nodes;
  const ids = Object.keys(nodes);
  const parentOf = new Map<string, string>();

  for (const key of ids) {
    const n = nodes[key];
    const p = `nodes.${key}`;
    if (!isPlainObject(n)) {
      fail('Node must be an object.', p);
      continue;
    }
    if (n.id !== key) fail(`Node id '${show(n.id)}' does not match its key '${key}'.`, `${p}.id`);
    if (!isValidId(String(key), 'n')) fail(`Node id '${key}' is not a valid node id.`, `${p}.id`);
    const type = n.type as NodeType;
    if (!NODE_TYPES.includes(type)) {
      fail(`Unknown node type ${show(n.type)}.`, `${p}.type`);
      continue;
    }
    if (type === 'page' && key !== doc.rootId)
      fail('Only the root may be a page node.', `${p}.type`);
    if (!Array.isArray(n.children) || !n.children.every((c) => typeof c === 'string')) {
      fail('children must be an array of node ids.', `${p}.children`);
    } else {
      if (n.children.length > 0 && !CONTAINER_TYPES.includes(type)) {
        fail(
          `${type} nodes cannot have children.`,
          `${p}.children`,
          'BAD_PARENT',
          'Only frames (and the page) can contain nodes.',
        );
      }
      for (const child of n.children) {
        if (parentOf.has(child))
          fail(`Node ${child} appears as a child more than once.`, `${p}.children`);
        parentOf.set(child, key);
      }
    }
    if (n.parentId !== null && typeof n.parentId !== 'string')
      fail('parentId must be a string or null.', `${p}.parentId`);

    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) if (!STRUCTURAL_KEYS.has(k)) props[k] = v;
    for (const issue of propIssues(props, type, { path: p })) {
      // The page's w/h are 0 (docs/04 Phase 1 decision 2), not a real size.
      if (type === 'page' && (issue.path?.endsWith('.w') || issue.path?.endsWith('.h'))) continue;
      fail(issue.message, issue.path, issue.code, issue.hint);
    }
    if (
      type === 'image' &&
      typeof n.assetId === 'string' &&
      isPlainObject(doc.assets) &&
      !(n.assetId in doc.assets)
    ) {
      warnings.push({
        code: 'MISSING_ASSET',
        message: `Image ${key} points to missing asset ${n.assetId}.`,
        nodeId: key,
      });
    }
  }

  const root = typeof doc.rootId === 'string' ? nodes[doc.rootId] : undefined;
  if (!isPlainObject(root) || root.type !== 'page') {
    return fail('rootId must point to a page node.', 'rootId', 'NOT_FOUND');
  }
  if (root.parentId !== null)
    fail('The root page must have parentId null.', `nodes.${String(doc.rootId)}.parentId`);

  for (const [child, parent] of parentOf) {
    const c = nodes[child];
    if (!isPlainObject(c)) {
      fail(`Node ${parent} lists missing child ${child}.`, `nodes.${parent}.children`, 'NOT_FOUND');
    } else if (c.parentId !== parent) {
      fail(
        `Node ${child} has parentId ${show(c.parentId)} but is listed under ${parent}.`,
        `nodes.${child}.parentId`,
      );
    }
  }

  // Reachability from the root also rules out orphans and cycles (a cycle is unreachable).
  const seen = new Set<string>();
  const stack = [String(doc.rootId)];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = nodes[id];
    if (isPlainObject(n) && Array.isArray(n.children)) {
      for (const child of n.children) if (typeof child === 'string') stack.push(child);
    }
  }
  for (const id of ids) {
    if (!seen.has(id))
      fail(`Node ${id} is not reachable from the root (orphan or cycle).`, `nodes.${id}`, 'CYCLE');
  }
}
