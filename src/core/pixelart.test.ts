import { describe, expect, it } from 'vitest';
import {
  addPaletteColor,
  applyBrush,
  colorUsage,
  pickIndex,
  removePaletteColor,
  shapePoints,
  clearCanvas,
  createCanvas,
  drawLine,
  drawRect,
  floodFill,
  fromRows,
  getPixel,
  linePoints,
  mirrorPoints,
  normalizeHex,
  paintPoints,
  parsePixelFile,
  PixelError,
  rectPoints,
  resizeCanvas,
  serializePixelFile,
  setPalette,
  setPaletteColor,
  setPixels,
  toRgba,
  toText,
  validateCanvas,
} from './pixelart';

const rows = (c: ReturnType<typeof createCanvas>): string[] => toText(c).rows;
const fails = (fn: () => unknown, code: string): void => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PixelError);
    expect((e as PixelError).code).toBe(code);
    return;
  }
  throw new Error('should have failed');
};

describe('creating', () => {
  it('makes a transparent canvas with the default palette', () => {
    const c = createCanvas(4, 3);
    expect(c.pixels).toHaveLength(12);
    expect(c.pixels.every((p) => p === 0)).toBe(true);
    expect(c.palette[0]).toBe('#00000000');
    expect(c.palette.length).toBeGreaterThan(8);
  });

  it('accepts 1 to 128 and refuses everything else', () => {
    expect(createCanvas(128, 128).pixels).toHaveLength(16384);
    expect(createCanvas(1, 1).pixels).toHaveLength(1);
    fails(() => createCanvas(129, 8), 'BAD_SIZE');
    fails(() => createCanvas(0, 8), 'BAD_SIZE');
    fails(() => createCanvas(8.5, 8), 'BAD_SIZE');
    fails(() => createCanvas('8' as never, 8), 'BAD_SIZE');
  });

  it('checks the palette: hex only, normalised, at most 61 colours', () => {
    expect(createCanvas(2, 2, ['#abc', '#112233']).palette).toEqual([
      '#00000000',
      '#AABBCC',
      '#112233',
    ]);
    fails(() => createCanvas(2, 2, ['red']), 'BAD_COLOR');
    fails(() => createCanvas(2, 2, new Array(62).fill('#000000')), 'BAD_PALETTE');
    expect(normalizeHex('#FfF')).toBe('#FFFFFF');
    expect(normalizeHex('fff')).toBeNull();
  });
});

describe('setting pixels', () => {
  it('sets by index, by hex (adding it once) and by transparent', () => {
    const base = createCanvas(3, 3, ['#FF0000', '#00FF00']);
    const c = setPixels(base, [
      { x: 0, y: 0, color: 1 },
      { x: 1, y: 0, color: '#00ff00' },
      { x: 2, y: 0, color: '#0000FF' },
      { x: 0, y: 1, color: '#0000ff' },
      { x: 1, y: 1, color: 'transparent' },
    ]);
    expect(rows(c)[0]).toBe('123');
    expect(rows(c)[1]).toBe('3..');
    expect(c.palette).toHaveLength(4);
    expect(base.pixels.every((p) => p === 0)).toBe(true); // the input is untouched
  });

  it('refuses out-of-range pixels and unknown colours with a message that says what to fix', () => {
    const c = createCanvas(4, 4, ['#FF0000']);
    expect(() => setPixels(c, [{ x: 4, y: 0, color: 1 }])).toThrow(/outside the 4 x 4 canvas/);
    expect(() => setPixels(c, [{ x: 0, y: -1, color: 1 }])).toThrow(/Pixel 1/);
    expect(() => setPixels(c, [{ x: 0, y: 0, color: 5 }])).toThrow(/indices 0 to 1/);
    expect(() => setPixels(c, [{ x: 0, y: 0, color: 'blue' }])).toThrow(/hex colour/);
    expect(() => setPixels(c, [{ x: 0.5, y: 0, color: 1 }])).toThrow(PixelError);
  });

  it('clips instead of failing when asked to', () => {
    const c = setPixels(
      createCanvas(2, 2, ['#FF0000']),
      [
        { x: 5, y: 5, color: 1 },
        { x: 1, y: 1, color: 1 },
      ],
      {
        clip: true,
      },
    );
    expect(rows(c)).toEqual(['..', '.1']);
  });

  it('reports a full palette', () => {
    const colors = Array.from(
      { length: 61 },
      (_, i) => `#${(i + 1).toString(16).padStart(6, '0')}`,
    );
    const c = createCanvas(2, 2, colors);
    fails(() => setPixels(c, [{ x: 0, y: 0, color: '#ABCDEF' }]), 'BAD_PALETTE');
  });
});

describe('lines and rectangles', () => {
  it('draws a horizontal, vertical and diagonal line, ends included', () => {
    expect(linePoints(0, 0, 3, 0)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    expect(linePoints(2, 0, 2, 2)).toEqual([
      [2, 0],
      [2, 1],
      [2, 2],
    ]);
    expect(linePoints(0, 0, 2, 2)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(linePoints(3, 0, 0, 0)).toHaveLength(4);
    expect(linePoints(1, 1, 1, 1)).toEqual([[1, 1]]);
  });

  it('draws a shallow line without gaps', () => {
    const pts = linePoints(0, 0, 6, 2);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)).toEqual([6, 2]);
    for (let i = 1; i < pts.length; i += 1) {
      expect(Math.abs((pts[i] as number[])[0]! - (pts[i - 1] as number[])[0]!)).toBeLessThanOrEqual(
        1,
      );
      expect(Math.abs((pts[i] as number[])[1]! - (pts[i - 1] as number[])[1]!)).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it('draws lines and rectangles on the canvas', () => {
    const base = createCanvas(5, 5, ['#FF0000']);
    expect(rows(drawLine(base, 0, 0, 4, 4, 1))).toEqual([
      '1....',
      '.1...',
      '..1..',
      '...1.',
      '....1',
    ]);
    expect(rows(drawRect(base, 1, 1, 3, 3, 1))).toEqual([
      '.....',
      '.111.',
      '.1.1.',
      '.111.',
      '.....',
    ]);
    expect(rows(drawRect(base, 3, 3, 1, 1, 1, true))).toEqual([
      '.....',
      '.111.',
      '.111.',
      '.111.',
      '.....',
    ]);
    expect(rectPoints(0, 0, 0, 0, false)).toEqual([[0, 0]]);
  });

  it('fails when a shape leaves the canvas, and clips on request', () => {
    const base = createCanvas(4, 4, ['#FF0000']);
    expect(() => drawLine(base, 0, 0, 9, 0, 1)).toThrow(/outside/);
    expect(() => drawRect(base, 0, 0, 4, 4, 1)).toThrow(/outside/);
    expect(rows(drawRect(base, 2, 2, 9, 9, 1, true, { clip: true }))[3]).toBe('..11');
  });
});

describe('flood fill', () => {
  it('fills the joined area only', () => {
    const base = fromRows(createCanvas(5, 3, ['#FF0000', '#00FF00']), ['..2..', '..2..', '..2..']);
    const filled = floodFill(base, 0, 0, 1);
    expect(rows(filled)).toEqual(['112..', '112..', '112..']);
  });

  it('is 4-connected: a diagonal gap does not leak', () => {
    const base = fromRows(createCanvas(3, 3, ['#FF0000', '#00FF00']), ['.2.', '2.2', '.2.']);
    const filled = floodFill(base, 1, 1, 1);
    expect(rows(filled)).toEqual(['.2.', '212', '.2.']);
  });

  it('fills a whole blank canvas, and changing to the same colour changes nothing', () => {
    const base = createCanvas(4, 4, ['#FF0000']);
    expect(floodFill(base, 2, 2, 1).pixels.every((p) => p === 1)).toBe(true);
    expect(floodFill(base, 2, 2, 0)).toBe(base);
  });

  it('can fill with a new hex colour, and refuses a start outside the canvas', () => {
    const base = createCanvas(2, 2, []);
    const out = floodFill(base, 0, 0, '#123456');
    expect(out.palette).toEqual(['#00000000', '#123456']);
    fails(() => floodFill(base, 5, 0, '#123456'), 'OUT_OF_BOUNDS');
  });

  it('handles a large canvas without recursion trouble', () => {
    const big = createCanvas(128, 128, ['#FF0000']);
    expect(floodFill(big, 0, 0, 1).pixels.every((p) => p === 1)).toBe(true);
  });
});

describe('mirroring and the editor brush', () => {
  it('reflects points across the vertical and horizontal axes', () => {
    const c = createCanvas(8, 8);
    expect(mirrorPoints(c, [[1, 2]], { x: true })).toEqual([
      [1, 2],
      [6, 2],
    ]);
    expect(mirrorPoints(c, [[1, 2]], { y: true })).toEqual([
      [1, 2],
      [1, 5],
    ]);
    expect(mirrorPoints(c, [[1, 2]], { x: true, y: true })).toHaveLength(4);
    expect(mirrorPoints(c, [[1, 2]], {})).toEqual([[1, 2]]);
  });

  it('paints and clips', () => {
    const c = paintPoints(
      createCanvas(2, 2, ['#FF0000']),
      [
        [0, 0],
        [9, 9],
      ],
      1,
    );
    expect(rows(c)).toEqual(['1.', '..']);
    fails(() => paintPoints(c, [[0, 0]], 7), 'BAD_INDEX');
  });
});

describe('the text grid', () => {
  it('writes rows and a legend, and lists unused colours', () => {
    const c = setPixels(createCanvas(3, 2, ['#FF0000', '#00FF00']), [
      { x: 0, y: 0, color: 1 },
      { x: 2, y: 1, color: 1 },
    ]);
    const t = toText(c);
    expect(t.rows).toEqual(['1..', '..1']);
    expect(t.legend).toEqual({ '.': 'transparent', '1': '#FF0000', '2': '#00FF00' });
    expect(t.unused).toEqual(['2']);
  });

  it('replaces the whole canvas from rows, taking their size', () => {
    const base = createCanvas(2, 2, ['#FF0000', '#00FF00']);
    const c = fromRows(base, ['12.', '.21']);
    expect(c.width).toBe(3);
    expect(c.height).toBe(2);
    expect(rows(c)).toEqual(['12.', '.21']);
    expect(c.palette).toEqual(base.palette);
  });

  it('can set the palette in the same call', () => {
    const c = fromRows(createCanvas(1, 1, []), ['1.'], ['#112233']);
    expect(c.palette).toEqual(['#00000000', '#112233']);
  });

  it('says exactly which row and column is wrong', () => {
    const base = createCanvas(2, 2, ['#FF0000']);
    expect(() => fromRows(base, [])).toThrow(/no rows/);
    expect(() => fromRows(base, ['11', '1'])).toThrow(/Row 2 is 1 characters long but row 1 is 2/);
    expect(() => fromRows(base, ['1?'])).toThrow(/Row 1, column 2: "\?"/);
    expect(() => fromRows(base, ['12'])).toThrow(/Row 1, column 2: "2" is palette colour 2/);
    expect(() => fromRows(base, [`${'.'.repeat(129)}`])).toThrow(/1 to 128/);
  });

  it('round-trips through text', () => {
    let c = createCanvas(6, 6, ['#FF0000', '#00FF00', '#0000FF']);
    c = drawRect(c, 0, 0, 5, 5, 2, false);
    c = drawLine(c, 0, 0, 5, 5, 3);
    expect(fromRows(c, toText(c).rows).pixels).toEqual(c.pixels);
  });

  it('uses letters beyond 9 for big palettes', () => {
    const colors = Array.from(
      { length: 40 },
      (_, i) => `#${(i + 16).toString(16).padStart(2, '0')}0000`,
    );
    const c = setPixels(createCanvas(2, 1, colors), [
      { x: 0, y: 0, color: 10 },
      { x: 1, y: 0, color: 36 },
    ]);
    expect(rows(c)[0]).toBe('aA');
    expect(fromRows(c, ['aA']).pixels).toEqual([10, 36]);
  });
});

describe('palette edits', () => {
  it('replaces the palette and clears pixels whose colour is gone', () => {
    const c = setPixels(createCanvas(3, 1, ['#FF0000', '#00FF00', '#0000FF']), [
      { x: 0, y: 0, color: 1 },
      { x: 1, y: 0, color: 2 },
      { x: 2, y: 0, color: 3 },
    ]);
    const { canvas, dropped } = setPalette(c, ['#111111', '#222222']);
    expect(dropped).toBe(1);
    expect(rows(canvas)[0]).toBe('12.');
  });

  it('changes one colour in place, and adds without duplicating', () => {
    const c = createCanvas(1, 1, ['#FF0000']);
    expect(setPaletteColor(c, 1, '#00ff00').palette[1]).toBe('#00FF00');
    fails(() => setPaletteColor(c, 0, '#00ff00'), 'BAD_INDEX');
    fails(() => setPaletteColor(c, 1, 'nope'), 'BAD_COLOR');
    const added = addPaletteColor(c, '#FF0000');
    expect(added.index).toBe(1);
    expect(addPaletteColor(c, '#0000FF').index).toBe(2);
  });
});

describe('size, export and files', () => {
  it('resizes keeping the top-left', () => {
    const c = setPixels(createCanvas(2, 2, ['#FF0000']), [{ x: 1, y: 1, color: 1 }]);
    expect(rows(resizeCanvas(c, 3, 3))).toEqual(['...', '.1.', '...']);
    expect(rows(resizeCanvas(c, 1, 1))).toEqual(['.']);
    fails(() => resizeCanvas(c, 200, 3), 'BAD_SIZE');
  });

  it('exports RGBA at an integer scale, transparent where index 0', () => {
    const c = setPixels(createCanvas(2, 1, ['#FF8000']), [{ x: 0, y: 0, color: 1 }]);
    const one = toRgba(c, 1);
    expect([...one.data]).toEqual([255, 128, 0, 255, 0, 0, 0, 0]);
    const three = toRgba(c, 3);
    expect(three.width).toBe(6);
    expect(three.height).toBe(3);
    expect(three.data[(2 * 6 + 2) * 4 + 3]).toBe(255);
    expect(three.data[(2 * 6 + 3) * 4 + 3]).toBe(0);
    fails(() => toRgba(c, 0), 'BAD_SIZE');
    fails(() => toRgba(c, 1.5), 'BAD_SIZE');
  });

  it('saves and loads the project file', () => {
    const c = drawRect(createCanvas(4, 4, ['#FF0000']), 0, 0, 3, 3, 1);
    const text = serializePixelFile(c);
    expect(JSON.parse(text)).toEqual({
      width: 4,
      height: 4,
      palette: c.palette,
      pixels: c.pixels,
    });
    expect(parsePixelFile(text)).toEqual(c);
  });

  it('rejects bad files with a reason', () => {
    expect(() => parsePixelFile('{nope')).toThrow(/not valid JSON/);
    expect(() => parsePixelFile('[]')).toThrow(/object/);
    expect(() => validateCanvas({ width: 2, height: 2, palette: ['#000'], pixels: [0] })).toThrow(
      /exactly 4/,
    );
    expect(() =>
      validateCanvas({ width: 2, height: 2, palette: ['#000000'], pixels: [0, 0, 0, 5] }),
    ).toThrow(/pixels\[3\]/);
    expect(() => validateCanvas({ width: 999, height: 2, palette: [], pixels: [] })).toThrow(
      /1 to 128/,
    );
    expect(() =>
      validateCanvas({ width: 1, height: 1, palette: ['#000000', 'blue'], pixels: [0] }),
    ).toThrow(/palette\[1\]/);
  });

  it('clears', () => {
    const c = floodFill(createCanvas(2, 2, ['#FF0000']), 0, 0, 1);
    expect(clearCanvas(c).pixels).toEqual([0, 0, 0, 0]);
    expect(getPixel(c, 1, 1)).toBe(1);
    fails(() => getPixel(c, 2, 0), 'OUT_OF_BOUNDS');
  });
});

describe('what the editor tools do', () => {
  it('builds line and rectangle shapes from two cells', () => {
    expect(shapePoints('line', { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    expect(shapePoints('rect', { x: 0, y: 0 }, { x: 2, y: 2 })).toHaveLength(8);
    expect(shapePoints('rectFilled', { x: 2, y: 2 }, { x: 0, y: 0 })).toHaveLength(9);
  });

  it('paints with mirroring, clipped to the canvas', () => {
    const base = createCanvas(6, 4, ['#FF0000']);
    const out = applyBrush(
      base,
      [
        [1, 1],
        [-3, 0],
      ],
      1,
      { x: true },
    );
    expect(rows(out)).toEqual(['......', '.1..1.', '......', '......']);
    expect(
      applyBrush(base, [[0, 0]], 1, { x: true, y: true }).pixels.filter((p) => p === 1),
    ).toHaveLength(4);
  });

  it('picks the colour under a cell, null off the canvas', () => {
    const c = setPixels(createCanvas(2, 2, ['#FF0000']), [{ x: 1, y: 0, color: 1 }]);
    expect(pickIndex(c, 1, 0)).toBe(1);
    expect(pickIndex(c, 0, 0)).toBe(0);
    expect(pickIndex(c, 2, 0)).toBeNull();
    expect(pickIndex(c, -1, 0)).toBeNull();
  });

  it('removes a colour, shifting the later ones up', () => {
    const c = setPixels(createCanvas(3, 1, ['#111111', '#222222', '#333333']), [
      { x: 0, y: 0, color: 1 },
      { x: 1, y: 0, color: 2 },
      { x: 2, y: 0, color: 3 },
    ]);
    const out = removePaletteColor(c, 2);
    expect(out.palette).toEqual(['#00000000', '#111111', '#333333']);
    expect(rows(out)[0]).toBe('1.2');
    fails(() => removePaletteColor(c, 0), 'BAD_INDEX');
    fails(() => removePaletteColor(c, 9), 'BAD_INDEX');
  });

  it('counts how much of each colour is used', () => {
    const c = setPixels(createCanvas(2, 2, ['#111111']), [{ x: 0, y: 0, color: 1 }]);
    expect(colorUsage(c)).toEqual([3, 1]);
  });
});
