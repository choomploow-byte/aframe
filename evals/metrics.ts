/**
 * Automatic measures of a design, for the eval harness (evals/README.md). Everything here is computed
 * from the document alone, so two runs of the same agent can be compared without a person: the human
 * ratings in RUBRIC.md cover what numbers cannot (does it look good).
 */
import { lintDesign } from '../src/core/lint';
import type { Doc, Node } from '../src/core/types';

export interface Metrics {
  /** Frames that hold children and use auto-layout (row/column), as a percentage. */
  autoLayoutPct: number;
  /** Colour values that are tokens (`$name`), as a percentage of all colour values. */
  tokenPct: number;
  /** Gap and padding values (above 0) on the spacing scale or a multiple of 4, as a percentage. */
  spacingOnScalePct: number;
  /** Contrast findings at error severity (below 3:1). */
  contrastErrors: number;
  lintErrors: number;
  lintWarnings: number;
  /** Smallest text size in the design, or null if there is no text. */
  minTextPx: number | null;
  nodes: number;
}

const COLOR_KEYS = ['fill', 'color', 'stroke'] as const;

function* nodesUnder(doc: Doc, rootId: string): Generator<Node> {
  const stack = [rootId];
  while (stack.length > 0) {
    const n = doc.nodes[stack.pop() as string];
    if (!n) continue;
    yield n;
    for (const c of n.children) stack.push(c);
  }
}

const pct = (part: number, whole: number): number =>
  whole === 0 ? 100 : Math.round((part / whole) * 1000) / 10;

/** Measures the whole design, or one frame's subtree. Instance layers (derived from a master) are skipped. */
export function measure(doc: Doc, scopeId?: string): Metrics {
  const start = scopeId ?? doc.rootId;
  let frames = 0;
  let auto = 0;
  let colours = 0;
  let tokens = 0;
  let spacing = 0;
  let onScale = 0;
  let minText: number | null = null;
  let nodes = 0;
  const scale = new Set(doc.tokens.spacing);
  const isOnScale = (v: number): boolean => scale.has(v) || v % 4 === 0;

  for (const n of nodesUnder(doc, start)) {
    if (n.id === doc.rootId) continue;
    nodes += 1;
    if (n.from !== undefined) continue;
    if (n.type === 'frame' && n.children.length > 0) {
      frames += 1;
      if (n.layout === 'row' || n.layout === 'column') auto += 1;
    }
    for (const key of COLOR_KEYS) {
      const v = n[key];
      if (typeof v === 'string' && v !== '') {
        colours += 1;
        if (v.startsWith('$')) tokens += 1;
      }
    }
    for (const v of [n.gap, ...(n.padding ?? [])]) {
      if (typeof v === 'number' && v > 0) {
        spacing += 1;
        if (isOnScale(v)) onScale += 1;
      }
    }
    if (n.type === 'text') {
      const size = n.fontSize ?? 16;
      minText = minText === null ? size : Math.min(minText, size);
    }
  }

  const lint = lintDesign(doc, scopeId);
  return {
    autoLayoutPct: pct(auto, frames),
    tokenPct: pct(tokens, colours),
    spacingOnScalePct: pct(onScale, spacing),
    contrastErrors: lint.findings.filter((f) => f.rule === 'contrast' && f.severity === 'error')
      .length,
    lintErrors: lint.counts.error,
    lintWarnings: lint.counts.warning,
    minTextPx: minText,
    nodes,
  };
}

/** What counts as meeting the bar after an agent's edits (docs/08, prompts/phase-09). */
export const TARGETS = { autoLayoutPct: 80, spacingOnScalePct: 90, contrastErrors: 0 } as const;

export interface Bars {
  /** A free-placed design (a game HUD) is not judged on auto-layout. */
  skipAutoLayout?: boolean;
  /** Also require this share of colours to be tokens. */
  minTokenPct?: number;
}

export interface Verdict {
  autoLayout: boolean;
  tokens: boolean;
  spacing: boolean;
  contrast: boolean;
  /** All three automatic bars met. */
  pass: boolean;
}

export function verdict(after: Metrics, bars: Bars = {}): Verdict {
  const autoLayout = bars.skipAutoLayout === true || after.autoLayoutPct >= TARGETS.autoLayoutPct;
  const tokens = bars.minTokenPct === undefined || after.tokenPct >= bars.minTokenPct;
  const spacing = after.spacingOnScalePct >= TARGETS.spacingOnScalePct;
  const contrast = after.contrastErrors <= TARGETS.contrastErrors;
  return {
    autoLayout,
    tokens,
    spacing,
    contrast,
    pass: autoLayout && tokens && spacing && contrast,
  };
}

/** How many nodes differ between two versions of a document (added, removed or changed). */
export function changedNodes(before: Doc, after: Doc): number {
  const ids = new Set([...Object.keys(before.nodes), ...Object.keys(after.nodes)]);
  let n = 0;
  for (const id of ids) {
    // By value: the after-document may have been through JSON.
    if (JSON.stringify(before.nodes[id]) !== JSON.stringify(after.nodes[id])) n += 1;
  }
  return n;
}
