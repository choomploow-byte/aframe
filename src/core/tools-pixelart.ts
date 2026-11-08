/**
 * AI tools for the Pixel Art Editor (a beta feature, see core/beta.ts). They read and change the
 * pixel canvas stored in the document, so the person sees every call land in the open editor and
 * undoes it like any other edit. They exist only while the feature is switched on: the tool server
 * hides them otherwise, and every handler refuses to run if it is called anyway.
 */
import * as z from 'zod/v4';
import { CoreError } from './errors';
import {
  clearCanvas,
  createCanvas,
  drawLine,
  drawRect,
  floodFill,
  fromRows,
  MAX_PALETTE,
  MAX_PIXEL_SIZE,
  PixelError,
  setPalette,
  setPixels,
  toText,
  type PixelCanvas,
} from './pixelart';
import { defineTool, type Tool } from './tool-kit';
import type { Doc, ToolContext } from './types';

export const PIXELART_FEATURE = 'pixelArt' as const;

/** Names of the tools that belong to the feature (hidden when it is off). */
export const PIXELART_TOOL_NAMES: readonly string[] = [
  'pixelart_get_canvas',
  'pixelart_create_canvas',
  'pixelart_set_palette',
  'pixelart_set_pixels',
  'pixelart_draw_line',
  'pixelart_draw_rect',
  'pixelart_fill',
  'pixelart_replace_grid',
  'pixelart_clear',
];

const MAX_PIXELS_PER_CALL = 4096;

/** Refuses to run unless the feature is on. A context that cannot say counts as off. */
async function requireOn(ctx: ToolContext): Promise<void> {
  const on = ctx.betaEnabled === undefined ? false : await ctx.betaEnabled(PIXELART_FEATURE);
  if (!on) {
    throw new CoreError(
      'NOT_FOUND',
      'The Pixel Art Editor is a beta feature and it is switched off, so this tool is not available.',
      'Ask the person to turn it on in Settings > Beta features.',
    );
  }
}

/** Runs a pixel operation, turning a `PixelError` into an error the AI can act on. */
function guarded<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof PixelError) {
      throw new CoreError(
        'INVALID_VALUE',
        e.message,
        e.code === 'OUT_OF_BOUNDS'
          ? 'Coordinates start at 0 in the top-left corner. Call pixelart_get_canvas to see the size.'
          : e.code === 'BAD_INDEX' || e.code === 'BAD_PALETTE'
            ? 'Call pixelart_get_canvas to see the palette, or pass a hex colour like "#FF8800".'
            : undefined,
      );
    }
    throw e;
  }
}

function needCanvas(doc: Doc): PixelCanvas {
  if (doc.pixelArt === undefined) {
    throw new CoreError(
      'NOT_FOUND',
      'There is no pixel art canvas yet.',
      'Create one with pixelart_create_canvas (width, height, and optionally a palette), or ask the person to start one in the Pixel Art view.',
    );
  }
  return doc.pixelArt;
}

async function save(ctx: ToolContext, doc: Doc, next: PixelCanvas, label: string): Promise<number> {
  await ctx.commit({ ...doc, pixelArt: next }, { source: 'agent', label });
  return (await ctx.getDoc()).rev;
}

const colorArg = z
  .union([z.number().int(), z.string()])
  .describe(
    'A palette index (0 is transparent) or a hex colour like "#FF8800" (added to the palette if new)',
  );

/** What every drawing tool returns: a small receipt, not the whole grid. */
function receipt(
  c: PixelCanvas,
  rev: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { rev, width: c.width, height: c.height, paletteSize: c.palette.length - 1, ...extra };
}

const getCanvas = defineTool({
  name: 'pixelart_get_canvas',
  description:
    'Read the pixel art canvas: size, palette and every pixel as compact text rows (one character per pixel: "." is transparent, then 1-9, a-z, A-Z are palette colours; the legend says which colour each character is). Call this first before changing or improving anything, so you work on what is there. Needs the Pixel Art beta feature to be on.',
  inputSchema: z.object({}),
  handler: async (ctx) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    if (doc.pixelArt === undefined) {
      return {
        exists: false,
        hint: 'There is no canvas yet. Create one with pixelart_create_canvas.',
        maxSize: MAX_PIXEL_SIZE,
      };
    }
    return { exists: true, ...toText(doc.pixelArt) };
  },
});

const createCanvasTool = defineTool({
  name: 'pixelart_create_canvas',
  description: `Start a new, empty pixel art canvas (replaces the current one). width and height are 1 to ${MAX_PIXEL_SIZE}; 16, 32 and 64 are typical. palette is a list of hex colours (at most ${MAX_PALETTE - 1}, transparent is always index 0 and is not listed); leave it out for a default 15-colour palette. Prefer a limited palette of 8-16 colours.`,
  inputSchema: z.object({
    width: z.number().int(),
    height: z.number().int(),
    palette: z.array(z.string()).optional().describe('Hex colours, e.g. ["#1A1C2C", "#B13E53"]'),
  }),
  handler: async (ctx, input) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    const canvas = guarded(() => createCanvas(input.width, input.height, input.palette));
    const rev = await save(ctx, doc, canvas, 'AI: new pixel canvas');
    return receipt(canvas, rev, { legend: toText(canvas).legend });
  },
});

const setPaletteTool = defineTool({
  name: 'pixelart_set_palette',
  description: `Replace the palette with these hex colours (index 1 is the first). Pixels keep their index, so changing a colour recolours everything that uses it. If the new palette is shorter, pixels using the removed indices become transparent (dropped says how many). At most ${MAX_PALETTE - 1} colours.`,
  inputSchema: z.object({ colors: z.array(z.string()).max(MAX_PALETTE - 1) }),
  handler: async (ctx, input) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    const out = guarded(() => setPalette(needCanvas(doc), input.colors));
    const rev = await save(ctx, doc, out.canvas, 'AI: palette');
    return receipt(out.canvas, rev, { dropped: out.dropped, legend: toText(out.canvas).legend });
  },
});

const setPixelsTool = defineTool({
  name: 'pixelart_set_pixels',
  description: `Set many pixels in one call: a list of { x, y, color }. x and y start at 0 in the top-left. color is a palette index or a hex colour. Up to ${MAX_PIXELS_PER_CALL} pixels per call. All succeed or none change.`,
  inputSchema: z.object({
    pixels: z
      .array(z.object({ x: z.number().int(), y: z.number().int(), color: colorArg }))
      .min(1)
      .max(MAX_PIXELS_PER_CALL),
  }),
  handler: async (ctx, input) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    const canvas = guarded(() => setPixels(needCanvas(doc), input.pixels));
    const rev = await save(ctx, doc, canvas, 'AI: set pixels');
    return receipt(canvas, rev, { set: input.pixels.length });
  },
});

const drawLineTool = defineTool({
  name: 'pixelart_draw_line',
  description:
    'Draw a 1-pixel line from (x0, y0) to (x1, y1), both ends included. Both points must be on the canvas.',
  inputSchema: z.object({
    x0: z.number().int(),
    y0: z.number().int(),
    x1: z.number().int(),
    y1: z.number().int(),
    color: colorArg,
  }),
  handler: async (ctx, i) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    const canvas = guarded(() => drawLine(needCanvas(doc), i.x0, i.y0, i.x1, i.y1, i.color));
    return receipt(canvas, await save(ctx, doc, canvas, 'AI: line'));
  },
});

const drawRectTool = defineTool({
  name: 'pixelart_draw_rect',
  description:
    'Draw a rectangle between two corners (any order): an outline, or filled with filled: true.',
  inputSchema: z.object({
    x0: z.number().int(),
    y0: z.number().int(),
    x1: z.number().int(),
    y1: z.number().int(),
    color: colorArg,
    filled: z.boolean().optional(),
  }),
  handler: async (ctx, i) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    const canvas = guarded(() =>
      drawRect(needCanvas(doc), i.x0, i.y0, i.x1, i.y1, i.color, i.filled === true),
    );
    return receipt(canvas, await save(ctx, doc, canvas, 'AI: rectangle'));
  },
});

const fillTool = defineTool({
  name: 'pixelart_fill',
  description:
    'Flood fill: every pixel joined (up, down, left, right) to (x, y) that has the same colour becomes the new colour.',
  inputSchema: z.object({ x: z.number().int(), y: z.number().int(), color: colorArg }),
  handler: async (ctx, i) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    const canvas = guarded(() => floodFill(needCanvas(doc), i.x, i.y, i.color));
    return receipt(canvas, await save(ctx, doc, canvas, 'AI: fill'));
  },
});

const replaceGridTool = defineTool({
  name: 'pixelart_replace_grid',
  description:
    'Replace the whole canvas from text rows, to draw a complete image in one go. One string per row, one character per pixel, all rows the same length (the canvas takes that size, up to 128 x 128). "." is transparent; 1-9, a-z, A-Z are palette colours (as pixelart_get_canvas shows). Pass palette (hex colours) to set the palette in the same call; otherwise the current palette is kept and every character must exist in it. Use a limited palette (8-16 colours), a clean 1-pixel outline, no anti-aliasing, a consistent light direction.',
  inputSchema: z.object({
    rows: z.array(z.string()).min(1).max(MAX_PIXEL_SIZE),
    palette: z
      .array(z.string())
      .max(MAX_PALETTE - 1)
      .optional(),
  }),
  handler: async (ctx, i) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    const base = doc.pixelArt ?? guarded(() => createCanvas(1, 1));
    const canvas = guarded(() => fromRows(base, i.rows, i.palette));
    const rev = await save(ctx, doc, canvas, 'AI: replace pixel art');
    return receipt(canvas, rev, { legend: toText(canvas).legend });
  },
});

const clearTool = defineTool({
  name: 'pixelart_clear',
  description: 'Make every pixel transparent. The size and palette stay.',
  inputSchema: z.object({}),
  handler: async (ctx) => {
    await requireOn(ctx);
    const doc = await ctx.getDoc();
    const canvas = clearCanvas(needCanvas(doc));
    return receipt(canvas, await save(ctx, doc, canvas, 'AI: clear pixel art'));
  },
});

export const PIXELART_TOOLS: readonly Tool[] = [
  getCanvas,
  createCanvasTool,
  setPaletteTool,
  setPixelsTool,
  drawLineTool,
  drawRectTool,
  fillTool,
  replaceGridTool,
  clearTool,
];

/** The instructions the pixel art editor gives the AI along with the usual ones. */
export const PIXELART_PROMPT = `You are helping with pixel art on a small grid. Always call pixelart_get_canvas first so you work on what is already there; do not guess. Rules for good pixel art:
- Use a limited palette: 8 to 16 colours in total. Reuse colours instead of adding near-duplicates.
- Keep outlines clean and exactly 1 pixel wide. Avoid stray single pixels (jaggies) along edges.
- No anti-aliasing and no gradients: shade with flat bands of 2 to 4 tones per material, and use dithering sparingly.
- Pick one light direction (for example from the top left) and keep it for every shape.
- Keep the shapes readable at the grid's size: simplify instead of adding detail.
- Preserve the person's existing work unless they ask you to change it. For "improve", "add shading" or "clean up", change only what that needs.
- Prefer pixelart_replace_grid to draw a whole image in one call (rows of characters), and pixelart_set_pixels, pixelart_draw_line, pixelart_draw_rect or pixelart_fill for edits. All coordinates start at 0 in the top-left corner. If a call fails, read the message, fix the input and try again.
When you are done, say in one or two sentences what you changed.`;
