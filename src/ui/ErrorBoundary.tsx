import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import { buildDiagnostics, recordError } from './diagnostics';

interface State {
  error: Error | null;
  copied: boolean;
}

/**
 * If a screen throws, show a calm page instead of a blank window: the work is already saved (edits are
 * written as they happen), and a button copies diagnostics to paste into a bug report.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    recordError(error);
    recordError(`Component stack:${info.componentStack ?? ''}`.slice(0, 600));
  }

  private copy = (): void => {
    void navigator.clipboard
      .writeText(buildDiagnostics(this.state.error ?? undefined))
      .then(() => this.setState({ copied: true }))
      .catch(() => this.setState({ copied: false }));
  };

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="crash" role="alert" data-testid="crash">
        <h1>Something went wrong</h1>
        <p>
          Atelier hit a problem it could not recover from. Your design is saved: edits are written
          as you make them, and reopening the app brings it back.
        </p>
        <div className="crash__actions">
          <button
            type="button"
            className="btn btn--primary"
            data-action="crash-reload"
            onClick={() => window.location.reload()}
          >
            Reload Atelier
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            data-action="crash-copy"
            onClick={this.copy}
          >
            {this.state.copied ? 'Copied: paste it into your bug report' : 'Copy diagnostics'}
          </button>
        </div>
        <p className="dialog__muted">
          Diagnostics hold the version, your system and the error: never your design, notes or keys.
        </p>
      </div>
    );
  }
}

let crashRequested = false;
const crashListeners = new Set<() => void>();

/** Makes the next render throw (tests, through the dev tools only) so the recovery page can be seen. */
export function requestTestCrash(): void {
  crashRequested = true;
  for (const l of crashListeners) l();
}

/** Throws when `requestTestCrash` was called; renders nothing otherwise. */
export function CrashProbe(): ReactNode {
  useSyncExternalStore(
    (cb) => {
      crashListeners.add(cb);
      return () => crashListeners.delete(cb);
    },
    () => crashRequested,
  );
  if (crashRequested) throw new Error('Test crash');
  return null;
}
