/**
 * Game-UI themes: named token sets (palette, fonts, radii) that all use the same token names, so a
 * screen built with `$panel`, `$primary`, `$outline`... changes look completely when a theme is
 * applied. The widgets in widgets.ts and the game templates use these names.
 */
import { WIDGET_TOKENS } from './widgets';

export interface GameTheme {
  id: string;
  label: string;
  /** One line an agent can use to pick: mood, genre, what it suits. */
  description: string;
  colors: Record<keyof typeof WIDGET_TOKENS.colors, string>;
  fonts: { display: string; body: string };
  radii: Record<keyof typeof WIDGET_TOKENS.radii, number>;
}

const RADII = { sm: 8, md: 14, lg: 20, xl: 28, full: 999 };

export const GAME_THEMES: readonly GameTheme[] = [
  {
    id: 'midnight-arcade',
    label: 'Midnight arcade',
    description:
      'Deep purple ground, hot orange actions, gold and gem accents. The default game look: mobile idle, collection and shop games.',
    colors: { ...WIDGET_TOKENS.colors },
    fonts: { display: 'Lilita One', body: 'Fredoka' },
    radii: { ...RADII },
  },
  {
    id: 'candy-pop',
    label: 'Candy pop',
    description:
      'Bright pink and sky blue with white panels. Casual, kids, match-3 and cute pet games.',
    colors: {
      outline: '#4A1D6B',
      bg: '#FFD6F0',
      panel: '#FFFFFF',
      panelLight: '#FFEDF8',
      slot: '#F6D4F2',
      slotBorder: '#D9A6E8',
      text: '#3B1D5A',
      muted: '#8A5AA8',
      primary: '#FF6FB5',
      gold: '#FFC83D',
      gem: '#2EC4F1',
      hp: '#FF4D6D',
      mana: '#4D9FFF',
      xp: '#A66BFF',
      success: '#3FCB5B',
      danger: '#F2545B',
    },
    fonts: { display: 'Lilita One', body: 'Fredoka' },
    radii: { sm: 12, md: 20, lg: 28, xl: 36, full: 999 },
  },
  {
    id: 'dark-fantasy',
    label: 'Dark fantasy',
    description: 'Charcoal and old gold with blood red. RPGs, dungeon crawlers, card battlers.',
    colors: {
      outline: '#0A0806',
      bg: '#14100D',
      panel: '#2A211A',
      panelLight: '#3A2E24',
      slot: '#1C1611',
      slotBorder: '#6B5438',
      text: '#F4E8D0',
      muted: '#B9A683',
      primary: '#C9962B',
      gold: '#E8B93C',
      gem: '#5BC0BE',
      hp: '#B3202A',
      mana: '#3E6FB0',
      xp: '#8E5BC0',
      success: '#5E9B3E',
      danger: '#C23B3B',
    },
    fonts: { display: 'Luckiest Guy', body: 'Fredoka' },
    radii: { sm: 4, md: 8, lg: 12, xl: 16, full: 999 },
  },
  {
    id: 'neon-arcade',
    label: 'Neon arcade',
    description:
      'Near-black with electric magenta, cyan and lime. Shooters, racers, rhythm and sci-fi HUDs.',
    colors: {
      outline: '#05010F',
      bg: '#0B0620',
      panel: '#161036',
      panelLight: '#211852',
      slot: '#0F0A2B',
      slotBorder: '#3B2E9E',
      text: '#F2F0FF',
      muted: '#A9A0E8',
      primary: '#FF2E97',
      gold: '#FFE14D',
      gem: '#19E6FF',
      hp: '#FF3860',
      mana: '#3D8BFF',
      xp: '#B04DFF',
      success: '#2CFF8A',
      danger: '#FF3860',
    },
    fonts: { display: 'Bungee', body: 'Fredoka' },
    radii: { sm: 4, md: 8, lg: 12, xl: 18, full: 999 },
  },
  {
    id: 'sunny-adventure',
    label: 'Sunny adventure',
    description:
      'Warm sand and sky with leafy green. Platformers, farming, family and explore games.',
    colors: {
      outline: '#3A2410',
      bg: '#BFE7FF',
      panel: '#FFF1D0',
      panelLight: '#FFE2A3',
      slot: '#F2D49B',
      slotBorder: '#C9A15B',
      text: '#3A2410',
      muted: '#7A5A36',
      primary: '#FF8A1F',
      gold: '#FFC83D',
      gem: '#2EC4F1',
      hp: '#E8433C',
      mana: '#3F8CE8',
      xp: '#8E5BC0',
      success: '#4CB944',
      danger: '#E8433C',
    },
    fonts: { display: 'Lilita One', body: 'Fredoka' },
    radii: { sm: 10, md: 16, lg: 22, xl: 30, full: 999 },
  },
  {
    id: 'frost-tech',
    label: 'Frost tech',
    description: 'Cool slate and ice blue with clean white. Strategy, space and management sims.',
    colors: {
      outline: '#0B1A2B',
      bg: '#0E1E30',
      panel: '#1B3350',
      panelLight: '#24476B',
      slot: '#12273F',
      slotBorder: '#3F6E9E',
      text: '#EAF6FF',
      muted: '#9CC3E3',
      primary: '#2FA7F5',
      gold: '#F5C84B',
      gem: '#6EE7F2',
      hp: '#F2545B',
      mana: '#4D9FFF',
      xp: '#9B6BFF',
      success: '#3FCB5B',
      danger: '#F2545B',
    },
    fonts: { display: 'Bungee', body: 'Fredoka' },
    radii: { sm: 4, md: 8, lg: 10, xl: 14, full: 999 },
  },
  {
    id: 'cartoon-light',
    label: 'Cartoon light',
    description:
      'Cream panels, thick dark outlines, saturated primaries on a light ground. Puzzle and party games.',
    colors: {
      outline: '#1F1A3D',
      bg: '#FFF6E5',
      panel: '#FFFFFF',
      panelLight: '#F1ECFF',
      slot: '#E9E3FA',
      slotBorder: '#B7A9E8',
      text: '#1F1A3D',
      muted: '#6C6396',
      primary: '#FF7A1A',
      gold: '#FFC83D',
      gem: '#2EC4F1',
      hp: '#FF4D6D',
      mana: '#4D9FFF',
      xp: '#9B6BFF',
      success: '#3FCB5B',
      danger: '#F2545B',
    },
    fonts: { display: 'Luckiest Guy', body: 'Fredoka' },
    radii: { sm: 10, md: 16, lg: 24, xl: 32, full: 999 },
  },
];

export function findTheme(id: string): GameTheme | undefined {
  const key = id
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  return GAME_THEMES.find(
    (t) => t.id === key || t.label.toLowerCase().replace(/\s+/g, '-') === key,
  );
}

/** The tokens a theme sets (as a patch for `mergeTokens`). */
export function themePatch(theme: GameTheme): {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  radii: Record<string, number>;
} {
  // `heading` follows `display` so templates that use either keep matching.
  return {
    colors: { ...theme.colors },
    fonts: { display: theme.fonts.display, heading: theme.fonts.display, body: theme.fonts.body },
    radii: { ...theme.radii },
  };
}
