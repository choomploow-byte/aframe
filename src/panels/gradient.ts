/**
 * The gradient editor's model. Gradients are stored as CSS strings in `fill` (docs/04); this reads
 * the forms the editor writes (and similar hand-written ones) and writes them back canonically.
 * Anything it cannot read is left alone and shown as raw text.
 */
export interface GradientStop {
  /** Any colour the document accepts: hex, rgb(), a $token. */
  color: string;
  /** 0-100 */
  at: number;
}

export interface GradientModel {
  kind: 'linear' | 'radial';
  /** Degrees; only used by linear gradients. */
  angle: number;
  stops: GradientStop[];
}

export const DEFAULT_GRADIENT: GradientModel = {
  kind: 'linear',
  angle: 90,
  stops: [
    { color: '#C96442', at: 0 },
    { color: '#F6E6DF', at: 100 },
  ],
};

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

function parseStop(part: string): { color: string; at: number | null } | null {
  const m = /^(.*?)(?:\s+(-?\d+(?:\.\d+)?)%)?$/.exec(part);
  if (!m || !m[1]) return null;
  return { color: m[1].trim(), at: m[2] === undefined ? null : Number(m[2]) };
}

export function parseGradient(value: string): GradientModel | null {
  const m = /^(linear|radial)-gradient\((.*)\)$/s.exec(value.trim());
  if (!m) return null;
  const kind = m[1] === 'radial' ? 'radial' : 'linear';
  const parts = splitTopLevel(m[2] ?? '');
  let angle = 90;
  const first = parts[0] ?? '';
  const isStop = /^(#|\$|rgb|hsl|transparent)/i.test(first);
  if (!isStop) {
    if (kind === 'linear') {
      const a = /^(-?\d+(?:\.\d+)?)deg$/.exec(first);
      if (!a) return null; // "to right" and friends: leave to the raw field
      angle = Number(a[1]);
    } else if (!/^(circle|ellipse)/.test(first)) return null;
    parts.shift();
  }
  const raw = parts.map(parseStop);
  if (raw.length < 2 || raw.some((s) => s === null)) return null;
  const stops = raw.map((s, i) => ({
    color: (s as { color: string }).color,
    at: (s as { at: number | null }).at ?? Math.round((i / (raw.length - 1)) * 100),
  }));
  return { kind, angle, stops };
}

const trim = (n: number): string => String(Math.round(n * 100) / 100);

export function buildGradient(model: GradientModel): string {
  const stops = model.stops
    .map((s) => `${s.color} ${trim(Math.min(100, Math.max(0, s.at)))}%`)
    .join(', ');
  return model.kind === 'linear'
    ? `linear-gradient(${trim(model.angle)}deg, ${stops})`
    : `radial-gradient(circle, ${stops})`;
}

export const isGradient = (value: string | undefined): boolean =>
  value !== undefined && /^(linear|radial)-gradient\(/.test(value);
