/**
 * Tools for the game-UI toolkit: icons, fonts and reusable components. Same rules as `tools.ts`:
 * handlers reach the world only through `ToolContext`, and edits go through the same atomic
 * pipeline as `apply_changes`.
 */
import * as z from 'zod/v4';
import { applyChanges } from './apply';
import { addAsset, imageNodeSpec, toDataUrl } from './assets';
import {
  createInstance,
  defineComponent,
  listComponents,
  NON_DEFAULT_STATES,
} from './component-ops';
import { CoreError } from './errors';
import { FONT_CATALOG } from './fonts';
import { getIcon, ICON_CATEGORIES, searchIcons, suggestIcons } from './icons';
import { describeEntry, LIBRARY_CATEGORIES, searchLibrary, type LibraryCategory } from './library';
import { lookupId } from './ops';
import { defineTool, ToolFailure, type Tool } from './tool-kit';
import type { Doc, ToolContext } from './types';

const kindSchema = z.enum(['button', 'card', 'tab', 'slot', 'panel', 'toast', 'custom']);
const layerChanges = z.record(z.string(), z.record(z.string(), z.unknown()));
const stateSchema = z.enum(['default', 'hover', 'pressed', 'disabled', 'selected']);

async function commit(ctx: ToolContext, next: Doc, label: string): Promise<number> {
  const before = await ctx.getDoc();
  if (next !== before) await ctx.commit(next, { source: 'agent', label });
  return (await ctx.getDoc()).rev;
}

const searchIconsTool = defineTool({
  name: 'search_icons',
  description:
    'Find icons by meaning ("coin", "sword", "close", "settings"). Returns icon names to use as the `icon` of an icon node (create { type: "icon", icon: "coins", w: 24, h: 24, color: "$gold" }) or with place_icon. The set is one consistent solid style: game items (coins, gems, keys, shields, stars, swords, potions, chests), commerce, interface, status and arrows. No query lists a category.',
  inputSchema: z.object({
    query: z.string().max(80).optional().describe('Words, e.g. "treasure chest" or "arrow right"'),
    category: z.enum(ICON_CATEGORIES as unknown as [string, ...string[]]).optional(),
    limit: z.number().int().min(1).max(60).optional().describe('Default 24'),
  }),
  handler: (_ctx, { query, category, limit }) => {
    const found = searchIcons(query, {
      ...(category === undefined ? {} : { category: category as (typeof ICON_CATEGORIES)[number] }),
      ...(limit === undefined ? {} : { limit }),
    });
    return Promise.resolve({
      total: found.total,
      icons: found.hits,
      categories: ICON_CATEGORIES,
      ...(found.total === 0
        ? {
            hint: `Nothing matches "${query ?? ''}". Try one word, a synonym, or list a category: ${ICON_CATEGORIES.join(', ')}.`,
          }
        : {}),
    });
  },
});

const placeIcon = defineTool({
  name: 'place_icon',
  description:
    'Place one icon in a single call: name (from search_icons), where, size and colour. Equivalent to an apply_changes create op with type "icon". Colour is a token ($gold) or hex and defaults to the surrounding text colour.',
  inputSchema: z.object({
    name: z.string().describe('Icon name from search_icons, e.g. "coins"'),
    parentId: z.string().optional().describe('Frame to put it in (default: the page)'),
    size: z.number().min(4).max(2048).optional().describe('Width and height in px (default 24)'),
    color: z.string().optional().describe('e.g. "$gold" or "#F5B301"'),
    x: z.number().optional().describe('Only used in a layout "none" frame or on the page'),
    y: z.number().optional(),
    label: z.string().max(80).optional().describe('Layer name (default "Icon <name>")'),
  }),
  handler: async (ctx, input) => {
    const icon = getIcon(input.name);
    if (!icon) {
      const near = suggestIcons(input.name);
      throw new CoreError(
        'NOT_FOUND',
        `There is no icon named "${input.name}".`,
        near.length > 0
          ? `Did you mean: ${near.join(', ')}? Use search_icons to browse.`
          : 'Use search_icons to find names.',
      );
    }
    const doc = await ctx.getDoc();
    const parentId =
      input.parentId === undefined ? doc.rootId : lookupId(doc.nodes, input.parentId);
    const size = input.size ?? 24;
    const result = applyChanges(doc, [
      {
        op: 'create',
        parentId,
        node: {
          type: 'icon',
          icon: icon.name,
          w: size,
          h: size,
          ...(input.color === undefined ? {} : { color: input.color }),
          ...(input.x === undefined ? {} : { x: input.x }),
          ...(input.y === undefined ? {} : { y: input.y }),
          ...(input.label === undefined ? {} : { name: input.label }),
        },
      },
    ]);
    if (!result.ok) {
      const [first] = result.errors;
      if (!first) throw new CoreError('INTERNAL', 'place_icon failed without an error.');
      throw new ToolFailure(first, result.errors);
    }
    const rev = await commit(ctx, result.doc, `Place icon ${icon.name}`);
    return { rev, id: result.created[0], icon: icon.name, warnings: result.warnings };
  },
});

const listFonts = defineTool({
  name: 'list_fonts',
  description:
    "The fonts that ship with Atelier, with their real weights. fontFamily takes a name from this list or a $font token. Display families for game UI: Lilita One, Luckiest Guy, Bungee (one weight each) and Fredoka (300-700). A weight outside a family's range is not faked; apply_changes warns. fontWeight goes up to 900 for families that have it (Inter, Fraunces, DM Sans, Playfair Display).",
  inputSchema: z.object({
    category: z.enum(['sans', 'serif', 'mono', 'display']).optional(),
  }),
  handler: async (ctx, { category }) => {
    const doc = await ctx.getDoc();
    return {
      fonts: FONT_CATALOG.filter((f) => category === undefined || f.category === category).map(
        (f) => ({
          name: f.name,
          category: f.category,
          weights:
            f.weights[0] === f.weights[1]
              ? [f.weights[0]]
              : { from: f.weights[0], to: f.weights[1] },
          variable: f.variable,
          license: f.license,
          use: f.use,
        }),
      ),
      tokens: doc.tokens.fonts,
      note: 'Set a font role once with set_tokens (fonts: { display: "Lilita One" }) and use "$font.display" in text nodes.',
    };
  },
});

const componentList = defineTool({
  name: 'component_list',
  description:
    'The master components in this design: id, name, kind (button, card, tab, slot, panel, toast, custom), the states each defines, the layers you can override (with ids), and where instances are placed. Place one with create_instance; change a master (and every instance follows) with apply_changes on the master.',
  inputSchema: z.object({ kind: kindSchema.optional() }),
  handler: async (ctx, { kind }) => {
    const doc = await ctx.getDoc();
    const components = listComponents(doc, kind);
    return {
      count: components.length,
      components,
      ...(components.length === 0
        ? { hint: 'No components yet. Build a frame, then define_component on it.' }
        : {}),
    };
  },
});

const createInstanceTool = defineTool({
  name: 'create_instance',
  description:
    'Place an instance of a master component. It follows the master: edit the master and every instance changes. Override per instance with `overrides`, keyed by layer name or id: { "Label": { "text": "Buy" }, "$self": { "w": 200 } }. `state` shows hover, pressed, disabled or selected. Returns the instance id and its layer ids. Editing a layer of an instance later (apply_changes update) is also kept as an override.',
  inputSchema: z.object({
    component: z.string().describe('Master id or exact name (see component_list)'),
    parentId: z
      .string()
      .optional()
      .describe('Frame to place it in (default: the page, beside the master)'),
    x: z.number().optional(),
    y: z.number().optional(),
    name: z.string().max(120).optional().describe("Layer name (default: the master's name)"),
    state: stateSchema.optional(),
    overrides: layerChanges.optional(),
  }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    const result = createInstance(doc, {
      component: input.component,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.x === undefined ? {} : { x: input.x }),
      ...(input.y === undefined ? {} : { y: input.y }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.overrides === undefined ? {} : { overrides: input.overrides }),
    });
    const rev = await commit(ctx, result.doc, 'Create instance');
    return {
      rev,
      instanceId: result.instanceId,
      created: result.created,
      layers: result.layers,
      warnings: result.warnings,
    };
  },
});

const defineComponentTool = defineTool({
  name: 'define_component',
  description:
    'Turn a frame into a master component (button, card, tab, slot, panel, toast, custom) and optionally define its states. A state lists only what differs from the master: states: { hover: { "$self": { "fill": "$primaryHover" }, "Label": { "color": "#FFFFFF" } }, pressed: { "$self": { "effects": ["bevel-pressed"] } } }. Layers are named by layer name, id or $self. Call again to add or change states (null removes one). A master is built from plain frames, text and icons; components cannot nest. Buttons should define hover and pressed (lint_design checks).',
  inputSchema: z.object({
    nodeId: z.string().describe('The frame to turn into a master'),
    kind: kindSchema.optional().describe("Default: button/card from the frame's role, else custom"),
    name: z.string().max(120).optional(),
    states: z
      .object(
        Object.fromEntries(
          NON_DEFAULT_STATES.map((s) => [s, layerChanges.nullable().optional()]),
        ) as Record<
          (typeof NON_DEFAULT_STATES)[number],
          z.ZodOptional<z.ZodNullable<typeof layerChanges>>
        >,
      )
      .optional(),
  }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    const result = defineComponent(doc, {
      nodeId: input.nodeId,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.states === undefined ? {} : { states: input.states }),
    });
    const rev = await commit(ctx, result.doc, 'Define component');
    const summary = listComponents(result.doc).find((c) => c.id === result.componentId);
    return { rev, componentId: result.componentId, component: summary, warnings: result.warnings };
  },
});

const needLibrary = (ctx: ToolContext): NonNullable<ToolContext['library']> => {
  if (!ctx.library) {
    throw new CoreError(
      'NOT_IMPLEMENTED',
      'The asset library is not available in this environment.',
      'It is part of the Atelier MCP server; add images with import_image instead.',
    );
  }
  return ctx.library;
};

const searchLibraryTool = defineTool({
  name: 'search_library',
  description:
    "Search the user's own asset library: textures and overlays such as halftones, sunbursts, stars, sparkles, particles, hexagons, studs and paper. Most are white or grey with transparency, made to lay over a coloured frame (set opacity, or tint the frame behind). Returns ids for use_library_asset. No query lists a category. The library is the user's, kept in their Atelier folder; add to it with `atelier-mcp library add <folder>`.",
  inputSchema: z.object({
    query: z.string().max(80).optional().describe('Words, e.g. "halftone corner" or "sparkle"'),
    category: z.enum(LIBRARY_CATEGORIES as unknown as [string, ...string[]]).optional(),
    limit: z.number().int().min(1).max(60).optional().describe('Default 24'),
  }),
  handler: async (ctx, { query, category, limit }) => {
    const entries = await needLibrary(ctx).list();
    const found = searchLibrary(entries, query, {
      ...(category === undefined ? {} : { category: category as LibraryCategory }),
      ...(limit === undefined ? {} : { limit }),
    });
    const counts: Record<string, number> = {};
    for (const e of entries) counts[e.category] = (counts[e.category] ?? 0) + 1;
    return {
      total: found.total,
      assets: found.hits.map(describeEntry),
      categories: counts,
      ...(entries.length === 0
        ? {
            hint: 'The library is empty. Add a folder of images: atelier-mcp library add <folder>.',
          }
        : found.total === 0
          ? {
              hint: `Nothing matches "${query ?? ''}". Try one word, or a category: ${Object.keys(counts).join(', ')}.`,
            }
          : {}),
    };
  },
});

const useLibraryAsset = defineTool({
  name: 'use_library_asset',
  description:
    'Place an image from the asset library as an image node. The picture is stored in the project (once, however many times you place it). Give w and h to stretch it over something (fit "fill" is the default for overlays); opacity 0.1-0.4 lays a white texture softly over a colour. Returns the node id.',
  inputSchema: z.object({
    id: z.string().describe('An id from search_library'),
    parentId: z.string().optional().describe('Frame to put it in (default: the first frame)'),
    x: z.number().optional().describe('Only used in a layout "none" frame or on the page'),
    y: z.number().optional(),
    w: z.number().min(1).max(10000).optional(),
    h: z.number().min(1).max(10000).optional(),
    opacity: z.number().min(0).max(1).optional(),
    fit: z.enum(['cover', 'contain', 'fill']).optional(),
    name: z.string().max(120).optional().describe('Layer name (default: the asset name)'),
  }),
  handler: async (ctx, input) => {
    const library = needLibrary(ctx);
    const found = await library.read(input.id);
    if (!found) {
      const near = searchLibrary(await library.list(), input.id.replace(/[-_]+/g, ' '), {
        limit: 5,
      });
      throw new CoreError(
        'NOT_FOUND',
        `There is no library asset "${input.id}".`,
        near.hits.length > 0
          ? `Did you mean: ${near.hits.map((h) => h.id).join(', ')}? Use search_library to browse.`
          : 'Use search_library to find ids.',
      );
    }
    const doc = await ctx.getDoc();
    const url = toDataUrl(found.entry.mime, found.bytes);
    const existing = Object.keys(doc.assets).find((k) => doc.assets[k] === url);
    const added = existing === undefined ? addAsset(doc, found.bytes) : null;
    const base = added?.doc ?? doc;
    const assetId = added?.assetId ?? existing;
    const info = { mime: found.entry.mime, width: found.entry.width, height: found.entry.height };
    const root = base.nodes[base.rootId];
    const parentId =
      input.parentId === undefined
        ? (root?.children[0] ?? base.rootId)
        : lookupId(base.nodes, input.parentId);
    const spec = imageNodeSpec(assetId, info);
    spec.name = input.name ?? found.entry.name;
    if (input.w !== undefined || input.h !== undefined) {
      const ratio = (info.width ?? 1) / Math.max(1, info.height ?? 1);
      spec.w = input.w ?? Math.max(1, Math.round((input.h as number) * ratio));
      spec.h = input.h ?? Math.max(1, Math.round((input.w as number) / ratio));
    }
    spec.fit = input.fit ?? (input.w !== undefined && input.h !== undefined ? 'fill' : 'cover');
    if (input.x !== undefined) spec.x = input.x;
    if (input.y !== undefined) spec.y = input.y;
    if (input.opacity !== undefined) spec.opacity = input.opacity;
    const result = applyChanges(base, [{ op: 'create', parentId, node: spec }]);
    if (!result.ok) {
      const [first] = result.errors;
      throw new ToolFailure(
        first ?? { code: 'INTERNAL', message: 'Could not place the asset.' },
        result.errors,
      );
    }
    const rev = await commit(ctx, result.doc, `Add ${found.entry.name}`);
    return {
      rev,
      nodeId: result.created[0] ?? null,
      assetId,
      reusedAsset: existing !== undefined,
      warnings: result.warnings,
    };
  },
});

export const DESIGN_TOOLS: readonly Tool[] = [
  searchLibraryTool,
  useLibraryAsset,
  searchIconsTool,
  placeIcon,
  listFonts,
  componentList,
  createInstanceTool,
  defineComponentTool,
];
