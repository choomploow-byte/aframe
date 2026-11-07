import { describe, expect, it } from 'vitest';
import { normalizeHexInput, parseHex, readableOn, toHex } from './color';

describe('hex colours', () => {
  it('parses 3, 4, 6 and 8 digit forms', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHex('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 0.53 });
    expect(parseHex('#C96442')).toEqual({ r: 201, g: 100, b: 66, a: 1 });
    expect(parseHex('#C9644280')).toEqual({ r: 201, g: 100, b: 66, a: 0.5 });
    expect(parseHex(' #abc ')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
  });

  it('rejects everything else', () => {
    for (const bad of [
      '',
      '#',
      '#12',
      '#12345',
      '#1234567',
      '#ggg',
      'rgb(1,2,3)',
      '$primary',
      'red',
      '#fff;',
    ]) {
      expect(parseHex(bad), bad).toBeNull();
    }
  });

  it('formats with an alpha channel only when needed, clamping channels', () => {
    expect(toHex({ r: 201, g: 100, b: 66, a: 1 })).toBe('#C96442');
    expect(toHex({ r: 201, g: 100, b: 66, a: 0.5 })).toBe('#C9644280');
    expect(toHex({ r: 300, g: -5, b: 0.4, a: 1 })).toBe('#FF0000');
    expect(toHex({ r: 0, g: 0, b: 0, a: 0 })).toBe('#00000000');
  });

  it('normalises what people type', () => {
    expect(normalizeHexInput('c96442')).toBe('#C96442');
    expect(normalizeHexInput('#FFF')).toBe('#FFFFFF');
    expect(normalizeHexInput('  f00  ')).toBe('#FF0000');
    expect(normalizeHexInput('nope')).toBeNull();
    expect(normalizeHexInput('')).toBeNull();
  });

  it('picks a legible text colour for a swatch', () => {
    expect(readableOn({ r: 255, g: 255, b: 255, a: 1 })).toBe('#000000');
    expect(readableOn({ r: 0, g: 0, b: 0, a: 1 })).toBe('#FFFFFF');
    expect(readableOn({ r: 201, g: 100, b: 66, a: 1 })).toBe('#FFFFFF');
    expect(readableOn({ r: 246, g: 230, b: 223, a: 1 })).toBe('#000000');
  });
});
