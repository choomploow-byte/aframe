import { fillColors } from './fill';
import type { Node, RadiusTuple, Tokens } from './types';

/** Starter tokens for new documents: warm neutrals from docs/07 with the brand purple as the accent. */
export const DEFAULT_TOKENS: Tokens = {
  colors: {
    surface: '#FAF9F5',
    surface2: '#FFFFFF',
    border: '#E8E6DC',
    text: '#1F1E1D',
    muted: '#6B6A65',
    primary: '#5B3CB0',
    primarySoft: '#ECE6F8',
  },
  fonts: { heading: 'Fraunces', body: 'Inter', mono: 'JetBrains Mono' },
  spacing: [4, 8, 12, 16, 24, 32, 48, 64, 96],
  radii: { sm: 6, md: 10, lg: 16, xl: 24, full: 999 },
};

export type TokenGroup = 'color' | 'font' | 'radius';

export interface TokenRef {
  group: TokenGroup;
  name: string;
  /** The reference exactly as written, e.g. `$font.heading`. */
  raw: string;
}

export interface TokenIssue {
  token: string;
  reason: 'UNKNOWN' | 'MALFORMED' | 'CYCLE' | 'WRONG_TYPE';
}

const NAME = '[A-Za-z][A-Za-z0-9_-]*';
const COLOR_REF_RE = new RegExp(`^\\$(${NAME})$`);
const GROUP_REF_RE = new RegExp(`^\\$(font|radius)\\.(${NAME})$`);
/** A colour token inside a larger colour string (gradients). A trailing `.` is rejected by the caller. */
const INLINE_COLOR_RE = new RegExp(`\\$${NAME}(?:\\.[A-Za-z0-9_-]+)?`, 'g');
const MAX_ALIAS_DEPTH = 8;

export function isTokenRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$');
}

/** `$primary` -> color, `$font.body` -> font, `$radius.md` -> radius; anything else is null. */
export function parseTokenRef(raw: string): TokenRef | null {
  const group = GROUP_REF_RE.exec(raw);
  if (group) return { group: group[1] === 'font' ? 'font' : 'radius', name: group[2] ?? '', raw };
  const color = COLOR_REF_RE.exec(raw);
  if (color) return { group: 'color', name: color[1] ?? '', raw };
  return null;
}

function own(map: Record<string, unknown>, key: string): boolean {
  // Guards against `$__proto__` / `$constructor` resolving to Object.prototype members.
  return Object.prototype.hasOwnProperty.call(map, key);
}

function resolveColorInner(
  value: string,
  tokens: Tokens,
  issues: TokenIssue[],
  chain: readonly string[],
): string | undefined {
  let failed = false;
  const out = value.replace(INLINE_COLOR_RE, (match) => {
    const ref = parseTokenRef(match);
    if (!ref) {
      issues.push({ token: match, reason: 'MALFORMED' });
      failed = true;
      return match;
    }
    if (ref.group !== 'color') {
      issues.push({ token: match, reason: 'WRONG_TYPE' });
      failed = true;
      return match;
    }
    if (chain.includes(ref.name) || chain.length >= MAX_ALIAS_DEPTH) {
      issues.push({ token: match, reason: 'CYCLE' });
      failed = true;
      return match;
    }
    const target = own(tokens.colors, ref.name) ? tokens.colors[ref.name] : undefined;
    if (target === undefined) {
      issues.push({ token: match, reason: 'UNKNOWN' });
      failed = true;
      return match;
    }
    const resolved = resolveColorInner(target, tokens, issues, [...chain, ref.name]);
    if (resolved === undefined) {
      failed = true;
      return match;
    }
    return resolved;
  });
  if (!failed && out.includes('$')) {
    // A `$` that did not parse as a token name (`$__proto__`, `$1x`, a bare `$`): never emit it as CSS.
    issues.push({ token: value, reason: 'MALFORMED' });
    return undefined;
  }
  return failed ? undefined : out;
}

/**
 * Resolves `$name` references in a colour string (also inside gradients). Returns undefined for
 * an empty value or when any reference cannot be resolved; the problem is pushed to `issues`.
 * Callers then omit the CSS property ("fallback to inherit", docs/04).
 */
export function resolveColor(
  value: string | undefined,
  tokens: Tokens,
  issues: TokenIssue[] = [],
): string | undefined {
  if (value === undefined || value === '') return undefined;
  return resolveColorInner(value, tokens, issues, []);
}

/** `$font.heading` -> the family from `tokens.fonts`; a plain family name passes through. */
export function resolveFont(
  value: string | undefined,
  tokens: Tokens,
  issues: TokenIssue[] = [],
): string | undefined {
  if (value === undefined || value === '') return undefined;
  let current = value;
  for (let depth = 0; depth <= MAX_ALIAS_DEPTH; depth += 1) {
    if (!isTokenRef(current)) return current;
    const ref = parseTokenRef(current);
    if (!ref) {
      issues.push({ token: current, reason: 'MALFORMED' });
      return undefined;
    }
    if (ref.group !== 'font') {
      issues.push({ token: current, reason: 'WRONG_TYPE' });
      return undefined;
    }
    const next = own(tokens.fonts, ref.name) ? tokens.fonts[ref.name] : undefined;
    if (next === undefined) {
      issues.push({ token: current, reason: 'UNKNOWN' });
      return undefined;
    }
    current = next;
  }
  issues.push({ token: value, reason: 'CYCLE' });
  return undefined;
}

export function resolveRadius(
  value: number | string | RadiusTuple | undefined,
  tokens: Tokens,
  issues: TokenIssue[] = [],
): number | RadiusTuple | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' || Array.isArray(value)) return value;
  const ref = parseTokenRef(value);
  if (!ref) {
    issues.push({ token: value, reason: 'MALFORMED' });
    return undefined;
  }
  if (ref.group !== 'radius') {
    issues.push({ token: value, reason: 'WRONG_TYPE' });
    return undefined;
  }
  const px = own(tokens.radii, ref.name) ? tokens.radii[ref.name] : undefined;
  if (px === undefined) {
    issues.push({ token: value, reason: 'UNKNOWN' });
    return undefined;
  }
  return px;
}

/** Every token problem a node's style would hit, for warnings and lint. */
export function findTokenIssues(node: Node, tokens: Tokens): TokenIssue[] {
  const issues: TokenIssue[] = [];
  for (const c of fillColors(node.fill)) resolveColor(c, tokens, issues);
  resolveColor(node.stroke, tokens, issues);
  for (const e of node.effects ?? []) {
    if (typeof e !== 'string' && e.color !== undefined) resolveColor(e.color, tokens, issues);
  }
  resolveColor(node.color, tokens, issues);
  resolveFont(node.fontFamily, tokens, issues);
  resolveRadius(node.radius, tokens, issues);
  for (const shadow of node.shadow ?? []) resolveColor(shadow.color, tokens, issues);
  return issues;
}

/** True if `value` is in the scale or a multiple of 4 (the lint rule `off-scale-spacing`). */
export function isOnSpacingScale(value: number, tokens: Tokens): boolean {
  return tokens.spacing.includes(value) || (Number.isInteger(value) && value % 4 === 0);
}

/** Nearest scale value (ties go to the smaller one); with an empty scale, the nearest multiple of 4. */
export function nearestSpacing(value: number, tokens: Tokens): number {
  if (tokens.spacing.length === 0) return Math.round(value / 4) * 4;
  let best = tokens.spacing[0] ?? 0;
  for (const candidate of tokens.spacing) {
    const d = Math.abs(candidate - value);
    const bestD = Math.abs(best - value);
    if (d < bestD || (d === bestD && candidate < best)) best = candidate;
  }
  return best;
}
