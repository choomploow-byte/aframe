import { Plus, Upload, X } from 'lucide-react';
import { useRef } from 'react';
import type { Node, PatternFill, PatternName, Role, Shadow } from '@core/types';
import { resolveColor } from '@core/tokens';
import { addAutoLayout } from '../store/commands';
import { importImages, updateProps } from '../store/panel-commands';
import { store } from '../store/store';
import { showToast } from '../ui/toast';
import { ColorField } from '../ui/ColorField';
import { FontPicker } from '../ui/FontPicker';
import {
  NumberField,
  Row,
  Section,
  Segmented,
  Select,
  TextField,
  Toggle,
  type Option,
} from '../ui/fields';
import { getCanvasApi } from '../canvas/canvas-api';
import { GradientEditor } from './GradientEditor';
import { buildGradient, DEFAULT_GRADIENT, isGradient, parseGradient } from './gradient';
import type { PropCtx } from './prop-context';

/**
 * One component per Properties section (docs/07). Between them they cover every property in
 * docs/04; the test "every doc-04 property is reachable" lists the `data-field` names rendered here.
 */

const ROLES: Option<Role | 'none'>[] = [
  { value: 'none', label: 'None' },
  ...(
    ['button', 'input', 'link', 'nav', 'section', 'heading', 'card', 'list', 'icon'] as const
  ).map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })),
];

const SIZE_MODES: Option<'fixed' | 'hug' | 'fill'>[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'hug', label: 'Hug' },
  { value: 'fill', label: 'Fill' },
];

const modeOf = (v: Node['w'] | undefined): 'fixed' | 'hug' | 'fill' | undefined =>
  v === undefined ? undefined : typeof v === 'number' ? 'fixed' : v;

// ---------------------------------------------------------------------------
// Layer: name, role, link, visibility, lock, opacity
// ---------------------------------------------------------------------------

export function LayerSection({ ctx }: { ctx: PropCtx }) {
  const role = ctx.get('role');
  const href = ctx.get('href');
  const opacity = ctx.get('opacity');
  const visible = ctx.get('visible');
  const lockedFlag = ctx.get('locked');
  return (
    <Section title="Layer">
      {ctx.single ? (
        <Row label="Name">
          <TextField
            ariaLabel="Layer name"
            field="name"
            value={ctx.single.name}
            disabled={ctx.locked}
            onCommit={(name) => ctx.set({ name: name.trim() || ctx.single?.name }, 'Rename layer')}
            validate={(v) => v.trim().length > 0}
          />
        </Row>
      ) : (
        <p className="row__note">{ctx.nodes.length} layers selected</p>
      )}
      <Row label="Role">
        <Select
          ariaLabel="Role"
          field="role"
          value={role.mixed ? undefined : (role.value ?? 'none')}
          mixed={role.mixed}
          options={ROLES}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ role: v === 'none' ? null : v }, 'Set role')}
        />
      </Row>
      {ctx.single && (
        <Row label="Link">
          <TextField
            ariaLabel="Link target"
            field="href"
            value={href.value}
            placeholder="https://…"
            disabled={ctx.locked}
            validate={(v) => v === '' || /^(#|\/|\.{1,2}\/|https?:\/\/|mailto:|tel:)/i.test(v)}
            onCommit={(v) => ctx.set({ href: v === '' ? null : v }, 'Set link')}
          />
        </Row>
      )}
      <Row label="Opacity">
        <NumberField
          label="%"
          ariaLabel="Opacity"
          field="opacity"
          value={opacity.value === undefined ? undefined : opacity.value * 100}
          mixed={opacity.mixed}
          min={0}
          max={100}
          precision={0}
          disabled={ctx.locked}
          onChange={(pct) => ctx.set({ opacity: pct / 100 }, 'Change opacity', 'prop:opacity')}
        />
      </Row>
      <Row label="Visible">
        <Toggle
          ariaLabel="Visible"
          field="visible"
          checked={visible.value !== false}
          mixed={visible.mixed}
          onChange={(v) => ctx.set({ visible: v }, v ? 'Show' : 'Hide')}
        />
      </Row>
      <Row label="Locked">
        <Toggle
          ariaLabel="Locked"
          field="locked"
          checked={lockedFlag.value === true}
          mixed={lockedFlag.mixed}
          onChange={(v) => ctx.set({ locked: v }, v ? 'Lock' : 'Unlock')}
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Layout: position, size modes, rotation
// ---------------------------------------------------------------------------

function SizeRow({ ctx, axis }: { ctx: PropCtx; axis: 'w' | 'h' }) {
  const label = axis === 'w' ? 'Width' : 'Height';
  const values = ctx.get(axis);
  const mode = modeOf(typeof values.value === 'number' ? values.value : values.value);
  const mixedMode = values.mixed && new Set(ctx.nodes.map((n) => modeOf(n[axis]))).size > 1;
  const numeric = typeof values.value === 'number' ? values.value : undefined;
  return (
    <Row label={label}>
      <Select
        ariaLabel={`${label} mode`}
        field={`${axis}-mode`}
        value={mixedMode ? undefined : mode}
        mixed={mixedMode}
        options={SIZE_MODES}
        disabled={ctx.locked}
        onChange={(m) =>
          ctx.setEach(
            (n) => ({
              [axis]:
                m === 'fixed'
                  ? Math.max(
                      1,
                      Math.round(
                        ctx.measure(n.id)?.[axis] ?? (typeof n[axis] === 'number' ? n[axis] : 100),
                      ),
                    )
                  : m,
            }),
            `${label}: ${m}`,
          )
        }
      />
      <NumberField
        label={axis.toUpperCase()}
        ariaLabel={label}
        field={axis}
        value={numeric}
        mixed={values.mixed && numeric === undefined && !mixedMode}
        placeholder={mode === 'fixed' || mode === undefined ? '' : 'Auto'}
        min={1}
        disabled={ctx.locked || (mode !== 'fixed' && !values.mixed)}
        onChange={(v) => ctx.set({ [axis]: Math.max(1, v) }, 'Resize', `prop:${axis}`)}
      />
    </Row>
  );
}

export function LayoutSection({ ctx }: { ctx: PropCtx }) {
  const x = ctx.get('x');
  const y = ctx.get('y');
  const rotation = ctx.get('rotation');
  const flowNote = 'Position is controlled by the parent’s auto layout';
  return (
    <Section title="Layout">
      <Row label="Position">
        <NumberField
          label="X"
          ariaLabel="X position"
          field="x"
          value={x.value}
          mixed={x.mixed}
          disabled={ctx.locked || ctx.allInFlow}
          title={ctx.allInFlow ? flowNote : undefined}
          onChange={(v) => ctx.set({ x: v }, 'Move', 'prop:x')}
        />
        <NumberField
          label="Y"
          ariaLabel="Y position"
          field="y"
          value={y.value}
          mixed={y.mixed}
          disabled={ctx.locked || ctx.allInFlow}
          title={ctx.allInFlow ? flowNote : undefined}
          onChange={(v) => ctx.set({ y: v }, 'Move', 'prop:y')}
        />
      </Row>
      <SizeRow ctx={ctx} axis="w" />
      <SizeRow ctx={ctx} axis="h" />
      <Row label="Rotation">
        <NumberField
          label="∠"
          ariaLabel="Rotation"
          field="rotation"
          value={rotation.value ?? 0}
          mixed={rotation.mixed}
          unit="°"
          precision={1}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ rotation: v === 0 ? null : v }, 'Rotate', 'prop:rotation')}
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Auto-layout (frames)
// ---------------------------------------------------------------------------

const DIRECTIONS: Option<'none' | 'row' | 'column'>[] = [
  { value: 'none', label: 'Free', title: 'Free positioning' },
  { value: 'row', label: 'Row', title: 'Auto layout: row' },
  { value: 'column', label: 'Column', title: 'Auto layout: column' },
];
const ALIGN: Option<'start' | 'center' | 'end' | 'stretch'>[] = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'stretch', label: 'Stretch' },
];
const JUSTIFY: Option<'start' | 'center' | 'end' | 'between'>[] = [
  { value: 'start', label: 'Start' },
  { value: 'center', label: 'Center' },
  { value: 'end', label: 'End' },
  { value: 'between', label: 'Space between' },
];

export function AutoLayoutSection({ ctx }: { ctx: PropCtx }) {
  const layout = ctx.get('layout');
  const gap = ctx.get('gap');
  const align = ctx.get('align');
  const justify = ctx.get('justify');
  const wrap = ctx.get('wrap');
  const clip = ctx.get('clip');
  const frames = ctx.nodes.filter((n) => n.type === 'frame');
  const flex = frames.some((n) => n.layout === 'row' || n.layout === 'column');
  const padSide = (i: number) => {
    const values = frames.map((n) => n.padding?.[i] ?? 0);
    const first = values[0];
    return { mixed: values.some((v) => v !== first), value: first };
  };
  const setPad = (i: number, v: number): void =>
    ctx.setEach(
      (n) => {
        const p: [number, number, number, number] = [...(n.padding ?? [0, 0, 0, 0])];
        p[i] = Math.max(0, v);
        return { padding: p };
      },
      'Change padding',
      `prop:padding${i}`,
    );
  const canSuggest = ctx.single?.type === 'frame' && !flex && ctx.single.children.length > 0;

  return (
    <Section title="Auto layout">
      <Row label="Direction">
        <Segmented
          ariaLabel="Layout direction"
          field="layout"
          value={layout.value ?? 'none'}
          mixed={layout.mixed}
          options={DIRECTIONS}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ layout: v }, 'Change layout')}
        />
      </Row>
      {canSuggest && (
        <button
          type="button"
          className="btn btn--secondary btn--small"
          disabled={ctx.locked}
          onClick={() => addAutoLayout({ store, measure: ctx.measure })}
        >
          Detect from children
        </button>
      )}
      {flex && (
        <>
          <Row label="Gap">
            <NumberField
              label="↔"
              ariaLabel="Gap between items"
              field="gap"
              value={gap.value ?? 0}
              mixed={gap.mixed}
              min={0}
              disabled={ctx.locked}
              onChange={(v) => ctx.set({ gap: Math.max(0, v) }, 'Change gap', 'prop:gap')}
            />
          </Row>
          <Row label="Padding">
            <div className="grid2">
              {(['T', 'R', 'B', 'L'] as const).map((side, i) => {
                const p = padSide(i);
                return (
                  <NumberField
                    key={side}
                    label={side}
                    ariaLabel={`Padding ${['top', 'right', 'bottom', 'left'][i] ?? ''}`}
                    field={`padding-${side.toLowerCase()}`}
                    value={p.value}
                    mixed={p.mixed}
                    min={0}
                    disabled={ctx.locked}
                    onChange={(v) => setPad(i, v)}
                  />
                );
              })}
            </div>
          </Row>
          <Row label="Align">
            <Select
              ariaLabel="Align items (cross axis)"
              field="align"
              value={align.value ?? 'start'}
              mixed={align.mixed}
              options={ALIGN}
              disabled={ctx.locked}
              onChange={(v) => ctx.set({ align: v }, 'Change alignment')}
            />
          </Row>
          <Row label="Justify">
            <Select
              ariaLabel="Justify items (main axis)"
              field="justify"
              value={justify.value ?? 'start'}
              mixed={justify.mixed}
              options={JUSTIFY}
              disabled={ctx.locked}
              onChange={(v) => ctx.set({ justify: v }, 'Change distribution')}
            />
          </Row>
          <Row label="Wrap">
            <Toggle
              ariaLabel="Wrap items"
              field="wrap"
              checked={wrap.value === true}
              mixed={wrap.mixed}
              disabled={ctx.locked}
              onChange={(v) => ctx.set({ wrap: v }, 'Toggle wrap')}
            />
          </Row>
        </>
      )}
      <Row label="Clip content">
        <Toggle
          ariaLabel="Clip content"
          field="clip"
          checked={clip.value === true}
          mixed={clip.mixed}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ clip: v }, 'Toggle clip')}
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Fill (solid, linear, radial, none)
// ---------------------------------------------------------------------------

type FillKind = 'none' | 'solid' | 'linear' | 'radial' | 'pattern';
const FILL_KINDS: Option<FillKind>[] = [
  { value: 'none', label: 'None' },
  { value: 'solid', label: 'Solid' },
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
  { value: 'pattern', label: 'Pattern' },
];

const fillKind = (v: Node['fill']): FillKind =>
  v === undefined
    ? 'none'
    : typeof v === 'object'
      ? 'pattern'
      : isGradient(v)
        ? v.startsWith('radial')
          ? 'radial'
          : 'linear'
        : 'solid';

/** The single colour (or gradient) a fill stands for: a pattern's base, else its ink. */
const flatFill = (v: Node['fill']): string | undefined =>
  typeof v === 'object' ? (v.background ?? v.color) : v;

const PATTERNS: Option<PatternName>[] = [
  { value: 'stripes', label: 'Stripes' },
  { value: 'halftone', label: 'Halftone dots' },
  { value: 'sunburst', label: 'Sunburst rays' },
  { value: 'noise', label: 'Noise' },
];

const PATTERN_UNITS: Record<PatternName, { size: string; spacing: string | null; angle: boolean }> =
  {
    stripes: { size: 'px', spacing: 'px', angle: true },
    halftone: { size: 'px', spacing: 'px', angle: false },
    sunburst: { size: 'deg', spacing: 'deg', angle: true },
    noise: { size: 'px', spacing: null, angle: false },
  };

function PatternEditor({
  fill,
  disabled,
  onChange,
}: {
  fill: PatternFill;
  disabled: boolean;
  onChange: (next: PatternFill) => void;
}) {
  const units = PATTERN_UNITS[fill.pattern];
  const set = (patch: Partial<PatternFill>): void => onChange({ ...fill, ...patch });
  const without = (key: keyof PatternFill): void => {
    const next = { ...fill };
    delete next[key];
    onChange(next);
  };
  return (
    <div className="pattern" data-testid="pattern-editor">
      <Select
        ariaLabel="Pattern"
        field="pattern"
        value={fill.pattern}
        options={PATTERNS}
        disabled={disabled}
        onChange={(v) => set({ pattern: v })}
      />
      <Row label="Ink">
        <ColorField
          ariaLabel="Pattern colour"
          field="pattern-color"
          value={fill.color}
          disabled={disabled}
          onChange={(v) => v !== undefined && set({ color: v })}
        />
      </Row>
      <div className="grid2">
        <NumberField
          label="S"
          ariaLabel="Pattern size"
          field="pattern-size"
          title={fill.pattern === 'sunburst' ? 'Ray width' : 'Dot or stripe size'}
          value={fill.size}
          placeholder="auto"
          min={0.5}
          precision={1}
          unit={units.size}
          disabled={disabled}
          onChange={(v) => set({ size: Math.max(0.5, v) })}
        />
        {units.spacing !== null && (
          <NumberField
            label="G"
            ariaLabel="Pattern spacing"
            field="pattern-spacing"
            title={fill.pattern === 'halftone' ? 'Distance between dot centres' : 'Gap'}
            value={fill.spacing}
            placeholder="auto"
            min={0.5}
            precision={1}
            unit={units.spacing}
            disabled={disabled}
            onChange={(v) => set({ spacing: Math.max(0.5, v) })}
          />
        )}
        {units.angle && (
          <NumberField
            label="A"
            ariaLabel="Pattern angle"
            field="pattern-angle"
            value={fill.angle}
            placeholder="auto"
            precision={1}
            unit="deg"
            disabled={disabled}
            onChange={(v) => set({ angle: v })}
          />
        )}
        <NumberField
          label="O"
          ariaLabel="Pattern opacity"
          field="pattern-opacity"
          title="Strength of the ink"
          value={Math.round((fill.opacity ?? 1) * 100)}
          min={0}
          max={100}
          precision={0}
          unit="%"
          disabled={disabled}
          onChange={(v) => set({ opacity: Math.min(1, Math.max(0, v / 100)) })}
        />
      </div>
      <Row label="Base">
        <ColorField
          ariaLabel="Pattern background"
          field="pattern-background"
          value={fill.background}
          allowNone
          disabled={disabled}
          onChange={(v) => (v === undefined ? without('background') : set({ background: v }))}
        />
      </Row>
    </div>
  );
}

export function FillSection({ ctx }: { ctx: PropCtx }) {
  const fill = ctx.get('fill');
  const kind = fillKind(fill.value);
  const setKind = (next: FillKind): void =>
    ctx.setEach((n) => {
      if (next === 'none') return { fill: null };
      const flat = flatFill(n.fill);
      if (next === 'pattern') {
        if (typeof n.fill === 'object') return null;
        return {
          fill: {
            pattern: 'stripes',
            color: '#FFFFFF',
            size: 6,
            opacity: 0.25,
            ...(flat === undefined ? {} : { background: flat }),
          },
        };
      }
      const current = flat ? (resolveColor(flat, ctx.tokens) ?? undefined) : undefined;
      const base = current && !isGradient(flat) ? flat : undefined;
      if (next === 'solid')
        return {
          fill:
            base ??
            (isGradient(flat)
              ? (parseGradient(flat ?? '')?.stops[0]?.color ?? '#D9D9D9')
              : '#D9D9D9'),
        };
      const model = parseGradient(flat ?? '') ?? DEFAULT_GRADIENT;
      const stops = base
        ? [
            { color: base, at: 0 },
            ...(model.stops.slice(1).length
              ? model.stops.slice(1)
              : [{ color: '#FFFFFF', at: 100 }]),
          ]
        : model.stops;
      return { fill: buildGradient({ ...model, kind: next, stops }) };
    }, 'Change fill type');
  const value = fill.value;
  return (
    <Section title="Fill">
      <Segmented
        ariaLabel="Fill type"
        field="fill-type"
        value={fill.mixed ? undefined : kind}
        mixed={fill.mixed}
        options={FILL_KINDS}
        disabled={ctx.locked}
        onChange={setKind}
      />
      {!fill.mixed && kind === 'solid' && typeof value === 'string' && (
        <ColorField
          ariaLabel="Fill colour"
          field="fill"
          value={value}
          allowNone
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ fill: v ?? null }, 'Change fill', 'prop:fill')}
        />
      )}
      {!fill.mixed && (kind === 'linear' || kind === 'radial') && typeof value === 'string' && (
        <GradientEditor
          value={value}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ fill: v }, 'Edit gradient', 'prop:fill')}
        />
      )}
      {!fill.mixed && kind === 'pattern' && typeof value === 'object' && (
        <PatternEditor
          fill={value}
          disabled={ctx.locked}
          onChange={(next) => ctx.set({ fill: next }, 'Edit pattern', 'prop:fill-pattern')}
        />
      )}
      {fill.mixed && (
        <ColorField
          ariaLabel="Fill colour"
          field="fill"
          value={undefined}
          mixed
          allowNone
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ fill: v ?? null }, 'Change fill')}
        />
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Stroke and radius
// ---------------------------------------------------------------------------

export function StrokeSection({ ctx }: { ctx: PropCtx }) {
  const stroke = ctx.get('stroke');
  const width = ctx.get('strokeWidth');
  const align = ctx.get('strokeAlign');
  const lineOnly = ctx.nodes.every((n) => n.type === 'line');
  return (
    <Section title="Stroke">
      <ColorField
        ariaLabel="Stroke colour"
        field="stroke"
        value={stroke.value}
        mixed={stroke.mixed}
        allowNone
        disabled={ctx.locked}
        onChange={(v) => ctx.set({ stroke: v ?? null }, 'Change stroke', 'prop:stroke')}
      />
      {!lineOnly && (
        <>
          <Row label="Width">
            <NumberField
              label="W"
              ariaLabel="Stroke width"
              field="strokeWidth"
              value={width.value ?? (stroke.value ? 1 : 0)}
              mixed={width.mixed}
              min={0}
              precision={1}
              disabled={ctx.locked}
              onChange={(v) =>
                ctx.set({ strokeWidth: Math.max(0, v) }, 'Change stroke width', 'prop:strokeWidth')
              }
            />
          </Row>
          <Row label="Position">
            <Segmented
              ariaLabel="Stroke position"
              field="strokeAlign"
              value={align.value ?? 'inside'}
              mixed={align.mixed}
              options={[
                { value: 'inside', label: 'Inside' },
                { value: 'center', label: 'Center' },
                { value: 'outside', label: 'Outside' },
              ]}
              disabled={ctx.locked}
              onChange={(v) => ctx.set({ strokeAlign: v }, 'Change stroke position')}
            />
          </Row>
        </>
      )}
    </Section>
  );
}

export function RadiusSection({ ctx }: { ctx: PropCtx }) {
  const radius = ctx.get('radius');
  const v = radius.value;
  const tokenName =
    typeof v === 'string' && v.startsWith('$radius.') ? v.slice('$radius.'.length) : undefined;
  const corners = Array.isArray(v) ? v : undefined;
  const uniform =
    typeof v === 'number'
      ? v
      : corners && corners.every((c) => c === corners[0])
        ? corners[0]
        : undefined;
  const tokenOptions: Option<string>[] = [
    { value: '', label: 'Custom' },
    ...Object.keys(ctx.tokens.radii).map((n) => ({
      value: n,
      label: `${n} (${ctx.tokens.radii[n]}px)`,
    })),
  ];
  const setCorner = (i: number, value: number): void =>
    ctx.setEach(
      (n) => {
        const cur = Array.isArray(n.radius)
          ? n.radius
          : [typeof n.radius === 'number' ? n.radius : 0, 0, 0, 0].map((x, idx) =>
              idx === 0 ? x : typeof n.radius === 'number' ? n.radius : 0,
            );
        const next = [...cur] as [number, number, number, number];
        next[i] = Math.max(0, value);
        return { radius: next };
      },
      'Change corner radius',
      `prop:radius${i}`,
    );
  return (
    <Section title="Corner radius">
      <Row label="Radius">
        <NumberField
          label="R"
          ariaLabel="Corner radius"
          field="radius"
          value={tokenName ? undefined : uniform}
          mixed={radius.mixed || (corners !== undefined && uniform === undefined)}
          placeholder={tokenName ? '' : undefined}
          min={0}
          disabled={ctx.locked || tokenName !== undefined}
          onChange={(n) =>
            ctx.set({ radius: n <= 0 ? null : Math.max(0, n) }, 'Change radius', 'prop:radius')
          }
        />
        {Object.keys(ctx.tokens.radii).length > 0 && (
          <Select
            ariaLabel="Radius token"
            field="radius-token"
            value={radius.mixed ? undefined : (tokenName ?? '')}
            mixed={radius.mixed}
            options={tokenOptions}
            disabled={ctx.locked}
            onChange={(name) =>
              ctx.set(
                {
                  radius:
                    name === '' ? (ctx.tokens.radii[tokenName ?? ''] ?? 0) : `$radius.${name}`,
                },
                'Change radius',
              )
            }
          />
        )}
      </Row>
      <Row label="Corners">
        <div className="grid2">
          {(['TL', 'TR', 'BR', 'BL'] as const).map((c, i) => (
            <NumberField
              key={c}
              label={c}
              ariaLabel={`Corner radius ${c}`}
              field={`radius-${c.toLowerCase()}`}
              value={corners ? corners[i] : typeof v === 'number' ? v : undefined}
              mixed={radius.mixed}
              min={0}
              disabled={ctx.locked || tokenName !== undefined}
              onChange={(n) => setCorner(i, n)}
            />
          ))}
        </div>
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Effects: shadows, blur
// ---------------------------------------------------------------------------

const NEW_SHADOW: Shadow = { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.12)' };

export function EffectsSection({ ctx }: { ctx: PropCtx }) {
  const shadow = ctx.get('shadow');
  const blur = ctx.get('blur');
  const backdrop = ctx.get('backdropBlur');
  const list: Shadow[] = ctx.single ? (ctx.single.shadow ?? []) : [];
  const setList = (next: Shadow[], label: string, key?: string): void =>
    ctx.set({ shadow: next.length ? next : null }, label, key);
  const edit = (i: number, patch: Partial<Shadow>, key: string): void =>
    setList(
      list.map((s, j) => (j === i ? { ...s, ...patch } : s)),
      'Edit shadow',
      key,
    );
  return (
    <Section
      title="Effects"
      actions={
        <button
          type="button"
          className="icon-btn icon-btn--small"
          aria-label="Add shadow"
          title="Add shadow"
          disabled={ctx.locked || !ctx.single}
          data-action="add-shadow"
          onClick={() => setList([...list, NEW_SHADOW], 'Add shadow')}
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      }
    >
      {!ctx.single && shadow.mixed && (
        <p className="row__note">Select one layer to edit its shadows.</p>
      )}
      {list.map((s, i) => (
        <div className="shadow" key={i} data-testid="shadow-row">
          <div className="grid2">
            <NumberField
              label="X"
              ariaLabel={`Shadow ${i + 1} x`}
              field={`shadow-${i}-x`}
              value={s.x}
              disabled={ctx.locked}
              onChange={(v) => edit(i, { x: v }, `shadow${i}x`)}
            />
            <NumberField
              label="Y"
              ariaLabel={`Shadow ${i + 1} y`}
              field={`shadow-${i}-y`}
              value={s.y}
              disabled={ctx.locked}
              onChange={(v) => edit(i, { y: v }, `shadow${i}y`)}
            />
            <NumberField
              label="B"
              ariaLabel={`Shadow ${i + 1} blur`}
              field={`shadow-${i}-blur`}
              value={s.blur}
              min={0}
              disabled={ctx.locked}
              onChange={(v) => edit(i, { blur: Math.max(0, v) }, `shadow${i}b`)}
            />
            <NumberField
              label="S"
              ariaLabel={`Shadow ${i + 1} spread`}
              field={`shadow-${i}-spread`}
              value={s.spread}
              disabled={ctx.locked}
              onChange={(v) => edit(i, { spread: v }, `shadow${i}s`)}
            />
          </div>
          <div className="shadow__foot">
            <ColorField
              ariaLabel={`Shadow ${i + 1} colour`}
              field={`shadow-${i}-color`}
              value={s.color}
              disabled={ctx.locked}
              onChange={(c) => c && edit(i, { color: c }, `shadow${i}c`)}
            />
            <label className="shadow__inset">
              <Toggle
                ariaLabel={`Shadow ${i + 1} inner`}
                field={`shadow-${i}-inset`}
                checked={s.inset === true}
                disabled={ctx.locked}
                onChange={(v) => edit(i, v ? { inset: true } : { inset: false }, `shadow${i}i`)}
              />
              Inner
            </label>
            <button
              type="button"
              className="icon-btn icon-btn--small"
              aria-label={`Remove shadow ${i + 1}`}
              disabled={ctx.locked}
              onClick={() =>
                setList(
                  list.filter((_, j) => j !== i),
                  'Remove shadow',
                )
              }
            >
              <X size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      <Row label="Blur">
        <NumberField
          label="B"
          ariaLabel="Layer blur"
          field="blur"
          value={blur.value ?? 0}
          mixed={blur.mixed}
          min={0}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ blur: v <= 0 ? null : v }, 'Change blur', 'prop:blur')}
        />
        <NumberField
          label="BG"
          ariaLabel="Background blur"
          field="backdropBlur"
          value={backdrop.value ?? 0}
          mixed={backdrop.mixed}
          min={0}
          disabled={ctx.locked}
          onChange={(v) =>
            ctx.set(
              { backdropBlur: v <= 0 ? null : v },
              'Change background blur',
              'prop:backdropBlur',
            )
          }
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Typography (text nodes)
// ---------------------------------------------------------------------------

const WEIGHTS: Option<string>[] = [
  ['100', 'Thin'],
  ['200', 'Extra light'],
  ['300', 'Light'],
  ['400', 'Regular'],
  ['500', 'Medium'],
  ['600', 'Semibold'],
  ['700', 'Bold'],
  ['800', 'Extra bold'],
  ['900', 'Black'],
].map(([value, label]) => ({
  value: value as string,
  label: `${label as string} (${value as string})`,
}));

export function TypographySection({ ctx }: { ctx: PropCtx }) {
  const text = ctx.get('text');
  const family = ctx.get('fontFamily');
  const size = ctx.get('fontSize');
  const weight = ctx.get('fontWeight');
  const lineHeight = ctx.get('lineHeight');
  const spacing = ctx.get('letterSpacing');
  const alignH = ctx.get('textAlign');
  const transform = ctx.get('textTransform');
  const color = ctx.get('color');
  return (
    <Section title="Typography">
      {ctx.single && (
        <textarea
          className="textarea"
          aria-label="Text content"
          data-field="text"
          rows={3}
          disabled={ctx.locked}
          value={text.value ?? ''}
          onChange={(e) => ctx.set({ text: e.target.value }, 'Edit text', 'prop:text')}
        />
      )}
      <FontPicker
        ariaLabel="Font"
        field="fontFamily"
        value={family.value}
        mixed={family.mixed}
        disabled={ctx.locked}
        onChange={(v) => ctx.set({ fontFamily: v }, 'Change font')}
      />
      <Row>
        <NumberField
          label="Aa"
          ariaLabel="Font size"
          field="fontSize"
          value={size.value}
          mixed={size.mixed}
          min={1}
          max={1000}
          disabled={ctx.locked}
          onChange={(v) =>
            ctx.set({ fontSize: Math.max(1, v) }, 'Change font size', 'prop:fontSize')
          }
        />
        <Select
          ariaLabel="Font weight"
          field="fontWeight"
          value={weight.mixed ? undefined : String(weight.value ?? 400)}
          mixed={weight.mixed}
          options={WEIGHTS}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ fontWeight: Number(v) }, 'Change font weight')}
        />
      </Row>
      <Row>
        <NumberField
          label="↕"
          ariaLabel="Line height"
          field="lineHeight"
          value={lineHeight.value ?? 1.4}
          mixed={lineHeight.mixed}
          min={0.1}
          max={20}
          step={0.05}
          precision={2}
          disabled={ctx.locked}
          onChange={(v) =>
            ctx.set({ lineHeight: Math.max(0.1, v) }, 'Change line height', 'prop:lineHeight')
          }
        />
        <NumberField
          label="↔"
          ariaLabel="Letter spacing"
          field="letterSpacing"
          value={spacing.value ?? 0}
          mixed={spacing.mixed}
          step={0.01}
          precision={3}
          unit="em"
          disabled={ctx.locked}
          onChange={(v) =>
            ctx.set(
              { letterSpacing: v === 0 ? null : v },
              'Change letter spacing',
              'prop:letterSpacing',
            )
          }
        />
      </Row>
      <Segmented
        ariaLabel="Text alignment"
        field="textAlign"
        value={alignH.value ?? 'left'}
        mixed={alignH.mixed}
        options={[
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' },
          { value: 'justify', label: 'Justify' },
        ]}
        disabled={ctx.locked}
        onChange={(v) => ctx.set({ textAlign: v }, 'Align text')}
      />
      <Row label="Case">
        <Select
          ariaLabel="Text case"
          field="textTransform"
          value={transform.value ?? 'none'}
          mixed={transform.mixed}
          options={[
            { value: 'none', label: 'As typed' },
            { value: 'uppercase', label: 'UPPERCASE' },
            { value: 'capitalize', label: 'Capitalize' },
          ]}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ textTransform: v === 'none' ? null : v }, 'Change text case')}
        />
      </Row>
      <Row label="Colour">
        <ColorField
          ariaLabel="Text colour"
          field="color"
          value={color.value}
          mixed={color.mixed}
          allowNone
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ color: v ?? null }, 'Change text colour', 'prop:color')}
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export function ImageSection({ ctx }: { ctx: PropCtx }) {
  const asset = ctx.get('assetId');
  const fit = ctx.get('fit');
  const input = useRef<HTMLInputElement>(null);
  const url = asset.value ? ctx.doc.assets[asset.value] : undefined;
  const replace = async (file: File): Promise<void> => {
    const measure = getCanvasApi()?.measure ?? (() => null);
    const [outcome] = await importImages({ store, measure }, [file], { insert: false });
    if (outcome?.ok)
      updateProps(store, ctx.ids, { assetId: outcome.assetId }, { label: 'Replace image' });
    else if (outcome)
      showToast(`${outcome.message}${outcome.hint ? ` ${outcome.hint}` : ''}`, { kind: 'error' });
  };
  return (
    <Section title="Image">
      {url && /^data:image\//.test(url) ? (
        <img className="imgprev" src={url} alt="" />
      ) : (
        <p className="row__note">{asset.mixed ? 'Different images selected' : 'No image'}</p>
      )}
      <button
        type="button"
        className="btn btn--secondary btn--small"
        disabled={ctx.locked}
        data-action="replace-image"
        onClick={() => input.current?.click()}
      >
        <Upload size={13} strokeWidth={1.75} aria-hidden="true" />
        Replace image…
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        data-testid="replace-image-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void replace(f);
        }}
      />
      <Row label="Fit">
        <Segmented
          ariaLabel="Image fit"
          field="fit"
          value={fit.value ?? 'cover'}
          mixed={fit.mixed}
          options={[
            { value: 'cover', label: 'Cover' },
            { value: 'contain', label: 'Contain' },
            { value: 'fill', label: 'Stretch' },
          ]}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ fit: v }, 'Change image fit')}
        />
      </Row>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Notes for export (free-form props such as aria-label, alt)
// ---------------------------------------------------------------------------

export function NotesSection({ ctx }: { ctx: PropCtx }) {
  const node = ctx.single;
  if (!node) return null;
  const entries = Object.entries(node.props ?? {});
  const write = (next: [string, string][], label: string): void =>
    ctx.set({ props: next.length ? Object.fromEntries(next) : null }, label);
  return (
    <Section
      title="Notes for export"
      defaultOpen={entries.length > 0}
      actions={
        <button
          type="button"
          className="icon-btn icon-btn--small"
          aria-label="Add note"
          title="Add a note such as aria-label or alt"
          disabled={ctx.locked}
          data-action="add-note"
          onClick={() => write([...entries, [`note${entries.length + 1}`, '']], 'Add note')}
        >
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      }
    >
      {entries.length === 0 && (
        <p className="row__note">Add `aria-label`, `alt` or any hint for the exported code.</p>
      )}
      {entries.map(([k, v], i) => (
        <div className="note" key={i}>
          <TextField
            ariaLabel={`Note ${i + 1} name`}
            field={`note-${i}-key`}
            value={k}
            disabled={ctx.locked}
            validate={(x) => /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(x)}
            onCommit={(nk) =>
              write(
                entries.map((e, j): [string, string] => (j === i ? [nk, e[1]] : e)),
                'Edit note',
              )
            }
          />
          <TextField
            ariaLabel={`Note ${i + 1} value`}
            field={`note-${i}-value`}
            value={v}
            disabled={ctx.locked}
            maxLength={500}
            onCommit={(nv) =>
              write(
                entries.map((e, j): [string, string] => (j === i ? [e[0], nv] : e)),
                'Edit note',
              )
            }
          />
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label={`Remove note ${i + 1}`}
            disabled={ctx.locked}
            onClick={() =>
              write(
                entries.filter((_, j) => j !== i),
                'Remove note',
              )
            }
          >
            <X size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ))}
    </Section>
  );
}
