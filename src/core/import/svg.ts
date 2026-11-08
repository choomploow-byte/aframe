/**
 * SVG import (docs/10): rect, circle, ellipse, text, groups and embedded pictures become editable
 * layers; fills, strokes, opacity and translate/scale transforms come along; gradients become
 * gradient fills; anything with real vector geometry (paths, polygons, diagonal lines) is kept as an
 * image of exactly that drawing, so it looks right even though it is not editable. Nothing is
 * fetched, no script runs, and every approximation is listed in the report.
 */
import { base64ToBytes } from '../assets';
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
import { parseXml, serialize, type XmlElement } from './xml';

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  pink: '#ffc0cb',
  brown: '#a52a2a',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  teal: '#008080',
  navy: '#000080',
  lime: '#00ff00',
  transparent: '#00000000',
};

interface Matrix {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}
const IDENTITY: Matrix = { tx: 0, ty: 0, sx: 1, sy: 1 };

interface Style {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  textAnchor?: string;
  fillOpacity?: number;
  strokeOpacity?: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;
const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) && /^-?[\d.]+(px)?$/i.test(v.trim()) ? n : undefined;
};

function styleOf(el: XmlElement): Record<string, string> {
  const out: Record<string, string> = { ...el.attrs };
  for (const part of (el.attrs.style ?? '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function parseTransform(
  value: string | undefined,
  report: (why: string) => void,
): Matrix & { rotate?: number } {
  const m: Matrix & { rotate?: number } = { ...IDENTITY };
  if (!value) return m;
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let found: RegExpExecArray | null;
  while ((found = re.exec(value)) !== null) {
    const args = (found[2] as string)
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (args.some((a) => !Number.isFinite(a))) continue;
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args;
    switch (found[1] ?? '') {
      case 'translate':
        m.tx += m.sx * a;
        m.ty += m.sy * (args.length > 1 ? b : 0);
        break;
      case 'scale':
        m.sx *= a;
        m.sy *= args.length > 1 ? b : a;
        break;
      case 'rotate':
        m.rotate = (m.rotate ?? 0) + a;
        report('rotation is applied around the layer, not the original point');
        break;
      case 'matrix':
        if (b !== 0 || c !== 0) report('skew and rotation in a matrix were dropped');
        m.tx += m.sx * e;
        m.ty += m.sy * f;
        m.sx *= a;
        m.sy *= d;
        break;
      default:
        report(`the transform "${found[1] ?? ''}" was ignored`);
    }
  }
  return m;
}

const combine = (parent: Matrix, child: Matrix): Matrix => ({
  tx: parent.tx + parent.sx * child.tx,
  ty: parent.ty + parent.sy * child.ty,
  sx: parent.sx * child.sx,
  sy: parent.sy * child.sy,
});

export function importSvg(source: string, fileName = 'SVG'): ImportResult {
  const root = parseXml(source);
  const report: ReportEntry[] = [];
  const assets: ImportAsset[] = [];
  const tally = new ColorTally();
  const budget = new Budget();
  const gradients = new Map<string, XmlElement>();
  const defs: XmlElement[] = [];

  // First pass: gradients and defs (any depth), so a fill can refer to one declared later.
  const collect = (el: XmlElement): void => {
    if ((el.name === 'linearGradient' || el.name === 'radialGradient') && el.attrs.id)
      gradients.set(el.attrs.id, el);
    if (el.name === 'defs') defs.push(el);
    for (const c of el.children) collect(c);
  };
  collect(root);

  const vb = (root.attrs.viewBox ?? '').split(/[\s,]+/).map(Number);
  const hasViewBox =
    vb.length === 4 && vb.every(Number.isFinite) && (vb[2] ?? 0) > 0 && (vb[3] ?? 0) > 0;
  const width = hasViewBox ? (vb[2] as number) : (num(root.attrs.width) ?? 300);
  const height = hasViewBox ? (vb[3] as number) : (num(root.attrs.height) ?? 150);
  if (width > 20000 || height > 20000)
    throw new ImportError('That drawing is larger than 20000 pixels.');
  const originX = hasViewBox ? (vb[0] as number) : 0;
  const originY = hasViewBox ? (vb[1] as number) : 0;

  const note = (kind: ReportEntry['kind'], what: string, why?: string): void => {
    report.push(why === undefined ? { kind, what } : { kind, what, why });
  };

  const resolveColor = (value: string | undefined, what: string): string | undefined => {
    if (value === undefined || value === 'none') return undefined;
    const v = value.trim().toLowerCase();
    let hex: string | undefined;
    if (/^#[0-9a-f]{6}$/.test(v) || /^#[0-9a-f]{8}$/.test(v)) hex = v;
    else if (/^#[0-9a-f]{3}$/.test(v)) hex = `#${[...v.slice(1)].map((c) => c + c).join('')}`;
    else {
      const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
      if (rgb)
        hex = `#${[rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`;
      else if (NAMED[v]) hex = NAMED[v];
      else if (v === 'currentcolor') {
        note('approximated', `colour on ${what}`, 'currentColor was read as black');
        hex = '#000000';
      } else {
        note(
          'approximated',
          `colour "${value}" on ${what}`,
          'not a colour Atelier reads; black was used',
        );
        hex = '#000000';
      }
    }
    tally.add(hex.length === 7 ? hex : undefined);
    return hex;
  };

  /** A fill value: a colour, or a gradient looked up by url(#id). */
  const paint = (
    value: string | undefined,
    what: string,
    opacity: number | undefined,
  ): string | undefined => {
    if (value === undefined || value === 'none') return undefined;
    const ref = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value);
    if (ref) {
      const g = gradients.get(ref[1] as string);
      if (!g) {
        note(
          'skipped',
          `fill on ${what}`,
          `the gradient or pattern "${ref[1] ?? ''}" is not in the file`,
        );
        return undefined;
      }
      const stops = g.children
        .filter((c) => c.name === 'stop')
        .map((s) => {
          const st = styleOf(s);
          const color = resolveColor(st['stop-color'] ?? '#000000', what);
          const off = parseFloat(st.offset ?? '0');
          const pct = (st.offset ?? '').includes('%') ? off : off * 100;
          return color === undefined
            ? null
            : `${color} ${Math.round(Math.min(100, Math.max(0, pct)))}%`;
        })
        .filter((s): s is string => s !== null);
      if (stops.length < 2) {
        note('skipped', `gradient on ${what}`, 'it has fewer than two colour stops');
        return undefined;
      }
      if (g.name === 'radialGradient') {
        note('approximated', `gradient on ${what}`, 'a radial gradient is centred on the shape');
        return `radial-gradient(${stops.join(', ')})`;
      }
      const dx = parseFloat(g.attrs.x2 ?? '1') - parseFloat(g.attrs.x1 ?? '0') || 0;
      const dy = parseFloat(g.attrs.y2 ?? '0') - parseFloat(g.attrs.y1 ?? '0') || 0;
      const angle = Math.round((Math.atan2(dy, dx) * 180) / Math.PI + 90);
      return `linear-gradient(${((angle % 360) + 360) % 360}deg, ${stops.join(', ')})`;
    }
    const hex = resolveColor(value, what);
    if (hex === undefined) return undefined;
    if (opacity !== undefined && opacity < 1 && hex.length === 7) {
      return `${hex}${Math.round(Math.max(0, opacity) * 255)
        .toString(16)
        .padStart(2, '0')}`;
    }
    return hex;
  };

  const inherit = (parent: Style, el: XmlElement): Style => {
    const s = styleOf(el);
    const out: Style = { ...parent };
    if (s.fill !== undefined) out.fill = s.fill;
    if (s.stroke !== undefined) out.stroke = s.stroke;
    const sw = num(s['stroke-width']);
    if (sw !== undefined) out.strokeWidth = sw;
    if (s['font-family'])
      out.fontFamily = s['font-family']
        .split(',')[0]
        ?.trim()
        .replace(/^['"]|['"]$/g, '');
    const fs = num(s['font-size']);
    if (fs !== undefined) out.fontSize = fs;
    const fw =
      s['font-weight'] === 'bold'
        ? 700
        : s['font-weight'] === 'normal'
          ? 400
          : num(s['font-weight']);
    if (fw !== undefined) out.fontWeight = fw;
    if (s['text-anchor']) out.textAnchor = s['text-anchor'];
    const fo = num(s['fill-opacity']);
    if (fo !== undefined) out.fillOpacity = fo;
    const so = num(s['stroke-opacity']);
    if (so !== undefined) out.strokeOpacity = so;
    return out;
  };

  const sanitise = (el: XmlElement): XmlElement => ({
    ...el,
    children: el.children
      .filter((c) => !['script', 'foreignObject'].includes(c.name))
      .map(sanitise),
    mixed: el.mixed
      .filter((c) => typeof c === 'string' || !['script', 'foreignObject'].includes(c.name))
      .map((c) => (typeof c === 'string' ? c : sanitise(c))),
  });

  let drawings = 0;
  /** Keeps one element's drawing as an image the size of the whole artboard (exact, not editable). */
  const asImage = (el: XmlElement, m: Matrix, label: string, why: string): NodeSpec => {
    drawings += 1;
    const ref = `d${drawings}`;
    const wrapped = `<g transform="matrix(${m.sx} 0 0 ${m.sy} ${m.tx} ${m.ty})">${serialize(sanitise(el))}</g>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="${originX} ${originY} ${round(width)} ${round(height)}">${defs.map((d) => serialize(sanitise(d))).join('')}${wrapped}</svg>`;
    assets.push({ ref, mime: 'image/svg+xml', bytes: utf8(svg) });
    note('fallback', label, why);
    return {
      type: 'image',
      name: label,
      x: 0,
      y: 0,
      w: round(width),
      h: round(height),
      assetId: `ref:${ref}`,
      fit: 'fill',
    };
  };

  const labelOf = (el: XmlElement, fallback: string): string =>
    (el.attrs.id ? el.attrs.id : fallback).slice(0, 60);

  const convert = (
    el: XmlElement,
    style: Style,
    parent: Matrix,
    depth: number,
  ): NodeSpec | null => {
    if (depth > IMPORT_LIMITS.maxDepth)
      throw new ImportError('This file is nested too deeply to import.');
    const tr = parseTransform(el.attrs.transform, (why) =>
      note('approximated', `transform on ${labelOf(el, el.name)}`, why),
    );
    const m = combine(parent, tr);
    const st = inherit(style, el);
    const s = styleOf(el);
    const opacity = num(s.opacity);
    const label = labelOf(el, el.name);
    const common = (): Partial<NodeSpec> => ({
      ...(opacity !== undefined && opacity < 1 ? { opacity: Math.max(0, opacity) } : {}),
      ...(tr.rotate !== undefined ? { rotation: tr.rotate } : {}),
    });
    const look = (): Partial<NodeSpec> => {
      const fill = paint(st.fill === undefined ? '#000000' : st.fill, label, st.fillOpacity);
      const stroke = paint(st.stroke, label, st.strokeOpacity);
      const strokeColor = stroke !== undefined && !stroke.includes('gradient') ? stroke : undefined;
      if (stroke?.includes('gradient'))
        note('approximated', `stroke on ${label}`, 'a gradient stroke was dropped');
      return {
        ...(fill === undefined ? {} : { fill }),
        ...(strokeColor === undefined
          ? {}
          : {
              stroke: strokeColor,
              strokeWidth: round((st.strokeWidth ?? 1) * Math.abs(m.sx)),
              strokeAlign: 'center' as const,
            }),
      };
    };

    switch (el.name) {
      case 'defs':
      case 'title':
      case 'desc':
      case 'metadata':
      case 'linearGradient':
      case 'radialGradient':
      case 'clipPath':
      case 'mask':
      case 'filter':
      case 'pattern':
      case 'symbol':
        return null;
      case 'style':
        note(
          'approximated',
          'a <style> block',
          'CSS classes are not applied; colours set by class are lost',
        );
        return null;
      case 'script':
      case 'foreignObject':
        note('skipped', el.name, 'not imported, for safety');
        return null;
      case 'use':
        note('skipped', `use ${label}`, 'reused elements are not followed');
        return null;
      case 'rect': {
        const x = num(el.attrs.x) ?? 0;
        const y = num(el.attrs.y) ?? 0;
        const w = num(el.attrs.width);
        const h = num(el.attrs.height);
        if (!w || !h || w <= 0 || h <= 0) {
          note('skipped', `rect ${label}`, 'it has no size Atelier can read');
          return null;
        }
        budget.take();
        const rx = num(el.attrs.rx) ?? num(el.attrs.ry) ?? 0;
        note('converted', `rect ${label}`);
        return {
          type: 'rect',
          name: label === 'rect' ? 'Rectangle' : label,
          x: round(m.tx + m.sx * x - originX),
          y: round(m.ty + m.sy * y - originY),
          w: round(w * Math.abs(m.sx)),
          h: round(h * Math.abs(m.sy)),
          ...(rx > 0 ? { radius: round(rx * Math.abs(m.sx)) } : {}),
          ...look(),
          ...common(),
        };
      }
      case 'circle':
      case 'ellipse': {
        const cx = num(el.attrs.cx) ?? 0;
        const cy = num(el.attrs.cy) ?? 0;
        const rx = num(el.name === 'circle' ? el.attrs.r : el.attrs.rx);
        const ry = num(el.name === 'circle' ? el.attrs.r : el.attrs.ry);
        if (!rx || !ry || rx <= 0 || ry <= 0) {
          note('skipped', `${el.name} ${label}`, 'it has no radius');
          return null;
        }
        budget.take();
        note('converted', `${el.name} ${label}`);
        return {
          type: 'ellipse',
          name: label === el.name ? 'Ellipse' : label,
          x: round(m.tx + m.sx * (cx - rx) - originX),
          y: round(m.ty + m.sy * (cy - ry) - originY),
          w: round(2 * rx * Math.abs(m.sx)),
          h: round(2 * ry * Math.abs(m.sy)),
          ...look(),
          ...common(),
        };
      }
      case 'line': {
        const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((k) => num(el.attrs[k]) ?? 0) as [
          number,
          number,
          number,
          number,
        ];
        const color = paint(st.stroke, label, st.strokeOpacity);
        const sw = round((st.strokeWidth ?? 1) * Math.abs(m.sy));
        if (color !== undefined && !color.includes('gradient') && (y1 === y2 || x1 === x2)) {
          budget.take();
          note('converted', `line ${label}`, 'drawn as a thin rectangle');
          const horizontal = y1 === y2;
          return {
            type: 'rect',
            name: label === 'line' ? 'Line' : label,
            x: round(m.tx + m.sx * Math.min(x1, x2) - originX - (horizontal ? 0 : sw / 2)),
            y: round(m.ty + m.sy * Math.min(y1, y2) - originY - (horizontal ? sw / 2 : 0)),
            w: horizontal ? round(Math.abs(x2 - x1) * Math.abs(m.sx)) : sw,
            h: horizontal ? sw : round(Math.abs(y2 - y1) * Math.abs(m.sy)),
            fill: color,
            ...common(),
          };
        }
        budget.take();
        return asImage(el, m, `line ${label}`, 'a diagonal or unpainted line is kept as a drawing');
      }
      case 'path':
      case 'polygon':
      case 'polyline': {
        budget.take();
        return asImage(
          { ...el, attrs: { ...el.attrs, ...fillStrokeAttrs(st) } },
          m,
          `${el.name} ${label}`,
          'vector shapes are kept as a drawing, not editable points',
        );
      }
      case 'image': {
        const href = el.attrs.href ?? el.attrs['xlink:href'] ?? '';
        const data = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(href);
        const x = num(el.attrs.x) ?? 0;
        const y = num(el.attrs.y) ?? 0;
        const w = num(el.attrs.width);
        const h = num(el.attrs.height);
        if (!data || !w || !h) {
          note(
            'skipped',
            `image ${label}`,
            data
              ? 'it has no size'
              : 'only pictures stored inside the file are imported (nothing is downloaded)',
          );
          return null;
        }
        const bytes = base64ToBytes((data[2] as string).replace(/\s+/g, ''));
        if (!bytes) {
          note('skipped', `image ${label}`, 'the picture could not be decoded');
          return null;
        }
        budget.take();
        drawings += 1;
        const ref = `p${drawings}`;
        assets.push({ ref, mime: data[1] === 'png' ? 'image/png' : 'image/png', bytes });
        note('converted', `image ${label}`);
        return {
          type: 'image',
          name: label === 'image' ? 'Image' : label,
          x: round(m.tx + m.sx * x - originX),
          y: round(m.ty + m.sy * y - originY),
          w: round(w * Math.abs(m.sx)),
          h: round(h * Math.abs(m.sy)),
          assetId: `ref:${ref}`,
          fit: 'fill',
          ...common(),
        };
      }
      case 'text': {
        const lines: string[] = [];
        let current = '';
        const flush = (): void => {
          if (current.trim() !== '') lines.push(current.trim());
          current = '';
        };
        for (const piece of el.mixed) {
          if (typeof piece === 'string') current += piece.replace(/\s+/g, ' ');
          else if (piece.name === 'tspan') {
            if (piece.attrs.dy !== undefined || piece.attrs.y !== undefined) flush();
            current += piece.text.replace(/\s+/g, ' ');
          }
        }
        flush();
        const text = lines.join('\n');
        if (text === '') {
          note('skipped', `text ${label}`, 'it has no text');
          return null;
        }
        budget.take();
        const size = (st.fontSize ?? 16) * Math.abs(m.sy);
        const x = num(el.attrs.x) ?? 0;
        const y = num(el.attrs.y) ?? 0;
        const widest = Math.max(...lines.map((l) => l.length));
        const estW = Math.ceil(widest * size * 0.55);
        const anchor = st.textAnchor ?? 'start';
        const left =
          m.tx +
          m.sx * x -
          originX -
          (anchor === 'middle' ? estW / 2 : anchor === 'end' ? estW : 0);
        const color = paint(st.fill === undefined ? '#000000' : st.fill, label, st.fillOpacity);
        note(
          'converted',
          `text "${text.slice(0, 24)}"`,
          'position and width are estimated from the font size',
        );
        return {
          type: 'text',
          name: text.slice(0, 40),
          text,
          x: round(left),
          // SVG places text by its baseline; Atelier by its top.
          y: round(m.ty + m.sy * y - originY - size * 0.8),
          w: estW,
          fontSize: round(size),
          ...(st.fontFamily ? { fontFamily: st.fontFamily } : {}),
          ...(st.fontWeight ? { fontWeight: st.fontWeight } : {}),
          ...(anchor === 'middle'
            ? { textAlign: 'center' as const }
            : anchor === 'end'
              ? { textAlign: 'right' as const }
              : {}),
          ...(color !== undefined && !color.includes('gradient') ? { color } : {}),
          ...common(),
        };
      }
      case 'g':
      case 'a':
      case 'svg': {
        const kids: NodeSpec[] = [];
        for (const child of el.children) {
          const spec = convert(child, st, el.name === 'svg' ? { ...IDENTITY } : m, depth + 1);
          if (spec) kids.push(spec);
        }
        if (kids.length === 0) return null;
        if (el.name === 'svg')
          return { type: 'frame', name: 'SVG', layout: 'none', children: kids };
        budget.take();
        note('converted', `group ${label}`);
        // The frame sits at the top-left of what it holds; the children are moved to be relative to it.
        const minX = Math.min(...kids.map((k) => k.x ?? 0));
        const minY = Math.min(...kids.map((k) => k.y ?? 0));
        const maxX = Math.max(...kids.map((k) => (k.x ?? 0) + (typeof k.w === 'number' ? k.w : 0)));
        const maxY = Math.max(...kids.map((k) => (k.y ?? 0) + (typeof k.h === 'number' ? k.h : 0)));
        return {
          type: 'frame',
          name: label === 'g' || label === 'a' ? 'Group' : label,
          layout: 'none',
          x: round(minX),
          y: round(minY),
          w: Math.max(1, round(maxX - minX)),
          h: Math.max(1, round(maxY - minY)),
          children: kids.map((k) => ({
            ...k,
            x: round((k.x ?? 0) - minX),
            y: round((k.y ?? 0) - minY),
          })),
          ...common(),
        };
      }
      default:
        note('skipped', `${el.name} ${label}`, 'an element Atelier does not draw');
        return null;
    }
  };

  const title = root.children.find((c) => c.name === 'title')?.text.trim();
  const children: NodeSpec[] = [];
  const rootStyle = inherit({}, root);
  for (const child of root.children) {
    const spec = convert(child, rootStyle, { ...IDENTITY }, 1);
    if (spec) children.push(spec);
  }
  const name = (title || fileName.replace(/\.svg$/i, '') || 'SVG').slice(0, 60);
  const spec: NodeSpec | null =
    children.length === 0
      ? null
      : {
          type: 'frame',
          name,
          layout: 'none',
          w: round(width),
          h: round(height),
          clip: true,
          children,
        };
  if (spec === null) note('skipped', 'the whole file', 'it has nothing Atelier can draw');
  return { name, spec, assets, report, colors: tally.repeated() };
}

/** Presentation attributes for a path kept as a drawing, so inherited paint is not lost. */
function fillStrokeAttrs(st: Style): Record<string, string> {
  const out: Record<string, string> = {};
  if (st.fill !== undefined) out.fill = st.fill;
  if (st.stroke !== undefined) out.stroke = st.stroke;
  if (st.strokeWidth !== undefined) out['stroke-width'] = String(st.strokeWidth);
  return out;
}
