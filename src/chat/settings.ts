import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { PROVIDERS } from './providers';
import type { ProviderId } from './types';

/**
 * Chat settings. Nothing secret lives here (keys are in the operating system's credential store, see
 * src-tauri/src/ai.rs); this is stored in the browser's local storage, and the app works without it.
 */
export interface ChatSettings {
  provider: ProviderId;
  models: Record<ProviderId, string>;
  /** Base URL for a custom OpenAI-compatible server. */
  baseUrl: string;
  maxSteps: number;
  sendScreenshots: boolean;
  /** The privacy notice has been seen. */
  acknowledged: boolean;
}

const KEY = 'aframe.chat.settings.v1';

const DEFAULTS: ChatSettings = {
  provider: 'anthropic',
  models: {
    anthropic: PROVIDERS.find((p) => p.id === 'anthropic')?.defaultModel ?? '',
    openai: '',
    custom: '',
  },
  baseUrl: '',
  maxSteps: 25,
  sendScreenshots: true,
  acknowledged: false,
};

function load(): ChatSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ChatSettings>;
    const provider: ProviderId =
      parsed.provider === 'openai' || parsed.provider === 'custom' ? parsed.provider : 'anthropic';
    return {
      provider,
      models: { ...DEFAULTS.models, ...(typeof parsed.models === 'object' ? parsed.models : {}) },
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.slice(0, 300) : '',
      maxSteps:
        typeof parsed.maxSteps === 'number'
          ? Math.min(60, Math.max(3, Math.round(parsed.maxSteps)))
          : 25,
      sendScreenshots: parsed.sendScreenshots !== false,
      acknowledged: parsed.acknowledged === true,
    };
  } catch {
    return DEFAULTS;
  }
}

interface SettingsState {
  settings: ChatSettings;
  /** Which providers have a key in the credential store (the key itself is never here). */
  keys: Record<ProviderId, boolean>;
  update: (patch: Partial<ChatSettings>) => void;
  setKey: (provider: ProviderId, present: boolean) => void;
}

export const settingsStore = createStore<SettingsState>()((set, get) => ({
  settings: load(),
  keys: { anthropic: false, openai: false, custom: false },
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* private mode or blocked storage: the settings last for this session */
    }
  },
  setKey: (provider, present) => set((s) => ({ keys: { ...s.keys, [provider]: present } })),
}));

export const useChatSettings = (): SettingsState => useStore(settingsStore, (s) => s);

/** The model for the chosen provider (empty means the person has not chosen one yet). */
export const activeModel = (s: ChatSettings): string => s.models[s.provider].trim();
