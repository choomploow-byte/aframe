import type * as z from 'zod/v4';
import { CoreError } from './errors';
import type { ErrorCode, OpError, ToolContext } from './types';

/**
 * The tool framework shared by every tool group (docs/03 §2): results, structured failures and
 * `defineTool`, which validates input and turns every outcome into a `ToolResult`.
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

/** An image a tool wants the host to show (the MCP layer turns these into image content blocks). */
export interface ToolImage {
  /** Base64, no data-URL prefix. */
  data: string;
  mimeType: string;
}

/** Returned by a handler that also wants the host to show images next to the JSON. */
export class ToolOutput {
  constructor(
    readonly data: unknown,
    readonly images: ToolImage[],
  ) {}
}
export const withImages = (data: unknown, images: ToolImage[]): ToolOutput =>
  new ToolOutput(data, images);

export type ToolResult =
  { ok: true; data: unknown; images?: ToolImage[] } | { ok: false; error: ToolError };

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

export function toToolError(err: unknown): ToolError {
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

export function formatZodError(error: z.ZodError): string {
  const shown = error.issues.slice(0, 3).map((i) => {
    const path = i.path.map(String).join('.');
    return path ? `${path}: ${i.message}` : i.message;
  });
  const more = error.issues.length > 3 ? ` (+${error.issues.length - 3} more)` : '';
  return `Invalid input: ${shown.join('; ')}${more}`;
}

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

export function defineTool<S extends z.ZodType>(def: {
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
        const out = await def.handler(ctx, parsed.data);
        return out instanceof ToolOutput
          ? { ok: true, data: out.data, images: out.images }
          : { ok: true, data: out };
      } catch (err) {
        return { ok: false, error: toToolError(err) };
      }
    },
  };
}
