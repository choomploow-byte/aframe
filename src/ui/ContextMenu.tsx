import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem =
  | { kind: 'separator' }
  | {
      kind?: 'item';
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      run: () => void;
    };

interface ContextMenuProps {
  x: number;
  y: number;
  items: readonly MenuItem[];
  onClose: () => void;
  label?: string;
}

/**
 * A right-click menu at a point: arrow keys move, Enter runs, Escape or an outside click closes.
 * It nudges itself back into the window if it would overflow.
 */
export function ContextMenu({ x, y, items, onClose, label = 'Context menu' }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const actionable = items.filter(
    (i): i is Extract<MenuItem, { id: string }> => i.kind !== 'separator' && !i.disabled,
  );
  const [active, setActive] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - el.offsetHeight - 4)),
    });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const run = (item: Extract<MenuItem, { id: string }>): void => {
    onClose();
    item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % Math.max(1, actionable.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + actionable.length) % Math.max(1, actionable.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = actionable[active];
      if (item) run(item);
    }
  };

  return createPortal(
    <div
      ref={ref}
      className="menu menu--context"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-ui
      style={pos}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.kind === 'separator' ? (
          <div key={`sep${i}`} className="menu__separator" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`menu__item${item.danger ? ' menu__item--danger' : ''}${actionable[active]?.id === item.id ? ' menu__item--active' : ''}`}
            disabled={item.disabled}
            data-menu-id={item.id}
            onMouseEnter={() => {
              const at = actionable.findIndex((a) => a.id === item.id);
              if (at !== -1) setActive(at);
            }}
            onClick={() => run(item)}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="menu__hint">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
