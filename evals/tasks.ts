/**
 * The fixed task set (docs/08 "Evaluation"). Each task builds its starting document in code, so a run
 * needs no files and every run starts from the same design. `kind` says what a good answer looks
 * like: an edit that must meet the automatic bars, an edit that must keep the design's structure, or
 * a critique that must change nothing.
 */
import { addAnnotation } from '../src/core/annotations';
import { loadDoc } from '../src/core/doc';
import { seededRng } from '../src/core/ids';
import { createTemplateDoc, type TemplateName } from '../src/core/templates';
import { buildDoc } from '../src/core/testing';
import type { Doc } from '../src/core/types';
import type { Bars } from './metrics';

export interface EvalTask {
  id: string;
  title: string;
  /** What the person types. */
  prompt: string;
  /** What to look for when rating by hand (RUBRIC.md adds the general points). */
  humanFocus: string;
  kind: 'improve' | 'unchanged';
  /** The layer to select first (by name), if any. */
  select?: string;
  /** Adjusts the automatic bars where the task makes one meaningless. */
  bars?: Bars;
  build: () => Doc;
}

const FIXED = { id: 'p_evals1', now: '2026-01-01T00:00:00.000Z' } as const;

/**
 * Templates draw node ids at random. A run's tool calls name those ids (and a recording replays
 * them), so every task builds under a fixed seed: the same start, byte for byte, every time.
 */
function seeded<T>(build: () => T): T {
  const original = Math.random;
  Math.random = seededRng(20261108);
  try {
    return build();
  } finally {
    Math.random = original;
  }
}

const template = (name: TemplateName): Doc =>
  seeded(() => createTemplateDoc(name, { name, ...FIXED }));

async function sampleDoc(): Promise<Doc> {
  const { readFileSync } = await import('node:fs');
  const loaded = loadDoc(JSON.parse(readFileSync('fixtures/sample-doc.json', 'utf8')));
  if (!loaded.ok) throw new Error('fixtures/sample-doc.json does not load');
  return loaded.doc;
}

/** The sample project (sync wrapper: the runner awaits `prepare()` once before using `build`). */
let sample: Doc | null = null;
export async function prepare(): Promise<void> {
  sample = await sampleDoc();
}
const fromSample = (): Doc => {
  if (sample === null) throw new Error('call prepare() first');
  return sample;
};

/** A design with the faults a first draft usually has: faint text, tiny type, odd spacing, loose colours. */
function seededBad(): Doc {
  return buildDoc([
    {
      id: 'n_card',
      type: 'frame',
      name: 'Signup',
      layout: 'column',
      w: 420,
      gap: 13,
      padding: [22, 22, 22, 22],
      fill: '#ffffff',
      radius: 6,
      children: [
        { id: 'n_head', type: 'text', name: 'Heading', text: 'Create your account', fontSize: 26 },
        {
          id: 'n_hint',
          type: 'text',
          name: 'Hint',
          text: 'Free for 14 days, no card needed',
          fontSize: 10,
          color: '#cfcfcf',
        },
        {
          id: 'n_butn',
          type: 'frame',
          name: 'Button',
          role: 'button',
          w: 90,
          h: 22,
          fill: '#4f46e5',
          radius: 3,
          padding: [3, 5, 3, 5],
          children: [
            {
              id: 'n_blbl',
              type: 'text',
              name: 'Label',
              text: 'Sign up',
              fontSize: 11,
              color: '#e0e0ff',
            },
          ],
        },
      ],
    },
  ]);
}

function withNotes(): Doc {
  return seeded(() => {
    let doc = template('landing');
    const texts = Object.values(doc.nodes)
      .filter((n) => n.type === 'text')
      .slice(0, 3);
    const notes = [
      'This headline is too small',
      'The button needs to stand out more',
      'Too much empty space here',
    ];
    texts.forEach((n, i) => {
      doc = addAnnotation(
        doc,
        {
          text: notes[i] ?? 'Look at this',
          author: 'user',
          x: 20,
          y: 20 + i * 24,
          nodeId: n.id,
          now: FIXED.now,
        },
        () => 0.2 + i / 10,
      ).doc;
    });
    return doc;
  });
}

export const TASKS: readonly EvalTask[] = [
  {
    id: 'improve-cramped-pricing',
    title: 'Improve a cramped pricing page',
    prompt: 'Improve the selected frame',
    humanFocus: 'Is spacing generous and consistent? Is the recommended plan the obvious choice?',
    kind: 'improve',
    select: 'Pricing - Needs Work',
    build: fromSample,
  },
  {
    id: 'polish-landing',
    title: 'Make a landing page look more professional',
    prompt: 'Make this look more professional',
    humanFocus: 'Hierarchy, type pairing, restraint. Is there one clear call to action?',
    kind: 'improve',
    select: 'Landing - Desktop',
    build: fromSample,
  },
  {
    id: 'fix-contrast-and-sizes',
    title: 'Fix faint text, tiny type and off-scale spacing',
    prompt: 'Check my spacing and contrast, then fix what you find',
    humanFocus: 'Was the content kept? Do the fixes look intentional rather than mechanical?',
    kind: 'improve',
    select: 'Signup',
    build: seededBad,
  },
  {
    id: 'mobile-version',
    title: 'Make a mobile version of a desktop screen',
    prompt: 'Make a mobile version of this screen, 390 wide, next to the original',
    humanFocus: 'Stacked layout, larger tap targets, same tokens and copy.',
    kind: 'improve',
    select: 'Landing - Desktop',
    build: () => template('landing'),
  },
  {
    id: 'tokenise-colours',
    title: 'Move loose colours into tokens',
    prompt: 'Put the colours in this design into tokens and use them everywhere',
    bars: { minTokenPct: 80 },
    humanFocus: 'Sensible token names; the design looks the same afterwards.',
    kind: 'improve',
    select: 'Signup',
    build: seededBad,
  },
  {
    id: 'critique-only',
    title: 'Critique without touching the design',
    prompt: 'Critique my design (no edits)',
    humanFocus: 'Three to seven prioritised, specific points; starts with what works; no jargon.',
    kind: 'unchanged',
    select: 'Pricing - Needs Work',
    build: fromSample,
  },
  {
    id: 'address-notes',
    title: 'Address the open notes',
    prompt: 'Address my open notes',
    humanFocus: 'Each note answered with a one-line reply; the change matches what the note asked.',
    kind: 'improve',
    build: withNotes,
  },
  {
    id: 'build-login-card',
    title: 'Build a login card from a description',
    prompt:
      'Create a login card, 400 wide: a logo mark, the heading "Welcome back", email and password fields, a primary "Log in" button and a "Forgot password?" link. Use auto-layout and tokens.',
    humanFocus: 'Looks like a real login card; fields and button are clearly different things.',
    kind: 'improve',
    build: () => template('blank'),
  },
  {
    id: 'game-button-states',
    title: 'Give game buttons pressed and hover states',
    prompt: 'Make the buttons feel pressable: they should react when hovered and pressed',
    bars: { skipAutoLayout: true },
    humanFocus: 'States differ visibly and consistently; the base look is kept.',
    kind: 'improve',
    select: 'HUD - Landscape',
    build: () => template('game-hud'),
  },
  {
    id: 'dashboard-hierarchy',
    title: 'Give a flat dashboard a clear hierarchy',
    prompt: 'Everything looks the same weight. Make the most important number stand out',
    humanFocus: 'One focal point; supporting numbers subdued; grid stays aligned.',
    kind: 'improve',
    build: () => template('dashboard'),
  },
];

export const taskById = (id: string): EvalTask | undefined => TASKS.find((t) => t.id === id);
