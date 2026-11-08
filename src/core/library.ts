/**
 * The asset library (docs/06 "library"): a folder of the user's own images (textures, overlays,
 * particles, brushes) that an agent can search and place. This file is the pure part: turning a file
 * name into a clean name, a category and tags, and searching an index. The files themselves live in
 * the user's AFrame home, not in the project and not in the app; see `mcp/library.ts`.
 */

export const LIBRARY_CATEGORIES = [
  // textures and overlays
  'halftone',
  'sunburst',
  'star',
  'particle',
  'hexagon',
  'texture',
  'pattern',
  'shape',
  // game UI parts and icons
  'icon',
  'button',
  'panel',
  'banner',
  'slider',
  'currency',
  'item',
  'food',
  'animal',
  'nature',
  'character',
  'egg',
  'event',
  'ui',
  'social',
  'other',
] as const;
export type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number];

export interface LibraryEntry {
  /** Short and stable: the clean name as a slug, with a number if it is taken. */
  id: string;
  name: string;
  /** File name inside the library folder (never a path). */
  file: string;
  category: LibraryCategory;
  /** The icon pack or bundle the file came from (from its folder), e.g. "Basic GUI". */
  pack?: string;
  /** The folder inside the pack, e.g. "Boxes Banners" or "Halloween". */
  group?: string;
  tags: string[];
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml';
  width: number | null;
  height: number | null;
  bytes: number;
  /** SHA-256 of the file, so the same image is never added twice. */
  sha256: string;
}

/** Typos found in the file names of some game-UI icon packs, fixed word by word. */
const TYPOS: Record<string, string> = {
  geen: 'green',
  srey: 'grey',
  scoller: 'scroller',
  outine: 'outline',
  slider: 'slider',
  round: 'round',
  textfeild: 'textfield',
  chistmas: 'christmas',
};

/** `ButtonText_Geen_OnOffButton 256px.png` -> `Button Text Green On Off Button`. */
export function cleanName(fileName: string): string {
  const base = fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // PascalCase -> words (ROund and SLider stay whole)
    .replace(/\s+\d{2,4}\s?(?:px|w)$/i, '') // "Axe 1st 256px" -> "Axe 1st"
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => {
      const fixed = TYPOS[w.toLowerCase()];
      if (fixed === undefined) return w;
      // keep a capital if the word had one in front ("Geen" -> "Green"; "ROund" -> "Round")
      return /^[A-Z]/.test(w) ? fixed.charAt(0).toUpperCase() + fixed.slice(1) : fixed;
    })
    .join(' ');
  return base === '' ? 'asset' : base.slice(0, 80);
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? 'asset' : slug;
}

// Order matters: the first rule that matches wins.
const RULES: readonly [LibraryCategory, RegExp][] = [
  ['halftone', /half\s?-?tone|haldtone|halfdtone|haltone|dots?\b|vnshalftone/i],
  ['sunburst', /sun\s?burst|sumburst|stuxburst|subburst|\brays?\b|speedlines?/i],
  ['hexagon', /hexagon/i],
  ['star', /star|spark|shine|glow|flare|twinkle/i],
  ['particle', /particle|kek |gunshot|scorch|slash|lightning|bolt|flame|impact|circle \d/i],
  ['texture', /textur|paper|stone|stud|grid|check|dirt|universal|marble|noise/i],
  ['pattern', /pattern|lines?\b|waves?|swirl|holo|square|stripe|eaves|edge/i],
  ['shape', /mask|shape|brush|vector|corner|circle/i],
];

/** Where a file came from, read off its folders (see `packOf`). */
export interface PackContext {
  pack?: string | undefined;
  group?: string | undefined;
}

const squash = (s: string | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Icon packs by folder name: the first folder (or the source folder) that looks like one names the pack. */
const KNOWN_PACKS: readonly [RegExp, string][] = [
  [/^basicgui|^basicbundle/, 'Basic GUI'],
  [/^freeiconpack/, 'Free Icon Pack'],
  [/^freeicons$/, 'Free Icons'],
  [/^eggs/, 'Eggs'],
  [/^events/, 'Events'],
  [/^currency/, 'Currency'],
];

export function knownPack(folder: string): string | null {
  const key = squash(folder);
  for (const [re, name] of KNOWN_PACKS) if (re.test(key)) return name;
  return null;
}

/** `BoxesBanners` -> `Boxes Banners`; other punctuation stays. */
export function prettyFolder(folder: string): string {
  return folder
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Pack, group and sub-group from the folders a file sits in. `trail` is the source folder's own name
 * followed by the folders below it, with technical ones (an `SVG` or `256px` folder) already removed.
 * A folder that is a known pack names the pack, the next is the group and the one after the sub-group;
 * otherwise two or more folders mean pack then group, and one folder is a group on its own.
 */
export function packOf(trail: readonly string[]): { pack?: string; group?: string; sub?: string } {
  for (let i = 0; i < trail.length; i += 1) {
    const pack = knownPack(trail[i] as string);
    if (pack === null) continue;
    const group = trail[i + 1];
    const sub = trail[i + 2];
    return {
      pack,
      ...(group === undefined ? {} : { group: prettyFolder(group) }),
      ...(sub === undefined ? {} : { sub: prettyFolder(sub) }),
    };
  }
  const dirs = trail.slice(1); // not the source folder itself
  if (dirs.length >= 2) {
    return {
      pack: prettyFolder(dirs[0] as string),
      group: prettyFolder(dirs[1] as string),
      ...(dirs[2] === undefined ? {} : { sub: prettyFolder(dirs[2]) }),
    };
  }
  return dirs[0] === undefined ? {} : { group: prettyFolder(dirs[0]) };
}

const FREE_PACK_GROUPS: Record<string, LibraryCategory> = {
  currency: 'currency',
  item: 'item',
  main: 'icon',
  exclusive: 'icon',
  ui: 'ui',
  social: 'social',
  player: 'character',
  nature: 'nature',
  animal: 'animal',
  food: 'food',
};

function categoryFromPack(ctx: PackContext, name: string): LibraryCategory | null {
  const group = squash(ctx.group);
  switch (ctx.pack ?? '') {
    case 'Basic GUI':
      if (group.startsWith('boxes')) return /banner/i.test(name) ? 'banner' : 'panel';
      if (group.startsWith('buttons')) return 'button';
      if (group === 'icons') return 'icon';
      if (group === 'sliders') return 'slider';
      return null;
    case 'Free Icon Pack':
      return FREE_PACK_GROUPS[group] ?? 'icon';
    case 'Eggs':
      return 'egg';
    case 'Events':
      return 'event';
    case 'Currency':
      return 'currency';
    case 'Free Icons':
      if (/panel|box|frame|banner/i.test(name)) return 'panel';
      if (/coin|cash|gem|diamond|money/i.test(name)) return 'currency';
      return 'icon';
    default:
      return null;
  }
}

/** The category for a name (and, if known, the pack it came from); the pack wins over the name. */
export function categorize(name: string, ctx: PackContext = {}): LibraryCategory {
  const fromPack = categoryFromPack(ctx, name);
  if (fromPack !== null) return fromPack;
  for (const [category, rule] of RULES) if (rule.test(name)) return category;
  return 'other';
}

/** A word and the other words people use for it, so "gold coin" finds "Golden Coin 1st". */
const SYNONYMS: Record<string, string[]> = {
  golden: ['gold'],
  gold: ['golden'],
  coins: ['coin'],
  coin: ['coins'],
  hearts: ['heart'],
  eggs: ['egg'],
  gems: ['gem'],
  gem: ['diamond', 'crystal'],
  cash: ['money'],
  banknote: ['money', 'cash'],
  banknotes: ['money', 'cash'],
  x: ['close'],
  exit: ['close'],
  xmas: ['christmas'],
  lightning: ['bolt', 'energy'],
};

/** Words people search for that the file name only implies. */
const NAME_TAGS: readonly [RegExp, string[]][] = [
  [/\bon off\b/i, ['toggle', 'switch']],
  [/text ?(?:field|input)/i, ['input', 'textbox']],
  [/scroll ?bar/i, ['scrollbar']],
  [/\bhp\b|\bhealth\b/i, ['life']],
];

export const MAX_TAGS = 18;

export function tagsOf(
  name: string,
  category: LibraryCategory,
  extra: readonly string[] = [],
): string[] {
  const words = [name, ...extra]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
  const synonyms = words.flatMap((w) => SYNONYMS[w] ?? []);
  const implied = NAME_TAGS.flatMap(([re, tags]) => (re.test(name) ? tags : []));
  return [...new Set([category, ...words, ...synonyms, ...implied])].slice(0, MAX_TAGS);
}

/**
 * Width and height of an SVG from its opening tag (width/height, else the viewBox), or null.
 * `head` is the first few KB of the file as text.
 */
export function svgSize(head: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (tag === undefined) return null;
  const attr = (name: string): number | null => {
    const m = new RegExp(
      `\\s${name}\\s*=\\s*["']\\s*([0-9]*\\.?[0-9]+)\\s*(?:px)?\\s*["']`,
      'i',
    ).exec(tag);
    return m?.[1] === undefined ? null : Number.parseFloat(m[1]);
  };
  const width = attr('width');
  const height = attr('height');
  if (width !== null && height !== null && width > 0 && height > 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const vb =
    /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9]*\.?[0-9]+)[\s,]+([0-9]*\.?[0-9]+)\s*["']/i.exec(
      tag,
    );
  if (vb?.[1] !== undefined && vb[2] !== undefined) {
    const w = Number.parseFloat(vb[1]);
    const h = Number.parseFloat(vb[2]);
    if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
  }
  return null;
}

export interface SearchOptions {
  category?: LibraryCategory;
  /** Only this pack (case-insensitive, part of the name is enough). */
  pack?: string;
  /** Only this folder inside a pack (case-insensitive, part of the name is enough). */
  group?: string;
  limit?: number;
}

const has = (value: string | undefined, part: string): boolean =>
  value !== undefined && value.toLowerCase().includes(part.toLowerCase());

/** Entries whose name, tags or category match every word of `query`, best first. */
export function searchLibrary(
  entries: readonly LibraryEntry[],
  query: string | undefined,
  options: SearchOptions = {},
): { total: number; hits: LibraryEntry[] } {
  const limit = options.limit ?? 24;
  const words = (query ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  const { category, pack, group } = options;
  const pool = entries.filter(
    (e) =>
      (category === undefined || e.category === category) &&
      (pack === undefined || has(e.pack, pack)) &&
      (group === undefined || has(e.group, group)),
  );
  const scored = pool
    .map((entry) => {
      let score = words.length === 0 ? 1 : 0;
      const name = entry.name.toLowerCase();
      for (const w of words) {
        if (entry.id === w || name === w) score += 100;
        else if (name.split(' ').includes(w)) score += 60;
        else if (name.includes(w)) score += 30;
        else if (entry.tags.includes(w)) score += 25;
        else if (entry.category === w) score += 10;
        else return { entry, score: 0 };
        // asking for a "button" prefers things filed as buttons over a slider's button part
        if (entry.category === w) score += 15;
      }
      return { entry, score };
    })
    .filter((x) => x.score > 0);
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name),
  );
  return { total: scored.length, hits: scored.slice(0, limit).map((x) => x.entry) };
}

/** What is in the library, to browse by: entries per category, and per pack with its groups. */
export function libraryFacets(entries: readonly LibraryEntry[]): {
  categories: Record<string, number>;
  packs: { pack: string; count: number; groups: Record<string, number> }[];
} {
  const categories: Record<string, number> = {};
  const packs = new Map<string, { pack: string; count: number; groups: Record<string, number> }>();
  for (const e of entries) {
    categories[e.category] = (categories[e.category] ?? 0) + 1;
    if (e.pack === undefined) continue;
    let p = packs.get(e.pack);
    if (!p) {
      p = { pack: e.pack, count: 0, groups: {} };
      packs.set(e.pack, p);
    }
    p.count += 1;
    if (e.group !== undefined) p.groups[e.group] = (p.groups[e.group] ?? 0) + 1;
  }
  return { categories, packs: [...packs.values()].sort((a, b) => b.count - a.count) };
}

/** Parts of an interface that get stretched to fit (a panel, a button, a banner, a slider track). */
export const STRETCHY_CATEGORIES: readonly LibraryCategory[] = [
  'panel',
  'button',
  'banner',
  'slider',
];
/** A single small picture: shown whole, never cropped or squashed. */
export const PICTURE_CATEGORIES: readonly LibraryCategory[] = [
  'icon',
  'currency',
  'item',
  'food',
  'animal',
  'nature',
  'character',
  'egg',
  'event',
  'ui',
  'social',
];

/** The shape an agent sees for an entry (no hashes or file names). */
export function describeEntry(e: LibraryEntry): {
  id: string;
  name: string;
  category: LibraryCategory;
  size: string;
  pack?: string;
  group?: string;
} {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    size: e.width !== null && e.height !== null ? `${e.width}x${e.height}` : 'unknown',
    ...(e.pack === undefined ? {} : { pack: e.pack }),
    ...(e.group === undefined ? {} : { group: e.group }),
  };
}
