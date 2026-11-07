/**
 * The asset library (docs/06 "library"): a folder of the user's own images (textures, overlays,
 * particles, brushes) that an agent can search and place. This file is the pure part: turning a file
 * name into a clean name, a category and tags, and searching an index. The files themselves live in
 * the user's Atelier home, not in the project and not in the app; see `mcp/library.ts`.
 */

export const LIBRARY_CATEGORIES = [
  'halftone',
  'sunburst',
  'star',
  'particle',
  'hexagon',
  'texture',
  'pattern',
  'shape',
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
  tags: string[];
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/svg+xml';
  width: number | null;
  height: number | null;
  bytes: number;
  /** SHA-256 of the file, so the same image is never added twice. */
  sha256: string;
}

/** `0d81e230-..._Mask_group_13.png` -> `Mask group 13`; ` (1)` copies and extensions go. */
export function cleanName(fileName: string): string {
  const base = fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.[A-Za-z0-9]+$/, '')
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function categorize(name: string): LibraryCategory {
  for (const [category, rule] of RULES) if (rule.test(name)) return category;
  return 'other';
}

export function tagsOf(name: string, category: LibraryCategory): string[] {
  const words = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
  return [...new Set([category, ...words])].slice(0, 8);
}

/** Entries whose name, tags or category match every word of `query`, best first. */
export function searchLibrary(
  entries: readonly LibraryEntry[],
  query: string | undefined,
  options: { category?: LibraryCategory; limit?: number } = {},
): { total: number; hits: LibraryEntry[] } {
  const limit = options.limit ?? 24;
  const words = (query ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean);
  const pool = options.category ? entries.filter((e) => e.category === options.category) : entries;
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

/** The shape an agent sees for an entry (no hashes or file names). */
export function describeEntry(e: LibraryEntry): {
  id: string;
  name: string;
  category: LibraryCategory;
  size: string;
} {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    size: e.width !== null && e.height !== null ? `${e.width}x${e.height}` : 'unknown',
  };
}
