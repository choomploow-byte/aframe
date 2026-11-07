import type { LooseDoc } from './normalize';
import type { OpError } from './types';
import { SCHEMA_VERSION } from './types';
import { isPlainObject } from './util';

/** Upgrades a raw document one schema version (`from` -> `from + 1`). Pure. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being upgraded *from*. Empty while schema 1 is the baseline; the day
 * SCHEMA_VERSION becomes 2, add `1: (doc) => ...` here and a fixture of a v1 file to the tests.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export type MigrateResult =
  | { ok: true; doc: LooseDoc; migrated: boolean; fromSchema: number }
  | { ok: false; error: OpError };

export interface MigrateOptions {
  /** Overridable so the chain machinery can be tested before a second schema exists. */
  target?: number;
  steps?: Readonly<Record<number, Migration>>;
}

/**
 * Brings a parsed document up to the current schema. Refuses documents written by a newer
 * Atelier instead of guessing (docs/04 "Migration").
 */
export function migrate(input: unknown, options: MigrateOptions = {}): MigrateResult {
  const target = options.target ?? SCHEMA_VERSION;
  const steps = options.steps ?? MIGRATIONS;

  if (!isPlainObject(input)) {
    return {
      ok: false,
      error: { code: 'INVALID_VALUE', message: 'The document must be a JSON object.' },
    };
  }
  const from = input.schema;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    return {
      ok: false,
      error: {
        code: 'INVALID_VALUE',
        message: 'The document has no valid "schema" version.',
        hint: 'Expected a positive integer; is this an Atelier project file?',
        path: 'schema',
      },
    };
  }
  if (from > target) {
    return {
      ok: false,
      error: {
        code: 'SCHEMA_NEWER',
        message: `This document uses schema ${from}, but this version of Atelier understands up to ${target}.`,
        hint: 'Update Atelier.',
        path: 'schema',
      },
    };
  }

  let doc: Record<string, unknown> = input;
  for (let version = from; version < target; version += 1) {
    const step = Object.hasOwn(steps, version) ? steps[version] : undefined;
    if (!step) {
      return {
        ok: false,
        error: {
          code: 'INVALID_VALUE',
          message: `No migration from schema ${version} to ${version + 1}.`,
          path: 'schema',
        },
      };
    }
    doc = { ...step(doc), schema: version + 1 };
  }
  if (!isPlainObject(doc.nodes)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_VALUE',
        message: 'The document has no "nodes" object.',
        path: 'nodes',
      },
    };
  }
  // Structure is verified by validateDoc after normalisation; here we only vouch for the version.
  return { ok: true, doc: doc as unknown as LooseDoc, migrated: from !== target, fromSchema: from };
}
