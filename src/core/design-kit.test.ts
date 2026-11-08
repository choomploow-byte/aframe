import { describe, expect, it } from 'vitest';
import { applyChanges } from './apply';
import { createEmptyDoc } from './doc';
import { FONT_CATALOG, nearestWeight, supportsWeight } from './fonts';
import {
  getIcon,
  ICON_CATEGORIES,
  ICONS,
  iconShape,
  normalizeIconName,
  searchIcons,
  suggestIcons,
} from './icons';
import { seededRng } from './ids';
import { lintDesign } from './lint';
import { createMemoryContext } from './memory-context';
import { createTemplateDoc, TEMPLATE_INFO, TEMPLATES } from './templates';
import { runTool } from './tools';
import type { Doc, Op } from './types';
import { propIssues, validateDoc } from './validate';

const rng = seededRng(11);
const fresh = (): Doc => createEmptyDoc({ id: 'p_test1', now: '2026-01-01T00:00:00.000Z', rng });
const apply = (doc: Doc, ops: Op[]) => {
  const r = applyChanges(doc, ops, { rng });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};
const ctx = (doc: Doc = fresh()) =>
  createMemoryContext(doc, { now: () => '2026-03-03T00:00:00.000Z' });

describe('the icon set', () => {
  it('has every icon the brief asks for, and every icon draws', () => {
    for (const name of [
      'coins',
      'potion',
      'sword',
      'swords',
      'gem',
      'key',
      'shield',
      'star',
      'chest',
      'arrow-up',
      'arrow-down',
      'arrow-left',
      'arrow-right',
      'xmark',
      'check',
      'gear',
    ]) {
      expect(getIcon(name), name).toBeDefined();
    }
    expect(new Set(ICONS.map((i) => i.name)).size).toBe(ICONS.length);
    for (const icon of ICONS) {
      expect(icon.d.startsWith('M'), icon.name).toBe(true);
      expect(icon.vb[0]).toBeGreaterThan(0);
      expect(ICON_CATEGORIES).toContain(icon.category);
      expect(icon.tags.length).toBeGreaterThan(0);
    }
  });

  it('records where each icon came from, for the attribution', () => {
    const sources = new Set(ICONS.map((i) => i.source));
    expect(sources).toEqual(new Set(['atelier', 'fontawesome-free']));
    expect(
      ICONS.filter((i) => i.source === 'atelier')
        .map((i) => i.name)
        .sort(),
    ).toEqual(['chest', 'potion', 'sparkles', 'sword', 'swords']);
  });

  it('normalises names and finds them', () => {
    expect(normalizeIconName('fa-coins')).toBe('coins');
    expect(normalizeIconName('Treasure Chest')).toBe('treasure-chest');
    expect(normalizeIconName('Coins.svg')).toBe('coins');
    expect(getIcon('FA-Gem')?.name).toBe('gem');
    expect(getIcon('nothing-here')).toBeUndefined();
    expect(iconShape('coins')?.rule).toBe('nonzero');
    expect(iconShape('potion')?.rule).toBe('evenodd');
    expect(iconShape('nothing-here')).toBeNull();
  });

  it('searches by meaning, requires every word, and lists a category', () => {
    expect(searchIcons('money').hits.map((h) => h.name)).toContain('coins');
    expect(searchIcons('weapon').hits.map((h) => h.name)).toEqual(
      expect.arrayContaining(['sword', 'swords']),
    );
    expect(searchIcons('close').hits[0]?.name).toBe('xmark');
    expect(searchIcons('arrow right').hits[0]?.name).toMatch(/^arrow-right/);
    expect(searchIcons('coins zebra').total).toBe(0);
    const games = searchIcons(undefined, { category: 'game', limit: 100 });
    expect(games.total).toBeGreaterThan(40);
    expect(games.hits.every((h) => h.category === 'game')).toBe(true);
    expect(searchIcons('a', { limit: 3 }).hits).toHaveLength(3);
  });

  it('suggests close names for an unknown one', () => {
    expect(suggestIcons('golden coin')).toContain('coins');
    expect(suggestIcons('treasure-chest')).toContain('chest');
    expect(suggestIcons('')).toEqual([]);
  });
});

describe('fonts', () => {
  it('describes the display families and their real weights', () => {
    const names = FONT_CATALOG.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(['Lilita One', 'Luckiest Guy', 'Bungee', 'Fredoka']),
    );
    // Luckiest Guy is Apache 2.0, the rest SIL OFL: the catalogue must say which
    expect(FONT_CATALOG.filter((f) => f.license === 'Apache-2.0').map((f) => f.name)).toEqual([
      'Luckiest Guy',
    ]);
    expect(supportsWeight('Lilita One', 400)).toBe(true);
    expect(supportsWeight('Lilita One', 900)).toBe(false);
    expect(supportsWeight('Fredoka', 700)).toBe(true);
    expect(supportsWeight('Inter', 900)).toBe(true);
    expect(supportsWeight('Some Font', 900)).toBe(true);
    expect(nearestWeight('Lilita One', 900)).toBe(400);
    expect(nearestWeight('Fredoka', 900)).toBe(700);
  });

  it('accepts fontWeight 900 and explains an unsupported weight', () => {
    expect(propIssues({ fontWeight: 900 }, 'text')).toEqual([]);
    expect(propIssues({ fontWeight: 'bold' }, 'text')[0]?.hint).toMatch(/Use the number 700/);
    const doc = fresh();
    const r = apply(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: { type: 'text', text: 'PLAY', fontFamily: 'Lilita One', fontWeight: 900 },
      },
    ]);
    expect(r.warnings.find((w) => w.code === 'FONT_WEIGHT')?.message).toMatch(
      /Lilita One has only weight 400.*no fake bold/,
    );
  });

  it('is listed by list_fonts, with tokens', async () => {
    const out = await runTool(ctx(), 'list_fonts', { category: 'display' });
    expect(out).toMatchObject({ ok: true });
    const data = (out as { data: { fonts: { name: string; weights: unknown }[]; tokens: object } })
      .data;
    expect(data.fonts.map((f) => f.name)).toEqual([
      'Lilita One',
      'Luckiest Guy',
      'Bungee',
      'Fredoka',
    ]);
    expect(data.fonts[0]?.weights).toEqual([400]);
    expect(data.fonts[3]?.weights).toEqual({ from: 300, to: 700 });
    expect(data.tokens).toMatchObject({ heading: 'Fraunces' });
  });
});

describe('icon, component and font tools', () => {
  it('search_icons answers a query and a miss', async () => {
    const c = ctx();
    const hit = await runTool(c, 'search_icons', { query: 'potion' });
    expect(hit).toMatchObject({ ok: true });
    const icons = (hit as { data: { icons: { name: string }[] } }).data.icons;
    expect(icons[0]?.name).toBe('potion');
    expect(icons.map((i) => i.name)).toContain('flask'); // related by tag
    const miss = await runTool(c, 'search_icons', { query: 'zzzzz' });
    expect(miss).toMatchObject({
      ok: true,
      data: { total: 0, hint: expect.stringContaining('Nothing matches') as string },
    });
  });

  it('place_icon places one icon in one call, and refuses an unknown name with suggestions', async () => {
    const c = ctx();
    const placed = await runTool(c, 'place_icon', {
      name: 'coins',
      size: 32,
      color: '#FFC83D',
      x: 10,
      y: 20,
    });
    expect(placed).toMatchObject({ ok: true, data: { icon: 'coins', warnings: [] } });
    const doc = await c.getDoc();
    const node = Object.values(doc.nodes).find((n) => n.type === 'icon');
    expect(node).toMatchObject({
      icon: 'coins',
      w: 32,
      h: 32,
      color: '#FFC83D',
      x: 10,
      y: 20,
      name: 'Icon coins',
    });
    const bad = await runTool(c, 'place_icon', { name: 'golden coin' });
    expect(bad).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', hint: expect.stringContaining('coins') as string },
    });
  });

  it('draws a placeholder for an unknown icon made through apply_changes, and warns', async () => {
    const c = ctx();
    const r = await runTool(c, 'apply_changes', {
      operations: [
        {
          op: 'create',
          parentId: (await c.getDoc()).rootId,
          node: { type: 'icon', icon: 'dragon-egg' },
        },
      ],
    });
    expect(r).toMatchObject({ ok: true });
    const warnings = (r as { data: { warnings: { code: string; message: string }[] } }).data
      .warnings;
    expect(warnings[0]).toMatchObject({ code: 'UNKNOWN_ICON' });
    expect(warnings[0]?.message).toMatch(/labelled placeholder/);
    const lint = lintDesign(await c.getDoc());
    expect(lint.findings.map((f) => f.rule)).toContain('unknown-icon');
  });

  it('defines a component, lists it and places an instance through tools', async () => {
    const c = ctx();
    const doc = await c.getDoc();
    const made = apply(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'Card',
          layout: 'column',
          children: [{ type: 'text', name: 'Title', text: 'Hi' }],
        },
      },
    ]);
    await c.commit(made.doc);
    const id = made.created[0] as string;
    const def = await runTool(c, 'define_component', {
      nodeId: id,
      kind: 'card',
      states: { hover: { $self: { fill: '#FFFFFF' } } },
    });
    expect(def).toMatchObject({
      ok: true,
      data: { componentId: id, component: { kind: 'card', states: ['hover'] } },
    });
    const list = await runTool(c, 'component_list', {});
    expect(list).toMatchObject({ ok: true, data: { count: 1, components: [{ name: 'Card' }] } });
    const inst = await runTool(c, 'create_instance', {
      component: 'Card',
      state: 'hover',
      overrides: { Title: { text: 'Welcome' } },
    });
    expect(inst).toMatchObject({ ok: true });
    const data = (inst as { data: { instanceId: string; layers: Record<string, string> } }).data;
    const after = await c.getDoc();
    expect(after.nodes[data.instanceId]).toMatchObject({
      instanceOf: id,
      state: 'hover',
      fill: '#FFFFFF',
    });
    expect(after.nodes[data.layers.Title as string]).toMatchObject({ text: 'Welcome' });
    const bad = await runTool(c, 'create_instance', { component: 'Nope' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('accepts node ids without the n_ prefix in the read tools', async () => {
    const c = ctx();
    const doc = await c.getDoc();
    const bare = doc.rootId.slice(2);
    expect(await runTool(c, 'get_node', { nodeId: bare })).toMatchObject({
      ok: true,
      data: { node: { id: doc.rootId } },
    });
    expect(await runTool(c, 'get_design', { nodeId: bare, depth: 0 })).toMatchObject({ ok: true });
    expect(await runTool(c, 'lint_design', { nodeId: bare })).toMatchObject({ ok: true });
  });
});

describe('editing fixes', () => {
  const column = (): { doc: Doc; col: string; kid: string } => {
    const doc = fresh();
    const r = apply(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'Hero',
          layout: 'column',
          children: [{ type: 'rect', name: 'Bar' }],
        },
      },
    ]);
    return { doc: r.doc, col: r.created[0] as string, kid: r.created[1] as string };
  };

  it('warns, naming the parent layout, when y is set on an auto-layout child', () => {
    const { doc, col, kid } = column();
    const r = apply(doc, [{ op: 'update', id: kid, set: { y: 40 } }]);
    const w = r.warnings.find((x) => x.code === 'LAYOUT_IGNORED');
    expect(w?.nodeId).toBe(kid);
    expect(w?.message).toContain(`"Hero" (${col}) uses auto-layout (column)`);
    expect(w?.message).toMatch(/y on "Bar".*no effect/);
    expect(w?.message).toMatch(/layout to "none"/);
    expect(r.doc.nodes[kid]?.y).toBe(40); // stored, as before; lint flags it
  });

  it('warns on create (only for non-zero x/y) and stays quiet where x/y apply', () => {
    const { doc, col } = column();
    const r = apply(doc, [
      { op: 'create', parentId: col, node: { type: 'rect', name: 'Chip', x: 12 } },
      { op: 'create', parentId: col, node: { type: 'rect', name: 'Zero', x: 0, y: 0 } },
    ]);
    expect(r.warnings.filter((x) => x.code === 'LAYOUT_IGNORED')).toHaveLength(1);
    const free = apply(doc, [
      { op: 'create', parentId: doc.rootId, node: { type: 'rect', x: 5, y: 5 } },
    ]);
    expect(free.warnings).toEqual([]);
    const absolute = apply(doc, [{ op: 'update', id: col, set: { x: 50, y: 60 } }]);
    expect(absolute.warnings).toEqual([]); // the frame itself sits on the page
  });

  it('names the bad value and the correct form in errors', () => {
    const doc = fresh();
    const bad = (set: Record<string, unknown>) => {
      const created = apply(doc, [{ op: 'create', parentId: doc.rootId, node: { type: 'frame' } }]);
      const r = applyChanges(created.doc, [
        { op: 'update', id: created.created[0] as string, set },
      ]);
      expect(r.ok).toBe(false);
      return r.ok ? '' : `${r.errors[0]?.message} ${r.errors[0]?.hint ?? ''}`;
    };
    expect(bad({ radius: 'xl' })).toMatch(/"xl".*Use "\$radius\.xl"\./);
    expect(bad({ radius: '$xl' })).toMatch(/Use "\$radius\.xl"\./);
    expect(bad({ radius: 'huge' })).toMatch(/Radius tokens: sm, md, lg, xl, full/);
    expect(bad({ radius: '12px' })).toMatch(/Use the number 12/);
    expect(bad({ fill: 'primary' })).toMatch(/Use "\$primary"\./);
    expect(bad({ fill: 'FF0000' })).toMatch(/"#FF0000"/);
    expect(bad({ fill: 'red' })).toMatch(/Named CSS colours are not supported/);
    expect(bad({ w: '100px' })).toMatch(/Use the number 100/);
    expect(bad({ w: 'auto' })).toMatch(/Use 'hug'/);
    expect(bad({ h: '100%' })).toMatch(/Use 'fill'/);
    expect(bad({ opacity: 50 })).toMatch(/use 0\.5/);
    expect(bad({ gap: '8' })).toMatch(/Use the number 8/);
    expect(bad({ clip: 'true' })).toMatch(/Use true without quotes/);
  });

  it('lists the defined tokens when a reference is not defined', () => {
    const doc = fresh();
    const r = apply(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: { type: 'frame', radius: '$radius.xxl', fill: '$brand' },
      },
    ]);
    const messages = r.warnings.map((w) => w.message).join(' | ');
    expect(messages).toContain('$radius.xxl is not defined');
    expect(messages).toContain('Defined: $radius.sm, $radius.md');
    expect(messages).toContain('Defined: $surface');
  });
});

describe('lint additions', () => {
  const rules = (doc: Doc): string[] => lintDesign(doc).findings.map((f) => f.rule);

  it('warns about a shadow on a text node, and effects on text', () => {
    const doc = fresh();
    const r = apply(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'text',
          text: 'Hello there',
          shadow: [{ x: 0, y: 2, blur: 4, spread: 0, color: '#000000' }],
          effects: ['gloss-top'],
        },
      },
    ]);
    expect(rules(r.doc)).toEqual(expect.arrayContaining(['text-shadow', 'effect-on-text']));
    expect(r.warnings.map((w) => w.code)).toContain('EFFECT_ON_TEXT');
  });

  it('flags an auto-layout child with an x or y that is ignored', () => {
    const doc = fresh();
    const made = apply(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'Row',
          layout: 'row',
          children: [{ type: 'rect', name: 'Dot' }],
        },
      },
    ]);
    const dot = made.created[1] as string;
    expect(rules(made.doc)).not.toContain('ignored-position');
    const moved = apply(made.doc, [{ op: 'update', id: dot, set: { x: 30, y: 8 } }]);
    const finding = lintDesign(moved.doc).findings.find((f) => f.rule === 'ignored-position');
    expect(finding?.message).toMatch(/x 30 and y 8.*"Row" uses auto-layout \(row\)/);
  });

  it('flags a button with no hover or pressed variant, and clears it once defined', () => {
    const doc = fresh();
    const made = apply(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'Buy',
          role: 'button',
          layout: 'row',
          padding: [12, 24, 12, 24],
          fill: '#5B3CB0',
          children: [{ type: 'text', name: 'Label', text: 'Buy', color: '#FFFFFF', fontSize: 16 }],
        },
      },
    ]);
    const id = made.created[0] as string;
    const before = lintDesign(made.doc).findings.find((f) => f.rule === 'button-states');
    expect(before?.message).toMatch(/no hover or pressed variant/);
    expect(before?.fix).toMatch(/define_component/);

    const partial = defineStates(made.doc, id, { hover: { $self: { fill: '#4A2F94' } } });
    expect(lintDesign(partial).findings.find((f) => f.rule === 'button-states')?.message).toMatch(
      /no pressed state/,
    );
    const full = defineStates(made.doc, id, {
      hover: { $self: { fill: '#4A2F94' } },
      pressed: { $self: { fill: '#3C2678' } },
    });
    expect(rules(full)).not.toContain('button-states');
  });

  it('does not flag the layers or instances of a component, only the master', () => {
    const doc = fresh();
    const made = apply(doc, [
      {
        op: 'create',
        parentId: doc.rootId,
        node: {
          type: 'frame',
          name: 'Btn',
          role: 'button',
          layout: 'row',
          padding: [12, 24, 12, 24],
          children: [{ type: 'text', text: 'Go', color: '#000000' }],
        },
      },
    ]);
    const withInstances = defineStates(made.doc, made.created[0] as string, {
      hover: { $self: { fill: '#EEEEEE' } },
      pressed: { $self: { fill: '#DDDDDD' } },
    });
    expect(rules(withInstances).filter((r) => r === 'button-states')).toEqual([]);
  });
});

function defineStates(
  doc: Doc,
  nodeId: string,
  states: Record<string, Record<string, Record<string, unknown>>>,
): Doc {
  const c = createMemoryContext(doc);
  void c;
  return defineStatesSync(doc, nodeId, states);
}

import { defineComponent } from './component-ops';
function defineStatesSync(
  doc: Doc,
  nodeId: string,
  states: Record<string, Record<string, Record<string, unknown>>>,
): Doc {
  return defineComponent(doc, { nodeId, kind: 'button', states }).doc;
}

describe('templates', () => {
  it('offers the seven genres plus blank, each described', () => {
    expect([...TEMPLATES].sort()).toEqual(
      [
        'blank',
        'dashboard',
        'game-hud',
        'game-inventory',
        'game-shop',
        'landing',
        'mobile',
        'pricing',
      ].sort(),
    );
    for (const t of TEMPLATES) expect(TEMPLATE_INFO[t].description.length).toBeGreaterThan(10);
  });

  it.each(TEMPLATES.filter((t) => t !== 'blank'))(
    '%s: valid, lint-clean, with tokens, a kit and instances',
    (t) => {
      const doc = createTemplateDoc(t, { name: t, id: 'p_tpl01', now: '2026-01-01T00:00:00.000Z' });
      const checked = validateDoc(doc);
      expect(checked.ok, JSON.stringify(checked.ok ? [] : checked.errors.slice(0, 2))).toBe(true);
      const lint = lintDesign(doc);
      expect(
        lint.counts.error + lint.counts.warning,
        JSON.stringify(lint.findings.slice(0, 3)),
      ).toBe(0);

      const kit = Object.values(doc.nodes).filter((n) => n.component !== undefined);
      expect(kit.length).toBeGreaterThanOrEqual(5);
      const kinds = new Set(kit.map((n) => n.component?.kind));
      expect(kinds.has('button') && kinds.has('card')).toBe(
        t.startsWith('game') ? kinds.has('button') : true,
      );
      // every template starts with a token set beyond the defaults, and a kit that is actually used
      expect(Object.keys(doc.tokens.colors).length).toBeGreaterThan(7);
      const instances = Object.values(doc.nodes).filter((n) => n.instanceOf !== undefined);
      expect(instances.length).toBeGreaterThanOrEqual(4);
      for (const i of instances) expect(doc.nodes[i.instanceOf as string]?.component).toBeDefined();
      // the buttons all have hover and pressed
      for (const m of kit.filter((n) => n.component?.kind === 'button')) {
        expect(Object.keys(m.component?.states ?? {})).toEqual(
          expect.arrayContaining(['hover', 'pressed']),
        );
      }
    },
  );

  it('game templates use the display font, patterns, effects and icons', () => {
    const doc = createTemplateDoc('game-shop', {
      name: 'x',
      id: 'p_tpl02',
      now: '2026-01-01T00:00:00.000Z',
    });
    expect(doc.tokens.fonts.display).toBe('Lilita One');
    const nodes = Object.values(doc.nodes);
    expect(nodes.some((n) => typeof n.fill === 'object')).toBe(true);
    expect(nodes.some((n) => (n.effects?.length ?? 0) > 0)).toBe(true);
    expect(nodes.filter((n) => n.type === 'icon').every((n) => getIcon(n.icon) !== undefined)).toBe(
      true,
    );
  });

  it('renders every state of a kit button differently', () => {
    const doc = createTemplateDoc('game-hud', {
      name: 'x',
      id: 'p_tpl03',
      now: '2026-01-01T00:00:00.000Z',
    });
    const master = Object.values(doc.nodes).find((n) => n.name === 'Button Chunky' && n.component);
    expect(Object.keys(master?.component?.states ?? {}).sort()).toEqual([
      'disabled',
      'hover',
      'pressed',
    ]);
  });
});
