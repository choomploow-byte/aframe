import {
  ChevronRight,
  Circle,
  Component,
  Diamond,
  Eye,
  EyeOff,
  Frame,
  Image as ImageIcon,
  Lock,
  Minus,
  Search,
  Shapes,
  Square,
  Type,
  Unlock,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { NodeType } from '@core/types';
import { deleteSelection } from '../store/commands';
import { renameLayer, toggleLayerFlag } from '../store/panel-commands';
import { store, useAtelier } from '../store/store';
import { STRINGS } from '../strings';
import { openContextMenu } from '../ui/context-menu-state';
import {
  buildRows,
  dropOps,
  isContainer,
  rangeBetween,
  withAncestorsExpanded,
  type DropPosition,
  type LayerRow,
} from './layers-model';

const TYPE_ICON: Record<NodeType, LucideIcon> = {
  page: Frame,
  frame: Frame,
  rect: Square,
  ellipse: Circle,
  line: Minus,
  text: Type,
  image: ImageIcon,
  icon: Shapes,
};

interface DragState {
  ids: string[];
  startY: number;
  active: boolean;
  target: { id: string; position: DropPosition } | null;
}

/** Where in a row the pointer is decides above / inside / below; containers get a middle "inside" zone. */
function positionIn(rowEl: HTMLElement, y: number, container: boolean): DropPosition {
  const r = rowEl.getBoundingClientRect();
  const t = (y - r.top) / Math.max(1, r.height);
  if (container) return t < 0.28 ? 'above' : t > 0.72 ? 'below' : 'inside';
  return t < 0.5 ? 'above' : 'below';
}

export function LayersPanel() {
  const doc = useAtelier((s) => s.doc);
  const selection = useAtelier((s) => s.selection);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(store.getState().doc.nodes[store.getState().doc.rootId]?.children ?? []),
  );
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const anchor = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => buildRows(doc, expanded, filter), [doc, expanded, filter]);

  // Reveal layers selected on the canvas: open their ancestors, scroll them into view.
  useEffect(
    () =>
      store.subscribe((s, prev) => {
        if (s.selection === prev.selection || s.selection.length === 0) return;
        setExpanded((cur) => {
          const next = withAncestorsExpanded(s.doc, s.selection, cur);
          return next.size === cur.size ? cur : next;
        });
        requestAnimationFrame(() =>
          listRef.current
            ?.querySelector(`[data-layer-id="${s.selection[0]}"]`)
            ?.scrollIntoView({ block: 'nearest' }),
        );
      }),
    [],
  );

  const toggleOpen = (id: string, open?: boolean): void =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  const select = (
    id: string,
    e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ): void => {
    const s = store.getState();
    if (e.shiftKey && anchor.current) s.setSelection(rangeBetween(rows, anchor.current, id));
    else if (e.ctrlKey || e.metaKey) {
      s.toggleSelection(id);
      anchor.current = id;
    } else {
      s.setSelection([id]);
      anchor.current = id;
    }
  };

  const focusRow = (id: string): void => {
    requestAnimationFrame(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-layer-id="${id}"]`)?.focus(),
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-layer-id]');
    if (!el || (e.target as HTMLElement).tagName === 'INPUT') return;
    const id = el.dataset.layerId as string;
    const i = rows.findIndex((r) => r.id === id);
    const row = rows[i];
    if (!row) return;
    const go = (delta: number): void => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, i + delta))];
      if (!next) return;
      select(next.id, e);
      focusRow(next.id);
    };
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        go(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        go(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (row.hasChildren && !row.expanded) toggleOpen(id, true);
        else if (row.hasChildren) go(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (row.expanded) toggleOpen(id, false);
        else if (row.parentId !== doc.rootId) {
          select(row.parentId, e);
          focusRow(row.parentId);
        }
        break;
      case 'Home':
        e.preventDefault();
        go(-i);
        break;
      case 'End':
        e.preventDefault();
        go(rows.length - 1 - i);
        break;
      case 'F2':
      case 'Enter':
        e.preventDefault();
        setRenaming(id);
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        if (!selection.includes(id)) store.getState().setSelection([id]);
        deleteSelection(store);
        break;
      case ' ':
        e.preventDefault();
        select(id, e);
        break;
    }
  };

  // --- drag to reorder / reparent (pointer based, so it behaves the same in every webview) ------

  const onRowPointerDown = (e: PointerEvent<HTMLDivElement>, row: LayerRow): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input')) return;
    const inSelection = selection.includes(row.id);
    const ids = (inSelection ? selection : [row.id]).filter((id) => rows.some((r) => r.id === id));
    ids.sort((a, b) => rows.findIndex((r) => r.id === a) - rows.findIndex((r) => r.id === b));
    const state: DragState = { ids, startY: e.clientY, active: false, target: null };
    dragRef.current = state;

    const move = (ev: globalThis.PointerEvent): void => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.active && Math.abs(ev.clientY - d.startY) < 5) return;
      d.active = true;
      const under = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-layer-id]');
      let target: DragState['target'] = null;
      if (under) {
        const id = under.dataset.layerId as string;
        const position = positionIn(under, ev.clientY, isContainer(store.getState().doc, id));
        if (dropOps(store.getState().doc, d.ids, id, position)) target = { id, position };
      }
      d.target = target;
      setDrag({ ...d });
    };
    const finish = (commit: boolean): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key, true);
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d?.active) {
        if (commit) select(row.id, e.nativeEvent);
        return;
      }
      if (commit && d.target) {
        const ops = dropOps(store.getState().doc, d.ids, d.target.id, d.target.position);
        if (ops) {
          store.getState().dispatch(ops, { label: 'Reorder layers' });
          if (d.target.position === 'inside') toggleOpen(d.target.id, true);
        }
      }
    };
    const up = (): void => finish(true);
    const key = (ev: globalThis.KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key, true);
  };

  const target = drag?.active ? drag.target : null;

  if (rows.length === 0 && filter === '') {
    return (
      <div className="layers layers--empty">
        <p className="panel__empty">{STRINGS.panels.layersEmpty}</p>
      </div>
    );
  }

  return (
    <div className="layers">
      <label className="layers__search">
        <Search size={14} strokeWidth={1.75} aria-hidden="true" />
        <input
          type="search"
          aria-label={STRINGS.panels.filterLayers}
          placeholder={STRINGS.panels.filterLayers}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
        />
      </label>
      <div
        ref={listRef}
        className="layers__list"
        role="tree"
        aria-label={STRINGS.panels.layers}
        aria-multiselectable="true"
        onKeyDown={onKeyDown}
      >
        {rows.length === 0 && <p className="panel__empty">{STRINGS.panels.noLayersMatch}</p>}
        {rows.map((row, index) => {
          // A master is a diamond-in-diamond, an instance a hollow diamond; everything else its type.
          const Icon =
            row.component === 'master'
              ? Component
              : row.component === 'instance'
                ? Diamond
                : TYPE_ICON[row.type];
          const selected = selection.includes(row.id);
          const dropClass = target?.id === row.id ? ` layer--drop-${target.position}` : '';
          const draggingClass = drag?.active && drag.ids.includes(row.id) ? ' layer--dragging' : '';
          return (
            <div
              key={row.id}
              role="treeitem"
              aria-level={row.depth + 1}
              aria-selected={selected}
              aria-expanded={row.hasChildren ? row.expanded : undefined}
              aria-label={row.name}
              tabIndex={selected || (selection.length === 0 && index === 0) ? 0 : -1}
              data-layer-id={row.id}
              className={`layer${selected ? ' layer--selected' : ''}${row.visible ? '' : ' layer--hidden'}${dropClass}${draggingClass}`}
              style={{ paddingLeft: 6 + row.depth * 14 }}
              onPointerDown={(e) => onRowPointerDown(e, row)}
              onDoubleClick={(e) => {
                if (!(e.target as HTMLElement).closest('button')) setRenaming(row.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selected) store.getState().setSelection([row.id]);
                openContextMenu(e.clientX, e.clientY, 'layers');
              }}
            >
              <button
                type="button"
                className={`layer__chevron${row.hasChildren ? '' : ' layer__chevron--none'}`}
                tabIndex={-1}
                aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                onClick={() => toggleOpen(row.id)}
              >
                {row.hasChildren && (
                  <ChevronRight
                    size={12}
                    strokeWidth={2}
                    className={row.expanded ? 'layer__chevron-open' : undefined}
                    aria-hidden="true"
                  />
                )}
              </button>
              <Icon size={14} strokeWidth={1.75} className="layer__icon" aria-hidden="true" />
              {renaming === row.id ? (
                <input
                  className="layer__rename"
                  aria-label="Layer name"
                  defaultValue={row.name}
                  autoFocus /* the user just asked to rename: focus moves into the field */
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    renameLayer(store, row.id, e.currentTarget.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                      e.currentTarget.value = row.name;
                      e.currentTarget.blur();
                    }
                  }}
                />
              ) : (
                <span className="layer__name">{row.name}</span>
              )}
              <span className="layer__flags">
                <button
                  type="button"
                  className={`icon-btn icon-btn--small${row.locked ? ' icon-btn--on' : ''}`}
                  tabIndex={-1}
                  aria-label={row.locked ? `Unlock ${row.name}` : `Lock ${row.name}`}
                  aria-pressed={row.locked}
                  data-flag="locked"
                  onClick={() => toggleLayerFlag(store, row.id, 'locked')}
                >
                  {row.locked ? (
                    <Lock size={13} strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <Unlock size={13} strokeWidth={1.75} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  className={`icon-btn icon-btn--small${row.visible ? '' : ' icon-btn--on'}`}
                  tabIndex={-1}
                  aria-label={row.visible ? `Hide ${row.name}` : `Show ${row.name}`}
                  aria-pressed={!row.visible}
                  data-flag="visible"
                  onClick={() => toggleLayerFlag(store, row.id, 'visible')}
                >
                  {row.visible ? (
                    <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
                  ) : (
                    <EyeOff size={13} strokeWidth={1.75} aria-hidden="true" />
                  )}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
