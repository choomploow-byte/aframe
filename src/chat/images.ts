import type { ImageData } from './types';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Reads an image file for sending to the model; says in plain words why it cannot. */
export function readImage(file: File): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      reject(new Error(`${file.name || 'That file'} is not a PNG, JPEG, GIF or WebP image.`));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error(`${file.name || 'That image'} is larger than 5 MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve({ mime: file.type, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.readAsDataURL(file);
  });
}
