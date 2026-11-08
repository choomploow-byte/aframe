import { applyChanges } from '@core/apply';
import { createInstance, defineComponent } from '@core/component-ops';
import { docForPreview } from '@core/components';
import { createEmptyDoc } from '@core/doc';
import { seededRng } from '@core/ids';
import type { Doc, Op } from '@core/types';
import { describe, expect, it } from 'vitest';
import { followLink, linkAt, overlayFor, unitAt, type PreviewInput } from './interaction';

const rng = seededRng(11);
const apply = (doc: Doc, ops: Op[]) => {
  const r = applyChanges(doc, ops, { rng });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const none: PreviewInput = { hover: null, pressed: null, choice: {}, shown: {} };

/** Two screens; a tab master with three tabs that link to three panels; a button that links to the other screen. */
function build() {
  const empty = createEmptyDoc({ id: 'p_prev1', now: '2026-01-01T00:00:00.000Z', rng });
  const made = apply(empty, [
    {
      op: 'create',
      parentId: empty.rootId,
      node: {
        type: 'frame',
        name: 'Tab',
        layout: 'row',
        padding: [8, 16, 8, 16],
        fill: '#333333',
        children: [{ type: 'text', name: 'Label', text: 'Tab', color: '#CCCCCC' }],
      },
    },
    {
      op: 'create',
      parentId: empty.rootId,
      node: {
        type: 'frame',
        name: 'Button',
        layout: 'row',
        padding: [8, 16, 8, 16],
        fill: '#FFAA00',
        children: [{ type: 'text', name: 'Label', text: 'Go', color: '#000000' }],
      },
    },
  ]);
  const [tabMaster, , buttonMaster] = made.created as [string, string, string, string];
  let doc = defineComponent(made.doc, {
    nodeId: tabMaster,
    kind: 'tab',
    states: { hover: { $self: { fill: '#444444' } }, selected: { $self: { fill: '#FFAA00' } } },
  }).doc;
  doc = defineComponent(doc, {
    nodeId: buttonMaster,
    kind: 'button',
    states: { hover: { $self: { fill: '#FFCC55' } }, pressed: { $self: { fill: '#CC8800' } } },
  }).doc;
  const screens = apply(doc, [
    {
      op: 'create',
      parentId: doc.rootId,
      node: {
        type: 'frame',
        name: 'Home',
        layout: 'none',
        w: 600,
        h: 400,
        children: [
          { type: 'frame', name: 'Tabs', layout: 'row', x: 0, y: 0 },
          { type: 'frame', name: 'Panel A', layout: 'none', x: 0, y: 60, w: 600, h: 200 },
          {
            type: 'frame',
            name: 'Panel B',
            layout: 'none',
            x: 0,
            y: 60,
            w: 600,
            h: 200,
            visible: false,
          },
          {
            type: 'frame',
            name: 'Panel C',
            layout: 'none',
            x: 0,
            y: 60,
            w: 600,
            h: 200,
            visible: false,
          },
        ],
      },
    },
    {
      op: 'create',
      parentId: doc.rootId,
      node: { type: 'frame', name: 'Settings', layout: 'none', w: 300, h: 200 },
    },
  ]);
  const [home, tabs, panelA, panelB, panelC, settings] = screens.created as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  doc = screens.doc;
  const placed: string[] = [];
  for (const [label, panel] of [
    ['A', 'Panel A'],
    ['B', 'Panel B'],
    ['C', 'Panel C'],
  ] as const) {
    const out = createInstance(
      doc,
      {
        component: tabMaster,
        parentId: tabs,
        name: `Tab ${label}`,
        overrides: { Label: { text: label } },
      },
      rng,
    );
    doc = apply(out.doc, [{ op: 'update', id: out.instanceId, set: { href: `#${panel}` } }]).doc;
    placed.push(out.instanceId);
  }
  const go = createInstance(
    doc,
    { component: buttonMaster, parentId: home, name: 'Go', x: 20, y: 300 },
    rng,
  );
  doc = apply(go.doc, [{ op: 'update', id: go.instanceId, set: { href: '#Settings' } }]).doc;
  return {
    doc,
    home,
    settings,
    tabs,
    panelA,
    panelB,
    panelC,
    tabIds: placed as [string, string, string],
    go: go.instanceId,
    buttonMaster,
  };
}

describe('what reacts under the pointer', () => {
  it('finds the instance for any layer inside it, and nothing for plain layers', () => {
    const { doc, go, tabs } = build();
    const label = doc.nodes[go]?.children[0] as string;
    expect(unitAt(doc, label)).toMatchObject({ id: go, kind: 'instance', controlKind: 'button' });
    expect(unitAt(doc, go)?.id).toBe(go);
    expect(unitAt(doc, tabs)).toBeNull();
  });

  it('a disabled instance does not react', () => {
    const { doc, go } = build();
    const off = apply(doc, [{ op: 'update', id: go, set: { state: 'disabled' } }]).doc;
    expect(unitAt(off, go)).toBeNull();
  });
});

describe('states from the pointer', () => {
  it('hover and press change the look through the component states', () => {
    const { doc, go } = build();
    const hovered = docForPreview(doc, overlayFor(doc, { ...none, hover: go }));
    expect(hovered.nodes[go]?.fill).toBe('#FFCC55');
    const pressed = docForPreview(doc, overlayFor(doc, { ...none, hover: go, pressed: go }));
    expect(pressed.nodes[go]?.fill).toBe('#CC8800');
    expect(docForPreview(doc, overlayFor(doc, none))).toBe(doc);
  });

  it('a chosen tab is selected and the others are not; picking another moves it', () => {
    const { doc, tabIds } = build();
    const a = unitAt(doc, tabIds[0]);
    const b = unitAt(doc, tabIds[1]);
    expect(a && b).toBeTruthy();
    const key = `${doc.nodes[tabIds[0]]?.parentId}|${a?.masterId}`;
    const afterA = docForPreview(doc, overlayFor(doc, { ...none, choice: { [key]: tabIds[0] } }));
    expect(afterA.nodes[tabIds[0]]?.fill).toBe('#FFAA00');
    expect(afterA.nodes[tabIds[1]]?.fill).toBe('#333333');
    const afterB = docForPreview(doc, overlayFor(doc, { ...none, choice: { [key]: tabIds[1] } }));
    expect(afterB.nodes[tabIds[0]]?.fill).toBe('#333333');
    expect(afterB.nodes[tabIds[1]]?.fill).toBe('#FFAA00');
  });

  it('a tab the design marks selected starts selected', () => {
    const { doc, tabIds } = build();
    const designed = apply(doc, [{ op: 'update', id: tabIds[2], set: { state: 'selected' } }]).doc;
    const out = docForPreview(designed, overlayFor(designed, none));
    expect(out.nodes[tabIds[2]]?.fill).toBe('#FFAA00');
  });

  it('hovering a selected tab leaves it selected', () => {
    const { doc, tabIds } = build();
    const key = `${doc.nodes[tabIds[0]]?.parentId}|${unitAt(doc, tabIds[0])?.masterId}`;
    const out = docForPreview(
      doc,
      overlayFor(doc, { ...none, hover: tabIds[0], choice: { [key]: tabIds[0] } }),
    );
    expect(out.nodes[tabIds[0]]?.fill).toBe('#FFAA00');
  });
});

describe('links', () => {
  it('reads the link on a layer or the nearest one above it', () => {
    const { doc, go } = build();
    expect(linkAt(doc, go)).toBe('Settings');
    expect(linkAt(doc, doc.nodes[go]?.children[0] as string)).toBe('Settings');
    expect(linkAt(doc, doc.rootId)).toBeNull();
  });

  it('a link to a top-level frame goes there', () => {
    const { doc, settings } = build();
    expect(followLink(doc, 'Settings')).toEqual({ kind: 'frame', frameId: settings });
    expect(followLink(doc, 'settings')).toEqual({ kind: 'frame', frameId: settings });
    expect(followLink(doc, settings)).toEqual({ kind: 'frame', frameId: settings });
  });

  it('a link to a panel shows it and hides the other panels that links point at', () => {
    const { doc, panelA, panelB, panelC } = build();
    expect(followLink(doc, 'Panel B')).toEqual({
      kind: 'show',
      shown: { [panelB]: true, [panelA]: false, [panelC]: false },
    });
  });

  it('a link to nothing says so', () => {
    const { doc } = build();
    expect(followLink(doc, 'Nowhere')).toEqual({ kind: 'missing', target: 'Nowhere' });
  });

  it('showing a panel changes what is drawn', () => {
    const { doc, panelA, panelB } = build();
    const result = followLink(doc, 'Panel B');
    const shown = result?.kind === 'show' ? result.shown : {};
    const out = docForPreview(doc, overlayFor(doc, { ...none, shown }));
    expect(out.nodes[panelB]?.visible).toBe(true);
    expect(out.nodes[panelA]?.visible).toBe(false);
  });
});
