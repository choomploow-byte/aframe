import { isValidId } from './ids';
import { EFFECT_PRESETS, PATTERN_NAMES } from './paint';
import { CONTAINER_TYPES, NODE_TYPES, ownersOf, propsFor, REQUIRED_PROPS } from './props';
import { suggest } from './suggest';
import { parseTokenRef } from './tokens';
import type { Doc, NodeType, OpError, Tokens, Warning } from './types';
import { BLEND_MODES, SCHEMA_VERSION, TEXT_STYLE_KEYS } from './types';
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

const COMPONENT_KINDS = ['button', 'card', 'tab', 'slot', 'panel', 'toast', 'custom'];
const COMPONENT_STATES = ['default', 'hover', 'pressed', 'disabled', 'selected'];
const PATTERN_KEYS = ['pattern', 'color', 'size', 'spacing', 'angle', 'opacity', 'background'];
const LAYER_KEY_RE = /^(?:\$self|n_[a-z0-9]{4,8})$/;
const ICON_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;

const PATTERN_SHAPE =
  '{ pattern: "stripes" | "halftone" | "sunburst" | "noise", color, size?, spacing?, angle?, opacity?, background? }';
const COLOR_SHAPE = 'a colour: #RRGGBB[AA], rgb()/hsl(), a $token, or a gradient';

const patternFill: Check = (v) => {
  if (!isPlainObject(v)) return `a colour or a pattern ${PATTERN_SHAPE}`;
  const bad = Object.keys(v).find((k) => !PATTERN_KEYS.includes(k));
  if (bad !== undefined)
    return `a pattern with only these keys: ${PATTERN_KEYS.join(', ')} ('${bad}' is not one)`;
  if (typeof v.pattern !== 'string' || !(PATTERN_NAMES as readonly string[]).includes(v.pattern)) {
    return `pattern to be one of ${PATTERN_NAMES.join(', ')}`;
  }
  if (!isValidColor(v.color)) return `pattern.color to be ${COLOR_SHAPE}`;
  if (v.background !== undefined && !isValidColor(v.background)) {
    return `pattern.background to be ${COLOR_SHAPE}`;
  }
  for (const [k, lo, hi] of [
    ['size', 0.5, 2000],
    ['spacing', 0.5, 2000],
    ['angle', -3600, 3600],
    ['opacity', 0, 1],
  ] as const) {
    const val = v[k];
    if (val !== undefined && !(isFiniteNumber(val) && val >= lo && val <= hi)) {
      return `pattern.${k} to be a number from ${lo} to ${hi}`;
    }
  }
  return null;
};

const fillCheck: Check = (v) => (typeof v === 'string' ? color(v) : patternFill(v));

const effects: Check = (v) => {
  const shape = `an array of preset names (${EFFECT_PRESETS.join(', ')}) or { preset, intensity?, color? }, at most 8`;
  if (!Array.isArray(v) || v.length > 8) return shape;
  for (const e of v) {
    if (typeof e === 'string') {
      if (!(EFFECT_PRESETS as readonly string[]).includes(e)) return shape;
      continue;
    }
    if (!isPlainObject(e)) return shape;
    if (Object.keys(e).some((k) => !['preset', 'intensity', 'color'].includes(k))) return shape;
    if (typeof e.preset !== 'string' || !(EFFECT_PRESETS as readonly string[]).includes(e.preset))
      return shape;
    if (
      e.intensity !== undefined &&
      !(isFiniteNumber(e.intensity) && e.intensity >= 0 && e.intensity <= 3)
    )
      return 'an intensity from 0 to 3';
    if (e.color !== undefined && !isValidColor(e.color)) return `effect color to be ${COLOR_SHAPE}`;
  }
  return null;
};

/** Property values a component may change per layer: known, non-structural, each value valid. */
function layerPatchProblem(patch: unknown): string | null {
  if (!isPlainObject(patch)) return 'an object of property changes';
  for (const [key, value] of Object.entries(patch)) {
    const check = CHECKS[key];
    if (!check || STRUCTURAL_KEYS.has(key) || MANAGED_KEYS.has(key)) {
      return `known visual properties only ('${key}' cannot be changed per layer)`;
    }
    if (value === null) {
      if (REQUIRED_PROPS.has(key)) return `'${key}' cannot be removed`;
      continue;
    }
    const problem = check(value);
    if (problem !== null) return `'${key}' to be ${problem}`;
  }
  return null;
}

function layerPatches(v: unknown, what: string): string | null {
  if (!isPlainObject(v)) return `${what} as an object keyed by layer id (or "$self")`;
  const entries = Object.entries(v);
  if (entries.length > 400) return `${what} for at most 400 layers`;
  for (const [layer, patch] of entries) {
    if (!LAYER_KEY_RE.test(layer))
      return `${what} keyed by layer id like "n_abc12" or "$self" (got "${layer}")`;
    const problem = layerPatchProblem(patch);
    if (problem !== null) return `${what}["${layer}"] to hold ${problem}`;
  }
  return null;
}

const componentDef: Check = (v) => {
  const shape = `{ kind: ${COMPONENT_KINDS.join(' | ')}, states?: { hover?, pressed?, disabled?, selected? } }`;
  if (!isPlainObject(v)) return shape;
  if (Object.keys(v).some((k) => k !== 'kind' && k !== 'states')) return shape;
  if (typeof v.kind !== 'string' || !COMPONENT_KINDS.includes(v.kind)) {
    return `component.kind to be one of ${COMPONENT_KINDS.join(', ')}`;
  }
  if (v.states === undefined) return null;
  if (!isPlainObject(v.states)) return shape;
  for (const [state, patches] of Object.entries(v.states)) {
    if (state === 'default' || !COMPONENT_STATES.includes(state)) {
      return `states named hover, pressed, disabled or selected (the master itself is the default look; got "${state}")`;
    }
    const problem = layerPatches(patches, `component.states.${state}`);
    if (problem !== null) return problem;
  }
  return null;
};

/** Names of shared text styles: readable ones such as "Title Outline". */
export const TEXT_STYLE_NAME = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;

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
  flipX: bool,
  flipY: bool,
  visible: bool,
  locked: bool,
  opacity: num(0, 1, 'opacity'),
  fill: fillCheck,
  stroke: color,
  strokeWidth: num(0, 1000, 'px'),
  strokeAlign: oneOf('inside', 'center', 'outside'),
  radius,
  shadow,
  blur: num(0, 1000, 'px'),
  backdropBlur: num(0, 1000, 'px'),
  hue: num(-360, 360, 'degrees'),
  saturation: num(0, 10, 'a multiplier (1 = unchanged)'),
  brightness: num(0, 10, 'a multiplier (1 = unchanged)'),
  contrast: num(0, 10, 'a multiplier (1 = unchanged)'),
  blendMode: oneOf(...BLEND_MODES),
  effects,
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
  textStroke: color,
  textStrokeWidth: num(0, 100, 'px'),
  textStyle: (v) =>
    typeof v === 'string' && TEXT_STYLE_NAME.test(v)
      ? null
      : 'a text style name (letters, digits, spaces, - and _; up to 40 characters)',
  assetId: (v) => (isValidId(v, 'img') ? null : "an asset id like 'img_ab12c'"),
  icon: (v) =>
    typeof v === 'string' && ICON_NAME_RE.test(v)
      ? null
      : "an icon name such as 'coins' (find names with search_icons)",
  component: componentDef,
  instanceOf: (v) => (isValidId(v, 'n') ? null : "a master component's node id like 'n_abc12'"),
  state: oneOf(...COMPONENT_STATES),
  overrides: (v) => layerPatches(v, 'overrides'),
  fit: oneOf('cover', 'contain', 'fill', 'tile'),
  tileSize: num(1, 10_000, 'px'),
};

const STRUCTURAL_KEYS = new Set(['id', 'type', 'parentId', 'children', 'tempId', 'from']);
/** Per-layer patches may not touch component machinery. */
const MANAGED_KEYS = new Set(['component', 'instanceOf', 'state', 'overrides']);

function show(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  } catch {
    return String(value);
  }
}

export interface PropIssueOptions {
  /** Tokens of the document, so a bad value can be answered with the token it probably meant. */
  tokens?: Tokens;
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
            : key === 'from'
              ? 'Component instances manage this themselves; use create_instance.'
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
        hint: [`Expected ${problem}.`, suggest(key, value, options.tokens)]
          .filter(Boolean)
          .join(' '),
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
        'Update AFrame.',
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
  if (tokens.textStyles !== undefined) {
    if (!isPlainObject(tokens.textStyles)) {
      return fail('tokens.textStyles must map names to text styles.', 'tokens.textStyles');
    }
    for (const [name, style] of Object.entries(tokens.textStyles)) {
      const path = `tokens.textStyles.${name}`;
      if (!TEXT_STYLE_NAME.test(name)) fail('Not a valid text style name.', path);
      else if (!isPlainObject(style)) fail('A text style must be an object.', path);
      else if (
        Object.keys(style).some((k) => !(TEXT_STYLE_KEYS as readonly string[]).includes(k))
      ) {
        fail(`A text style may only set ${TEXT_STYLE_KEYS.join(', ')}.`, path);
      } else {
        for (const issue of propIssues(style, 'text')) fail(issue.message, path);
      }
    }
  }
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
    if (a.offset !== undefined) {
      const o = a.offset;
      if (!isPlainObject(o) || !isFiniteNumber(o.x) || !isFiniteNumber(o.y))
        fail('offset must be { x, y } numbers.', `${p}.offset`);
      else if (a.nodeId === undefined) fail('offset needs a nodeId.', `${p}.offset`);
    }
    if (a.rect !== undefined) {
      const r = a.rect;
      if (
        !isPlainObject(r) ||
        !isFiniteNumber(r.x) ||
        !isFiniteNumber(r.y) ||
        !isFiniteNumber(r.w) ||
        !isFiniteNumber(r.h) ||
        r.w < 0 ||
        r.h < 0
      )
        fail('rect must be { x, y, w, h } numbers.', `${p}.rect`);
    }
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
