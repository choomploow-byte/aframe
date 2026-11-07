# Phase 1: Core Library

**Read:** docs/04 (data model: authoritative), docs/05 (Op schema), docs/03 §2, docs/13 (lint rules), `templates/core-types.ts`, `fixtures/sample-doc.json`.

## Goal
The shared brain: types, operations, validation, token resolution and CSS generation. No React, no DOM, no Node-only APIs in `src/core/`.

## Tasks
1. `src/core/types.ts`: from the template; finalise.
2. `ids.ts` (collision-checked short ids), `normalize.ts` (defaults per node type).
3. `tokens.ts`: resolve `$colorName`, `$font.heading`, `$radius.md`, spacing helpers; unknown token => report, not throw.
4. `ops.ts`: pure functions `createNode`, `updateNode`, `deleteNode` (recursive, orphan-safe), `moveNode`, `duplicateNode` (deep, new ids, offset). Structural sharing: only changed nodes are new objects.
5. `apply.ts`: `applyChanges(doc, ops, opts)` implementing the Op schema from docs/05, including nested `children` on create, `tempId` -> `$tempId` references, atomic failure with structured errors (`BAD_PARENT`, `CYCLE`, `NOT_FOUND`, `INVALID_VALUE`, `LIMIT_EXCEEDED`). Returns `{ doc, created, changed, idMap }` or `{ errors }`.
6. `validate.ts`: colour validation, number ranges, child-type rules.
7. `style.ts`: `nodeToCss(node, parent, tokens): CSSProperties-like record` implementing the layout semantics table in docs/04 exactly (hug/fill/fixed on both axes, absolute vs flex children, stroke alignment via box-shadow/outline strategy, shadows, blur, text props, clip, wrap). Export also `cssToString`.
8. `outline.ts`: `getOutline(doc, nodeId?, depth, detail)` producing the compact tree for `get_design` (+ node caps, `truncated`).
9. `tools.ts` (definitions only for read tools + `apply_changes` handler for now) with Zod schemas and the `ToolContext` interface (docs/03 §2).
10. `migrate.ts` with the schema-1 baseline.
11. Tests: Vitest unit tests for everything above, including atomicity (a failing op 5 leaves doc untouched), tempId resolution, deep duplicate, `nodeToCss` snapshots for: fixed absolute child, fill/hug in row and column, wrap, gap/padding, text hug vs wrap, gradient fill, token fill, stroke inside/outside.
12. Make `fixtures/sample-doc.json` validate and round-trip (`JSON -> normalize -> JSON` equal).

## Acceptance
- `npm test` green with >= 90% line coverage on `ops`, `apply`, `style`, `tokens`.
- A script `scripts/demo-core.ts` creates a landing hero via one `applyChanges` call with nested children and prints the outline.
- No imports from `react`, `window`, `document`, `node:*` inside `src/core/`.

## Report back with
The public API of core (function signatures), any deviation from docs/04, and open questions for Phase 2.
