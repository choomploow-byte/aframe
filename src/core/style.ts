import { fontInfo, supportsWeight } from './fonts';
import { isPatternFill } from './fill';
import { effectShadows, n, NOISE_URL_RE, patternCss, px } from './paint';
import { resolveColor, resolveFont, resolveRadius, type TokenIssue } from './tokens';
import type { Node, Tokens } from './types';

/**
 * Node -> CSS. The single source of truth for what a node looks like: the canvas renderer, the
 * screenshot path and every code exporter use it (docs/03 §3, CLAUDE.md rule 3). Keys are
 * camelCase React-style property names and every value is a string with its unit, so the record
 * can be passed straight to a React `style` prop or turned into text with `cssToString`.
 */
export type CssRecord = Record<string, string>;

/**
 * Part of the layout contract (docs/04 Phase 1 decision 5): the renderer and every exporter must
 * apply this reset, otherwise `fill`/`hug`/stroke maths no longer match.
 */
export const GLOBAL_RESET_CSS =
  '*,*::before,*::after{box-sizing:border-box}*{margin:0}' +
  'button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}' +
  'a{color:inherit;text-decoration:none}';

const SERIF = new Set(['Fraunces', 'Playfair Display', 'Georgia', 'Times New Roman']);
const MONO = new Set(['JetBrains Mono', 'Menlo', 'Consolas', 'Courier New']);

/** A quoted family plus a generic fallback chain, so text stays readable before a font loads. */
export function fontStack(family: string): string {
  const name = family.replace(/["\\]/g, '');
  if (SERIF.has(name)) return `"${name}", Georgia, serif`;
  if (MONO.has(name)) return `"${name}", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  return `"${name}", system-ui, -apple-system, "Segoe UI", sans-serif`;
}

const ALIGN_ITEMS = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
} as const;

const JUSTIFY = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  between: 'space-between',
} as const;

function isFlexFrame(node: Node | undefined): node is Node & { layout: 'row' | 'column' } {
  return node?.type === 'frame' && (node.layout === 'row' || node.layout === 'column');
}

function placeAndSize(node: Node, parent: Node | undefined, out: CssRecord): void {
  const flexParent = isFlexFrame(parent) ? parent : undefined;

  if (node.type === 'page') {
    out.position = 'relative';
    return;
  }
  if (parent !== undefined && !flexParent) {
    // Page or a layout:'none' frame: children sit at x,y (docs/04 layout semantics).
    out.position = 'absolute';
    out.left = px(node.x);
    out.top = px(node.y);
  } else if (node.type === 'frame' && !isFlexFrame(node)) {
    // In-flow frame without auto-layout: be the containing block for its absolute children.
    out.position = 'relative';
  }

  const mainProp = flexParent?.layout === 'row' ? 'w' : 'h';
  for (const axis of ['w', 'h'] as const) {
    const value = node[axis];
    const prop = axis === 'w' ? 'width' : 'height';
    const isMain = flexParent !== undefined && axis === mainProp;
    if (typeof value === 'number') {
      out[prop] = px(value);
      if (isMain) out.flex = '0 0 auto';
    } else if (value === 'fill') {
      if (!flexParent) out[prop] = '100%';
      else if (isMain) {
        out.flex = '1 1 0';
        // Lets wide content (long words, nested fills) shrink so the row can share space. Only for
        // width: the same reset on height collapsed a `fill` frame inside a `hug` column to 0
        // (verified in scripts/css-probe.ts), so heights keep `min-height: auto`.
        if (axis === 'w') out.minWidth = '0';
      } else out.alignSelf = 'stretch';
    } else if (isMain) {
      out.flex = '0 0 auto'; // hug
    }
  }
}

function frameLayout(node: Node, out: CssRecord): void {
  if (node.type !== 'frame') return;
  if (isFlexFrame(node)) {
    out.display = 'flex';
    out.flexDirection = node.layout;
    if (node.gap) out.gap = px(node.gap);
    const [t, r, b, l] = node.padding ?? [0, 0, 0, 0];
    if (t || r || b || l) out.padding = `${px(t)} ${px(r)} ${px(b)} ${px(l)}`;
    out.alignItems = ALIGN_ITEMS[node.align ?? 'start'];
    if (node.justify && node.justify !== 'start') out.justifyContent = JUSTIFY[node.justify];
    if (node.wrap) out.flexWrap = 'wrap';
  }
  if (node.clip) out.overflow = 'hidden';
}

function appearance(node: Node, tokens: Tokens, issues: TokenIssue[], out: CssRecord): void {
  const pattern = isPatternFill(node.fill) ? node.fill : undefined;
  // A pattern's own base colour stands in for "the fill colour" where a single colour is needed.
  const fill = resolveColor(
    pattern === undefined ? (node.fill as string | undefined) : pattern.background,
    tokens,
    issues,
  );
  const stroke = resolveColor(node.stroke, tokens, issues);

  if (node.type === 'line') {
    // A line is a bar: w is its length, h its thickness, stroke (or fill) its colour.
    const colour =
      stroke ?? (pattern === undefined ? fill : resolveColor(pattern.color, tokens, issues));
    if (colour) out.backgroundColor = colour;
  } else if (pattern !== undefined) {
    Object.assign(out, patternCss(pattern, tokens, issues));
  } else if (fill) {
    if (/^(?:linear|radial)-gradient\(/.test(fill)) out.backgroundImage = fill;
    else out.backgroundColor = fill;
  }

  if (node.type === 'ellipse') {
    out.borderRadius = '50%';
  } else {
    const radius = resolveRadius(node.radius, tokens, issues);
    if (typeof radius === 'number') {
      if (radius > 0) out.borderRadius = px(radius);
    } else if (radius) {
      out.borderRadius = radius.map(px).join(' ');
    }
  }

  const strokeWidth = node.strokeWidth ?? 1;
  if (node.type !== 'line' && stroke && strokeWidth > 0) {
    // Outline, not border or inset shadow: no layout impact, painted above children, follows
    // border-radius (docs/04 Phase 1 decision 6).
    out.outline = `${px(strokeWidth)} solid ${stroke}`;
    const align = node.strokeAlign ?? 'inside';
    if (align === 'inside') out.outlineOffset = px(-strokeWidth);
    else if (align === 'center') out.outlineOffset = px(-strokeWidth / 2);
  }

  if (node.type === 'text') {
    // A box-shadow on a text node would draw a visible box around the text, so a text node's
    // shadows follow the glyphs instead (text-shadow has no spread or inset), and effect presets,
    // which are box recipes, are not drawn (lint and apply_changes say so).
    const parts: string[] = [];
    for (const s of node.shadow ?? []) {
      const colour = s.inset ? undefined : resolveColor(s.color, tokens, issues);
      if (colour) parts.push(`${px(s.x)} ${px(s.y)} ${px(s.blur)} ${colour}`);
    }
    if (parts.length > 0) out.textShadow = parts.join(', ');
  } else {
    const parts: string[] = [];
    for (const s of node.shadow ?? []) {
      const colour = resolveColor(s.color, tokens, issues);
      if (!colour) continue;
      parts.push(
        `${s.inset ? 'inset ' : ''}${px(s.x)} ${px(s.y)} ${px(s.blur)} ${px(s.spread)} ${colour}`,
      );
    }
    parts.push(...effectShadows(node.effects, fill, tokens, issues));
    if (parts.length > 0) out.boxShadow = parts.join(', ');
  }
  const filters: string[] = [];
  if (node.blur) filters.push(`blur(${px(node.blur)})`);
  if (node.hue) filters.push(`hue-rotate(${n(node.hue)}deg)`);
  if (node.saturation !== undefined && node.saturation !== 1) {
    filters.push(`saturate(${n(node.saturation)})`);
  }
  if (node.brightness !== undefined && node.brightness !== 1) {
    filters.push(`brightness(${n(node.brightness)})`);
  }
  if (node.contrast !== undefined && node.contrast !== 1) {
    filters.push(`contrast(${n(node.contrast)})`);
  }
  if (filters.length > 0) out.filter = filters.join(' ');
  if (node.backdropBlur) {
    out.backdropFilter = `blur(${px(node.backdropBlur)})`;
    out.WebkitBackdropFilter = out.backdropFilter; // WebKit (macOS/Linux webviews) still needs the prefix
  }
  if (node.opacity !== 1) out.opacity = n(node.opacity);
  if (node.blendMode && node.blendMode !== 'normal') out.mixBlendMode = node.blendMode;
  const transforms: string[] = [];
  if (node.rotation) transforms.push(`rotate(${n(node.rotation)}deg)`);
  if (node.flipX || node.flipY)
    transforms.push(`scale(${node.flipX ? -1 : 1}, ${node.flipY ? -1 : 1})`);
  if (transforms.length > 0) out.transform = transforms.join(' ');

  if (node.type === 'image') {
    out.display = 'block';
    if (node.fit === 'tile') {
      // The renderers draw a tiled image as a plain box with the picture as its background (they
      // add `background-image`; a data URL does not belong in this record).
      out.backgroundRepeat = 'repeat';
      out.backgroundPosition = '0 0';
      out.backgroundSize = node.tileSize ? `${px(node.tileSize)} auto` : 'auto';
    } else out.objectFit = node.fit ?? 'cover';
  }
}

function typography(node: Node, tokens: Tokens, issues: TokenIssue[], out: CssRecord): void {
  if (node.type === 'icon') {
    // The icon's ink: the SVG inside draws with currentColor.
    const ink = resolveColor(node.color, tokens, issues);
    if (ink) out.color = ink;
    return;
  }
  if (node.type !== 'text') return;
  const family = resolveFont(node.fontFamily, tokens, issues);
  if (family) out.fontFamily = fontStack(family);
  if (node.fontSize !== undefined) out.fontSize = px(node.fontSize);
  if (node.fontWeight !== undefined) {
    out.fontWeight = n(node.fontWeight);
    // A single-weight display face asked for a weight it lacks would be smeared into a fake bold.
    if (fontInfo(family) && !supportsWeight(family, node.fontWeight)) out.fontSynthesis = 'none';
  }
  if (node.lineHeight !== undefined) out.lineHeight = n(node.lineHeight);
  if (node.letterSpacing) out.letterSpacing = `${n(node.letterSpacing)}em`;
  if (node.textAlign) out.textAlign = node.textAlign;
  if (node.textTransform && node.textTransform !== 'none') out.textTransform = node.textTransform;
  const colour = resolveColor(node.color, tokens, issues);
  const strokeColour = resolveColor(node.textStroke, tokens, issues);
  const strokeWidth = node.textStrokeWidth ?? (strokeColour ? 2 : 0);
  if (colour && /^(?:linear|radial)-gradient\(/.test(colour)) {
    // Gradient lettering: the gradient is the element's background, clipped to the glyphs. A
    // text-shadow would be painted over that background, so shadows become a drop-shadow filter.
    out.backgroundImage = colour;
    out.backgroundClip = 'text';
    out.WebkitBackgroundClip = 'text';
    out.color = 'transparent';
    out.WebkitTextFillColor = 'transparent';
    if (out.textShadow) {
      const drops = (node.shadow ?? []).flatMap((s) => {
        const c = s.inset ? undefined : resolveColor(s.color, tokens, issues);
        return c ? [`drop-shadow(${px(s.x)} ${px(s.y)} ${px(s.blur)} ${c})`] : [];
      });
      delete out.textShadow;
      out.filter = [out.filter, ...drops].filter(Boolean).join(' ');
    }
    // The outline is centred on the glyph edge here (painted over the gradient), so it is
    // `textStrokeWidth` thick overall rather than that far outside.
    if (strokeColour && strokeWidth > 0)
      out.WebkitTextStroke = `${px(strokeWidth)} ${strokeColour}`;
  } else {
    if (colour) out.color = colour;
    if (strokeColour && strokeWidth > 0) {
      // Painted behind the fill, so half of the stroke is hidden under the letters: doubling the
      // width makes `textStrokeWidth` the visible outline thickness.
      out.WebkitTextStroke = `${px(strokeWidth * 2)} ${strokeColour}`;
      out.paintOrder = 'stroke fill';
      out.strokeLinejoin = 'round';
    }
  }
  // hug width = a single line; any other width wraps (docs/04 layout semantics).
  if (node.w === 'hug') {
    out.whiteSpace = 'pre';
  } else {
    out.whiteSpace = 'pre-wrap';
    out.overflowWrap = 'break-word';
  }
}

/**
 * CSS for one node given its parent (undefined for the page, or for a subtree rendered on its
 * own). Unresolvable tokens are left out of the result and appended to `issues` when given.
 */
/** A text layer with its shared text style (if it names one that exists) laid over its own typography. */
export function withTextStyle(node: Node, tokens: Tokens): Node {
  if (node.type !== 'text' || node.textStyle === undefined) return node;
  const style = tokens.textStyles?.[node.textStyle];
  if (!style) return node;
  return { ...node, ...style };
}

export function nodeToCss(
  rawNode: Node,
  parent: Node | undefined,
  tokens: Tokens,
  issues: TokenIssue[] = [],
): CssRecord {
  const node = withTextStyle(rawNode, tokens);
  const out: CssRecord = {};
  placeAndSize(node, parent, out);
  frameLayout(node, out);
  appearance(node, tokens, issues, out);
  typography(node, tokens, issues, out);
  if (!node.visible) out.display = 'none';
  return out;
}

const UNSAFE_VALUE_RE = /[;{}<>\\]|url\s*\(|expression\s*\(|@import/i;

/** `url(assets/name.png)`: a relative link to an exported picture, the one other `url()` an export may carry. */
export const ASSET_URL_RE = /url\((["']?)assets\/[A-Za-z0-9._-]+\1\)/g;

export function cssPropertyName(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * `{ marginTop: '4px' }` -> `margin-top: 4px;`. Values that could end a declaration or load a
 * resource are dropped as a last line of defence; `nodeToCss` never produces them.
 */
export function cssToString(css: CssRecord, options: { separator?: string } = {}): string {
  const separator = options.separator ?? ' ';
  return (
    Object.entries(css)
      // The one `url()` allowed is the data-URL image a noise pattern is made of (see NOISE_URL_RE).
      .filter(
        ([, value]) =>
          !UNSAFE_VALUE_RE.test(value.replace(NOISE_URL_RE, 'none').replace(ASSET_URL_RE, 'none')),
      )
      .map(([key, value]) => `${cssPropertyName(key)}: ${value};`)
      .join(separator)
  );
}
