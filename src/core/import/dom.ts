/**
 * Import from a captured web page (the "import my running app" spike). A capture script
 * (`scripts/capture-dom.mjs`) loads a page in headless Chrome and writes a snapshot of its elements
 * with their measured boxes and computed styles; this turns that snapshot into frames and text.
 *
 * It is a prototype with honest limits: sizes are fixed at the captured width (nothing is responsive),
 * flex containers become auto-layout, a block that stacks evenly becomes a column, anything else is
 * placed by coordinates, pictures and inline SVG become grey placeholders (nothing is downloaded), and
 * CSS that has no Atelier equivalent (transforms, pseudo-elements, grid tracks, filters) is not carried.
 */
import type { NodeSpec } from '../types';
import {
  Budget,
  ColorTally,
  IMPORT_LIMITS,
  ImportError,
  type ImportResult,
  type ReportEntry,
} from './types';

export interface DomBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DomStyle {
  display?: string;
  flexDirection?: string;
  flexWrap?: string;
  gap?: string;
  rowGap?: string;
  columnGap?: string;
  paddingTop?: string;
  paddingRight?: string;
  paddingBottom?: string;
  paddingLeft?: string;
  justifyContent?: string;
  alignItems?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: string;
  textTransform?: string;
  borderRadius?: string;
  borderTopLeftRadius?: string;
  borderTopRightRadius?: string;
  borderBottomRightRadius?: string;
  borderBottomLeftRadius?: string;
  borderTopWidth?: string;
  borderTopColor?: string;
  borderTopStyle?: string;
  boxShadow?: string;
  opacity?: string;
}

export interface DomNode {
  tag: string;
  box: DomBox;
  style: DomStyle;
  /** Text of an element that holds only text. */
  text?: string;
  attrs?: Record<string, string>;
  children?: DomNode[];
}

export interface DomSnapshot {
  url: string;
  title: string;
  width: number;
  height: number;
  root: DomNode;
}

const round = (n: number): number => Math.round(n * 100) / 100;
const px = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) && /px$|^-?[\d.]+$/.test(v.trim()) ? n : undefined;
};
const hex2 = (n: number): string =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');

/** `rgb(1, 2, 3)` / `rgba(1, 2, 3, 0.5)` / `#abc` -> `#rrggbb[aa]`, or undefined for transparent/unknown. */
export function cssColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const a =
      m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(a > 0)) return undefined;
    const base = `#${hex2(Number(m[1]))}${hex2(Number(m[2]))}${hex2(Number(m[3]))}`;
    return a < 0.995 ? `${base}${hex2(a * 255)}` : base;
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${[...v.slice(1)].map((c) => c + c).join('')}`;
  return undefined;
}

const JUSTIFY: Record<string, NodeSpec['justify']> = {
  'flex-start': 'start',
  start: 'start',
  normal: 'start',
  center: 'center',
  'flex-end': 'end',
  end: 'end',
  'space-between': 'between',
};
const ALIGN: Record<string, NodeSpec['align']> = {
  'flex-start': 'start',
  start: 'start',
  center: 'center',
  'flex-end': 'end',
  end: 'end',
  stretch: 'stretch',
  normal: 'stretch',
};

interface Ctx {
  report: ReportEntry[];
  tally: ColorTally;
  budget: Budget;
  once: Set<string>;
}

function note(ctx: Ctx, kind: ReportEntry['kind'], what: string, why?: string): void {
  ctx.report.push(why === undefined ? { kind, what } : { kind, what, why });
}
function noteOnce(ctx: Ctx, kind: ReportEntry['kind'], what: string, why: string): void {
  const key = `${kind}|${what}`;
  if (ctx.once.has(key)) return;
  ctx.once.add(key);
  note(ctx, kind, what, why);
}

/** A readable layer name from the element: its id/class hint, else the tag. */
function nameOf(n: DomNode): string {
  const hint = n.attrs?.id ?? n.attrs?.class?.split(/\s+/)[0] ?? '';
  const clean = hint.replace(/[-_]+/g, ' ').trim();
  const label = clean === '' ? n.tag : clean;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`.slice(0, 60);
}

function shadowOf(value: string | undefined): NodeSpec['shadow'] | undefined {
  if (!value || value === 'none') return undefined;
  // rgba(0, 0, 0, 0.1) 0px 4px 12px 0px  (computed style puts the colour first)
  const m =
    /^(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?(\s+inset)?/.exec(
      value.trim(),
    );
  if (!m) return undefined;
  const color = cssColor(m[1]);
  if (color === undefined) return undefined;
  return [
    {
      x: Number(m[2]),
      y: Number(m[3]),
      blur: Number(m[4]),
      spread: m[5] === undefined ? 0 : Number(m[5]),
      color,
      ...(m[6] ? { inset: true } : {}),
    },
  ];
}

function radiusOf(s: DomStyle): Partial<NodeSpec> {
  const c = [
    s.borderTopLeftRadius,
    s.borderTopRightRadius,
    s.borderBottomRightRadius,
    s.borderBottomLeftRadius,
  ].map((v) => px(v) ?? 0);
  if (c.every((v) => v === 0)) {
    const all = px(s.borderRadius);
    return all !== undefined && all > 0 ? { radius: round(all) } : {};
  }
  const [a = 0, b = 0, d = 0, e = 0] = c;
  return a === b && b === d && d === e ? { radius: round(a) } : { radius: [a, b, d, e] };
}

function convert(
  n: DomNode,
  parent: DomNode | null,
  ctx: Ctx,
  depth: number,
  origin: DomBox,
): NodeSpec | null {
  if (depth > IMPORT_LIMITS.maxDepth)
    throw new ImportError('This page is nested too deeply to import.');
  const s = n.style;
  const w = n.box.w;
  const h = n.box.h;
  if (w < 1 || h < 1) return null;
  const x = round(n.box.x - (parent?.box.x ?? origin.x));
  const y = round(n.box.y - (parent?.box.y ?? origin.y));
  const parentFlex = parent !== null && /flex/.test(parent.style.display ?? '');
  const pos: Partial<NodeSpec> = parent === null || parentFlex ? {} : { x, y };
  const opacity = px(s.opacity);
  const common: Partial<NodeSpec> =
    opacity !== undefined && opacity < 1 ? { opacity: round(opacity) } : {};
  const name = nameOf(n);
  const what = `<${n.tag}> ${name}`;

  if (['script', 'style', 'noscript', 'template'].includes(n.tag)) return null;

  if (
    n.tag === 'img' ||
    n.tag === 'svg' ||
    n.tag === 'canvas' ||
    n.tag === 'video' ||
    n.tag === 'picture'
  ) {
    ctx.budget.take();
    note(ctx, 'fallback', what, 'pictures are not downloaded; a grey placeholder is drawn');
    return {
      type: 'rect',
      name: n.attrs?.alt ? n.attrs.alt.slice(0, 60) : `${name} (picture)`,
      ...pos,
      w: round(w),
      h: round(h),
      fill: '#e5e5e5',
      ...radiusOf(s),
      ...common,
      ...(n.tag === 'img' ? { props: { alt: n.attrs?.alt ?? '' } } : {}),
    };
  }

  if (n.tag === 'input' || n.tag === 'textarea' || n.tag === 'select') {
    ctx.budget.take();
    return inputLike(n, ctx, pos, w, h, common);
  }

  const kids = (n.children ?? []).filter((c) => !['script', 'style', 'noscript'].includes(c.tag));
  const bg = cssColor(s.backgroundColor);
  const gradient =
    /^(linear|radial)-gradient\(/.test(s.backgroundImage ?? '') &&
    !/url\(/.test(s.backgroundImage ?? '')
      ? s.backgroundImage
      : undefined;
  if (s.backgroundImage && s.backgroundImage !== 'none' && gradient === undefined) {
    noteOnce(
      ctx,
      'approximated',
      'background images',
      'pictures used as backgrounds are not carried',
    );
  }
  ctx.tally.add(bg?.slice(0, 7));
  const borderWidth = px(s.borderTopWidth) ?? 0;
  const borderColor =
    s.borderTopStyle && s.borderTopStyle !== 'none' ? cssColor(s.borderTopColor) : undefined;
  ctx.tally.add(borderColor?.slice(0, 7));
  const border =
    borderWidth > 0 && borderColor !== undefined
      ? { stroke: borderColor, strokeWidth: round(borderWidth), strokeAlign: 'inside' as const }
      : {};
  const shadow = shadowOf(s.boxShadow);

  // A leaf with text is a text layer (with the box of its background if it has one: a frame around it).
  if (n.text !== undefined && n.text.trim() !== '' && kids.length === 0) {
    ctx.budget.take();
    const size = px(s.fontSize) ?? 16;
    const lh = px(s.lineHeight);
    const ls = px(s.letterSpacing);
    const color = cssColor(s.color);
    ctx.tally.add(color?.slice(0, 7));
    const family = s.fontFamily
      ?.split(',')[0]
      ?.trim()
      .replace(/^["']|["']$/g, '');
    const text: NodeSpec = {
      type: 'text',
      name: n.text.trim().slice(0, 40),
      text: n.text.trim().replace(/\s+/g, ' ').slice(0, 5000),
      w: round(w),
      fontSize: round(size),
      ...(family ? { fontFamily: family } : {}),
      ...(s.fontWeight && Number(s.fontWeight) ? { fontWeight: Number(s.fontWeight) } : {}),
      ...(lh !== undefined ? { lineHeight: round(lh / size) } : {}),
      ...(ls !== undefined && ls !== 0 ? { letterSpacing: round(ls / size) } : {}),
      ...(s.textAlign === 'center'
        ? { textAlign: 'center' as const }
        : s.textAlign === 'right' || s.textAlign === 'end'
          ? { textAlign: 'right' as const }
          : {}),
      ...(s.textTransform === 'uppercase'
        ? { textTransform: 'uppercase' as const }
        : s.textTransform === 'capitalize'
          ? { textTransform: 'capitalize' as const }
          : {}),
      ...(color ? { color } : {}),
      ...(/^h[1-6]$/.test(n.tag)
        ? { role: 'heading' as const, props: { level: n.tag.slice(1) } }
        : {}),
      ...pos,
      ...common,
    };
    note(ctx, 'converted', what);
    if (
      bg === undefined &&
      gradient === undefined &&
      borderColor === undefined &&
      shadow === undefined
    )
      return text;
    // Text on a coloured box (a badge, a button label): the box is a frame, the text sits inside it.
    const pad = [
      px(s.paddingTop) ?? 0,
      px(s.paddingRight) ?? 0,
      px(s.paddingBottom) ?? 0,
      px(s.paddingLeft) ?? 0,
    ];
    return {
      type: 'frame',
      name,
      ...pos,
      w: round(w),
      h: round(h),
      layout: 'none',
      ...(bg ? { fill: bg } : gradient ? { fill: gradient } : {}),
      ...border,
      ...radiusOf(s),
      ...(shadow ? { shadow } : {}),
      children: [
        {
          ...text,
          x: round(pad[3] ?? 0),
          y: round(pad[0] ?? 0),
          w: Math.max(1, round(w - (pad[1] ?? 0) - (pad[3] ?? 0))),
        },
      ],
      ...(n.tag === 'button'
        ? { role: 'button' as const }
        : n.tag === 'a'
          ? { role: 'link' as const, ...(n.attrs?.href ? { href: n.attrs.href } : {}) }
          : {}),
      ...common,
    };
  }

  ctx.budget.take();
  const flex = /flex/.test(s.display ?? '');
  const out: NodeSpec[] = [];
  for (const c of kids) {
    const spec = convert(c, n, ctx, depth + 1, origin);
    if (spec) out.push(spec);
  }
  if (out.length === 0 && bg === undefined && gradient === undefined && borderColor === undefined) {
    if (n.tag === 'input' || n.tag === 'textarea' || n.tag === 'select')
      return inputLike(n, ctx, pos, w, h, common);
    return null;
  }

  let layout: NodeSpec['layout'] = 'none';
  let layoutProps: Partial<NodeSpec> = {};
  if (flex) {
    const column = (s.flexDirection ?? 'row').startsWith('column');
    layout = column ? 'column' : 'row';
    const gap = px(column ? (s.rowGap ?? s.gap) : (s.columnGap ?? s.gap)) ?? 0;
    const pad = [
      px(s.paddingTop) ?? 0,
      px(s.paddingRight) ?? 0,
      px(s.paddingBottom) ?? 0,
      px(s.paddingLeft) ?? 0,
    ];
    layoutProps = {
      ...(gap > 0 ? { gap: round(gap) } : {}),
      ...(pad.some((p) => p > 0)
        ? { padding: pad.map(round) as [number, number, number, number] }
        : {}),
      justify: JUSTIFY[s.justifyContent ?? 'normal'] ?? 'start',
      align: ALIGN[s.alignItems ?? 'normal'] ?? 'start',
      ...(s.flexWrap === 'wrap' ? { wrap: true } : {}),
    };
  } else {
    const stack = stackOf(kids, n.box);
    if (stack !== null) {
      layout = 'column';
      const pad = [Math.max(0, stack.top), px(s.paddingRight) ?? 0, 0, Math.max(0, stack.left)];
      layoutProps = {
        ...(stack.gap > 0 ? { gap: stack.gap } : {}),
        padding: pad.map(round) as [number, number, number, number],
        justify: 'start',
        align: 'start',
      };
      for (const c of out) {
        delete c.x;
        delete c.y;
      }
      noteOnce(
        ctx,
        'approximated',
        'stacked blocks',
        'blocks that stack evenly became a column; margins became the gap',
      );
    } else if (out.length > 1) {
      noteOnce(
        ctx,
        'approximated',
        'positioned layers',
        'blocks, grids and overlaps are placed by coordinates; convert them to auto-layout where they should flow',
      );
    }
  }
  if (flex || layout === 'column') {
    // Children of a layout are placed by it.
    for (const c of out) {
      delete c.x;
      delete c.y;
    }
  }
  note(ctx, 'converted', what);
  return {
    type: 'frame',
    name,
    ...pos,
    w: round(w),
    h: round(h),
    layout,
    ...layoutProps,
    ...(bg ? { fill: bg } : gradient ? { fill: gradient } : {}),
    ...border,
    ...radiusOf(s),
    ...(shadow ? { shadow } : {}),
    ...(n.tag === 'button'
      ? { role: 'button' as const }
      : n.tag === 'a'
        ? { role: 'link' as const, ...(n.attrs?.href ? { href: n.attrs.href } : {}) }
        : n.tag === 'nav'
          ? { role: 'nav' as const }
          : n.tag === 'section'
            ? { role: 'section' as const }
            : {}),
    ...(out.length > 0 ? { children: out } : {}),
    ...common,
  };
}

function inputLike(
  n: DomNode,
  ctx: Ctx,
  pos: Partial<NodeSpec>,
  w: number,
  h: number,
  common: Partial<NodeSpec>,
): NodeSpec {
  const s = n.style;
  const bg = cssColor(s.backgroundColor) ?? '#ffffff';
  const placeholder = n.attrs?.placeholder ?? n.attrs?.value ?? '';
  note(
    ctx,
    'approximated',
    `<${n.tag}> ${nameOf(n)}`,
    'a form field is drawn as a box with its placeholder',
  );
  return {
    type: 'frame',
    name: nameOf(n),
    ...pos,
    w: round(w),
    h: round(h),
    layout: 'row',
    align: 'center',
    padding: [0, px(s.paddingRight) ?? 12, 0, px(s.paddingLeft) ?? 12],
    fill: bg,
    ...radiusOf(s),
    role: 'input',
    ...(px(s.borderTopWidth)
      ? {
          stroke: cssColor(s.borderTopColor) ?? '#cccccc',
          strokeWidth: px(s.borderTopWidth),
          strokeAlign: 'inside' as const,
        }
      : {}),
    children:
      placeholder === ''
        ? []
        : [
            {
              type: 'text',
              name: 'Placeholder',
              text: placeholder.slice(0, 200),
              fontSize: px(s.fontSize) ?? 16,
              color: '#8a8a8a',
              w: 'hug',
            },
          ],
    ...common,
  };
}

/** If the children stack top to bottom with an even gap, the column's gap and the offsets of the first one. */
function stackOf(kids: DomNode[], box: DomBox): { gap: number; top: number; left: number } | null {
  if (kids.length < 2) return null;
  const sorted = [...kids].sort((a, b) => a.box.y - b.box.y);
  const first = sorted[0] as DomNode;
  const left = first.box.x - box.x;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1] as DomNode;
    const cur = sorted[i] as DomNode;
    if (cur.box.y < prev.box.y + prev.box.h - 1) return null; // overlap or side by side
    if (Math.abs(cur.box.x - first.box.x) > 1) return null; // not one column
    gaps.push(cur.box.y - (prev.box.y + prev.box.h));
  }
  const gap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  if (gaps.some((g) => Math.abs(g - gap) > 1)) return null;
  return { gap: Math.max(0, gap), top: first.box.y - box.y, left };
}

export function importDom(snapshot: DomSnapshot): ImportResult {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.root) {
    throw new ImportError('That is not a page capture.');
  }
  const ctx: Ctx = { report: [], tally: new ColorTally(), budget: new Budget(), once: new Set() };
  const root = snapshot.root;
  const spec = convert(root, null, ctx, 0, root.box);
  if (spec) {
    spec.w = round(root.box.w);
    spec.h = round(root.box.h);
    spec.clip = true;
    spec.name = snapshot.title.trim().slice(0, 60) || spec.name;
    noteOnce(
      ctx,
      'approximated',
      'sizes',
      `fixed at the captured width of ${Math.round(snapshot.width)}px: nothing is responsive yet`,
    );
  }
  const host = /^https?:\/\/([^/?#]+)/.exec(snapshot.url)?.[1] ?? 'Web page';
  const title = snapshot.title.trim() || host;
  return {
    name: title.slice(0, 60),
    spec,
    assets: [],
    report: ctx.report,
    colors: ctx.tally.repeated(),
  };
}
