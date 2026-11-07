import { X } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { annotationUi, useAnnotationUi } from '../annotations/ui-state';
import { useAtelier } from '../store/store';
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
  const doc = useAtelier((s) => s.doc);
  const selection = useAtelier((s) => s.selection);
  const viewport = useAtelier((s) => s.viewport);
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
