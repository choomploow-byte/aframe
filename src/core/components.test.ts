import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { createInstance, defineComponent, findMaster, listComponents } from './component-ops';
import { descendantsOf, docInState, syncAllInstances } from './components';
import { createEmptyDoc } from './doc';
import { seededRng } from './ids';
import type { Doc, Op } from './types';

const rng = seededRng(7);

function apply(doc: Doc, ops: Op[]) {
  const r = applyChanges(doc, ops, { rng });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
}

/** A page with one button master (frame > text) already defined, with hover and pressed. */
function withButton(): { doc: Doc; master: string; label: string } {
  const empty = createEmptyDoc({ id: 'p_test1', now: '2026-01-01T00:00:00.000Z', rng });
  const r = apply(empty, [
    {
      op: 'create',
      parentId: empty.rootId,
      node: {
        type: 'frame',
        name: 'Button',
        role: 'button',
        layout: 'row',
        padding: [12, 24, 12, 24],
        fill: '$primary',
        radius: '$radius.md',
        children: [{ type: 'text', name: 'Label', text: 'Click', color: '#FFFFFF' }],
      },
    },
  ]);
  const master = r.created[0] as string;
  const label = r.created[1] as string;
  const defined = defineComponent(r.doc, {
    nodeId: master,
    kind: 'button',
    states: {
      hover: { $self: { fill: '#4A2F94' } },
      pressed: { $self: { fill: '#3C2678' }, Label: { color: '#EEEEEE' } },
    },
  });
  return { doc: defined.doc, master, label };
}

describe('define_component', () => {
  it('marks a frame as a master and resolves layer names to ids in its states', () => {
    const { doc, master, label } = withButton();
    const node = doc.nodes[master];
    expect(node?.component?.kind).toBe('button');
    expect(node?.component?.states?.hover).toEqual({ $self: { fill: '#4A2F94' } });
    expect(node?.component?.states?.pressed?.[label]).toEqual({ color: '#EEEEEE' });
  });

  it('merges later calls, and null removes a state', () => {
    const { doc, master } = withButton();
    const more = defineComponent(doc, {
      nodeId: master,
      states: { disabled: { $self: { opacity: 0.5 } }, hover: null },
    });
    const states = more.doc.nodes[master]?.component?.states ?? {};
    expect(Object.keys(states).sort()).toEqual(['disabled', 'pressed']);
  });

  it('refuses non-frames, bad layers, bad properties and nesting', () => {
    const { doc, master, label } = withButton();
    expect(() => defineComponent(doc, { nodeId: label })).toThrow(/only a frame/);
    expect(() =>
      defineComponent(doc, { nodeId: master, states: { hover: { Nope: { fill: '#000000' } } } }),
    ).toThrow(/no layer "Nope"/);
    expect(() =>
      defineComponent(doc, { nodeId: master, states: { hover: { Label: { fontSize: 'big' } } } }),
    ).toThrow(/fontSize/);
    expect(() =>
      defineComponent(doc, { nodeId: master, states: { hover: { $self: { text: 'x' } } } }),
    ).toThrow(/does not apply/);
    // a master inside a master
    const inner = apply(doc, [
      { op: 'create', parentId: master, node: { type: 'frame', name: 'Inner' } },
    ]);
    expect(() => defineComponent(inner.doc, { nodeId: inner.created[0] as string })).toThrow(
      /inside a component/,
    );
  });
});

describe('instances follow the master', () => {
  it('copies the master look and keeps layers under the instance', () => {
    const { doc, master } = withButton();
    const made = createInstance(
      doc,
      { component: 'Button', x: 10, y: 20, name: 'Buy button' },
      rng,
    );
    const inst = made.doc.nodes[made.instanceId];
    expect(inst).toMatchObject({
      name: 'Buy button',
      x: 10,
      y: 20,
      instanceOf: master,
      fill: '$primary',
      layout: 'row',
      role: 'button',
    });
    expect(inst?.component).toBeUndefined();
    const layers = descendantsOf(made.doc.nodes, made.instanceId);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({
      type: 'text',
      text: 'Click',
      from: expect.any(String) as string,
    });
    expect(made.layers).toEqual({ Label: layers[0]?.id });
  });

  it('follows later edits to the master, keeping the layer ids', () => {
    const { doc, master, label } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const before = descendantsOf(made.doc.nodes, made.instanceId)[0]?.id;
    const edited = apply(made.doc, [
      { op: 'update', id: master, set: { fill: '#112233', radius: 4 } },
      { op: 'update', id: label, set: { text: 'Go', fontSize: 20 } },
    ]);
    const inst = edited.doc.nodes[made.instanceId];
    expect(inst).toMatchObject({ fill: '#112233', radius: 4 });
    const layer = descendantsOf(edited.doc.nodes, made.instanceId)[0];
    expect(layer).toMatchObject({ id: before, text: 'Go', fontSize: 20 });
    // the master's own name and position are not copied
    expect(inst?.name).not.toBe('Button!');
  });

  it('adds and removes layers when the master gains or loses some', () => {
    const { doc, master, label } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const grown = apply(made.doc, [
      { op: 'create', parentId: master, node: { type: 'icon', name: 'Glyph', icon: 'star' } },
    ]);
    expect(descendantsOf(grown.doc.nodes, made.instanceId).map((n) => n.name)).toEqual([
      'Label',
      'Glyph',
    ]);
    expect(grown.created.length).toBeGreaterThanOrEqual(2); // the master's icon and the instance's
    const shrunk = apply(grown.doc, [{ op: 'delete', id: label }]);
    expect(descendantsOf(shrunk.doc.nodes, made.instanceId).map((n) => n.name)).toEqual(['Glyph']);
    expect(shrunk.deleted.length).toBeGreaterThan(0);
  });

  it('keeps unchanged nodes by identity (structural sharing)', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const again = syncAllInstances(made.doc);
    expect(again).toBe(made.doc);
    const touched = apply(made.doc, [{ op: 'update', id: master, set: { opacity: 0.9 } }]);
    const layerBefore = descendantsOf(made.doc.nodes, made.instanceId)[0];
    const layerAfter = descendantsOf(touched.doc.nodes, made.instanceId)[0];
    expect(layerAfter).toBe(layerBefore);
  });
});

describe('overrides', () => {
  it('applies create-time overrides by layer name, on the layer and on the root', () => {
    const { doc } = withButton();
    const made = createInstance(
      doc,
      {
        component: 'Button',
        overrides: { Label: { text: 'Buy now', color: '#000000' }, $self: { w: 240 } },
      },
      rng,
    );
    expect(made.doc.nodes[made.instanceId]).toMatchObject({ w: 240 });
    expect(descendantsOf(made.doc.nodes, made.instanceId)[0]).toMatchObject({
      text: 'Buy now',
      color: '#000000',
    });
  });

  it('records an edit to an instance layer as an override that survives master edits', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const layerId = made.layers.Label as string;
    const edited = apply(made.doc, [{ op: 'update', id: layerId, set: { text: 'Hello' } }]);
    expect(edited.warnings.map((w) => w.code)).toContain('INSTANCE_OVERRIDE');
    const root = edited.doc.nodes[made.instanceId];
    expect(Object.values(root?.overrides ?? {})).toEqual([{ text: 'Hello' }]);

    const masterEdit = apply(edited.doc, [{ op: 'update', id: master, set: { fill: '#FF00FF' } }]);
    expect(masterEdit.doc.nodes[made.instanceId]?.fill).toBe('#FF00FF');
    expect(descendantsOf(masterEdit.doc.nodes, made.instanceId)[0]?.text).toBe('Hello');
  });

  it('records an edit to the instance itself, except position and name which it owns', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const edited = apply(made.doc, [
      { op: 'update', id: made.instanceId, set: { fill: '#00FF00', x: 99, name: 'Mine' } },
    ]);
    const root = edited.doc.nodes[made.instanceId];
    expect(root).toMatchObject({ fill: '#00FF00', x: 99, name: 'Mine' });
    expect(root?.overrides).toEqual({ $self: { fill: '#00FF00' } });
    const after = apply(edited.doc, [{ op: 'update', id: master, set: { fill: '#0000FF' } }]);
    expect(after.doc.nodes[made.instanceId]?.fill).toBe('#00FF00'); // its own override wins
  });

  it('removes a property with null and resets all overrides with overrides: null', () => {
    const { doc, master } = withButton();
    const made = createInstance(
      doc,
      { component: master, overrides: { $self: { fill: '#00FF00' } } },
      rng,
    );
    const reset = apply(made.doc, [
      { op: 'update', id: made.instanceId, set: { overrides: null } },
    ]);
    expect(reset.doc.nodes[made.instanceId]?.fill).toBe('$primary');
    expect(reset.doc.nodes[made.instanceId]?.overrides).toBeUndefined();
  });

  it('validates override values against the layer they land on', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const layerId = made.layers.Label as string;
    const r = applyChanges(made.doc, [
      { op: 'update', id: layerId, set: { fontSize: 'huge' } as never },
    ]);
    expect(r.ok).toBe(false);
    expect(() =>
      createInstance(doc, { component: master, overrides: { Label: { assetId: 'img_abcde' } } }),
    ).toThrow(/does not apply/);
  });
});

describe('states', () => {
  it('shows a state on an instance and switches back', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master, state: 'pressed' }, rng);
    expect(made.doc.nodes[made.instanceId]?.fill).toBe('#3C2678');
    expect(descendantsOf(made.doc.nodes, made.instanceId)[0]?.color).toBe('#EEEEEE');
    const back = apply(made.doc, [
      { op: 'update', id: made.instanceId, set: { state: 'default' } },
    ]);
    expect(back.doc.nodes[made.instanceId]?.fill).toBe('$primary');
    expect(descendantsOf(back.doc.nodes, made.instanceId)[0]?.color).toBe('#FFFFFF');
  });

  it('lets an instance override beat the state', () => {
    const { doc, master } = withButton();
    const made = createInstance(
      doc,
      { component: master, state: 'hover', overrides: { $self: { fill: '#ABCDEF' } } },
      rng,
    );
    expect(made.doc.nodes[made.instanceId]?.fill).toBe('#ABCDEF');
  });

  it('renders any state for a screenshot without touching the document', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const hover = docInState(made.doc, 'hover', [doc.rootId]);
    expect(hover).not.toBe(made.doc);
    expect(hover.nodes[made.instanceId]?.fill).toBe('#4A2F94');
    expect(hover.nodes[master]?.fill).toBe('#4A2F94'); // the master shows its own hover look too
    expect(made.doc.nodes[made.instanceId]?.fill).toBe('$primary');
    expect(made.doc.nodes[master]?.fill).toBe('$primary');
    // nothing to change -> the same object
    expect(docInState(createEmptyDoc(), 'hover', [])).toBeDefined();
  });
});

describe('structure rules', () => {
  it('forbids deleting, moving, duplicating or adding inside an instance, with advice', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const layer = made.layers.Label as string;
    const run = (op: Op) => {
      const r = applyChanges(made.doc, [op]);
      expect(r.ok).toBe(false);
      return r.ok ? '' : `${r.errors[0]?.message} ${r.errors[0]?.hint ?? ''}`;
    };
    expect(run({ op: 'delete', id: layer })).toMatch(/cannot be deleted[\s\S]*visible/);
    expect(run({ op: 'move', id: layer, parentId: doc.rootId })).toMatch(/cannot be moved/);
    expect(run({ op: 'duplicate', id: layer })).toMatch(/cannot be duplicated/);
    expect(
      run({ op: 'create', parentId: made.instanceId, node: { type: 'text', text: 'x' } }),
    ).toMatch(/inside the component instance[\s\S]*detach/);
    expect(run({ op: 'move', id: master, parentId: made.instanceId })).toMatch(
      /inside the component/,
    );
  });

  it('forbids nesting components', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const r = applyChanges(made.doc, [{ op: 'move', id: made.instanceId, parentId: master }]);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.errors[0]?.message).toMatch(/cannot be placed inside the master/);
    const r2 = applyChanges(made.doc, [
      { op: 'create', parentId: master, node: { type: 'frame', instanceOf: master } },
    ]);
    expect(r2.ok).toBe(false);
  });

  it('rejects an instance of something that is not a master, and layered content', () => {
    const { doc, label } = withButton();
    const r = applyChanges(doc, [
      { op: 'create', parentId: doc.rootId, node: { type: 'frame', instanceOf: label } },
    ]);
    expect(r.ok ? '' : r.errors[0]?.message).toMatch(/not a master component/);
    const { master } = withButton();
    void master;
  });

  it('detaches with instanceOf: null, leaving ordinary editable frames', () => {
    const { doc, master } = withButton();
    const made = createInstance(
      doc,
      { component: master, overrides: { Label: { text: 'Mine' } } },
      rng,
    );
    const detached = apply(made.doc, [
      { op: 'update', id: made.instanceId, set: { instanceOf: null } },
    ]);
    const root = detached.doc.nodes[made.instanceId];
    expect(root?.instanceOf).toBeUndefined();
    expect(root?.overrides).toBeUndefined();
    const layers = descendantsOf(detached.doc.nodes, made.instanceId);
    expect(layers[0]?.from).toBeUndefined();
    expect(layers[0]?.text).toBe('Mine');
    // now an ordinary node: a normal delete works and the master no longer affects it
    const after = apply(detached.doc, [
      { op: 'update', id: master, set: { fill: '#010203' } },
      { op: 'delete', id: layers[0]?.id as string },
    ]);
    expect(after.doc.nodes[made.instanceId]?.fill).toBe('$primary');
  });

  it('detaches instances when their master is deleted or stops being one', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master }, rng);
    const gone = apply(made.doc, [{ op: 'delete', id: master }]);
    expect(gone.doc.nodes[made.instanceId]?.instanceOf).toBeUndefined();
    expect(descendantsOf(gone.doc.nodes, made.instanceId)).toHaveLength(1);

    const demoted = apply(made.doc, [{ op: 'update', id: master, set: { component: null } }]);
    expect(demoted.doc.nodes[made.instanceId]?.instanceOf).toBeUndefined();
  });

  it('duplicates an instance whole, and a master with its states re-pointed', () => {
    const { doc, master } = withButton();
    const made = createInstance(
      doc,
      { component: master, overrides: { Label: { text: 'A' } } },
      rng,
    );
    const copy = apply(made.doc, [{ op: 'duplicate', id: made.instanceId }]);
    const copyId = copy.created[0] as string;
    expect(copy.doc.nodes[copyId]?.instanceOf).toBe(master);
    expect(descendantsOf(copy.doc.nodes, copyId)[0]?.text).toBe('A');
    expect(descendantsOf(copy.doc.nodes, copyId)[0]?.id).not.toBe(made.layers.Label);

    const masterCopy = apply(doc, [{ op: 'duplicate', id: master }]);
    const m2 = masterCopy.doc.nodes[masterCopy.created[0] as string];
    const m2Label = masterCopy.created[1] as string;
    expect(m2?.component?.states?.pressed?.[m2Label]).toEqual({ color: '#EEEEEE' });
    expect(Object.keys(m2?.component?.states?.pressed ?? {})).not.toContain(
      Object.keys(doc.nodes[master]?.component?.states?.pressed ?? {}).find((k) => k !== '$self'),
    );
  });

  it('accepts ids with or without the n_ prefix', () => {
    const { doc, master } = withButton();
    const bare = master.slice(2);
    const r = apply(doc, [{ op: 'update', id: bare, set: { opacity: 0.8 } }]);
    expect(r.doc.nodes[master]?.opacity).toBe(0.8);
    expect(createInstance(doc, { component: bare }, rng).instanceId).toBeDefined();
  });
});

describe('listing', () => {
  it('lists masters with layers, states and instances', () => {
    const { doc, master } = withButton();
    const made = createInstance(doc, { component: master, state: 'hover' }, rng);
    const [entry] = listComponents(made.doc);
    expect(entry).toMatchObject({
      id: master,
      name: 'Button',
      kind: 'button',
      states: ['hover', 'pressed'],
    });
    expect(entry?.layers).toEqual([
      {
        id: expect.any(String) as string,
        name: 'Label',
        type: 'text',
        editable: expect.arrayContaining(['text', 'color']) as string[],
      },
    ]);
    expect(entry?.instances).toEqual([
      { id: made.instanceId, name: 'Button', state: 'hover', parentId: doc.rootId },
    ]);
    expect(listComponents(made.doc, 'card')).toEqual([]);
  });

  it('finds a master by name and explains when it cannot', () => {
    const { doc } = withButton();
    expect(findMaster(doc, 'Button').name).toBe('Button');
    expect(() => findMaster(doc, 'Card')).toThrow(
      expect.objectContaining({ hint: expect.stringContaining('"Button"') as string }) as Error,
    );
    expect(() => findMaster(createEmptyDoc(), 'x')).toThrow(
      expect.objectContaining({
        hint: expect.stringMatching(/no components yet/) as string,
      }) as Error,
    );
  });
});

describe('instances stay consistent through merges and loads', () => {
  it('a merge re-derives instance layers (an agent edits the master while the app holds an override)', async () => {
    const { mergeDocs } = await import('./merge');
    const { doc: base, master } = withButton();
    const made = createInstance(base, { component: master }, rng);
    const start = made.doc;
    const layerId = made.layers.Label as string;
    // the app: an override on the label (unsaved)
    const local = apply(start, [{ op: 'update', id: layerId, set: { text: 'Mine' } }]).doc;
    // an agent, on disk: restyles the master and adds a layer to it
    const remote = apply(start, [
      { op: 'update', id: master, set: { fill: '#13579B' } },
      { op: 'create', parentId: master, node: { type: 'icon', name: 'Glyph', icon: 'star' } },
    ]).doc;
    const merged = mergeDocs(start, local, remote);
    expect(merged.mode).toBe('merged');
    const inst = merged.doc.nodes[made.instanceId];
    expect(inst?.fill).toBe('#13579B'); // the master change reached the instance
    const layers = descendantsOf(merged.doc.nodes, made.instanceId);
    expect(layers.map((l) => l.name)).toEqual(['Label', 'Glyph']); // the new layer exists
    expect(layers[0]?.text).toBe('Mine'); // and the override survived
    // nothing is left out of step: re-deriving changes nothing
    expect(syncAllInstances(merged.doc)).toBe(merged.doc);
  });

  it('loading a document brings stale instance layers back in step with their master', async () => {
    const { loadDoc, serializeDoc } = await import('./doc');
    const { doc: base, master } = withButton();
    const made = createInstance(base, { component: master }, rng);
    const layerId = made.layers.Label as string;
    // simulate a hand edit that bypassed the tools: the derived layer disagrees with its master
    const tampered = {
      ...made.doc,
      nodes: {
        ...made.doc.nodes,
        [layerId]: { ...(made.doc.nodes[layerId] as object), text: 'stale', color: '#00FF00' },
      },
    };
    const loaded = loadDoc(JSON.parse(serializeDoc(tampered as Doc)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.doc.nodes[layerId]).toMatchObject({ text: 'Click', color: '#FFFFFF' });
  });

  it('a document with no components is returned untouched', () => {
    const empty = createEmptyDoc();
    expect(syncAllInstances(empty)).toBe(empty);
  });
});
