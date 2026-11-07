import type { PatternFill } from './types';

/** A `fill` is a colour string or a pattern object. Kept free of imports so any module can use it. */
export function isPatternFill(value: unknown): value is PatternFill {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { pattern?: unknown }).pattern === 'string'
  );
}

/** The solid colour (or gradient) behind a fill, for contrast checks: a pattern's `background`. */
export function fillBase(fill: string | PatternFill | undefined): string | undefined {
  if (fill === undefined) return undefined;
  return isPatternFill(fill) ? fill.background : fill;
}

/** Every colour string a fill refers to (so token problems can be found). */
export function fillColors(fill: string | PatternFill | undefined): string[] {
  if (fill === undefined) return [];
  if (!isPatternFill(fill)) return [fill];
  return [fill.color, ...(fill.background === undefined ? [] : [fill.background])];
}
