import { Plus, X } from 'lucide-react';
import { resolveColor } from '@core/tokens';
import { isValidColor } from '@core/validate';
import { useAtelier } from '../store/store';
import { ColorField } from '../ui/ColorField';
import { NumberField, TextField } from '../ui/fields';
import { buildGradient, parseGradient, type GradientModel } from './gradient';

interface GradientEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const MAX_STOPS = 5;

/**
 * Edits a linear or radial gradient fill. Gradients stay plain CSS strings in the document; when
 * a hand-written one cannot be read back (`to right`, `conic`), the raw text is offered instead of
 * silently rewriting it.
 */
export function GradientEditor({ value, onChange, disabled }: GradientEditorProps) {
  const tokens = useAtelier((s) => s.doc.tokens);
  const model = parseGradient(value);
  if (!model) {
    return (
      <TextField
        ariaLabel="Gradient (CSS)"
        value={value}
        disabled={disabled}
        field="fill-raw"
        validate={isValidColor}
        onCommit={onChange}
      />
    );
  }
  const update = (next: GradientModel): void => onChange(buildGradient(next));
  const setStop = (i: number, patch: Partial<GradientModel['stops'][number]>): void =>
    update({ ...model, stops: model.stops.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="gradient" data-testid="gradient-editor">
      {model.kind === 'linear' && (
        <NumberField
          label="∠"
          ariaLabel="Gradient angle"
          value={model.angle}
          min={-360}
          max={360}
          precision={1}
          unit="°"
          disabled={disabled}
          field="gradient-angle"
          onChange={(angle) => update({ ...model, angle })}
        />
      )}
      <div
        className="gradient__preview"
        style={{ background: resolveColor(value, tokens) }}
        aria-hidden="true"
        data-gradient-preview
      />
      {model.stops.map((stop, i) => (
        <div className="gradient__stop" key={i}>
          <ColorField
            ariaLabel={`Stop ${i + 1} colour`}
            value={stop.color}
            disabled={disabled}
            field={`gradient-stop-${i}`}
            onChange={(c) => c && setStop(i, { color: c })}
          />
          <NumberField
            label="%"
            ariaLabel={`Stop ${i + 1} position`}
            value={stop.at}
            min={0}
            max={100}
            precision={0}
            disabled={disabled}
            field={`gradient-pos-${i}`}
            onChange={(at) => setStop(i, { at })}
          />
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label={`Remove stop ${i + 1}`}
            disabled={disabled || model.stops.length <= 2}
            onClick={() => update({ ...model, stops: model.stops.filter((_, j) => j !== i) })}
          >
            <X size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={disabled || model.stops.length >= MAX_STOPS}
        onClick={() => {
          const last = model.stops[model.stops.length - 1];
          update({
            ...model,
            stops: [...model.stops, { color: last?.color ?? '#FFFFFF', at: 100 }].map(
              (s, i, all) => ({ ...s, at: i === all.length - 1 ? 100 : s.at }),
            ),
          });
        }}
      >
        <Plus size={13} strokeWidth={2} aria-hidden="true" />
        Add stop
      </button>
    </div>
  );
}
