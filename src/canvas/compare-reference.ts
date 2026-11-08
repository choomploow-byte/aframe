import { diffPixels, type DiffReport } from '@core/imagediff';
import { assetInfo } from '@core/assets';
import type { Doc } from '@core/types';
import { captureScreenshot } from './screenshot';

/**
 * "Is it 1:1?" as numbers and a picture: renders a frame the way a screenshot does, stretches the
 * reference to the same size, and returns how much matches, where the biggest differences are, and
 * a difference picture (the design dimmed, every difference in red).
 */
export interface CompareResult extends DiffReport {
  /** PNG of the difference picture, base64. */
  diffPngBase64: string;
  referenceName: string;
  /** The reference was stretched to the frame's size; true when their proportions differ. */
  aspectDiffers: boolean;
  /** Reference size / frame size, e.g. 0.5 for a half-size reference. */
  referenceScale: number;
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The picture could not be decoded.'));
    img.src = url;
  });
}

function pixels(img: HTMLImageElement, w: number, h: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No canvas is available to compare with.');
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

export async function compareWithReference(
  doc: Doc,
  zoom: number,
  options: { nodeId?: string; referenceId?: string; tolerance?: number },
): Promise<CompareResult> {
  const reference =
    options.referenceId === undefined
      ? doc.references[0]
      : doc.references.find(
          (r) =>
            r.id === options.referenceId ||
            r.name.toLowerCase() === options.referenceId?.toLowerCase(),
        );
  if (!reference) {
    throw new Error(
      options.referenceId === undefined
        ? 'This project has no reference images. Add one first.'
        : `There is no reference "${options.referenceId}".`,
    );
  }
  const refUrl = doc.assets[reference.assetId];
  if (refUrl === undefined) throw new Error('The reference picture is missing.');

  // The frame at 1x, uncapped, so the comparison is at the design's real size.
  const shot = await captureScreenshot(doc, zoom, {
    ...(options.nodeId === undefined ? {} : { nodeId: options.nodeId }),
    scale: 1,
    maxWidth: 4000,
  });
  const design = await load(`data:image/png;base64,${shot.pngBase64}`);
  const ref = await load(refUrl);
  const w = design.naturalWidth;
  const h = design.naturalHeight;
  const { diff, report } = diffPixels(
    pixels(design, w, h),
    pixels(ref, w, h),
    w,
    h,
    options.tolerance ?? 24,
  );

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('No canvas is available to draw the difference.');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(diff), w, h), 0, 0);
  const png = out.toDataURL('image/png').split(',')[1] ?? '';

  const info = assetInfo(doc, reference.assetId);
  const refW = info?.width ?? ref.naturalWidth;
  const refH = info?.height ?? ref.naturalHeight;
  return {
    ...report,
    diffPngBase64: png,
    referenceName: reference.name,
    aspectDiffers: Math.abs(refW / refH - w / h) > 0.02,
    referenceScale: Math.round((refW / w) * 100) / 100,
  };
}
