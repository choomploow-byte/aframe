import * as z from 'zod/v4';
import { applyChanges } from './apply';
import { CoreError } from './errors';
import { getOutline } from './outline';
import { CREATABLE_TYPES } from './props';
import { defineTool, ToolFailure, type Tool, type ToolResult } from './tool-kit';
import { mergeTokens } from './token-edit';
import { DESIGN_TOOLS } from './tools-design';
import { GAME_TOOLS } from './tools-game';
import { PIXELART_TOOLS } from './tools-pixelart';
import { EXTRA_TOOLS } from './tools-extra';
import { BLEND_MODES, type NodePropKey, type Op, type ToolContext, type Warning } from './types';
import { lookupId } from './ops';
import { deepEqual } from './util';

export {
  defineTool,
  formatZodError,
  ToolFailure,
  toToolError,
  type Tool,
  type ToolError,
  type ToolImage,
  type ToolResult,
} from './tool-kit';

/**
 * Tool definitions and handlers shared by the MCP server and the in-app chat (docs/03 §2, docs/05).
 * Handlers talk to the world only through `ToolContext`. This file is Phase 1's slice: the read
 * tools plus `apply_changes`; the rest of docs/05 arrives with the phases that need an app or
 * a filesystem.
 */

// ---------------------------------------------------------------------------
// Schemas (what the model sees as JSON Schema; core validators do the deep checks)
// ---------------------------------------------------------------------------

const COLOR_HELP =
  'Colour: #RRGGBB[AA], rgb()/hsl(), a $token such as $primary, or a linear-/radial-gradient()';
// Ranges are described, not enforced, here: core validation answers with the failing op index,
// the property path and a hint, which is far more useful to an agent than a schema error.
const sizeSchema = z.union([z.number(), z.literal('hug'), z.literal('fill')]);
const shadowSchema = z.object({
  x: z.number(),
  y: z.number(),
  blur: z.number(),
  spread: z.number(),
  color: z.string(),
  inset: z.boolean().optional(),
});
const quad = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const patternSchema = z
  .object({
    pattern: z.enum(['stripes', 'halftone', 'sunburst', 'noise']),
    color: z.string().describe('Ink colour, e.g. "$primary"'),
    size: z
      .number()
      .optional()
      .describe(
        'stripes: thickness px; halftone: dot diameter px; sunburst: ray width degrees; noise: grain px',
      ),
    spacing: z
      .number()
      .optional()
      .describe(
        'stripes: gap px; halftone: distance between dot centres px; sunburst: gap degrees',
      ),
    angle: z.number().optional().describe('stripes: direction; sunburst: start rotation (degrees)'),
    opacity: z.number().optional().describe('Strength of the ink, 0 to 1 (default 1)'),
    background: z.string().optional().describe('Colour or gradient the pattern sits on'),
  })
  .describe("A native pattern fill that follows the node's radius and clipping");
const effectRefSchema = z.union([
  z.enum(['bevel-raised', 'bevel-pressed', 'gloss-top', 'inner-glow', 'hard-3d-bottom']),
  z.object({
    preset: z.enum(['bevel-raised', 'bevel-pressed', 'gloss-top', 'inner-glow', 'hard-3d-bottom']),
    intensity: z.number().optional().describe('0 to 3, default 1'),
    color: z.string().optional().describe('inner-glow tint or hard-3d-bottom ledge colour'),
  }),
]);
const textStyleSchema = z
  .object({
    fontFamily: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.number().optional(),
    lineHeight: z.number().optional(),
    letterSpacing: z.number().optional(),
    textTransform: z.enum(['none', 'uppercase', 'capitalize']).optional(),
    color: z.string().optional(),
    textStroke: z.string().optional(),
    textStrokeWidth: z.number().optional(),
    shadow: z.array(shadowSchema).optional(),
  })
  .strict();
const layerPatchesSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

/** One entry per node property; `satisfies` makes adding a property to `Node` fail to compile here. */
const nodeProps = {
  name: z.string().describe('Layer name, e.g. "Hero" or "Primary Button"'),
  x: z.number().describe('Position; only used when the parent has layout "none" or is the page'),
  y: z.number(),
  w: sizeSchema.describe("Width in px, 'hug' (fit content) or 'fill' (take the available space)"),
  h: sizeSchema.describe("Height in px, 'hug' or 'fill'"),
  rotation: z.number().describe('Degrees'),
  flipX: z.boolean().describe('Mirror left-right'),
  flipY: z.boolean().describe('Mirror top-bottom'),
  visible: z.boolean(),
  locked: z.boolean().describe('Editor-only lock; tools can still edit locked nodes'),
  opacity: z.number().describe('0 (transparent) to 1'),
  fill: z
    .union([z.string(), patternSchema])
    .describe(
      COLOR_HELP +
        ', or a pattern: { pattern: "halftone", color: "$primary", size: 6, opacity: 0.25 }',
    ),
  stroke: z.string().describe(COLOR_HELP),
  strokeWidth: z.number().describe('px, 0 or more; defaults to 1 when a stroke colour is set'),
  strokeAlign: z.enum(['inside', 'center', 'outside']),
  radius: z
    .union([z.number(), z.string(), quad])
    .describe("px, a '$radius.md' token, or [topLeft, topRight, bottomRight, bottomLeft]"),
  shadow: z.array(shadowSchema),
  blur: z.number().describe('Layer blur in px'),
  backdropBlur: z.number().describe('Backdrop blur in px'),
  hue: z
    .number()
    .describe(
      'Hue shift in degrees (-360 to 360). Recolours an image: a blue button with hue 120 turns green',
    ),
  saturation: z.number().describe('Colour strength multiplier, 1 = unchanged, 0 = grey'),
  brightness: z.number().describe('Brightness multiplier, 1 = unchanged'),
  contrast: z.number().describe('Contrast multiplier, 1 = unchanged'),
  blendMode: z
    .enum(BLEND_MODES)
    .describe(
      'How the layer mixes with what is under it: overlay or soft-light for textures that take the colour below, screen or plus-lighter for glows, multiply for shadows',
    ),
  effects: z
    .array(effectRefSchema)
    .describe(
      'Named shadow recipes: bevel-raised, bevel-pressed, gloss-top, inner-glow, hard-3d-bottom (each as a name or { preset, intensity, color }). Combine e.g. ["gloss-top", "hard-3d-bottom"] for a chunky button. Not drawn on text.',
    ),
  layout: z
    .enum(['none', 'row', 'column'])
    .describe('Frames only. row/column = auto-layout (flexbox)'),
  gap: z.number().describe('px between children'),
  padding: quad.describe('[top, right, bottom, left]'),
  align: z.enum(['start', 'center', 'end', 'stretch']).describe('Cross axis'),
  justify: z.enum(['start', 'center', 'end', 'between']).describe('Main axis'),
  wrap: z.boolean(),
  clip: z.boolean(),
  text: z.string().describe('Text nodes only'),
  fontFamily: z.string().describe("A font name or a '$font.heading' token"),
  fontSize: z.number().describe('px'),
  fontWeight: z.number().describe('100 to 900'),
  lineHeight: z.number().describe('Multiplier, e.g. 1.5'),
  letterSpacing: z.number().describe('em'),
  textAlign: z.enum(['left', 'center', 'right', 'justify']),
  color: z.string().describe('Text colour. ' + COLOR_HELP),
  textTransform: z.enum(['none', 'uppercase', 'capitalize']),
  textStroke: z
    .string()
    .describe(
      'Text outline colour: the game-title look. Pair with textStrokeWidth (3-6 for big titles)',
    ),
  textStrokeWidth: z.number().describe('How far the outline reaches outside the letters, px'),
  textStyle: z
    .string()
    .describe(
      "Name of a shared text style (set_tokens textStyles). Its font, size, colour, outline and shadow replace this layer's own; null detaches",
    ),
  assetId: z.string().describe('Image nodes only'),
  fit: z
    .enum(['cover', 'contain', 'fill', 'tile'])
    .describe(
      "Image fit. 'tile' repeats the picture across the layer (textures and patterns); set tileSize to scale one tile",
    ),
  tileSize: z.number().describe('Tile fit only: width of one tile in px'),
  icon: z.string().describe("Icon nodes only: a name from search_icons, e.g. 'coins'"),
  component: z
    .object({
      kind: z.enum(['button', 'card', 'tab', 'slot', 'panel', 'toast', 'custom']),
      states: z
        .object({
          hover: layerPatchesSchema.optional(),
          pressed: layerPatchesSchema.optional(),
          disabled: layerPatchesSchema.optional(),
          selected: layerPatchesSchema.optional(),
        })
        .optional(),
    })
    .describe(
      'Frames only: makes this frame a master component (prefer the define_component tool)',
    ),
  instanceOf: z
    .string()
    .describe('Frames only: id of the master this is an instance of; null detaches'),
  state: z
    .enum(['default', 'hover', 'pressed', 'disabled', 'selected'])
    .describe('Instances: the state shown'),
  overrides: layerPatchesSchema.describe(
    'Instances: managed for you when you edit a layer inside an instance',
  ),
  role: z
    .enum(['button', 'input', 'link', 'nav', 'section', 'heading', 'card', 'list', 'icon'])
    .describe('Semantic hint used by code export'),
  href: z.string(),
  props: z.record(z.string(), z.string()).describe('Free-form notes for export, e.g. aria-label'),
} satisfies Record<NodePropKey, z.ZodType>;

const optionalProps = Object.fromEntries(
  Object.entries(nodeProps).map(([k, v]) => [k, v.optional()]),
);
const patchProps = Object.fromEntries(
  Object.entries(nodeProps).map(([k, v]) => [k, v.nullable().optional()]),
);

const NodeSpecSchema: z.ZodType = z.lazy(() =>
  z
    .object({
      ...optionalProps,
      type: z.enum(CREATABLE_TYPES as [string, ...string[]]),
      id: z
        .string()
        .optional()
        .describe('Optional explicit id; normally omit and read it from `created`'),
      tempId: z
        .string()
        .optional()
        .describe("Name this node so later ops in the same batch can refer to it as '$name'"),
      children: z
        .array(NodeSpecSchema)
        .optional()
        .describe('Frames only; nested nodes, back to front'),
    })
    .catchall(z.unknown()),
);

const opSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal('create'),
      parentId: z.string().describe("A frame id (or the page id), or '$tempId' from an earlier op"),
      index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe('Position among siblings; omit to append (on top)'),
      node: NodeSpecSchema,
    })
    .catchall(z.unknown()),
  z
    .object({
      op: z.literal('update'),
      id: z.string(),
      set: z
        .object(patchProps)
        .catchall(z.unknown())
        .describe('Properties to change. null removes an optional property.'),
    })
    .catchall(z.unknown()),
  z.object({ op: z.literal('delete'), id: z.string() }).catchall(z.unknown()),
  z
    .object({
      op: z.literal('move'),
      id: z.string(),
      parentId: z.string(),
      index: z.number().int().min(0).optional(),
    })
    .catchall(z.unknown()),
  z
    .object({
      op: z.literal('duplicate'),
      id: z.string(),
      parentId: z
        .string()
        .optional()
        .describe('Copy into this frame instead of next to the original'),
      offset: z.object({ x: z.number(), y: z.number() }).optional(),
    })
    .catchall(z.unknown()),
]);

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const getDesign = defineTool({
  name: 'get_design',
  description:
    'Read the design as an outline: every frame, text and shape with its id, size, position and key styles, plus token names and counts. Call it first and after edits. Pass nodeId to zoom into one frame, depth for more levels, detail "full" for every property.',
  inputSchema: z.object({
    nodeId: z.string().optional().describe('Start from this node instead of the page'),
    depth: z
      .number()
      .int()
      .min(0)
      .max(32)
      .optional()
      .describe('Levels below the start node (default 4)'),
    detail: z.enum(['outline', 'full']).optional(),
  }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    return getOutline(
      doc,
      input.nodeId === undefined ? input : { ...input, nodeId: lookupId(doc.nodes, input.nodeId) },
    );
  },
});

const getNode = defineTool({
  name: 'get_node',
  description:
    'Read one node with every property, plus its parent and children ids. Includes on-canvas bounds when the AFrame app is open.',
  inputSchema: z.object({ nodeId: z.string() }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    const nodeId = lookupId(doc.nodes, input.nodeId);
    const node = doc.nodes[nodeId];
    if (!node) {
      throw new CoreError(
        'NOT_FOUND',
        `Node ${input.nodeId} does not exist.`,
        'Call get_design to see the current ids (they look like n_abc12; the n_ is optional).',
      );
    }
    const bounds = ctx.getNodeBounds ? await ctx.getNodeBounds(nodeId) : null;
    return { node, bounds, boundsAvailable: ctx.getNodeBounds !== undefined };
  },
});

const getTokens = defineTool({
  name: 'get_tokens',
  description:
    'Read the design tokens: colours, fonts, spacing scale and radii. Reference them in node properties as $name, $font.name and $radius.name.',
  inputSchema: z.object({}),
  handler: async (ctx) => (await ctx.getDoc()).tokens,
});

const setTokens = defineTool({
  name: 'set_tokens',
  description:
    'Add or change design tokens (merge). colors: { name: "#hex" | "$other" | null }, fonts: { name: "Family" | null }, radii: { name: px | null }, spacing: [px, ...] replaces the scale. null removes a token. Set tokens first, then reference them as $name in apply_changes. Returns { rev, tokens }.',
  inputSchema: z.object({
    colors: z.record(z.string(), z.string().nullable()).optional(),
    fonts: z.record(z.string(), z.string().nullable()).optional(),
    radii: z.record(z.string(), z.number().nullable()).optional(),
    textStyles: z
      .record(z.string(), textStyleSchema.nullable())
      .optional()
      .describe(
        'Shared text looks: { "Title Outline": { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing, textTransform, color, textStroke, textStrokeWidth, shadow } | null }. Apply with the textStyle property on text layers; editing the style updates every layer that uses it.',
      ),
    spacing: z.array(z.number()).optional(),
    label: z.string().max(100).optional().describe('Short description shown in the undo history'),
  }),
  handler: async (ctx, { label, ...patch }) => {
    const doc = await ctx.getDoc();
    const tokens = mergeTokens(doc.tokens, patch);
    if (!deepEqual(tokens, doc.tokens)) {
      await ctx.commit({ ...doc, tokens }, { source: 'agent', label: label ?? 'Update tokens' });
    }
    return { rev: (await ctx.getDoc()).rev, tokens };
  },
});

const applyChangesTool = defineTool({
  name: 'apply_changes',
  description:
    'Edit the design with an atomic batch of operations (all succeed or nothing changes; max 500). Ops: create (with nested children), update (set properties; null removes one), delete, move, duplicate. Node types: frame, rect, ellipse, line, text, image, icon (icon: "coins", see search_icons). Fills can be patterns ({ pattern: "halftone", color: "$primary", size: 6, opacity: 0.25 }); effects add bevel/gloss presets; frames can be components (define_component, create_instance). Ids work with or without the n_ prefix. Give new nodes a tempId and refer to it as "$name" in later ops of the same batch. Returns { rev, created, changed, deleted, idMap, warnings }. Prefer auto-layout frames (layout row/column, w/h hug or fill) and $tokens over absolute positions and raw colours.',
  inputSchema: z.object({
    operations: z.array(opSchema).min(1),
    label: z.string().max(100).optional().describe('Short description shown in the undo history'),
  }),
  handler: async (ctx, input) => {
    const doc = await ctx.getDoc();
    const result = applyChanges(doc, input.operations as unknown as Op[]);
    if (!result.ok) {
      const [first] = result.errors;
      if (!first) throw new CoreError('INTERNAL', 'applyChanges failed without an error.');
      throw new ToolFailure(first, result.errors);
    }
    if (result.doc !== doc) {
      await ctx.commit(
        result.doc,
        input.label === undefined ? { source: 'agent' } : { source: 'agent', label: input.label },
      );
    }
    const warnings: Warning[] = result.warnings;
    return {
      rev: (await ctx.getDoc()).rev,
      created: result.created,
      changed: result.changed,
      deleted: result.deleted,
      idMap: result.idMap,
      warnings,
    };
  },
});

export const TOOLS: readonly Tool[] = [
  getDesign,
  getNode,
  getTokens,
  setTokens,
  applyChangesTool,
  ...DESIGN_TOOLS,
  ...GAME_TOOLS,
  ...PIXELART_TOOLS,
  ...EXTRA_TOOLS,
];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Runs a tool by name. Unknown names and bad input come back as structured errors. */
export async function runTool(
  ctx: ToolContext,
  name: string,
  rawInput: unknown,
): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) {
    return {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: `Unknown tool '${name}'.`,
        hint: `Available tools: ${TOOLS.map((t) => t.name).join(', ')}.`,
      },
    };
  }
  return tool.run(ctx, rawInput);
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (draft-07), ready for MCP `tools/list` or an LLM provider's tool list. */
  inputSchema: Record<string, unknown>;
}

export function getToolDefinitions(): ToolDefinition[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: z.toJSONSchema(t.inputSchema, { target: 'draft-7' }),
  }));
}
