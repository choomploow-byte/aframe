import { isEffectivelyLocked } from '@core/tree';
import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { useAFrame } from '../store/store';
import { equalRects, unionRects, type Rect } from './geometry';
import { HANDLES, type Handle } from './interactions';
import type { Measurer } from './measure';

interface Measured {
  selected: { id: string; rect: Rect; locked: boolean }[];
  hover: Rect | null;
  artboards: { id: string; name: string; rect: Rect }[];
}

const EMPTY: Measured = { selected: [], hover: null, artboards: [] };

function sameMeasured(a: Measured, b: Measured): boolean {
  if (a.selected.length !== b.selected.length || a.artboards.length !== b.artboards.length)
    return false;
  if (!equalRects(a.hover ?? undefined, b.hover ?? undefined)) return false;
  return (
    a.selected.every(
      (s, i) =>
        s.id === b.selected[i]?.id &&
        s.locked === b.selected[i]?.locked &&
        equalRects(s.rect, b.selected[i]?.rect),
    ) &&
    a.artboards.every(
      (s, i) =>
        s.id === b.artboards[i]?.id &&
        s.name === b.artboards[i]?.name &&
        equalRects(s.rect, b.artboards[i]?.rect),
    )
  );
}

const box = (r: Rect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

const HANDLE_POS: Record<Handle, { left: string; top: string; cursor: string }> = {
  nw: { left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', cursor: 'ew-resize' },
};

/**
 * Screen-space layer drawn above the world: selection, handles, hover, marquee, guides and the
 * draw preview. Everything is positioned from rects measured on the real DOM after React has
 * committed (layout effect), so handles are exact at every zoom and inside auto-layout. Reads
 * happen together, then one state update: no layout thrash.
 */
export function Overlay({ measurer }: { measurer: Measurer }) {
  const doc = useAFrame((s) => s.doc);
  const selection = useAFrame((s) => s.selection);
  const hover = useAFrame((s) => s.hover);
  const viewport = useAFrame((s) => s.viewport);
  const transient = useAFrame((s) => s.transient);
  const editing = useAFrame((s) => s.editingTextId);
  const [measured, setMeasured] = useState<Measured>(EMPTY);
  // Bumped when something resizes without the store changing (a web font finishing loading).
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const next: Measured = {
      selected: selection.flatMap((id) => {
        const rect = measurer.screenRect(id);
        return rect ? [{ id, rect, locked: isEffectivelyLocked(doc.nodes, id) }] : [];
      }),
      hover: hover && !selection.includes(hover) ? measurer.screenRect(hover) : null,
      artboards: (doc.nodes[doc.rootId]?.children ?? []).flatMap((id) => {
        const n = doc.nodes[id];
        const rect = n && n.visible ? measurer.screenRect(id) : null;
        return n && rect ? [{ id, name: n.name, rect }] : [];
      }),
    };
    // Measuring needs the DOM React just committed, so this cannot be derived during render. The
    // update re-renders synchronously, before paint, and bails out when nothing moved.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMeasured((prev) => (sameMeasured(prev, next) ? prev : next));
  }, [doc, selection, hover, viewport, editing, measurer, tick]);

  useEffect(() => {
    const observer = new ResizeObserver(() => setTick((t) => t + 1));
    for (const id of selection) {
      const el = measurer.element(id);
      if (el) observer.observe(el);
    }
    void document.fonts.ready.then(() => setTick((t) => t + 1));
    return () => observer.disconnect();
  }, [selection, measurer]);

  const zoom = viewport.zoom;
  const single = measured.selected.length === 1 ? measured.selected[0] : undefined;
  const group =
    measured.selected.length > 1 ? unionRects(measured.selected.map((s) => s.rect)) : null;
  const showHandles = single && !single.locked && editing === null && transient.ghost === null;
  const toScreen = (axis: 'x' | 'y', at: number): number =>
    at * zoom + (axis === 'x' ? viewport.x : viewport.y);

  return (
    <div className="overlay" aria-hidden="true">
      {measured.artboards.map((a) => (
        <div
          key={a.id}
          className={`artboard-label${selection.includes(a.id) ? ' artboard-label--selected' : ''}`}
          data-artboard-label={a.id}
          style={{ left: a.rect.x, top: a.rect.y - 22, maxWidth: Math.max(60, a.rect.w) }}
        >
          {a.name}
        </div>
      ))}

      {measured.hover && <div className="ov-hover" style={box(measured.hover)} />}

      {measured.selected.map((s) => (
        <div
          key={s.id}
          className={`ov-selected${single ? ' ov-selected--single' : ''}`}
          style={box(s.rect)}
          data-testid="selection-box"
          data-selection-id={s.id}
        />
      ))}
      {group && <div className="ov-group" style={box(group)} />}

      {single && editing === null && (
        <div
          className="ov-size"
          style={{
            left: single.rect.x + single.rect.w / 2,
            top: single.rect.y + single.rect.h + 8,
          }}
        >
          {Math.round(single.rect.w / zoom)} × {Math.round(single.rect.h / zoom)}
        </div>
      )}

      {showHandles && (
        <div className="ov-handles" style={box(single.rect)}>
          {HANDLES.map((h) => (
            <div key={h} className="ov-handle" data-handle={h} style={{ ...HANDLE_POS[h] }} />
          ))}
        </div>
      )}

      {transient.guides.map((g, i) =>
        g.kind === 'gap' ? (
          <div
            key={i}
            className={`ov-gap ov-gap--${g.axis === 'y' ? 'h' : 'v'}`}
            data-gap={g.label}
            style={
              g.axis === 'y'
                ? {
                    left: toScreen('x', g.from),
                    top: toScreen('y', g.at),
                    width: (g.to - g.from) * zoom,
                  }
                : {
                    left: toScreen('x', g.at),
                    top: toScreen('y', g.from),
                    height: (g.to - g.from) * zoom,
                  }
            }
          >
            <span className="ov-gap__label">{g.label}</span>
          </div>
        ) : g.axis === 'x' ? (
          <div
            key={i}
            className="ov-guide"
            style={{
              left: toScreen('x', g.at),
              top: toScreen('y', g.from),
              width: 1,
              height: (g.to - g.from) * zoom,
            }}
          />
        ) : (
          <div
            key={i}
            className="ov-guide"
            style={{
              left: toScreen('x', g.from),
              top: toScreen('y', g.at),
              width: (g.to - g.from) * zoom,
              height: 1,
            }}
          />
        ),
      )}

      {transient.marquee && <div className="ov-marquee" style={box(transient.marquee)} />}
      {transient.draw && (
        <>
          <div className="ov-draw" style={box(transient.draw.rect)} />
          <div
            className="ov-size"
            style={{
              left: transient.draw.rect.x + transient.draw.rect.w / 2,
              top: transient.draw.rect.y + transient.draw.rect.h + 8,
            }}
          >
            {transient.draw.label}
          </div>
        </>
      )}
      {transient.ghost && <div className="ov-ghost" style={box(transient.ghost)} />}
      {transient.insertion && (
        <div className="ov-insertion" style={box(transient.insertion)} data-testid="insertion" />
      )}
    </div>
  );
}
