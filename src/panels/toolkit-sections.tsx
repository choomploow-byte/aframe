import { descendantsOf, instanceRootOf } from '@core/components';
import { getIcon, ICONS } from '@core/icons';
import { EFFECT_INFO, EFFECT_PRESETS, effectParts } from '@core/paint';
import type { ComponentKind, ComponentState, EffectPreset, EffectRef } from '@core/types';
import { useMemo, useRef, useState } from 'react';
import { IconSvg } from '../canvas/IconSvg';
import { detachInstanceCommand, makeComponent, removeComponent } from '../store/toolkit-commands';
import { store } from '../store/store';
import { ColorField } from '../ui/ColorField';
import { NumberField, Row, Section, Segmented, Select, Toggle, type Option } from '../ui/fields';
import { Popover } from '../ui/Popover';
import type { PropCtx } from './prop-context';

// ---------------------------------------------------------------------------
// Effect presets (bevel, gloss, glow, 3D ledge)
// ---------------------------------------------------------------------------

const PRESET_LABEL: Record<EffectPreset, string> = {
  'bevel-raised': 'Bevel raised',
  'bevel-pressed': 'Bevel pressed',
  'gloss-top': 'Gloss top',
  'inner-glow': 'Inner glow',
  'hard-3d-bottom': 'Hard 3D bottom',
};

/** Named shadow recipes, each with an intensity. Not offered for text (they would box the glyphs). */
export function EffectPresetsSection({ ctx }: { ctx: PropCtx }) {
  const effects = ctx.get('effects');
  const list: EffectRef[] = ctx.single ? (ctx.single.effects ?? []) : [];
  const find = (preset: EffectPreset): EffectRef | undefined =>
    list.find((e) => effectParts(e).preset === preset);
  const write = (next: EffectRef[], label: string, key?: string): void =>
    ctx.set({ effects: next.length > 0 ? next : null }, label, key);
  const toggle = (preset: EffectPreset, on: boolean): void =>
    write(
      on ? [...list, preset] : list.filter((e) => effectParts(e).preset !== preset),
      on ? `Add ${PRESET_LABEL[preset]}` : `Remove ${PRESET_LABEL[preset]}`,
    );
  const setIntensity = (preset: EffectPreset, intensity: number): void =>
    write(
      list.map((e) => {
        const p = effectParts(e);
        if (p.preset !== preset) return e;
        return {
          preset,
          intensity: Math.min(3, Math.max(0, intensity)),
          ...(p.color === undefined ? {} : { color: p.color }),
        };
      }),
      'Change effect intensity',
      `effect-${preset}`,
    );
  const setColor = (preset: EffectPreset, color: string | undefined): void =>
    write(
      list.map((e) => {
        const p = effectParts(e);
        if (p.preset !== preset) return e;
        return {
          preset,
          ...(p.intensity === 1 ? {} : { intensity: p.intensity }),
          ...(color === undefined ? {} : { color }),
        };
      }),
      'Change effect colour',
    );
  return (
    <Section title="Presets">
      {!ctx.single && effects.mixed && (
        <p className="row__note">Select one layer to edit its presets.</p>
      )}
      {EFFECT_PRESETS.map((preset) => {
        const current = find(preset);
        const parts = current === undefined ? undefined : effectParts(current);
        return (
          <div className="preset" key={preset} data-testid="effect-preset" data-preset={preset}>
            <Row label={PRESET_LABEL[preset]}>
              <Toggle
                ariaLabel={PRESET_LABEL[preset]}
                field={`effect-${preset}`}
                checked={current !== undefined}
                disabled={ctx.locked || !ctx.single}
                onChange={(on) => toggle(preset, on)}
              />
            </Row>
            {parts !== undefined && (
              <div className="grid2">
                <NumberField
                  label="I"
                  ariaLabel={`${PRESET_LABEL[preset]} intensity`}
                  field={`effect-${preset}-intensity`}
                  title={EFFECT_INFO[preset]}
                  value={parts.intensity}
                  min={0}
                  max={3}
                  step={0.1}
                  precision={2}
                  disabled={ctx.locked}
                  onChange={(v) => setIntensity(preset, v)}
                />
                {(preset === 'inner-glow' || preset === 'hard-3d-bottom') && (
                  <ColorField
                    ariaLabel={`${PRESET_LABEL[preset]} colour`}
                    field={`effect-${preset}-color`}
                    value={parts.color}
                    allowNone
                    disabled={ctx.locked}
                    onChange={(v) => setColor(preset, v)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Icon picker
// ---------------------------------------------------------------------------

/** A search box and a grid of every icon; used by the icon section and the Icons panel. */
export function IconGrid({
  onPick,
  selected,
}: {
  onPick: (name: string) => void;
  selected?: string | undefined;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return ICONS;
    return ICONS.filter((i) =>
      words.every((w) => i.name.includes(w) || i.tags.includes(w) || i.category === w),
    );
  }, [query]);
  return (
    <div className="icongrid">
      <input
        className="icongrid__search"
        type="search"
        aria-label="Search icons"
        placeholder="Search icons (coin, sword, close...)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="icongrid__cells" role="listbox" aria-label="Icons">
        {shown.map((i) => (
          <button
            key={i.name}
            type="button"
            role="option"
            aria-selected={selected === i.name}
            className={`icongrid__cell${selected === i.name ? ' icongrid__cell--on' : ''}`}
            title={i.name}
            aria-label={i.name}
            data-icon-pick={i.name}
            onClick={() => onPick(i.name)}
          >
            <IconSvg name={i.name} w={20} h={20} />
          </button>
        ))}
        {shown.length === 0 && <p className="panel__empty">No icon matches.</p>}
      </div>
    </div>
  );
}

export function IconSection({ ctx }: { ctx: PropCtx }) {
  const icon = ctx.get('icon');
  const color = ctx.get('color');
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const name = icon.value;
  const known = name !== undefined && getIcon(name) !== undefined;
  return (
    <Section title="Icon">
      <Row label="Icon">
        <button
          ref={anchor}
          type="button"
          className="fontpicker"
          aria-label="Icon"
          aria-haspopup="listbox"
          aria-expanded={open}
          data-field="icon"
          disabled={ctx.locked}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="fontpicker__name">
            {icon.mixed ? 'Mixed' : (name ?? 'Choose an icon')}
            {!icon.mixed && name !== undefined && !known ? ' (not in the set)' : ''}
          </span>
        </button>
      </Row>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} label="Icons" minWidth={280}>
          <IconGrid
            selected={name}
            onPick={(n) => {
              ctx.set({ icon: n }, 'Change icon');
              setOpen(false);
            }}
          />
        </Popover>
      )}
      <Row label="Colour">
        <ColorField
          ariaLabel="Icon colour"
          field="icon-color"
          value={color.value}
          mixed={color.mixed}
          allowNone
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ color: v ?? null }, 'Change icon colour', 'prop:color')}
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Components: master, instance, or a frame that could become one
// ---------------------------------------------------------------------------

const KINDS: Option<ComponentKind>[] = (
  ['button', 'card', 'tab', 'slot', 'panel', 'toast', 'custom'] as const
).map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) }));

const STATES: Option<ComponentState>[] = (
  ['default', 'hover', 'pressed', 'disabled', 'selected'] as const
).map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }));

export function ComponentSection({ ctx }: { ctx: PropCtx }) {
  const node = ctx.single;
  if (!node || node.type !== 'frame') return null;
  const doc = ctx.doc;
  const inInstance = node.from !== undefined ? instanceRootOf(doc.nodes, node) : null;
  const master = node.instanceOf === undefined ? undefined : doc.nodes[node.instanceOf];

  if (inInstance) {
    return (
      <Section title="Component">
        <p className="row__note">
          A layer of the instance "{inInstance.name}". Changes you make here are kept as overrides
          for this instance only.
        </p>
      </Section>
    );
  }

  if (node.component !== undefined) {
    const states = Object.keys(node.component.states ?? {});
    const count = Object.values(doc.nodes).filter((n) => n.instanceOf === node.id).length;
    return (
      <Section title="Component">
        <Row label="Master">
          <Select
            ariaLabel="Component kind"
            field="component-kind"
            value={node.component.kind}
            options={KINDS}
            disabled={ctx.locked}
            onChange={(kind) =>
              ctx.set({ component: { ...node.component, kind } }, 'Change component kind')
            }
          />
        </Row>
        <p className="row__note" data-testid="component-summary">
          {count} instance{count === 1 ? '' : 's'} follow this. States defined:{' '}
          {states.length > 0
            ? states.join(', ')
            : 'none yet (ask your AI to add hover and pressed)'}
          .
        </p>
        <button
          type="button"
          className="btn btn--small"
          data-action="remove-component"
          disabled={ctx.locked}
          onClick={() => removeComponent(store, node.id)}
        >
          Remove component
        </button>
      </Section>
    );
  }

  if (node.instanceOf !== undefined) {
    const overrides = Object.keys(node.overrides ?? {}).length;
    return (
      <Section title="Instance">
        <Row label="Of">
          <span className="row__value" data-testid="instance-of">
            {master?.name ?? 'a removed component'}
          </span>
        </Row>
        <Row label="State">
          <Segmented
            ariaLabel="Instance state"
            field="instance-state"
            value={node.state ?? 'default'}
            options={STATES}
            disabled={ctx.locked}
            onChange={(state) => ctx.set({ state }, 'Change state')}
          />
        </Row>
        <p className="row__note">
          {overrides === 0
            ? 'No overrides: it follows the master exactly.'
            : `${overrides} layer${overrides === 1 ? '' : 's'} overridden.`}{' '}
          {descendantsOf(doc.nodes, node.id).length} layers.
        </p>
        <div className="row__buttons">
          {master && (
            <button
              type="button"
              className="btn btn--small"
              data-action="select-master"
              onClick={() => store.getState().setSelection([master.id])}
            >
              Go to master
            </button>
          )}
          <button
            type="button"
            className="btn btn--small"
            data-action="reset-overrides"
            disabled={ctx.locked || overrides === 0}
            onClick={() => ctx.set({ overrides: null }, 'Reset overrides')}
          >
            Reset overrides
          </button>
          <button
            type="button"
            className="btn btn--small"
            data-action="detach-instance"
            disabled={ctx.locked}
            onClick={() => detachInstanceCommand(store, node.id)}
          >
            Detach
          </button>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Component">
      <p className="row__note">
        Make this frame a master so it can be placed again and again, with hover and pressed looks.
      </p>
      <button
        type="button"
        className="btn btn--small"
        data-action="make-component"
        disabled={ctx.locked}
        onClick={() => makeComponent(store, node.id, node.role === 'button' ? 'button' : 'custom')}
      >
        Create component
      </button>
    </Section>
  );
}
