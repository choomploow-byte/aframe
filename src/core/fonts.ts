/**
 * The fonts that ship with Atelier (docs/11), described so a tool can list them and the renderer
 * can avoid faking weights a family does not have. Pure data: `scripts/gen-fonts-css.mjs` registers
 * the same families for the canvas, and a test keeps the two lists in step.
 */
export type FontCategory = 'sans' | 'serif' | 'mono' | 'display';

export interface FontInfo {
  name: string;
  category: FontCategory;
  /** Lightest and heaviest weight the bundled files provide. Equal for a single-weight family. */
  weights: readonly [number, number];
  /** Variable fonts take any weight in the range; static ones only the listed one. */
  variable: boolean;
  /** Short advice for the agent. */
  use: string;
  /** Luckiest Guy is Apache 2.0; the rest are SIL OFL 1.1 (see THIRD-PARTY-NOTICES.md). */
  license: 'OFL-1.1' | 'Apache-2.0';
}

export const FONT_CATALOG: readonly FontInfo[] = [
  {
    name: 'Inter',
    category: 'sans',
    weights: [100, 900],
    variable: true,
    use: 'Neutral UI and body text.',
    license: 'OFL-1.1',
  },
  {
    name: 'DM Sans',
    category: 'sans',
    weights: [100, 900],
    variable: true,
    use: 'Friendly geometric sans for UI and headings.',
    license: 'OFL-1.1',
  },
  {
    name: 'Space Grotesk',
    category: 'sans',
    weights: [300, 700],
    variable: true,
    use: 'Techy headings and numerals.',
    license: 'OFL-1.1',
  },
  {
    name: 'Fraunces',
    category: 'serif',
    weights: [100, 900],
    variable: true,
    use: 'Warm editorial serif for headings.',
    license: 'OFL-1.1',
  },
  {
    name: 'Playfair Display',
    category: 'serif',
    weights: [400, 900],
    variable: true,
    use: 'High-contrast display serif.',
    license: 'OFL-1.1',
  },
  {
    name: 'JetBrains Mono',
    category: 'mono',
    weights: [100, 800],
    variable: true,
    use: 'Code and tabular figures.',
    license: 'OFL-1.1',
  },
  {
    name: 'Lilita One',
    category: 'display',
    weights: [400, 400],
    variable: false,
    use: 'Chunky rounded game UI: buttons, titles, currency. Already heavy; use weight 400.',
    license: 'OFL-1.1',
  },
  {
    name: 'Luckiest Guy',
    category: 'display',
    weights: [400, 400],
    variable: false,
    use: 'Loud comic-style titles and banners. Use weight 400, mostly uppercase.',
    license: 'Apache-2.0',
  },
  {
    name: 'Bungee',
    category: 'display',
    weights: [400, 400],
    variable: false,
    use: 'Bold blocky signage and HUD labels. Uppercase only. Use weight 400.',
    license: 'OFL-1.1',
  },
  {
    name: 'Fredoka',
    category: 'display',
    weights: [300, 700],
    variable: true,
    use: 'Soft rounded game UI with real weights 300-700; good for body copy next to Lilita One.',
    license: 'OFL-1.1',
  },
];

export function fontInfo(family: string | undefined): FontInfo | undefined {
  if (family === undefined) return undefined;
  return FONT_CATALOG.find((f) => f.name.toLowerCase() === family.toLowerCase());
}

/** Whether the family really has this weight (so the browser need not fake it). Unknown families: yes. */
export function supportsWeight(family: string | undefined, weight: number): boolean {
  const info = fontInfo(family);
  if (!info) return true;
  const [lo, hi] = info.weights;
  return weight >= lo && weight <= hi;
}

/** The weight a family actually draws for a request: clamped into its range. */
export function nearestWeight(family: string | undefined, weight: number): number {
  const info = fontInfo(family);
  if (!info) return weight;
  return Math.min(info.weights[1], Math.max(info.weights[0], weight));
}
