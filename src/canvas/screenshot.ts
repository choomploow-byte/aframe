/**
 * Renders the design (or one node) to a PNG from the live DOM, for the agent's `screenshot` tool.
 *
 * The canvas is a transformed, interactive view, so we never photograph it directly. Instead the
 * wanted artboards are cloned into a detached, untransformed container at their world positions
 * (every style is inline from `nodeToCss`, so the clone is faithful), fonts and images are awaited,
 * and `html-to-image` rasterises that container. What the agent sees is what `nodeToCss` says, with
 * no selection handles, guides or panels.
 */
import { toCanvas } from 'html-to-image';
import { docFontFamilies, loadFonts } from './fonts';
import { resolveColor } from '@core/tokens';
import type { Doc } from '@core/types';

export interface ScreenshotParams {
  nodeId?: string;
  scale?: 1 | 2;
  annotations?: boolean;
  maxWidth?: number;
}

export interface ScreenshotOutput {
  pngBase64: string;
  width: number;
  height: number;
}

export class ScreenshotError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'INVALID_VALUE' | 'INTERNAL',
    message: string,
  ) {
    super(message);
  }
}

const MAX_PNG_BYTES = 8 * 1024 * 1024; // docs/06: scale down above 8 MB
const PAGE_BACKGROUND = '#f0eee6';

interface Region {
  /** The elements to draw, with their world rectangle. */
  items: { el: HTMLElement; x: number; y: number; w: number; h: number }[];
  /** World rectangle of everything. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const find = (id: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);

/** Layout size of a node in world px (offset sizes ignore the canvas zoom and any ancestor transform). */
function sizeOf(el: HTMLElement): { w: number; h: number } {
  return { w: Math.max(1, el.offsetWidth), h: Math.max(1, el.offsetHeight) };
}

/** World position of an element: from the world layer's own rect, divided by the zoom. */
function worldRect(el: HTMLElement, zoom: number): { x: number; y: number; w: number; h: number } {
  const world = document.querySelector<HTMLElement>('[data-testid="world"]');
  if (!world) throw new ScreenshotError('INTERNAL', 'The canvas is not ready.');
  const a = el.getBoundingClientRect();
  const b = world.getBoundingClientRect();
  return { x: (a.left - b.left) / zoom, y: (a.top - b.top) / zoom, ...sizeOf(el) };
}

function regionFor(doc: Doc, nodeId: string | undefined, zoom: number): Region {
  const targets: HTMLElement[] = [];
  if (nodeId !== undefined) {
    if (doc.nodes[nodeId] === undefined) {
      throw new ScreenshotError('NOT_FOUND', `Node ${nodeId} does not exist.`);
    }
    const el = find(nodeId);
    if (!el)
      throw new ScreenshotError(
        'NOT_FOUND',
        `Node ${nodeId} is not drawn on the canvas (is it hidden?).`,
      );
    targets.push(el);
  } else {
    const root = doc.nodes[doc.rootId];
    for (const id of root?.children ?? []) {
      const el = find(id);
      if (el) targets.push(el);
    }
    if (targets.length === 0)
      throw new ScreenshotError(
        'NOT_FOUND',
        'The design is empty: there is nothing to photograph.',
      );
  }
  const items = targets.map((el) => ({ el, ...worldRect(el, zoom) }));
  const x = Math.min(...items.map((i) => i.x));
  const y = Math.min(...items.map((i) => i.y));
  const right = Math.max(...items.map((i) => i.x + i.w));
  const bottom = Math.max(...items.map((i) => i.y + i.h));
  return {
    items,
    x,
    y,
    w: Math.max(1, Math.ceil(right - x)),
    h: Math.max(1, Math.ceil(bottom - y)),
  };
}

/** What is behind a node on the canvas: the nearest ancestor fill (tokens resolved), else white. */
function backgroundBehind(doc: Doc, nodeId: string): string {
  let cur = doc.nodes[nodeId]?.parentId ?? null;
  while (cur !== null) {
    const node = doc.nodes[cur];
    if (!node) break;
    const fill = node.fill === undefined ? undefined : resolveColor(node.fill, doc.tokens);
    if (fill) return fill;
    cur = node.parentId;
  }
  return '#ffffff';
}

async function imagesReady(root: HTMLElement): Promise<void> {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(
    imgs.map((img) =>
      img.complete && img.naturalWidth > 0
        ? Promise.resolve()
        : img.decode().catch(() => undefined),
    ),
  );
}

function drawPins(ctx: CanvasRenderingContext2D, doc: Doc, region: Region, scale: number): void {
  const open = doc.annotations.filter((a) => a.status === 'open');
  open.forEach((a, i) => {
    const px = (a.x - region.x) * scale;
    const py = (a.y - region.y) * scale;
    if (px < 0 || py < 0 || px > region.w * scale || py > region.h * scale) return;
    const r = 11 * Math.max(1, scale * 0.8);
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = '#5b3cb0';
    ctx.fill();
    ctx.lineWidth = Math.max(2, scale * 1.5);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(r * 1.1)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), px, py + 0.5);
  });
}

/**
 * A minimised or covered window produces no animation frames, and `html-to-image` waits for one
 * before it hands each image back, so a screenshot of a hidden window would never finish. While the
 * page is hidden, frame callbacks run from a timer instead, for the length of the capture only.
 */
async function whileFramesMayNotRun<T>(work: () => Promise<T>): Promise<T> {
  if (!document.hidden) return work();
  // Only ever put back as the same function, never called detached.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) =>
    window.setTimeout(() => callback(performance.now()), 16);
  try {
    return await work();
  } finally {
    window.requestAnimationFrame = original;
  }
}

/** One render at one pixel ratio. */
async function render(
  doc: Doc,
  region: Region,
  scale: number,
  withPins: boolean,
  background: string,
): Promise<HTMLCanvasElement> {
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${region.w}px;height:${region.h}px;overflow:hidden;pointer-events:none;`;
  const stage = document.createElement('div');
  stage.style.cssText = `position:relative;width:${region.w}px;height:${region.h}px;background:${background};`;
  holder.appendChild(stage);
  for (const item of region.items) {
    const clone = item.el.cloneNode(true) as HTMLElement;
    // Out of its parent (a flex container, the transformed world): pin it with the size it had.
    clone.style.position = 'absolute';
    clone.style.left = `${item.x - region.x}px`;
    clone.style.top = `${item.y - region.y}px`;
    clone.style.width = `${item.w}px`;
    clone.style.height = `${item.h}px`;
    clone.style.margin = '0';
    clone.style.flex = 'none';
    clone.style.transform = 'none';
    clone.removeAttribute('contenteditable');
    stage.appendChild(clone);
  }
  document.body.appendChild(holder);
  try {
    await loadFonts(docFontFamilies(doc), 3000);
    await document.fonts.ready;
    await imagesReady(stage);
    const canvas = await toCanvas(stage, {
      pixelRatio: scale,
      width: region.w,
      height: region.h,
      cacheBust: false,
      // Fonts are bundled and already loaded; embedding every @font-face file again is slow and not needed
      // when the clone is drawn by this same document's font set.
      skipFonts: false,
    });
    if (withPins) {
      const ctx = canvas.getContext('2d');
      if (ctx) drawPins(ctx, doc, region, scale);
    }
    return canvas;
  } finally {
    holder.remove();
  }
}

export async function captureScreenshot(
  doc: Doc,
  zoom: number,
  params: ScreenshotParams = {},
): Promise<ScreenshotOutput> {
  const wanted = params.scale ?? 1;
  const maxSide = params.maxWidth ?? 1600;
  if (wanted !== 1 && wanted !== 2)
    throw new ScreenshotError('INVALID_VALUE', 'scale must be 1 or 2.');
  if (!Number.isInteger(maxSide) || maxSide < 64 || maxSide > 4096) {
    throw new ScreenshotError('INVALID_VALUE', 'maxWidth must be a whole number from 64 to 4096.');
  }
  const region = regionFor(doc, params.nodeId, zoom);
  const background =
    params.nodeId === undefined ? PAGE_BACKGROUND : backgroundBehind(doc, params.nodeId);
  // The longest side is capped at maxWidth, whatever the scale asks for.
  let scale = Math.min(wanted, maxSide / Math.max(region.w, region.h));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = await whileFramesMayNotRun(() =>
      render(doc, region, scale, params.annotations === true, background),
    );
    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    // base64 is 4/3 of the bytes: shrink and retry if the PNG would be over the cap.
    if (base64.length * 0.75 <= MAX_PNG_BYTES || attempt === 3) {
      return { pngBase64: base64, width: canvas.width, height: canvas.height };
    }
    scale *= 0.7;
  }
  throw new ScreenshotError('INTERNAL', 'Could not produce a small enough image.');
}

/** A node's rectangle on the canvas in world units (what get_node reports as bounds). */
export function nodeBounds(
  nodeId: string,
  zoom: number,
): { x: number; y: number; width: number; height: number } | null {
  const el = find(nodeId);
  if (!el) return null;
  const r = worldRect(el, zoom);
  return {
    x: Math.round(r.x * 100) / 100,
    y: Math.round(r.y * 100) / 100,
    width: r.w,
    height: r.h,
  };
}
