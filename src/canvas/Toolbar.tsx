import {
  ChevronDown,
  Circle,
  Frame,
  Hand,
  Image as ImageIcon,
  MessageSquare,
  MousePointer2,
  Square,
  Type,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { STRINGS } from '../strings';
import { addArtboard } from '../store/commands';
import { store, useAtelier, type ToolId } from '../store/store';
import { getCanvasApi } from './canvas-api';
import { DEVICE_PRESETS } from './presets';

interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  Icon: LucideIcon;
  enabled: boolean;
}

const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: STRINGS.toolbar.select, key: 'V', Icon: MousePointer2, enabled: true },
  { id: 'frame', label: STRINGS.toolbar.frame, key: 'F', Icon: Frame, enabled: true },
  { id: 'rect', label: STRINGS.toolbar.rect, key: 'R', Icon: Square, enabled: true },
  { id: 'ellipse', label: STRINGS.toolbar.ellipse, key: 'O', Icon: Circle, enabled: true },
  { id: 'text', label: STRINGS.toolbar.text, key: 'T', Icon: Type, enabled: true },
  { id: 'image', label: STRINGS.toolbar.image, key: 'I', Icon: ImageIcon, enabled: false },
  {
    id: 'annotate',
    label: STRINGS.toolbar.annotate,
    key: 'A',
    Icon: MessageSquare,
    enabled: false,
  },
  { id: 'hand', label: STRINGS.toolbar.hand, key: 'H', Icon: Hand, enabled: true },
];

/** The floating tool pill at the bottom centre of the canvas (docs/07). */
export function Toolbar() {
  const tool = useAtelier((s) => s.tool);
  const [presetsOpen, setPresetsOpen] = useState(false);

  const addPreset = (preset: (typeof DEVICE_PRESETS)[number]): void => {
    setPresetsOpen(false);
    const center = getCanvasApi()?.viewCenter() ?? { x: 0, y: 0 };
    addArtboard(store, preset, center);
  };

  return (
    <div className="toolbar" role="toolbar" aria-label={STRINGS.toolbar.label} data-ui>
      {TOOLS.map(({ id, label, key, Icon, enabled }) => (
        <span key={id} className="toolbar__group">
          <button
            type="button"
            className="toolbar__btn"
            aria-pressed={tool === id}
            aria-label={label}
            title={`${label} (${key})`}
            disabled={!enabled}
            data-tool={id}
            onClick={() => store.getState().setTool(id)}
          >
            <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {id === 'frame' && (
            <span className="toolbar__presets">
              <button
                type="button"
                className="toolbar__btn toolbar__btn--small"
                aria-label={STRINGS.toolbar.framePresets}
                aria-expanded={presetsOpen}
                title={STRINGS.toolbar.framePresets}
                onClick={() => setPresetsOpen((o) => !o)}
              >
                <ChevronDown size={12} strokeWidth={2} aria-hidden="true" />
              </button>
              {presetsOpen && (
                <div className="menu menu--up" role="menu">
                  {DEVICE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitem"
                      className="menu__item"
                      data-preset={p.id}
                      onClick={() => addPreset(p)}
                    >
                      <span>{p.label}</span>
                      <span className="menu__hint">
                        {p.w} × {p.h}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
