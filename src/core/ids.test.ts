import { describe, expect, it } from 'vitest';
import { generateId, isValidId, isValidTempId, seededRng } from './ids';

describe('generateId', () => {
  it('produces prefixed 5-char base36 ids that satisfy the id pattern', () => {
    const rng = seededRng(1);
    for (const prefix of ['n', 'a', 'r', 'img'] as const) {
      const id = generateId(prefix, new Set(), rng);
      expect(id).toMatch(new RegExp(`^${prefix}_[a-z0-9]{5}$`));
      expect(isValidId(id, prefix)).toBe(true);
    }
  });

  it('is deterministic for a seeded rng', () => {
    const a = generateId('n', new Set(), seededRng(42));
    const b = generateId('n', new Set(), seededRng(42));
    expect(a).toBe(b);
  });

  it('never returns an id that is already taken', () => {
    const taken = new Set<string>();
    const rng = seededRng(7);
    for (let i = 0; i < 2000; i += 1) {
      const id = generateId('n', taken, rng);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });

  it('still terminates and avoids collisions with a degenerate rng', () => {
    const taken = new Set<string>();
    const stuck = (): number => 0;
    for (let i = 0; i < 40; i += 1) {
      const id = generateId('n', taken, stuck);
      expect(isValidId(id)).toBe(true);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });

  it('falls back to a counter when every random candidate collides', () => {
    // A set that claims everything random-looking is taken, but not the counter ids.
    const taken = { has: (id: string) => !/^n_0{7}[0-9a-z]$/.test(id) };
    const id = generateId('n', taken, () => 0.5);
    expect(id).toBe('n_00000000');
  });
});

describe('id validation', () => {
  it('accepts fixture-style and generated ids', () => {
    expect(isValidId('n_0001')).toBe(true);
    expect(isValidId('n_k3x9a')).toBe(true);
    expect(isValidId('img_ab12cd')).toBe(true);
  });

  it('rejects wrong shapes and prefixes', () => {
    expect(isValidId('n_abc')).toBe(false); // too short
    expect(isValidId('n_ABCDE')).toBe(false); // upper case
    expect(isValidId('x_abcde')).toBe(false);
    expect(isValidId('$hero')).toBe(false);
    expect(isValidId(42)).toBe(false);
    expect(isValidId('a_abcde', 'n')).toBe(false);
  });

  it('validates temp ids', () => {
    expect(isValidTempId('hero')).toBe(true);
    expect(isValidTempId('card-1_a')).toBe(true);
    expect(isValidTempId('1abc')).toBe(false);
    expect(isValidTempId('$hero')).toBe(false);
    expect(isValidTempId('a'.repeat(33))).toBe(false);
  });
});

describe('seededRng', () => {
  it('stays in [0, 1)', () => {
    const rng = seededRng(123);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
