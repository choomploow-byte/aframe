import {
  addAnnotation,
  placeAnnotations,
  removeAnnotation,
  updateAnnotation,
  type PlacedAnnotation,
} from '@core/annotations';
import { Check, RotateCcw, Trash2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { annotationUi, useAnnotationUi } from '../annotations/ui-state';
import { store, useAtelier } from '../store/store';
import { showToast } from '../ui/toast';
import type { Measurer } from './measure';
import { worldToScreen } from './viewport';

/**
 * Notes drawn above the design, in screen space so a pin keeps its size at any zoom (docs/07).
 * Positions come from the real node rectangles (`placeAnnotations`), so a pin follows the node it
 * was dropped on when that moves, resizes or reflows. It is a separate layer: never part of the
 * design, never exported, and only drawn into a screenshot when the agent asks for it.
 */
export function AnnotationLayer({ measurer }: { measurer: Measurer }) {
  const doc = useAtelier((s) => s.doc);
  const viewport = useAtelier((s) => s.viewport);
  const tool = useAtelier((s) => s.tool);
  const composer = useAnnotationUi((s) => s.composer);
  const focusId = useAnnotationUi((s) => s.focusId);
  const [placed, setPlaced] = useState<PlacedAnnotation[]>([]);

  // Positions depend on the DOM React just committed, so they are read after it, before paint.
  useLayoutEffect(() => {
    const next = placeAnnotations(doc.annotations, (id) => measurer.worldRect(id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaced(next);
  }, [doc, viewport, measurer]);

  const zoom = viewport.zoom;
  const screen = (x: number, y: number) => worldToScreen(viewport, { x, y });
  const focused = placed.find((p) => p.annotation.id === focusId);

  return (
    <div className="annotations" data-testid="annotation-layer">
      {placed.map((p) => {
        const a = p.annotation;
        const at = screen(p.x, p.y);
        const open = a.status === 'open';
        return (
          <div key={a.id}>
            {p.rect && (
              <div
                className={`note-region${open ? '' : ' note-region--resolved'}`}
                style={{
                  left: at.x,
                  top: at.y,
                  width: p.rect.w * zoom,
                  height: p.rect.h * zoom,
                }}
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              data-ui
              data-annotation-id={a.id}
              data-status={a.status}
              className={`pin${open ? '' : ' pin--resolved'}${focusId === a.id ? ' pin--focused' : ''}${tool === 'annotate' ? ' pin--tool' : ''}`}
              style={{ left: at.x, top: at.y }}
              aria-label={`${open ? `Note ${p.number}` : 'Resolved note'}: ${a.text}`}
              onClick={(e) => {
                e.stopPropagation();
                annotationUi.getState().focus(focusId === a.id ? null : a.id);
              }}
            >
              {open ? p.number : <Check size={12} strokeWidth={3} aria-hidden="true" />}
            </button>
          </div>
        );
      })}

      {focused && <NoteCard placed={focused} at={screen(focused.x, focused.y)} />}
      {composer && (
        <Composer
          at={screen(composer.world.x, composer.world.y)}
          size={composer.rect ? { w: composer.rect.w * zoom, h: composer.rect.h * zoom } : null}
        />
      )}
    </div>
  );
}

type DocChange = Parameters<ReturnType<typeof store.getState>['edit']>[0];

/** One undoable document change from the note UI; a refusal is shown, never thrown. */
function apply(change: DocChange, label: string): void {
  const r = store.getState().edit(change, label);
  if (!r.ok) showToast(r.error.message, { kind: 'error' });
}

function NoteCard({ placed, at }: { placed: PlacedAnnotation; at: { x: number; y: number } }) {
  const a = placed.annotation;
  return (
    <div
      className="note-card"
      data-ui
      data-testid="note-card"
      role="dialog"
      aria-label={`Note ${placed.number ?? ''}`}
      style={{ left: at.x + 18, top: at.y - 8 }}
    >
      <div className="note-card__head">
        <span className={`badge badge--${a.author}`}>{a.author === 'agent' ? 'AI' : 'You'}</span>
        <span className="note-card__status">{a.status === 'open' ? 'Open' : 'Resolved'}</span>
        <button
          type="button"
          className="icon-btn icon-btn--small"
          aria-label="Close"
          onClick={() => annotationUi.getState().focus(null)}
        >
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <p className="note-card__text">{a.text}</p>
      {a.reply && (
        <p className="note-card__reply" data-testid="note-reply">
          <strong>AI:</strong> {a.reply}
        </p>
      )}
      <div className="note-card__actions">
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action={a.status === 'open' ? 'resolve-note' : 'reopen-note'}
          onClick={() =>
            apply(
              (d) =>
                updateAnnotation(d, a.id, { status: a.status === 'open' ? 'resolved' : 'open' }),
              a.status === 'open' ? 'Resolve note' : 'Reopen note',
            )
          }
        >
          {a.status === 'open' ? (
            <>
              <Check size={13} strokeWidth={2} aria-hidden="true" /> Resolve
            </>
          ) : (
            <>
              <RotateCcw size={13} strokeWidth={2} aria-hidden="true" /> Reopen
            </>
          )}
        </button>
        <button
          type="button"
          className="btn btn--small btn--ghost"
          data-action="delete-note"
          onClick={() => {
            annotationUi.getState().focus(null);
            apply((d) => removeAnnotation(d, a.id), 'Delete note');
          }}
        >
          <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" /> Delete
        </button>
      </div>
    </div>
  );
}

function Composer({
  at,
  size,
}: {
  at: { x: number; y: number };
  size: { w: number; h: number } | null;
}) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => field.current?.focus(), []);

  const cancel = (): void => annotationUi.getState().closeComposer();
  const save = (): void => {
    const c = annotationUi.getState().composer;
    if (!c || text.trim() === '') return;
    const r = store.getState().edit(
      (d) =>
        addAnnotation(d, {
          text,
          author: 'user',
          x: c.world.x,
          y: c.world.y,
          ...(c.rect ? { rect: { x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h } } : {}),
          ...(c.nodeId !== undefined && c.offset !== undefined
            ? { nodeId: c.nodeId, offset: c.offset }
            : {}),
        }).doc,
      'Add note',
    );
    if (!r.ok) {
      showToast(r.error.message, { kind: 'error' });
      return;
    }
    cancel();
  };

  return (
    <>
      {size && (
        <div
          className="note-region note-region--draft"
          style={{ left: at.x, top: at.y, width: size.w, height: size.h }}
          aria-hidden="true"
        />
      )}
      <div
        className="composer"
        data-ui
        data-testid="note-composer"
        role="dialog"
        aria-label="New note"
        style={{ left: at.x + 18, top: at.y - 8 }}
      >
        <textarea
          ref={field}
          aria-label="Note"
          placeholder="What should change here?"
          rows={3}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // keys belong to the note while it is open: no tool shortcuts
            if (e.key === 'Escape') cancel();
            else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              save();
            }
          }}
        />
        <div className="composer__row">
          <span className="composer__hint">Enter to save · Shift+Enter for a new line</span>
          <button type="button" className="btn btn--small btn--ghost" onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--small btn--primary"
            data-action="save-note"
            disabled={text.trim() === ''}
            onClick={save}
          >
            Save
          </button>
        </div>
      </div>
    </>
  );
}
