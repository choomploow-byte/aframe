import { Check, KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { errorFromResponse, networkError } from '../chat/errors';
import { keyStore, refreshKeys } from '../chat/keys';
import { PROVIDERS, providerFor } from '../chat/providers';
import { activeModel, settingsStore, useChatSettings } from '../chat/settings';
import { currentTransport } from '../chat/transport';
import { ProviderError, type ProviderId } from '../chat/types';
import { BETA_FEATURES } from '@core/beta';
import { setFeatureBeta, setMasterBeta, useBetaSettings } from './beta';
import { Dialog } from './Dialog';
import { Segmented, Select, Toggle } from './fields';
import { closeDialog } from './ui-state';

type Result = { kind: 'ok' | 'error'; text: string } | null;

/** AI settings: which provider and model, the API key (kept in the system keychain), and limits. */
export function SettingsDialog() {
  const { settings, keys } = useChatSettings();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const store = keyStore();
  const info = PROVIDERS.find((p) => p.id === settings.provider);
  const model = activeModel(settings);
  const hasKey = keys[settings.provider];
  const update = settingsStore.getState().update;
  const beta = useBetaSettings();

  const saveKey = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      await store.set(settings.provider, key);
      setKey('');
      await refreshKeys();
      setResult({ kind: 'ok', text: 'Key saved in your system keychain.' });
    } catch (e) {
      setResult({
        kind: 'error',
        text: e instanceof Error ? e.message : 'The key could not be saved.',
      });
    } finally {
      setBusy(false);
    }
  };

  const removeKey = async (): Promise<void> => {
    await store.clear(settings.provider);
    await refreshKeys();
    setResult({ kind: 'ok', text: 'Key removed.' });
  };

  /** One tiny request: proves the key, the model name and the address in one go. */
  const test = async (): Promise<void> => {
    const transport = currentTransport();
    if (transport === null) {
      setResult({ kind: 'error', text: 'Testing needs the desktop app.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const body = providerFor(settings.provider).buildBody({
        system: 'Reply with the single word: ok',
        messages: [{ role: 'user', blocks: [{ type: 'text', text: 'Say ok.' }] }],
        tools: [],
        model,
        maxTokens: 64,
      });
      const res = await transport(settings.provider, body, new AbortController().signal);
      if (res.status >= 200 && res.status < 300) {
        setResult({ kind: 'ok', text: 'Connected. The key and the model both work.' });
      } else {
        setResult({ kind: 'error', text: errorFromResponse(res.status, res.text).message });
      }
    } catch (e) {
      setResult({
        kind: 'error',
        text: e instanceof ProviderError ? e.message : networkError().message,
      });
    } finally {
      setBusy(false);
    }
  };

  const canTest = model !== '' && (hasKey || settings.provider === 'custom');

  return (
    <Dialog title="AI settings" onClose={closeDialog} width={500}>
      <div className="dialog__body settings" data-testid="settings-dialog">
        <p className="dialog__muted">
          The built-in assistant uses your own account with the provider you choose. Using Claude
          Code or Codex instead? You do not need any of this: use <strong>Connect AI</strong>.
        </p>

        <div className="settings__row">
          <span>Provider</span>
          <Segmented<ProviderId>
            ariaLabel="Provider"
            field="chat-provider"
            value={settings.provider}
            options={PROVIDERS.map((p) => ({
              value: p.id,
              label: p.label.split(' (')[0] ?? p.label,
              title: p.label,
            }))}
            onChange={(provider) => {
              update({ provider });
              setResult(null);
            }}
          />
        </div>

        <div className="settings__row">
          <span>Model</span>
          <div className="settings__model">
            {info !== undefined && info.models.length > 0 && (
              <Select
                ariaLabel="Model"
                field="chat-model"
                value={info.models.some((m) => m.id === model) ? model : undefined}
                options={info.models.map((m) => ({ value: m.id, label: m.label }))}
                onChange={(id) =>
                  update({ models: { ...settings.models, [settings.provider]: id } })
                }
              />
            )}
            <input
              className="textfield"
              type="text"
              aria-label="Model name"
              data-field="chat-model-name"
              placeholder={
                settings.provider === 'anthropic'
                  ? 'or type a model name'
                  : "The model name from your provider's list"
              }
              value={settings.models[settings.provider]}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) =>
                update({ models: { ...settings.models, [settings.provider]: e.target.value } })
              }
            />
          </div>
        </div>

        {settings.provider === 'custom' && (
          <div className="settings__row">
            <span>Server address</span>
            <input
              className="textfield"
              type="text"
              aria-label="Server address"
              data-field="chat-base-url"
              placeholder="https://… or http://localhost:11434/v1"
              value={settings.baseUrl}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
          </div>
        )}

        <div className="settings__row settings__row--key">
          <span>API key</span>
          <div className="settings__key">
            {hasKey ? (
              <>
                <span className="settings__saved" data-testid="chat-key-saved">
                  <Check size={13} strokeWidth={2} aria-hidden="true" /> Saved in your system
                  keychain
                </span>
                <button
                  type="button"
                  className="btn btn--small btn--secondary"
                  data-action="chat-key-remove"
                  onClick={() => void removeKey()}
                >
                  <Trash2 size={13} strokeWidth={1.75} aria-hidden="true" /> Remove
                </button>
              </>
            ) : (
              <>
                <input
                  className="textfield"
                  type="password"
                  aria-label="API key"
                  data-field="chat-key"
                  placeholder={info?.keyHint ?? ''}
                  value={key}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={!store.available}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  data-action="chat-key-save"
                  disabled={busy || key.trim() === '' || !store.available}
                  onClick={() => void saveKey()}
                >
                  <KeyRound size={13} strokeWidth={1.75} aria-hidden="true" /> Save
                </button>
              </>
            )}
          </div>
        </div>
        {!store.available && (
          <p className="settings__note">
            Keys are kept by the desktop app, in your system keychain. This browser build cannot
            store one.
          </p>
        )}

        <div className="settings__row">
          <span>Send screenshots</span>
          <Toggle
            ariaLabel="Send screenshots to the model"
            field="chat-send-shots"
            checked={settings.sendScreenshots}
            onChange={(sendScreenshots) => update({ sendScreenshots })}
          />
        </div>
        <div className="settings__row">
          <span>Most steps per reply</span>
          <input
            className="textfield settings__number"
            type="number"
            min={3}
            max={60}
            aria-label="Most steps per reply"
            data-field="chat-max-steps"
            value={settings.maxSteps}
            onChange={(e) =>
              update({ maxSteps: Math.min(60, Math.max(3, Number(e.target.value) || 25)) })
            }
          />
        </div>

        <section
          className="settings__beta"
          aria-labelledby="beta-heading"
          data-testid="beta-section"
        >
          <h3 id="beta-heading" className="settings__heading">
            Beta features
          </h3>
          <div className="settings__row">
            <span>
              Turn on beta features
              <small className="settings__hint">
                Unfinished features you can try. Off, none of them show up anywhere.
              </small>
            </span>
            <Toggle
              ariaLabel="Turn on beta features"
              field="beta-master"
              checked={beta.enabled}
              onChange={setMasterBeta}
            />
          </div>
          {beta.enabled && (
            <ul className="settings__betalist" data-testid="beta-list">
              {BETA_FEATURES.map((f) => (
                <li className="settings__row" key={f.id} data-beta-feature={f.id}>
                  <span>
                    {f.name}
                    <small className="settings__hint">{f.description}</small>
                  </span>
                  <Toggle
                    ariaLabel={f.name}
                    field={`beta-${f.id}`}
                    checked={beta.features[f.id] ?? f.default}
                    onChange={(on) => setFeatureBeta(f.id, on)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="settings__result" aria-live="polite">
          {result !== null && (
            <p
              className={`settings__${result.kind}`}
              role={result.kind === 'error' ? 'alert' : 'status'}
              data-testid="chat-test-result"
            >
              {result.text}
            </p>
          )}
        </div>
        <div className="dialog__footer dialog__footer--split">
          <button
            type="button"
            className="btn btn--secondary"
            data-action="chat-test"
            disabled={busy || !canTest}
            onClick={() => void test()}
          >
            {busy ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="btn btn--primary" onClick={closeDialog}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
