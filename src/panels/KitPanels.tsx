import { instancesOf } from '@core/components';
import { Component as ComponentGlyph } from 'lucide-react';
import { getCanvasApi } from '../canvas/canvas-api';
import { insertIcon, insertInstance } from '../store/toolkit-commands';
import { store, useAtelier } from '../store/store';
import { showToast } from '../ui/toast';
import { IconGrid } from './toolkit-sections';

/** The Icons tab: every icon in the set, one click to place it (in the selected frame, or on the page). */
export function IconsPanel() {
  return (
    <div className="kit" data-testid="icons-panel">
      <p className="row__note">
        Click an icon to place it. It takes the colour you give it (a token works), at any size.
      </p>
      <IconGrid
        onPick={(name) => {
          if (!insertIcon(store, name, getCanvasApi()?.viewCenter() ?? null)) {
            showToast('That icon could not be placed.', { kind: 'error' });
          }
        }}
      />
    </div>
  );
}

/** The Components tab: the masters in this project, with one-click instances. */
export function ComponentsPanel() {
  const doc = useAtelier((s) => s.doc);
  const masters = Object.values(doc.nodes)
    .filter((n) => n.component !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="kit" data-testid="components-panel">
      {masters.length === 0 && (
        <p className="panel__empty">
          No components yet. Select a frame and choose Create component in Properties, or ask your
          AI to define one.
        </p>
      )}
      {masters.map((m) => {
        const states = Object.keys(m.component?.states ?? {});
        const count = instancesOf(doc.nodes, m.id).length;
        return (
          <div className="kit__item" key={m.id} data-testid="component-item" data-component={m.id}>
            <ComponentGlyph size={14} strokeWidth={1.75} aria-hidden="true" />
            <button
              type="button"
              className="kit__name"
              title="Select the master"
              onClick={() => store.getState().setSelection([m.id])}
            >
              {m.name}
            </button>
            <span className="kit__meta">
              {m.component?.kind} · {count} used{states.length > 0 ? ` · ${states.join(', ')}` : ''}
            </span>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              data-action="add-instance"
              onClick={() => {
                if (!insertInstance(store, m.id, getCanvasApi()?.viewCenter() ?? null)) {
                  showToast('That component could not be placed.', { kind: 'error' });
                }
              }}
            >
              Add
            </button>
          </div>
        );
      })}
    </div>
  );
}
