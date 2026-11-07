/** String building shared by the formats: stylesheets, escaping, indentation. */
import { cssPropertyName, cssToString, type CssRecord } from '../style';
import type { IrNode } from './ir';

export const INDENT = '  ';

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Same effect as the canvas's own reset (docs/04), written readably, plus what real tags need. */
export const RESET_CSS = `*,
*::before,
*::after {
  box-sizing: border-box;
}

* {
  margin: 0;
}

body {
  font-family: var(--font-body, 'Inter', system-ui, sans-serif);
}

button {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0;
  text-align: inherit;
  cursor: pointer;
}

a {
  color: inherit;
  text-decoration: none;
}

ul {
  list-style: none;
  padding: 0;
}

img,
svg {
  display: block;
}`;

export const declarations = (css: CssRecord, indent = INDENT): string =>
  cssToString(css, { separator: `\n${indent}` });

export function cssBlock(selector: string, css: CssRecord): string {
  const body = declarations(css);
  return body === '' ? '' : `${selector} {\n${INDENT}${body}\n}`;
}

/** Every element in document order. */
export function walk(root: IrNode, visit: (node: IrNode, depth: number) => void, depth = 0): void {
  visit(root, depth);
  for (const child of root.children) walk(child, visit, depth + 1);
}

/** One rule per element, in document order, so a re-export changes only what changed. */
export function stylesheet(root: IrNode): string {
  const blocks: string[] = [];
  walk(root, (n) => {
    const block = cssBlock(`.${n.className}`, n.css);
    if (block !== '') blocks.push(block);
  });
  return blocks.join('\n\n');
}

export { cssPropertyName };
