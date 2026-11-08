import { describe, expect, it } from 'vitest';
import { bumpRev, createEmptyDoc } from './doc';
import { PIXELART_TOOL_NAMES } from './tools-pixelart';
import { runTool, TOOLS } from './tools';
import type { Doc, ToolContext } from './types';

function memory(on = true): { ctx: ToolContext; doc: () => Doc; commits: () => number } {
  let doc = createEmptyDoc();
  let commits = 0;
  const ctx: ToolContext = {
    getDoc: () => doc,
    commit: (next) => {
      commits += 1;
      doc = bumpRev(next, 'mcp');
    },
    betaEnabled: (f) => on && f === 'pixelArt',
  };
  return { ctx, doc: () => doc, commits: () => commits };
}

const ok = async (
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<Record<string, unknown>> => {
  const r = await runTool(ctx, name, input);
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
  return r.data as Record<string, unknown>;
};
const fail = async (ctx: ToolContext, name: string, input: unknown) => {
  const r = await runTool(ctx, name, input);
  if (r.ok) throw new Error(`${name} should have failed`);
  return r.error;
};

describe('the beta switch', () => {
  it('every pixel art tool refuses to run while the feature is off, and changes nothing', async () => {
    const { ctx, doc, commits } = memory(false);
    for (const name of PIXELART_TOOL_NAMES) {
      const e = await fail(
        ctx,
        name,
        name === 'pixelart_create_canvas' ? { width: 8, height: 8 } : {},
      );
      expect(['NOT_FOUND', 'INVALID_VALUE']).toContain(e.code);
    }
    expect((await fail(ctx, 'pixelart_get_canvas', {})).message).toMatch(/beta feature/);
    expect(commits()).toBe(0);
    expect(doc().pixelArt).toBeUndefined();
  });

  it('a context that cannot say counts as off', async () => {
    const bare: ToolContext = { getDoc: () => createEmptyDoc(), commit: () => undefined };
    expect((await fail(bare, 'pixelart_get_canvas', {})).code).toBe('NOT_FOUND');
  });

  it('the tool list names exactly the pixel art tools', () => {
    const names = TOOLS.filter((t) => t.name.startsWith('pixelart_')).map((t) => t.name);
    expect(names.sort()).toEqual([...PIXELART_TOOL_NAMES].sort());
  });
});

describe('reading and creating', () => {
  it('says there is no canvas yet, then creates one', async () => {
    const { ctx, doc } = memory();
    expect(await ok(ctx, 'pixelart_get_canvas', {})).toMatchObject({ exists: false });
    const made = await ok(ctx, 'pixelart_create_canvas', {
      width: 8,
      height: 4,
      palette: ['#ff0000', '#00ff00'],
    });
    expect(made).toMatchObject({ width: 8, height: 4, paletteSize: 2 });
    expect(doc().pixelArt?.palette).toEqual(['#00000000', '#FF0000', '#00FF00']);
    const got = await ok(ctx, 'pixelart_get_canvas', {});
    expect(got).toMatchObject({ exists: true, width: 8, height: 4 });
    expect(got.rows).toEqual(new Array(4).fill('........'));
    expect(got.legend).toEqual({ '.': 'transparent', '1': '#FF0000', '2': '#00FF00' });
  });

  it('refuses a bad size or palette with a message that says what to do', async () => {
    const { ctx, doc } = memory();
    expect((await fail(ctx, 'pixelart_create_canvas', { width: 200, height: 8 })).message).toMatch(
      /1 to 128/,
    );
    expect(
      (await fail(ctx, 'pixelart_create_canvas', { width: 8, height: 8, palette: ['red'] }))
        .message,
    ).toMatch(/hex colour/);
    expect((await fail(ctx, 'pixelart_create_canvas', { width: 1.5, height: 8 })).code).toBe(
      'INVALID_VALUE',
    );
    expect(doc().pixelArt).toBeUndefined();
  });
});

describe('drawing', () => {
  async function started() {
    const m = memory();
    await ok(m.ctx, 'pixelart_create_canvas', {
      width: 8,
      height: 8,
      palette: ['#ff0000', '#00ff00'],
    });
    return m;
  }
  const rows = async (ctx: ToolContext): Promise<string[]> =>
    (await ok(ctx, 'pixelart_get_canvas', {})).rows as string[];

  it('sets pixels in a batch, by index and by hex', async () => {
    const { ctx } = await started();
    await ok(ctx, 'pixelart_set_pixels', {
      pixels: [
        { x: 0, y: 0, color: 1 },
        { x: 7, y: 7, color: '#0000ff' },
        { x: 1, y: 0, color: 2 },
      ],
    });
    const r = await rows(ctx);
    expect(r[0]).toBe('12......');
    expect(r[7]).toBe('.......3');
  });

  it('draws lines, rectangles and fills', async () => {
    const { ctx } = await started();
    await ok(ctx, 'pixelart_draw_rect', { x0: 1, y0: 1, x1: 6, y1: 6, color: 1 });
    await ok(ctx, 'pixelart_draw_line', { x0: 0, y0: 7, x1: 7, y1: 7, color: 2 });
    await ok(ctx, 'pixelart_fill', { x: 3, y: 3, color: 2 });
    const r = await rows(ctx);
    expect(r[1]).toBe('.111111.');
    expect(r[3]).toBe('.122221.');
    expect(r[7]).toBe('22222222');
  });

  it('replaces the whole grid and can set the palette in the same call', async () => {
    const { ctx, doc } = await started();
    await ok(ctx, 'pixelart_replace_grid', {
      rows: ['.1.', '121', '.1.'],
      palette: ['#aa0000', '#00aa00'],
    });
    expect(doc().pixelArt).toMatchObject({ width: 3, height: 3 });
    expect(await rows(ctx)).toEqual(['.1.', '121', '.1.']);
    expect(doc().pixelArt?.palette).toEqual(['#00000000', '#AA0000', '#00AA00']);
  });

  it('can draw on a project that has no canvas yet with replace_grid', async () => {
    const { ctx } = memory();
    await ok(ctx, 'pixelart_replace_grid', { rows: ['.1', '1.'], palette: ['#123456'] });
    expect(await rows(ctx)).toEqual(['.1', '1.']);
  });

  it('sets a palette, reporting what was dropped, and clears', async () => {
    const { ctx } = await started();
    await ok(ctx, 'pixelart_set_pixels', { pixels: [{ x: 0, y: 0, color: 2 }] });
    const out = await ok(ctx, 'pixelart_set_palette', { colors: ['#112233'] });
    expect(out.dropped).toBe(1);
    await ok(ctx, 'pixelart_set_pixels', { pixels: [{ x: 1, y: 1, color: 1 }] });
    await ok(ctx, 'pixelart_clear', {});
    expect((await rows(ctx)).every((r) => r === '........')).toBe(true);
  });

  it('every call is one commit, and a failing call changes nothing', async () => {
    const { ctx, doc, commits } = await started();
    const before = commits();
    await ok(ctx, 'pixelart_draw_line', { x0: 0, y0: 0, x1: 3, y1: 3, color: 1 });
    expect(commits()).toBe(before + 1);
    const snapshot = JSON.stringify(doc().pixelArt);
    await fail(ctx, 'pixelart_draw_line', { x0: 0, y0: 0, x1: 99, y1: 3, color: 1 });
    await fail(ctx, 'pixelart_set_pixels', {
      pixels: [
        { x: 0, y: 0, color: 1 },
        { x: 8, y: 0, color: 1 },
      ],
    });
    expect(commits()).toBe(before + 1);
    expect(JSON.stringify(doc().pixelArt)).toBe(snapshot);
  });
});

describe('input validation', () => {
  async function started() {
    const m = memory();
    await ok(m.ctx, 'pixelart_create_canvas', { width: 4, height: 4, palette: ['#ff0000'] });
    return m;
  }

  it('names the bounds when a pixel is outside', async () => {
    const { ctx } = await started();
    const e = await fail(ctx, 'pixelart_set_pixels', { pixels: [{ x: 4, y: 0, color: 1 }] });
    expect(e.message).toMatch(/Pixel 1.*outside the 4 x 4 canvas/);
    expect(e.hint).toMatch(/start at 0/);
  });

  it('names the palette when an index does not exist', async () => {
    const { ctx } = await started();
    const e = await fail(ctx, 'pixelart_fill', { x: 0, y: 0, color: 9 });
    expect(e.message).toMatch(/indices 0 to 1/);
    expect(e.hint).toMatch(/pixelart_get_canvas/);
  });

  it('rejects wrong types, empty lists and too many pixels before touching anything', async () => {
    const { ctx } = await started();
    expect((await fail(ctx, 'pixelart_set_pixels', { pixels: [] })).code).toBe('INVALID_VALUE');
    expect(
      (await fail(ctx, 'pixelart_set_pixels', { pixels: [{ x: '1', y: 0, color: 1 }] })).code,
    ).toBe('INVALID_VALUE');
    expect(
      (
        await fail(ctx, 'pixelart_set_pixels', {
          pixels: new Array(5000).fill({ x: 0, y: 0, color: 1 }),
        })
      ).code,
    ).toBe('INVALID_VALUE');
    expect((await fail(ctx, 'pixelart_draw_line', { x0: 0, y0: 0 })).code).toBe('INVALID_VALUE');
    expect(
      (await fail(ctx, 'pixelart_set_palette', { colors: new Array(62).fill('#000000') })).code,
    ).toBe('INVALID_VALUE');
  });

  it('points at the mistake in a text grid', async () => {
    const { ctx } = await started();
    expect((await fail(ctx, 'pixelart_replace_grid', { rows: ['11', '1'] })).message).toMatch(
      /Row 2 is 1 characters/,
    );
    expect((await fail(ctx, 'pixelart_replace_grid', { rows: ['1Z'] })).message).toMatch(
      /Row 1, column 2/,
    );
    expect((await fail(ctx, 'pixelart_replace_grid', { rows: ['1#'] })).message).toMatch(
      /not a pixel character/,
    );
  });

  it('says to create a canvas first', async () => {
    const { ctx } = memory();
    const e = await fail(ctx, 'pixelart_draw_line', {
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 1,
      color: '#ff0000',
    });
    expect(e.code).toBe('NOT_FOUND');
    expect(e.hint).toMatch(/pixelart_create_canvas/);
  });
});
