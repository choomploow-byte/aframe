/** Short readable ids (docs/04 "IDs"): `n_k3x9a`, `a_…` annotations, `r_…` references, `img_…` assets. */

export type IdPrefix = 'n' | 'a' | 'r' | 'img' | 'p';
/** Random source in [0, 1). Injectable so tests are deterministic. */
export type Rng = () => number;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const ID_RE = /^(n|a|r|img|p)_[a-z0-9]{4,8}$/;
const TEMP_ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export function isValidId(id: unknown, prefix?: IdPrefix): id is string {
  if (typeof id !== 'string' || !ID_RE.test(id)) return false;
  return prefix === undefined || id.startsWith(`${prefix}_`);
}

export function isValidTempId(id: unknown): id is string {
  return typeof id === 'string' && TEMP_ID_RE.test(id);
}

/** Small deterministic PRNG (mulberry32) for tests and reproducible demos. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSuffix(length: number, rng: Rng): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET.charAt(Math.floor(rng() * ALPHABET.length) % ALPHABET.length);
  }
  return out;
}

/**
 * Generates an id that is not in `taken`. Retries a few times at 5 chars, then grows the
 * suffix, so it terminates even with a degenerate RNG (e.g. one that always returns 0).
 */
export function generateId(
  prefix: IdPrefix,
  taken: { has(id: string): boolean },
  rng: Rng = Math.random,
): string {
  for (let length = 5; length <= 8; length += 1) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = `${prefix}_${randomSuffix(length, rng)}`;
      if (!taken.has(id)) return id;
    }
  }
  // Practically unreachable; fall back to a counter so we never loop forever or collide.
  for (let n = 0; ; n += 1) {
    const id = `${prefix}_${n.toString(36).padStart(8, '0').slice(-8)}`;
    if (!taken.has(id)) return id;
  }
}
