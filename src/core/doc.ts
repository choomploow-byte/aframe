import { syncAllInstances } from './components';
import { generateId, type Rng } from './ids';
import { migrate } from './migrate';
import { normalizeDoc, normalizeNode } from './normalize';
import { NODE_TYPES } from './props';
import { DEFAULT_TOKENS } from './tokens';
import type { Doc, DocMeta, NodeType, OpError, Tokens, Warning } from './types';
import { SCHEMA_VERSION } from './types';
import { isPlainObject } from './util';
import { validateDoc } from './validate';

export type LoadResult =
  { ok: true; doc: Doc; warnings: Warning[]; migrated: boolean } | { ok: false; errors: OpError[] };

/**
 * The one way to turn parsed JSON (a project file, a fixture, a pasted doc) into a trusted `Doc`:
 * migrate, normalise, validate. Never throws.
 */
export function loadDoc(input: unknown): LoadResult {
  const migrated = migrate(input);
  if (!migrated.ok) return { ok: false, errors: [migrated.error] };

  // normalizeNode needs an object with a known type; anything else is reported, not crashed on.
  const badNodes: OpError[] = [];
  for (const [key, node] of Object.entries(migrated.doc.nodes)) {
    const candidate: unknown = node;
    if (!isPlainObject(candidate) || !NODE_TYPES.includes(candidate.type as NodeType)) {
      badNodes.push({
        code: 'INVALID_VALUE',
        message: `Node ${key} is not an object with a known type.`,
        path: `nodes.${key}`,
      });
    }
  }
  if (badNodes.length > 0) return { ok: false, errors: badNodes.slice(0, 50) };

  // Instance layers are derived from their masters: a file edited by hand (or left stale by an older
  // build) is brought back in step on load.
  const doc = syncAllInstances(normalizeDoc(migrated.doc));
  const validation = validateDoc(doc);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return { ok: true, doc, warnings: validation.warnings, migrated: migrated.migrated };
}

/**
 * Stable, diff-friendly JSON for the project file (docs/06: plain files, git-friendly). Top-level
 * keys are written in a fixed order, small ones first and the bulky `nodes` / `assets` last, so a
 * file's name and rev can be read from its first few hundred bytes (the project list does that
 * instead of loading every project's embedded images).
 */
export function serializeDoc(doc: Doc): string {
  const { schema, rev, id, name, rootId, meta, tokens, annotations, references, nodes, assets } =
    doc;
  const ordered = {
    schema,
    rev,
    id,
    name,
    rootId,
    meta,
    tokens,
    annotations,
    references,
    nodes,
    assets,
  };
  return `${JSON.stringify(ordered, null, 2)}
`;
}

export interface CreateDocOptions {
  id?: string;
  name?: string;
  /** ISO timestamp; defaults to the current time. */
  now?: string;
  rng?: Rng;
  tokens?: Tokens;
  lastWriter?: DocMeta['lastWriter'];
}

function cloneTokens(tokens: Tokens): Tokens {
  return {
    colors: { ...tokens.colors },
    fonts: { ...tokens.fonts },
    spacing: [...tokens.spacing],
    radii: { ...tokens.radii },
  };
}

/** A new document: one invisible page node, starter tokens, nothing else. */
export function createEmptyDoc(options: CreateDocOptions = {}): Doc {
  const rng = options.rng ?? Math.random;
  const now = options.now ?? new Date().toISOString();
  const rootId = generateId('n', new Set(), rng);
  return {
    schema: SCHEMA_VERSION,
    rev: 1,
    id: options.id ?? generateId('p', new Set(), rng),
    name: options.name ?? 'Untitled',
    rootId,
    nodes: { [rootId]: normalizeNode({ id: rootId, type: 'page' }) },
    tokens: cloneTokens(options.tokens ?? DEFAULT_TOKENS),
    annotations: [],
    references: [],
    assets: {},
    meta: { createdAt: now, updatedAt: now, lastWriter: options.lastWriter ?? 'app' },
  };
}

/**
 * What every writer does on commit (docs/06): rev + 1, fresh timestamp, who wrote. Ops and
 * `applyChanges` deliberately do not do this (docs/04 Phase 1 decision 11).
 */
export function bumpRev(
  doc: Doc,
  writer: DocMeta['lastWriter'],
  now: string = new Date().toISOString(),
): Doc {
  return { ...doc, rev: doc.rev + 1, meta: { ...doc.meta, updatedAt: now, lastWriter: writer } };
}
