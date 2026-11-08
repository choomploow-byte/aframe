import { create } from 'zustand';
import { store } from '../store/store';

/**
 * The interactive preview: a frame shown as it would behave, with buttons that react to the
 * pointer, tabs that select, and links between frames. Only whether it is open, which frame it
 * shows and where you have been; the design itself is never touched.
 */
export interface PreviewUi {
  open: boolean;
  /** The top-level frame on show. */
  frameId: string | null;
  /** Frames visited by following links, oldest first (the last one is on show). */
  trail: string[];
}

export const usePreviewUi = create<PreviewUi>(() => ({ open: false, frameId: null, trail: [] }));

/** The page-level frame that contains `id` (or is it), or null. */
export function topFrameOf(id: string): string | null {
  const { nodes, rootId } = store.getState().doc;
  let cur = nodes[id];
  while (cur && cur.parentId !== null && cur.parentId !== rootId) cur = nodes[cur.parentId];
  return cur && cur.parentId === rootId && cur.type === 'frame' ? cur.id : null;
}

/** Opens the preview on the selected frame, or the first frame on the page. */
export function openPreview(): boolean {
  const s = store.getState();
  const fromSelection = s.selection.map((id) => topFrameOf(id)).find((id) => id !== null);
  const first = (s.doc.nodes[s.doc.rootId]?.children ?? []).find(
    (id) => s.doc.nodes[id]?.type === 'frame' && s.doc.nodes[id]?.visible !== false,
  );
  const frameId = fromSelection ?? first ?? null;
  if (frameId === null) return false;
  usePreviewUi.setState({ open: true, frameId, trail: [frameId] });
  return true;
}

export function closePreview(): void {
  usePreviewUi.setState({ open: false, frameId: null, trail: [] });
}

/** Moves to another top-level frame (a link), remembering the way back. */
export function goToFrame(frameId: string): void {
  usePreviewUi.setState((s) => ({ frameId, trail: [...s.trail, frameId].slice(-30) }));
}

export function goBack(): void {
  usePreviewUi.setState((s) => {
    if (s.trail.length < 2) return s;
    const trail = s.trail.slice(0, -1);
    return { ...s, trail, frameId: trail[trail.length - 1] ?? s.frameId };
  });
}
