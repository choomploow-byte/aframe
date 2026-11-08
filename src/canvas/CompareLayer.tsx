import { Ruler, X } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { annotationUi, useAnnotationUi } from '../annotations/ui-state';
import { store, useAFrame } from '../store/store';
import { showToast } from '../ui/toast';
import { Segmented } from '../ui/fields';
import type { Rect } from './geometry';
import type { Measurer } from './measure';

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);/;

/**
 * Compare mode (docs/07): a reference image shown against the selected frame, either laid over it
 * with an opacity slider (for pixel-matching a layout) or beside it at the same height. Drawn in
 * screen space above the design; nothing is added to the document.
 */
export function CompareLayer({ measurer }: { measurer: Measurer }) {
  const compare = useAnnotationUi((s) => s.compare);
  const doc = useAFrame((s) => s.doc);
  const selection = useAFrame((s) => s.selection);
  const viewport = useAFrame((s) => s.viewport);
  const [target, setTarget] = useState<Rect | null>(null);

  const reference = compare ? doc.references.find((r) => r.id === compare.referenceId) : undefined;
  const url = reference ? doc.assets[reference.assetId] : undefined;
  // The selected node if it is drawn, else the first frame on the page.
  const targetId =
    selection.find((id) => doc.nodes[id] && id !== doc.rootId) ??
    doc.nodes[doc.rootId]?.children[0];

  useLayoutEffect(() => {
    const next = compare && targetId ? measurer.screenRect(targetId) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTarget(next);
  }, [compare, targetId, doc, viewport, measurer]);

  if (!compare) return null;
  const ok = reference !== undefined && url !== undefined && DATA_IMAGE.test(url);
  const index = reference ? doc.references.indexOf(reference) + 1 : 0;

  return (
    <>
      {ok && target && compare.mode === 'overlay' && (
        <img
          className="compare__overlay"
          data-testid="compare-overlay"
          src={url}
          alt=""
          draggable={false}
          style={{
            left: target.x,
            top: target.y,
            width: target.w,
            opacity: compare.opacity,
          }}
        />
      )}
      {ok && target && compare.mode === 'difference' && (
        <img
          className="compare__overlay compare__overlay--difference"
          data-testid="compare-difference"
          src={url}
          alt=""
          draggable={false}
          style={{ left: target.x, top: target.y, width: target.w, height: target.h }}
        />
      )}
      {ok && target && compare.mode === 'side' && (
        <figure
          className="compare__side"
          data-testid="compare-side"
          style={{ left: target.x + target.w + 16, top: target.y, height: target.h }}
        >
          <img src={url} alt="" draggable={false} style={{ height: '100%' }} />
          <figcaption>
            Reference {index}: {reference?.name}
          </figcaption>
        </figure>
      )}
      <div
        className="compare__bar"
        data-ui
        data-testid="compare-bar"
        role="group"
        aria-label="Compare"
      >
        <span className="compare__title">
          {ok ? `Reference ${index}: ${reference?.name}` : 'Reference not found'}
        </span>
        <Segmented
          ariaLabel="Compare mode"
          field="compare-mode"
          value={compare.mode}
          options={[
            { value: 'overlay', label: 'Overlay' },
            { value: 'difference', label: 'Difference' },
            { value: 'side', label: 'Side by side' },
          ]}
          onChange={(mode) => annotationUi.getState().setCompare({ ...compare, mode })}
        />
        {compare.mode === 'overlay' && (
          <label className="compare__opacity">
            Opacity
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(compare.opacity * 100)}
              aria-label="Reference opacity"
              data-field="compare-opacity"
              onChange={(e) =>
                annotationUi
                  .getState()
                  .setCompare({ ...compare, opacity: Number(e.target.value) / 100 })
              }
            />
          </label>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--small"
          data-action="measure-compare"
          disabled={!ok}
          title="Measure how much of the frame matches the reference"
          onClick={() => {
            const s = store.getState();
            const id = s.selection.find((n) => s.doc.nodes[n] && n !== s.doc.rootId);
            void import('./compare-reference')
              .then(({ compareWithReference }) =>
                compareWithReference(s.doc, s.viewport.zoom, {
                  ...(id === undefined ? {} : { nodeId: id }),
                  referenceId: compare.referenceId,
                }),
              )
              .then((r) => {
                const worst = r.worstRegions[0];
                showToast(
                  `${r.matchPercent}% of the frame matches${worst ? `; the biggest difference is ${worst.where} (${worst.mismatchPercent}% off)` : ''}${r.aspectDiffers ? '. The reference has different proportions, so match the frame size first.' : '.'}`,
                );
              })
              .catch((e: unknown) =>
                showToast(e instanceof Error ? e.message : 'That could not be measured.', {
                  kind: 'error',
                }),
              );
          }}
        >
          <Ruler size={13} strokeWidth={1.75} aria-hidden="true" /> Measure
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--small"
          aria-label="Stop comparing"
          data-action="stop-compare"
          onClick={() => annotationUi.getState().setCompare(null)}
        >
          <X size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
