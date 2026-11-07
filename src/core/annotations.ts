/**
 * Annotations (docs/04 "Annotation", docs/07): pins and regions a person (or an agent) leaves on
 * the design. Pure document operations plus the one piece of geometry that needs care: a pin made
 * on a node keeps an `offset` inside that node's box, so it follows the node when it moves, resizes
 * or reflows. Core cannot measure layout, so the caller supplies where a node is (the canvas asks
 * the DOM; a screenshot asks its clone).
 */
import { CoreError } from './errors';
import { generateId, type Rng } from './ids';
import type { Annotation, Doc } from './types';

export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a node is, in world units, or null when it is not drawn. */
export type NodeLocator = (nodeId: string) => WorldRect | null;

export interface PlacedAnnotation {
  annotation: Annotation;
  /** 1-based number among the OPEN annotations (resolved ones have none), as drawn on pins. */
  number: number | null;
  /** The pin point (top-left of the region when there is one), in world units. */
  x: number;
  y: number;
  /** The region, if the annotation has one, in world units. */
  rect: WorldRect | null;
  /** True when the node it was attached to could not be found, so the saved position is used. */
  detached: boolean;
}

/**
 * Where every annotation is now. A pin with a node and an `offset` sits at the node's top-left plus
 * the offset; otherwise (no node, node gone, or an old pin without an offset) the saved world
 * position is used.
 */
export function placeAnnotations(
  annotations: readonly Annotation[],
  locate: NodeLocator,
): PlacedAnnotation[] {
  let open = 0;
  return annotations.map((annotation) => {
    const number = annotation.status === 'open' ? (open += 1) : null;
    const box =
      annotation.nodeId !== undefined && annotation.offset !== undefined
        ? locate(annotation.nodeId)
        : null;
    if (box !== null && annotation.offset !== undefined) {
      const x = box.x + annotation.offset.x;
      const y = box.y + annotation.offset.y;
      return {
        annotation,
        number,
        x,
        y,
        rect: annotation.rect ? { x, y, w: annotation.rect.w, h: annotation.rect.h } : null,
        detached: false,
      };
    }
    return {
      annotation,
      number,
      x: annotation.rect?.x ?? annotation.x,
      y: annotation.rect?.y ?? annotation.y,
      rect: annotation.rect ?? null,
      detached: annotation.nodeId !== undefined && annotation.offset !== undefined,
    };
  });
}

export interface NewAnnotation {
  text: string;
  author: Annotation['author'];
  /** World position of the pin, or the top-left of a region. */
  x: number;
  y: number;
  /** A region, in world units (its x/y are the same point as above). */
  rect?: WorldRect;
  /** The node under the pin, and where inside its box the pin sits. */
  nodeId?: string;
  offset?: { x: number; y: number };
  now?: string;
}

const MAX_TEXT = 2000;

export function addAnnotation(
  doc: Doc,
  input: NewAnnotation,
  rng: Rng = Math.random,
): { doc: Doc; id: string } {
  const text = input.text.trim();
  if (text === '') throw new CoreError('INVALID_VALUE', 'A note cannot be empty.');
  if (text.length > MAX_TEXT) {
    throw new CoreError('INVALID_VALUE', `A note can be at most ${MAX_TEXT} characters.`);
  }
  if (input.nodeId !== undefined && doc.nodes[input.nodeId] === undefined) {
    throw new CoreError(
      'NOT_FOUND',
      `Node ${input.nodeId} does not exist.`,
      'Call get_design to see the ids.',
    );
  }
  const id = generateId('a', { has: (x) => doc.annotations.some((a) => a.id === x) }, rng);
  const annotation: Annotation = {
    id,
    ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
    ...(input.nodeId !== undefined && input.offset !== undefined ? { offset: input.offset } : {}),
    x: input.x,
    y: input.y,
    ...(input.rect === undefined ? {} : { rect: input.rect }),
    text,
    author: input.author,
    status: 'open',
    createdAt: input.now ?? new Date().toISOString(),
  };
  return { doc: { ...doc, annotations: [...doc.annotations, annotation] }, id };
}

export interface AnnotationPatch {
  text?: string;
  status?: Annotation['status'];
  /** `null` removes the reply. */
  reply?: string | null;
}

export function updateAnnotation(doc: Doc, id: string, patch: AnnotationPatch): Doc {
  const found = doc.annotations.find((a) => a.id === id);
  if (!found) {
    throw new CoreError(
      'NOT_FOUND',
      `Annotation ${id} does not exist.`,
      'Call get_annotations to see the ids.',
    );
  }
  const next: Annotation = { ...found };
  if (patch.text !== undefined) {
    const text = patch.text.trim();
    if (text === '' || text.length > MAX_TEXT) {
      throw new CoreError('INVALID_VALUE', `A note must be 1 to ${MAX_TEXT} characters.`);
    }
    next.text = text;
  }
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.reply === null) delete next.reply;
  else if (patch.reply !== undefined) next.reply = patch.reply.trim().slice(0, 500);
  return { ...doc, annotations: doc.annotations.map((a) => (a.id === id ? next : a)) };
}

export function removeAnnotation(doc: Doc, id: string): Doc {
  if (!doc.annotations.some((a) => a.id === id)) return doc;
  return { ...doc, annotations: doc.annotations.filter((a) => a.id !== id) };
}

export const openAnnotations = (doc: Doc): Annotation[] =>
  doc.annotations.filter((a) => a.status === 'open');

/** The prompt a person gives an external agent when notes are waiting. */
export function addressNotesPrompt(open: number): string {
  return open === 1
    ? 'in atelier, address my open annotation'
    : 'in atelier, address my open annotations';
}
