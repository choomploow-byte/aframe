import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { Point, Rect } from '../canvas/geometry';

/**
 * What the annotation and reference UI is showing right now. Kept apart from the document store
 * because none of it is part of the design or its undo history: an open composer, which note is
 * focused, the Notes filter, a reference being compared.
 */
export interface Composer {
  /** Where the pin (or the region's top-left) is, in world units. */
  world: Point;
  /** A region in world units, when the user dragged one. */
  rect?: Rect;
  /** The node under the pin and where inside its box the pin sits. */
  nodeId?: string;
  offset?: Point;
}

export type NotesFilter = 'open' | 'resolved' | 'all';

export interface Compare {
  referenceId: string;
  mode: 'overlay' | 'side';
  /** 0..1, for the overlay mode. */
  opacity: number;
}

export interface AnnotationUi {
  composer: Composer | null;
  focusId: string | null;
  filter: NotesFilter;
  compare: Compare | null;
  openComposer: (composer: Composer) => void;
  closeComposer: () => void;
  focus: (id: string | null) => void;
  setFilter: (filter: NotesFilter) => void;
  setCompare: (compare: Compare | null) => void;
}

export const annotationUi = createStore<AnnotationUi>()((set) => ({
  composer: null,
  focusId: null,
  filter: 'open',
  compare: null,
  openComposer: (composer) => set({ composer, focusId: null }),
  closeComposer: () => set({ composer: null }),
  focus: (focusId) => set({ focusId }),
  setFilter: (filter) => set({ filter }),
  setCompare: (compare) => set({ compare }),
}));

export const useAnnotationUi = <T>(select: (s: AnnotationUi) => T): T =>
  useStore(annotationUi, select);
