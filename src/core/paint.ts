/**
 * Pattern fills and effect presets, turned into CSS (docs/04 "Pattern fills", "Effect presets").
 * Called from `nodeToCss`, so they follow the single-source-of-truth rule: the canvas, screenshots
 * and exported code all draw exactly this. Patterns are plain `background-*` layers on the node's
 * own box, so they are clipped by its border radius and by a clipping ancestor for free.
 */
export { fillBase, fillColors, isPatternFill } from './fill';
import { resolveColor, type TokenIssue } from './tokens';
import type { EffectPreset, EffectRef, PatternFill, PatternName, Tokens } from './types';

/** At most 3 decimals, no trailing zeros, no "-0". */
export function n(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

export const px = (value: number): string => `${n(value)}px`;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const PATTERN_NAMES: readonly PatternName[] = ['stripes', 'halftone', 'sunburst', 'noise'];

// ---------------------------------------------------------------------------
// Colour helpers (hex only is computed; anything else is handed to color-mix)
// ---------------------------------------------------------------------------

function parseHex(value: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(value.trim());
  if (!m?.[1]) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const at = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  return { r: at(0), g: at(2), b: at(4), a: h.length === 8 ? at(6) / 255 : 1 };
}

/** `colour` at `alpha` (0..1) of its own opacity. */
export function withAlpha(colour: string, alpha: number): string {
  const a = clamp(alpha, 0, 1);
  const hex = parseHex(colour);
  if (hex) return `rgba(${hex.r}, ${hex.g}, ${hex.b}, ${n(hex.a * a)})`;
  if (colour === 'transparent') return colour;
  return `color-mix(in srgb, ${colour} ${n(a * 100)}%, transparent)`;
}

/** A darker shade of `colour` (a fraction of black mixed in). */
function darken(colour: string | undefined, amount: number): string {
  if (colour === undefined || /gradient\(/.test(colour)) return 'rgba(0, 0, 0, 0.35)';
  const hex = parseHex(colour);
  if (hex) {
    const k = 1 - amount;
    return `rgba(${Math.round(hex.r * k)}, ${Math.round(hex.g * k)}, ${Math.round(hex.b * k)}, ${n(hex.a)})`;
  }
  return `color-mix(in srgb, ${colour} ${n((1 - amount) * 100)}%, black)`;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export const PATTERN_DEFAULTS = {
  stripes: { size: 6, angle: 45 },
  halftone: { size: 4 },
  sunburst: { size: 10, angle: 0 },
  noise: { size: 2 },
} as const;

/** The longest run of stripes/dots/rays that is still sensible; a guard against absurd input. */
const MAX_PX = 2000;

interface Layer {
  image: string;
  size: string;
  position: string;
}

/** Matches the one `url()` a noise fill produces; nothing else may contain `url(`. */
export const NOISE_URL_RE = /url\("data:image\/svg\+xml,[A-Za-z0-9%._~!*'()-]*"\)/g;

function noiseLayer(ink: string, size: number, opacity: number): Layer {
  const hex = parseHex(ink);
  // Noise is baked into an image, so it needs real numbers: anything that is not a hex colour
  // (an hsl() value, say) is drawn in neutral grey rather than guessed.
  const [r, g, b] = hex ? [hex.r / 255, hex.g / 255, hex.b / 255] : [0.2, 0.2, 0.2];
  const alpha = opacity * (hex?.a ?? 1);
  const freq = clamp(0.9 / Math.max(size, 0.5), 0.02, 1.5);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>` +
    `<filter id='n' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${n(freq)}' numOctaves='2' stitchTiles='stitch'/>` +
    `<feColorMatrix type='matrix' values='0 0 0 0 ${n(r)} 0 0 0 0 ${n(g)} 0 0 0 0 ${n(b)} ${n(2.4 * alpha)} 0 0 0 ${n(-0.7 * alpha)}'/>` +
    `</filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
  return {
    image: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    size: '160px 160px',
    position: '0 0',
  };
}

/**
 * The CSS for a pattern fill: `backgroundImage` (plus `backgroundSize`, `backgroundPosition` and a
 * `backgroundColor` when the pattern has a solid `background`). Unresolvable colours are reported
 * to `issues` and the pattern is left out, like any other bad colour.
 */
export function patternCss(
  fill: PatternFill,
  tokens: Tokens,
  issues: TokenIssue[] = [],
): Record<string, string> {
  const ink = resolveColor(fill.color, tokens, issues);
  const base =
    fill.background === undefined ? undefined : resolveColor(fill.background, tokens, issues);
  const out: Record<string, string> = {};
  const layers: Layer[] = [];

  if (ink !== undefined) {
    const opacity = clamp(fill.opacity ?? 1, 0, 1);
    const paint = withAlpha(ink, opacity);
    switch (fill.pattern) {
      case 'stripes': {
        const size = clamp(fill.size ?? PATTERN_DEFAULTS.stripes.size, 0.5, MAX_PX);
        const gap = clamp(fill.spacing ?? size, 0.5, MAX_PX);
        const angle = fill.angle ?? PATTERN_DEFAULTS.stripes.angle;
        layers.push({
          image:
            `repeating-linear-gradient(${n(angle)}deg, ${paint} 0px, ${paint} ${px(size)}, ` +
            `transparent ${px(size)}, transparent ${px(size + gap)})`,
          size: 'auto',
          position: '0 0',
        });
        break;
      }
      case 'halftone': {
        const dot = clamp(fill.size ?? PATTERN_DEFAULTS.halftone.size, 0.5, MAX_PX);
        const cell = clamp(fill.spacing ?? dot * 2, dot, MAX_PX);
        const r = dot / 2;
        const image = `radial-gradient(circle at 50% 50%, ${paint} ${px(r)}, transparent ${px(r + 0.7)})`;
        // Two grids half a cell apart: the staggered dot pattern of a printed halftone.
        layers.push(
          { image, size: `${px(cell)} ${px(cell)}`, position: '0 0' },
          { image, size: `${px(cell)} ${px(cell)}`, position: `${px(cell / 2)} ${px(cell / 2)}` },
        );
        break;
      }
      case 'sunburst': {
        const ray = clamp(fill.size ?? PATTERN_DEFAULTS.sunburst.size, 0.5, 180);
        const gap = clamp(fill.spacing ?? ray, 0.5, 180);
        // Whole number of rays, so the last one meets the first without a seam.
        const count = Math.max(1, Math.round(360 / (ray + gap)));
        const period = 360 / count;
        const width = period * (ray / (ray + gap));
        const angle = fill.angle ?? PATTERN_DEFAULTS.sunburst.angle;
        layers.push({
          image:
            `repeating-conic-gradient(from ${n(angle)}deg at 50% 50%, ${paint} 0deg, ${paint} ${n(width)}deg, ` +
            `transparent ${n(width)}deg, transparent ${n(period)}deg)`,
          size: 'auto',
          position: '0 0',
        });
        break;
      }
      case 'noise':
        layers.push(
          noiseLayer(ink, clamp(fill.size ?? PATTERN_DEFAULTS.noise.size, 0.5, MAX_PX), opacity),
        );
        break;
    }
  }

  if (base !== undefined) {
    if (/^(?:linear|radial)-gradient\(/.test(base)) {
      layers.push({ image: base, size: 'auto', position: '0 0' });
    } else {
      out.backgroundColor = base;
    }
  }
  if (layers.length > 0) {
    out.backgroundImage = layers.map((l) => l.image).join(', ');
    if (layers.some((l) => l.size !== 'auto')) {
      out.backgroundSize = layers.map((l) => l.size).join(', ');
      out.backgroundPosition = layers.map((l) => l.position).join(', ');
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Effect presets
// ---------------------------------------------------------------------------

export const EFFECT_PRESETS: readonly EffectPreset[] = [
  'bevel-raised',
  'bevel-pressed',
  'gloss-top',
  'inner-glow',
  'hard-3d-bottom',
];

export const EFFECT_INFO: Record<EffectPreset, string> = {
  'bevel-raised': 'A button standing proud: light top edge, dark bottom edge, tight drop shadow.',
  'bevel-pressed': 'The same button pushed in: inner shadow from the top, faint light lower lip.',
  'gloss-top': 'A soft white highlight along the top inside edge, like glossy plastic.',
  'inner-glow': 'A glow just inside the edge. `color` tints it (default white).',
  'hard-3d-bottom':
    'A solid darker ledge under the node (a chunky 3D button). `color` sets the ledge colour; by default a darker shade of the fill.',
};

export function effectParts(ref: EffectRef): {
  preset: EffectPreset;
  intensity: number;
  color: string | undefined;
} {
  if (typeof ref === 'string') return { preset: ref, intensity: 1, color: undefined };
  return {
    preset: ref.preset,
    intensity: clamp(ref.intensity ?? 1, 0, 3),
    color: ref.color,
  };
}

/**
 * Box-shadow layers for a node's `effects`. `fill` is the node's resolved fill colour: the
 * hard-3d ledge is a darker shade of it. Alphas scale with `intensity` and are capped at 1.
 */
export function effectShadows(
  effects: readonly EffectRef[] | undefined,
  fill: string | undefined,
  tokens: Tokens,
  issues: TokenIssue[] = [],
): string[] {
  const out: string[] = [];
  for (const ref of effects ?? []) {
    const { preset, intensity: k, color } = effectParts(ref);
    if (k === 0) continue;
    const tint = color === undefined ? undefined : resolveColor(color, tokens, issues);
    if (color !== undefined && tint === undefined) continue; // an unresolvable colour: skip, never guess
    const white = (a: number): string => `rgba(255, 255, 255, ${n(clamp(a * k, 0, 1))})`;
    const black = (a: number): string => `rgba(0, 0, 0, ${n(clamp(a * k, 0, 1))})`;
    switch (preset) {
      case 'bevel-raised':
        out.push(
          `inset 0 ${px(2 * k)} 0 0 ${white(0.35)}`,
          `inset 0 ${px(-3 * k)} 0 0 ${black(0.28)}`,
          `0 ${px(k)} ${px(2 * k)} 0 ${black(0.25)}`,
        );
        break;
      case 'bevel-pressed':
        out.push(
          `inset 0 ${px(3 * k)} ${px(6 * k)} 0 ${black(0.38)}`,
          `inset 0 ${px(-k)} 0 0 ${white(0.22)}`,
        );
        break;
      case 'gloss-top':
        out.push(
          `inset 0 ${px(1)} 0 0 ${white(0.7)}`,
          `inset 0 ${px(14 * k)} ${px(14 * k)} ${px(-10 * k)} ${white(0.4)}`,
        );
        break;
      case 'inner-glow':
        out.push(
          `inset 0 0 ${px(14 * k)} ${px(2 * k)} ${withAlpha(tint ?? '#FFFFFF', clamp(0.55 * k, 0, 1))}`,
        );
        break;
      case 'hard-3d-bottom':
        out.push(
          `0 ${px(4 * k)} 0 0 ${tint ?? darken(fill, 0.38)}`,
          `0 ${px(4 * k + 4)} ${px(8 * k)} 0 ${black(0.22)}`,
        );
        break;
    }
  }
  return out;
}
