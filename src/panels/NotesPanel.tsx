import { placeAnnotations, removeAnnotation, updateAnnotation } from '@core/annotations';
import type { Annotation } from '@core/types';
import { Check, MessageSquare, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { askAiToAddressNotes, focusAnnotation } from '../annotations/actions';
import { useAnnotationUi, annotationUi, type NotesFilter } from '../annotations/ui-state';
import { store, useAtelier } from '../store/store';
import { Segmented } from '../ui/fields';
import { showToast } from '../ui/toast';

const FILTERS: { value: NotesFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

function change(
  fn: (d: ReturnType<typeof store.getState>['doc']) => ReturnType<typeof store.getState>['doc'],
  label: string,
): void {
  const r = store.getState().edit(fn, label);
  if (!r.ok) showToast(r.error.message, { kind: 'error' });
}

/** The Notes tab: every pin in the project, with its status, who wrote it and the AI's reply. */
export function NotesPanel() {
  const doc = useAtelier((s) => s.doc);
  const filter = useAnnotationUi((s) => s.filter);
  const focusId = useAnnotationUi((s) => s.focusId);
  const numbered = placeAnnotations(doc.annotations, () => null);
  const open = doc.annotations.filter((a) => a.status === 'open').length;
  const shown = numbered.filter((p) => filter === 'all' || p.annotation.status === filter);

  return (
    <div className="notes" data-testid="notes-panel">
      <div className="notes__top">
        <Segmented
          ariaLabel="Show notes"
          field="notes-filter"
          value={filter}
          options={FILTERS.map((f) => ({
            value: f.value,
            label:
              f.value === 'all'
                ? `All ${doc.annotations.length}`
                : `${f.label} ${doc.annotations.filter((a) => a.status === f.value).length}`,
          }))}
          onChange={(v) => annotationUi.getState().setFilter(v)}
        />
        <button
          type="button"
          className="btn btn--primary btn--small notes__ask"
          data-action="ask-ai"
          disabled={open === 0}
          onClick={() => void askAiToAddressNotes()}
        >
          <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" />
          Ask AI to address {open} open {open === 1 ? 'note' : 'notes'}
        </button>
      </div>

      {shown.length === 0 && (
        <div className="notes__empty">
          <MessageSquare size={20} strokeWidth={1.5} aria-hidden="true" />
          <p>
            {doc.annotations.length === 0
              ? 'No notes yet. Press A, then click anything on the canvas to drop a pin and say what should change. Drag to mark a region.'
              : `No ${filter} notes.`}
          </p>
        </div>
      )}

      <ul className="notes__list">
        {shown.map(({ annotation: a, number }) => (
          <NoteRow
            key={a.id}
            a={a}
            number={number}
            focused={focusId === a.id}
            nodeName={doc.nodes[a.nodeId ?? '']?.name}
          />
        ))}
      </ul>
    </div>
  );
}

function NoteRow({
  a,
  number,
  focused,
  nodeName,
}: {
  a: Annotation;
  number: number | null;
  focused: boolean;
  nodeName: string | undefined;
}) {
  const open = a.status === 'open';
  return (
    <li
      className={`nrow${focused ? ' nrow--focused' : ''}${open ? '' : ' nrow--resolved'}`}
      data-testid="note-row"
      data-note-id={a.id}
      data-status={a.status}
    >
      <button
        type="button"
        className="nrow__main"
        title={`Go to ${open ? `note ${number}` : 'this resolved note'}`}
        onClick={() => focusAnnotation(a.id)}
      >
        <span className={`nrow__num${open ? '' : ' nrow__num--resolved'}`}>
          {open ? number : <Check size={12} strokeWidth={3} aria-hidden="true" />}
        </span>
        <span className="nrow__body">
          <span className="nrow__text">{a.text}</span>
          <span className="nrow__meta">
            <span className={`badge badge--${a.author}`}>
              {a.author === 'agent' ? 'AI' : 'You'}
            </span>
            {nodeName !== undefined && <span>on {nodeName}</span>}
            {a.rect && <span>region</span>}
          </span>
        </span>
      </button>
      {a.reply && (
        <p className="nrow__reply" data-testid="note-reply">
          <strong>AI:</strong> {a.reply}
        </p>
      )}
      <div className="nrow__actions">
        <button
          type="button"
          className="icon-btn icon-btn--small"
          data-action={open ? 'resolve-note' : 'reopen-note'}
          aria-label={open ? 'Resolve note' : 'Reopen note'}
          title={open ? 'Resolve' : 'Reopen'}
          onClick={() =>
            change(
              (d) => updateAnnotation(d, a.id, { status: open ? 'resolved' : 'open' }),
              open ? 'Resolve note' : 'Reopen note',
            )
          }
        >
          {open ? (
            <Check size={13} strokeWidth={2} aria-hidden="true" />
          ) : (
            <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--small"
          data-action="delete-note"
          aria-label="Delete note"
          title="Delete"
          onClick={() => change((d) => removeAnnotation(d, a.id), 'Delete note')}
        >
          <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
