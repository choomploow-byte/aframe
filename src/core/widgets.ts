/**
 * Game-UI widgets: ready-made, well-built node trees for the controls every game screen needs
 * (chunky buttons, currency pills, progress bars, item slots, panels...). A widget is plain
 * `NodeSpec`s built from the token set, so it is editable like anything else, and the buttons,
 * slots and tabs come with hover / pressed / disabled / selected states when asked for.
 *
 * Pure: no document access. `create_widget` (tools-game.ts) and the editor's "Insert widget"
 * commands both call `buildWidget`.
 */
import { getIcon } from './icons';
import { CoreError } from './errors';
import type { ComponentKind, NodeSpec, Tokens } from './types';

export const WIDGET_KINDS = [
  'button',
  'icon_button',
  'currency_pill',
  'progress_bar',
  'item_slot',
  'item_card',
  'panel',
  'modal',
  'title_banner',
  'tab_bar',
  'stat_row',
  'rating_stars',
  'toggle',
  'slider',
  'badge',
  'toast',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const TONES = ['primary', 'success', 'danger', 'info', 'purple', 'neutral'] as const;
export type Tone = (typeof TONES)[number];

export const RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface WidgetOptions {
  /** Button / banner / badge / toast text. */
  label?: string;
  /** Icon name (search_icons). Buttons, slots, pills, stat rows, toasts. */
  icon?: string;
  /** A named colour (primary, success, danger, info, purple, neutral) or any #hex. */
  tone?: string;
  size?: 'sm' | 'md' | 'lg';
  /** progress_bar: 0..1. slider: 0..1. rating_stars: how many are filled. currency_pill / stat_row: the shown amount. */
  value?: number | string;
  /** rating_stars: how many stars (default 5). */
  max?: number;
  /** item_slot / badge: stack count. */
  count?: number;
  rarity?: Rarity;
  /** tab_bar: tab names. progress_bar: nothing. */
  items?: string[];
  /** tab_bar: the active tab (0-based). item_slot: shown selected. toggle: on. */
  active?: number;
  on?: boolean;
  selected?: boolean;
  shape?: 'circle' | 'rounded' | 'square';
  /** Width / height in px; each widget has a sensible default. */
  w?: number;
  h?: number;
  /** panel / modal / item_card heading, and item_card name. */
  title?: string;
  body?: string;
  /** modal: footer buttons. */
  buttons?: { label: string; tone?: string }[];
  /** item_card: price shown on the buy button. */
  price?: string | number;
  /** currency_pill: draw a "+" button. progress_bar: number of divider notches. */
  plus?: boolean;
  segments?: number;
}

export interface WidgetResult {
  spec: NodeSpec;
  /** Present when the widget has states worth a component: the host can define it. */
  component?: {
    kind: ComponentKind;
    states: Record<string, Record<string, Record<string, unknown>>>;
  };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Colour helpers (hex only; widget colours are authored here, tokens are used for the rest)
// ---------------------------------------------------------------------------

const HEX = /^#([0-9a-f]{6})$/i;

function parseHex(hex: string): [number, number, number] {
  const m = HEX.exec(hex);
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1] as string, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()}`;
}

/** Blends `hex` toward `to` by `t` (0..1). */
export function mixHex(hex: string, to: string, t: number): string {
  const a = parseHex(hex);
  const b = parseHex(to);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

interface ToneColors {
  base: string;
  hi: string;
  lo: string;
}

const TONE_BASE: Record<Tone, string> = {
  primary: '#FFA41B',
  success: '#3FCB5B',
  danger: '#F2545B',
  info: '#2FA7F5',
  purple: '#9B6BFF',
  neutral: '#6F668F',
};

export function toneColors(tone: string | undefined): ToneColors {
  const name = (tone ?? 'primary') as Tone;
  const base = HEX.test(tone ?? '')
    ? (tone as string).toUpperCase()
    : (TONE_BASE[name] ?? TONE_BASE.primary);
  return { base, hi: mixHex(base, '#FFFFFF', 0.32), lo: mixHex(base, '#000000', 0.34) };
}

const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9AA3B5',
  rare: '#4D9FFF',
  epic: '#B28CFF',
  legendary: '#FFC83D',
};

// ---------------------------------------------------------------------------
// Tokens a widget relies on. Missing ones are added; existing ones are never changed.
// ---------------------------------------------------------------------------

export const WIDGET_TOKENS = {
  colors: {
    outline: '#120B24',
    bg: '#1B1330',
    panel: '#2D2250',
    panelLight: '#3B2E68',
    slot: '#241A44',
    slotBorder: '#4C3C86',
    text: '#FFFFFF',
    muted: '#C9BEF0',
    primary: '#FFA41B',
    gold: '#FFC83D',
    gem: '#38D6FF',
    hp: '#FF4D6D',
    mana: '#4D9FFF',
    xp: '#B28CFF',
    success: '#3FCB5B',
    danger: '#F2545B',
  },
  fonts: { display: 'Lilita One', body: 'Fredoka' },
  radii: { sm: 8, md: 14, lg: 20, xl: 28, full: 999 },
} as const;

/** The widget tokens that `tokens` does not have yet. */
export function missingWidgetTokens(tokens: Tokens): {
  colors: Record<string, string>;
  fonts: Record<string, string>;
  radii: Record<string, number>;
} {
  const pick = <T>(want: Record<string, T>, have: Record<string, unknown>): Record<string, T> =>
    Object.fromEntries(Object.entries(want).filter(([k]) => !(k in have)));
  return {
    colors: pick<string>(WIDGET_TOKENS.colors, tokens.colors),
    fonts: pick<string>(WIDGET_TOKENS.fonts, tokens.fonts),
    radii: pick<number>(WIDGET_TOKENS.radii, tokens.radii),
  };
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const OUT = '$outline';
const DISPLAY = '$font.display';
const BODY = '$font.body';

function checkIcon(name: string | undefined, kind: string): void {
  if (name !== undefined && !getIcon(name)) {
    throw new CoreError(
      'NOT_FOUND',
      `There is no icon named "${name}" (for the ${kind} widget).`,
      'Use search_icons to find a name.',
    );
  }
}

function outlinedText(
  text: string,
  size: number,
  extra: Partial<NodeSpec> = {},
  name = 'Label',
): NodeSpec {
  return {
    type: 'text',
    name,
    text,
    w: 'hug',
    fontFamily: DISPLAY,
    fontSize: size,
    color: '#FFFFFF',
    textStroke: OUT,
    textStrokeWidth: Math.max(2, Math.round(size / 9)),
    ...(/^[^a-z]*$/.test(text) ? { letterSpacing: 0.04 } : {}),
    ...extra,
  };
}

function chunkyFill(t: ToneColors): Partial<NodeSpec> {
  return {
    fill: `linear-gradient(180deg, ${t.hi}, ${t.base})`,
    stroke: OUT,
    strokeWidth: 3,
    effects: ['gloss-top', { preset: 'hard-3d-bottom', color: t.lo }],
  };
}

function chunkyStates(
  t: ToneColors,
  withLabel: boolean,
): Record<string, Record<string, Record<string, unknown>>> {
  const lighter = mixHex(t.base, '#FFFFFF', 0.5);
  const label = (patch: Record<string, unknown>): Record<string, Record<string, unknown>> =>
    withLabel ? { Label: patch } : {};
  return {
    hover: { $self: { fill: `linear-gradient(180deg, ${lighter}, ${t.hi})` } },
    pressed: {
      $self: { fill: `linear-gradient(180deg, ${t.base}, ${t.lo})`, effects: ['bevel-pressed'] },
    },
    disabled: {
      $self: { fill: 'linear-gradient(180deg, #8A83A8, #6B6488)', effects: [] },
      ...label({ color: '#CFC9E3', textStroke: '#4B4566' }),
    },
  };
}

const BUTTON_SIZES = {
  sm: { font: 20, pad: [8, 22, 12, 22], icon: 22 },
  md: { font: 28, pad: [12, 34, 16, 34], icon: 30 },
  lg: { font: 38, pad: [16, 46, 22, 46], icon: 40 },
} as const;

function button(o: WidgetOptions): WidgetResult {
  checkIcon(o.icon, 'button');
  const sz = BUTTON_SIZES[o.size ?? 'md'];
  const t = toneColors(o.tone);
  const children: NodeSpec[] = [];
  if (o.icon) {
    children.push({
      type: 'icon',
      name: 'Icon',
      icon: o.icon,
      w: sz.icon,
      h: sz.icon,
      color: '#FFFFFF',
    });
  }
  children.push(outlinedText(o.label ?? 'PLAY', sz.font));
  return {
    spec: {
      type: 'frame',
      name: 'Button',
      role: 'button',
      layout: 'row',
      align: 'center',
      justify: 'center',
      gap: 10,
      padding: [...sz.pad],
      w: o.w ?? 'hug',
      h: 'hug',
      radius: '$radius.full',
      ...chunkyFill(t),
      children,
    },
    component: { kind: 'button', states: chunkyStates(t, true) },
    warnings: [],
  };
}

function iconButton(o: WidgetOptions): WidgetResult {
  const icon = o.icon ?? 'gear';
  checkIcon(icon, 'icon_button');
  const size = o.w ?? (o.size === 'sm' ? 44 : o.size === 'lg' ? 76 : 58);
  const t = toneColors(o.tone ?? 'info');
  const shape = o.shape ?? 'circle';
  return {
    spec: {
      type: 'frame',
      name: 'Icon Button',
      role: 'button',
      layout: 'row',
      align: 'center',
      justify: 'center',
      w: size,
      h: size,
      radius:
        shape === 'circle' ? '$radius.full' : shape === 'rounded' ? '$radius.md' : '$radius.sm',
      ...chunkyFill(t),
      children: [
        {
          type: 'icon',
          name: 'Icon',
          icon,
          w: Math.round(size * 0.52),
          h: Math.round(size * 0.52),
          color: '#FFFFFF',
        },
      ],
    },
    component: { kind: 'button', states: chunkyStates(t, false) },
    warnings: [],
  };
}

function currencyPill(o: WidgetOptions): WidgetResult {
  const icon = o.icon ?? 'coins';
  checkIcon(icon, 'currency_pill');
  const gem = icon === 'gem';
  const t = toneColors(gem ? '#38D6FF' : '#FFC83D');
  const children: NodeSpec[] = [
    {
      type: 'frame',
      name: 'Coin',
      layout: 'row',
      align: 'center',
      justify: 'center',
      w: 40,
      h: 40,
      radius: '$radius.full',
      fill: `linear-gradient(180deg, ${t.hi}, ${t.base})`,
      stroke: OUT,
      strokeWidth: 3,
      children: [{ type: 'icon', name: 'Icon', icon, w: 22, h: 22, color: '#FFFFFF' }],
    },
    outlinedText(String(o.value ?? '1,250'), 26, { w: 'fill', textAlign: 'right' }, 'Amount'),
  ];
  if (o.plus) {
    const g = toneColors('success');
    children.push({
      type: 'frame',
      name: 'Add',
      role: 'button',
      layout: 'row',
      align: 'center',
      justify: 'center',
      w: 34,
      h: 34,
      radius: '$radius.full',
      ...chunkyFill(g),
      effects: ['gloss-top'],
      children: [{ type: 'icon', name: 'Icon', icon: 'plus', w: 18, h: 18, color: '#FFFFFF' }],
    });
  }
  return {
    spec: {
      type: 'frame',
      name: 'Currency Pill',
      layout: 'row',
      align: 'center',
      gap: 10,
      padding: [4, o.plus ? 4 : 18, 4, 4],
      w: o.w ?? (o.plus ? 220 : 180),
      h: 'hug',
      radius: '$radius.full',
      fill: '$slot',
      stroke: OUT,
      strokeWidth: 3,
      effects: ['bevel-pressed'],
      children,
    },
    warnings: [],
  };
}

function progressBar(o: WidgetOptions): WidgetResult {
  const w = o.w ?? 260;
  const h = o.h ?? 30;
  const v = Math.max(0, Math.min(1, typeof o.value === 'number' ? o.value : 0.65));
  const t = toneColors(o.tone ?? 'success');
  const stroke = 3;
  const innerW = w - stroke * 2;
  const innerH = h - stroke * 2;
  const fillW = Math.round(innerW * v);
  const track: NodeSpec[] = [];
  if (fillW > 0) {
    track.push({
      type: 'rect',
      name: 'Fill',
      x: 0,
      y: 0,
      w: fillW,
      h: innerH,
      radius: '$radius.full',
      fill: `linear-gradient(180deg, ${t.hi}, ${t.base})`,
      effects: ['gloss-top'],
    });
  }
  const notches = Math.max(0, Math.min(20, Math.round(o.segments ?? 0)));
  for (let i = 1; i < notches; i += 1) {
    track.push({
      type: 'rect',
      name: `Notch ${i}`,
      x: Math.round((innerW / notches) * i) - 1,
      y: 0,
      w: 3,
      h: innerH,
      fill: '$outline',
      opacity: 0.55,
    });
  }
  if (o.label) {
    track.push({
      type: 'frame',
      name: 'Label Holder',
      x: 0,
      y: 0,
      w: innerW,
      h: innerH,
      layout: 'row',
      align: 'center',
      justify: 'center',
      children: [outlinedText(o.label, Math.max(12, Math.round(innerH * 0.62)), {}, 'Label')],
    });
  }
  const bar: NodeSpec = {
    type: 'frame',
    name: 'Progress Bar',
    layout: 'none',
    w,
    h,
    radius: '$radius.full',
    fill: '$slot',
    stroke: OUT,
    strokeWidth: stroke,
    clip: true,
    effects: ['bevel-pressed'],
    children: [
      {
        type: 'frame',
        name: 'Track',
        layout: 'none',
        x: 0,
        y: 0,
        w: innerW,
        h: innerH,
        children: track,
      },
    ],
  };
  if (!o.icon) return { spec: bar, warnings: [] };
  checkIcon(o.icon, 'progress_bar');
  return {
    spec: {
      type: 'frame',
      name: 'Progress With Icon',
      layout: 'row',
      align: 'center',
      gap: 8,
      w: 'hug',
      h: 'hug',
      children: [
        {
          type: 'frame',
          name: 'Badge',
          layout: 'row',
          align: 'center',
          justify: 'center',
          w: Math.round(h * 1.5),
          h: Math.round(h * 1.5),
          radius: '$radius.full',
          ...chunkyFill(t),
          children: [
            {
              type: 'icon',
              name: 'Icon',
              icon: o.icon,
              w: Math.round(h * 0.8),
              h: Math.round(h * 0.8),
              color: '#FFFFFF',
            },
          ],
        },
        bar,
      ],
    },
    warnings: [],
  };
}

function itemSlot(o: WidgetOptions): WidgetResult {
  const size = o.w ?? (o.size === 'sm' ? 64 : o.size === 'lg' ? 112 : 88);
  const rarity = o.rarity ?? 'common';
  const edge = RARITY_COLOR[rarity];
  const icon = o.icon ?? 'sword';
  checkIcon(icon, 'item_slot');
  const iconSize = Math.round(size * 0.56);
  const children: NodeSpec[] = [
    {
      type: 'icon',
      name: 'Icon',
      icon,
      x: Math.round((size - iconSize) / 2),
      y: Math.round((size - iconSize) / 2) - 2,
      w: iconSize,
      h: iconSize,
      color: edge === RARITY_COLOR.common ? '$text' : edge,
    },
  ];
  if (o.count !== undefined && o.count > 1) {
    children.push(
      outlinedText(
        String(o.count),
        Math.max(14, Math.round(size * 0.24)),
        {
          x: 4,
          y: size - Math.max(14, Math.round(size * 0.24)) - 8,
          w: size - 12,
          textAlign: 'right',
          lineHeight: 1,
        },
        'Count',
      ),
    );
  }
  return {
    spec: {
      type: 'frame',
      name: 'Item Slot',
      role: 'button',
      layout: 'none',
      w: size,
      h: size,
      radius: '$radius.md',
      fill: '$slot',
      stroke: o.selected ? '$gold' : edge,
      strokeWidth: 4,
      effects: o.selected
        ? ['bevel-pressed', { preset: 'inner-glow', color: '#FFC83D' }]
        : ['bevel-pressed'],
      children,
    },
    component: {
      kind: 'slot',
      states: {
        hover: {
          $self: { fill: '$panelLight' },
        },
        selected: {
          $self: {
            stroke: '#FFC83D',
            effects: ['bevel-pressed', { preset: 'inner-glow', color: '#FFC83D' }],
          },
        },
        disabled: { $self: { opacity: 0.5 } },
      },
    },
    warnings: [],
  };
}

function itemCard(o: WidgetOptions): WidgetResult {
  const rarity = o.rarity ?? 'common';
  const slot = itemSlot({
    icon: o.icon ?? 'potion',
    rarity,
    size: 'lg',
    ...(o.count === undefined ? {} : { count: o.count }),
  }).spec;
  const buy = button({
    label: String(o.price ?? '250'),
    icon: 'coins',
    tone: 'success',
    size: 'sm',
    w: 144,
  }).spec;
  return {
    spec: {
      type: 'frame',
      name: 'Item Card',
      role: 'card',
      layout: 'column',
      align: 'center',
      gap: 12,
      padding: [16, 16, 16, 16],
      w: o.w ?? 176,
      h: 'hug',
      radius: '$radius.lg',
      fill: '$panel',
      stroke: OUT,
      strokeWidth: 4,
      effects: ['bevel-raised'],
      children: [
        outlinedText(o.title ?? 'Health Potion', 22, { w: 'fill', textAlign: 'center' }, 'Name'),
        slot,
        { ...buy, w: 'fill' },
      ],
    },
    component: {
      kind: 'card',
      states: { hover: { $self: { fill: '#3B2E68' } }, selected: { $self: { stroke: '#FFC83D' } } },
    },
    warnings: [],
  };
}

function panel(o: WidgetOptions, modal: boolean): WidgetResult {
  const w = o.w ?? 420;
  const children: NodeSpec[] = [
    {
      type: 'frame',
      name: 'Header',
      layout: 'row',
      align: 'center',
      justify: 'between',
      w: 'fill',
      h: 'hug',
      children: [
        outlinedText(o.title ?? (modal ? 'Level Up!' : 'Inventory'), 34, {}, 'Title'),
        iconButton({ icon: 'xmark', tone: 'danger', size: 'sm' }).spec,
      ],
    },
    {
      type: 'frame',
      name: 'Body',
      layout: 'column',
      gap: 12,
      padding: [16, 16, 16, 16],
      w: 'fill',
      h: o.h ?? 'hug',
      radius: '$radius.md',
      fill: '$panelLight',
      stroke: OUT,
      strokeWidth: 3,
      effects: ['bevel-pressed'],
      children: [
        {
          type: 'text',
          name: 'Body Text',
          text: o.body ?? 'Put your content here.',
          w: 'fill',
          fontFamily: BODY,
          fontSize: 20,
          lineHeight: 1.35,
          color: '$text',
        },
      ],
    },
  ];
  const buttons = o.buttons ?? (modal ? [{ label: 'CLAIM', tone: 'success' }] : []);
  if (buttons.length > 0) {
    children.push({
      type: 'frame',
      name: 'Actions',
      layout: 'row',
      justify: 'center',
      gap: 14,
      w: 'fill',
      h: 'hug',
      children: buttons.map((b) => {
        checkIcon(undefined, 'modal');
        return button({
          label: b.label,
          ...(b.tone === undefined ? {} : { tone: b.tone }),
          size: 'md',
        }).spec;
      }),
    });
  }
  return {
    spec: {
      type: 'frame',
      name: modal ? 'Modal' : 'Panel',
      role: 'section',
      layout: 'column',
      gap: 16,
      padding: [20, 20, 20, 20],
      w,
      h: 'hug',
      radius: '$radius.xl',
      fill: {
        pattern: 'halftone',
        color: '#FFFFFF',
        size: 3,
        spacing: 9,
        opacity: 0.05,
        background: '$panel',
      },
      stroke: OUT,
      strokeWidth: 4,
      effects: ['bevel-raised', 'hard-3d-bottom'],
      children,
    },
    component: { kind: 'panel', states: {} },
    warnings: [],
  };
}

function titleBanner(o: WidgetOptions): WidgetResult {
  const t = toneColors(o.tone ?? 'purple');
  return {
    spec: {
      type: 'frame',
      name: 'Title Banner',
      layout: 'row',
      align: 'center',
      justify: 'center',
      padding: [10, 56, 16, 56],
      w: o.w ?? 'hug',
      h: 'hug',
      radius: '$radius.md',
      ...chunkyFill(t),
      children: [outlinedText(o.label ?? 'SHOP', 44)],
    },
    warnings: [],
  };
}

function tabBar(o: WidgetOptions): WidgetResult {
  const items = o.items && o.items.length > 0 ? o.items : ['Weapons', 'Armor', 'Potions'];
  const active = Math.max(0, Math.min(items.length - 1, o.active ?? 0));
  const t = toneColors(o.tone ?? 'primary');
  return {
    spec: {
      type: 'frame',
      name: 'Tab Bar',
      layout: 'row',
      align: 'end',
      gap: 8,
      w: o.w ?? 'hug',
      h: 'hug',
      children: items.map((label, i) => ({
        type: 'frame',
        name: `Tab ${label}`,
        role: 'button',
        layout: 'row',
        align: 'center',
        justify: 'center',
        padding: i === active ? [12, 28, 14, 28] : [9, 24, 11, 24],
        w: 'hug',
        h: 'hug',
        radius: [14, 14, 0, 0],
        ...(i === active
          ? { ...chunkyFill(t), effects: ['gloss-top'] }
          : { fill: '$slot', stroke: '$slotBorder', strokeWidth: 3 }),
        children: [
          i === active
            ? outlinedText(label.toUpperCase(), 22)
            : {
                type: 'text',
                name: 'Label',
                text: label.toUpperCase(),
                w: 'hug',
                fontFamily: DISPLAY,
                fontSize: 20,
                letterSpacing: 0.04,
                color: '$muted',
              },
        ],
      })),
    },
    warnings: [],
  };
}

function statRow(o: WidgetOptions): WidgetResult {
  const icon = o.icon ?? 'heart';
  checkIcon(icon, 'stat_row');
  const iconColor =
    { heart: '$hp', 'heart-pulse': '$hp', bolt: '$gold', gem: '$gem', shield: '$mana' }[icon] ??
    '$gold';
  return {
    spec: {
      type: 'frame',
      name: 'Stat Row',
      layout: 'row',
      align: 'center',
      justify: 'between',
      gap: 10,
      padding: [10, 16, 10, 14],
      w: o.w ?? 280,
      h: 'hug',
      radius: '$radius.md',
      fill: '$slot',
      stroke: '$slotBorder',
      strokeWidth: 2,
      children: [
        {
          type: 'frame',
          name: 'Left',
          layout: 'row',
          align: 'center',
          gap: 10,
          w: 'hug',
          h: 'hug',
          children: [
            { type: 'icon', name: 'Icon', icon, w: 26, h: 26, color: iconColor },
            {
              type: 'text',
              name: 'Label',
              text: o.label ?? 'Health',
              w: 'hug',
              fontFamily: BODY,
              fontSize: 20,
              fontWeight: 500,
              color: '$muted',
            },
          ],
        },
        outlinedText(String(o.value ?? '120'), 24, {}, 'Value'),
      ],
    },
    warnings: [],
  };
}

function ratingStars(o: WidgetOptions): WidgetResult {
  const max = Math.max(1, Math.min(10, Math.round(o.max ?? 5)));
  const filled = Math.max(0, Math.min(max, Math.round(typeof o.value === 'number' ? o.value : 3)));
  const size = o.w ?? (o.size === 'sm' ? 22 : o.size === 'lg' ? 48 : 34);
  return {
    spec: {
      type: 'frame',
      name: 'Stars',
      layout: 'row',
      align: 'center',
      gap: Math.round(size / 8),
      w: 'hug',
      h: 'hug',
      children: Array.from({ length: max }, (_, i) => ({
        type: 'icon' as const,
        name: i < filled ? 'Star Full' : 'Star Empty',
        icon: 'star',
        w: size,
        h: size,
        color: i < filled ? '$gold' : '$slotBorder',
      })),
    },
    warnings: [],
  };
}

function toggle(o: WidgetOptions): WidgetResult {
  const on = o.on ?? o.selected ?? true;
  const g = toneColors('success');
  return {
    spec: {
      type: 'frame',
      name: 'Toggle',
      role: 'button',
      layout: 'none',
      w: 76,
      h: 40,
      radius: '$radius.full',
      fill: on ? `linear-gradient(180deg, ${g.hi}, ${g.base})` : '$slot',
      stroke: OUT,
      strokeWidth: 3,
      effects: ['bevel-pressed'],
      children: [
        {
          type: 'rect',
          name: 'Knob',
          x: on ? 38 : 4,
          y: 4,
          w: 28,
          h: 28,
          radius: '$radius.full',
          fill: 'linear-gradient(180deg, #FFFFFF, #D8D2EE)',
          stroke: OUT,
          strokeWidth: 3,
        },
      ],
    },
    warnings: [],
  };
}

function slider(o: WidgetOptions): WidgetResult {
  const w = o.w ?? 260;
  const v = Math.max(0, Math.min(1, typeof o.value === 'number' ? o.value : 0.5));
  const t = toneColors(o.tone ?? 'info');
  const knob = 36;
  const trackH = 16;
  const fillW = Math.round((w - 6) * v);
  return {
    spec: {
      type: 'frame',
      name: 'Slider',
      layout: 'none',
      w,
      h: knob,
      children: [
        {
          type: 'frame',
          name: 'Track',
          layout: 'none',
          x: 0,
          y: (knob - trackH) / 2,
          w,
          h: trackH,
          radius: '$radius.full',
          fill: '$slot',
          stroke: OUT,
          strokeWidth: 3,
          clip: true,
          effects: ['bevel-pressed'],
          children: [
            {
              type: 'rect',
              name: 'Fill',
              x: 0,
              y: 0,
              w: Math.max(0, fillW),
              h: trackH - 6,
              radius: '$radius.full',
              fill: `linear-gradient(180deg, ${t.hi}, ${t.base})`,
            },
          ],
        },
        {
          type: 'rect',
          name: 'Knob',
          x: Math.round((w - knob) * v),
          y: 0,
          w: knob,
          h: knob,
          radius: '$radius.full',
          fill: 'linear-gradient(180deg, #FFFFFF, #D8D2EE)',
          stroke: OUT,
          strokeWidth: 3,
          effects: [{ preset: 'hard-3d-bottom', color: '#9A92BB' }],
        },
      ],
    },
    warnings: [],
  };
}

function badge(o: WidgetOptions): WidgetResult {
  const t = toneColors(o.tone ?? 'danger');
  return {
    spec: {
      type: 'frame',
      name: 'Badge',
      layout: 'row',
      align: 'center',
      justify: 'center',
      padding: [2, 9, 4, 9],
      w: 'hug',
      h: 'hug',
      radius: '$radius.full',
      fill: `linear-gradient(180deg, ${t.hi}, ${t.base})`,
      stroke: '#FFFFFF',
      strokeWidth: 3,
      children: [outlinedText(o.label ?? String(o.count ?? 3), 18)],
    },
    warnings: [],
  };
}

function toast(o: WidgetOptions): WidgetResult {
  const icon = o.icon ?? 'circle-check';
  checkIcon(icon, 'toast');
  const t = toneColors(o.tone ?? 'success');
  return {
    spec: {
      type: 'frame',
      name: 'Toast',
      layout: 'row',
      align: 'center',
      gap: 12,
      padding: [12, 22, 12, 14],
      w: o.w ?? 'hug',
      h: 'hug',
      radius: '$radius.lg',
      fill: '$panel',
      stroke: OUT,
      strokeWidth: 3,
      effects: ['bevel-raised'],
      children: [
        {
          type: 'frame',
          name: 'Medallion',
          layout: 'row',
          align: 'center',
          justify: 'center',
          w: 40,
          h: 40,
          radius: '$radius.full',
          ...chunkyFill(t),
          effects: ['gloss-top'],
          children: [{ type: 'icon', name: 'Icon', icon, w: 22, h: 22, color: '#FFFFFF' }],
        },
        outlinedText(o.label ?? 'Quest complete!', 24),
      ],
    },
    component: { kind: 'toast', states: {} },
    warnings: [],
  };
}

export function buildWidget(kind: WidgetKind, options: WidgetOptions = {}): WidgetResult {
  switch (kind) {
    case 'button':
      return button(options);
    case 'icon_button':
      return iconButton(options);
    case 'currency_pill':
      return currencyPill(options);
    case 'progress_bar':
      return progressBar(options);
    case 'item_slot':
      return itemSlot(options);
    case 'item_card':
      return itemCard(options);
    case 'panel':
      return panel(options, false);
    case 'modal':
      return panel(options, true);
    case 'title_banner':
      return titleBanner(options);
    case 'tab_bar':
      return tabBar(options);
    case 'stat_row':
      return statRow(options);
    case 'rating_stars':
      return ratingStars(options);
    case 'toggle':
      return toggle(options);
    case 'slider':
      return slider(options);
    case 'badge':
      return badge(options);
    case 'toast':
      return toast(options);
  }
}

/** One line per widget for tool descriptions and the editor's insert menu. */
export const WIDGET_INFO: Record<WidgetKind, { label: string; uses: string }> = {
  button: { label: 'Button', uses: 'label, icon, tone, size, w' },
  icon_button: { label: 'Icon button', uses: 'icon, tone, shape, size' },
  currency_pill: { label: 'Currency pill', uses: 'icon (coins or gem), value, plus, w' },
  progress_bar: { label: 'Progress bar', uses: 'value 0-1, tone, label, icon, segments, w, h' },
  item_slot: { label: 'Item slot', uses: 'icon, rarity, count, selected, size' },
  item_card: { label: 'Shop card', uses: 'title, icon, rarity, price, w' },
  panel: { label: 'Panel', uses: 'title, body, buttons, w' },
  modal: { label: 'Modal', uses: 'title, body, buttons, w' },
  title_banner: { label: 'Title banner', uses: 'label, tone, w' },
  tab_bar: { label: 'Tab bar', uses: 'items, active, tone' },
  stat_row: { label: 'Stat row', uses: 'icon, label, value, w' },
  rating_stars: { label: 'Star rating', uses: 'value (filled), max, size' },
  toggle: { label: 'Toggle', uses: 'on' },
  slider: { label: 'Slider', uses: 'value 0-1, tone, w' },
  badge: { label: 'Count badge', uses: 'count or label, tone' },
  toast: { label: 'Toast', uses: 'label, icon, tone, w' },
};
