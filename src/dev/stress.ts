import { applyChanges } from '@core/apply';
import { createEmptyDoc } from '@core/doc';
import { seededRng } from '@core/ids';
import type { Doc, NodeSpec } from '@core/types';

/**
 * A synthetic document for performance checks (docs/19): one tall artboard of rows of cards, each
 * card a column frame with a picture block, two text lines and a button, so the load is realistic
 * (nested auto-layout, text wrapping, shadows, radii) rather than 500 empty rectangles.
 */
const CARD_NODES = 6; // card, picture, title, subtitle, button, label
const CARDS_PER_ROW = 4;
const ROW_NODES = 1 + CARDS_PER_ROW * CARD_NODES;

function card(i: number): NodeSpec {
  return {
    type: 'frame',
    name: `Card ${i}`,
    layout: 'column',
    w: 'fill',
    h: 'hug',
    gap: 8,
    padding: [12, 12, 12, 12],
    radius: '$radius.lg',
    fill: '$surface2',
    stroke: '$border',
    shadow: [{ x: 0, y: 2, blur: 8, spread: 0, color: 'rgba(0,0,0,0.06)' }],
    role: 'card',
    children: [
      {
        type: 'rect',
        name: 'Picture',
        w: 'fill',
        h: 80,
        radius: '$radius.md',
        fill: '$primarySoft',
      },
      {
        type: 'text',
        name: 'Title',
        text: `Card ${i} headline that may wrap`,
        w: 'fill',
        fontSize: 18,
        fontWeight: 600,
        color: '$text',
      },
      {
        type: 'text',
        name: 'Subtitle',
        text: 'Supporting copy for the card, long enough to wrap onto a second line.',
        w: 'fill',
        fontSize: 13,
        lineHeight: 1.5,
        color: '$muted',
      },
      {
        type: 'frame',
        name: 'Button',
        layout: 'row',
        padding: [8, 14, 8, 14],
        radius: '$radius.md',
        fill: '$primary',
        role: 'button',
        children: [
          {
            type: 'text',
            name: 'Label',
            text: 'Open',
            fontSize: 13,
            fontWeight: 600,
            color: '#FFFFFF',
          },
        ],
      },
    ],
  };
}

function row(r: number): NodeSpec {
  return {
    type: 'frame',
    name: `Row ${r}`,
    layout: 'row',
    w: 'fill',
    h: 'hug',
    gap: 12,
    children: Array.from({ length: CARDS_PER_ROW }, (_, c) => card(r * CARDS_PER_ROW + c)),
  };
}

/** Rows added per batch: stays well under the 2000-nodes-per-batch limit of `applyChanges`. */
const ROWS_PER_BATCH = Math.floor(1900 / ROW_NODES);

/** Roughly `nodes` nodes (rounded up to whole rows), as a valid document. */
export function generateStressDoc(nodes: number): Doc {
  let doc = createEmptyDoc({
    name: `Stress ${nodes}`,
    id: 'p_stress',
    now: '2026-01-01T00:00:00.000Z',
    rng: seededRng(7),
  });
  const rng = seededRng(11);
  const created = applyChanges(
    doc,
    [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          tempId: 'board',
          name: 'Stress artboard',
          x: 0,
          y: 0,
          w: 1440,
          h: 'hug',
          layout: 'column',
          gap: 12,
          padding: [24, 24, 24, 24],
          fill: '$surface',
        },
      },
    ],
    { rng },
  );
  if (!created.ok) throw new Error(`stress doc failed: ${JSON.stringify(created.errors)}`);
  doc = created.doc;
  const boardId = created.idMap.board as string;

  const rows = Math.max(1, Math.ceil(nodes / ROW_NODES));
  for (let first = 0; first < rows; first += ROWS_PER_BATCH) {
    const count = Math.min(ROWS_PER_BATCH, rows - first);
    const res = applyChanges(
      doc,
      Array.from({ length: count }, (_, i) => ({
        op: 'create' as const,
        parentId: boardId,
        node: row(first + i),
      })),
      { rng },
    );
    if (!res.ok) throw new Error(`stress doc failed: ${JSON.stringify(res.errors)}`);
    doc = res.doc;
  }
  return doc;
}
