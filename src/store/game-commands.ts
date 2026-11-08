import {
  alignOps,
  distributeOps,
  gridOps,
  matchSizeOps,
  repeatLayer,
  ungroupOps,
  type AlignEdge,
} from '@core/arrange';
import { applyChanges } from '@core/apply';
import { CoreError } from '@core/errors';
import { topmostIds } from '@core/clipboard';
import { mergeTokens } from '@core/token-edit';
import { findTheme, themePatch } from '@core/themes';
import { isEffectivelyLocked } from '@core/tree';
import type { Doc, Node, NodePatch, Op } from '@core/types';
import {
  buildWidget,
  missingWidgetTokens,
  WIDGET_INFO,
  type WidgetKind,
  type WidgetOptions,
} from '@core/widgets';
import { round2, type Point } from '../canvas/geometry';
import { type Env, type Store } from './commands';
import { insertionParent } from './toolkit-commands';

/**
 * Game-UI editing commands for the editor: arrange the selection (align, distribute, grid, match
 * size, flip, ungroup, repeat), insert a ready-made widget, apply a theme. Each is ONE undo step and
 * reports a plain-language reason when it cannot run, instead of throwing. The maths is core's
 * (`arrange.ts`, `widgets.ts`), so the AI tools and these buttons behave the same.
 */
export type CommandResult = { ok: true } | { ok: false; reason: string };
const OK: CommandResult = { ok: true };
const fail = (reason: string): CommandResult => ({ ok: false, reason });

const reasonOf = (err: unknown): string =>
  err instanceof CoreError
    ? `${err.message}${err.hint ? ` ${err.hint}` : ''}`
    : 'That did not work.';

/** The selection the arrange commands act on: top-level, not locked, not the page. */
function targets(doc: Doc, selection: readonly string[]): string[] {
  return topmostIds(doc.nodes, selection).filter(
    (id) => id !== doc.rootId && doc.nodes[id] && !isEffectivelyLocked(doc.nodes, id),
  );
}

/** The document with each given layer's hug/fill size replaced by what is on screen, so core places by real sizes. */
function withMeasuredSizes(env: Env, ids: readonly string[]): Doc {
  const { doc } = env.store.getState();
  const nodes = { ...doc.nodes };
  for (const id of ids) {
    const n = nodes[id];
    const m = env.measure(id);
    if (!n || !m) continue;
    nodes[id] = {
      ...n,
      w: typeof n.w === 'number' ? n.w : round2(m.w),
      h: typeof n.h === 'number' ? n.h : round2(m.h),
    };
  }
  return { ...doc, nodes };
}

function run(env: Env, label: string, build: (doc: Doc, ids: string[]) => Op[]): CommandResult {
  const s = env.store.getState();
  const ids = targets(s.doc, s.selection);
  if (ids.length === 0) return fail('Select something first.');
  try {
    const ops = build(withMeasuredSizes(env, ids), ids);
    if (ops.length === 0) return OK;
    const result = s.dispatch(ops, { label });
    return result.ok ? OK : fail(result.errors[0]?.message ?? 'That did not work.');
  } catch (err) {
    return fail(reasonOf(err));
  }
}

export function alignSelection(env: Env, edge: AlignEdge): CommandResult {
  return run(env, `Align ${edge}`, (doc, ids) => alignOps(doc, ids, edge, ids.length === 1));
}

export function distributeSelection(env: Env, axis: 'horizontal' | 'vertical'): CommandResult {
  return run(env, `Distribute ${axis}ly`, (doc, ids) => distributeOps(doc, ids, axis));
}

export function gridSelection(env: Env, columns: number, gap = 16): CommandResult {
  return run(env, 'Arrange in a grid', (doc, ids) => {
    // Reading order: top to bottom, then left to right.
    const sorted = [...ids].sort((a, b) => {
      const na = doc.nodes[a] as Node;
      const nb = doc.nodes[b] as Node;
      return na.y - nb.y || na.x - nb.x;
    });
    return gridOps(doc, sorted, columns, gap, gap);
  });
}

export function matchSizeSelection(env: Env, dimension: 'w' | 'h' | 'both'): CommandResult {
  return run(env, 'Match size', (doc, ids) => matchSizeOps(doc, ids, dimension, 'largest'));
}

/** Mirrors every selected layer; if they differ, all end up in the first one's opposite state. */
export function flipSelection(store: Store, axis: 'x' | 'y'): CommandResult {
  const s = store.getState();
  const ids = targets(s.doc, s.selection);
  if (ids.length === 0) return fail('Select something first.');
  const key = axis === 'x' ? 'flipX' : 'flipY';
  const first = s.doc.nodes[ids[0] as string]?.[key] === true;
  const patch: NodePatch = { [key]: first ? null : true };
  const ops: Op[] = ids.map((id) => ({ op: 'update', id, set: patch }));
  const result = s.dispatch(ops, { label: axis === 'x' ? 'Flip horizontally' : 'Flip vertically' });
  return result.ok ? OK : fail('That layer cannot be flipped.');
}

/** Releases the children of each selected frame into its parent. */
export function ungroupSelection(env: Env): CommandResult {
  const s = env.store.getState();
  const frames = targets(s.doc, s.selection).filter((id) => s.doc.nodes[id]?.type === 'frame');
  if (frames.length === 0) return fail('Select a frame to ungroup.');
  const children = frames.flatMap((id) => s.doc.nodes[id]?.children ?? []);
  try {
    const doc = withMeasuredSizes(env, [...frames, ...children]);
    const ops = frames.flatMap((id) => ungroupOps(doc, id));
    const result = s.dispatch(ops, { label: 'Ungroup', select: () => children });
    return result.ok ? OK : fail(result.errors[0]?.message ?? 'That did not work.');
  } catch (err) {
    return fail(reasonOf(err));
  }
}

/** Duplicates the selected layer into a row, column or grid of `count`. */
export function repeatSelection(
  env: Env,
  count: number,
  direction: 'row' | 'column' | 'grid',
  columns?: number,
): CommandResult {
  const s = env.store.getState();
  const ids = targets(s.doc, s.selection);
  if (ids.length !== 1) return fail('Select one layer to repeat.');
  const id = ids[0] as string;
  let created: string[] = [];
  let failure: string | null = null;
  const edited = s.edit((doc) => {
    try {
      const measured = withMeasuredSizes(env, [id]);
      const sized = { ...doc, nodes: { ...doc.nodes, [id]: measured.nodes[id] as Node } };
      const out = repeatLayer(sized, id, {
        count,
        direction,
        ...(columns === undefined ? {} : { columns }),
      });
      created = out.ids;
      // Keep the original's own w/h as they were; only the copies' positions changed.
      return out.doc;
    } catch (err) {
      failure = reasonOf(err);
      return doc;
    }
  }, `Repeat ×${count}`);
  if (failure !== null) return fail(failure);
  if (!edited.ok) return fail(edited.error.message);
  s.setSelection(created);
  return OK;
}

/** Adds a ready-made widget to the selected frame (or the page), centred in view. */
export function insertWidget(
  store: Store,
  kind: WidgetKind,
  center: Point | null,
  options: WidgetOptions = {},
): CommandResult {
  const s = store.getState();
  let createdId: string | null = null;
  try {
    const widget = buildWidget(kind, options);
    const edited = s.edit((doc) => {
      const missing = missingWidgetTokens(doc.tokens);
      const withTokens = { ...doc, tokens: mergeTokens(doc.tokens, missing) };
      const parent = insertionParent(withTokens, s.selection);
      const spec = { ...widget.spec };
      const flow =
        parent.type === 'frame' && (parent.layout === 'row' || parent.layout === 'column');
      if (!flow && center) {
        const onPage = parent.type === 'page';
        spec.x = round2(onPage ? center.x - (typeof spec.w === 'number' ? spec.w : 120) / 2 : 16);
        spec.y = round2(onPage ? center.y - (typeof spec.h === 'number' ? spec.h : 60) / 2 : 16);
      }
      const result = applyChanges(withTokens, [{ op: 'create', parentId: parent.id, node: spec }]);
      if (!result.ok) {
        throw new CoreError('INVALID_VALUE', result.errors[0]?.message ?? 'Could not add it.');
      }
      createdId = result.created[0] ?? null;
      return result.doc;
    }, `Add ${WIDGET_INFO[kind].label}`);
    if (!edited.ok) return fail(edited.error.message);
    if (createdId) s.setSelection([createdId]);
    return OK;
  } catch (err) {
    return fail(reasonOf(err));
  }
}

/** Sets the colour, font and radius tokens from a built-in theme. */
export function applyGameTheme(store: Store, themeId: string): CommandResult {
  const theme = findTheme(themeId);
  if (!theme) return fail('There is no such theme.');
  const edited = store
    .getState()
    .edit(
      (doc) => ({ ...doc, tokens: mergeTokens(doc.tokens, themePatch(theme)) }),
      `Theme: ${theme.label}`,
    );
  return edited.ok ? OK : fail(edited.error.message);
}
