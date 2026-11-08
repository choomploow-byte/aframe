import { fontStack } from '@core/style';
import { resolveFont } from '@core/tokens';
import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { BUNDLED_FONTS, loadFonts } from '../canvas/fonts';
import { useAFrame } from '../store/store';
import { Popover } from './Popover';

interface FontPickerProps {
  ariaLabel: string;
  /** A family name or a `$font.token`. */
  value: string | undefined;
  mixed?: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
  field?: string;
}

/** Each option is set in its own typeface, so you choose by looking (docs/07 "live preview"). */
export function FontPicker({
  ariaLabel,
  value,
  mixed,
  onChange,
  disabled,
  field,
}: FontPickerProps) {
  const tokens = useAFrame((s) => s.doc.tokens);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const family =
    resolveFont(value, tokens) ?? (value && !value.startsWith('$') ? value : undefined);
  const pick = (v: string): void => {
    if (!v.startsWith('$')) void loadFonts([v]); // start loading now so the canvas does not flash a fallback face
    onChange(v);
    setOpen(false);
  };
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="fontpicker"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        data-field={field}
        onClick={() => setOpen((o) => !o)}
      >
        <span
          className="fontpicker__name"
          style={{ fontFamily: family ? fontStack(family) : undefined }}
        >
          {mixed
            ? 'Mixed'
            : value?.startsWith('$')
              ? `${family ?? value}  (${value})`
              : (value ?? 'Default')}
        </span>
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <Popover anchor={anchor} label="Fonts" onClose={() => setOpen(false)} minWidth={240}>
          <div className="fontpop" role="listbox" aria-label="Fonts">
            {Object.keys(tokens.fonts).length > 0 && (
              <>
                <h3 className="colorpop__title">Fonts in this design</h3>
                {Object.entries(tokens.fonts).map(([name, fam]) => {
                  const resolved = resolveFont(`$font.${name}`, tokens) ?? fam;
                  return (
                    <button
                      key={name}
                      type="button"
                      role="option"
                      aria-selected={value === `$font.${name}`}
                      className="fontpop__item"
                      data-font={`$font.${name}`}
                      onClick={() => pick(`$font.${name}`)}
                    >
                      <span style={{ fontFamily: fontStack(resolved) }}>{resolved}</span>
                      <span className="menu__hint">{`$font.${name}`}</span>
                    </button>
                  );
                })}
              </>
            )}
            <h3 className="colorpop__title">Bundled</h3>
            {BUNDLED_FONTS.map((f) => (
              <button
                key={f.name}
                type="button"
                role="option"
                aria-selected={value === f.name}
                className="fontpop__item"
                data-font={f.name}
                onClick={() => pick(f.name)}
              >
                <span style={{ fontFamily: fontStack(f.name) }}>{f.name}</span>
                <span className="menu__hint">{f.category}</span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
