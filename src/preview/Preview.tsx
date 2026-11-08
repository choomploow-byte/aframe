import { docForPreview } from '@core/components';
import { ArrowLeft, Maximize2, RotateCcw, X } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { renderSubtree } from '../canvas/static-render';
import { useAFrame } from '../store/store';
import { showToast } from '../ui/toast';
import { followLink, groupKey, isChoice, linkAt, overlayFor, unitAt } from './interaction';
import { closePreview, goBack, goToFrame, usePreviewUi } from './state';

/**
 * Copies the look of `next` onto the elements already on screen (matched by layer id), so a
 * state change is a style change the browser can animate. Returns false when the two trees do not
 * have the same layers, and the caller replaces the whole thing instead.
 */
function patch(current: HTMLElement, next: HTMLElement): boolean {
  const old = new Map<string, Element>();
  for (const el of [current, ...current.querySelectorAll('[data-node-id]')]) {
    const id = el.getAttribute('data-node-id');
    if (id) old.set(id, el);
  }
  const fresh = [next, ...next.querySelectorAll('[data-node-id]')];
  if (fresh.length !== old.size) return false;
  for (const el of fresh) {
    const id = el.getAttribute('data-node-id');
    if (!id || !old.has(id)) return false;
  }
  for (const el of fresh) {
    const target = old.get(el.getAttribute('data-node-id') as string) as HTMLElement;
    if (target.tagName !== el.tagName) return false;
    target.setAttribute('style', el.getAttribute('style') ?? '');
    if (
      el.children.length === 0 &&
      target.children.length === 0 &&
      target.textContent !== el.textContent
    ) {
      target.textContent = el.textContent;
    }
    if (
      el instanceof HTMLImageElement &&
      target instanceof HTMLImageElement &&
      target.src !== el.src
    ) {
      target.src = el.src;
    }
  }
  return true;
}

/** The frame is placed by the page in the editor; in the preview it just sits at the origin. */
function anchor(el: HTMLElement): void {
  el.style.position = 'relative';
  el.style.left = '0';
  el.style.top = '0';
}

export function Preview() {
  const doc = useAFrame((s) => s.doc);
  const frameId = usePreviewUi((s) => s.frameId);
  const trail = usePreviewUi((s) => s.trail);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [fit, setFit] = useState(true);
  const [scale, setScale] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const frame = frameId === null ? undefined : doc.nodes[frameId];
  const overlay = useMemo(
    () => overlayFor(doc, { hover, pressed, choice, shown }),
    [doc, hover, pressed, choice, shown],
  );
  const shownDoc = useMemo(() => docForPreview(doc, overlay), [doc, overlay]);

  useEffect(() => {
    root.current?.focus();
  }, []);

  // Draw the frame; on a state change only restyle what is there, so changes animate.
  useEffect(() => {
    const el = host.current;
    if (!el || frameId === null) return;
    const next = renderSubtree(shownDoc, frameId);
    if (!next) return;
    anchor(next);
    const current = el.firstElementChild as HTMLElement | null;
    if (current && current.getAttribute('data-node-id') === frameId && patch(current, next)) {
      anchor(current);
    } else {
      el.replaceChildren(next);
    }
    // offsetWidth is the layout size, not the scaled one the wrapper's transform gives.
    const inner = el.firstElementChild as HTMLElement | null;
    if (inner) setSize({ w: inner.offsetWidth, h: inner.offsetHeight });
  }, [shownDoc, frameId]);

  // Scale the frame to the room there is.
  useEffect(() => {
    const el = stage.current;
    if (!el || size.w === 0) return;
    const measure = (): void => {
      const r = el.getBoundingClientRect();
      const s = fit ? Math.min(1, (r.width - 48) / size.w, (r.height - 48) / size.h) : 1;
      setScale(Math.max(0.1, s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, size.w, size.h]);

  // A press ends wherever the pointer is let go.
  useEffect(() => {
    const up = (): void => setPressed(null);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const nodeIdOf = (target: EventTarget | null): string | null =>
    target instanceof Element
      ? (target.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null)
      : null;

  const onOver = (e: ReactPointerEvent): void => {
    const id = nodeIdOf(e.target);
    setHover(id === null ? null : (unitAt(doc, id)?.id ?? null));
  };

  const onDown = (e: ReactPointerEvent): void => {
    const id = nodeIdOf(e.target);
    setPressed(id === null ? null : (unitAt(doc, id)?.id ?? null));
  };

  const onClick = (e: React.MouseEvent): void => {
    const id = nodeIdOf(e.target);
    if (id === null) return;
    const unit = unitAt(doc, id);
    if (unit && isChoice(unit)) setChoice((c) => ({ ...c, [groupKey(doc, unit)]: unit.id }));
    const ref = linkAt(doc, id);
    if (ref === null) return;
    const result = followLink(doc, ref);
    if (result?.kind === 'frame') {
      setShown({});
      goToFrame(result.frameId);
    } else if (result?.kind === 'show') setShown((s) => ({ ...s, ...result.shown }));
    else if (result?.kind === 'missing') {
      showToast(`This link goes to "${result.target}", which is not in the design.`, {
        kind: 'error',
      });
    }
  };

  const reset = (): void => {
    setChoice({});
    setShown({});
    setHover(null);
    setPressed(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === 'Escape') closePreview();
    else if (e.altKey && e.key === 'ArrowLeft') goBack();
  };

  if (!frame) {
    return null;
  }
  return (
    <section
      ref={root}
      className="preview"
      data-testid="preview"
      aria-label="Preview"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="preview__bar">
        <button
          type="button"
          className="icon-btn"
          aria-label="Back to the previous frame"
          title="Back (Alt+Left)"
          data-action="preview-back"
          disabled={trail.length < 2}
          onClick={goBack}
        >
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <h2 data-testid="preview-title">{frame.name}</h2>
        <span className="preview__hint">
          Buttons react to the pointer, tabs and slots select, links (#Name) go to frames or show
          panels.
        </span>
        <span className="preview__spacer" />
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action="preview-reset"
          onClick={reset}
        >
          <RotateCcw size={13} strokeWidth={1.75} aria-hidden="true" /> Reset
        </button>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          aria-pressed={!fit}
          data-action="preview-actual"
          onClick={() => setFit((f) => !f)}
        >
          <Maximize2 size={13} strokeWidth={1.75} aria-hidden="true" />{' '}
          {fit ? 'Actual size' : 'Fit'}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close the preview"
          data-action="preview-close"
          onClick={closePreview}
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </header>
      <div className="preview__stage" ref={stage}>
        <div className="preview__scaler" style={{ width: size.w * scale, height: size.h * scale }}>
          <div
            ref={host}
            className="preview__host"
            data-testid="preview-host"
            style={{ transform: `scale(${scale})`, width: size.w, height: size.h }}
            onPointerOver={onOver}
            onPointerLeave={() => setHover(null)}
            onPointerDown={onDown}
            onClick={onClick}
          />
        </div>
      </div>
    </section>
  );
}
