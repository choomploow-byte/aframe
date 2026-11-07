import type { Provider, ProviderId } from '../types';
import { anthropic } from './anthropic';
import { custom, openai } from './openai';

export { anthropic, custom, openai };

export const providerFor = (id: ProviderId): Provider =>
  id === 'anthropic' ? anthropic : id === 'openai' ? openai : custom;

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Models offered in the picker; the field also accepts any model id. */
  models: { id: string; label: string }[];
  defaultModel: string;
  keyHint: string;
}

/** Model ids checked against Anthropic's published list on 2026-11-07; OpenAI's are free text. */
export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (fast, good value)' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most capable Opus)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (highest capability, highest cost)' },
    ],
    defaultModel: 'claude-sonnet-5-5',
    keyHint: 'Starts with sk-ant-',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [],
    defaultModel: '',
    keyHint: 'Starts with sk-',
  },
  {
    id: 'custom',
    label: 'Other (OpenAI-compatible)',
    models: [],
    defaultModel: '',
    keyHint: 'Whatever your server expects (may be empty for a local one)',
  },
];
