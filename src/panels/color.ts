/** Hex colour helpers for the colour field. Everything else (rgb(), hsl(), tokens) is shown as text. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0-1 */
  a: number;
}

export function parseHex(value: string): Rgba | null {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!m || !m[1]) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  return {
    r: n(0),
    g: n(2),
    b: n(4),
    a: h.length === 8 ? Math.round((n(6) / 255) * 100) / 100 : 1,
  };
}

const hex2 = (n: number): string =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

/** `#RRGGBB`, or `#RRGGBBAA` when not fully opaque. */
export function toHex({ r, g, b, a }: Rgba): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return a >= 1 ? base : `${base}${hex2(a * 255)}`;
}

/** Normalises what a user typed in the hex box: adds the `#`, expands shorthand; null if invalid. */
export function normalizeHexInput(text: string): string | null {
  const t = text.trim();
  const withHash = t.startsWith('#') ? t : `#${t}`;
  const rgba = parseHex(withHash);
  return rgba ? toHex(rgba) : null;
}

/** Black or white, whichever reads better on this background (for swatch labels). */
export function readableOn(rgba: Rgba): '#000000' | '#FFFFFF' {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin(rgba.r) + 0.7152 * lin(rgba.g) + 0.0722 * lin(rgba.b);
  return lum > 0.4 ? '#000000' : '#FFFFFF';
}
