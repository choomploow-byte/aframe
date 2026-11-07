import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { STRINGS } from '../strings';
import { useAtelier } from '../store/store';
import { getCanvasApi } from './canvas-api';

/** "100% ▾" at the bottom right of the canvas. */
export function ZoomControl() {
  const zoom = useAtelier((s) => s.viewport.zoom);
  const [open, setOpen] = useState(false);

  const run = (action: (api: NonNullable<ReturnType<typeof getCanvasApi>>) => void): void => {
    setOpen(false);
    const api = getCanvasApi();
    if (api) action(api);
  };

  const percent = zoom >= 0.995 ? Math.round(zoom * 100) : Math.round(zoom * 1000) / 10;

  return (
    <div className="zoom" data-ui>
      <button
        type="button"
        className="zoom__btn"
        aria-label={STRINGS.zoom.label}
        aria-expanded={open}
        data-testid="zoom-level"
        onClick={() => setOpen((o) => !o)}
      >
        {percent}%
        <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="menu menu--up menu--right" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => run((a) => a.zoomStep(1))}
          >
            <span>{STRINGS.zoom.in}</span>
            <span className="menu__hint">+</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => run((a) => a.zoomStep(-1))}
          >
            <span>{STRINGS.zoom.out}</span>
            <span className="menu__hint">−</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => run((a) => a.zoomTo(1))}
          >
            <span>{STRINGS.zoom.actual}</span>
            <span className="menu__hint">Ctrl+0</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => run((a) => a.fitAll())}
          >
            <span>{STRINGS.zoom.fitAll}</span>
            <span className="menu__hint">Shift+1</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu__item"
            onClick={() => run((a) => a.fitSelection())}
          >
            <span>{STRINGS.zoom.fitSelection}</span>
            <span className="menu__hint">Shift+2</span>
          </button>
        </div>
      )}
    </div>
  );
}
