/**
 * The shared half of every exporter (docs/10): walks a subtree once and produces an intermediate
 * tree (tag, attributes, class name, declarations, text, children) plus the token variables and
 * the assets. Each format only formats it. Styles come from `nodeToCss`, the same function the
 * canvas uses, so what is exported is what is drawn.
 */
import { base64ToBytes } from '../assets';
import { fontInfo } from '../fonts';
import { isPatternFill } from '../fill';
import { iconShape } from '../icons';
import { fontStack, nodeToCss, type CssRecord } from '../style';
import { resolveColor, resolveFont, resolveRadius } from '../tokens';
import type { Doc, Node, Tokens } from '../types';
import { kebab, uniqueNames } from './names';

export interface ExportFile {
  /** Relative path inside the output folder, forward slashes. */
  path: string;
  content: string | Uint8Array;
}

export interface IrNode {
  id: string;
  /** What it is in the design, for comments and class names. */
  name: string;
  tag: string;
  className: string;
  attrs: Record<string, string>;
  /** Declarations for this element, tokens already turned into variables where they can be. */
  css: CssRecord;
  /** Text content (text nodes). */
  text?: string;
  /** A drawn icon (an `svg` element). */
  svg?: { viewBox: string; d: string; evenodd: boolean };
  /** An image file written to the output (an `img` element). */
  asset?: { file: string };
  /** A short note printed above the element (absolute positioning, placeholders). */
  comment?: string;
  /** Void elements (`img`, `input`) have no children. */
  void: boolean;
  children: IrNode[];
}

export interface IrResult {
  root: IrNode;
  /** `:root { --color-...: ...; }` and the shared reset, ready for a stylesheet. */
  tokensCss: string;
  /** Font families the design uses, for the README. */
  fonts: string[];
  assets: ExportFile[];
  warnings: string[];
  /** Variable names by token, for the Tailwind theme. */
  vars: {
    colors: Record<string, string>;
    fonts: Record<string, string>;
    radii: Record<string, string>;
  };
}

export interface IrOptions {
  /** Reference tokens as CSS variables (default) or inline their values. */
  tokens?: 'variables' | 'values';
}

const INTERACTIVE = new Set(['button', 'a']);
const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/** Colour tokens answer with `var(--color-name)`, so every colour in every declaration references them. */
function variableTokens(tokens: Tokens): Tokens {
  return {
    ...tokens,
    colors: Object.fromEntries(Object.keys(tokens.colors).map((k) => [k, `var(--color-${k})`])),
  };
}

function textOf(doc: Doc, node: Node): string {
  if (node.type === 'text') return node.text ?? '';
  return node.children
    .map((id) => doc.nodes[id])
    .filter((n): n is Node => n !== undefined && n.visible)
    .map((n) => textOf(doc, n))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasText(doc: Doc, node: Node): boolean {
  return textOf(doc, node) !== '';
}

/** Heading levels by size rank among the design's heading-role text, unless `props.level` says. */
function headingLevels(doc: Doc, rootId: string): Map<string, number> {
  const headings: Node[] = [];
  const visit = (id: string): void => {
    const n = doc.nodes[id];
    if (!n?.visible) return;
    if (n.type === 'text' && n.role === 'heading') headings.push(n);
    n.children.forEach(visit);
  };
  visit(rootId);
  const sizes = [...new Set(headings.map((h) => h.fontSize ?? 16))].sort((a, b) => b - a);
  const out = new Map<string, number>();
  for (const h of headings) {
    const explicit = Number(h.props?.level);
    const rank = sizes.indexOf(h.fontSize ?? 16) + 1;
    out.set(
      h.id,
      Number.isInteger(explicit) && explicit >= 1 && explicit <= 6 ? explicit : Math.min(6, rank),
    );
  }
  return out;
}

export function buildIr(doc: Doc, nodeId: string, options: IrOptions = {}): IrResult {
  const start = doc.nodes[nodeId];
  if (!start) throw new Error(`Node ${nodeId} does not exist.`);
  const asVariables = (options.tokens ?? 'variables') === 'variables';
  const cssTokens = asVariables ? variableTokens(doc.tokens) : doc.tokens;
  const warnings: string[] = [];
  const assets: ExportFile[] = [];
  const assetNames = new Map<string, string>(); // assetId -> file
  const usedAssetFiles = new Set<string>();
  const levels = headingLevels(doc, nodeId);
  const names = uniqueNames();
  const fonts = new Set<string>();

  const assetFile = (node: Node): string | null => {
    if (node.assetId === undefined) return null;
    const known = assetNames.get(node.assetId);
    if (known) return known;
    const url = doc.assets[node.assetId];
    const m =
      url === undefined
        ? null
        : /^data:(image\/(png|jpeg|gif|webp|svg\+xml));base64,([\s\S]*)$/.exec(url);
    const bytes = m?.[3] === undefined ? null : base64ToBytes(m[3]);
    if (!m || !bytes) {
      warnings.push(
        `Image "${node.name}" has no readable picture; it is exported without a source.`,
      );
      return null;
    }
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2] === 'svg+xml' ? 'svg' : (m[2] as string);
    let file = `assets/${kebab(node.name, 'image')}.${ext}`;
    for (let i = 2; usedAssetFiles.has(file); i += 1)
      file = `assets/${kebab(node.name, 'image')}-${i}.${ext}`;
    usedAssetFiles.add(file);
    assetNames.set(node.assetId, file);
    assets.push({ path: file, content: bytes });
    return file;
  };

  const build = (id: string, parent: Node | undefined, parentTag: string | null): IrNode | null => {
    const node = doc.nodes[id];
    if (!node || !node.visible) return null;

    // Declarations. A noise pattern is baked from real colour values, so it uses the literal tokens.
    const literal = isPatternFill(node.fill) && node.fill.pattern === 'noise';
    const css: CssRecord = nodeToCss(
      node,
      id === nodeId ? undefined : parent,
      literal ? doc.tokens : cssTokens,
    );
    if (asVariables) {
      if (node.type === 'text') {
        const raw = node.fontFamily;
        if (raw?.startsWith('$font.')) css.fontFamily = `var(--font-${raw.slice(6)})`;
      }
      if (typeof node.radius === 'string' && resolveRadius(node.radius, doc.tokens) !== undefined) {
        css.borderRadius = `var(--radius-${node.radius.slice(8)})`;
      }
    }
    if (node.type === 'text') {
      const family = resolveFont(node.fontFamily, doc.tokens);
      if (family) fonts.add(family);
    }

    let tag = 'div';
    const attrs: Record<string, string> = {};
    let text: string | undefined;
    let svg: IrNode['svg'];
    let asset: IrNode['asset'];
    let comment: string | undefined;
    let isVoid = false;

    switch (node.type) {
      case 'text': {
        const level = levels.get(node.id);
        tag =
          level !== undefined
            ? (HEADING_TAGS[level - 1] as string)
            : parentTag !== null && INTERACTIVE.has(parentTag)
              ? 'span'
              : 'p';
        text = node.text ?? '';
        break;
      }
      case 'icon': {
        tag = 'svg';
        const shape = iconShape(node.icon);
        if (shape)
          svg = {
            viewBox: `0 0 ${shape.vb[0]} ${shape.vb[1]}`,
            d: shape.d,
            evenodd: shape.rule === 'evenodd',
          };
        else {
          svg = { viewBox: '0 0 64 64', d: '', evenodd: false };
          comment = `Icon "${node.icon ?? ''}" is not in the icon set: replace this placeholder.`;
          warnings.push(
            `Icon "${node.name}" (${node.icon ?? 'no name'}) is not in the icon set; a placeholder was exported.`,
          );
        }
        const label = node.props?.['aria-label'];
        if (label) {
          attrs.role = 'img';
          attrs['aria-label'] = label;
        } else attrs['aria-hidden'] = 'true';
        attrs.focusable = 'false';
        break;
      }
      case 'image': {
        const file = assetFile(node);
        if (node.fit === 'tile' && file) {
          // A tiled picture is a box with the picture as its repeating background.
          tag = 'div';
          css.backgroundImage = `url(${file})`;
          if (node.props?.['aria-label']) {
            attrs.role = 'img';
            attrs['aria-label'] = node.props['aria-label'];
          } else attrs['aria-hidden'] = 'true';
          break;
        }
        tag = 'img';
        isVoid = true;
        if (file) asset = { file };
        const alt = node.props?.alt ?? node.props?.['aria-label'];
        if (alt === undefined)
          warnings.push(
            `Image "${node.name}" has no alt text (set props.alt); exported as decorative.`,
          );
        attrs.alt = alt ?? '';
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'line':
        break;
      case 'frame':
      case 'page': {
        if (node.role === 'button') {
          tag = 'button';
          attrs.type = 'button';
          if (!hasText(doc, node)) attrs['aria-label'] = node.props?.['aria-label'] ?? node.name;
        } else if (node.role === 'link') {
          tag = 'a';
          attrs.href = node.href ?? '#';
          if (!hasText(doc, node)) attrs['aria-label'] = node.props?.['aria-label'] ?? node.name;
        } else if (node.role === 'nav') tag = 'nav';
        else if (node.role === 'section') tag = 'section';
        else if (node.role === 'list') tag = 'ul';
        else if (node.role === 'input') {
          tag = 'input';
          isVoid = true;
          attrs.type = 'text';
          const placeholder = textOf(doc, node);
          if (placeholder) attrs.placeholder = placeholder;
          attrs['aria-label'] = node.props?.['aria-label'] ?? (placeholder || node.name);
        } else if (parentTag === 'ul') tag = 'li';
        break;
      }
    }
    if (node.type !== 'frame' && node.type !== 'page' && parentTag === 'ul') {
      // A list of bare shapes would be invalid HTML; the list items must be <li>.
      warnings.push(
        `"${node.name}" sits directly in a list; wrap it in a frame so it can be a list item.`,
      );
    }
    if (css.position === 'absolute' && node.type !== 'page' && id !== nodeId) {
      comment ??= 'Placed by x/y: consider converting to auto-layout.';
    }

    const children: IrNode[] = [];
    if (!isVoid && (node.type === 'frame' || node.type === 'page')) {
      for (const childId of node.children) {
        const child = build(childId, node, tag);
        if (child) children.push(child);
      }
    }
    return {
      id: node.id,
      name: node.name,
      tag,
      className: names.next(node.name, node.type),
      attrs,
      css,
      ...(text === undefined ? {} : { text }),
      ...(svg ? { svg } : {}),
      ...(asset ? { asset } : {}),
      ...(comment ? { comment } : {}),
      void: isVoid,
      children,
    };
  };

  const root = build(nodeId, doc.nodes[start.parentId ?? ''], null);
  if (!root) throw new Error(`Node ${nodeId} is hidden, so there is nothing to export.`);
  return {
    root,
    tokensCss: tokensCss(doc.tokens),
    fonts: [...fonts],
    assets,
    warnings: [...new Set(warnings)],
    vars: {
      colors: Object.fromEntries(Object.keys(doc.tokens.colors).map((k) => [k, `--color-${k}`])),
      fonts: Object.fromEntries(Object.keys(doc.tokens.fonts).map((k) => [k, `--font-${k}`])),
      radii: Object.fromEntries(Object.keys(doc.tokens.radii).map((k) => [k, `--radius-${k}`])),
    },
  };
}

/** The `:root` variables for the design's tokens. Colours are written as literal values. */
export function tokensCss(tokens: Tokens): string {
  const lines: string[] = [];
  for (const name of Object.keys(tokens.colors)) {
    const value = resolveColor(`$${name}`, tokens);
    if (value !== undefined) lines.push(`  --color-${name}: ${value};`);
  }
  for (const [name, family] of Object.entries(tokens.fonts)) {
    const resolved = resolveFont(`$font.${name}`, tokens) ?? family;
    lines.push(`  --font-${name}: ${fontStack(resolved)};`);
  }
  for (const [name, px] of Object.entries(tokens.radii)) lines.push(`  --radius-${name}: ${px}px;`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/** Package names to install for the fonts, for the README. */
export function fontsourcePackage(family: string): string | null {
  const info = fontInfo(family);
  if (!info) return null;
  const slug = info.name.toLowerCase().replace(/\s+/g, '-');
  return info.variable ? `@fontsource-variable/${slug}` : `@fontsource/${slug}`;
}
