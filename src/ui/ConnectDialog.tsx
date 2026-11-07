import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  claudePrompt,
  codexPrompt,
  EXAMPLE_PROMPTS,
  genericJson,
  serverPath,
  terminalLines,
} from '../connect/install-text';
import { useConnect } from '../connect/agents';
import { getFs } from '../platform/fs';
import { STRINGS } from '../strings';
import { Dialog } from './Dialog';
import { Tabs } from './Tabs';
import { closeDialog } from './ui-state';

const t = STRINGS.connect;
type HostTab = 'claude' | 'codex' | 'other';

function CopyBlock({ label, text, id }: { label: string; text: string; id: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = (): void => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };
  return (
    <div className="copyblock">
      <div className="copyblock__bar">
        <span className="copyblock__label">{label}</span>
        <button
          type="button"
          className="btn btn--small btn--secondary"
          data-action={`copy-${id}`}
          onClick={copy}
        >
          {copied ? (
            <Check size={13} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
          )}
          {copied ? t.copied : t.copy}
        </button>
      </div>
      <pre className="copyblock__text" tabIndex={0} aria-label={label} data-testid={`text-${id}`}>
        {text}
      </pre>
    </div>
  );
}

/** Test connection: waits for a tool call that arrives after the dialog opened. */
function TestConnection() {
  const lastToolCall = useConnect((s) => s.lastToolCall);
  const connected = useConnect((s) => s.connected);
  const [openedAt] = useState(() => Date.now());
  const heard = lastToolCall !== null && lastToolCall >= openedAt - 1000;
  return (
    <div
      className="connect__test"
      role="status"
      aria-live="polite"
      data-testid="connect-test"
      data-state={heard ? 'heard' : connected ? 'connected' : 'waiting'}
    >
      <span
        className={`connect__light${heard ? ' connect__light--on' : connected ? ' connect__light--idle' : ''}`}
        aria-hidden="true"
      />
      <span>{heard ? t.heard : connected ? t.connectedIdle : t.waiting}</span>
    </div>
  );
}

export function ConnectDialog() {
  const [tab, setTab] = useState<HostTab>('claude');
  const [path, setPath] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getFs()
      .then((fs) => fs.home())
      .then((home) => alive && setPath(serverPath(home)))
      .catch((e: unknown) => alive && setProblem(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Dialog title={t.title} onClose={closeDialog} width={620}>
      <div className="dialog__body connect">
        <p>{t.body}</p>
        {problem !== null && <p className="dialog__muted">{t.noPath(problem)}</p>}
        {path !== null && (
          <>
            <Tabs
              label={t.hosts}
              tabs={[
                { id: 'claude', label: 'Claude Code' },
                { id: 'codex', label: 'Codex' },
                { id: 'other', label: t.other },
              ]}
              value={tab}
              onChange={setTab}
            >
              {tab === 'claude' && (
                <div className="connect__panel">
                  <p className="dialog__muted">{t.claudeHow}</p>
                  <CopyBlock id="claude" label={t.pasteIntoClaude} text={claudePrompt(path)} />
                  <CopyBlock id="terminal" label={t.orTerminal} text={terminalLines(path)} />
                </div>
              )}
              {tab === 'codex' && (
                <div className="connect__panel">
                  <p className="dialog__muted">{t.codexHow}</p>
                  <CopyBlock id="codex" label={t.pasteIntoCodex} text={codexPrompt(path)} />
                  <CopyBlock id="terminal" label={t.orTerminal} text={terminalLines(path)} />
                </div>
              )}
              {tab === 'other' && (
                <div className="connect__panel">
                  <p className="dialog__muted">{t.otherHow}</p>
                  <CopyBlock id="json" label={t.jsonLabel} text={genericJson(path)} />
                </div>
              )}
            </Tabs>
            <TestConnection />
            <section aria-label={t.tryAsking}>
              <h3 className="connect__h">{t.tryAsking}</h3>
              <ul className="connect__examples">
                {EXAMPLE_PROMPTS.map((p) => (
                  <li key={p}>
                    <code>{p}</code>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
        <div className="dialog__footer">
          <button type="button" className="btn btn--primary" onClick={closeDialog}>
            {t.close}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
