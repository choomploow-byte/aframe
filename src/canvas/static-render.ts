/**
 * A plain-DOM renderer for one node subtree of a document, used where the live canvas cannot show
 * what is wanted: a screenshot of components in another state (hover, pressed...). It uses the same
 * `nodeToCss` and the same icon art as the canvas, so the picture is faithful, and it never touches
 * the live view or the saved document.
 */
import { nodeToCss } from '@core/style';
import type { Doc, Node } from '@core/types';
import { iconArt } from './icon-art';

const SVG_NS = 'http://www.w3.org/2000/svg';
const IMAGE_SRC_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);/;

/** CSS record keys are camelCase; the DOM's `style` object takes them as they are. */
function applyStyle(el: HTMLElement, css: Record<string, string>): void {
  for (const [key, value] of Object.entries(css)) {
    (el.style as unknown as Record<string, string>)[key] = value;
  }
}

function iconElement(node: Node): SVGSVGElement {
  const art = iconArt(node.icon, node.w, node.h);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', art.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'display:block;width:100%;height:100%;overflow:visible';
  for (const part of art.parts) {
    const child = document.createElementNS(SVG_NS, part.tag);
    for (const [k, v] of Object.entries(part.attrs)) child.setAttribute(k, v);
    if (part.text !== undefined) child.textContent = part.text;
    svg.appendChild(child);
  }
  return svg;
}

function build(doc: Doc, id: string, parent: Node | undefined): HTMLElement | null {
  const node = doc.nodes[id];
  if (!node) return null;
  const css = nodeToCss(node, parent, doc.tokens);
  let el: HTMLElement;
  if (node.type === 'image') {
    const url = node.assetId === undefined ? undefined : doc.assets[node.assetId];
    if (url !== undefined && IMAGE_SRC_RE.test(url)) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      el = img;
    } else {
      el = document.createElement('div');
      css.background =
        'repeating-linear-gradient(45deg, #e8e6dc, #e8e6dc 8px, #f0eee6 8px, #f0eee6 16px)';
    }
  } else {
    el = document.createElement('div');
    if (node.type === 'text') el.textContent = node.text ?? '';
    if (node.type === 'icon') el.appendChild(iconElement(node));
  }
  el.setAttribute('data-node-id', id);
  applyStyle(el, css);
  if (node.type === 'frame' || node.type === 'page') {
    for (const childId of node.children) {
      const child = build(doc, childId, node);
      if (child) el.appendChild(child);
    }
  }
  return el;
}

/** The element for `id` and everything below it, styled as `doc` says. Null if `id` does not exist. */
export function renderSubtree(doc: Doc, id: string): HTMLElement | null {
  const node = doc.nodes[id];
  if (!node) return null;
  const parent = node.parentId === null ? undefined : doc.nodes[node.parentId];
  return build(doc, id, parent);
}
