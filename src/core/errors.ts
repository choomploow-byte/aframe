import type { ErrorCode, OpError } from './types';

/**
 * Thrown by the low-level ops and validators. `applyChanges` and the tool handlers catch it and
 * convert it to a structured result, so callers of those never see an exception.
 */
export class CoreError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly path: string | undefined;

  constructor(code: ErrorCode, message: string, hint?: string, path?: string) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
    this.hint = hint;
    this.path = path;
  }
}

export function toOpError(err: unknown, op?: number): OpError {
  if (err instanceof CoreError) {
    const out: OpError = { code: err.code, message: err.message };
    if (op !== undefined) out.op = op;
    if (err.hint !== undefined) out.hint = err.hint;
    if (err.path !== undefined) out.path = err.path;
    return out;
  }
  // Anything else is a bug in core, but a tool must still answer with a structured error.
  const message = err instanceof Error ? err.message : String(err);
  const out: OpError = { code: 'INTERNAL', message: `Unexpected error: ${message}` };
  if (op !== undefined) out.op = op;
  return out;
}
