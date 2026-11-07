import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from './zip';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Reads the central directory back: enough to prove the archive is well-formed. */
function readZip(zip: Uint8Array): { name: string; data: Uint8Array; crc: number }[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array; crc: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + localExtra;
    out.push({ name, data: zip.subarray(start, start + size), crc });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('zipStore', () => {
  const entries = [
    { path: 'index.html', content: '<p>héllo</p>' },
    { path: 'assets/a.bin', content: Uint8Array.from([0, 1, 2, 255]) },
    { path: 'empty.txt', content: '' },
  ];

  it('writes entries that read back with the right names, bytes and checksums', () => {
    const files = readZip(zipStore(entries));
    expect(files.map((f) => f.name)).toEqual(['index.html', 'assets/a.bin', 'empty.txt']);
    expect(new TextDecoder().decode(files[0]?.data)).toBe('<p>héllo</p>');
    expect([...(files[1]?.data ?? [])]).toEqual([0, 1, 2, 255]);
    for (const f of files) expect(crc32(f.data)).toBe(f.crc);
  });

  it('is deterministic', () => {
    expect(zipStore(entries)).toEqual(zipStore(entries));
  });
});
