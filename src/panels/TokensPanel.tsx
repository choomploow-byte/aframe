import { tokenUsage } from '@core/token-edit';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { useMemo } from 'react';
import { BUNDLED_FONTS } from '../canvas/fonts';
import {
  addToken,
  deleteTokenCommand,
  renameTokenCommand,
  setSpacingScale,
  setTokenValue,
  tokenFromSelection,
} from '../store/token-commands';
import { store, useAtelier } from '../store/store';
import { ColorField } from '../ui/ColorField';
import { NumberField, Section, Select, TextField } from '../ui/fields';
import { showToast } from '../ui/toast';
import type { TokenGroup } from '@core/tokens';

/**
 * Edit the design tokens: colours, fonts, radii and the spacing scale. Shows how many properties
 * use each token; renaming keeps those uses working and deleting writes the value back into them.
 */
const fail = (message: string): void => void showToast(message, { kind: 'error' });

function NameField({ group, name }: { group: TokenGroup; name: string }) {
  return (
    <TextField
      ariaLabel={`${group} token name`}
      field={`token-name-${group}-${name}`}
      value={name}
      validate={(v) => /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(v)}
      onCommit={(next) => {
        const r = renameTokenCommand(store, group, name, next);
        if (!r.ok) fail(r.error.message);
      }}
    />
  );
}

function Usage({ count }: { count: number }) {
  return (
    <span
      className="token__usage"
      title={`${count} use${count === 1 ? '' : 's'} in this design`}
      aria-label={`${count} uses`}
    >
      {count}
    </span>
  );
}

function DeleteButton({ group, name }: { group: TokenGroup; name: string }) {
  return (
    <button
      type="button"
      className="icon-btn icon-btn--small"
      aria-label={`Delete ${group} token ${name}`}
      title="Delete token"
      data-action="delete-token"
      onClick={() => {
        const { result, uses } = deleteTokenCommand(store, group, name);
        if (!result.ok) return fail(result.error.message);
        showToast(
          uses > 0
            ? `Deleted "${name}". Its ${uses} use${uses === 1 ? '' : 's'} now keep the value directly.`
            : `Deleted "${name}".`,
          {
            action: { label: 'Undo', run: () => void store.getState().undo() },
          },
        );
      }}
    >
      <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

function AddButton({ group, label }: { group: TokenGroup; label: string }) {
  return (
    <button
      type="button"
      className="icon-btn icon-btn--small"
      aria-label={label}
      title={label}
      data-action={`add-${group}-token`}
      onClick={() => {
        const { result } = addToken(store, group);
        if (!result.ok) fail(result.error.message);
      }}
    >
      <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

export function TokensPanel() {
  const doc = useAtelier((s) => s.doc);
  const selection = useAtelier((s) => s.selection);
  const usage = useMemo(() => tokenUsage(doc), [doc]);
  const { colors, fonts, radii, spacing } = doc.tokens;

  const extract = (): void => {
    const r = tokenFromSelection(store);
    if (r.ok)
      showToast(`Created the colour token "${r.name}" and applied it.`, {
        action: { label: 'Undo', run: () => void store.getState().undo() },
      });
    else fail(r.message);
  };

  return (
    <div className="tokens" data-testid="tokens-panel">
      <Section
        title="Colours"
        actions={
          <span className="section__actions">
            <button
              type="button"
              className="icon-btn icon-btn--small"
              aria-label="Create a token from the selected layer's colour"
              title="Create a token from the selected layer's colour"
              disabled={selection.length !== 1}
              data-action="extract-token"
              onClick={extract}
            >
              <Wand2 size={14} strokeWidth={1.75} aria-hidden="true" />
            </button>
            <AddButton group="color" label="Add colour token" />
          </span>
        }
      >
        {Object.entries(colors).map(([name, value]) => (
          <div className="token" key={name} data-token-row={name}>
            <ColorField
              ariaLabel={`Colour ${name}`}
              field={`token-color-${name}`}
              value={value}
              onChange={(v) => v && setTokenValue(store, 'color', name, v)}
            />
            <NameField group="color" name={name} />
            <Usage count={usage.color[name] ?? 0} />
            <DeleteButton group="color" name={name} />
          </div>
        ))}
        {Object.keys(colors).length === 0 && (
          <p className="row__note">
            No colour tokens yet. Add one, or select a layer and use the wand to turn its colour
            into a token.
          </p>
        )}
      </Section>

      <Section title="Fonts" actions={<AddButton group="font" label="Add font token" />}>
        {Object.entries(fonts).map(([name, family]) => {
          const known = BUNDLED_FONTS.some((f) => f.name === family);
          const options = [
            ...(known ? [] : [{ value: family, label: family }]),
            ...BUNDLED_FONTS.map((f) => ({ value: f.name, label: f.name })),
          ];
          return (
            <div className="token token--font" key={name} data-token-row={name}>
              <Select
                ariaLabel={`Font ${name}`}
                field={`token-font-${name}`}
                value={family}
                options={options}
                onChange={(v) => setTokenValue(store, 'font', name, v)}
              />
              <NameField group="font" name={name} />
              <Usage count={usage.font[name] ?? 0} />
              <DeleteButton group="font" name={name} />
            </div>
          );
        })}
      </Section>

      <Section title="Corner radii" actions={<AddButton group="radius" label="Add radius token" />}>
        {Object.entries(radii).map(([name, px]) => (
          <div className="token token--radius" key={name} data-token-row={name}>
            <NumberField
              label="px"
              ariaLabel={`Radius ${name}`}
              field={`token-radius-${name}`}
              value={px}
              min={0}
              precision={1}
              onChange={(v) => setTokenValue(store, 'radius', name, Math.max(0, v))}
            />
            <NameField group="radius" name={name} />
            <Usage count={usage.radius[name] ?? 0} />
            <DeleteButton group="radius" name={name} />
          </div>
        ))}
      </Section>

      <Section
        title="Spacing scale"
        actions={
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label="Add spacing step"
            title="Add spacing step"
            data-action="add-spacing"
            onClick={() => setSpacingScale(store, [...spacing, (spacing.at(-1) ?? 0) + 8])}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        }
      >
        <p className="row__note">
          The steps the linter treats as "on scale" (plus multiples of 4).
        </p>
        <div className="spacing">
          {spacing.map((px, i) => (
            <div className="spacing__step" key={i}>
              <NumberField
                label=""
                ariaLabel={`Spacing step ${i + 1}`}
                field={`spacing-${i}`}
                value={px}
                min={0}
                precision={1}
                onChange={(v) =>
                  setSpacingScale(
                    store,
                    spacing.map((x, j) => (j === i ? Math.max(0, v) : x)),
                  )
                }
              />
              <button
                type="button"
                className="icon-btn icon-btn--small"
                aria-label={`Remove spacing step ${i + 1}`}
                onClick={() =>
                  setSpacingScale(
                    store,
                    spacing.filter((_, j) => j !== i),
                  )
                }
              >
                <Trash2 size={12} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
