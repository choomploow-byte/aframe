/**
 * Figma import from the REST API's file JSON (`GET /v1/files/:key`): frames, auto-layout, text styles,
 * fills, strokes, radii and effects become Atelier layers with the same settings; what has no
 * equivalent is approximated or replaced, and the report says which. The pictures Figma only gives as
 * links (image fills, vector shapes) are passed in by the caller (the desktop app fetches them), so
 * this stays pure and testable against recorded JSON.
 *
 * Not imported: prototype links and interactions, variables and modes, plugin data, masks beyond a
 * frame's clip, constraints (responsive pinning), blend modes, text with mixed styles (the first style
 * is used), boolean operations as live shapes (they come in as a drawing or a placeholder).
 */
import { fontInfo } from '../fonts';
import { utf8 } from '../utf8';
import type { NodeSpec } from '../types';
import {
  Budget,
  ColorTally,
  IMPORT_LIMITS,
  ImportError,
  type ImportAsset,
  type ImportResult,
  type ReportEntry,
} from './types';

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOf = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const strOf = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const round = (n: number): number => Math.round(n * 100) / 100;

export interface FigmaFrameInfo {
  id: string;
  name: string;
  page: string;
  width: number;
  height: number;
}

/** `https://www.figma.com/design/KEY/Name?node-id=1-2` (or /file/) -> the file key and node id. */
export function parseFigmaUrl(input: string): { key: string; nodeId?: string } | null {
  const m =
    /^https:\/\/(?:www\.)?figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]{10,40})(?:[/?#]|$)/.exec(
      input.trim(),
    );
  if (!m?.[1]) return null;
  const node = /[?&]node-id=([\d]+[-:][\d]+)/.exec(input);
  return { key: m[1], ...(node?.[1] ? { nodeId: node[1].replace('-', ':') } : {}) };
}

/** The top-level frames of every page, for the "which frames?" chooser. */
export function listFigmaFrames(file: unknown): FigmaFrameInfo[] {
  const doc = isObject(file) && isObject(file.document) ? file.document : null;
  if (!doc) throw new ImportError('That does not look like a Figma file.');
  const out: FigmaFrameInfo[] = [];
  for (const page of arr(doc.children)) {
    if (!isObject(page) || page.type !== 'CANVAS') continue;
    for (const child of arr(page.children)) {
      if (!isObject(child)) continue;
      if (!['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(String(child.type)))
        continue;
      const box = isObject(child.absoluteBoundingBox) ? child.absoluteBoundingBox : {};
      out.push({
        id: String(child.id),
        name: (strOf(child.name) ?? 'Frame').slice(0, 80),
        page: (strOf(page.name) ?? 'Page').slice(0, 80),
        width: Math.round(numOf(box.width) ?? 0),
        height: Math.round(numOf(box.height) ?? 0),
      });
    }
  }
  return out;
}

/** Ids of the nodes that need a picture from Figma's images endpoint (vectors), and image fills' refs. */
export function figmaPictureNeeds(
  file: unknown,
  frameId: string,
): { vectorIds: string[]; imageRefs: string[] } {
  const found = findNode(file, frameId);
  const vectorIds: string[] = [];
  const imageRefs = new Set<string>();
  const walk = (n: Json, depth: number): void => {
    if (depth > IMPORT_LIMITS.maxDepth) return;
    if (VECTORS.has(String(n.type))) vectorIds.push(String(n.id));
    for (const f of arr(n.fills)) {
      if (
        isObject(f) &&
        f.type === 'IMAGE' &&
        f.visible !== false &&
        typeof f.imageRef === 'string'
      ) {
        imageRefs.add(f.imageRef);
      }
    }
    for (const c of arr(n.children)) if (isObject(c)) walk(c, depth + 1);
  };
  if (found) walk(found, 0);
  return { vectorIds: vectorIds.slice(0, 200), imageRefs: [...imageRefs].slice(0, 100) };
}

function findNode(file: unknown, id: string): Json | null {
  const stack: unknown[] = [isObject(file) ? file.document : null];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!isObject(n)) continue;
    if (n.id === id) return n;
    for (const c of arr(n.children)) stack.push(c);
  }
  return null;
}

const VECTORS = new Set([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'POLYGON',
  'REGULAR_POLYGON',
  'LINE_VECTOR',
]);
const FRAMES = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP', 'SECTION']);

export interface FigmaPictures {
  /** Node id -> SVG text from the images endpoint (format=svg). */
  vectorSvgs?: Record<string, string>;
  /** imageRef -> picture bytes. */
  imageFills?: Record<string, { mime: ImportAsset['mime']; bytes: Uint8Array }>;
}

interface Ctx {
  report: ReportEntry[];
  tally: ColorTally;
  budget: Budget;
  assets: ImportAsset[];
  pictures: FigmaPictures;
  /** Report entries that would repeat for every node are written once. */
  once: Set<string>;
}

const hex2 = (n: number): string =>
  Math.round(Math.min(1, Math.max(0, n)) * 255)
    .toString(16)
    .padStart(2, '0');

function colorOf(c: unknown, extra = 1): string | undefined {
  if (!isObject(c)) return undefined;
  const r = numOf(c.r);
  const g = numOf(c.g);
  const b = numOf(c.b);
  if (r === undefined || g === undefined || b === undefined) return undefined;
  const a = (numOf(c.a) ?? 1) * extra;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 0.995 ? hex2(a) : ''}`;
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

function gradientOf(fill: Json, ctx: Ctx, what: string): string | undefined {
  const stops = arr(fill.gradientStops)
    .map((s) =>
      isObject(s)
        ? `${colorOf(s.color, numOf(fill.opacity) ?? 1) ?? '#000000'} ${Math.round((numOf(s.position) ?? 0) * 100)}%`
        : null,
    )
    .filter((s): s is string => s !== null);
  if (stops.length < 2) return undefined;
  for (const s of arr(fill.gradientStops))
    if (isObject(s)) ctx.tally.add(colorOf(s.color)?.slice(0, 7));
  if (fill.type === 'GRADIENT_RADIAL') {
    note(ctx, 'approximated', `radial gradient on ${what}`, 'it is centred on the layer');
    return `radial-gradient(${stops.join(', ')})`;
  }
  const h = arr(fill.gradientHandlePositions);
  const [p0, p1] = [h[0], h[1]];
  let angle = 180;
  if (isObject(p0) && isObject(p1)) {
    const dx = (numOf(p1.x) ?? 0) - (numOf(p0.x) ?? 0);
    const dy = (numOf(p1.y) ?? 0) - (numOf(p0.y) ?? 0);
    angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90);
    angle = ((angle % 360) + 360) % 360;
  } else {
    note(
      ctx,
      'approximated',
      `gradient on ${what}`,
      'the angle was not in the file; top to bottom was assumed',
    );
  }
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

interface Look {
  fill?: string;
  /** A picture the layer is filled with (an image node is made for it). */
  imageRef?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeAlign?: 'inside' | 'center' | 'outside';
  shadow?: { x: number; y: number; blur: number; spread: number; color: string; inset?: boolean }[];
  blur?: number;
  backdropBlur?: number;
}

function lookOf(n: Json, ctx: Ctx, what: string, withFill = true): Look {
  const out: Look = {};
  const fills = arr(n.fills).filter((f): f is Json => isObject(f) && f.visible !== false);
  if (withFill && fills.length > 0) {
    const f = fills[0] as Json;
    if (f.type === 'SOLID') {
      out.fill = colorOf(f.color, numOf(f.opacity) ?? 1);
      ctx.tally.add(colorOf(f.color)?.slice(0, 7));
    } else if (String(f.type).startsWith('GRADIENT')) {
      if (f.type === 'GRADIENT_ANGULAR' || f.type === 'GRADIENT_DIAMOND') {
        const first = colorOf(arr(f.gradientStops).map((s) => (isObject(s) ? s.color : null))[0]);
        note(
          ctx,
          'approximated',
          `${String(f.type).slice(9).toLowerCase()} gradient on ${what}`,
          'the first colour was used',
        );
        if (first !== undefined) out.fill = first;
      } else out.fill = gradientOf(f, ctx, what);
    } else if (f.type === 'IMAGE' && typeof f.imageRef === 'string') out.imageRef = f.imageRef;
    if (fills.length > 1)
      note(
        ctx,
        'approximated',
        `fills on ${what}`,
        `${fills.length - 1} more fill${fills.length === 2 ? '' : 's'} under the first were dropped`,
      );
  }
  const strokes = arr(n.strokes).filter((s): s is Json => isObject(s) && s.visible !== false);
  const s0 = strokes[0];
  if (s0 && s0.type === 'SOLID') {
    out.stroke = colorOf(s0.color, numOf(s0.opacity) ?? 1);
    ctx.tally.add(colorOf(s0.color)?.slice(0, 7));
    out.strokeWidth = numOf(n.strokeWeight) ?? 1;
    const align = strOf(n.strokeAlign);
    out.strokeAlign = align === 'INSIDE' ? 'inside' : align === 'OUTSIDE' ? 'outside' : 'center';
  } else if (s0) note(ctx, 'approximated', `stroke on ${what}`, 'only solid strokes are imported');
  for (const e of arr(n.effects)) {
    if (!isObject(e) || e.visible === false) continue;
    const off = isObject(e.offset) ? e.offset : {};
    if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
      (out.shadow ??= []).push({
        x: numOf(off.x) ?? 0,
        y: numOf(off.y) ?? 0,
        blur: numOf(e.radius) ?? 0,
        spread: numOf(e.spread) ?? 0,
        color: colorOf(e.color) ?? '#00000040',
        ...(e.type === 'INNER_SHADOW' ? { inset: true } : {}),
      });
    } else if (e.type === 'LAYER_BLUR') out.blur = numOf(e.radius) ?? 0;
    else if (e.type === 'BACKGROUND_BLUR') out.backdropBlur = numOf(e.radius) ?? 0;
  }
  return out;
}

function radiusOf(n: Json): Partial<NodeSpec> {
  const tuple = arr(n.rectangleCornerRadii).map(Number);
  if (tuple.length === 4 && tuple.every(Number.isFinite)) {
    const [a = 0, b = 0, c = 0, d = 0] = tuple;
    return a === b && b === c && c === d ? (a > 0 ? { radius: a } : {}) : { radius: [a, b, c, d] };
  }
  const r = numOf(n.cornerRadius);
  return r !== undefined && r > 0 ? { radius: round(r) } : {};
}

export function importFigma(
  file: unknown,
  options: { frameId: string } & FigmaPictures,
): ImportResult {
  const root = findNode(file, options.frameId);
  if (!root) throw new ImportError('That frame is not in the file.');
  const ctx: Ctx = {
    report: [],
    tally: new ColorTally(),
    budget: new Budget(),
    assets: [],
    pictures: options,
    once: new Set(),
  };
  const spec = convert(root, null, ctx, 0, true);
  return {
    name: (strOf(root.name) ?? 'Figma frame').slice(0, 60),
    spec,
    assets: ctx.assets,
    report: ctx.report,
    colors: ctx.tally.repeated(),
  };
}

function attachPicture(
  spec: NodeSpec[],
  look: Look,
  box: { w: number; h: number },
  ctx: Ctx,
  what: string,
  name: string,
): void {
  if (look.imageRef === undefined) return;
  const pic = ctx.pictures.imageFills?.[look.imageRef];
  if (!pic) {
    note(
      ctx,
      'fallback',
      `image fill on ${what}`,
      'the picture was not downloaded; a grey placeholder is drawn',
    );
    return;
  }
  const ref = `f${ctx.assets.length + 1}`;
  ctx.assets.push({ ref, mime: pic.mime, bytes: pic.bytes });
  spec.push({
    type: 'image',
    name: `${name} image`.slice(0, 60),
    x: 0,
    y: 0,
    w: round(box.w),
    h: round(box.h),
    assetId: `ref:${ref}`,
    fit: 'cover',
  });
  note(
    ctx,
    'approximated',
    `image fill on ${what}`,
    'it is a separate image layer behind the content',
  );
}

function convert(
  n: Json,
  parent: Json | null,
  ctx: Ctx,
  depth: number,
  isRoot = false,
): NodeSpec | null {
  if (depth > IMPORT_LIMITS.maxDepth)
    throw new ImportError('This frame is nested too deeply to import.');
  const type = String(n.type);
  const name = (strOf(n.name) ?? type).slice(0, 60);
  const what = `${type} ${name}`;
  const box = isObject(n.absoluteBoundingBox) ? n.absoluteBoundingBox : null;
  const pbox = parent && isObject(parent.absoluteBoundingBox) ? parent.absoluteBoundingBox : null;
  const bw = numOf(box?.width) ?? 0;
  const bh = numOf(box?.height) ?? 0;
  const parentAuto =
    parent !== null && (parent.layoutMode === 'HORIZONTAL' || parent.layoutMode === 'VERTICAL');

  if (n.visible === false) {
    note(ctx, 'skipped', what, 'it is hidden in Figma');
    return null;
  }

  // Position: relative to the parent unless the parent's auto-layout decides it.
  const pos: Partial<NodeSpec> =
    isRoot || parentAuto || !box || !pbox
      ? {}
      : {
          x: round((numOf(box.x) ?? 0) - (numOf(pbox.x) ?? 0)),
          y: round((numOf(box.y) ?? 0) - (numOf(pbox.y) ?? 0)),
        };

  // Size: Figma's own sizing modes when it says, else the measured box.
  const sizing = (axis: 'Horizontal' | 'Vertical', measured: number): number | 'hug' | 'fill' => {
    const mode = strOf(n[`layoutSizing${axis}`]);
    if (mode === 'HUG') return 'hug';
    if (mode === 'FILL') return 'fill';
    if (mode === 'FIXED') return Math.max(1, round(measured));
    const primary = parent?.layoutMode === (axis === 'Horizontal' ? 'HORIZONTAL' : 'VERTICAL');
    if (
      parentAuto &&
      ((primary && n.layoutGrow === 1) || (!primary && n.layoutAlign === 'STRETCH'))
    )
      return 'fill';
    return Math.max(1, round(measured));
  };
  const w = sizing('Horizontal', bw);
  const h = sizing('Vertical', bh);

  const opacity = numOf(n.opacity);
  const rotation = numOf(n.rotation);
  const common: Partial<NodeSpec> = {
    ...(opacity !== undefined && opacity < 1 ? { opacity: round(opacity) } : {}),
    ...(rotation !== undefined && Math.abs(rotation) > 0.001
      ? { rotation: round((-rotation * 180) / Math.PI) }
      : {}),
  };
  if (rotation !== undefined && Math.abs(rotation) > 0.001) {
    noteOnce(ctx, 'approximated', 'rotated layers', 'rotation is applied around the layer centre');
  }
  if (arr(n.reactions).length > 0)
    noteOnce(
      ctx,
      'skipped',
      'prototype interactions',
      'links and animations between frames are not imported',
    );
  if (isObject(n.boundVariables) && Object.keys(n.boundVariables).length > 0) {
    noteOnce(
      ctx,
      'skipped',
      'variables',
      'values bound to variables came in as their current value',
    );
  }

  if (VECTORS.has(type)) {
    ctx.budget.take();
    const svg = ctx.pictures.vectorSvgs?.[String(n.id)];
    const dims = {
      w: typeof w === 'number' ? w : Math.max(1, bw),
      h: typeof h === 'number' ? h : Math.max(1, bh),
    };
    if (
      svg !== undefined &&
      /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg) &&
      !/<script|<foreignObject/i.test(svg)
    ) {
      const ref = `v${ctx.assets.length + 1}`;
      ctx.assets.push({ ref, mime: 'image/svg+xml', bytes: utf8(svg) });
      note(ctx, 'fallback', what, 'drawn as the image Figma exports for it (not editable points)');
      return {
        type: 'image',
        name,
        ...pos,
        w: dims.w,
        h: dims.h,
        assetId: `ref:${ref}`,
        fit: 'fill',
        ...common,
      };
    }
    note(
      ctx,
      'fallback',
      what,
      'a grey placeholder is drawn: export it from Figma as SVG and import that',
    );
    return {
      type: 'rect',
      name: `${name} (vector placeholder)`.slice(0, 60),
      ...pos,
      w: dims.w,
      h: dims.h,
      fill: '#e5e5e5',
      ...common,
    };
  }

  if (type === 'TEXT') {
    ctx.budget.take();
    const style = isObject(n.style) ? n.style : {};
    const size = numOf(style.fontSize) ?? 16;
    const family = strOf(style.fontFamily);
    if (family && !fontInfo(family)) {
      noteOnce(
        ctx,
        'approximated',
        `font ${family}`,
        "it is not one of Atelier's bundled fonts; it is named as-is and falls back to a similar one",
      );
    }
    if (isObject(n.characterStyleOverrides) || arr(n.characterStyleOverrides).length > 0) {
      noteOnce(
        ctx,
        'approximated',
        'text with mixed styles',
        'the first style is used for the whole text',
      );
    }
    const look = lookOf(n, ctx, what);
    const lineHeight = numOf(style.lineHeightPx);
    const ls = numOf(style.letterSpacing);
    const align = strOf(style.textAlignHorizontal);
    const textCase = strOf(style.textCase);
    note(ctx, 'converted', what);
    return {
      type: 'text',
      name,
      ...pos,
      w:
        strOf(n.textAutoResize) === 'WIDTH_AND_HEIGHT' &&
        strOf(n.layoutSizingHorizontal) !== 'FIXED'
          ? 'hug'
          : w,
      text: (strOf(n.characters) ?? '').slice(0, 5000),
      fontSize: round(size),
      ...(family ? { fontFamily: family } : {}),
      ...(numOf(style.fontWeight) ? { fontWeight: numOf(style.fontWeight) } : {}),
      ...(lineHeight !== undefined && size > 0 ? { lineHeight: round(lineHeight / size) } : {}),
      ...(ls !== undefined && size > 0 && ls !== 0 ? { letterSpacing: round(ls / size) } : {}),
      ...(align === 'CENTER'
        ? { textAlign: 'center' as const }
        : align === 'RIGHT'
          ? { textAlign: 'right' as const }
          : align === 'JUSTIFIED'
            ? { textAlign: 'justify' as const }
            : {}),
      ...(textCase === 'UPPER'
        ? { textTransform: 'uppercase' as const }
        : textCase === 'TITLE'
          ? { textTransform: 'capitalize' as const }
          : {}),
      ...(look.fill && !look.fill.includes('gradient') ? { color: look.fill } : {}),
      ...common,
    };
  }

  if (type === 'RECTANGLE' || type === 'ELLIPSE' || type === 'LINE') {
    ctx.budget.take();
    const look = lookOf(n, ctx, what);
    if (type === 'LINE') {
      const sw = look.strokeWidth ?? 1;
      note(ctx, 'converted', what, 'drawn as a thin rectangle');
      return {
        type: 'rect',
        name,
        ...pos,
        w: Math.max(1, round(bw)),
        h: Math.max(1, round(bh || sw)),
        fill: look.stroke ?? '#000000',
        ...common,
      };
    }
    const children: NodeSpec[] = [];
    attachPicture(children, look, { w: bw, h: bh }, ctx, what, name);
    const hasPicture = children.length > 0;
    if (hasPicture) {
      // A shape filled with a picture is an image layer with the shape's corners.
      const image = children[0] as NodeSpec;
      note(ctx, 'converted', what);
      return {
        ...image,
        name,
        ...pos,
        w,
        h,
        ...radiusOf(n),
        ...(look.stroke
          ? { stroke: look.stroke, strokeWidth: look.strokeWidth, strokeAlign: look.strokeAlign }
          : {}),
        ...common,
      };
    }
    note(ctx, 'converted', what);
    return {
      type: type === 'ELLIPSE' ? 'ellipse' : 'rect',
      name,
      ...pos,
      w,
      h,
      ...(type === 'RECTANGLE' ? radiusOf(n) : {}),
      ...(look.fill ? { fill: look.fill } : look.imageRef ? { fill: '#e5e5e5' } : {}),
      ...(look.stroke
        ? { stroke: look.stroke, strokeWidth: look.strokeWidth, strokeAlign: look.strokeAlign }
        : {}),
      ...(look.shadow ? { shadow: look.shadow } : {}),
      ...(look.blur ? { blur: look.blur } : {}),
      ...common,
    };
  }

  if (FRAMES.has(type)) {
    ctx.budget.take();
    const look = lookOf(n, ctx, what);
    const mode = strOf(n.layoutMode);
    const auto = mode === 'HORIZONTAL' || mode === 'VERTICAL';
    const kids: NodeSpec[] = [];
    attachPicture(kids, look, { w: bw, h: bh }, ctx, what, name);
    for (const c of arr(n.children)) {
      if (!isObject(c)) continue;
      const child = convert(c, n, ctx, depth + 1);
      if (child) kids.push(child);
    }
    const pad = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map(
      (v) => numOf(v) ?? 0,
    );
    const primary = strOf(n.primaryAxisAlignItems);
    const counter = strOf(n.counterAxisAlignItems);
    if (strOf(n.layoutWrap) === 'WRAP' && numOf(n.counterAxisSpacing) !== undefined) {
      noteOnce(
        ctx,
        'approximated',
        'wrapping layouts',
        'the spacing between wrapped rows uses the main gap',
      );
    }
    if (type === 'INSTANCE' || type === 'COMPONENT')
      noteOnce(
        ctx,
        'approximated',
        'components and instances',
        'they come in as plain frames, not linked components',
      );
    note(ctx, 'converted', what);
    return {
      type: 'frame',
      name,
      ...pos,
      w,
      h,
      layout: auto ? (mode === 'HORIZONTAL' ? 'row' : 'column') : 'none',
      ...(auto && numOf(n.itemSpacing) ? { gap: round(numOf(n.itemSpacing) as number) } : {}),
      ...(auto && pad.some((p) => p > 0)
        ? { padding: pad.map(round) as [number, number, number, number] }
        : {}),
      ...(auto
        ? {
            justify:
              primary === 'CENTER'
                ? ('center' as const)
                : primary === 'MAX'
                  ? ('end' as const)
                  : primary === 'SPACE_BETWEEN'
                    ? ('between' as const)
                    : ('start' as const),
          }
        : {}),
      ...(auto
        ? {
            align:
              counter === 'CENTER'
                ? ('center' as const)
                : counter === 'MAX'
                  ? ('end' as const)
                  : ('start' as const),
          }
        : {}),
      ...(auto && strOf(n.layoutWrap) === 'WRAP' ? { wrap: true } : {}),
      ...(n.clipsContent === true ? { clip: true } : {}),
      ...(look.fill ? { fill: look.fill } : {}),
      ...(look.stroke
        ? { stroke: look.stroke, strokeWidth: look.strokeWidth, strokeAlign: look.strokeAlign }
        : {}),
      ...radiusOf(n),
      ...(look.shadow ? { shadow: look.shadow } : {}),
      ...(look.blur ? { blur: look.blur } : {}),
      ...(look.backdropBlur ? { backdropBlur: look.backdropBlur } : {}),
      ...(kids.length > 0 ? { children: kids } : {}),
      ...common,
    };
  }

  note(ctx, 'skipped', what, 'a kind of layer Atelier does not have');
  return null;
}
