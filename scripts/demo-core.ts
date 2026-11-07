// Builds a landing hero with ONE applyChanges call (nested children + tempIds) and prints the
// outline an agent would get from get_design. Run: npm run demo:core
import {
  applyChanges,
  createEmptyDoc,
  getOutline,
  nodeToCss,
  seededRng,
  cssToString,
  type Op,
} from '../src/core';

const doc = createEmptyDoc({
  name: 'Demo',
  id: 'p_demo1',
  now: '2026-01-01T00:00:00.000Z',
  rng: seededRng(2026),
});

const ops: Op[] = [
  {
    op: 'create',
    parentId: doc.rootId,
    node: {
      type: 'frame',
      tempId: 'page',
      name: 'Landing - Desktop',
      x: 0,
      y: 0,
      w: 1440,
      h: 'hug',
      layout: 'column',
      fill: '$surface',
      children: [
        {
          type: 'frame',
          tempId: 'hero',
          name: 'Hero',
          w: 'fill',
          h: 'hug',
          layout: 'column',
          gap: 24,
          padding: [112, 64, 112, 64],
          align: 'center',
          role: 'section',
          children: [
            {
              type: 'text',
              name: 'Headline',
              text: 'Plan work your team will actually follow',
              w: 820,
              fontFamily: '$font.heading',
              fontSize: 60,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: -0.02,
              textAlign: 'center',
              color: '$text',
              role: 'heading',
            },
            {
              type: 'text',
              name: 'Subhead',
              text: 'Northwind turns scattered tasks into one calm, shared plan.',
              w: 620,
              fontSize: 20,
              lineHeight: 1.5,
              textAlign: 'center',
              color: '$muted',
            },
            {
              type: 'frame',
              tempId: 'cta',
              name: 'CTA Row',
              layout: 'row',
              gap: 12,
              children: [
                {
                  type: 'frame',
                  tempId: 'primary',
                  name: 'Primary Button',
                  layout: 'row',
                  padding: [14, 24, 14, 24],
                  align: 'center',
                  justify: 'center',
                  radius: '$radius.md',
                  fill: '$primary',
                  role: 'button',
                  children: [
                    {
                      type: 'text',
                      name: 'Start free Label',
                      text: 'Start free',
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#FFFFFF',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  // A later op in the same batch refers to a node the batch just created.
  {
    op: 'update',
    id: '$primary',
    set: { shadow: [{ x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(91,60,176,0.35)' }] },
  },
];

const result = applyChanges(doc, ops, { rng: seededRng(7) });
if (!result.ok) {
  console.error(JSON.stringify(result.errors, null, 2));
  process.exit(1);
}

console.log(`Created ${result.created.length} nodes in one batch (${ops.length} ops).`);
console.log('tempId -> id:', result.idMap);
console.log('warnings:', result.warnings);
console.log('\nOutline (what get_design returns):');
console.log(JSON.stringify(getOutline(result.doc, { depth: 6 }).root, null, 2));

const button = result.doc.nodes[result.idMap.primary as string];
const parent = button?.parentId ? result.doc.nodes[button.parentId] : undefined;
if (button) {
  console.log('\nCSS for the primary button (shared by renderer and exporter):');
  console.log(cssToString(nodeToCss(button, parent, result.doc.tokens), { separator: '\n' }));
}
