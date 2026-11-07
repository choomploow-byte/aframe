import { ChevronDown } from 'lucide-react';
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { evaluateExpression } from '../panels/math';

/** Small form controls shared by every panel. Native elements wherever one does the job. */

// ---------------------------------------------------------------------------
// Number field: type, arrow keys, drag the label to scrub, or type maths ("16*2")
// ---------------------------------------------------------------------------

export interface NumberFieldProps {
  /** Short visible label ("X", "W"); dragging it scrubs the value. */
  label: string;
  /** Full accessible name ("Width"). */
  ariaLabel: string;
  value: number | undefined;
  mixed?: boolean;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimals kept (default 2). */
  precision?: number;
  disabled?: boolean;
  unit?: string;
  placeholder?: string;
  /** For tests: `data-field`. */
  field?: string;
  title?: string;
}

const formatNumber = (v: number, precision: number): string =>
  String(Math.round(v * 10 ** precision) / 10 ** precision);

export function NumberField({
  label,
  ariaLabel,
  value,
  mixed,
  onChange,
  min,
  max,
  step = 1,
  precision = 2,
  disabled,
  unit,
  placeholder,
  field,
  title,
}: NumberFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const scrub = useRef<{ x: number; start: number } | null>(null);
  const clamp = (v: number): number =>
    Math.min(
      max ?? Infinity,
      Math.max(min ?? -Infinity, Math.round(v * 10 ** precision) / 10 ** precision),
    );
  const shown = text ?? (mixed || value === undefined ? '' : formatNumber(value, precision));

  const commit = (raw: string): void => {
    const v = evaluateExpression(raw);
    setText(null);
    if (v !== null && v !== value) onChange(clamp(v));
  };

  const modifierStep = (e: { shiftKey: boolean; altKey: boolean }): number =>
    step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setText(null);
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = evaluateExpression(e.currentTarget.value) ?? value ?? 0;
      const next = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * modifierStep(e));
      setText(formatNumber(next, precision));
      onChange(next);
    }
  };

  const onScrubDown = (e: PointerEvent<HTMLElement>): void => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, start: value ?? 0 };
  };
  const onScrubMove = (e: PointerEvent<HTMLElement>): void => {
    const s = scrub.current;
    if (!s) return;
    onChange(clamp(s.start + (e.clientX - s.x) * modifierStep(e)));
  };
  const onScrubUp = (e: PointerEvent<HTMLElement>): void => {
    scrub.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <label className={`numfield${disabled ? ' numfield--disabled' : ''}`} title={title}>
      <span
        className="numfield__label"
        aria-hidden="true"
        onPointerDown={onScrubDown}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubUp}
        onPointerCancel={onScrubUp}
      >
        {label}
      </span>
      <input
        className="numfield__input"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        data-field={field}
        disabled={disabled}
        value={shown}
        placeholder={mixed ? 'Mixed' : placeholder}
        onFocus={(e) => {
          setText(mixed || value === undefined ? '' : formatNumber(value, precision));
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {unit && (
        <span className="numfield__unit" aria-hidden="true">
          {unit}
        </span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Text field
// ---------------------------------------------------------------------------

interface TextFieldProps {
  ariaLabel: string;
  value: string | undefined;
  mixed?: boolean;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  field?: string;
  maxLength?: number;
  /** Commit as you type (otherwise on Enter or blur). */
  live?: boolean;
  /** Validates before committing; returning false keeps the old value and flags the field. */
  validate?: (value: string) => boolean;
}

export function TextField({
  ariaLabel,
  value,
  mixed,
  onCommit,
  placeholder,
  disabled,
  field,
  maxLength,
  live,
  validate,
}: TextFieldProps) {
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const shown = text ?? (mixed ? '' : (value ?? ''));
  const commit = (raw: string): void => {
    setText(null);
    if (raw === (value ?? '')) return setInvalid(false);
    if (validate && !validate(raw)) return setInvalid(true);
    setInvalid(false);
    onCommit(raw);
  };
  return (
    <input
      className={`textfield${invalid ? ' textfield--invalid' : ''}`}
      type="text"
      autoComplete="off"
      spellCheck={false}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      data-field={field}
      disabled={disabled}
      maxLength={maxLength}
      value={shown}
      placeholder={mixed ? 'Mixed' : placeholder}
      onFocus={(e) => {
        setText(mixed ? '' : (value ?? ''));
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (live) onCommit(e.target.value);
      }}
      onBlur={(e) => (live ? setText(null) : commit(e.currentTarget.value))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (live) e.currentTarget.blur();
          else commit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          setText(null);
          setInvalid(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Select (native), segmented control, toggle
// ---------------------------------------------------------------------------

export interface Option<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

interface SelectProps<T extends string> {
  ariaLabel: string;
  value: T | undefined;
  mixed?: boolean;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  field?: string;
}

export function Select<T extends string>({
  ariaLabel,
  value,
  mixed,
  options,
  onChange,
  disabled,
  field,
}: SelectProps<T>) {
  const none = mixed || value === undefined;
  return (
    <span className="select">
      <select
        aria-label={ariaLabel}
        data-field={field}
        disabled={disabled}
        value={none ? '' : value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {none && (
          <option value="" disabled>
            {mixed ? 'Mixed' : '—'}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {typeof o.label === 'string' ? o.label : o.value}
          </option>
        ))}
      </select>
      <ChevronDown className="select__chevron" size={12} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

interface SegmentedProps<T extends string> {
  ariaLabel: string;
  value: T | undefined;
  mixed?: boolean;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  field?: string;
}

/** A radio group drawn as buttons; arrow keys move the choice. */
export function Segmented<T extends string>({
  ariaLabel,
  value,
  mixed,
  options,
  onChange,
  disabled,
  field,
}: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = mixed ? -1 : options.findIndex((o) => o.value === value);
  const move = (from: number, delta: number): void => {
    const i = (from + delta + options.length) % options.length;
    const option = options[i];
    if (option) {
      onChange(option.value);
      refs.current[i]?.focus();
    }
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel} data-field={field}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={i === selected}
          aria-label={o.title}
          title={o.title}
          disabled={disabled}
          tabIndex={i === selected || (selected === -1 && i === 0) ? 0 : -1}
          data-value={o.value}
          className="segmented__btn"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault();
              move(i, -1);
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface ToggleProps {
  ariaLabel: string;
  checked: boolean;
  mixed?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  field?: string;
}

export function Toggle({ ariaLabel, checked, mixed, onChange, disabled, field }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={mixed ? 'mixed' : checked}
      data-field={field}
      disabled={disabled}
      className={`toggle${checked && !mixed ? ' toggle--on' : ''}${mixed ? ' toggle--mixed' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle__knob" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers for panels
// ---------------------------------------------------------------------------

export function Section({
  title,
  children,
  defaultOpen = true,
  actions,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="section" aria-labelledby={`${id}-h`}>
      <header className="section__header">
        <button
          type="button"
          id={`${id}-h`}
          className="section__toggle"
          aria-expanded={open}
          aria-controls={`${id}-b`}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown
            size={12}
            strokeWidth={2}
            className={`section__chevron${open ? '' : ' section__chevron--closed'}`}
            aria-hidden="true"
          />
          {title}
        </button>
        {actions}
      </header>
      {open && (
        <div id={`${id}-b`} className="section__body">
          {children}
        </div>
      )}
    </section>
  );
}

export function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="row">
      {label && <span className="row__label">{label}</span>}
      <div className="row__controls">{children}</div>
    </div>
  );
}
