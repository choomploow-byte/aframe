/**
 * Roblox export: a frame becomes a Luau script that builds the matching ScreenGui (Frame,
 * TextLabel, ImageLabel, UICorner, UIStroke, UIGradient, UIListLayout, UIPadding) in StarterGui,
 * plus the pictures the design uses as PNG/JPEG files to upload.
 *
 * Everything is placed in pixels at the design resolution, and the root frame carries a UIScale that
 * a small LocalScript keeps fitted to the player's screen, so the layout is exactly what you drew and
 * still scales from phone to monitor. What Roblox cannot draw natively (bevels, gloss, patterns,
 * box shadows) is listed as a warning: bake it into an image with `export_image`.
 *
 * Pure and deterministic. The script has not been run inside Roblox Studio by the AFrame tests,
 * which check its structure and values only; see the README it ships with.
 */
import { base64ToBytes } from '../assets';
import { parseRgb } from '../lint';
import { resolveColor, resolveFont, resolveRadius } from '../tokens';
import { withTextStyle } from '../style';
import type { Doc, Node } from '../types';
import type { ExportFile } from './ir';
import { kebab } from './names';

export interface RobloxResult {
  files: ExportFile[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Small formatters
// ---------------------------------------------------------------------------

const num = (v: number): string => String(Math.round(v * 1000) / 1000);

/** A Luau string literal. */
export function luaString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;
}

/** A Luau identifier-safe instance name (Roblox allows anything, but keep it tidy). */
const instanceName = (name: string): string =>
  name
    .replace(/[^\w .-]/g, '')
    .trim()
    .slice(0, 50) || 'Layer';

function color3(rgb: readonly [number, number, number]): string {
  return `Color3.fromRGB(${rgb.map((c) => Math.round(c)).join(', ')})`;
}

const udim2Offset = (w: number, h: number): string => `UDim2.fromOffset(${num(w)}, ${num(h)})`;

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const FONT_MAP: Record<string, string> = {
  'Lilita One': 'FredokaOne',
  'Luckiest Guy': 'LuckiestGuy',
  Bungee: 'GothamBlack',
  Fredoka: 'Nunito',
  Inter: 'GothamMedium',
  'DM Sans': 'GothamMedium',
  'Space Grotesk': 'GothamMedium',
  Fraunces: 'Merriweather',
  'Playfair Display': 'Merriweather',
  'JetBrains Mono': 'RobotoMono',
};

function robloxFont(family: string | undefined, weight: number | undefined): string {
  const mapped = family === undefined ? undefined : FONT_MAP[family];
  const bold = (weight ?? 400) >= 600;
  if (mapped === 'GothamMedium' && bold) return 'Enum.Font.GothamBold';
  if (mapped === 'Nunito' && bold) return 'Enum.Font.Nunito';
  return `Enum.Font.${mapped ?? 'GothamMedium'}`;
}

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

interface Stop {
  at: number;
  rgb: [number, number, number];
  alpha: number;
}

interface Gradient {
  rotation: number;
  stops: Stop[];
}

/** Splits on top-level commas (not inside rgb(...)). */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/** A CSS `linear-gradient(...)` as Roblox wants it, or null when it is not one this can read. */
export function parseLinearGradient(css: string): Gradient | null {
  const m = /^linear-gradient\((.*)\)$/is.exec(css.trim());
  if (!m) return null;
  const parts = splitTop(m[1] as string);
  let angle = 180;
  const first = parts[0] ?? '';
  const a = /^(-?\d+(?:\.\d+)?)deg$/i.exec(first);
  if (a) {
    angle = Number(a[1]);
    parts.shift();
  } else if (/^to\s/i.test(first)) {
    const dir = first.toLowerCase();
    angle = dir.includes('right') ? 90 : dir.includes('left') ? 270 : dir.includes('top') ? 0 : 180;
    parts.shift();
  }
  const raw: { rgb: [number, number, number]; alpha: number; at?: number }[] = [];
  for (const part of parts) {
    const stop = /^(.*?)(?:\s+(-?\d+(?:\.\d+)?)%)?$/s.exec(part);
    const c = parseRgb(stop?.[1]?.trim() ?? '');
    if (!c) return null;
    raw.push({
      rgb: c.rgb,
      alpha: c.alpha,
      ...(stop?.[2] === undefined ? {} : { at: Number(stop[2]) / 100 }),
    });
  }
  if (raw.length < 2) return null;
  const stops = raw.map((s, i) => ({
    at: Math.max(0, Math.min(1, s.at ?? i / (raw.length - 1))),
    rgb: s.rgb,
    alpha: s.alpha,
  }));
  // Roblox needs the first stop at 0 and the last at 1.
  const head = stops[0] as Stop;
  const tail = stops[stops.length - 1] as Stop;
  if (head.at > 0) stops.unshift({ ...head, at: 0 });
  if (tail.at < 1) stops.push({ ...tail, at: 1 });
  return { rotation: angle - 90, stops };
}

function gradientInstance(g: Gradient, parentVar: string): string {
  const colors = g.stops
    .map((s) => `ColorSequenceKeypoint.new(${num(s.at)}, ${color3(s.rgb)})`)
    .join(', ');
  const hasAlpha = g.stops.some((s) => s.alpha < 1);
  const alphas = g.stops
    .map((s) => `NumberSequenceKeypoint.new(${num(s.at)}, ${num(1 - s.alpha)})`)
    .join(', ');
  return `new("UIGradient", { Color = ColorSequence.new({ ${colors} }), Rotation = ${num(g.rotation)}${
    hasAlpha ? `, Transparency = NumberSequence.new({ ${alphas} })` : ''
  } }, ${parentVar})`;
}

// ---------------------------------------------------------------------------
// The exporter
// ---------------------------------------------------------------------------

const ALIGN_X = { left: 'Left', center: 'Center', right: 'Right', justify: 'Left' } as const;
const JUSTIFY_H = { start: 'Left', center: 'Center', end: 'Right', between: 'Left' } as const;
const JUSTIFY_V = { start: 'Top', center: 'Center', end: 'Bottom', between: 'Top' } as const;
const SCALE_TYPE = { cover: 'Crop', contain: 'Fit', fill: 'Stretch', tile: 'Tile' } as const;

interface Ctx {
  doc: Doc;
  lines: string[];
  warnings: Set<string>;
  assets: ExportFile[];
  /** Image key -> file path, in the order first used. */
  assetKeys: Map<string, string>;
  usedFiles: Set<string>;
  assetByDocId: Map<string, string>;
}

const isFlow = (n: Node | undefined): n is Node & { layout: 'row' | 'column' } =>
  n?.type === 'frame' && (n.layout === 'row' || n.layout === 'column');

function warn(ctx: Ctx, text: string): void {
  ctx.warnings.add(text);
}

function assetFile(ctx: Ctx, node: Node): string | null {
  if (node.assetId === undefined) return null;
  const known = ctx.assetByDocId.get(node.assetId);
  if (known) return known;
  const url = ctx.doc.assets[node.assetId];
  const m =
    url === undefined
      ? null
      : /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,([\s\S]*)$/.exec(url);
  const bytes = m?.[2] === undefined ? null : base64ToBytes(m[2]);
  if (!m || !bytes) {
    warn(ctx, `Image "${node.name}" has no readable picture, so it is left empty.`);
    return null;
  }
  const kind = m[1] as string;
  if (kind === 'svg+xml' || kind === 'webp') {
    warn(
      ctx,
      `Image "${node.name}" is ${kind === 'webp' ? 'WebP' : 'SVG'}, which Roblox does not accept. Export it as a PNG (export_image) and upload that.`,
    );
  }
  const ext = kind === 'jpeg' ? 'jpg' : kind === 'svg+xml' ? 'svg' : kind;
  let file = `assets/${kebab(node.name, 'image')}.${ext}`;
  for (let i = 2; ctx.usedFiles.has(file); i += 1)
    file = `assets/${kebab(node.name, 'image')}-${i}.${ext}`;
  ctx.usedFiles.add(file);
  ctx.assetByDocId.set(node.assetId, file);
  ctx.assets.push({ path: file, content: bytes });
  ctx.assetKeys.set(file, file);
  return file;
}

/** Content area a child is placed in: the parent's box minus its padding. */
function contentBox(parent: Node): { w: number; h: number } | null {
  if (typeof parent.w !== 'number' || typeof parent.h !== 'number') return null;
  const [t, r, b, l] = parent.padding ?? [0, 0, 0, 0];
  return { w: parent.w - l - r, h: parent.h - t - b };
}

/** Sizes of a flow frame's children where 'fill' needs working out. */
function flowSizes(ctx: Ctx, parent: Node): Map<string, { w?: number; h?: number }> {
  const out = new Map<string, { w?: number; h?: number }>();
  const box = contentBox(parent);
  if (!box) return out;
  const row = parent.layout === 'row';
  const kids = parent.children
    .map((id) => ctx.doc.nodes[id])
    .filter((n): n is Node => !!n && n.visible);
  const main = (n: Node): Node['w'] => (row ? n.w : n.h);
  const fixedMain = kids.reduce(
    (sum, n) => (typeof main(n) === 'number' ? sum + (main(n) as number) : sum),
    0,
  );
  const hugMain = kids.some((n) => main(n) === 'hug');
  const fills = kids.filter((n) => main(n) === 'fill');
  const gaps = Math.max(0, kids.length - 1) * (parent.gap ?? 0);
  const free = (row ? box.w : box.h) - fixedMain - gaps;
  if (fills.length > 0 && hugMain) {
    warn(
      ctx,
      `"${parent.name}" mixes hug and fill sizes along its direction; the fill layers share what is left after the fixed ones.`,
    );
  }
  for (const n of kids) {
    const entry: { w?: number; h?: number } = {};
    const cross = row ? n.h : n.w;
    const crossBox = row ? box.h : box.w;
    if (main(n) === 'fill') {
      const share = Math.max(0, free / fills.length);
      if (row) entry.w = share;
      else entry.h = share;
    }
    if (cross === 'fill' || (parent.align === 'stretch' && cross === 'hug')) {
      if (row) entry.h = crossBox;
      else entry.w = crossBox;
    }
    out.set(n.id, entry);
  }
  return out;
}

function emitNode(
  ctx: Ctx,
  raw: Node,
  parent: Node,
  parentVar: string,
  depth: number,
  order: number,
  sized: { w?: number; h?: number },
  isRoot = false,
): void {
  if (!raw.visible) return;
  const node = withTextStyle(raw, ctx.doc.tokens);
  const flow = isFlow(parent);
  const v = `p${depth}`;
  const pad = '  '.repeat(depth);
  const out = (line: string): void => void ctx.lines.push(`${pad}${line}`);
  const props: string[] = [`Name = ${luaString(instanceName(node.name))}`];

  const opacity = node.opacity;
  const resolvedFill =
    node.fill !== undefined && typeof node.fill === 'string'
      ? resolveColor(node.fill, ctx.doc.tokens)
      : undefined;
  if (typeof node.fill === 'object') {
    warn(
      ctx,
      `"${node.name}" has a ${node.fill.pattern} pattern fill, which Roblox cannot draw; only its base colour is exported. Bake patterns into an image.`,
    );
  }
  const base =
    typeof node.fill === 'object'
      ? resolveColor(node.fill.background, ctx.doc.tokens)
      : resolvedFill;
  const gradient = base ? parseLinearGradient(base) : null;
  const solid = base && !gradient ? parseRgb(base) : null;

  // Size and position.
  const w = typeof node.w === 'number' ? node.w : sized.w;
  const h = typeof node.h === 'number' ? node.h : sized.h;
  const hugX = node.w === 'hug' && sized.w === undefined;
  const hugY = node.h === 'hug' && sized.h === undefined;
  const size = node.type === 'text' ? null : udim2Offset(w ?? 0, h ?? 0);
  if (size) props.push(`Size = ${size}`);
  if (isRoot) {
    props.push('Position = UDim2.fromScale(0.5, 0.5)', 'AnchorPoint = Vector2.new(0.5, 0.5)');
  } else if (!flow) props.push(`Position = ${udim2Offset(node.x, node.y)}`);
  props.push(`LayoutOrder = ${order}`);
  if (node.rotation) props.push(`Rotation = ${num(node.rotation)}`);
  if (node.flipX || node.flipY)
    warn(
      ctx,
      `"${node.name}" is flipped, which Roblox UI cannot do; flip the picture before uploading it.`,
    );
  if (node.blur || node.backdropBlur)
    warn(ctx, `"${node.name}" uses blur, which Roblox UI does not have.`);
  if (
    node.hue ||
    node.saturation !== undefined ||
    node.brightness !== undefined ||
    node.contrast !== undefined
  ) {
    if (node.type !== 'image')
      warn(
        ctx,
        `"${node.name}" has colour adjustments, which are only exported for images (as a tint).`,
      );
  }
  if (node.blendMode && node.blendMode !== 'normal')
    warn(
      ctx,
      `"${node.name}" has the blend mode ${node.blendMode}, which Roblox UI does not have.`,
    );
  if ((node.effects?.length ?? 0) > 0 || (node.shadow?.length ?? 0) > 0) {
    if (node.type !== 'text') {
      warn(
        ctx,
        `"${node.name}" has shadows or effect presets (bevel, gloss, 3D ledge), which Roblox UI cannot draw. Bake it into an image with export_image.`,
      );
    } else if ((node.shadow?.length ?? 0) > 0) {
      warn(
        ctx,
        `"${node.name}" has a text shadow, which Roblox has no property for; duplicate the label behind it, offset and dark.`,
      );
    }
  }

  if (node.type === 'text') {
    const family = resolveFont(node.fontFamily, ctx.doc.tokens);
    const ink = resolveColor(node.color, ctx.doc.tokens);
    const inkGradient = ink ? parseLinearGradient(ink) : null;
    const inkRgb = ink && !inkGradient ? parseRgb(ink) : null;
    const text =
      node.textTransform === 'uppercase' ? (node.text ?? '').toUpperCase() : (node.text ?? '');
    props.push(`Text = ${luaString(text)}`);
    props.push(`Font = ${robloxFont(family, node.fontWeight)}`);
    props.push(`TextSize = ${num(node.fontSize ?? 16)}`);
    props.push(
      `TextColor3 = ${inkGradient ? 'Color3.new(1, 1, 1)' : inkRgb ? color3(inkRgb.rgb) : 'Color3.new(1, 1, 1)'}`,
    );
    if (inkRgb && inkRgb.alpha < 1)
      props.push(`TextTransparency = ${num(1 - inkRgb.alpha * opacity)}`);
    else if (opacity < 1) props.push(`TextTransparency = ${num(1 - opacity)}`);
    props.push(`TextXAlignment = Enum.TextXAlignment.${ALIGN_X[node.textAlign ?? 'left']}`);
    props.push(`TextYAlignment = Enum.TextYAlignment.Center`);
    props.push(`BackgroundTransparency = 1`);
    props.push(`LineHeight = ${num(node.lineHeight ?? 1)}`);
    const wraps = node.w !== 'hug';
    props.push(`TextWrapped = ${wraps ? 'true' : 'false'}`);
    if (node.w === 'hug' || node.h === 'hug' || w === undefined || h === undefined) {
      const axis = node.w === 'hug' && node.h === 'hug' ? 'XY' : node.w === 'hug' ? 'X' : 'Y';
      props.push(
        `AutomaticSize = Enum.AutomaticSize.${node.w === 'hug' || node.h === 'hug' ? axis : 'Y'}`,
      );
      props.push(`Size = ${udim2Offset(w ?? 0, h ?? 0)}`);
    } else {
      props.push(`Size = ${udim2Offset(w, h)}`);
    }
    out('do');
    out(`  local ${v} = new("TextLabel", { ${props.join(', ')} }, ${parentVar})`);
    emitCommon(ctx, node, v, out, { gradient: inkGradient, text: true });
    out('end');
    return;
  }

  if (node.type === 'image' || node.type === 'icon') {
    props.push('BackgroundTransparency = 1');
    if (node.type === 'image') {
      const file = assetFile(ctx, node);
      props.push(`Image = ASSETS[${luaString(file ?? 'missing')}] or ""`);
      props.push(`ScaleType = Enum.ScaleType.${SCALE_TYPE[node.fit ?? 'cover']}`);
      if (node.fit === 'tile') {
        const t = node.tileSize ?? 64;
        props.push(`TileSize = ${udim2Offset(t, t)}`);
      }
      if (opacity < 1) props.push(`ImageTransparency = ${num(1 - opacity)}`);
      if (node.hue || node.saturation !== undefined || node.brightness !== undefined) {
        warn(
          ctx,
          `"${node.name}" has hue/saturation/brightness adjustments, which Roblox cannot apply to an image; recolour the picture before uploading it.`,
        );
      }
    } else {
      const key = `icon:${node.icon ?? 'unknown'}`;
      ctx.assetKeys.set(key, key);
      props.push(`Image = ASSETS[${luaString(key)}] or ""`);
      const ink = resolveColor(node.color, ctx.doc.tokens);
      const rgb = ink ? parseRgb(ink) : null;
      if (rgb) props.push(`ImageColor3 = ${color3(rgb.rgb)}`);
      warn(
        ctx,
        `Icon "${node.icon ?? node.name}" is a vector icon: export it as a white PNG (export_image) and paste its id under ASSETS["${key}"].`,
      );
    }
    out('do');
    out(`  local ${v} = new("ImageLabel", { ${props.join(', ')} }, ${parentVar})`);
    emitCommon(ctx, node, v, out, { gradient: null, text: false });
    out('end');
    return;
  }

  // Frames, rectangles, ellipses and lines are all Frames.
  props.push('BorderSizePixel = 0');
  if (gradient) {
    props.push('BackgroundColor3 = Color3.new(1, 1, 1)');
    props.push(`BackgroundTransparency = ${num(1 - opacity)}`);
  } else if (solid) {
    props.push(`BackgroundColor3 = ${color3(solid.rgb)}`);
    props.push(`BackgroundTransparency = ${num(1 - solid.alpha * opacity)}`);
  } else {
    props.push('BackgroundTransparency = 1');
  }
  if (node.clip) props.push('ClipsDescendants = true');
  if (hugX || hugY) {
    props.push(`AutomaticSize = Enum.AutomaticSize.${hugX && hugY ? 'XY' : hugX ? 'X' : 'Y'}`);
  }
  if (opacity < 1 && node.children.length > 0) {
    warn(
      ctx,
      `"${node.name}" has opacity ${opacity} with children; Roblox applies it to the background only, not to what is inside.`,
    );
  }
  out('do');
  out(`  local ${v} = new("Frame", { ${props.join(', ')} }, ${parentVar})`);
  if (isRoot) out(`  new("UIScale", { Name = "FitScale" }, ${v})`);
  emitCommon(ctx, node, v, out, { gradient, text: false });

  if (node.type === 'frame' && node.children.length > 0) {
    const kids = node.children
      .map((id) => ctx.doc.nodes[id])
      .filter((n): n is Node => n !== undefined);
    const flowFrame = isFlow(node);
    const sizes = flowFrame ? flowSizes(ctx, node) : new Map<string, { w?: number; h?: number }>();
    if (flowFrame) {
      const row = node.layout === 'row';
      const main = row ? JUSTIFY_H[node.justify ?? 'start'] : JUSTIFY_V[node.justify ?? 'start'];
      const cross = row
        ? ({ start: 'Top', center: 'Center', end: 'Bottom', stretch: 'Top' } as const)[
            node.align ?? 'start'
          ]
        : ({ start: 'Left', center: 'Center', end: 'Right', stretch: 'Left' } as const)[
            node.align ?? 'start'
          ];
      if (node.justify === 'between') {
        warn(
          ctx,
          `"${node.name}" spaces its children apart (justify: between), which UIListLayout has no setting for; they are packed from the start. Use fixed gaps or fill sizes.`,
        );
      }
      out(
        `  new("UIListLayout", { FillDirection = Enum.FillDirection.${row ? 'Horizontal' : 'Vertical'}, Padding = UDim.new(0, ${num(node.gap ?? 0)}), SortOrder = Enum.SortOrder.LayoutOrder, HorizontalAlignment = Enum.HorizontalAlignment.${row ? main : cross}, VerticalAlignment = Enum.VerticalAlignment.${row ? cross : main}${node.wrap ? ', Wraps = true' : ''} }, ${v})`,
      );
    }
    const [pt, pr, pb, pl] = node.padding ?? [0, 0, 0, 0];
    if (pt || pr || pb || pl) {
      out(
        `  new("UIPadding", { PaddingTop = UDim.new(0, ${num(pt)}), PaddingRight = UDim.new(0, ${num(pr)}), PaddingBottom = UDim.new(0, ${num(pb)}), PaddingLeft = UDim.new(0, ${num(pl)}) }, ${v})`,
      );
    }
    kids.forEach((kid, i) => emitNode(ctx, kid, node, v, depth + 1, i, sizes.get(kid.id) ?? {}));
  }
  out('end');
}

/** UICorner, UIStroke, UIGradient for a node. */
function emitCommon(
  ctx: Ctx,
  node: Node,
  v: string,
  out: (line: string) => void,
  kind: { gradient: Gradient | null; text: boolean },
): void {
  if (kind.gradient) out(`  ${gradientInstance(kind.gradient, v)}`);
  if (!kind.text) {
    if (node.type === 'ellipse') {
      out(`  new("UICorner", { CornerRadius = UDim.new(0.5, 0) }, ${v})`);
    } else {
      const r = resolveRadius(node.radius, ctx.doc.tokens);
      if (Array.isArray(r)) {
        const same = r.every((x) => x === r[0]);
        if (!same)
          warn(
            ctx,
            `"${node.name}" has different corner radii; Roblox rounds all four corners the same, so the largest is used.`,
          );
        const biggest = Math.max(...r);
        if (biggest > 0)
          out(`  new("UICorner", { CornerRadius = UDim.new(0, ${num(biggest)}) }, ${v})`);
      } else if (typeof r === 'number' && r > 0) {
        const w = typeof node.w === 'number' ? node.w : undefined;
        const h = typeof node.h === 'number' ? node.h : undefined;
        const limit = w !== undefined && h !== undefined ? Math.min(w, h) / 2 : r;
        out(`  new("UICorner", { CornerRadius = UDim.new(0, ${num(Math.min(r, limit))}) }, ${v})`);
      }
    }
    const stroke = resolveColor(node.stroke, ctx.doc.tokens);
    const rgb = stroke ? parseRgb(stroke) : null;
    const width = node.strokeWidth ?? 1;
    if (rgb && width > 0 && node.type !== 'line') {
      out(
        `  new("UIStroke", { Color = ${color3(rgb.rgb)}, Thickness = ${num(width)}, ApplyStrokeMode = Enum.ApplyStrokeMode.Border${rgb.alpha < 1 ? `, Transparency = ${num(1 - rgb.alpha)}` : ''} }, ${v})`,
      );
      if (node.strokeAlign === 'inside' || node.strokeAlign === undefined) {
        warn(
          ctx,
          'Strokes: AFrame draws them inside the edge by default; Roblox centres a UIStroke on the edge, so outlined shapes look slightly bigger. Compare one before you rebuild a whole screen.',
        );
      }
    }
  } else {
    const stroke = resolveColor(node.textStroke, ctx.doc.tokens);
    const rgb = stroke ? parseRgb(stroke) : null;
    const width = node.textStrokeWidth ?? (rgb ? 2 : 0);
    if (rgb && width > 0) {
      out(
        `  new("UIStroke", { Color = ${color3(rgb.rgb)}, Thickness = ${num(width * 2)}, ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual, LineJoinMode = Enum.LineJoinMode.Round }, ${v})`,
      );
    }
  }
}

const HEADER = (
  name: string,
  w: number,
  h: number,
): string => `-- ${name}: a Roblox ScreenGui built from an AFrame design (${w} x ${h}).
--
-- How to use it
--   1. Upload the pictures in the assets/ folder to Roblox (Asset Manager, Images) and paste each
--      id into the ASSETS table below. Icons need to be exported as white PNGs first.
--   2. Paste this whole script into Studio's Command Bar (View > Command Bar) and press Enter,
--      or run it from a plugin. It creates "${name}" in StarterGui.
--   3. The root frame has a UIScale that the LocalScript "FitToScreen" keeps matching the screen,
--      so the design scales from phone to monitor. Keep important buttons inside the safe area.
`;

/** Turns a frame into the Luau script and the pictures it needs. */
export function toRoblox(doc: Doc, nodeId: string, guiName: string): RobloxResult {
  const root = doc.nodes[nodeId] as Node;
  const ctx: Ctx = {
    doc,
    lines: [],
    warnings: new Set(),
    assets: [],
    assetKeys: new Map(),
    usedFiles: new Set(),
    assetByDocId: new Map(),
  };
  const rootW = typeof root.w === 'number' ? root.w : 1920;
  const rootH = typeof root.h === 'number' ? root.h : 1080;
  if (typeof root.w !== 'number' || typeof root.h !== 'number') {
    warn(
      ctx,
      'The exported frame has a hug or fill size, so 1920 x 1080 is assumed for the design resolution; give it a fixed size.',
    );
  }
  // The root frame is placed by the script (centred, scaled); its own x/y are not used.
  const parent: Node = {
    ...root,
    type: 'frame',
    layout: 'none',
    children: [root.id],
    padding: [0, 0, 0, 0],
    x: 0,
    y: 0,
  };
  const fakeRoot: Node = { ...root, x: 0, y: 0, name: 'Root', w: rootW, h: rootH };
  const docWithRoot: Doc = { ...doc, nodes: { ...doc.nodes, [root.id]: fakeRoot } };
  ctx.doc = docWithRoot;

  emitNode(ctx, fakeRoot, parent, 'gui', 1, 0, {}, true);
  const patched = ctx.lines.join('\n');

  const assetLines = [...ctx.assetKeys.keys()].map(
    (k) =>
      `  [${luaString(k)}] = "", -- ${k.startsWith('icon:') ? 'export as a white PNG' : 'upload this file'}`,
  );
  const fit = `local fit = new("LocalScript", { Name = "FitToScreen" }, gui)
pcall(function()
  fit.Source = [[
local root = script.Parent:WaitForChild("Root")
local scale = root:WaitForChild("FitScale")
local camera = workspace.CurrentCamera
local function refit()
  local view = camera.ViewportSize
  scale.Scale = math.min(view.X / ${rootW}, view.Y / ${rootH})
end
refit()
camera:GetPropertyChangedSignal("ViewportSize"):Connect(refit)
]]
end)`;
  const script = `${HEADER(guiName, rootW, rootH)}
local ASSETS = {
${assetLines.join('\n') || '  -- this design has no pictures'}
}

local function new(className, props, parent)
  local instance = Instance.new(className)
  for key, value in pairs(props) do
    instance[key] = value
  end
  instance.Parent = parent
  return instance
end

local gui = Instance.new("ScreenGui")
gui.Name = ${luaString(instanceName(guiName))}
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

${patched}

${fit}

gui.Parent = game:GetService("StarterGui")
print("${instanceName(guiName)} created in StarterGui")
`;
  const readme = `# ${guiName} for Roblox

Generated by AFrame from a ${rootW} x ${rootH} frame.

## Steps
1. Upload the files in \`assets/\` (Asset Manager > Images). Copy each asset id into the \`ASSETS\` table at the top of \`${guiName}.lua\` as \`rbxassetid://123456\`.
2. Vector icons are not exported as files: use AFrame's \`export_image\` (PNG, scale 2, transparent) on an icon, upload it, and paste the id under its \`icon:<name>\` key.
3. In Studio open View > Command Bar, paste the whole script and press Enter. It creates \`${instanceName(guiName)}\` in StarterGui with a LocalScript that fits the UI to the screen.

## What to check
- This script has been checked for structure, not run inside Roblox Studio by the AFrame tests. Run it once on a blank place before relying on it.
- Fonts are matched to the nearest built-in Roblox font.
- Test on a phone-shaped viewport (Studio's Device emulator) and keep buttons inside the safe area.
${[...ctx.warnings].length > 0 ? `\n## Things Roblox cannot draw exactly\n${[...ctx.warnings].map((w) => `- ${w}`).join('\n')}\n` : ''}`;
  return {
    files: [
      { path: `${guiName}.lua`, content: script },
      { path: 'README-roblox.md', content: readme },
      ...ctx.assets,
    ],
    warnings: [...ctx.warnings],
  };
}
