/**
 * "Did you mean": a concrete correction for a bad property value, when one can be guessed (the
 * token it probably meant, the number inside a string, the keyword for a CSS habit). Only ever
 * advice appended to an error hint; nothing is applied silently.
 */
import type { Tokens } from './types';

const COLOR_KEYS = new Set(['fill', 'stroke', 'color']);
// The CSS colour names an agent is most likely to reach for.
const NAMED_COLORS = new Set([
  'red',
  'green',
  'blue',
  'black',
  'white',
  'gray',
  'grey',
  'orange',
  'yellow',
  'purple',
  'pink',
  'gold',
]);
const WEIGHT_WORDS: Record<string, number> = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
  heavy: 900,
};

function findName(record: Record<string, unknown>, wanted: string): string | undefined {
  const lower = wanted.toLowerCase();
  return Object.keys(record).find((k) => k.toLowerCase() === lower);
}

const list = (names: string[]): string => (names.length > 0 ? names.join(', ') : 'none defined');

export function suggest(key: string, value: unknown, tokens?: Tokens): string | null {
  if (typeof value === 'number') {
    if (key === 'opacity' && value > 1 && value <= 100) {
      return `opacity runs from 0 to 1; use ${value / 100}.`;
    }
    return null;
  }
  if (typeof value !== 'string') return null;
  const bare = value.replace(/^\$/, '');
  const numeric = /^(-?\d+(?:\.\d+)?)(?:px)?$/.exec(value.trim());

  if (key === 'radius') {
    const name = bare.replace(/^radius\./i, '');
    const found = tokens ? findName(tokens.radii, name) : undefined;
    if (found !== undefined) return `Use "$radius.${found}".`;
    if (numeric) return `Use the number ${numeric[1]} (no quotes, no unit).`;
    if (tokens) {
      return `Radius tokens: ${list(Object.keys(tokens.radii))}; write one as "$radius.<name>".`;
    }
  }
  if (COLOR_KEYS.has(key)) {
    const found = tokens ? findName(tokens.colors, bare) : undefined;
    if (found !== undefined) return `Use "$${found}".`;
    if (/^[0-9a-f]{3,8}$/i.test(value)) return `Hex colours need a leading #: "#${value}".`;
    if (NAMED_COLORS.has(value.toLowerCase())) {
      return `Named CSS colours are not supported; use a hex value such as #FF0000 or a colour token (${list(Object.keys(tokens?.colors ?? {}))}).`;
    }
  }
  if (key === 'fontFamily') {
    const name = bare.replace(/^font\./i, '');
    const found = tokens ? findName(tokens.fonts, name) : undefined;
    if (found !== undefined && value !== `$font.${found}`) return `Use "$font.${found}".`;
  }
  if (key === 'w' || key === 'h') {
    if (numeric) return `Use the number ${numeric[1]} (no quotes, no unit).`;
    if (/^(?:auto|fit-content|hug-content|content)$/i.test(value)) {
      return "Use 'hug' to fit the content.";
    }
    if (/^(?:100%|full|stretch|fill-container|1fr)$/i.test(value)) {
      return "Use 'fill' to take the available space.";
    }
  }
  if (key === 'fontWeight') {
    const word = WEIGHT_WORDS[value.toLowerCase().replace(/[\s-]/g, '')];
    if (word !== undefined) return `Use the number ${word}.`;
  }
  if ((value === 'true' || value === 'false') && !numeric) return `Use ${value} without quotes.`;
  if (numeric && key !== 'name' && key !== 'text')
    return `Use the number ${numeric[1]} (no quotes).`;
  return null;
}

/** Names of the tokens in a group, for "defined tokens are ..." messages. */
export function tokenNames(tokens: Tokens, group: 'color' | 'font' | 'radius'): string[] {
  return Object.keys(
    group === 'color' ? tokens.colors : group === 'font' ? tokens.fonts : tokens.radii,
  );
}
