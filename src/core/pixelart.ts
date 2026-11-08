/**
 * Pixel art: a grid of palette indices, and the pure operations on it (set, line, rectangle, fill,
 * replace from a text grid, palette edits, export). Nothing here touches a document or the DOM, so
 * the editor, the AI tools and the tests all use the same code.
 *
 * Index 0 is always transparent. Palette entry 0 is the placeholder `#00000000`; entries 1.. are
 * `#RRGGBB` colours the user (or the AI) chose. At most 62 entries, so every index fits one
 * character in the text form the AI reads and writes: `.` is transparent, then 1-9, a-z, A-Z.
 */

export const MAX_PIXEL_SIZE = 128;
export const MAX_PALETTE = 62;
export const TRANSPARENT = '#00000000';

/** The character for each palette index in the text grid. Index 0 is `.`. */
const GLYPHS = `.${'123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'}`;

export interface PixelCanvas {
  width: number;
  height: number;
  /** Index 0 is transparent (`#00000000`); the rest are `#RRGGBB`. */
  palette: string[];
  /** Palette indices, row by row, length `width * height`. */
  pixels: number[];
}

export type PixelErrorCode =
  | 'BAD_SIZE'
  | 'OUT_OF_BOUNDS'
  | 'BAD_COLOR'
  | 'BAD_INDEX'
  | 'BAD_PALETTE'
  | 'BAD_GRID'
  | 'BAD_FILE';

/** A problem with an input, worded so a person (or an AI) can fix the call. */
export class PixelError extends Error {
  readonly code: PixelErrorCode;
  constructor(code: PixelErrorCode, message: string) {
    super(message);
    this.name = 'PixelError';
    this.code = code;
  }
}

/** A small, bright default palette (16 colours including transparent is plenty for sprites). */
export const DEFAULT_PALETTE: readonly string[] = [
  TRANSPARENT,
  '#1A1C2C',
  '#5D275D',
  '#B13E53',
  '#EF7D57',
  '#FFCD75',
  '#A7F070',
  '#38B764',
  '#257179',
  '#29366F',
  '#3B5DC9',
  '#41A6F6',
  '#73EFF7',
  '#F4F4F4',
  '#94B0C2',
  '#566C86',
];

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** `#abc` / `#aabbcc` (any case) to `#AABBCC`, or null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = (m[1] as string).toUpperCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? '#000000';
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

export const glyphOf = (index: number): string => GLYPHS[index] ?? '?';

// ---------------------------------------------------------------------------
// Creating and reading
// ---------------------------------------------------------------------------

function checkSize(width: unknown, height: unknown): [number, number] {
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_PIXEL_SIZE ||
    height > MAX_PIXEL_SIZE
  ) {
    throw new PixelError(
      'BAD_SIZE',
      `The size must be whole numbers from 1 to ${MAX_PIXEL_SIZE} (got ${String(width)} x ${String(height)}).`,
    );
  }
  return [width, height];
}

/** `colors` are the colours after transparent; the result's palette starts with transparent. */
export function checkPalette(colors: readonly unknown[]): string[] {
  if (colors.length > MAX_PALETTE - 1) {
    throw new PixelError(
      'BAD_PALETTE',
      `A palette holds at most ${MAX_PALETTE - 1} colours plus transparent (got ${colors.length}).`,
    );
  }
  const out: string[] = [TRANSPARENT];
  colors.forEach((c, i) => {
    const hex = normalizeHex(c);
    if (hex === null) {
      throw new PixelError(
        'BAD_COLOR',
        `Palette colour ${i + 1} is not a hex colour like "#FF8800" (got ${JSON.stringify(c)}).`,
      );
    }
    out.push(hex);
  });
  return out;
}

export function createCanvas(
  width: number,
  height: number,
  colors: readonly unknown[] = DEFAULT_PALETTE.slice(1),
): PixelCanvas {
  const [w, h] = checkSize(width, height);
  return {
    width: w,
    height: h,
    palette: checkPalette(colors),
    pixels: new Array<number>(w * h).fill(0),
  };
}

const inBounds = (c: PixelCanvas, x: number, y: number): boolean =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < c.width && y < c.height;

export function getPixel(c: PixelCanvas, x: number, y: number): number {
  if (!inBounds(c, x, y)) {
    throw new PixelError(
      'OUT_OF_BOUNDS',
      `(${x}, ${y}) is outside the ${c.width} x ${c.height} canvas.`,
    );
  }
  return c.pixels[y * c.width + x] as number;
}

// ---------------------------------------------------------------------------
// Colour arguments: a palette index, a hex colour (added to the palette if new), or transparent
// ---------------------------------------------------------------------------

/** What a caller may pass where a colour goes. */
export type ColorArg = number | string;

/**
 * Turns a colour argument into a palette index, adding a new hex colour to the palette when there
 * is room. Returns the (possibly extended) canvas with it.
 */
export function resolveColor(
  c: PixelCanvas,
  color: ColorArg,
): { canvas: PixelCanvas; index: number } {
  if (typeof color === 'number') {
    if (!Number.isInteger(color) || color < 0 || color >= c.palette.length) {
      throw new PixelError(
        'BAD_INDEX',
        `Palette index ${color} does not exist: this palette has indices 0 to ${c.palette.length - 1} (0 is transparent).`,
      );
    }
    return { canvas: c, index: color };
  }
  if (typeof color === 'string' && /^(transparent|none|clear)$/i.test(color.trim())) {
    return { canvas: c, index: 0 };
  }
  const hex = normalizeHex(color);
  if (hex === null) {
    throw new PixelError(
      'BAD_COLOR',
      `"${String(color)}" is not a palette index or a hex colour like "#FF8800".`,
    );
  }
  const found = c.palette.indexOf(hex, 1);
  if (found > 0) return { canvas: c, index: found };
  if (c.palette.length >= MAX_PALETTE) {
    throw new PixelError(
      'BAD_PALETTE',
      `The palette is full (${MAX_PALETTE - 1} colours). Reuse an existing colour or remove one with set_palette.`,
    );
  }
  return { canvas: { ...c, palette: [...c.palette, hex] }, index: c.palette.length };
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

export interface DrawOptions {
  /** Ignore points outside the canvas instead of failing (for a mouse drag that leaves the edge). */
  clip?: boolean;
}

/** Writes `index` at every point, in one copy of the pixels. */
function paint(
  c: PixelCanvas,
  points: Iterable<readonly [number, number]>,
  index: number,
  options: DrawOptions,
): PixelCanvas {
  const pixels = c.pixels.slice();
  for (const [x, y] of points) {
    if (!inBounds(c, x, y)) {
      if (options.clip) continue;
      throw new PixelError(
        'OUT_OF_BOUNDS',
        `(${x}, ${y}) is outside the ${c.width} x ${c.height} canvas (x 0-${c.width - 1}, y 0-${c.height - 1}).`,
      );
    }
    pixels[y * c.width + x] = index;
  }
  return { ...c, pixels };
}

export function setPixels(
  c: PixelCanvas,
  list: readonly { x: number; y: number; color: ColorArg }[],
  options: DrawOptions = {},
): PixelCanvas {
  let canvas = c;
  const pixels = c.pixels.slice();
  for (const [i, p] of list.entries()) {
    const r = resolveColor(canvas, p.color);
    canvas = r.canvas;
    if (!inBounds(c, p.x, p.y)) {
      if (options.clip) continue;
      throw new PixelError(
        'OUT_OF_BOUNDS',
        `Pixel ${i + 1}: (${p.x}, ${p.y}) is outside the ${c.width} x ${c.height} canvas (x 0-${c.width - 1}, y 0-${c.height - 1}).`,
      );
    }
    pixels[p.y * c.width + p.x] = r.index;
  }
  return { ...canvas, pixels };
}

/** The cells on the line between two cells, both ends included (Bresenham). */
export function linePoints(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x, y]);
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** The cells of a rectangle between two corners (any order). */
export function rectPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
): [number, number][] {
  const left = Math.min(Math.round(x0), Math.round(x1));
  const right = Math.max(Math.round(x0), Math.round(x1));
  const top = Math.min(Math.round(y0), Math.round(y1));
  const bottom = Math.max(Math.round(y0), Math.round(y1));
  const out: [number, number][] = [];
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (filled || x === left || x === right || y === top || y === bottom) out.push([x, y]);
    }
  }
  return out;
}

export function drawLine(
  c: PixelCanvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: ColorArg,
  options: DrawOptions = {},
): PixelCanvas {
  const r = resolveColor(c, color);
  return paint(r.canvas, linePoints(x0, y0, x1, y1), r.index, options);
}

export function drawRect(
  c: PixelCanvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: ColorArg,
  filled = false,
  options: DrawOptions = {},
): PixelCanvas {
  const r = resolveColor(c, color);
  return paint(r.canvas, rectPoints(x0, y0, x1, y1, filled), r.index, options);
}

/** Flood fill (4-connected): everything joined to (x, y) with the same index becomes `color`. */
export function floodFill(c: PixelCanvas, x: number, y: number, color: ColorArg): PixelCanvas {
  if (!inBounds(c, x, y)) {
    throw new PixelError(
      'OUT_OF_BOUNDS',
      `(${x}, ${y}) is outside the ${c.width} x ${c.height} canvas.`,
    );
  }
  const r = resolveColor(c, color);
  const target = c.pixels[y * c.width + x] as number;
  if (target === r.index) return r.canvas === c ? c : { ...r.canvas, pixels: c.pixels };
  const pixels = c.pixels.slice();
  const stack: number[] = [y * c.width + x];
  while (stack.length > 0) {
    const at = stack.pop() as number;
    if (pixels[at] !== target) continue;
    pixels[at] = r.index;
    const px = at % c.width;
    const py = (at - px) / c.width;
    if (px > 0) stack.push(at - 1);
    if (px < c.width - 1) stack.push(at + 1);
    if (py > 0) stack.push(at - c.width);
    if (py < c.height - 1) stack.push(at + c.width);
  }
  return { ...r.canvas, pixels };
}

export function clearCanvas(c: PixelCanvas): PixelCanvas {
  return { ...c, pixels: new Array<number>(c.width * c.height).fill(0) };
}

/** The cells a point draws when mirroring is on (itself, and its reflections). */
export function mirrorPoints(
  c: PixelCanvas,
  points: readonly (readonly [number, number])[],
  mirror: { x?: boolean; y?: boolean },
): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of points) {
    out.push([x, y]);
    if (mirror.x) out.push([c.width - 1 - x, y]);
    if (mirror.y) out.push([x, c.height - 1 - y]);
    if (mirror.x && mirror.y) out.push([c.width - 1 - x, c.height - 1 - y]);
  }
  return out;
}

/** Writes `index` at the given cells (clipped to the canvas). The editor's pencil and eraser. */
export function paintPoints(
  c: PixelCanvas,
  points: Iterable<readonly [number, number]>,
  index: number,
): PixelCanvas {
  if (!Number.isInteger(index) || index < 0 || index >= c.palette.length) {
    throw new PixelError('BAD_INDEX', `Palette index ${index} does not exist.`);
  }
  return paint(c, points, index, { clip: true });
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/**
 * Replaces the palette with `colors` (after transparent). Pixels keep their indices; any pixel
 * whose index no longer exists becomes transparent, and `dropped` says how many that was.
 */
export function setPalette(
  c: PixelCanvas,
  colors: readonly unknown[],
): { canvas: PixelCanvas; dropped: number } {
  const palette = checkPalette(colors);
  let dropped = 0;
  const pixels = c.pixels.map((p) => {
    if (p >= palette.length) {
      dropped += 1;
      return 0;
    }
    return p;
  });
  return { canvas: { ...c, palette, pixels }, dropped };
}

/** Changes one palette colour (index 1 or more); every pixel using it changes with it. */
export function setPaletteColor(c: PixelCanvas, index: number, hex: string): PixelCanvas {
  if (!Number.isInteger(index) || index < 1 || index >= c.palette.length) {
    throw new PixelError(
      'BAD_INDEX',
      `Palette index ${index} cannot be changed (1 to ${c.palette.length - 1}).`,
    );
  }
  const color = normalizeHex(hex);
  if (color === null)
    throw new PixelError('BAD_COLOR', `"${hex}" is not a hex colour like "#FF8800".`);
  const palette = c.palette.slice();
  palette[index] = color;
  return { ...c, palette };
}

/** Adds a colour to the end of the palette (or finds it if it is already there). */
export function addPaletteColor(
  c: PixelCanvas,
  hex: string,
): { canvas: PixelCanvas; index: number } {
  return resolveColor(c, hex);
}

// ---------------------------------------------------------------------------
// Text grid (what the AI reads and writes)
// ---------------------------------------------------------------------------

export interface CanvasText {
  width: number;
  height: number;
  /** One string per row, one character per pixel. */
  rows: string[];
  /** Character to meaning: "." is transparent, the others are hex colours. */
  legend: Record<string, string>;
  /** Colours in the palette that no pixel uses. */
  unused: string[];
}

export function toText(c: PixelCanvas): CanvasText {
  const rows: string[] = [];
  const used = new Set<number>();
  for (let y = 0; y < c.height; y += 1) {
    let row = '';
    for (let x = 0; x < c.width; x += 1) {
      const p = c.pixels[y * c.width + x] as number;
      used.add(p);
      row += glyphOf(p);
    }
    rows.push(row);
  }
  const legend: Record<string, string> = { '.': 'transparent' };
  c.palette.forEach((hex, i) => {
    if (i > 0) legend[glyphOf(i)] = hex;
  });
  const unused = c.palette.flatMap((_hex, i) => (i > 0 && !used.has(i) ? [glyphOf(i)] : []));
  return { width: c.width, height: c.height, rows, legend, unused };
}

/**
 * Replaces the whole canvas from text rows. `.` (or a space) is transparent; other characters are
 * palette indices as in `toText`. Rows must all be the same length; the canvas takes their size.
 * Pass `colors` to set the palette in the same call (otherwise the current palette is kept).
 */
export function fromRows(
  c: PixelCanvas,
  rows: readonly string[],
  colors?: readonly unknown[],
): PixelCanvas {
  if (rows.length === 0) throw new PixelError('BAD_GRID', 'The grid has no rows.');
  const width = (rows[0] as string).length;
  const [w, h] = checkSize(width, rows.length);
  const palette = colors === undefined ? c.palette : checkPalette(colors);
  const pixels = new Array<number>(w * h).fill(0);
  for (let y = 0; y < h; y += 1) {
    const row = rows[y] as string;
    if (row.length !== w) {
      throw new PixelError(
        'BAD_GRID',
        `Row ${y + 1} is ${row.length} characters long but row 1 is ${w}. Every row must be the same length.`,
      );
    }
    for (let x = 0; x < w; x += 1) {
      const ch = row[x] as string;
      const index = ch === ' ' || ch === '_' ? 0 : GLYPHS.indexOf(ch);
      if (index < 0) {
        throw new PixelError(
          'BAD_GRID',
          `Row ${y + 1}, column ${x + 1}: "${ch}" is not a pixel character. Use "." for transparent and 1-9, a-z, A-Z for palette colours.`,
        );
      }
      if (index >= palette.length) {
        throw new PixelError(
          'BAD_INDEX',
          `Row ${y + 1}, column ${x + 1}: "${ch}" is palette colour ${index}, but the palette only has colours 1 to ${palette.length - 1}. Set the palette first or pass colors.`,
        );
      }
      pixels[y * w + x] = index;
    }
  }
  return { width: w, height: h, palette, pixels };
}

// ---------------------------------------------------------------------------
// Resize, export and files
// ---------------------------------------------------------------------------

/** A new size, keeping what fits (the top-left corner stays put). */
export function resizeCanvas(c: PixelCanvas, width: number, height: number): PixelCanvas {
  const [w, h] = checkSize(width, height);
  const pixels = new Array<number>(w * h).fill(0);
  for (let y = 0; y < Math.min(h, c.height); y += 1) {
    for (let x = 0; x < Math.min(w, c.width); x += 1) {
      pixels[y * w + x] = c.pixels[y * c.width + x] as number;
    }
  }
  return { ...c, width: w, height: h, pixels };
}

/** RGBA bytes for a PNG: each pixel is drawn as a `scale` x `scale` block (whole numbers, 1 to 64). */
export function toRgba(
  c: PixelCanvas,
  scale = 1,
): { width: number; height: number; data: Uint8ClampedArray } {
  if (!Number.isInteger(scale) || scale < 1 || scale > 64) {
    throw new PixelError('BAD_SIZE', 'The scale must be a whole number from 1 to 64.');
  }
  const width = c.width * scale;
  const height = c.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  const rgb = c.palette.map((hex, i) => (i === 0 ? null : hexToRgb(hex)));
  for (let y = 0; y < height; y += 1) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < width; x += 1) {
      const color = rgb[c.pixels[sy * c.width + Math.floor(x / scale)] as number];
      if (!color) continue;
      const o = (y * width + x) * 4;
      data[o] = color[0];
      data[o + 1] = color[1];
      data[o + 2] = color[2];
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** The project file: `{ width, height, palette, pixels }`. */
export function serializePixelFile(c: PixelCanvas): string {
  return JSON.stringify(
    { width: c.width, height: c.height, palette: c.palette, pixels: c.pixels },
    null,
    0,
  );
}

/** Checks a canvas read from a file, the document or an AI call. Throws `PixelError` ("BAD_FILE"). */
export function validateCanvas(input: unknown): PixelCanvas {
  const bad = (message: string): never => {
    throw new PixelError('BAD_FILE', message);
  };
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return bad('A pixel art file is an object with width, height, palette and pixels.');
  }
  const v = input as Record<string, unknown>;
  try {
    checkSize(v.width, v.height);
  } catch (e) {
    return bad(e instanceof Error ? e.message : 'Bad size.');
  }
  const width = v.width as number;
  const height = v.height as number;
  if (!Array.isArray(v.palette) || v.palette.length < 1 || v.palette.length > MAX_PALETTE) {
    return bad(`palette must be a list of 1 to ${MAX_PALETTE} colours (the first is transparent).`);
  }
  const palette: string[] = [TRANSPARENT];
  for (const [i, entry] of v.palette.entries()) {
    if (i === 0) continue; // index 0 is always transparent, whatever the file says
    const hex = normalizeHex(entry);
    if (hex === null) return bad(`palette[${i}] is not a hex colour like "#FF8800".`);
    palette.push(hex);
  }
  if (!Array.isArray(v.pixels) || v.pixels.length !== width * height) {
    return bad(`pixels must be a list of exactly ${width * height} numbers (width x height).`);
  }
  for (const [i, p] of v.pixels.entries()) {
    if (!Number.isInteger(p) || (p as number) < 0 || (p as number) >= palette.length) {
      return bad(
        `pixels[${i}] is ${JSON.stringify(p)}, which is not a palette index (0 to ${palette.length - 1}).`,
      );
    }
  }
  return { width, height, palette, pixels: v.pixels as number[] };
}

export function parsePixelFile(text: string): PixelCanvas {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PixelError('BAD_FILE', 'That file is not valid JSON.');
  }
  return validateCanvas(parsed);
}

// ---------------------------------------------------------------------------
// What the editor's tools do (pure, so they are tested without a screen)
// ---------------------------------------------------------------------------

export type ShapeTool = 'line' | 'rect' | 'rectFilled';

export interface Cell {
  x: number;
  y: number;
}

/** The cells a line or rectangle tool covers between where the drag started and where it is now. */
export function shapePoints(tool: ShapeTool, a: Cell, b: Cell): [number, number][] {
  return tool === 'line'
    ? linePoints(a.x, a.y, b.x, b.y)
    : rectPoints(a.x, a.y, b.x, b.y, tool === 'rectFilled');
}

/** Paints cells (and their mirror images) with a palette index, ignoring anything off the canvas. */
export function applyBrush(
  c: PixelCanvas,
  points: readonly (readonly [number, number])[],
  index: number,
  mirror: { x?: boolean; y?: boolean } = {},
): PixelCanvas {
  return paintPoints(c, mirrorPoints(c, points, mirror), index);
}

/** The eyedropper: the palette index under a cell, or null off the canvas. */
export function pickIndex(c: PixelCanvas, x: number, y: number): number | null {
  return inBounds(c, x, y) ? (c.pixels[y * c.width + x] as number) : null;
}

/**
 * Removes a palette colour: its pixels become transparent and the colours after it move up one
 * (their pixels follow), so no gap is left.
 */
export function removePaletteColor(c: PixelCanvas, index: number): PixelCanvas {
  if (!Number.isInteger(index) || index < 1 || index >= c.palette.length) {
    throw new PixelError(
      'BAD_INDEX',
      `Palette index ${index} cannot be removed (1 to ${c.palette.length - 1}).`,
    );
  }
  const palette = c.palette.filter((_, i) => i !== index);
  const pixels = c.pixels.map((p) => (p === index ? 0 : p > index ? p - 1 : p));
  return { ...c, palette, pixels };
}

/** A canvas as a flat list of used colours' counts, for the palette panel ("how much of each"). */
export function colorUsage(c: PixelCanvas): number[] {
  const counts = new Array<number>(c.palette.length).fill(0);
  for (const p of c.pixels) counts[p] = (counts[p] as number) + 1;
  return counts;
}
