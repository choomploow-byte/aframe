import { bumpRev } from './doc';
import type { CommitMeta, Doc, DocMeta, ToolContext } from './types';

/**
 * A `ToolContext` that keeps the document in memory. Used by tests, the demo script and the eval
 * harness; the app and the MCP server provide their own (live store, document file).
 */
export interface MemoryContext extends ToolContext {
  /** The current document. */
  current(): Doc;
  /** Every commit, oldest first, with its metadata. */
  readonly commits: readonly { doc: Doc; meta: CommitMeta | undefined }[];
}

export interface MemoryContextOptions {
  writer?: DocMeta['lastWriter'];
  now?: () => string;
  /** Optional capabilities (screenshot, selection, ...) to layer on top. */
  extras?: Partial<ToolContext>;
}

export function createMemoryContext(
  initial: Doc,
  options: MemoryContextOptions = {},
): MemoryContext {
  let doc = initial;
  const commits: { doc: Doc; meta: CommitMeta | undefined }[] = [];
  const writer = options.writer ?? 'mcp';
  const now = options.now ?? ((): string => new Date().toISOString());
  return {
    ...options.extras,
    getDoc: () => doc,
    commit: (next, meta) => {
      doc = bumpRev(next, writer, now());
      commits.push({ doc, meta });
    },
    current: () => doc,
    commits,
  };
}
