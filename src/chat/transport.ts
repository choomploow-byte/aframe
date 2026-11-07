import { networkError, noKeyError } from './errors';
import { settingsStore } from './settings';
import { ProviderError, type ProviderId, type Transport } from './types';

/** Desktop transport: the request goes through the Rust `ai_send`, which adds the key. */
export const desktopTransport: Transport = async (provider: ProviderId, body, signal) => {
  const { invoke } = await import('@tauri-apps/api/core');
  const baseUrl = settingsStore.getState().settings.baseUrl;
  // The Rust call cannot be cancelled mid-flight; Stop stops waiting for it and ignores its answer.
  const call = invoke<{ status: number; text: string }>('ai_send', {
    provider,
    baseUrl: provider === 'custom' ? baseUrl : null,
    body,
  });
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new DOMException('aborted', 'AbortError'));
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
      once: true,
    });
  });
  try {
    return await Promise.race([call, aborted]);
  } catch (e) {
    if (e instanceof DOMException) throw e;
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
    if (message === 'NO_KEY') throw noKeyError();
    if (message.startsWith('NETWORK')) throw networkError();
    throw new ProviderError(
      'bad_request',
      message === '' ? 'The request could not be sent.' : message,
    );
  }
};

let override: Transport | null = null;
/** Tests (and the in-browser mock) install a scripted transport. */
export const setTransportForTests = (transport: Transport | null): void => {
  override = transport;
};

const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function currentTransport(): Transport | null {
  return override ?? (isDesktop() ? desktopTransport : null);
}
