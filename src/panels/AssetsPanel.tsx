import { addReference, assetUsage, removeAsset, removeReference } from '@core/assets';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { getCanvasApi } from '../canvas/canvas-api';
import { insertAsset } from '../store/panel-commands';
import { store, useAtelier } from '../store/store';
import { Section, TextField } from '../ui/fields';
import { importFiles } from '../ui/image-import';
import { showToast } from '../ui/toast';

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);/;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/**
 * Images in the project: add them (picker, drag-and-drop or paste anywhere), place one on the
 * canvas, or mark one as a reference for the AI to match (the reference tools come in Phase 6).
 */
export function AssetsPanel() {
  const doc = useAtelier((s) => s.doc);
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
        {doc.references.map((ref) => (
          <div className="reference" key={ref.id} data-reference-id={ref.id}>
            {DATA_IMAGE.test(doc.assets[ref.assetId] ?? '') && (
              <img className="reference__thumb" src={doc.assets[ref.assetId]} alt="" />
            )}
            <TextField
              ariaLabel="Reference name"
              value={ref.name}
              onCommit={(name) =>
                edit(
                  (d) => ({
                    ...d,
                    references: d.references.map((r) =>
                      r.id === ref.id ? { ...r, name: name.trim() || r.name } : r,
                    ),
                  }),
                  'Rename reference',
                )
              }
            />
            <button
              type="button"
              className="icon-btn icon-btn--small"
              aria-label={`Remove reference ${ref.name}`}
              onClick={() => edit((d) => removeReference(d, ref.id), 'Remove reference')}
            >
              <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        ))}
      </Section>
    </div>
  );
}
