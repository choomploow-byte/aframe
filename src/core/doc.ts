import { generateId, type Rng } from './ids';
import { normalizeNode } from './normalize';
import { DEFAULT_TOKENS } from './tokens';
import type { Doc, DocMeta, Tokens } from './types';
import { SCHEMA_VERSION } from './types';

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
