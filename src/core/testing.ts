// Test-only helpers (excluded from coverage). Pure, so it also compiles under tsconfig.core.json.
import { createEmptyDoc } from './doc';
import { seededRng } from './ids';
import { normalizeNode } from './normalize';
import type { CreatableNodeType, Doc, Node } from './types';

export interface TestSpec {
  id: string;
  type: CreatableNodeType;
  children?: TestSpec[];
  [key: string]: unknown;
}

export const PAGE_ID = 'n_page1';

/** Builds a document from nested specs with explicit ids (no ops involved). */
export function buildDoc(topLevel: TestSpec[]): Doc {
  const base = createEmptyDoc({
    id: 'p_test1',
    now: '2026-01-01T00:00:00.000Z',
    rng: seededRng(99),
  });
  const nodes: Record<string, Node> = {};
  const add = (spec: TestSpec, parentId: string): void => {
    const { children, ...props } = spec;
    nodes[spec.id] = normalizeNode({
      ...(props as Partial<Node>),
      id: spec.id,
      type: spec.type,
      parentId,
      children: (children ?? []).map((c) => c.id),
    });
    for (const child of children ?? []) add(child, spec.id);
  };
  for (const spec of topLevel) add(spec, PAGE_ID);
  nodes[PAGE_ID] = normalizeNode({
    id: PAGE_ID,
    type: 'page',
    children: topLevel.map((s) => s.id),
  });
  return { ...base, rootId: PAGE_ID, nodes };
}

/**
 * page
 * ├─ n_frame (column frame, 400 wide)
 * │  ├─ n_title (text)
 * │  └─ n_row (row frame)
 * │     ├─ n_rectA
 * │     └─ n_rectB
 * └─ n_other (frame at 500,0)
 */
export function sampleDoc(): Doc {
  return buildDoc([
    {
      id: 'n_frame',
      type: 'frame',
      name: 'Card',
      layout: 'column',
      w: 400,
      gap: 8,
      children: [
        { id: 'n_title', type: 'text', text: 'Title', fontSize: 24 },
        {
          id: 'n_row',
          type: 'frame',
          name: 'Row',
          layout: 'row',
          children: [
            { id: 'n_rectA', type: 'rect', name: 'A', w: 50, h: 50 },
            { id: 'n_rectB', type: 'rect', name: 'B', w: 50, h: 50 },
          ],
        },
      ],
    },
    { id: 'n_other', type: 'frame', name: 'Other', x: 500 },
  ]);
}

/** Freezes recursively so any accidental mutation throws (ES modules are strict mode). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
