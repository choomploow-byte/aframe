/** Names for exported files, components and classes: stable, readable, never colliding. */

/** `Primary Button` -> `primary-button`; anything unusable falls back to `fallback`. */
export function kebab(name: string, fallback = 'node'): string {
  const out = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  if (out === '') return fallback;
  return /^[0-9]/.test(out) ? `${fallback}-${out}` : out;
}

/** `Landing - Desktop` -> `LandingDesktop`. */
export function pascal(name: string, fallback = 'Design'): string {
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const out = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  if (out === '') return fallback;
  return /^[0-9]/.test(out) ? `${fallback}${out}` : out;
}

/**
 * Hands out class names in document order, so the same design always gets the same names (a
 * re-export changes only what changed): the first `card` is `card`, the next `card-2`.
 */
export function uniqueNames(): { next: (name: string, fallback: string) => string } {
  const used = new Set<string>();
  return {
    next(name, fallback) {
      const base = kebab(name, fallback);
      let candidate = base;
      for (let i = 2; used.has(candidate); i += 1) candidate = `${base}-${i}`;
      used.add(candidate);
      return candidate;
    },
  };
}
