import * as z from 'zod/v4';
import { applyChanges } from './apply';
import { CoreError } from './errors';
import { getOutline } from './outline';
import { CREATABLE_TYPES } from './props';
import type { ErrorCode, NodePropKey, Op, OpError, ToolContext, Warning } from './types';

/**
 * Tool definitions and handlers shared by the MCP server and the in-app chat (docs/03 §2, docs/05).
 * Handlers talk to the world only through `ToolContext`. This file is Phase 1's slice: the read
 * tools plus `apply_changes`; the rest of docs/05 arrives with the phases that need an app or
 * a filesystem.
 */

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface ToolError {
  code: ErrorCode;
  message: string;
  hint?: string;
  /** For apply_changes: index of the failing operation. */
  op?: number;
  path?: string;
  /** All errors found, when there is more than one. */
  details?: OpError[];
}

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: ToolError };

/** Thrown by handlers to fail with structured detail (extends `CoreError` so plain ones work too). */
export class ToolFailure extends CoreError {
  readonly op: number | undefined;
  readonly details: OpError[] | undefined;
  constructor(error: OpError, details?: OpError[]) {
    super(error.code, error.message, error.hint, error.path);
    this.op = error.op;
    this.details = details;
  }
}

function toToolError(err: unknown): ToolError {
  if (err instanceof ToolFailure) {
    const out: ToolError = { code: err.code, message: err.message };
    if (err.hint !== undefined) out.hint = err.hint;
    if (err.op !== undefined) out.op = err.op;
    if (err.path !== undefined) out.path = err.path;
    if (err.details !== undefined) out.details = err.details;
    return out;
  }
  if (err instanceof CoreError) {
    const out: ToolError = { code: err.code, message: err.message };
    if (err.hint !== undefined) out.hint = err.hint;
    if (err.path !== undefined) out.path = err.path;
    return out;
  }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
}

function formatZodError(error: z.ZodError): string {
  const shown = error.issues.slice(0, 3).map((i) => {
    const path = i.path.map(String).join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
  const more = error.issues.length > 3 ? ` (+${error.issues.length - 3} more)` : '';
  return `Invalid input: ${shown.join('; ')}${more}`;
}

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

/** One entry per node property; `satisfies` makes adding a property to `Node` fail to compile here. */
const nodeProps = {
  name: z.string().describe('Layer name, e.g. "Hero" or "Primary Button"'),
  x: z.number().describe('Position; only used when the parent has layout "none" or is the page'),
  y: z.number(),
  w: sizeSchema.describe("Width in px, 'hug' (fit content) or 'fill' (take the available space)"),
  h: sizeSchema.describe("Height in px, 'hug' or 'fill'"),
  rotation: z.number().describe('Degrees'),
  visible: z.boolean(),
  locked: z.boolean().describe('Editor-only lock; tools can still edit locked nodes'),
  opacity: z.number().describe('0 (transparent) to 1'),
  fill: z.string().describe(COLOR_HELP),
  stroke: z.string().describe(COLOR_HELP),
  strokeWidth: z.number().describe('px, 0 or more; defaults to 1 when a stroke colour is set'),
  strokeAlign: z.enum(['inside', 'center', 'outside']),
  radius: z
    .union([z.number(), z.string(), quad])
    .describe("px, a '$radius.md' token, or [topLeft, topRight, bottomRight, bottomLeft]"),
  shadow: z.array(shadowSchema),
  blur: z.number().describe('Layer blur in px'),
  backdropBlur: z.number().describe('Backdrop blur in px'),
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
  assetId: z.string().describe('Image nodes only'),
  fit: z.enum(['cover', 'contain', 'fill']),
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
// Tool plumbing
// ---------------------------------------------------------------------------

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  /** Validates `rawInput` and runs the handler. Never throws. */
  run(ctx: ToolContext, rawInput: unknown): Promise<ToolResult>;
}

function defineTool<S extends z.ZodType>(def: {
  name: string;
  description: string;
  inputSchema: S;
  handler: (ctx: ToolContext, input: z.infer<S>) => Promise<unknown>;
}): Tool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    async run(ctx, rawInput) {
      const parsed = def.inputSchema.safeParse(rawInput ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'INVALID_VALUE',
            message: formatZodError(parsed.error),
            hint: `Check the input schema of ${def.name}.`,
          },
        };
      }
      try {
        return { ok: true, data: await def.handler(ctx, parsed.data) };
      } catch (err) {
        return { ok: false, error: toToolError(err) };
      }
    },
  };
}

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
  handler: async (ctx, input) => getOutline(await ctx.getDoc(), input),
});

const getNode = defineTool({
  name: 'get_node',
  description:
    'Read one node with every property, plus its parent and children ids. Includes on-canvas bounds when the Atelier app is open.',
  inputSchema: z.object({ nodeId: z.string() }),
  handler: async (ctx, { nodeId }) => {
    const doc = await ctx.getDoc();
    const node = doc.nodes[nodeId];
    if (!node) {
      throw new CoreError(
        'NOT_FOUND',
        `Node ${nodeId} does not exist.`,
        'Call get_design to see the current ids.',
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

const applyChangesTool = defineTool({
  name: 'apply_changes',
  description:
    'Edit the design with an atomic batch of operations (all succeed or nothing changes; max 500). Ops: create (with nested children), update (set properties; null removes one), delete, move, duplicate. Give new nodes a tempId and refer to it as "$name" in later ops of the same batch. Returns { rev, created, changed, deleted, idMap, warnings }. Prefer auto-layout frames (layout row/column, w/h hug or fill) and $tokens over absolute positions and raw colours.',
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

export const TOOLS: readonly Tool[] = [getDesign, getNode, getTokens, applyChangesTool];

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
