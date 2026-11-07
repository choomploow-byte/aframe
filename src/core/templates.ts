/**
 * Starting points for `create_project` (docs/05). Built through `applyChanges` like any agent edit,
 * so they use auto-layout, tokens and real layer names, and double as examples of good structure.
 */
import { applyChanges } from './apply';
import { createEmptyDoc } from './doc';
import type { Doc, NodeSpec, Op } from './types';

export type TemplateName = 'blank' | 'landing' | 'dashboard' | 'mobile';
export const TEMPLATES: readonly TemplateName[] = ['blank', 'landing', 'dashboard', 'mobile'];

const text = (name: string, value: string, props: Partial<NodeSpec> = {}): NodeSpec => ({
  type: 'text',
  name,
  text: value,
  fontFamily: '$font.body',
  fontSize: 16,
  color: '$text',
  ...props,
});

const button = (label: string, primary: boolean): NodeSpec => ({
  type: 'frame',
  name: primary ? 'Primary Button' : 'Secondary Button',
  role: 'button',
  layout: 'row',
  align: 'center',
  justify: 'center',
  padding: [12, 24, 12, 24],
  radius: '$radius.md',
  fill: primary ? '$primary' : '$surface2',
  ...(primary ? {} : { stroke: '$border' }),
  children: [
    text(`${label} Label`, label, {
      fontWeight: 600,
      color: primary ? '#FFFFFF' : '$text',
    }),
  ],
});

function landing(): NodeSpec {
  return {
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
          text('Logo', 'Your Product', {
            fontFamily: '$font.heading',
            fontSize: 24,
            fontWeight: 600,
          }),
          button('Get started', true),
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
          text('Headline', 'A clear promise in one line', {
            fontFamily: '$font.heading',
            fontSize: 56,
            fontWeight: 600,
            textAlign: 'center',
            w: 820,
          }),
          text('Subhead', 'One or two sentences that say who this is for and why it helps.', {
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
            children: [button('Start free', true), button('See how it works', false)],
          },
        ],
      },
    ],
  };
}

function mobile(): NodeSpec {
  return {
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
          text('Title', 'Today', { fontFamily: '$font.heading', fontSize: 28, fontWeight: 600 }),
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
        children: ['First item', 'Second item', 'Third item'].map((label): NodeSpec => ({
          type: 'frame',
          name: `Card - ${label}`,
          w: 'fill',
          h: 'hug',
          layout: 'column',
          gap: 4,
          padding: [16, 16, 16, 16],
          radius: '$radius.lg',
          fill: '$surface2',
          stroke: '$border',
          children: [
            text(`${label} Title`, label, { fontWeight: 600, fontSize: 17 }),
            text(`${label} Body`, 'Supporting detail goes here.', {
              fontSize: 14,
              color: '$muted',
            }),
          ],
        })),
      },
    ],
  };
}

function dashboard(): NodeSpec {
  const stat = (label: string, value: string): NodeSpec => ({
    type: 'frame',
    name: `Stat - ${label}`,
    w: 'fill',
    h: 'hug',
    layout: 'column',
    gap: 8,
    padding: [24, 24, 24, 24],
    radius: '$radius.lg',
    fill: '$surface2',
    stroke: '$border',
    children: [
      text(`${label} Label`, label, { fontSize: 14, color: '$muted' }),
      text(`${label} Value`, value, { fontFamily: '$font.heading', fontSize: 32, fontWeight: 600 }),
    ],
  });
  return {
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
        children: ['Overview', 'Reports', 'Settings'].map((n) =>
          text(`Nav ${n}`, n, { fontWeight: 500 }),
        ),
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
          text('Page Title', 'Overview', {
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
        ],
      },
    ],
  };
}

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
  const spec = template === 'landing' ? landing() : template === 'mobile' ? mobile() : dashboard();
  const ops: Op[] = [{ op: 'create', parentId: base.rootId, node: spec }];
  const result = applyChanges(base, ops);
  if (!result.ok)
    throw new Error(`Template ${template} is invalid: ${JSON.stringify(result.errors[0])}`);
  return result.doc;
}
