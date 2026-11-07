import { nodeToCss } from '@core/style';
import { memo, useCallback, useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import { commitTextEdit } from '../store/text-edit';
import { store, useAtelier } from '../store/store';

interface Props {
  id: string;
  /** The parent's id, so a node re-renders when its parent's layout changes. */
  parentId: string | null;
}

const IMAGE_SRC_RE = /^data:image\/(png|jpeg|gif|webp|svg\+xml);/;

/** While editing, an empty text node still needs somewhere to put the caret. */
function editingStyle(css: Record<string, string>): CSSProperties {
  return { ...css, minWidth: '2px', minHeight: '1em', outline: 'none', cursor: 'text' };
}

function TextBody({ id, text, css }: { id: string; text: string; css: Record<string, string> }) {
  const editing = useAtelier((s) => s.editingTextId === id);

  // Focus and select everything the moment the editable element mounts.
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, []);

  if (!editing) {
    return (
      <div data-node-id={id} data-node-type="text" style={css}>
        {text}
      </div>
    );
  }

  const commit = (el: HTMLElement): void => commitTextEdit(store, id, el.textContent ?? '');
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Keys belong to the editor while it is open: no tool shortcuts, no nudging.
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      commit(e.currentTarget);
    }
  };
  return (
    // A different `key` from the view branch remounts the element, so React never has to
    // reconcile text nodes the browser replaced while the user was typing.
    <div
      key="editing"
      ref={ref}
      data-node-id={id}
      data-node-type="text"
      data-editing="true"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      style={editingStyle(css)}
      onKeyDown={onKeyDown}
      onBlur={(e) => commit(e.currentTarget)}
    >
      {text}
    </div>
  );
}

/**
 * One DOM element per node, styled by `nodeToCss` (the same function the exporters use). Memoised
 * on (id, parentId) and subscribed to its own node, so an edit re-renders only what changed.
 */
export const NodeView = memo(function NodeView({ id, parentId }: Props) {
  const node = useAtelier((s) => s.doc.nodes[id]);
  const parent = useAtelier((s) => (parentId === null ? undefined : s.doc.nodes[parentId]));
  const tokens = useAtelier((s) => s.doc.tokens);
  const assetUrl = useAtelier((s) =>
    node?.type === 'image' && node.assetId !== undefined ? s.doc.assets[node.assetId] : undefined,
  );
  const css = useMemo(() => (node ? nodeToCss(node, parent, tokens) : {}), [node, parent, tokens]);

  if (!node) return null;

  if (node.type === 'text') return <TextBody id={id} text={node.text ?? ''} css={css} />;

  if (node.type === 'image') {
    // Only embedded raster/SVG data URLs are ever shown (docs/18); SVG is safe because <img> never runs scripts.
    const src = assetUrl !== undefined && IMAGE_SRC_RE.test(assetUrl) ? assetUrl : undefined;
    return src ? (
      <img
        data-node-id={id}
        data-node-type="image"
        src={src}
        alt=""
        draggable={false}
        style={css}
      />
    ) : (
      <div
        data-node-id={id}
        data-node-type="image"
        data-placeholder="true"
        style={{
          ...css,
          background:
            'repeating-linear-gradient(45deg, #e8e6dc, #e8e6dc 8px, #f0eee6 8px, #f0eee6 16px)',
        }}
      />
    );
  }

  return (
    <div data-node-id={id} data-node-type={node.type} style={css}>
      {node.children.map((childId) => (
        <NodeView key={childId} id={childId} parentId={id} />
      ))}
    </div>
  );
});
