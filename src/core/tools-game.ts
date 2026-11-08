/**
 * Tools that make game UI quicker to build and tidy: ready-made widgets, themes, and layer
 * arrangement (align, distribute, grid, group, repeat). Same rules as the other tool files:
 * handlers reach the world only through `ToolContext`, and every edit is one atomic, validated
 * `applyChanges` call that lands as one undo step.
 */
import * as z from 'zod/v4';
import { applyChanges } from './apply';
import {
  alignOps,
  distributeOps,
  gridOps,
  groupOps,
  matchSizeOps,
  repeatLayer,
  ungroupOps,
} from './arrange';
import { defineComponent } from './component-ops';
import { CoreError } from './errors';
import { lookupId } from './ops';
import { propsFor } from './props';
import { defineTool, ToolFailure, type Tool } from './tool-kit';
import { mergeTokens } from './token-edit';
import { findTheme, GAME_THEMES, themePatch } from './themes';
import type { Doc, Node, Op, ToolContext, Warning } from './types';
import {
  buildWidget,
  missingWidgetTokens,
  RARITIES,
  TONES,
  WIDGET_INFO,
  WIDGET_KINDS,
} from './widgets';

async function commit(ctx: ToolContext, next: Doc, label: string): Promise<number> {
  const before = await ctx.getDoc();
  if (next !== before) await ctx.commit(next, { source: 'agent', label });
  return (await ctx.getDoc()).rev;
}

function run(doc: Doc, ops: Op[]): { doc: Doc; created: string[]; warnings: Warning[] } {
  const result = applyChanges(doc, ops);
  if (!result.ok) {
    const [first] = result.errors;
    if (!first) throw new CoreError('INTERNAL', 'The edit failed without an error.');
    throw new ToolFailure(first, result.errors);
  }
  return { doc: result.doc, created: result.created, warnings: result.warnings };
}

const idList = z.array(z.string()).min(1).max(200);

// ---------------------------------------------------------------------------
// create_widget
// ---------------------------------------------------------------------------

const widgetList = WIDGET_KINDS.map((k) => `${k} (${WIDGET_INFO[k].uses})`).join('; ');

const createWidget = defineTool({
  name: 'create_widget',
  description: `Build a finished game-UI control in one call, styled with the project's tokens (missing game tokens are added, existing ones kept): chunky outlined buttons with gloss and a 3D ledge, currency pills, progress bars, item slots with rarity borders, shop cards, panels, modals, tabs, stat rows, star ratings, toggles, sliders, badges and toasts. Much better than hand-building them from rectangles. Kinds and their options: ${widgetList}. tone is primary, success, danger, info, purple, neutral or any #hex; rarity is common, rare, epic or legendary. Set component: true to also make buttons, slots and cards reusable components with hover/pressed/disabled/selected states (then place copies with create_instance). Returns the new node id; screenshot it afterwards.`,
  inputSchema: z.object({
    kind: z.enum(WIDGET_KINDS),
    parentId: z.string().optional().describe('Frame to put it in (default: the page)'),
    x: z.number().optional().describe('Only used in a layout "none" frame or on the page'),
    y: z.number().optional(),
    name: z.string().max(80).optional().describe('Layer name (default: the widget name)'),
    component: z
      .boolean()
      .optional()
      .describe('Also define it as a component with states (buttons, slots, cards)'),
    label: z
      .string()
      .max(200)
      .optional()
      .describe('Text on a button, banner, badge or toast; stat label'),
    icon: z.string().optional().describe('Icon name from search_icons'),
    tone: z
      .string()
      .optional()
      .describe(`${TONES.join(', ')} or a #hex colour`),
    size: z.enum(['sm', 'md', 'lg']).optional(),
    value: z
      .union([z.number(), z.string()])
      .optional()
      .describe('Amount, 0-1 progress/slider value, or filled stars'),
    max: z.number().optional().describe('rating_stars: number of stars'),
    count: z.number().optional().describe('Stack count on an item slot, or badge number'),
    rarity: z.enum(RARITIES).optional(),
    items: z.array(z.string().max(40)).max(12).optional().describe('Tab names'),
    active: z.number().optional().describe('Active tab (0-based)'),
    on: z.boolean().optional().describe('Toggle state'),
    selected: z.boolean().optional().describe('Item slot shown selected'),
    shape: z.enum(['circle', 'rounded', 'square']).optional().describe('icon_button shape'),
    w: z.number().min(8).max(4000).optional(),
    h: z.number().min(8).max(4000).optional(),
    title: z.string().max(120).optional().describe('Panel, modal or shop-card heading'),
    body: z.string().max(2000).optional(),
    buttons: z
      .array(z.object({ label: z.string().max(40), tone: z.string().optional() }))
      .max(4)
      .optional()
      .describe('Modal footer buttons'),
    price: z.union([z.number(), z.string()]).optional().describe('Shop-card price'),
    plus: z.boolean().optional().describe('currency_pill: add a + button'),
    segments: z.number().min(0).max(20).optional().describe('progress_bar: number of notches'),
  }),
  handler: async (ctx, input) => {
    const { kind, parentId, x, y, name, component, ...options } = input;
    const widget = buildWidget(kind, options);
    let doc = await ctx.getDoc();
    const missing = missingWidgetTokens(doc.tokens);
    if (
      Object.keys(missing.colors).length +
        Object.keys(missing.fonts).length +
        Object.keys(missing.radii).length >
      0
    ) {
      doc = { ...doc, tokens: mergeTokens(doc.tokens, missing) };
    }
    const parent = parentId === undefined ? doc.rootId : lookupId(doc.nodes, parentId);
    const spec = {
      ...widget.spec,
      ...(name === undefined ? {} : { name }),
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
    };
    const made = run(doc, [{ op: 'create', parentId: parent, node: spec }]);
    let next = made.doc;
    const id = made.created[0] as string;
    const notes: string[] = [...widget.warnings];
    if (component === true) {
      if (widget.component === undefined) {
        notes.push(`A ${kind} has no states, so it was not made a component.`);
      } else {
        const states = Object.fromEntries(
          Object.entries(widget.component.states).filter(
            ([, patch]) => Object.keys(patch).length > 0,
          ),
        );
        next = defineComponent(next, {
          nodeId: id,
          kind: widget.component.kind,
          ...(Object.keys(states).length > 0 ? { states } : {}),
        }).doc;
      }
    }
    const rev = await commit(ctx, next, `Add ${WIDGET_INFO[kind].label}`);
    return {
      rev,
      id,
      kind,
      component: component === true && widget.component !== undefined,
      tokensAdded:
        Object.keys(missing.colors).length +
        Object.keys(missing.fonts).length +
        Object.keys(missing.radii).length,
      warnings: [...made.warnings, ...notes],
    };
  },
});

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

const listThemes = defineTool({
  name: 'list_themes',
  description:
    'The built-in game-UI themes: a palette, display + body fonts and corner radii under the standard token names (bg, panel, panelLight, slot, outline, primary, gold, gem, hp, mana, xp, success, danger, text, muted). Pick one that fits the genre, then apply_theme. Anything built with $tokens re-colours at once.',
  inputSchema: z.object({}),
  handler: () =>
    Promise.resolve({
      themes: GAME_THEMES.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        fonts: t.fonts,
        swatches: [t.colors.bg, t.colors.panel, t.colors.primary, t.colors.gold, t.colors.gem],
      })),
    }),
});

const applyTheme = defineTool({
  name: 'apply_theme',
  description:
    'Set the project tokens from a built-in game theme (list_themes). It overwrites those token names (colours, display/heading/body fonts, radii) and leaves any other tokens alone; layers that use $tokens change look immediately, layers with literal hex colours do not. Use it on a fresh project, or to try a different mood on a finished one.',
  inputSchema: z.object({
    theme: z.string().describe('A theme id from list_themes, e.g. "candy-pop"'),
  }),
  handler: async (ctx, input) => {
    const theme = findTheme(input.theme);
    if (!theme) {
      throw new CoreError(
        'NOT_FOUND',
        `There is no theme "${input.theme}".`,
        `Available: ${GAME_THEMES.map((t) => t.id).join(', ')}.`,
      );
    }
    const doc = await ctx.getDoc();
    const next = { ...doc, tokens: mergeTokens(doc.tokens, themePatch(theme)) };
    const rev = await commit(ctx, next, `Apply theme ${theme.label}`);
    return { rev, theme: theme.id, fonts: theme.fonts, colors: Object.keys(theme.colors).length };
  },
});

// ---------------------------------------------------------------------------
// Arranging
// ---------------------------------------------------------------------------

const arrangeNodes = defineTool({
  name: 'arrange_nodes',
  description:
    'Align, distribute, grid or resize several layers at once, like the editor\'s align tools. align: edge is left, center, right, top, middle or bottom (to each other, or to the parent frame with toParent). distribute: axis horizontal/vertical evens the gaps between 3+ layers, or packs them gap px apart. grid: lays the layers out in `columns` columns (gapX/gapY). match_size: dimension w, h or both, to the largest (default), the first, or a number. The layers must share a parent that is the page or a layout "none" frame and have fixed w/h; in auto-layout change gap/align/justify on the parent instead.',
  inputSchema: z.object({
    action: z.enum(['align', 'distribute', 'grid', 'match_size']),
    ids: idList,
    edge: z.enum(['left', 'center', 'right', 'top', 'middle', 'bottom']).optional(),
    toParent: z
      .boolean()
      .optional()
      .describe('align: align to the parent frame instead of to each other'),
    axis: z.enum(['horizontal', 'vertical']).optional(),
    gap: z.number().min(-1000).max(10000).optional(),
    columns: z.number().int().min(1).max(100).optional(),
    gapX: z.number().min(-1000).max(10000).optional(),
    gapY: z.number().min(-1000).max(10000).optional(),
    dimension: z.enum(['w', 'h', 'both']).optional(),
    to: z.union([z.enum(['largest', 'first']), z.number()]).optional(),
  }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    let ops: Op[];
    switch (input.action) {
      case 'align':
        if (!input.edge)
          throw new CoreError(
            'INVALID_VALUE',
            'align needs an edge.',
            'left, center, right, top, middle or bottom.',
          );
        ops = alignOps(doc, input.ids, input.edge, input.toParent ?? false);
        break;
      case 'distribute':
        if (!input.axis)
          throw new CoreError(
            'INVALID_VALUE',
            'distribute needs an axis.',
            'horizontal or vertical.',
          );
        ops = distributeOps(doc, input.ids, input.axis, input.gap);
        break;
      case 'grid':
        if (!input.columns) throw new CoreError('INVALID_VALUE', 'grid needs columns.');
        ops = gridOps(
          doc,
          input.ids,
          input.columns,
          input.gapX ?? input.gap ?? 16,
          input.gapY ?? input.gapX ?? input.gap ?? 16,
        );
        break;
      case 'match_size':
        ops = matchSizeOps(doc, input.ids, input.dimension ?? 'both', input.to ?? 'largest');
        break;
    }
    if (ops.length === 0) return { rev: doc.rev, changed: [], note: 'Nothing needed to move.' };
    const done = run(doc, ops);
    const rev = await commit(ctx, done.doc, `Arrange (${input.action})`);
    return {
      rev,
      changed: [...new Set(ops.map((o) => ('id' in o ? o.id : '')))].filter(Boolean),
      warnings: done.warnings,
    };
  },
});

const groupNodes = defineTool({
  name: 'group_nodes',
  description:
    'Wrap layers in a new frame at their combined bounds (like Ctrl+G). layout "none" (default) keeps every layer exactly where it is; "row" or "column" makes the group an auto-layout frame, keeping the current order and spacing. The layers must share a parent that is the page or a layout "none" frame and have fixed sizes. Returns the group id.',
  inputSchema: z.object({
    ids: idList,
    name: z.string().max(80).optional(),
    layout: z.enum(['none', 'row', 'column']).optional(),
    gap: z.number().min(0).max(10000).optional(),
  }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    const done = run(
      doc,
      groupOps(doc, input.ids, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.layout === undefined ? {} : { layout: input.layout }),
        ...(input.gap === undefined ? {} : { gap: input.gap }),
      }),
    );
    const rev = await commit(ctx, done.doc, 'Group layers');
    return { rev, id: done.created[0], warnings: done.warnings };
  },
});

const ungroupNode = defineTool({
  name: 'ungroup_node',
  description:
    "Release a frame's children into its parent (in the same place and stacking order) and delete the frame. The frame's own fill, stroke and effects are lost. Components cannot be ungrouped.",
  inputSchema: z.object({ id: z.string() }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    const done = run(doc, ungroupOps(doc, input.id));
    const rev = await commit(ctx, done.doc, 'Ungroup');
    return { rev, warnings: done.warnings };
  },
});

const repeatNode = defineTool({
  name: 'repeat_node',
  description:
    'Turn one layer into several identical ones (inventory slots, shop cards, tabs, stars) and give each its own text or icon. count is the total including the original; direction row, column or grid (columns). In a page or layout "none" frame the copies are spaced gap px apart; in an auto-layout parent they follow its flow. values maps a layer name inside the repeated layer to one value per copy: text layers get text, icon layers get an icon name, e.g. { "Label": ["Sword","Shield","Potion"], "Icon": ["sword","shield","potion"] }. Returns the ids in order.',
  inputSchema: z.object({
    id: z.string(),
    count: z.number().int().min(2).max(100),
    direction: z.enum(['row', 'column', 'grid']).optional(),
    columns: z.number().int().min(1).max(50).optional(),
    gap: z.number().min(0).max(10000).optional(),
    values: z.record(z.string(), z.array(z.string().max(200)).max(100)).optional(),
  }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    const { id, ...options } = input;
    const out = repeatLayer(doc, id, {
      count: options.count,
      ...(options.direction === undefined ? {} : { direction: options.direction }),
      ...(options.columns === undefined ? {} : { columns: options.columns }),
      ...(options.gap === undefined ? {} : { gap: options.gap }),
      ...(options.values === undefined ? {} : { values: options.values }),
    });
    const rev = await commit(ctx, out.doc, `Repeat ×${options.count}`);
    return { rev, ids: out.ids, warnings: out.warnings };
  },
});

// ---------------------------------------------------------------------------
// find_nodes
// ---------------------------------------------------------------------------

const findNodes = defineTool({
  name: 'find_nodes',
  description:
    'Find layers by name or text without reading the whole tree: query matches layer names and text content (all words, case-insensitive); filter by type, role, or component (masters and instances). Returns up to `limit` hits with id, name, type, size, parent and a text preview, so you can target apply_changes precisely in a big design.',
  inputSchema: z.object({
    query: z.string().max(200).optional(),
    type: z.enum(['frame', 'rect', 'ellipse', 'line', 'text', 'image', 'icon']).optional(),
    role: z.string().optional(),
    component: z.enum(['master', 'instance']).optional(),
    inside: z.string().optional().describe('Only search inside this layer'),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    const words = (input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const root = input.inside === undefined ? doc.rootId : lookupId(doc.nodes, input.inside);
    const hits: Node[] = [];
    const stack = [root];
    while (stack.length > 0) {
      const node = doc.nodes[stack.shift() as string];
      if (!node) continue;
      stack.push(...node.children);
      if (node.id === doc.rootId) continue;
      if (input.type !== undefined && node.type !== input.type) continue;
      if (input.role !== undefined && node.role !== input.role) continue;
      if (input.component === 'master' && node.component === undefined) continue;
      if (input.component === 'instance' && node.instanceOf === undefined) continue;
      const hay = `${node.name} ${node.text ?? ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      hits.push(node);
    }
    const limit = input.limit ?? 30;
    return {
      total: hits.length,
      hits: hits.slice(0, limit).map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        size: `${typeof n.w === 'number' ? n.w : n.w}x${typeof n.h === 'number' ? n.h : n.h}`,
        parent: n.parentId === null ? null : (doc.nodes[n.parentId]?.name ?? n.parentId),
        ...(n.text === undefined
          ? {}
          : { text: n.text.length > 60 ? `${n.text.slice(0, 60)}…` : n.text }),
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// update_where: one edit for every layer that matches
// ---------------------------------------------------------------------------

const updateWhere = defineTool({
  name: 'update_where',
  description:
    'Set properties on every layer that matches, in one atomic edit: "every layer named Stud Texture to opacity 0.4", "all text inside Shop to fontSize 22", "every icon in the Toolbar frame to color $gold". Match with name (exact, case-insensitive) and/or query (words in the name or text), type, role, inside (a layer id) and component (master or instance). `set` takes the same properties as apply_changes (null removes one); a property that does not apply to a matched layer type (fontSize on a frame) is skipped for that layer, and layers inside a component instance are skipped (edit the master or the instance instead). Use dryRun to see what would change first. Returns how many layers changed and which were skipped.',
  inputSchema: z.object({
    name: z.string().max(200).optional().describe('Exact layer name, case-insensitive'),
    query: z.string().max(200).optional().describe('Words that must all appear in name or text'),
    type: z.enum(['frame', 'rect', 'ellipse', 'line', 'text', 'image', 'icon']).optional(),
    role: z.string().optional(),
    component: z.enum(['master', 'instance']).optional(),
    inside: z.string().optional().describe('Only layers inside this layer'),
    set: z.record(z.string(), z.unknown()).describe('Properties to set; null removes one'),
    dryRun: z
      .boolean()
      .optional()
      .describe('List the layers that would change without changing them'),
    label: z.string().max(100).optional(),
  }),
  handler: async (ctx, input) => {
    if (Object.keys(input.set).length === 0) {
      throw new CoreError('INVALID_VALUE', 'set is empty: give at least one property.');
    }
    if (
      input.name === undefined &&
      input.query === undefined &&
      input.type === undefined &&
      input.role === undefined &&
      input.component === undefined &&
      input.inside === undefined
    ) {
      throw new CoreError(
        'INVALID_VALUE',
        'Say which layers to change.',
        'Give at least one of name, query, type, role, component or inside.',
      );
    }
    const doc = await ctx.getDoc();
    const words = (input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const exact = input.name?.trim().toLowerCase();
    const root = input.inside === undefined ? doc.rootId : lookupId(doc.nodes, input.inside);
    const ops: Op[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];
    const stack = [...(doc.nodes[root]?.children ?? [])];
    while (stack.length > 0) {
      const node = doc.nodes[stack.shift() as string];
      if (!node) continue;
      stack.push(...node.children);
      if (input.type !== undefined && node.type !== input.type) continue;
      if (input.role !== undefined && node.role !== input.role) continue;
      if (input.component === 'master' && node.component === undefined) continue;
      if (input.component === 'instance' && node.instanceOf === undefined) continue;
      if (exact !== undefined && node.name.trim().toLowerCase() !== exact) continue;
      const hay = `${node.name} ${node.text ?? ''}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      if (node.from !== undefined) {
        skipped.push({ id: node.id, name: node.name, reason: 'inside a component instance' });
        continue;
      }
      const allowed = propsFor(node.type);
      const set = Object.fromEntries(
        Object.entries(input.set).filter(([k]) => allowed.includes(k)),
      );
      if (Object.keys(set).length === 0) {
        skipped.push({
          id: node.id,
          name: node.name,
          reason: `none of those properties apply to a ${node.type}`,
        });
        continue;
      }
      ops.push({ op: 'update', id: node.id, set: set });
      if (ops.length > 500) {
        throw new CoreError(
          'LIMIT_EXCEEDED',
          'More than 500 layers match.',
          'Narrow it with inside or type.',
        );
      }
    }
    const changed = ops.map((o) => (o.op === 'update' ? o.id : ''));
    if (input.dryRun === true || ops.length === 0) {
      return {
        rev: doc.rev,
        dryRun: input.dryRun === true,
        matched: ops.length,
        layers: changed.slice(0, 50).map((id) => ({ id, name: doc.nodes[id]?.name })),
        skipped: skipped.slice(0, 20),
        ...(ops.length === 0 ? { note: 'No layer matched, so nothing changed.' } : {}),
      };
    }
    const done = run(doc, ops);
    const rev = await commit(ctx, done.doc, input.label ?? `Update ${ops.length} layers`);
    return {
      rev,
      changed: changed.length,
      ids: changed.slice(0, 50),
      skipped: skipped.slice(0, 20),
      warnings: done.warnings,
    };
  },
});

export const GAME_TOOLS: readonly Tool[] = [
  updateWhere,
  createWidget,
  listThemes,
  applyTheme,
  arrangeNodes,
  groupNodes,
  ungroupNode,
  repeatNode,
  findNodes,
];
