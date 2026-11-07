import { escapeAttr, escapeHtml, INDENT, RESET_CSS, stylesheet } from './format';
import type { ExportFile, IrNode, IrResult } from './ir';

function attrString(attrs: Record<string, string>): string {
  const entries = Object.entries(attrs);
  return entries.length === 0
    ? ''
    : ` ${entries.map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ')}`;
}

function element(n: IrNode, depth: number): string {
  const pad = INDENT.repeat(depth);
  const comment = n.comment ? `${pad}<!-- ${n.comment.replace(/--/g, '- -')} -->\n` : '';
  const attrs: Record<string, string> = { class: n.className, ...n.attrs };
  if (n.asset) attrs.src = n.asset.file;

  if (n.svg) {
    const path = n.svg.d
      ? `<path d="${escapeAttr(n.svg.d)}" fill="currentColor"${n.svg.evenodd ? ' fill-rule="evenodd"' : ''}/>`
      : `<rect x="4" y="4" width="56" height="56" rx="9" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="6 4"/>`;
    return `${comment}${pad}<svg${attrString({ ...attrs, viewBox: n.svg.viewBox })}>${path}</svg>`;
  }
  if (n.void) return `${comment}${pad}<${n.tag}${attrString(attrs)}>`;
  if (n.text !== undefined) {
    return `${comment}${pad}<${n.tag}${attrString(attrs)}>${escapeHtml(n.text)}</${n.tag}>`;
  }
  if (n.children.length === 0) return `${comment}${pad}<${n.tag}${attrString(attrs)}></${n.tag}>`;
  const inner = n.children.map((c) => element(c, depth + 1)).join('\n');
  return `${comment}${pad}<${n.tag}${attrString(attrs)}>\n${inner}\n${pad}</${n.tag}>`;
}

/** `index.html` + `styles.css` (+ assets): the frame as a plain page. */
export function toHtml(ir: IrResult, title: string): ExportFile[] {
  const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
${element(ir.root, 2)}
  </body>
</html>
`;
  const css = `${ir.tokensCss}\n\n${RESET_CSS}\n\n${stylesheet(ir.root)}\n`;
  return [
    { path: 'index.html', content: page },
    { path: 'styles.css', content: css },
    ...ir.assets,
  ];
}
