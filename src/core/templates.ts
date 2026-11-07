/**
 * Starting points for `create_project` and the New project dialog (docs/05). Every template brings
 * a token set and a starter component kit (a button, card, tab, toast... as masters with hover,
 * pressed, disabled and selected states) and screens built from instances of that kit. They are
 * built through the same validated edits an agent makes, so they double as examples of good
 * structure: auto-layout, tokens, real layer names, components instead of copies.
 */
import { createEmptyDoc } from './doc';
import { DocBuilder, icn, txt } from './template-kit';
import type { Doc, NodeSpec } from './types';

export type TemplateName =
  | 'blank'
  | 'landing'
  | 'dashboard'
  | 'mobile'
  | 'pricing'
  | 'game-hud'
  | 'game-shop'
  | 'game-inventory';

export const TEMPLATES: readonly TemplateName[] = [
  'blank',
  'landing',
  'dashboard',
  'mobile',
  'pricing',
  'game-hud',
  'game-shop',
  'game-inventory',
];

export interface TemplateInfo {
  label: string;
  description: string;
}

export const TEMPLATE_INFO: Record<TemplateName, TemplateInfo> = {
  blank: { label: 'Blank', description: 'An empty canvas with the default tokens.' },
  landing: {
    label: 'Product landing',
    description: 'Nav, hero and feature cards with a button, card and tab kit.',
  },
  dashboard: {
    label: 'SaaS dashboard',
    description: 'Sidebar navigation and stat cards on a 1440 x 900 artboard.',
  },
  mobile: {
    label: 'Mobile app',
    description: 'A 390 x 844 screen with a list and a bottom tab bar.',
  },
  pricing: {
    label: 'Pricing page',
    description: 'Three plan cards with a billing toggle; the plan card is a component.',
  },
  'game-hud': {
    label: 'Game HUD',
    description: 'Health and mana bars, currency, skill slots and an action button, 1280 x 720.',
  },
  'game-shop': {
    label: 'Game shop',
    description: 'Tabs and a grid of shop item cards with prices, 1280 x 720.',
  },
  'game-inventory': {
    label: 'Game inventory',
    description: 'A slot grid, a character panel and an item detail panel, 1280 x 720.',
  },
};

// ---------------------------------------------------------------------------
// Product kit (landing, dashboard, mobile, pricing)
// ---------------------------------------------------------------------------

const PRODUCT_TOKENS = {
  colors: {
    primaryHover: '#4A2F94',
    primaryPressed: '#3C2678',
    success: '#2E7D5B',
    danger: '#B3261E',
  },
};

/** The kit board: masters laid out in a wrapping row to the right of the screens. */
function productKit(b: DocBuilder, x: number, withPlan = false): void {
  const board = b.add(b.doc.rootId, {
    type: 'frame',
    name: 'Components',
    x,
    y: 0,
    w: 760,
    h: 'hug',
    layout: 'row',
    wrap: true,
    gap: 24,
    padding: [32, 32, 32, 32],
    fill: '$surface2',
    stroke: '$border',
    radius: '$radius.lg',
  });

  b.master(
    board,
    {
      type: 'frame',
      name: 'Button Primary',
      role: 'button',
      layout: 'row',
      align: 'center',
      justify: 'center',
      padding: [12, 24, 12, 24],
      radius: '$radius.md',
      fill: '$primary',
      children: [txt('Label', 'Button', { fontWeight: 600, color: '#FFFFFF' })],
    },
    'button',
    {
      hover: { $self: { fill: '$primaryHover' } },
      pressed: { $self: { fill: '$primaryPressed' } },
      disabled: { $self: { fill: '$border' }, Label: { color: '$muted' } },
    },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Button Secondary',
      role: 'button',
      layout: 'row',
      align: 'center',
      justify: 'center',
      padding: [12, 24, 12, 24],
      radius: '$radius.md',
      fill: '$surface2',
      stroke: '$border',
      children: [txt('Label', 'Button', { fontWeight: 600 })],
    },
    'button',
    {
      hover: { $self: { fill: '$primarySoft' } },
      pressed: { $self: { fill: '$border' } },
      disabled: { Label: { color: '$muted' } },
    },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Card',
      layout: 'column',
      gap: 8,
      padding: [24, 24, 24, 24],
      w: 260,
      radius: '$radius.lg',
      fill: '$surface2',
      stroke: '$border',
      children: [
        txt('Title', 'Card title', { fontFamily: '$font.heading', fontSize: 20, fontWeight: 600 }),
        txt('Body', 'Supporting detail goes here.', { fontSize: 14, color: '$muted' }),
      ],
    },
    'card',
    {
      hover: {
        $self: { shadow: [{ x: 0, y: 8, blur: 24, spread: 0, color: '#1F1E1D26' }] },
      },
      selected: { $self: { stroke: '$primary', strokeWidth: 2 } },
    },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Tab',
      layout: 'row',
      align: 'center',
      padding: [8, 16, 8, 16],
      radius: '$radius.full',
      children: [txt('Label', 'Tab', { fontSize: 14, fontWeight: 500, color: '$muted' })],
    },
    'tab',
    {
      hover: { $self: { fill: '$surface2' } },
      pressed: { $self: { fill: '$border' } },
      selected: {
        $self: { fill: '$primarySoft' },
        Label: { color: '$primary', fontWeight: 600 },
      },
    },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Toast',
      layout: 'row',
      align: 'center',
      gap: 12,
      padding: [12, 20, 12, 20],
      radius: '$radius.md',
      fill: '$text',
      children: [
        icn('Icon', 'circle-check', 20, '#FFFFFF'),
        txt('Message', 'Saved', { color: '#FFFFFF' }),
      ],
    },
    'toast',
  );
  if (withPlan) {
    b.master(
      board,
      {
        type: 'frame',
        name: 'Plan Card',
        layout: 'column',
        gap: 16,
        padding: [32, 32, 32, 32],
        w: 320,
        radius: '$radius.xl',
        fill: '$surface2',
        stroke: '$border',
        children: [
          txt('Plan Name', 'Starter', { fontSize: 18, fontWeight: 600 }),
          {
            type: 'frame',
            name: 'Price Row',
            layout: 'row',
            align: 'end',
            gap: 8,
            children: [
              txt('Price', '$12', { fontFamily: '$font.heading', fontSize: 48, fontWeight: 600 }),
              txt('Period', 'per month', { fontSize: 14, color: '$muted' }),
            ],
          },
          txt('Features', 'Unlimited projects\nAI design agent\nCode export', {
            color: '$muted',
            lineHeight: 1.8,
          }),
          {
            type: 'frame',
            name: 'CTA',
            layout: 'row',
            align: 'center',
            justify: 'center',
            w: 'fill',
            padding: [12, 24, 12, 24],
            radius: '$radius.md',
            fill: '$primary',
            children: [txt('CTA Label', 'Choose plan', { fontWeight: 600, color: '#FFFFFF' })],
          },
        ],
      },
      'card',
      {
        hover: { $self: { shadow: [{ x: 0, y: 12, blur: 32, spread: 0, color: '#1F1E1D26' }] } },
        selected: { $self: { stroke: '$primary', strokeWidth: 2 } },
      },
    );
  }
}

function landingScreen(b: DocBuilder): void {
  const feature = (title: string, body: string): NodeSpec =>
    b.inst(
      'Card',
      { Title: { text: title }, Body: { text: body } },
      {
        name: `Feature - ${title}`,
        self: { w: 'fill' },
      },
    );
  b.add(b.doc.rootId, {
    type: 'frame',
    name: 'Landing - Desktop',
    x: 0,
    y: 0,
    w: 1440,
    h: 'hug',
    layout: 'column',
    fill: '$surface',
    children: [
      {
        type: 'frame',
        name: 'Nav',
        w: 'fill',
        h: 'hug',
        layout: 'row',
        align: 'center',
        justify: 'between',
        padding: [24, 64, 24, 64],
        children: [
          txt('Logo', 'Your Product', {
            fontFamily: '$font.heading',
            fontSize: 24,
            fontWeight: 600,
          }),
          b.inst('Button Primary', { Label: { text: 'Get started' } }, { name: 'Nav CTA' }),
        ],
      },
      {
        type: 'frame',
        name: 'Hero',
        w: 'fill',
        h: 'hug',
        layout: 'column',
        align: 'center',
        gap: 24,
        padding: [96, 64, 96, 64],
        children: [
          txt('Headline', 'A clear promise in one line', {
            fontFamily: '$font.heading',
            fontSize: 56,
            fontWeight: 600,
            textAlign: 'center',
            w: 820,
          }),
          txt('Subhead', 'One or two sentences that say who this is for and why it helps.', {
            fontSize: 20,
            color: '$muted',
            textAlign: 'center',
            w: 640,
          }),
          {
            type: 'frame',
            name: 'CTA Row',
            layout: 'row',
            gap: 16,
            w: 'hug',
            h: 'hug',
            children: [
              b.inst('Button Primary', { Label: { text: 'Start free' } }, { name: 'Primary CTA' }),
              b.inst(
                'Button Secondary',
                { Label: { text: 'See how it works' } },
                { name: 'Secondary CTA' },
              ),
            ],
          },
        ],
      },
      {
        type: 'frame',
        name: 'Features',
        w: 'fill',
        h: 'hug',
        layout: 'row',
        gap: 24,
        padding: [0, 64, 96, 64],
        children: [
          feature('Fast', 'Say what makes it quick.'),
          feature('Simple', 'Say what makes it easy.'),
          feature('Yours', 'Say what makes it flexible.'),
        ],
      },
    ],
  });
}

function dashboardScreen(b: DocBuilder): void {
  const stat = (label: string, value: string): NodeSpec =>
    b.inst(
      'Card',
      { Title: { text: value, fontSize: 32 }, Body: { text: label } },
      {
        name: `Stat - ${label}`,
        self: { w: 'fill' },
      },
    );
  b.add(b.doc.rootId, {
    type: 'frame',
    name: 'Dashboard - Desktop',
    x: 0,
    y: 0,
    w: 1440,
    h: 900,
    layout: 'row',
    fill: '$surface',
    clip: true,
    children: [
      {
        type: 'frame',
        name: 'Sidebar',
        w: 240,
        h: 'fill',
        layout: 'column',
        gap: 8,
        padding: [24, 16, 24, 16],
        fill: '$surface2',
        stroke: '$border',
        children: [
          txt('Brand', 'Your App', { fontFamily: '$font.heading', fontSize: 20, fontWeight: 600 }),
          b.inst(
            'Tab',
            { Label: { text: 'Overview' } },
            { name: 'Nav Overview', state: 'selected' },
          ),
          b.inst('Tab', { Label: { text: 'Reports' } }, { name: 'Nav Reports' }),
          b.inst('Tab', { Label: { text: 'Settings' } }, { name: 'Nav Settings' }),
        ],
      },
      {
        type: 'frame',
        name: 'Main',
        w: 'fill',
        h: 'fill',
        layout: 'column',
        gap: 24,
        padding: [32, 32, 32, 32],
        children: [
          txt('Page Title', 'Overview', {
            fontFamily: '$font.heading',
            fontSize: 32,
            fontWeight: 600,
          }),
          {
            type: 'frame',
            name: 'Stats Row',
            w: 'fill',
            h: 'hug',
            layout: 'row',
            gap: 16,
            children: [
              stat('Revenue', '$48,200'),
              stat('Users', '3,214'),
              stat('Conversion', '4.8%'),
            ],
          },
          b.inst('Toast', { Message: { text: 'Report exported' } }, { name: 'Toast - Exported' }),
        ],
      },
    ],
  });
}

function mobileScreen(b: DocBuilder): void {
  const item = (label: string): NodeSpec =>
    b.inst(
      'Card',
      { Title: { text: label, fontSize: 17 }, Body: { text: 'Supporting detail goes here.' } },
      {
        name: `Card - ${label}`,
        self: { w: 'fill' },
      },
    );
  b.add(b.doc.rootId, {
    type: 'frame',
    name: 'Home - Mobile',
    x: 0,
    y: 0,
    w: 390,
    h: 844,
    layout: 'column',
    fill: '$surface',
    clip: true,
    children: [
      {
        type: 'frame',
        name: 'Header',
        w: 'fill',
        h: 'hug',
        layout: 'row',
        align: 'center',
        justify: 'between',
        padding: [16, 16, 16, 16],
        children: [
          txt('Title', 'Today', { fontFamily: '$font.heading', fontSize: 28, fontWeight: 600 }),
        ],
      },
      {
        type: 'frame',
        name: 'List',
        w: 'fill',
        h: 'fill',
        layout: 'column',
        gap: 12,
        padding: [8, 16, 16, 16],
        children: ['First item', 'Second item', 'Third item'].map(item),
      },
      {
        type: 'frame',
        name: 'Tab Bar',
        w: 'fill',
        h: 'hug',
        layout: 'row',
        justify: 'between',
        padding: [8, 16, 24, 16],
        fill: '$surface2',
        stroke: '$border',
        children: [
          b.inst('Tab', { Label: { text: 'Home' } }, { name: 'Tab Home', state: 'selected' }),
          b.inst('Tab', { Label: { text: 'Search' } }, { name: 'Tab Search' }),
          b.inst('Tab', { Label: { text: 'Profile' } }, { name: 'Tab Profile' }),
        ],
      },
    ],
  });
}

function pricingScreen(b: DocBuilder): void {
  const plan = (name: string, price: string, features: string, selected = false): NodeSpec =>
    b.inst(
      'Plan Card',
      { 'Plan Name': { text: name }, Price: { text: price }, Features: { text: features } },
      { name: `Plan - ${name}`, ...(selected ? { state: 'selected' as const } : {}) },
    );
  b.add(b.doc.rootId, {
    type: 'frame',
    name: 'Pricing - Desktop',
    x: 0,
    y: 0,
    w: 1440,
    h: 'hug',
    layout: 'column',
    align: 'center',
    gap: 32,
    fill: '$surface',
    padding: [96, 64, 96, 64],
    children: [
      txt('Headline', 'Simple pricing for every team', {
        fontFamily: '$font.heading',
        fontSize: 48,
        fontWeight: 600,
        textAlign: 'center',
        w: 760,
      }),
      txt('Subhead', 'Start free. Upgrade when you need more.', {
        fontSize: 20,
        color: '$muted',
        textAlign: 'center',
        w: 560,
      }),
      {
        type: 'frame',
        name: 'Billing Toggle',
        layout: 'row',
        gap: 8,
        padding: [4, 4, 4, 4],
        radius: '$radius.full',
        fill: '$surface2',
        stroke: '$border',
        children: [
          b.inst('Tab', { Label: { text: 'Monthly' } }, { name: 'Monthly', state: 'selected' }),
          b.inst('Tab', { Label: { text: 'Yearly' } }, { name: 'Yearly' }),
        ],
      },
      {
        type: 'frame',
        name: 'Plans',
        layout: 'row',
        gap: 24,
        align: 'stretch',
        children: [
          plan('Starter', '$0', 'One project\nCommunity support\nPNG export'),
          plan('Pro', '$12', 'Unlimited projects\nAI design agent\nCode export', true),
          plan('Team', '$29', 'Everything in Pro\nShared libraries\nPriority support'),
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Game kit (HUD, shop, inventory)
// ---------------------------------------------------------------------------

const GAME_TOKENS = {
  colors: {
    surface: '#1B1330',
    surface2: '#2D2250',
    border: '#4C3C86',
    text: '#FFFFFF',
    muted: '#C9BEF0',
    primary: '#FFB020',
    primarySoft: '#3B2E68',
    primaryHover: '#FFC24D',
    primaryPressed: '#E69500',
    bg: '#1B1330',
    panel: '#2D2250',
    panelLight: '#3B2E68',
    slot: '#241A44',
    slotBorder: '#4C3C86',
    outline: '#120B24',
    gold: '#FFC83D',
    gem: '#38D6FF',
    hp: '#FF4D6D',
    mana: '#4D9FFF',
    xp: '#B28CFF',
    success: '#4ADE80',
    danger: '#FF5A5F',
  },
  fonts: { display: 'Lilita One', heading: 'Lilita One', body: 'Fredoka' },
  radii: { sm: 8, md: 14, lg: 20, xl: 28, full: 999 },
};

const PANEL_FILL = {
  pattern: 'halftone',
  color: '#FFFFFF',
  size: 3,
  spacing: 8,
  opacity: 0.05,
  background: '$panel',
} as const;

function gameKit(b: DocBuilder, x: number): void {
  const board = b.add(b.doc.rootId, {
    type: 'frame',
    name: 'Components',
    x,
    y: 0,
    w: 760,
    h: 'hug',
    layout: 'row',
    wrap: true,
    gap: 24,
    padding: [32, 32, 32, 32],
    fill: '$panel',
    stroke: '$outline',
    strokeWidth: 4,
    radius: '$radius.xl',
  });

  b.master(
    board,
    {
      type: 'frame',
      name: 'Button Chunky',
      role: 'button',
      layout: 'row',
      align: 'center',
      justify: 'center',
      padding: [12, 32, 16, 32],
      radius: '$radius.full',
      fill: '$primary',
      stroke: '$outline',
      strokeWidth: 3,
      effects: ['gloss-top', 'hard-3d-bottom'],
      children: [
        txt('Label', 'PLAY', {
          fontFamily: '$font.display',
          fontSize: 28,
          color: '$outline',
          letterSpacing: 0.04,
        }),
      ],
    },
    'button',
    {
      hover: { $self: { fill: '$primaryHover' } },
      pressed: {
        $self: { fill: '$primaryPressed', effects: ['bevel-pressed'] },
      },
      disabled: {
        $self: { fill: '#6B5F8F', effects: [] },
        Label: { color: '#B6AAD8' },
      },
    },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Icon Button',
      role: 'button',
      layout: 'row',
      align: 'center',
      justify: 'center',
      w: 56,
      h: 56,
      radius: '$radius.full',
      fill: '$panelLight',
      stroke: '$outline',
      strokeWidth: 3,
      effects: ['bevel-raised'],
      children: [icn('Icon', 'gear', 28, '#FFFFFF')],
    },
    'button',
    {
      hover: { $self: { fill: '$border' } },
      pressed: { $self: { effects: ['bevel-pressed'] } },
      disabled: { Icon: { color: '$muted' } },
    },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Panel',
      layout: 'column',
      gap: 8,
      padding: [24, 24, 24, 24],
      w: 320,
      radius: '$radius.xl',
      fill: PANEL_FILL,
      stroke: '$outline',
      strokeWidth: 4,
      effects: ['inner-glow'],
      children: [
        txt('Title', 'Panel title', { fontFamily: '$font.display', fontSize: 28 }),
        txt('Body', 'Describe the item, quest or rule here.', { fontSize: 16, color: '$muted' }),
      ],
    },
    'panel',
    { selected: { $self: { stroke: '$gold' } } },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Tab',
      layout: 'row',
      align: 'center',
      padding: [8, 24, 8, 24],
      radius: '$radius.full',
      fill: '$slot',
      stroke: '$outline',
      strokeWidth: 3,
      children: [
        txt('Label', 'TAB', { fontFamily: '$font.display', fontSize: 20, color: '$muted' }),
      ],
    },
    'tab',
    {
      hover: { $self: { fill: '$panelLight' } },
      pressed: { $self: { effects: ['bevel-pressed'] } },
      selected: {
        $self: { fill: '$primary', effects: ['gloss-top'] },
        Label: { color: '$outline' },
      },
    },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Slot',
      layout: 'none',
      w: 80,
      h: 80,
      radius: '$radius.md',
      fill: '$slot',
      stroke: '$slotBorder',
      strokeWidth: 3,
      effects: ['bevel-pressed'],
      children: [
        { ...icn('Icon', 'cube', 40, '$border'), x: 20, y: 20 },
        txt('Count', '', { x: 52, y: 54, fontFamily: '$font.display', fontSize: 16 }),
      ],
    },
    'slot',
    {
      hover: { $self: { stroke: '$primary' } },
      selected: { $self: { stroke: '$gold', strokeWidth: 4, effects: ['inner-glow'] } },
      disabled: { Icon: { color: '$outline' } },
    },
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Currency Pill',
      layout: 'row',
      align: 'center',
      gap: 8,
      padding: [8, 16, 8, 12],
      radius: '$radius.full',
      fill: '$outline',
      children: [
        icn('Icon', 'coins', 24, '$gold'),
        txt('Amount', '1,250', { fontFamily: '$font.display', fontSize: 22 }),
      ],
    },
    'custom',
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Stat Bar',
      layout: 'none',
      w: 240,
      h: 24,
      clip: true,
      radius: '$radius.full',
      fill: '$outline',
      children: [
        {
          type: 'rect',
          name: 'Fill',
          x: 0,
          y: 0,
          w: 180,
          h: 24,
          radius: '$radius.full',
          fill: '$hp',
          effects: ['gloss-top'],
        },
        txt('Value', '180 / 240', { x: 12, y: 2, fontFamily: '$font.display', fontSize: 16 }),
      ],
    },
    'custom',
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Toast',
      layout: 'row',
      align: 'center',
      gap: 12,
      padding: [12, 24, 12, 16],
      radius: '$radius.lg',
      fill: '$outline',
      stroke: '$gold',
      strokeWidth: 2,
      children: [
        icn('Icon', 'star', 24, '$gold'),
        txt('Message', 'Quest updated', { fontFamily: '$font.display', fontSize: 20 }),
      ],
    },
    'toast',
  );
  b.master(
    board,
    {
      type: 'frame',
      name: 'Shop Item',
      layout: 'column',
      align: 'center',
      gap: 12,
      padding: [20, 20, 20, 20],
      w: 200,
      radius: '$radius.lg',
      fill: PANEL_FILL,
      stroke: '$outline',
      strokeWidth: 4,
      children: [
        {
          type: 'frame',
          name: 'Icon Well',
          layout: 'row',
          align: 'center',
          justify: 'center',
          w: 96,
          h: 96,
          radius: '$radius.md',
          fill: '$slot',
          effects: ['bevel-pressed'],
          children: [icn('Icon', 'gem', 56, '$gem')],
        },
        txt('Name', 'Item name', { fontFamily: '$font.display', fontSize: 22 }),
        {
          type: 'frame',
          name: 'Price Tag',
          layout: 'row',
          align: 'center',
          justify: 'center',
          gap: 8,
          w: 'fill',
          padding: [8, 16, 12, 16],
          radius: '$radius.full',
          fill: '$primary',
          stroke: '$outline',
          strokeWidth: 3,
          effects: ['gloss-top', 'hard-3d-bottom'],
          children: [
            icn('Price Icon', 'coins', 20, '$outline'),
            txt('Price', '100', { fontFamily: '$font.display', fontSize: 22, color: '$outline' }),
          ],
        },
      ],
    },
    'card',
    {
      hover: { $self: { stroke: '$primary' } },
      selected: { $self: { stroke: '$gold' } },
      disabled: { Icon: { color: '$border' } },
    },
  );
}

const BG_FILL = {
  pattern: 'sunburst',
  color: '#FFFFFF',
  size: 5,
  spacing: 5,
  opacity: 0.04,
  background: '$bg',
} as const;

function hudScreen(b: DocBuilder): void {
  const skill = (glyph: string, color: string, count: string, selected = false): NodeSpec =>
    b.inst(
      'Slot',
      { Icon: { icon: glyph, color }, Count: { text: count } },
      { name: `Skill - ${glyph}`, ...(selected ? { state: 'selected' as const } : {}) },
    );
  b.add(b.doc.rootId, {
    type: 'frame',
    name: 'HUD - Landscape',
    x: 0,
    y: 0,
    w: 1280,
    h: 720,
    layout: 'none',
    clip: true,
    fill: BG_FILL,
    children: [
      {
        type: 'frame',
        name: 'Player',
        x: 32,
        y: 32,
        layout: 'row',
        gap: 16,
        align: 'center',
        children: [
          {
            type: 'ellipse',
            name: 'Avatar',
            w: 80,
            h: 80,
            fill: '$panelLight',
            stroke: '$gold',
            strokeWidth: 4,
            effects: ['bevel-raised'],
          },
          {
            type: 'frame',
            name: 'Bars',
            layout: 'column',
            gap: 8,
            children: [
              txt('Player Name', 'Nova  Lv 12', { fontFamily: '$font.display', fontSize: 24 }),
              b.inst('Stat Bar', {}, { name: 'HP Bar' }),
              b.inst(
                'Stat Bar',
                { Fill: { w: 120, fill: '$mana' }, Value: { text: '120 / 240' } },
                { name: 'Mana Bar' },
              ),
            ],
          },
        ],
      },
      {
        type: 'frame',
        name: 'Top Right',
        x: 880,
        y: 32,
        layout: 'row',
        gap: 12,
        align: 'center',
        children: [
          b.inst('Currency Pill', {}, { name: 'Coins' }),
          b.inst(
            'Currency Pill',
            { Icon: { icon: 'gem', color: '$gem' }, Amount: { text: '48' } },
            { name: 'Gems' },
          ),
          b.inst('Icon Button', {}, { name: 'Settings Button' }),
        ],
      },
      b.inst(
        'Toast',
        { Message: { text: 'Quest updated: Find the key' } },
        {
          name: 'Quest Toast',
          x: 480,
          y: 32,
        },
      ),
      {
        type: 'frame',
        name: 'Skill Bar',
        x: 400,
        y: 600,
        layout: 'row',
        gap: 12,
        children: [
          skill('bolt', '$gem', '', true),
          skill('fire', '$danger', '3'),
          skill('shield', '$muted', ''),
          skill('potion', '$hp', '5'),
          skill('wand', '$xp', ''),
        ],
      },
      b.inst(
        'Button Chunky',
        { Label: { text: 'ATTACK' } },
        { name: 'Attack Button', x: 1020, y: 570 },
      ),
    ],
  });
}

function shopScreen(b: DocBuilder): void {
  const item = (name: string, glyph: string, color: string, price: string): NodeSpec =>
    b.inst(
      'Shop Item',
      { Icon: { icon: glyph, color }, Name: { text: name }, Price: { text: price } },
      { name: `Item - ${name}` },
    );
  b.add(b.doc.rootId, {
    type: 'frame',
    name: 'Shop - Landscape',
    x: 0,
    y: 0,
    w: 1280,
    h: 720,
    layout: 'column',
    gap: 24,
    padding: [32, 48, 32, 48],
    clip: true,
    fill: BG_FILL,
    children: [
      {
        type: 'frame',
        name: 'Header',
        w: 'fill',
        h: 'hug',
        layout: 'row',
        align: 'center',
        justify: 'between',
        children: [
          txt('Title', 'ITEM SHOP', {
            fontFamily: '$font.display',
            fontSize: 48,
            letterSpacing: 0.04,
          }),
          {
            type: 'frame',
            name: 'Wallet',
            layout: 'row',
            gap: 12,
            align: 'center',
            children: [
              b.inst('Currency Pill', {}, { name: 'Coins' }),
              b.inst(
                'Currency Pill',
                { Icon: { icon: 'gem', color: '$gem' }, Amount: { text: '48' } },
                { name: 'Gems' },
              ),
              b.inst('Icon Button', { Icon: { icon: 'xmark' } }, { name: 'Close Button' }),
            ],
          },
        ],
      },
      {
        type: 'frame',
        name: 'Tabs',
        layout: 'row',
        gap: 12,
        children: [
          b.inst(
            'Tab',
            { Label: { text: 'FEATURED' } },
            { name: 'Tab Featured', state: 'selected' },
          ),
          b.inst('Tab', { Label: { text: 'WEAPONS' } }, { name: 'Tab Weapons' }),
          b.inst('Tab', { Label: { text: 'POTIONS' } }, { name: 'Tab Potions' }),
          b.inst('Tab', { Label: { text: 'GEMS' } }, { name: 'Tab Gems' }),
        ],
      },
      {
        type: 'frame',
        name: 'Items',
        w: 'fill',
        h: 'hug',
        layout: 'row',
        wrap: true,
        gap: 24,
        children: [
          item('Gem Pack', 'gem', '$gem', '99'),
          item('Iron Sword', 'sword', '$muted', '450'),
          item('Health Potion', 'potion', '$hp', '60'),
          item('Golden Key', 'key', '$gold', '120'),
          item('Royal Crown', 'crown', '$gold', '900'),
        ],
      },
    ],
  });
}

function inventoryScreen(b: DocBuilder): void {
  const pieces: [string, string][] = [
    ['sword', '$muted'],
    ['shield', '$gem'],
    ['potion', '$hp'],
    ['key', '$gold'],
    ['gem', '$gem'],
    ['scroll', '$muted'],
    ['coins', '$gold'],
    ['crown', '$gold'],
    ['book', '$xp'],
  ];
  const slot = (i: number): NodeSpec => {
    const piece = pieces[i];
    return b.inst(
      'Slot',
      piece
        ? { Icon: { icon: piece[0], color: piece[1] }, Count: { text: i % 3 === 2 ? '4' : '' } }
        : {},
      { name: `Slot ${i + 1}`, ...(i === 1 ? { state: 'selected' as const } : {}) },
    );
  };
  const row = (r: number): NodeSpec => ({
    type: 'frame',
    name: `Row ${r + 1}`,
    layout: 'row',
    gap: 12,
    children: Array.from({ length: 6 }, (_, c) => slot(r * 6 + c)),
  });
  b.add(b.doc.rootId, {
    type: 'frame',
    name: 'Inventory - Landscape',
    x: 0,
    y: 0,
    w: 1280,
    h: 720,
    layout: 'row',
    gap: 32,
    padding: [48, 48, 48, 48],
    clip: true,
    fill: BG_FILL,
    children: [
      {
        type: 'frame',
        name: 'Character',
        w: 300,
        h: 'fill',
        layout: 'column',
        align: 'center',
        gap: 16,
        padding: [24, 24, 24, 24],
        radius: '$radius.xl',
        fill: PANEL_FILL,
        stroke: '$outline',
        strokeWidth: 4,
        children: [
          {
            type: 'ellipse',
            name: 'Portrait',
            w: 160,
            h: 160,
            fill: '$panelLight',
            stroke: '$gold',
            strokeWidth: 4,
            effects: ['bevel-raised'],
          },
          txt('Character Name', 'Nova', { fontFamily: '$font.display', fontSize: 32 }),
          txt('Class', 'Storm Mage  Lv 12', { color: '$muted' }),
          b.inst('Stat Bar', {}, { name: 'HP Bar' }),
          b.inst(
            'Stat Bar',
            { Fill: { w: 120, fill: '$mana' }, Value: { text: '120 / 240' } },
            { name: 'Mana Bar' },
          ),
        ],
      },
      {
        type: 'frame',
        name: 'Backpack',
        w: 'fill',
        h: 'fill',
        layout: 'column',
        gap: 20,
        children: [
          {
            type: 'frame',
            name: 'Tabs',
            layout: 'row',
            gap: 12,
            children: [
              b.inst('Tab', { Label: { text: 'ITEMS' } }, { name: 'Tab Items', state: 'selected' }),
              b.inst('Tab', { Label: { text: 'GEAR' } }, { name: 'Tab Gear' }),
              b.inst('Tab', { Label: { text: 'QUESTS' } }, { name: 'Tab Quests' }),
            ],
          },
          {
            type: 'frame',
            name: 'Grid',
            layout: 'column',
            gap: 12,
            children: [row(0), row(1), row(2)],
          },
          {
            type: 'frame',
            name: 'Detail',
            w: 'fill',
            h: 'hug',
            layout: 'row',
            gap: 24,
            align: 'center',
            children: [
              b.inst(
                'Panel',
                {
                  Title: { text: 'Aegis Shield' },
                  Body: { text: 'Blocks one hit every 30 seconds.' },
                },
                { name: 'Item Detail', self: { w: 'fill' } },
              ),
              b.inst('Button Chunky', { Label: { text: 'EQUIP' } }, { name: 'Equip Button' }),
            ],
          },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------

/** A new document from a template. Throws if the template itself is invalid (a bug, covered by tests). */
export function createTemplateDoc(
  template: TemplateName,
  options: { id?: string; name: string; now?: string },
): Doc {
  const base = createEmptyDoc({
    name: options.name,
    ...(options.id === undefined ? {} : { id: options.id }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  if (template === 'blank') return base;
  const b = new DocBuilder(base);
  switch (template) {
    case 'landing':
      b.tokens(PRODUCT_TOKENS);
      productKit(b, 1520);
      landingScreen(b);
      break;
    case 'dashboard':
      b.tokens(PRODUCT_TOKENS);
      productKit(b, 1520);
      dashboardScreen(b);
      break;
    case 'mobile':
      b.tokens(PRODUCT_TOKENS);
      productKit(b, 470);
      mobileScreen(b);
      break;
    case 'pricing':
      b.tokens(PRODUCT_TOKENS);
      productKit(b, 1520, true);
      pricingScreen(b);
      break;
    case 'game-hud':
      b.tokens(GAME_TOKENS);
      gameKit(b, 1360);
      hudScreen(b);
      break;
    case 'game-shop':
      b.tokens(GAME_TOKENS);
      gameKit(b, 1360);
      shopScreen(b);
      break;
    case 'game-inventory':
      b.tokens(GAME_TOKENS);
      gameKit(b, 1360);
      inventoryScreen(b);
      break;
  }
  return b.doc;
}
