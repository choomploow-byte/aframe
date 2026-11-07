import { mergeTokens, deleteToken, renameToken, tokenUsage } from '@core/token-edit';
import { resolveColor, type TokenGroup } from '@core/tokens';
import type { Store } from './commands';
import type { EditResult } from './store';
import { updateProps } from './panel-commands';

/** Token editing for the Tokens panel; every function is one undo step and reports failures instead of throwing. */
const KEY = { color: 'colors', font: 'fonts', radius: 'radii' } as const;
const DEFAULT_VALUE: Record<TokenGroup, string | number> = {
  color: '#808080',
  font: 'Inter',
  radius: 8,
};

/** The first free name like `colour-3` in a group. */
export function uniqueTokenName(existing: Record<string, unknown>, base: string): string {
  for (let i = 1; ; i += 1) {
    const name = `${base}-${i}`;
    if (!(name in existing)) return name;
  }
}

export function setTokenValue(
  store: Store,
  group: TokenGroup,
  name: string,
  value: string | number,
): EditResult {
  const patch = { [KEY[group]]: { [name]: value } };
  return store
    .getState()
    .edit(
      (doc) => ({ ...doc, tokens: mergeTokens(doc.tokens, patch) }),
      'Edit token',
      `token:${group}:${name}`,
    );
}

export function addToken(
  store: Store,
  group: TokenGroup,
  value?: string | number,
): { result: EditResult; name: string } {
  const table = store.getState().doc.tokens[KEY[group]];
  const name = uniqueTokenName(table, group === 'color' ? 'colour' : group);
  const patch = { [KEY[group]]: { [name]: value ?? DEFAULT_VALUE[group] } };
  const result = store
    .getState()
    .edit((doc) => ({ ...doc, tokens: mergeTokens(doc.tokens, patch) }), `Add ${group} token`);
  return { result, name };
}

export function renameTokenCommand(
  store: Store,
  group: TokenGroup,
  from: string,
  to: string,
): EditResult {
  return store
    .getState()
    .edit((doc) => renameToken(doc, group, from.trim(), to.trim()), 'Rename token');
}

/** Deleting detaches every use (the literal value is written back) so the design does not change. */
export function deleteTokenCommand(
  store: Store,
  group: TokenGroup,
  name: string,
): { result: EditResult; uses: number } {
  const uses = tokenUsage(store.getState().doc)[group][name] ?? 0;
  return {
    result: store.getState().edit((doc) => deleteToken(doc, group, name), 'Delete token'),
    uses,
  };
}

export function setSpacingScale(store: Store, spacing: number[]): EditResult {
  return store
    .getState()
    .edit(
      (doc) => ({ ...doc, tokens: mergeTokens(doc.tokens, { spacing }) }),
      'Edit spacing scale',
      'token:spacing',
    );
}

/**
 * "Create a token from this": takes the selected layer's literal fill (or text colour), adds it as
 * a new colour token and points the layer at the token, in one undo step.
 */
export function tokenFromSelection(
  store: Store,
): { ok: true; name: string } | { ok: false; message: string } {
  const s = store.getState();
  const node = s.selection.length === 1 ? s.doc.nodes[s.selection[0] as string] : undefined;
  if (!node) return { ok: false, message: 'Select one layer first.' };
  const prop: 'fill' | 'color' = node.type === 'text' ? 'color' : 'fill';
  const current = node[prop];
  if (!current)
    return {
      ok: false,
      message: `This layer has no ${prop === 'color' ? 'text colour' : 'fill'} to turn into a token.`,
    };
  if (current.startsWith('$'))
    return { ok: false, message: 'That colour already comes from a token.' };
  const literal = resolveColor(current, s.doc.tokens);
  if (!literal || /gradient/.test(literal))
    return { ok: false, message: 'Only solid colours can become tokens.' };

  s.beginTransaction('Create token');
  const { result, name } = addToken(store, 'color', literal);
  if (!result.ok) {
    s.cancelTransaction();
    return { ok: false, message: result.error.message };
  }
  updateProps(store, [node.id], { [prop]: `$${name}` }, { label: 'Create token' });
  s.endTransaction();
  return { ok: true, name };
}
