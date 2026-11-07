import { CoreError, toOpError } from './errors';
import type { Rng } from './ids';
import {
  beginDraft,
  draftCreate,
  draftDelete,
  draftDuplicate,
  draftMove,
  draftUpdate,
  finishDraft,
  LIMITS,
  type Draft,
} from './ops';
import { findTokenIssues } from './tokens';
import type { ApplyResult, Doc, Op, Warning } from './types';
import { deepEqual, isFiniteNumber, isPlainObject } from './util';

export interface ApplyOptions {
  /** Random source for generated ids; inject a seeded one in tests. */
  rng?: Rng;
  /** Defaults to 500 (docs/05). */
  maxOps?: number;
}

const OP_FIELDS: Record<string, readonly string[]> = {
  create: ['op', 'parentId', 'index', 'node'],
  update: ['op', 'id', 'set'],
  delete: ['op', 'id'],
  move: ['op', 'id', 'parentId', 'index'],
  duplicate: ['op', 'id', 'parentId', 'offset'],
};

function requireString(op: Record<string, unknown>, field: string): string {
  const value = op[field];
  if (typeof value !== 'string' || value === '') {
    throw new CoreError('INVALID_VALUE', `'${field}' must be a node id string.`, undefined, field);
  }
  return value;
}

function optionalIndex(op: Record<string, unknown>): number | undefined {
  const value = op.index;
  if (value === undefined) return undefined;
  if (!isFiniteNumber(value)) {
    throw new CoreError('INVALID_VALUE', "'index' must be an integer.", undefined, 'index');
  }
  return value;
}

function runOp(d: Draft, raw: unknown): void {
  if (!isPlainObject(raw)) {
    throw new CoreError(
      'INVALID_VALUE',
      'Each operation must be an object like { "op": "create", ... }.',
    );
  }
  const kind = raw.op;
  const fields = typeof kind === 'string' ? OP_FIELDS[kind] : undefined;
  if (typeof kind !== 'string' || !fields || !Object.hasOwn(OP_FIELDS, kind)) {
    throw new CoreError(
      'INVALID_VALUE',
      `Unknown op ${JSON.stringify(kind)}.`,
      `op must be one of: ${Object.keys(OP_FIELDS).join(', ')}.`,
      'op',
    );
  }
  for (const key of Object.keys(raw)) {
    if (!fields.includes(key)) {
      throw new CoreError(
        'INVALID_VALUE',
        `Unknown field '${key}' on a ${kind} op.`,
        `A ${kind} op takes: ${fields.filter((f) => f !== 'op').join(', ')}.`,
        key,
      );
    }
  }

  switch (kind) {
    case 'create': {
      if (raw.node === undefined) {
        throw new CoreError('INVALID_VALUE', "A create op needs a 'node'.", undefined, 'node');
      }
      draftCreate(d, requireString(raw, 'parentId'), raw.node, optionalIndex(raw));
      return;
    }
    case 'update': {
      if (raw.set === undefined) {
        throw new CoreError(
          'INVALID_VALUE',
          "An update op needs a 'set' object.",
          'Example: { "op": "update", "id": "n_abc12", "set": { "fill": "$primary" } }',
          'set',
        );
      }
      draftUpdate(d, requireString(raw, 'id'), raw.set);
      return;
    }
    case 'delete':
      draftDelete(d, requireString(raw, 'id'));
      return;
    case 'move':
      draftMove(d, requireString(raw, 'id'), requireString(raw, 'parentId'), optionalIndex(raw));
      return;
    case 'duplicate': {
      const parentId = raw.parentId === undefined ? undefined : requireString(raw, 'parentId');
      draftDuplicate(
        d,
        requireString(raw, 'id'),
        parentId,
        raw.offset as { x: number; y: number } | undefined,
      );
      return;
    }
    default:
      // Unreachable: `kind` was checked against OP_FIELDS above.
      throw new CoreError('INVALID_VALUE', `Unknown op ${kind}.`);
  }
}

function tokenWarnings(doc: Doc, ids: readonly string[], nodes: Doc['nodes']): Warning[] {
  const out: Warning[] = [];
  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    for (const issue of findTokenIssues(node, doc.tokens)) {
      out.push({
        code: 'UNKNOWN_TOKEN',
        nodeId: id,
        message:
          issue.reason === 'UNKNOWN'
            ? `Token ${issue.token} is not defined; the property is ignored until it exists (see get_tokens).`
            : `Token ${issue.token} cannot be used here (${issue.reason.toLowerCase().replace('_', ' ')}); the property is ignored.`,
      });
    }
  }
  return out;
}

/**
 * Applies a batch of operations atomically (docs/05). Either every op succeeds and a new document
 * comes back, or the first failing op's error is returned and the input is untouched. Never throws.
 * `rev` and `meta` are not touched: the commit layer owns them (`bumpRev`).
 */
export function applyChanges(
  doc: Doc,
  operations: readonly Op[],
  options: ApplyOptions = {},
): ApplyResult {
  const maxOps = options.maxOps ?? LIMITS.maxOps;
  const ops: readonly unknown[] = operations;
  if (!Array.isArray(ops)) {
    return {
      ok: false,
      errors: [{ code: 'INVALID_VALUE', message: "'operations' must be an array." }],
    };
  }
  if (ops.length > maxOps) {
    return {
      ok: false,
      errors: [
        {
          code: 'LIMIT_EXCEEDED',
          message: `A batch may contain at most ${maxOps} operations (got ${ops.length}).`,
          hint: 'Split the work into several apply_changes calls.',
        },
      ],
    };
  }

  const d = beginDraft(doc, options.rng);
  for (const [index, op] of ops.entries()) {
    try {
      runOp(d, op);
    } catch (err) {
      return { ok: false, errors: [toOpError(err, index)] };
    }
  }

  const next = finishDraft(d);
  const created = d.created.filter((id) => d.nodes[id] !== undefined);
  const deleted = [...d.deleted].filter((id) => doc.nodes[id] !== undefined);
  const changed = [...d.touched].filter((id) => {
    const before = doc.nodes[id];
    const after = d.nodes[id];
    return before !== undefined && after !== undefined && !deepEqual(before, after);
  });

  return {
    ok: true,
    doc: next,
    created,
    changed,
    deleted,
    idMap: { ...d.idMap },
    warnings: [...d.warnings, ...tokenWarnings(doc, [...created, ...changed], d.nodes)],
  };
}
