import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { STRINGS } from '../strings';
import { store, useAtelier } from '../store/store';
import { setCanvasApi } from './canvas-api';
import { unionRects, type Rect } from './geometry';
import { Hud } from './Hud';
import { attachInteractions } from './interactions';
import { createMeasurer, type Measurer } from './measure';
import { NodeView } from './NodeView';
import { Overlay } from './Overlay';
import { Toolbar } from './Toolbar';
import { useShortcuts } from './useShortcuts';
import { fitRect, nextZoomStep, screenToWorld, zoomAt } from './viewport';
import { ZoomControl } from './ZoomControl';

/**
 * The canvas: a viewport element holding the world (the DOM renderer under one CSS transform), the
 * screen-space overlay, and the floating chrome. Pan and zoom only ever change that transform, so
 * nodes are never re-laid-out by the camera (docs/19).
 */
export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const viewport = useAtelier((s) => s.viewport);
  const rootId = useAtelier((s) => s.doc.rootId);
  const empty = useAtelier((s) => (s.doc.nodes[s.doc.rootId]?.children.length ?? 0) === 0);
  const [measurer, setMeasurer] = useState<Measurer | null>(null);
  const fitted = useRef(false);
  useShortcuts();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const m = createMeasurer(
      el,
      () => store.getState().viewport,
      () => store.getState().doc.rootId,
    );
    const { detach, cancelGesture } = attachInteractions({ container: el, store, measurer: m });

    const worldRects = (ids: readonly string[]): Rect[] =>
      ids.flatMap((id) => {
        const r = m.worldRect(id);
        return r ? [r] : [];
      });
    const fitTo = (rect: Rect | null): void => {
      const s = store.getState();
      if (!rect) {
        s.setViewport({ x: 0, y: 0, zoom: 1 });
        return;
      }
      s.setViewport(fitRect(rect, m.size()));
    };
    const center = () => {
      const { w, h } = m.size();
      return { x: w / 2, y: h / 2 };
    };

    setCanvasApi({
      measure: (id) => m.worldRect(id),
      viewSize: () => m.size(),
      fitAll: () => {
        const s = store.getState();
        fitTo(unionRects(worldRects(s.doc.nodes[s.doc.rootId]?.children ?? [])));
      },
      fitSelection: () => fitTo(unionRects(worldRects(store.getState().selection))),
      zoomTo: (zoom) => {
        const s = store.getState();
        s.setViewport(zoomAt(s.viewport, zoom, center()));
      },
      zoomStep: (dir) => {
        const s = store.getState();
        s.setViewport(zoomAt(s.viewport, nextZoomStep(s.viewport.zoom, dir), center()));
      },
      viewCenter: () => screenToWorld(store.getState().viewport, center()),
      cancelGesture,
    });
    setMeasurer(m);
    return () => {
      detach();
      setCanvasApi(null);
    };
  }, []);

  // Show everything once, the first time there is something to show.
  useEffect(() => {
    if (!measurer || fitted.current || empty) return;
    fitted.current = true;
    const s = store.getState();
    const rects = (s.doc.nodes[s.doc.rootId]?.children ?? []).flatMap((id) => {
      const r = measurer.worldRect(id);
      return r ? [r] : [];
    });
    const all = unionRects(rects);
    if (all) s.setViewport(fitRect(all, measurer.size()));
  }, [measurer, empty]);

  const world = useMemo(
    () => ({
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
    }),
    [viewport],
  );

  return (
    <main
      className="canvas"
      ref={ref}
      aria-label={STRINGS.canvas.label}
      data-testid="canvas"
      data-cursor="default"
    >
      <div className="world" style={world} data-testid="world">
        <NodeView id={rootId} parentId={null} />
      </div>
      {measurer && <Overlay measurer={measurer} />}
      {empty && (
        <div className="canvas__empty" aria-live="polite">
          <h1 className="canvas__headline">{STRINGS.canvas.emptyTitle}</h1>
          <p>{STRINGS.canvas.emptyHint}</p>
        </div>
      )}
      <Hud />
      <Toolbar />
      <ZoomControl />
    </main>
  );
}
