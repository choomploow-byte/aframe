import { CoreError } from './errors';
import { generateId, type Rng } from './ids';
import type { Doc, NodeSpec, Reference } from './types';

/**
 * Image assets (docs/04: `assets` maps id -> data URL in the MVP). Everything that enters the
 * document is checked by its first bytes, never by file name or declared type (docs/18), and
 * capped in size.
 */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/svg+xml';

export interface ImageInfo {
  mime: ImageMime;
  /** Natural size in px, or null when it cannot be read cheaply (SVG, odd files). */
  width: number | null;
  height: number | null;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63);
    out += b === undefined ? '=' : B64.charAt((n >> 6) & 63);
    out += c === undefined ? '=' : B64.charAt(n & 63);
  }
  return out;
}

/** Returns null for anything that is not canonical base64 (so garbage never becomes an asset). */
export function base64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) return null;
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean.charAt(i)) << 18) |
      (B64.indexOf(clean.charAt(i + 1)) << 12) |
      ((clean.charAt(i + 2) === '=' ? 0 : B64.indexOf(clean.charAt(i + 2))) << 6) |
      (clean.charAt(i + 3) === '=' ? 0 : B64.indexOf(clean.charAt(i + 3)));
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const u16be = (b: Uint8Array, i: number): number => ((b[i] as number) << 8) | (b[i + 1] as number);
const u16le = (b: Uint8Array, i: number): number => (b[i] as number) | ((b[i + 1] as number) << 8);
const u32be = (b: Uint8Array, i: number): number =>
  (b[i] as number) * 0x1000000 +
  (((b[i + 1] as number) << 16) | ((b[i + 2] as number) << 8) | (b[i + 3] as number));
const ascii = (b: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...b.subarray(from, to));

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = b[i + 1] as number;
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0xff
    ) {
      i += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = u16be(b, i + 2);
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
    i += 2 + length;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const chunk = ascii(b, 12, 16);
  if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits =
      (b[21] as number) |
      ((b[22] as number) << 8) |
      ((b[23] as number) << 16) |
      ((b[24] as number) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    const w = (b[24] as number) | ((b[25] as number) << 8) | ((b[26] as number) << 16);
    const h = (b[27] as number) | ((b[28] as number) << 8) | ((b[29] as number) << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

/** Identifies an image from its leading bytes. Null means "not an image we accept". */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const b = bytes;
  if (
    b.length >= 24 &&
    u32be(b, 0) === 0x89504e47 &&
    u32be(b, 4) === 0x0d0a1a0a &&
    ascii(b, 12, 16) === 'IHDR'
  ) {
    return { mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 10 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) {
    return { mime: 'image/gif', width: u16le(b, 6), height: u16le(b, 8) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    return { mime: 'image/jpeg', width: size?.width ?? null, height: size?.height ?? null };
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    const size = webpSize(b);
    return { mime: 'image/webp', width: size?.width ?? null, height: size?.height ?? null };
  }
  // SVG is text: look for the root element near the start. It is only ever shown through <img>,
  // which never runs scripts.
  const head = ascii(b, 0, Math.min(b.length, 1024)).toLowerCase();
  if (
    /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype[^>]*>\s*)?<svg[\s>]/.test(head)
  ) {
    return { mime: 'image/svg+xml', width: null, height: null };
  }
  return null;
}

export function toDataUrl(mime: ImageMime, bytes: Uint8Array): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export interface AddedAsset {
  doc: Doc;
  assetId: string;
  info: ImageInfo;
}

/** Adds an image to the document's assets. Throws `CoreError` for non-images and oversize files. */
export function addAsset(doc: Doc, bytes: Uint8Array, rng: Rng = Math.random): AddedAsset {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new CoreError(
      'LIMIT_EXCEEDED',
      `That image is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1048576} MB.`,
      'Resize or compress the image first.',
    );
  }
  const info = sniffImage(bytes);
  if (!info) {
    throw new CoreError(
      'INVALID_VALUE',
      "That file isn't a supported image.",
      'Use PNG, JPEG, GIF, WebP or SVG.',
    );
  }
  const assetId = generateId('img', { has: (id) => id in doc.assets }, rng);
  return {
    doc: { ...doc, assets: { ...doc.assets, [assetId]: toDataUrl(info.mime, bytes) } },
    assetId,
    info,
  };
}

/** What an already stored asset is (type and natural size), or null if it is missing or unreadable. */
export function assetInfo(doc: Doc, assetId: string): ImageInfo | null {
  const url = doc.assets[assetId];
  const match = url === undefined ? null : /^data:[^;,]+;base64,([\s\S]*)$/.exec(url);
  const bytes = match?.[1] === undefined ? null : base64ToBytes(match[1]);
  return bytes ? sniffImage(bytes) : null;
}

/** Where an asset is used, so deleting it can be refused or explained. */
export function assetUsage(doc: Doc, assetId: string): { nodes: string[]; references: string[] } {
  return {
    nodes: Object.values(doc.nodes)
      .filter((n) => n.type === 'image' && n.assetId === assetId)
      .map((n) => n.id),
    references: doc.references.filter((r) => r.assetId === assetId).map((r) => r.id),
  };
}

export function removeAsset(doc: Doc, assetId: string): Doc {
  if (!(assetId in doc.assets))
    throw new CoreError('NOT_FOUND', `Asset ${assetId} does not exist.`);
  const use = assetUsage(doc, assetId);
  if (use.nodes.length > 0 || use.references.length > 0) {
    throw new CoreError(
      'INVALID_VALUE',
      `Asset ${assetId} is still used by ${use.nodes.length} image layer(s) and ${use.references.length} reference(s).`,
      'Delete those first.',
    );
  }
  const assets = { ...doc.assets };
  delete assets[assetId];
  return { ...doc, assets };
}

export function addReference(
  doc: Doc,
  assetId: string,
  options: { name?: string; note?: string; scope?: Reference['scope'] } = {},
  rng: Rng = Math.random,
): { doc: Doc; referenceId: string } {
  if (!(assetId in doc.assets))
    throw new CoreError('NOT_FOUND', `Asset ${assetId} does not exist.`);
  const referenceId = generateId(
    'r',
    { has: (id) => doc.references.some((r) => r.id === id) },
    rng,
  );
  const reference: Reference = {
    id: referenceId,
    name: options.name ?? `Reference ${doc.references.length + 1}`,
    assetId,
    scope: options.scope ?? 'style',
  };
  if (options.note !== undefined) reference.note = options.note;
  return { doc: { ...doc, references: [...doc.references, reference] }, referenceId };
}

export function removeReference(doc: Doc, referenceId: string): Doc {
  if (!doc.references.some((r) => r.id === referenceId)) {
    throw new CoreError('NOT_FOUND', `Reference ${referenceId} does not exist.`);
  }
  return { ...doc, references: doc.references.filter((r) => r.id !== referenceId) };
}

/** Node spec for placing an image, scaled down to fit `maxSize` while keeping its proportions. */
export function imageNodeSpec(assetId: string, info: ImageInfo, maxSize = 480): NodeSpec {
  let w = info.width ?? 200;
  let h = info.height ?? 200;
  if (w <= 0 || h <= 0) {
    w = 200;
    h = 200;
  }
  const scale = Math.min(1, maxSize / Math.max(w, h));
  return {
    type: 'image',
    name: 'Image',
    assetId,
    w: Math.max(1, Math.round(w * scale)),
    h: Math.max(1, Math.round(h * scale)),
    fit: 'cover',
    tempId: 'img',
  };
}
