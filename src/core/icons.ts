/**
 * The icon set (docs/04 "Icons"): lookup, search and "did you mean". The data is generated
 * (`icon-data.ts`, from Font Awesome Free solid plus a few icons drawn for AFrame).
 */
import { ICON_DATA } from './icon-data';

export type IconCategory = 'game' | 'commerce' | 'ui' | 'status' | 'arrows';
export const ICON_CATEGORIES: readonly IconCategory[] = [
  'game',
  'commerce',
  'ui',
  'status',
  'arrows',
];

export interface IconDef {
  name: string;
  category: IconCategory;
  /** Space-separated search words. */
  tags: string;
  /** SVG viewBox size (the origin is 0 0). */
  vb: readonly [number, number];
  /** The shape as SVG path data. */
  d: string;
  /** Icons drawn with holes inside shapes use the even-odd rule. */
  rule?: 'evenodd';
  source: 'fontawesome-free' | 'aframe';
}

const BY_NAME = new Map<string, IconDef>(ICON_DATA.map((i) => [i.name, i]));

export const ICONS: readonly IconDef[] = ICON_DATA;

/** `Coins`, `fa-coins`, `coins.svg`, `Treasure Chest` -> `coins`, `coins`, `coins`, `treasure-chest`. */
export function normalizeIconName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.svg$/, '')
    .replace(/^(?:fa-solid|fa-|fas-|fa)[-\s]?(?=[a-z])/, '')
    .replace(/[\s_]+/g, '-');
}

export function getIcon(name: string | undefined): IconDef | undefined {
  if (name === undefined) return undefined;
  return BY_NAME.get(name) ?? BY_NAME.get(normalizeIconName(name));
}

/** Everything a renderer needs to draw an icon, or null for an unknown name (draw a placeholder). */
export function iconShape(name: string | undefined): {
  d: string;
  vb: readonly [number, number];
  rule: 'evenodd' | 'nonzero';
} | null {
  const icon = getIcon(name);
  return icon ? { d: icon.d, vb: icon.vb, rule: icon.rule ?? 'nonzero' } : null;
}

function score(icon: IconDef, words: readonly string[]): number {
  let total = 0;
  const nameParts = icon.name.split('-');
  const tags = icon.tags.split(' ');
  for (const w of words) {
    if (icon.name === w) total += 100;
    else if (nameParts.includes(w)) total += 60;
    else if (icon.name.startsWith(w)) total += 40;
    else if (icon.name.includes(w)) total += 25;
    else if (tags.includes(w)) total += 30;
    else if (tags.some((t) => t.startsWith(w) && w.length >= 3)) total += 15;
    else if (icon.category === w) total += 5;
    else return 0; // every word must match something
  }
  return total;
}

export interface IconHit {
  name: string;
  category: IconCategory;
  tags: string[];
}

/**
 * Icons matching every word of `query` against the name, the tags or the category, best first.
 * An empty query lists the set (optionally one category), alphabetically.
 */
export function searchIcons(
  query: string | undefined,
  options: { category?: IconCategory; limit?: number } = {},
): { hits: IconHit[]; total: number } {
  const limit = options.limit ?? 24;
  const words = (query ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((w) => w.length > 0);
  const pool = options.category ? ICONS.filter((i) => i.category === options.category) : ICONS;
  const scored =
    words.length === 0
      ? pool.map((icon) => ({ icon, s: 1 }))
      : pool.map((icon) => ({ icon, s: score(icon, words) })).filter((x) => x.s > 0);
  // Equal scores: the plainer (shorter) name first, so "close" gives xmark before circle-xmark.
  scored.sort(
    (a, b) =>
      b.s - a.s ||
      a.icon.name.length - b.icon.name.length ||
      a.icon.name.localeCompare(b.icon.name),
  );
  return {
    total: scored.length,
    hits: scored.slice(0, limit).map(({ icon }) => ({
      name: icon.name,
      category: icon.category,
      tags: icon.tags.split(' '),
    })),
  };
}

/** Up to `count` icon names close to an unknown one, for error messages and the placeholder. */
export function suggestIcons(name: string, count = 3): string[] {
  const wanted = normalizeIconName(name);
  if (wanted === '') return [];
  const words = wanted.split('-').filter((w) => w.length > 0);
  const found = searchIcons(words.join(' '), { limit: count }).hits;
  if (found.length > 0) return found.map((h) => h.name);
  // Any single word, in case the whole phrase matched nothing ("golden coin" -> coins).
  const seen = new Set<string>();
  for (const w of words) {
    for (const h of searchIcons(w, { limit: count }).hits) seen.add(h.name);
  }
  return [...seen].slice(0, count);
}
