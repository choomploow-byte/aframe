import { X } from 'lucide-react';
import { useEffect } from 'react';
import { store } from '../store/store';
import { toastStore, useToasts } from './toast';

/** Bottom-left stack of toasts. The region is a polite live region so changes are announced. */
export function Toasts() {
  const toasts = useToasts();
  useEffect(() => {
    let id = store.getState().doc.id;
    return store.subscribe((s) => {
      if (s.doc.id === id) return;
      id = s.doc.id;
      toastStore.getState().clear();
    });
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false" data-ui>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast${t.kind === 'error' ? ' toast--error' : ''}`}
          data-testid="toast"
        >
          <span className="toast__message">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                t.action?.run();
                toastStore.getState().dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="icon-btn icon-btn--small"
            aria-label="Dismiss"
            onClick={() => toastStore.getState().dismiss(t.id)}
          >
            <X size={14} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
