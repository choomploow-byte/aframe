import { isValidColor } from '@core/validate';
import { resolveColor } from '@core/tokens';
import { Ban } from 'lucide-react';
import { useRef, useState } from 'react';
import { normalizeHexInput, parseHex, readableOn, toHex } from '../panels/color';
import { useAtelier } from '../store/store';
import { NumberField } from './fields';
import { Popover } from './Popover';

interface ColorFieldProps {
  ariaLabel: string;
  /** A literal colour, a `$token`, or undefined for "none". */
  value: string | undefined;
  mixed?: boolean;
  onChange: (value: string | undefined) => void;
  /** Offer a "none" button that clears the value. */
  allowNone?: boolean;
  disabled?: boolean;
  field?: string;
}

/**
 * Swatch + text box + popover. The popover lists the document's colour tokens first (so the
 * easy path keeps designs on-system), then a custom picker with opacity. Typing accepts hex,
 * rgb(), hsl() and `$token`; anything the document would reject is refused.
 */
export function ColorField({
  ariaLabel,
  value,
  mixed,
  onChange,
  allowNone,
  disabled,
  field,
}: ColorFieldProps) {
  const tokens = useAtelier((s) => s.doc.tokens);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const resolved = value ? resolveColor(value, tokens) : undefined;
  const rgba = resolved ? parseHex(resolved) : null;
  const tokenName = value?.startsWith('$') ? value.slice(1) : null;
  const shown = text ?? (mixed ? '' : (value ?? ''));

  const commitText = (raw: string): void => {
    setText(null);
    const t = raw.trim();
    if (t === (value ?? '')) return setInvalid(false);
    if (t === '') {
      setInvalid(false);
      if (allowNone) onChange(undefined);
      return;
    }
    const hex = normalizeHexInput(t);
    const candidate = hex ?? t;
    if (!isValidColor(candidate)) return setInvalid(true);
    setInvalid(false);
    onChange(candidate);
  };

  return (
    <div className="colorfield">
      <button
        ref={anchor}
        type="button"
        className="colorfield__swatch"
        aria-label={`${ariaLabel}: choose colour`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        data-field={field ? `${field}-swatch` : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="colorfield__chip"
          style={{ background: mixed ? undefined : (resolved ?? undefined) }}
          data-empty={!resolved || mixed ? 'true' : undefined}
        />
      </button>
      <input
        className={`textfield colorfield__text${invalid ? ' textfield--invalid' : ''}`}
        type="text"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        data-field={field}
        disabled={disabled}
        value={shown}
        placeholder={mixed ? 'Mixed' : allowNone ? 'None' : ''}
        onFocus={(e) => {
          setText(mixed ? '' : (value ?? ''));
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commitText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitText(e.currentTarget.value);
          if (e.key === 'Escape') {
            e.stopPropagation();
            setText(null);
            setInvalid(false);
            e.currentTarget.blur();
          }
        }}
      />
      {open && (
        <Popover
          anchor={anchor}
          label={`${ariaLabel} colour`}
          onClose={() => setOpen(false)}
          minWidth={232}
        >
          <div className="colorpop">
            {Object.keys(tokens.colors).length > 0 && (
              <>
                <h3 className="colorpop__title">Colours in this design</h3>
                <div className="colorpop__tokens" role="listbox" aria-label="Colour tokens">
                  {Object.entries(tokens.colors).map(([name, v]) => {
                    const px = resolveColor(`$${name}`, tokens) ?? v;
                    const rgb = parseHex(px);
                    return (
                      <button
                        key={name}
                        type="button"
                        role="option"
                        aria-selected={tokenName === name}
                        className="colorpop__token"
                        data-token={name}
                        title={`$${name}  ${v}`}
                        onClick={() => {
                          onChange(`$${name}`);
                          setOpen(false);
                        }}
                      >
                        <span
                          className="colorpop__dot"
                          style={{ background: px, color: rgb ? readableOn(rgb) : undefined }}
                        >
                          {tokenName === name ? '✓' : ''}
                        </span>
                        <span className="colorpop__name">{name}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <h3 className="colorpop__title">Custom</h3>
            <div className="colorpop__custom">
              <input
                type="color"
                className="colorpop__native"
                aria-label="Pick a colour"
                value={rgba ? toHex({ ...rgba, a: 1 }).toLowerCase() : '#000000'}
                onChange={(e) =>
                  onChange(
                    toHex({
                      ...(parseHex(e.target.value) ?? { r: 0, g: 0, b: 0 }),
                      a: rgba?.a ?? 1,
                    }),
                  )
                }
              />
              <NumberField
                label="%"
                ariaLabel="Opacity"
                value={rgba ? Math.round(rgba.a * 100) : 100}
                min={0}
                max={100}
                precision={0}
                disabled={!rgba}
                onChange={(pct) => rgba && onChange(toHex({ ...rgba, a: pct / 100 }))}
              />
              {allowNone && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="No colour"
                  title="No colour"
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                >
                  <Ban size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
