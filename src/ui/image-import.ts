import { useEffect } from 'react';
import { getCanvasApi } from '../canvas/canvas-api';
import type { Point } from '../canvas/geometry';
import { screenToWorld } from '../canvas/viewport';
import { importImages, type ImageSource } from '../store/panel-commands';
import { store } from '../store/store';
import { showToast } from './toast';

/**
 * Bringing images in: file picker, drag-and-drop and paste all end up here. Results are reported as
 * toasts (errors name the file and say what is accepted), never as exceptions.
 */
export async function importFiles(
  files: readonly File[],
  options: { insert: boolean; at?: Point },
): Promise<void> {
  if (files.length === 0) return;
  const measure = getCanvasApi()?.measure ?? (() => null);
  const sources: ImageSource[] = files.map((f) => ({
    name: f.name,
    arrayBuffer: () => f.arrayBuffer(),
  }));
  const outcomes = await importImages({ store, measure }, sources, options);
  const ok = outcomes.filter((o) => o.ok).length;
  for (const o of outcomes) {
    if (!o.ok) showToast(`${o.name}: ${o.message}${o.hint ? ` ${o.hint}` : ''}`, { kind: 'error' });
  }
  if (ok > 0) {
    showToast(ok === 1 ? 'Image added.' : `${ok} images added.`, {
      action: { label: 'Undo', run: () => void store.getState().undo() },
    });
  }
}

/** The centre of the visible canvas in world units, or undefined before the canvas exists. */
function viewCentre(): Point | undefined {
  return getCanvasApi()?.viewCenter();
}

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName));
};

/** Window-level paste and drop handlers. Mount once. */
export function useImageDropAndPaste(): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (isTyping(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter(
        (f) => f.type.startsWith('image/') || f.type === '',
      );
      if (files.length === 0) return;
      e.preventDefault();
      void importFiles(files, { insert: true, at: viewCentre() });
    };
    const hasFiles = (e: DragEvent): boolean =>
      [...(e.dataTransfer?.types ?? [])].includes('Files');
    const onDragOver = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault(); // makes the window a valid drop target
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      const canvas = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-testid="canvas"]',
      );
      if (canvas) {
        const r = canvas.getBoundingClientRect();
        const world = screenToWorld(store.getState().viewport, {
          x: e.clientX - r.left,
          y: e.clientY - r.top,
        });
        void importFiles(files, { insert: true, at: world });
      } else {
        void importFiles(files, { insert: false });
      }
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
