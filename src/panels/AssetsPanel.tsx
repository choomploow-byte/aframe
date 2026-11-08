import { addReference, assetUsage, removeAsset, removeReference } from '@core/assets';
import type { Reference } from '@core/types';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { getCanvasApi } from '../canvas/canvas-api';
import { annotationUi } from '../annotations/ui-state';
import { insertAsset } from '../store/panel-commands';
import { store, useAFrame } from '../store/store';
import { Section, Select, TextField, type Option } from '../ui/fields';
import { importFiles } from '../ui/image-import';
import { showToast } from '../ui/toast';

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);/;
const SCOPES: Option<NonNullable<Reference['scope']>>[] = [
  { value: 'style', label: 'Take the style (colour, type, shape)' },
  { value: 'layout', label: 'Take the layout (structure, spacing)' },
  { value: 'everything', label: 'Take everything' },
];
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/**
 * Images in the project: add them (picker, drag-and-drop or paste anywhere), place one on the
 * canvas, or mark one as a reference for the AI to match (the reference tools come in Phase 6).
 */
export function AssetsPanel() {
  const doc = useAFrame((s) => s.doc);
  const input = useRef<HTMLInputElement>(null);
  const ids = Object.keys(doc.assets);

  const insert = (assetId: string): void => {
    const measure = getCanvasApi()?.measure ?? (() => null);
    const at = getCanvasApi()?.viewCenter();
    if (!insertAsset({ store, measure }, assetId, at))
      showToast('That image could not be placed.', { kind: 'error' });
  };
  const edit = (change: (d: typeof doc) => typeof doc, label: string): void => {
    const r = store.getState().edit(change, label);
    if (!r.ok) showToast(`${r.error.message} ${r.error.hint ?? ''}`.trim(), { kind: 'error' });
  };

  const editReference = (id: string, patch: Partial<Reference>): void =>
    edit(
      (d) => ({
        ...d,
        references: d.references.map((r) => {
          if (r.id !== id) return r;
          const next = { ...r, ...patch };
          if (patch.note === undefined && 'note' in patch) delete next.note;
          return next;
        }),
      }),
      'Edit reference',
    );
  const startCompare = (referenceId: string): void => {
    const s = store.getState();
    if ((s.doc.nodes[s.doc.rootId]?.children.length ?? 0) === 0) {
      showToast('Draw a frame first, then compare it with the reference.');
      return;
    }
    annotationUi.getState().setCompare({ referenceId, mode: 'overlay', opacity: 0.5 });
  };

  return (
    <div className="assets" data-testid="assets-panel">
      <div className="assets__add">
        <button
          type="button"
          className="btn btn--secondary btn--small"
          data-action="add-images"
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={14} strokeWidth={1.75} aria-hidden="true" />
          Add images…
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          data-testid="asset-file-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void importFiles(files, { insert: false });
          }}
        />
        <p className="row__note">
          Or drop images anywhere, or paste one. Dropping on the canvas places it there.
        </p>
      </div>

      <Section title={`Images (${ids.length})`}>
        {ids.length === 0 && <p className="panel__empty">No images yet.</p>}
        <div className="assets__grid">
          {ids.map((id) => {
            const url = doc.assets[id] ?? '';
            const use = assetUsage(doc, id);
            const used = use.nodes.length + use.references.length;
            return (
              <div className="asset" key={id} data-asset-id={id}>
                <button
                  type="button"
                  className="asset__thumb"
                  aria-label="Place this image on the canvas"
                  title="Place on the canvas"
                  onClick={() => insert(id)}
                >
                  {DATA_IMAGE.test(url) ? (
                    <img src={url} alt="" draggable={false} />
                  ) : (
                    <span className="asset__broken">?</span>
                  )}
                </button>
                <div className="asset__actions">
                  <span
                    className="asset__used"
                    title={`Used by ${use.nodes.length} layer(s) and ${use.references.length} reference(s)`}
                  >
                    {used === 0 ? 'Unused' : `Used ${used}×`}
                  </span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    data-action="make-reference"
                    disabled={use.references.length > 0}
                    onClick={() => edit((d) => addReference(d, id).doc, 'Add reference')}
                  >
                    {use.references.length > 0 ? 'Reference' : 'Use as reference'}
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--small"
                    aria-label="Delete image"
                    title={used > 0 ? 'Still in use' : 'Delete image'}
                    disabled={used > 0}
                    data-action="delete-asset"
                    onClick={() => edit((d) => removeAsset(d, id), 'Delete image')}
                  >
                    <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`References (${doc.references.length})`}>
        {doc.references.length === 0 && (
          <p className="row__note">
            Mark an image as a reference to tell the AI "make it look like this".
          </p>
        )}
        {doc.references.map((ref, i) => (
          <div className="refcard" key={ref.id} data-reference-id={ref.id}>
            <div className="refcard__head">
              {DATA_IMAGE.test(doc.assets[ref.assetId] ?? '') && (
                <img className="reference__thumb" src={doc.assets[ref.assetId]} alt="" />
              )}
              <div className="refcard__ident">
                <strong>Reference {i + 1}</strong>
                <code className="refcard__id" title="Say this id (or the number) to your AI">
                  {ref.id}
                </code>
              </div>
              <button
                type="button"
                className="icon-btn icon-btn--small"
                aria-label={`Remove reference ${ref.name}`}
                onClick={() => edit((d) => removeReference(d, ref.id), 'Remove reference')}
              >
                <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <TextField
              ariaLabel="Reference name"
              value={ref.name}
              onCommit={(name) => editReference(ref.id, { name: name.trim() || ref.name })}
            />
            <Select
              ariaLabel="What to take from it"
              field="reference-scope"
              value={ref.scope ?? 'style'}
              options={SCOPES}
              onChange={(scope) => editReference(ref.id, { scope })}
            />
            <TextField
              ariaLabel="Note for the AI"
              placeholder="e.g. match spacing and type, not colours"
              value={ref.note ?? ''}
              onCommit={(note) =>
                editReference(
                  ref.id,
                  note.trim() === '' ? { note: undefined } : { note: note.trim() },
                )
              }
            />
            <button
              type="button"
              className="btn btn--secondary btn--small"
              data-action="compare-reference"
              onClick={() => startCompare(ref.id)}
            >
              Compare with the selected frame
            </button>
          </div>
        ))}
      </Section>
    </div>
  );
}
