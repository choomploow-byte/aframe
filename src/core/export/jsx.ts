import { INDENT, RESET_CSS, stylesheet, walk } from './format';
import type { ExportFile, IrNode, IrResult } from './ir';
import { kebab } from './names';

const SVG_ATTR: Record<string, string> = {
  'fill-rule': 'fillRule',
  'stroke-width': 'strokeWidth',
  'stroke-dasharray': 'strokeDasharray',
  viewBox: 'viewBox',
};

const jsxAttr = (k: string, v: string): string =>
  `${SVG_ATTR[k] ?? k}=${/["\\\n{}]/.test(v) ? `{${JSON.stringify(v)}}` : `"${v}"`}`;

const jsxText = (s: string): string =>
  /[{}<>&\n\\]/.test(s) || s !== s.trim() ? `{${JSON.stringify(s)}}` : s;

export interface JsxContext {
  /** Expression for a node's `className`. */
  className: (n: IrNode) => string;
  /** Import identifier for an image asset. */
  imageVar: (file: string) => string;
}

function jsx(n: IrNode, depth: number, ctx: JsxContext): string {
  const pad = INDENT.repeat(depth);
  const comment = n.comment ? `${pad}{/* ${n.comment.replace(/\*\//g, '* /')} */}\n` : '';
  const cls = ctx.className(n);
  // A plain string is written as an attribute string; an expression (a CSS Module lookup) in braces.
  const props: string[] = [cls.startsWith('"') ? `className=${cls}` : `className={${cls}}`];
  for (const [k, v] of Object.entries(n.attrs)) props.push(jsxAttr(k, v));
  if (n.asset) props.push(`src={${ctx.imageVar(n.asset.file)}}`);
  const open = `<${n.tag} ${props.join(' ')}`;

  if (n.svg) {
    const attrs = `${open} viewBox="${n.svg.viewBox}"`;
    const shape = n.svg.d
      ? `<path d="${n.svg.d}" fill="currentColor"${n.svg.evenodd ? ' fillRule="evenodd"' : ''} />`
      : '<rect x="4" y="4" width="56" height="56" rx="9" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="6 4" />';
    return `${comment}${pad}${attrs}>${shape}</${n.tag}>`;
  }
  if (n.void) return `${comment}${pad}${open} />`;
  if (n.text !== undefined) return `${comment}${pad}${open}>${jsxText(n.text)}</${n.tag}>`;
  if (n.children.length === 0) return `${comment}${pad}${open} />`;
  const inner = n.children.map((c) => jsx(c, depth + 1, ctx)).join('\n');
  return `${comment}${pad}${open}>\n${inner}\n${pad}</${n.tag}>`;
}

/** The component file body shared by both React flavours. */
export function componentSource(
  ir: IrResult,
  componentName: string,
  header: string[],
  ctx: JsxContext,
): string {
  const imports = new Map<string, string>();
  walk(ir.root, (n) => {
    if (n.asset) imports.set(n.asset.file, ctx.imageVar(n.asset.file));
  });
  const importLines = [
    ...header,
    ...[...imports].map(([file, id]) => `import ${id} from './${file}';`),
  ];
  return `${importLines.join('\n')}

export default function ${componentName}() {
  return (
${jsx(ir.root, 2, ctx)}
  );
}
`;
}

const imageIdentifier = (file: string): string => {
  const base = kebab(file.replace(/^assets\//, '').replace(/\.[a-z0-9]+$/, ''), 'image');
  return `img${base
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')}`;
};

/** React + CSS Modules: `Name.tsx`, `Name.module.css`, `tokens.css`, assets. */
export function toReactCss(ir: IrResult, componentName: string): ExportFile[] {
  const source = componentSource(
    ir,
    componentName,
    ["import './tokens.css';", `import styles from './${componentName}.module.css';`],
    { className: (n) => `styles['${n.className}']`, imageVar: imageIdentifier },
  );
  return [
    { path: `${componentName}.tsx`, content: source },
    { path: `${componentName}.module.css`, content: `${stylesheet(ir.root)}\n` },
    { path: 'tokens.css', content: `${ir.tokensCss}\n\n${RESET_CSS}\n` },
    ...ir.assets,
  ];
}

export { imageIdentifier };
