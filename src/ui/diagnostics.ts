import { store } from '../store/store';

/**
 * What a person can paste into a bug report. Deliberately small and free of anything private: no design
 * content, no layer or note text, no file paths, no keys. Errors recorded here are only their message
 * and the top of their stack.
 */
const MAX_ERRORS = 20;
const recent: { at: string; message: string }[] = [];

export function recordError(error: unknown): void {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${(error.stack ?? '').split('\n').slice(1, 4).join('\n')}`
      : String(error);
  recent.push({ at: new Date().toISOString(), message: text.slice(0, 800) });
  if (recent.length > MAX_ERRORS) recent.shift();
}

export function buildDiagnostics(extra?: unknown): string {
  const s = store.getState();
  const lines = [
    `AFrame ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'}`,
    `Time: ${new Date().toISOString()}`,
    `Platform: ${typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent}`,
    `Desktop app: ${typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? 'yes' : 'no'}`,
    `Design: ${Object.keys(s.doc.nodes).length} layers, ${Object.keys(s.doc.assets).length} pictures, revision ${s.doc.rev}`,
    `Window: ${typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}`}`,
  ];
  if (extra !== undefined) {
    lines.push(
      '',
      'Error:',
      extra instanceof Error
        ? `${extra.name}: ${extra.message}\n${extra.stack ?? ''}`
        : typeof extra === 'string'
          ? extra
          : 'An error that is not an Error object',
    );
  }
  if (recent.length > 0) {
    lines.push('', 'Recent errors:', ...recent.map((r) => `[${r.at}] ${r.message}`));
  }
  return lines.join('\n');
}

/** Records errors nobody caught, so they appear in diagnostics. */
export function installErrorRecording(): void {
  window.addEventListener('error', (e) => recordError(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => recordError(e.reason));
}
