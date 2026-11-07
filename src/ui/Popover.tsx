import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  /** The element the popover is attached to. */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** Accessible name for the popover region. */
  label: string;
  /** Minimum width in px (defaults to the anchor's width). */
  minWidth?: number;
  align?: 'start' | 'end';
}

const MARGIN = 8;

/**
 * A floating panel under (or above, if there is no room) its anchor. Closes on Escape and on a
 * click or focus outside. Rendered in a portal so panels with `overflow: auto` cannot clip it.
 */
export function Popover({
  anchor,
  onClose,
  children,
  label,
  minWidth,
  align = 'start',
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.current;
    const p = ref.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const height = p.offsetHeight;
    const width = Math.max(p.offsetWidth, minWidth ?? r.width);
    const below = window.innerHeight - r.bottom - MARGIN;
    const above = r.top - MARGIN;
    const openUp = height > below && above > below;
    const left = align === 'end' ? r.right - width : r.left;
    // Reading and writing in one layout effect, once per open: the popover is not re-measured on scroll.

    setPos({
      left: Math.max(MARGIN, Math.min(left, window.innerWidth - width - MARGIN)),
      top: openUp ? Math.max(MARGIN, r.top - Math.min(height, above) - 4) : r.bottom + 4,
      maxHeight: Math.max(120, openUp ? above : below),
    });
  }, [anchor, align, minWidth]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
      }
    };
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="popover"
      role="dialog"
      aria-label={label}
      data-ui
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        maxHeight: pos?.maxHeight,
        visibility: pos ? 'visible' : 'hidden',
        minWidth,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
