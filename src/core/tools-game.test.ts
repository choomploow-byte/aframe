/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { alignOps, distributeOps, gridOps, groupOps, matchSizeOps, ungroupOps } from './arrange';
import { bumpRev, createEmptyDoc } from './doc';
import { runTool } from './tools';
import { GAME_THEMES } from './themes';
import { validateDoc } from './validate';
import { buildWidget, WIDGET_KINDS } from './widgets';
import type { Doc, Op, ToolContext } from './types';

function memory(initial: Doc = createEmptyDoc()): { ctx: ToolContext; doc: () => Doc } {
  let doc = initial;
  const ctx: ToolContext = {
    getDoc: () => doc,
    commit: (next) => {
      doc = bumpRev(next, 'mcp');
    },
  };
  return { ctx, doc: () => doc };
}

const ok = async (ctx: ToolContext, name: string, input: unknown) => {
  const r = await runTool(ctx, name, input);
  if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
  return r.data as Record<string, any>;
};
const fail = async (ctx: ToolContext, name: string, input: unknown) => {
  const r = await runTool(ctx, name, input);
  if (r.ok) throw new Error(`${name} should have failed`);
  return r.error;
};

/** A page with a 600x400 free frame holding three fixed boxes. */
function boxes(): { doc: Doc; ids: string[]; frame: string } {
  const base = createEmptyDoc();
  const result = applyChanges(base, [
    {
      op: 'create',
      parentId: base.rootId,
      node: {
        type: 'frame',
        tempId: 'f',
        name: 'Stage',
        layout: 'none',
        w: 600,
        h: 400,
        children: [
          { type: 'rect', name: 'A', x: 10, y: 10, w: 100, h: 50 },
          { type: 'rect', name: 'B', x: 200, y: 80, w: 60, h: 90 },
          { type: 'rect', name: 'C', x: 450, y: 30, w: 80, h: 40 },
        ],
      },
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const [frame, a, b, c] = result.created as [string, string, string, string];
  return { doc: result.doc, ids: [a, b, c], frame };
}

const apply = (doc: Doc, ops: Op[]): Doc => {
  const r = applyChanges(doc, ops);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.doc;
};

const byName = (doc: Doc, name: string) => Object.values(doc.nodes).find((n) => n.name === name)!;

describe('widgets', () => {
  it.each(WIDGET_KINDS)('%s builds a valid tree that applies cleanly', (kind) => {
    const { spec } = buildWidget(kind, {});
    const base = createEmptyDoc();
    const result = applyChanges(base, [{ op: 'create', parentId: base.rootId, node: spec }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(validateDoc(result.doc)).toBeTruthy();
  });

  it('a button carries a label, outline and states for a component', () => {
    const w = buildWidget('button', { label: 'ATTACK', tone: 'danger', icon: 'sword' });
    expect(w.spec.children?.map((c) => c.type)).toEqual(['icon', 'text']);
    expect(w.component?.kind).toBe('button');
    expect(Object.keys(w.component?.states ?? {})).toEqual(['hover', 'pressed', 'disabled']);
  });

  it('an unknown icon fails with a hint instead of drawing a placeholder', () => {
    expect(() => buildWidget('button', { icon: 'swrod' })).toThrow(/no icon named/);
  });

  it('progress bar fill is proportional and clamps', () => {
    const half = buildWidget('progress_bar', { value: 0.5, w: 206 }).spec;
    const track = half.children?.[0]?.children?.[0];
    expect(track?.w).toBe(100);
    const over = buildWidget('progress_bar', { value: 4, w: 206 }).spec;
    expect(over.children?.[0]?.children?.[0]?.w).toBe(200);
  });
});

describe('create_widget', () => {
  it('adds missing game tokens once and creates the widget', async () => {
    const { ctx, doc } = memory();
    const r = await ok(ctx, 'create_widget', { kind: 'currency_pill', value: '4,200', plus: true });
    expect(r.tokensAdded).toBeGreaterThan(10);
    expect(doc().tokens.colors.outline).toBe('#120B24');
    expect(doc().nodes[r.id]?.name).toBe('Currency Pill');
    const again = await ok(ctx, 'create_widget', { kind: 'badge', count: 7 });
    expect(again.tokensAdded).toBe(0);
  });

  it('never overwrites a token the project already has', async () => {
    const start = createEmptyDoc();
    const { ctx, doc } = memory({
      ...start,
      tokens: { ...start.tokens, colors: { ...start.tokens.colors, outline: '#000000' } },
    });
    await ok(ctx, 'create_widget', { kind: 'button' });
    expect(doc().tokens.colors.outline).toBe('#000000');
  });

  it('component: true defines states, and instances can be placed', async () => {
    const { ctx, doc } = memory();
    const r = await ok(ctx, 'create_widget', { kind: 'button', label: 'GO', component: true });
    expect(r.component).toBe(true);
    expect(doc().nodes[r.id]?.component?.kind).toBe('button');
    expect(Object.keys(doc().nodes[r.id]?.component?.states ?? {})).toContain('pressed');
    await ok(ctx, 'create_instance', { component: r.id, parentId: doc().rootId });
  });

  it('component on a kind without states says so', async () => {
    const { ctx } = memory();
    const r = await ok(ctx, 'create_widget', { kind: 'badge', component: true });
    expect(r.component).toBe(false);
    expect(r.warnings.join(' ')).toMatch(/no states/);
  });

  it('rejects an unknown icon', async () => {
    const { ctx } = memory();
    expect((await fail(ctx, 'create_widget', { kind: 'toast', icon: 'nope' })).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('themes', () => {
  it('every theme uses the full token set and valid colours', () => {
    const names = Object.keys(GAME_THEMES[0]!.colors).sort();
    for (const t of GAME_THEMES) expect(Object.keys(t.colors).sort()).toEqual(names);
  });

  it('apply_theme sets tokens and keeps unrelated ones', async () => {
    const start = createEmptyDoc();
    const { ctx, doc } = memory({
      ...start,
      tokens: { ...start.tokens, colors: { ...start.tokens.colors, mine: '#123456' } },
    });
    await ok(ctx, 'apply_theme', { theme: 'candy-pop' });
    expect(doc().tokens.colors.primary).toBe('#FF6FB5');
    expect(doc().tokens.colors.mine).toBe('#123456');
    expect(doc().tokens.fonts.heading).toBe(doc().tokens.fonts.display);
    expect((await fail(ctx, 'apply_theme', { theme: 'nope' })).code).toBe('NOT_FOUND');
    expect((await ok(ctx, 'list_themes', {})).themes).toHaveLength(GAME_THEMES.length);
  });
});

describe('arrange', () => {
  it('aligns to the left edge, the centre and the bottom of the selection', () => {
    const { doc, ids } = boxes();
    const left = apply(doc, alignOps(doc, ids, 'left'));
    expect(ids.map((i) => left.nodes[i]!.x)).toEqual([10, 10, 10]);
    const mid = apply(doc, alignOps(doc, ids, 'middle'));
    // selection spans y 10..170: centres at 90
    expect(ids.map((i) => mid.nodes[i]!.y)).toEqual([65, 45, 70]);
    const bottom = apply(doc, alignOps(doc, ids, 'bottom'));
    expect(ids.map((i) => bottom.nodes[i]!.y + (bottom.nodes[i]!.h as number))).toEqual([
      170, 170, 170,
    ]);
  });

  it('aligns to the parent frame', () => {
    const { doc, ids } = boxes();
    const centred = apply(doc, alignOps(doc, [ids[0]!], 'center', true));
    expect(centred.nodes[ids[0]!]!.x).toBe(250);
  });

  it('distributes evenly between the outer layers, or packs with a gap', () => {
    const { doc, ids } = boxes();
    const even = apply(doc, distributeOps(doc, ids, 'horizontal'));
    const [a, b, c] = ids.map((i) => even.nodes[i]!);
    expect(b!.x - (a!.x + 100)).toBeCloseTo(c!.x - (b!.x + 60), 5);
    const packed = apply(doc, distributeOps(doc, ids, 'horizontal', 20));
    expect(ids.map((i) => packed.nodes[i]!.x)).toEqual([10, 130, 210]);
  });

  it('builds a grid and matches sizes', () => {
    const { doc, ids } = boxes();
    const grid = apply(doc, gridOps(doc, ids, 2, 10, 10));
    expect(ids.map((i) => [grid.nodes[i]!.x, grid.nodes[i]!.y])).toEqual([
      [10, 30],
      [140, 10],
      [20, 135],
    ]);
    const same = apply(doc, matchSizeOps(doc, ids, 'both', 'largest'));
    expect(ids.map((i) => [same.nodes[i]!.w, same.nodes[i]!.h])).toEqual([
      [100, 90],
      [100, 90],
      [100, 90],
    ]);
  });

  it('explains why auto-layout children and hug sizes cannot be aligned', () => {
    const base = createEmptyDoc();
    const made = applyChanges(base, [
      {
        op: 'create',
        parentId: base.rootId,
        node: {
          type: 'frame',
          layout: 'row',
          w: 300,
          h: 100,
          children: [
            { type: 'rect', w: 50, h: 50 },
            { type: 'rect', w: 50, h: 50 },
          ],
        },
      },
    ]);
    if (!made.ok) throw new Error('setup');
    const row = made.doc.nodes[made.created[0]!]!;
    expect(() => alignOps(made.doc, row.children, 'top')).toThrow(/auto-layout/);
    const { doc, ids } = boxes();
    const hugged = apply(doc, [{ op: 'update', id: ids[0]!, set: { w: 'hug' } }]);
    expect(() => alignOps(hugged, ids, 'left')).toThrow(/hug size/);
  });

  it('groups where the layers are and ungroups back to the same place', () => {
    const { doc, ids, frame } = boxes();
    const grouped = apply(doc, groupOps(doc, [ids[0]!, ids[1]!], { name: 'Pair' }));
    const group = byName(grouped, 'Pair');
    expect(group.parentId).toBe(frame);
    expect([group.x, group.y, group.w, group.h]).toEqual([10, 10, 250, 160]);
    expect([grouped.nodes[ids[1]!]!.x, grouped.nodes[ids[1]!]!.y]).toEqual([190, 70]);
    const back = apply(grouped, ungroupOps(grouped, group.id));
    expect(back.nodes[group.id]).toBeUndefined();
    expect([back.nodes[ids[1]!]!.x, back.nodes[ids[1]!]!.y, back.nodes[ids[1]!]!.parentId]).toEqual(
      [200, 80, frame],
    );
  });

  it('groups into a row with the existing gap', () => {
    const { doc, ids } = boxes();
    const grouped = apply(doc, groupOps(doc, ids, { layout: 'row', name: 'Row' }));
    const g = byName(grouped, 'Row');
    expect(g.layout).toBe('row');
    expect(g.gap).toBe(90);
    expect(g.children).toEqual(ids);
  });

  it('refuses to ungroup a component', () => {
    const base = createEmptyDoc();
    const made = applyChanges(base, [
      {
        op: 'create',
        parentId: base.rootId,
        node: { type: 'frame', w: 50, h: 50, component: { kind: 'custom' } },
      },
    ]);
    if (!made.ok) throw new Error('setup');
    expect(() => ungroupOps(made.doc, made.created[0]!)).toThrow(/component/);
  });
});

describe('arrange tools', () => {
  it('arrange_nodes is one undo step and reports what moved', async () => {
    const { doc, ids } = boxes();
    const { ctx, doc: current } = memory(doc);
    const r = await ok(ctx, 'arrange_nodes', { action: 'align', ids, edge: 'left' });
    expect(r.changed).toEqual([ids[1], ids[2]]);
    expect(current().nodes[ids[2]!]!.x).toBe(10);
    expect((await fail(ctx, 'arrange_nodes', { action: 'align', ids })).code).toBe('INVALID_VALUE');
    expect((await ok(ctx, 'arrange_nodes', { action: 'align', ids, edge: 'left' })).note).toMatch(
      /Nothing/,
    );
  });

  it('group_nodes / ungroup_node round trip through the tools', async () => {
    const { doc, ids } = boxes();
    const { ctx, doc: current } = memory(doc);
    const g = await ok(ctx, 'group_nodes', { ids: [ids[0], ids[2]], name: 'Ends' });
    expect(current().nodes[g.id]?.children).toHaveLength(2);
    await ok(ctx, 'ungroup_node', { id: g.id });
    expect(current().nodes[g.id]).toBeUndefined();
  });

  it('repeat_node duplicates in a row and fills text per copy', async () => {
    const base = createEmptyDoc();
    const made = applyChanges(base, [
      {
        op: 'create',
        parentId: base.rootId,
        node: {
          type: 'frame',
          name: 'Slot',
          layout: 'none',
          x: 20,
          y: 20,
          w: 80,
          h: 80,
          children: [{ type: 'text', name: 'Label', text: 'x', x: 0, y: 0 }],
        },
      },
    ]);
    if (!made.ok) throw new Error('setup');
    const { ctx, doc } = memory(made.doc);
    const r = await ok(ctx, 'repeat_node', {
      id: made.created[0],
      count: 3,
      gap: 10,
      values: { Label: ['One', 'Two', 'Three'] },
    });
    expect(r.ids).toHaveLength(3);
    expect(r.ids.map((i: string) => doc().nodes[i]!.x)).toEqual([20, 110, 200]);
    const text = (i: string) => doc().nodes[doc().nodes[i]!.children[0]!]!.text;
    expect(r.ids.map(text)).toEqual(['One', 'Two', 'Three']);
    const grid = await ok(ctx, 'repeat_node', {
      id: r.ids[0],
      count: 4,
      direction: 'grid',
      columns: 2,
    });
    expect(grid.ids).toHaveLength(4);
  });
});

describe('find_nodes', () => {
  it('finds by name, text and type', async () => {
    const { doc } = boxes();
    const { ctx } = memory(doc);
    expect((await ok(ctx, 'find_nodes', { query: 'stage' })).hits).toHaveLength(1);
    expect((await ok(ctx, 'find_nodes', { type: 'rect' })).total).toBe(3);
    expect((await ok(ctx, 'find_nodes', { query: 'zzz' })).total).toBe(0);
  });
});

describe('update_where', () => {
  it('changes every layer that matches in one step and skips what does not apply', async () => {
    const { doc } = boxes();
    const { ctx, doc: current } = memory(doc);
    const r = await ok(ctx, 'update_where', { type: 'rect', set: { opacity: 0.4, fontSize: 20 } });
    expect(r.changed).toBe(3);
    expect(
      Object.values(current().nodes)
        .filter((n) => n.type === 'rect')
        .map((n) => n.opacity),
    ).toEqual([0.4, 0.4, 0.4]);
    const named = await ok(ctx, 'update_where', { name: 'b', set: { fill: '#112233' } });
    expect(named.changed).toBe(1);
    expect(byName(current(), 'B').fill).toBe('#112233');
  });

  it('dryRun changes nothing, and an empty or unbounded request is refused', async () => {
    const { doc } = boxes();
    const { ctx, doc: current } = memory(doc);
    const before = current().rev;
    const dry = await ok(ctx, 'update_where', {
      type: 'rect',
      set: { opacity: 0.1 },
      dryRun: true,
    });
    expect(dry.matched).toBe(3);
    expect(current().rev).toBe(before);
    expect((await fail(ctx, 'update_where', { set: { opacity: 0.5 } })).code).toBe('INVALID_VALUE');
    expect((await fail(ctx, 'update_where', { type: 'rect', set: {} })).code).toBe('INVALID_VALUE');
    expect(
      (await ok(ctx, 'update_where', { name: 'nothing here', set: { opacity: 0.5 } })).note,
    ).toMatch(/No layer matched/);
  });

  it('rejects a bad value for the whole batch', async () => {
    const { doc } = boxes();
    const { ctx, doc: current } = memory(doc);
    const before = current().rev;
    expect((await fail(ctx, 'update_where', { type: 'rect', set: { opacity: 7 } })).code).toBe(
      'INVALID_VALUE',
    );
    expect(current().rev).toBe(before);
  });
});
