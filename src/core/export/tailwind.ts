/**
 * React + Tailwind (v4, CSS-first). Each declaration is mapped to a utility ONLY when the mapping is
 * exact; everything else goes, verbatim, into a small `atelier.css` class on the same element, so
 * nothing is ever guessed (docs/10: "fall back rather than guess"). Tokens become the `@theme`
 * block, so `var(--color-primary)` is the `bg-primary` / `text-primary` utility.
 */
import { componentSource, imageIdentifier } from './jsx';
import { cssBlock, walk } from './format';
import type { ExportFile, IrNode, IrResult } from './ir';
import type { CssRecord } from '../style';

const HEX_OR_RGB =
  /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\))$/;
const TOKEN_COLOR = /^var\(--color-([A-Za-z][A-Za-z0-9_-]*)\)$/;
const TOKEN_FONT = /^var\(--font-([A-Za-z][A-Za-z0-9_-]*)\)$/;
const TOKEN_RADIUS = /^var\(--radius-([A-Za-z][A-Za-z0-9_-]*)\)$/;
const PX = /^-?\d+(?:\.\d+)?px$/;
const NUM = /^-?\d+(?:\.\d+)?$/;

/** Spaces in an arbitrary value are written as underscores. */
const arb = (v: string): string => v.replace(/\s+/g, '_');

const colour = (prefix: string, v: string): string | null => {
  const t = TOKEN_COLOR.exec(v);
  if (t) return `${prefix}-${t[1]}`;
  return HEX_OR_RGB.test(v) ? `${prefix}-[${arb(v)}]` : null;
};

const KEYWORDS: Record<string, Record<string, string>> = {
  display: { flex: 'flex', block: 'block' },
  flexDirection: { column: 'flex-col', row: 'flex-row' },
  flexWrap: { wrap: 'flex-wrap' },
  alignItems: {
    'flex-start': 'items-start',
    center: 'items-center',
    'flex-end': 'items-end',
    stretch: 'items-stretch',
  },
  justifyContent: {
    'flex-start': 'justify-start',
    center: 'justify-center',
    'flex-end': 'justify-end',
    'space-between': 'justify-between',
  },
  alignSelf: { stretch: 'self-stretch' },
  position: { absolute: 'absolute', relative: 'relative' },
  overflow: { hidden: 'overflow-hidden' },
  textAlign: {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
    justify: 'text-justify',
  },
  textTransform: { uppercase: 'uppercase', capitalize: 'capitalize' },
  whiteSpace: { pre: 'whitespace-pre', 'pre-wrap': 'whitespace-pre-wrap' },
  objectFit: { cover: 'object-cover', contain: 'object-contain', fill: 'object-fill' },
  minWidth: { '0': 'min-w-0', '0px': 'min-w-0' },
};

const FLEX: Record<string, string> = { '0 0 auto': 'flex-none', '1 1 0': 'flex-1' };

/** The utility for one declaration, or null when there is no exact one. */
function utility(key: string, v: string): string | null {
  const fixed = KEYWORDS[key]?.[v];
  if (fixed !== undefined) return fixed;
  switch (key) {
    case 'flex':
      return FLEX[v] ?? null;
    case 'gap':
      return PX.test(v) ? `gap-[${v}]` : null;
    case 'width':
    case 'height': {
      const p = key === 'width' ? 'w' : 'h';
      if (v === '100%') return `${p}-full`;
      return PX.test(v) ? `${p}-[${v}]` : null;
    }
    case 'left':
    case 'top':
      return PX.test(v) ? `${key}-[${v}]` : null;
    case 'padding': {
      const parts = v.split(/\s+/);
      if (parts.length !== 4 || !parts.every((p) => PX.test(p))) return null;
      return `pt-[${parts[0]}] pr-[${parts[1]}] pb-[${parts[2]}] pl-[${parts[3]}]`;
    }
    case 'backgroundColor':
      return colour('bg', v);
    case 'color':
      return colour('text', v);
    case 'fontSize':
      return PX.test(v) ? `text-[${v}]` : null;
    case 'fontWeight':
      return NUM.test(v) ? `font-[${v}]` : null;
    case 'lineHeight':
      return NUM.test(v) ? `leading-[${v}]` : null;
    case 'letterSpacing':
      return /^-?\d+(?:\.\d+)?em$/.test(v) ? `tracking-[${v}]` : null;
    case 'opacity':
      return NUM.test(v) ? `opacity-[${v}]` : null;
    case 'fontFamily': {
      const t = TOKEN_FONT.exec(v);
      return t ? `font-${t[1]}` : null;
    }
    case 'borderRadius': {
      const t = TOKEN_RADIUS.exec(v);
      if (t) return `rounded-${t[1]}`;
      return PX.test(v) || v === '50%' ? `rounded-[${v}]` : null;
    }
    case 'transform': {
      const m = /^rotate\((-?\d+(?:\.\d+)?)deg\)$/.exec(v);
      return m ? `rotate-[${m[1]}deg]` : null;
    }
    default:
      return null;
  }
}

export function utilitiesFor(css: CssRecord): { classes: string[]; rest: CssRecord } {
  const classes: string[] = [];
  const rest: CssRecord = {};
  for (const [key, value] of Object.entries(css)) {
    const u = utility(key, value);
    if (u === null) rest[key] = value;
    else classes.push(...u.split(' '));
  }
  return { classes, rest };
}

function themeCss(ir: IrResult): string {
  // The :root variables become the Tailwind theme, so the same names drive the utilities.
  const body = ir.tokensCss.replace(/^:root \{\n/, '').replace(/\n\}$/, '');
  return `@import 'tailwindcss';\n\n@theme {\n${body}\n}\n`;
}

/** `Name.tsx` (utility classes), `theme.css` (@theme from the tokens), `atelier.css` (the leftovers). */
export function toReactTailwind(ir: IrResult, componentName: string): ExportFile[] {
  // Class lists per element, then the exact leftovers as plain classes.
  const classOf = new Map<string, string>();
  const extra: string[] = [];
  walk(ir.root, (n: IrNode) => {
    const { classes, rest } = utilitiesFor(n.css);
    const list = [...classes];
    const block = cssBlock(`.${n.className}`, rest);
    if (block !== '') {
      extra.push(block);
      list.push(n.className);
    }
    classOf.set(n.id, list.join(' '));
  });
  const source = componentSource(
    ir,
    componentName,
    ["import './theme.css';", "import './atelier.css';"],
    {
      className: (n) => JSON.stringify(classOf.get(n.id) ?? ''),
      imageVar: imageIdentifier,
    },
  );
  return [
    { path: `${componentName}.tsx`, content: source },
    { path: 'theme.css', content: themeCss(ir) },
    {
      path: 'atelier.css',
      content: `/* Declarations with no exact Tailwind utility (gradients, patterns, shadows, filters...), kept verbatim. */\n${extra.join('\n\n')}\n`,
    },
    ...ir.assets,
  ];
}
