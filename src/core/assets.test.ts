import { describe, expect, it } from 'vitest';
import {
  addAsset,
  addReference,
  assetInfo,
  assetUsage,
  base64ToBytes,
  bytesToBase64,
  imageNodeSpec,
  MAX_IMAGE_BYTES,
  removeAsset,
  removeReference,
  sniffImage,
} from './assets';
import { CoreError } from './errors';
import { seededRng } from './ids';
import { sampleDoc } from './testing';

const bytes = (...n: number[]): Uint8Array => Uint8Array.from(n);
const text = (s: string): Uint8Array => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

/** Minimal headers: just enough bytes for the sniffers. */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
function gif(w: number, h: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set(text('GIF89a'));
  new DataView(b.buffer).setUint16(6, w, true);
  new DataView(b.buffer).setUint16(8, h, true);
  return b;
}
function jpeg(w: number, h: number): Uint8Array {
  // SOI, an APP0 segment to skip, then SOF0.
  const b = new Uint8Array(40);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const sof = 2 + 2 + 16; // APP0: marker (2) + length field (2) + 14 data bytes
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], sof);
  new DataView(b.buffer).setUint16(sof + 5, h);
  new DataView(b.buffer).setUint16(sof + 7, w);
  return b;
}
function webp(kind: 'VP8 ' | 'VP8L' | 'VP8X', w: number, h: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set(text('RIFF'));
  b.set(text('WEBP'), 8);
  b.set(text(kind), 12);
  const dv = new DataView(b.buffer);
  if (kind === 'VP8 ') {
    dv.setUint16(26, w, true);
    dv.setUint16(28, h, true);
  } else if (kind === 'VP8L') {
    const bits = (w - 1) | ((h - 1) << 14);
    dv.setUint32(21, bits >>> 0, true);
  } else {
    dv.setUint16(24, (w - 1) & 0xffff, true);
    b[26] = ((w - 1) >> 16) & 255;
    dv.setUint16(27, (h - 1) & 0xffff, true);
    b[29] = ((h - 1) >> 16) & 255;
  }
  return b;
}

describe('base64', () => {
  it('round-trips every length remainder', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 100]) {
      const data = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
      expect(base64ToBytes(bytesToBase64(data))).toEqual(data);
    }
    expect(bytesToBase64(text('Man'))).toBe('TWFu');
    expect(bytesToBase64(text('Ma'))).toBe('TWE=');
    expect(bytesToBase64(text('M'))).toBe('TQ==');
  });

  it('rejects anything that is not canonical base64', () => {
    for (const bad of ['abc', 'ab=c', '@@@@', 'TQ=A', 'TWFué'])
      expect(base64ToBytes(bad)).toBeNull();
    expect(base64ToBytes('TW Fu\n')).toEqual(text('Man')); // whitespace is tolerated
  });
});

describe('sniffImage', () => {
  it('identifies formats and reads sizes', () => {
    expect(sniffImage(png(640, 480))).toEqual({ mime: 'image/png', width: 640, height: 480 });
    expect(sniffImage(gif(32, 16))).toEqual({ mime: 'image/gif', width: 32, height: 16 });
    expect(sniffImage(jpeg(800, 600))).toEqual({ mime: 'image/jpeg', width: 800, height: 600 });
    expect(sniffImage(webp('VP8 ', 120, 90))).toEqual({
      mime: 'image/webp',
      width: 120,
      height: 90,
    });
    expect(sniffImage(webp('VP8L', 300, 200))).toEqual({
      mime: 'image/webp',
      width: 300,
      height: 200,
    });
    expect(sniffImage(webp('VP8X', 1000, 500))).toEqual({
      mime: 'image/webp',
      width: 1000,
      height: 500,
    });
  });

  it('accepts SVG text, with or without a prolog or comments', () => {
    for (const svg of [
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      '<?xml version="1.0"?>\n<svg width="1">',
      '  <!-- logo -->\n<SVG viewBox="0 0 1 1">',
    ]) {
      expect(sniffImage(text(svg)), svg).toEqual({
        mime: 'image/svg+xml',
        width: null,
        height: null,
      });
    }
  });

  it('refuses everything else, however it is named', () => {
    for (const bad of [
      text('<html><svg></svg></html>'),
      text('#!/bin/sh\nrm -rf /'),
      text('MZ\u0090\u0000'),
      bytes(0x89, 0x50, 0x4e, 0x47), // truncated PNG
      bytes(),
      text('GIF'),
      png(1, 1).subarray(0, 10),
    ]) {
      expect(sniffImage(bad)).toBeNull();
    }
  });

  it('tolerates a JPEG or WebP whose size cannot be read', () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      mime: 'image/jpeg',
      width: null,
      height: null,
    });
    const odd = webp('VP8 ', 1, 1);
    odd.set(text('XXXX'), 12);
    expect(sniffImage(odd)).toEqual({ mime: 'image/webp', width: null, height: null });
  });
});

describe('addAsset', () => {
  it('stores a data URL under a fresh image id and reports the image info', () => {
    const doc = sampleDoc();
    const res = addAsset(doc, png(10, 20), seededRng(1));
    expect(res.assetId).toMatch(/^img_[a-z0-9]{5}$/);
    expect(res.info).toMatchObject({ mime: 'image/png', width: 10, height: 20 });
    expect(res.doc.assets[res.assetId]).toMatch(/^data:image\/png;base64,/);
    expect(doc.assets).toEqual({}); // input untouched
    expect(res.doc.nodes).toBe(doc.nodes);
  });

  it('never reuses an existing asset id', () => {
    let doc = sampleDoc();
    const ids = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const res = addAsset(doc, png(1, 1), () => 0.25);
      expect(ids.has(res.assetId)).toBe(false);
      ids.add(res.assetId);
      doc = res.doc;
    }
  });

  it('rejects non-images and oversize files with actionable errors', () => {
    const doc = sampleDoc();
    expect(() => addAsset(doc, text('hello'))).toThrow(CoreError);
    try {
      addAsset(doc, text('hello'));
    } catch (e) {
      expect((e as CoreError).code).toBe('INVALID_VALUE');
      expect((e as CoreError).hint).toMatch(/PNG/);
    }
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(png(1, 1));
    expect(() => addAsset(doc, big)).toThrow(/limit is 20 MB/);
  });
});

describe('assetInfo', () => {
  it('reads back what addAsset stored, and null for missing or corrupt assets', () => {
    const { doc, assetId } = addAsset(sampleDoc(), png(64, 32), seededRng(5));
    expect(assetInfo(doc, assetId)).toEqual({ mime: 'image/png', width: 64, height: 32 });
    expect(assetInfo(doc, 'img_nope1')).toBeNull();
    expect(
      assetInfo({ ...doc, assets: { [assetId]: 'data:image/png;base64,@@@@' } }, assetId),
    ).toBeNull();
    expect(
      assetInfo({ ...doc, assets: { [assetId]: 'https://evil.test/x.png' } }, assetId),
    ).toBeNull();
  });
});

describe('usage, removal and references', () => {
  const withImage = () => {
    const { doc, assetId } = addAsset(sampleDoc(), png(100, 50), seededRng(2));
    return { doc, assetId };
  };

  it('finds where an asset is used and refuses to remove a used one', () => {
    const { doc, assetId } = withImage();
    const used = {
      ...doc,
      nodes: {
        ...doc.nodes,
        n_pic01: { ...doc.nodes.n_other!, id: 'n_pic01', type: 'image' as const, assetId },
      },
    };
    expect(assetUsage(used, assetId)).toEqual({ nodes: ['n_pic01'], references: [] });
    expect(() => removeAsset(used, assetId)).toThrow(/still used/);
    expect(() => removeAsset(doc, 'img_nope1')).toThrow(/does not exist/);
    const gone = removeAsset(doc, assetId);
    expect(gone.assets).toEqual({});
  });

  it('adds and removes references', () => {
    const { doc, assetId } = withImage();
    const added = addReference(doc, assetId, { note: 'match the type' }, seededRng(3));
    expect(added.doc.references).toEqual([
      {
        id: added.referenceId,
        name: 'Reference 1',
        assetId,
        scope: 'style',
        note: 'match the type',
      },
    ]);
    expect(() => removeAsset(added.doc, assetId)).toThrow(/reference/);
    expect(removeReference(added.doc, added.referenceId).references).toEqual([]);
    expect(() => removeReference(doc, 'r_nope1')).toThrow(/does not exist/);
    expect(() => addReference(doc, 'img_nope1')).toThrow(/does not exist/);
    expect(
      addReference(doc, assetId, { name: 'Stripe', scope: 'layout' }).doc.references[0],
    ).toMatchObject({ name: 'Stripe', scope: 'layout' });
  });
});

describe('imageNodeSpec', () => {
  it('keeps proportions, limits the longest side, and handles unknown sizes', () => {
    expect(
      imageNodeSpec('img_aaaaa', { mime: 'image/png', width: 1600, height: 800 }),
    ).toMatchObject({ type: 'image', assetId: 'img_aaaaa', w: 480, h: 240, fit: 'cover' });
    expect(imageNodeSpec('img_aaaaa', { mime: 'image/png', width: 100, height: 50 })).toMatchObject(
      { w: 100, h: 50 },
    );
    expect(
      imageNodeSpec('img_aaaaa', { mime: 'image/svg+xml', width: null, height: null }),
    ).toMatchObject({ w: 200, h: 200 });
    expect(imageNodeSpec('img_aaaaa', { mime: 'image/png', width: 0, height: 0 })).toMatchObject({
      w: 200,
      h: 200,
    });
    expect(
      imageNodeSpec('img_aaaaa', { mime: 'image/png', width: 5000, height: 1 }, 100),
    ).toMatchObject({ w: 100, h: 1 });
  });
});
