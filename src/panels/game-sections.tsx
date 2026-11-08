import type { AlignEdge } from '@core/arrange';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  FlipHorizontal2,
  FlipVertical2,
  Grid3x3,
  Ungroup,
} from 'lucide-react';
import { BLEND_MODES, type BlendMode } from '@core/types';
import type { ReactNode } from 'react';
import { getCanvasApi } from '../canvas/canvas-api';
import {
  alignSelection,
  distributeSelection,
  flipSelection,
  gridSelection,
  matchSizeSelection,
  repeatSelection,
  ungroupSelection,
  type CommandResult,
} from '../store/game-commands';
import { store } from '../store/store';
import { ColorField } from '../ui/ColorField';
import { NumberField, Row, Section, Segmented, Select } from '../ui/fields';
import { GradientEditor } from './GradientEditor';
import { buildGradient, DEFAULT_GRADIENT, isGradient, parseGradient } from './gradient';
import { showToast } from '../ui/toast';
import type { PropCtx } from './prop-context';

/**
 * Properties sections for the game-UI toolkit: arranging several layers, mirroring, outlined
 * lettering and colour adjustments (hue shift and friends). Each writes the same properties the AI
 * tools do, as one undo step.
 */

const env = () => ({ store, measure: (id: string) => getCanvasApi()?.measure(id) ?? null });

/** Runs a command and tells the user, in words, why it could not. */
function report(result: CommandResult): void {
  if (!result.ok) showToast(result.reason, { kind: 'error' });
}

function Tool({
  label,
  field,
  disabled,
  onClick,
  children,
}: {
  label: string;
  field: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={label}
      title={label}
      data-field={field}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

const ALIGN_TOOLS: { edge: AlignEdge; label: string; icon: ReactNode }[] = [
  { edge: 'left', label: 'Align left', icon: <AlignStartVertical {...ICON} /> },
  { edge: 'center', label: 'Align horizontal centres', icon: <AlignCenterVertical {...ICON} /> },
  { edge: 'right', label: 'Align right', icon: <AlignEndVertical {...ICON} /> },
  { edge: 'top', label: 'Align top', icon: <AlignStartHorizontal {...ICON} /> },
  { edge: 'middle', label: 'Align vertical centres', icon: <AlignCenterHorizontal {...ICON} /> },
  { edge: 'bottom', label: 'Align bottom', icon: <AlignEndHorizontal {...ICON} /> },
];

/** Align, distribute, grid, match size, flip, ungroup. Aligning one layer aligns it to its parent. */
export function ArrangeSection({ ctx }: { ctx: PropCtx }) {
  const many = ctx.nodes.length > 1;
  const inFlow = ctx.allInFlow;
  const frameSelected = ctx.nodes.some((n) => n.type === 'frame');
  return (
    <Section title="Arrange" defaultOpen={many}>
      {inFlow && (
        <p className="row__note">
          This layer sits in an auto-layout frame, which places it. Use the frame's gap, align and
          justify to arrange it.
        </p>
      )}
      <div className="toolrow" role="group" aria-label="Align">
        {ALIGN_TOOLS.map((t) => (
          <Tool
            key={t.edge}
            label={many ? t.label : `${t.label} (to parent)`}
            field={`align-${t.edge}`}
            disabled={ctx.locked || inFlow}
            onClick={() => report(alignSelection(env(), t.edge))}
          >
            {t.icon}
          </Tool>
        ))}
      </div>
      <div className="toolrow" role="group" aria-label="Spacing and size">
        <Tool
          label="Distribute horizontally"
          field="distribute-h"
          disabled={ctx.locked || inFlow || ctx.nodes.length < 3}
          onClick={() => report(distributeSelection(env(), 'horizontal'))}
        >
          <AlignHorizontalSpaceBetween {...ICON} />
        </Tool>
        <Tool
          label="Distribute vertically"
          field="distribute-v"
          disabled={ctx.locked || inFlow || ctx.nodes.length < 3}
          onClick={() => report(distributeSelection(env(), 'vertical'))}
        >
          <AlignVerticalSpaceBetween {...ICON} />
        </Tool>
        <Tool
          label="Arrange in a grid"
          field="grid"
          disabled={ctx.locked || inFlow || !many}
          onClick={() =>
            report(gridSelection(env(), Math.max(1, Math.ceil(Math.sqrt(ctx.nodes.length)))))
          }
        >
          <Grid3x3 {...ICON} />
        </Tool>
        <Tool
          label="Flip horizontally"
          field="flipX"
          disabled={ctx.locked}
          onClick={() => report(flipSelection(store, 'x'))}
        >
          <FlipHorizontal2 {...ICON} />
        </Tool>
        <Tool
          label="Flip vertically"
          field="flipY"
          disabled={ctx.locked}
          onClick={() => report(flipSelection(store, 'y'))}
        >
          <FlipVertical2 {...ICON} />
        </Tool>
        <Tool
          label="Ungroup"
          field="ungroup"
          disabled={ctx.locked || !frameSelected}
          onClick={() => report(ungroupSelection(env()))}
        >
          <Ungroup {...ICON} />
        </Tool>
      </div>
      {many && !inFlow && (
        <div className="toolrow toolrow--text" role="group" aria-label="Match size">
          <button
            type="button"
            className="btn btn--secondary btn--small"
            data-field="match-w"
            disabled={ctx.locked}
            onClick={() => report(matchSizeSelection(env(), 'w'))}
          >
            Same width
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            data-field="match-h"
            disabled={ctx.locked}
            onClick={() => report(matchSizeSelection(env(), 'h'))}
          >
            Same height
          </button>
        </div>
      )}
      {ctx.single && (
        <div className="toolrow toolrow--text" role="group" aria-label="Repeat">
          {[2, 4, 6].map((count) => (
            <button
              key={count}
              type="button"
              className="btn btn--secondary btn--small"
              data-field={`repeat-${count}`}
              disabled={ctx.locked}
              title={`Make ${count} copies in a ${count > 3 ? 'grid' : 'row'}`}
              onClick={() =>
                report(
                  repeatSelection(
                    env(),
                    count,
                    count > 3 ? 'grid' : 'row',
                    count > 3 ? Math.ceil(count / 2) : undefined,
                  ),
                )
              }
            >
              Repeat ×{count}
            </button>
          ))}
        </div>
      )}
    </Section>
  );
}

/** Outline round the letters: the game-title look. */
export function TextOutlineSection({ ctx }: { ctx: PropCtx }) {
  const stroke = ctx.get('textStroke');
  const width = ctx.get('textStrokeWidth');
  const color = ctx.get('color');
  const gradient = typeof color.value === 'string' && isGradient(color.value);
  return (
    <Section title="Outline and gradient" defaultOpen={stroke.value !== undefined || gradient}>
      <Row label="Letters">
        <Segmented
          ariaLabel="Text fill"
          field="text-fill-type"
          value={gradient ? 'gradient' : 'solid'}
          mixed={color.mixed}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
          ]}
          disabled={ctx.locked}
          onChange={(v) => {
            if (v === 'gradient') {
              ctx.set({ color: buildGradient(DEFAULT_GRADIENT) }, 'Gradient text');
            } else {
              const first =
                typeof color.value === 'string'
                  ? parseGradient(color.value)?.stops[0]?.color
                  : undefined;
              ctx.set({ color: first ?? '#FFFFFF' }, 'Solid text colour');
            }
          }}
        />
      </Row>
      {gradient && typeof color.value === 'string' && (
        <GradientEditor
          value={color.value}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ color: v }, 'Edit text gradient', 'prop:color')}
        />
      )}
      <ColorField
        ariaLabel="Text outline colour"
        field="textStroke"
        value={stroke.value}
        mixed={stroke.mixed}
        allowNone
        disabled={ctx.locked}
        onChange={(v) =>
          ctx.set(
            v === undefined || v === null
              ? { textStroke: null, textStrokeWidth: null }
              : { textStroke: v },
            'Change text outline',
            'prop:textStroke',
          )
        }
      />
      <Row label="Width">
        <NumberField
          label="W"
          ariaLabel="Text outline width"
          field="textStrokeWidth"
          value={width.value ?? (stroke.value ? 2 : 0)}
          mixed={width.mixed}
          min={0}
          max={100}
          precision={1}
          disabled={ctx.locked || stroke.value === undefined}
          onChange={(v) =>
            ctx.set({ textStrokeWidth: Math.max(0, v) }, 'Change text outline width', 'prop:tsw')
          }
        />
      </Row>
    </Section>
  );
}

/** Hue shift, saturation, brightness and contrast: recolour an image or ease any layer's colour. */
export function AdjustSection({ ctx }: { ctx: PropCtx }) {
  const hue = ctx.get('hue');
  const saturation = ctx.get('saturation');
  const brightness = ctx.get('brightness');
  const contrast = ctx.get('contrast');
  const blend = ctx.get('blendMode');
  const touched =
    ctx.single !== null &&
    [ctx.single.hue, ctx.single.saturation, ctx.single.brightness, ctx.single.contrast].some(
      (v) => v !== undefined,
    );
  const multiplier = (
    key: 'saturation' | 'brightness' | 'contrast',
    label: string,
    short: string,
    current: { value: number | undefined; mixed: boolean },
  ) => (
    <NumberField
      label={short}
      ariaLabel={label}
      field={key}
      value={Math.round((current.value ?? 1) * 100)}
      mixed={current.mixed}
      min={0}
      max={1000}
      unit="%"
      precision={0}
      disabled={ctx.locked}
      onChange={(v) =>
        ctx.set(
          { [key]: v === 100 ? null : Math.max(0, v) / 100 },
          `Change ${label}`,
          `prop:${key}`,
        )
      }
    />
  );
  return (
    <Section title="Colour adjust" defaultOpen={touched || blend.value !== undefined}>
      <Row label="Blend">
        <Select<BlendMode>
          ariaLabel="Blend mode"
          field="blendMode"
          value={blend.value ?? 'normal'}
          mixed={blend.mixed}
          options={BLEND_MODES.map((m) => ({ value: m, label: m.replace('-', ' ') }))}
          disabled={ctx.locked}
          onChange={(v) => ctx.set({ blendMode: v === 'normal' ? null : v }, 'Change blend mode')}
        />
      </Row>
      <Row label="Hue">
        <NumberField
          label="H"
          ariaLabel="Hue shift"
          field="hue"
          value={hue.value ?? 0}
          mixed={hue.mixed}
          min={-360}
          max={360}
          unit="°"
          precision={0}
          disabled={ctx.locked}
          title="Rotates every colour round the wheel: turn a blue button green with 120"
          onChange={(v) => ctx.set({ hue: v === 0 ? null : v }, 'Change hue', 'prop:hue')}
        />
      </Row>
      <div className="grid2">
        {multiplier('saturation', 'Saturation', 'S', saturation)}
        {multiplier('brightness', 'Brightness', 'B', brightness)}
        {multiplier('contrast', 'Contrast', 'C', contrast)}
        <button
          type="button"
          className="btn btn--secondary btn--small"
          data-field="adjust-reset"
          disabled={ctx.locked || !touched}
          onClick={() =>
            ctx.set(
              { hue: null, saturation: null, brightness: null, contrast: null },
              'Reset colour adjust',
            )
          }
        >
          Reset
        </button>
      </div>
    </Section>
  );
}
