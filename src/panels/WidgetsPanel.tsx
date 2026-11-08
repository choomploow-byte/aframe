import { GAME_THEMES } from '@core/themes';
import { WIDGET_INFO, WIDGET_KINDS } from '@core/widgets';
import { getCanvasApi } from '../canvas/canvas-api';
import { applyGameTheme, insertWidget } from '../store/game-commands';
import { store } from '../store/store';
import { showToast } from '../ui/toast';

/** The Widgets tab: game themes, and every ready-made control one click away (in the selected frame, or on the page). */
export function WidgetsPanel() {
  return (
    <div className="kit" data-testid="widgets-panel">
      <p className="row__note">
        Click a widget to place it. They use your tokens, so a theme re-colours them all.
      </p>
      <h3 className="kit__heading">Themes</h3>
      <div className="swatches" data-testid="theme-list">
        {GAME_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="theme"
            data-theme-id={t.id}
            title={t.description}
            onClick={() => {
              const r = applyGameTheme(store, t.id);
              showToast(r.ok ? `Theme: ${t.label}` : r.reason, { kind: r.ok ? 'info' : 'error' });
            }}
          >
            <span className="theme__chips" aria-hidden="true">
              {[t.colors.bg, t.colors.panel, t.colors.primary, t.colors.gold, t.colors.gem].map(
                (c, i) => (
                  <span key={i} style={{ background: c }} />
                ),
              )}
            </span>
            <span className="theme__name">{t.label}</span>
          </button>
        ))}
      </div>
      <h3 className="kit__heading">Widgets</h3>
      <div className="widget-grid" data-testid="widget-list">
        {WIDGET_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className="btn btn--secondary btn--small"
            data-widget={kind}
            title={`Options your AI can set: ${WIDGET_INFO[kind].uses}`}
            onClick={() => {
              const r = insertWidget(store, kind, getCanvasApi()?.viewCenter() ?? null);
              if (!r.ok) showToast(r.reason, { kind: 'error' });
            }}
          >
            {WIDGET_INFO[kind].label}
          </button>
        ))}
      </div>
    </div>
  );
}
