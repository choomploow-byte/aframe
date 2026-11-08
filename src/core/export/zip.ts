import { utf8 } from '../utf8';

/**
 * A minimal ZIP writer ("store" method, no compression) so a browser build can hand over an export
 * as one download without a dependency. Source code and images are small and PNG/JPEG are already
 * compressed, so skipping deflate costs little. Pure: file names are the export's own (already
 * validated by `exportPathProblem`), dates are fixed so the same export gives the same bytes.
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 2026-01-01 00:00 in DOS date/time. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export interface ZipEntry {
  path: string;
  content: string | Uint8Array;
}

export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff];
  const u32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24];
  for (const e of entries) {
    const name = utf8(e.path);
    const data = typeof e.content === 'string' ? utf8(e.content) : e.content;
    const crc = crc32(data);
    // UTF-8 names (flag bit 11); version 20; method 0 = stored.
    const common = [
      ...u16(20),
      ...u16(0x0800),
      ...u16(0),
      ...u16(DOS_TIME),
      ...u16(DOS_DATE),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(name.length),
      ...u16(0),
    ];
    const local = Uint8Array.from([...u32(0x04034b50), ...common]);
    parts.push(local, name, data);
    central.push(
      Uint8Array.from([
        ...u32(0x02014b50),
        ...u16(20),
        ...common,
        ...u16(0), // comment length
        ...u16(0), // disk number
        ...u16(0), // internal attributes
        ...u32(0), // external attributes
        ...u32(offset),
      ]),
      name,
    );
    offset += local.length + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = Uint8Array.from([
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(offset),
    ...u16(0),
  ]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
