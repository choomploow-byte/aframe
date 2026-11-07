import { describe, expect, it } from 'vitest';
import { iconArt } from './icon-art';

describe('icon art', () => {
  it('draws a known icon as one path in currentColor, with the even-odd rule when it has holes', () => {
    const coins = iconArt('coins', 24, 24);
    expect(coins.placeholder).toBe(false);
    expect(coins.parts).toHaveLength(1);
    expect(coins.parts[0]?.attrs.fill).toBe('currentColor');
    expect(coins.parts[0]?.attrs['fill-rule']).toBeUndefined();
    expect(iconArt('potion', 24, 24).parts[0]?.attrs['fill-rule']).toBe('evenodd');
    expect(iconArt('FA-Gem', 24, 24).placeholder).toBe(false); // names are normalised
  });

  it('draws a labelled dashed placeholder for an unknown or missing name', () => {
    const big = iconArt('dragon-egg', 64, 64);
    expect(big.placeholder).toBe(true);
    expect(big.parts.find((p) => p.tag === 'rect')?.attrs['stroke-dasharray']).toBeDefined();
    expect(big.parts.filter((p) => p.tag === 'text').map((p) => p.text)).toEqual([
      '?',
      'dragon-egg',
    ]);
    // small icons have no room for the name, only the question mark
    expect(iconArt('dragon-egg', 24, 24).parts.filter((p) => p.tag === 'text')).toHaveLength(1);
    expect(
      iconArt(undefined, 64, 64)
        .parts.map((p) => p.text)
        .join(' '),
    ).toContain('no name');
    // long names are shortened, never overflow
    const long = iconArt('an-extremely-long-icon-name', 80, 80).parts.at(-1)?.text ?? '';
    expect(long.length).toBeLessThanOrEqual(10);
    expect(long.endsWith('…')).toBe(true);
  });
});
