import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { STRINGS } from '../strings';
import { store, useAFrame } from '../store/store';
import { setCanvasApi } from './canvas-api';
import { unionRects, type Rect } from './geometry';
import { AnnotationLayer } from './AnnotationLayer';
import { CompareLayer } from './CompareLayer';
import { Hud } from './Hud';
import { attachInteractions } from './interactions';
import { createMeasurer, type Measurer } from './measure';
import { NodeView } from './NodeView';
import { Overlay } from './Overlay';
import { Welcome } from '../ui/Welcome';
import { openContextMenu } from '../ui/context-menu-state';
import { docFontFamilies, loadFonts } from './fonts';
import { chainTo, pickTarget } from './pick';
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
  const viewport = useAFrame((s) => s.viewport);
  const rootId = useAFrame((s) => s.doc.rootId);
  const empty = useAFrame((s) => (s.doc.nodes[s.doc.rootId]?.children.length ?? 0) === 0);
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

  // Text is measured and screenshotted from the DOM, so the world stays hidden until the fonts the
  // document uses have loaded (or a short timeout passes): no first paint in a fallback face.
  const docId = useAFrame((s) => s.doc.id);
  const [fontsReadyFor, setFontsReadyFor] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      const d = store.getState().doc;
      void loadFonts(docFontFamilies(d)).then(() => {
        if (!cancelled) setFontsReadyFor(d.id);
      });
    };
    load();
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.doc.id !== prev.doc.id) load();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const world = useMemo(
    () => ({
      transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
      visibility: fontsReadyFor === docId ? ('visible' as const) : ('hidden' as const),
    }),
    [viewport, fontsReadyFor, docId],
  );

  const onContextMenu = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest('[data-ui]')) return;
    e.preventDefault();
    const s = store.getState();
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-node-id]')?.dataset.nodeId;
    const picked = hit
      ? pickTarget({
          chain: chainTo(s.doc.nodes, hit),
          selected: s.selection,
          nodes: s.doc.nodes,
          deep: e.ctrlKey || e.metaKey,
        })
      : null;
    if (picked && !s.selection.includes(picked)) s.setSelection([picked]);
    else if (!picked) s.setSelection([]);
    openContextMenu(e.clientX, e.clientY, 'canvas');
  };

  return (
    <main
      className="canvas"
      ref={ref}
      aria-label={STRINGS.canvas.label}
      tabIndex={-1}
      onContextMenu={onContextMenu}
      data-testid="canvas"
      data-cursor="default"
    >
      <div className="world" style={world} data-testid="world">
        <NodeView id={rootId} parentId={null} />
      </div>
      {measurer && <Overlay measurer={measurer} />}
      {measurer && <CompareLayer measurer={measurer} />}
      {measurer && <AnnotationLayer measurer={measurer} />}
      {empty && <Welcome />}
      <Hud />
      <Toolbar />
      <ZoomControl />
    </main>
  );
}
