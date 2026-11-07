import { settingsStore } from './settings';
import type { ProviderId } from './types';

/**
 * Where API keys are kept: the operating system's credential store, through the desktop app. The
 * page can store, check for and remove a key, but never read one back. A browser build has no such
 * store and refuses to keep keys (it never falls back to storing them in the page).
 */
export interface KeyStore {
  readonly available: boolean;
  has(provider: ProviderId): Promise<boolean>;
  set(provider: ProviderId, key: string): Promise<void>;
  clear(provider: ProviderId): Promise<void>;
}

const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const messageOf = (e: unknown): string =>
  typeof e === 'string' ? e : e instanceof Error ? e.message : 'The key could not be saved.';

const desktopKeys: KeyStore = {
  available: true,
  has: async (provider) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('ai_key_status', { provider });
  },
  set: async (provider, key) => {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('ai_key_set', { provider, key });
    } catch (e) {
      throw new Error(messageOf(e), { cause: e });
    }
  },
  clear: async (provider) => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ai_key_clear', { provider });
  },
};

const browserKeys: KeyStore = {
  available: false,
  has: () => Promise.resolve(false),
  set: () =>
    Promise.reject(
      new Error('API keys can only be stored by the desktop app, in your system keychain.'),
    ),
  clear: () => Promise.resolve(),
};

let override: KeyStore | null = null;
/** Tests install an in-memory store. */
export const setKeyStoreForTests = (store: KeyStore | null): void => {
  override = store;
};

export const keyStore = (): KeyStore => override ?? (isDesktop() ? desktopKeys : browserKeys);

/** Refreshes which providers have a key. */
export async function refreshKeys(): Promise<void> {
  const store = keyStore();
  for (const id of ['anthropic', 'openai', 'custom'] as const) {
    settingsStore.getState().setKey(id, await store.has(id).catch(() => false));
  }
}
