import { ImagePlus, RotateCcw, Send, Settings, Square, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { refreshKeys } from '../chat/keys';
import { IMAGE_TYPES, readImage } from '../chat/images';
import { PROVIDERS } from '../chat/providers';
import {
  chatReadiness,
  lastStepIsAi,
  resetChat,
  sendChat,
  stopChat,
  undoAiTurn,
  useChat,
  type ChatItem,
} from '../chat/session';
import { activeModel, settingsStore, useChatSettings } from '../chat/settings';
import { SUGGESTED_PROMPTS } from '../chat/system-prompt';
import type { ImageData } from '../chat/types';
import { useAtelier } from '../store/store';
import { showToast } from '../ui/toast';
import { openDialog } from '../ui/ui-state';

const MAX_IMAGES = 4;

const TOOL_LABELS: Record<string, string> = {
  get_design: 'Looked at the design',
  get_node: 'Looked closely at a layer',
  get_selection: 'Checked what you selected',
  get_tokens: 'Read the colours and fonts',
  set_tokens: 'Changed the colours and fonts',
  apply_changes: 'Edited the design',
  screenshot: 'Took a screenshot',
  lint_design: 'Checked the design for problems',
  load_skill: 'Read a design guide',
  list_skills: 'Looked up design guides',
  get_annotations: 'Read your notes',
  add_annotation: 'Left a note',
  resolve_annotation: 'Answered a note',
  list_references: 'Looked at your references',
  get_reference: 'Studied a reference',
  search_icons: 'Looked for an icon',
  place_icon: 'Placed an icon',
  list_fonts: 'Looked at the fonts',
  define_component: 'Made a reusable component',
  create_instance: 'Used a component',
  component_list: 'Looked at the components',
};
const toolLabel = (name: string): string => TOOL_LABELS[name] ?? `Used ${name.replace(/_/g, ' ')}`;

const tokensLabel = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function ToolRow({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  return (
    <details className={`chat__tool chat__tool--${item.state}`} data-testid="chat-tool">
      <summary>
        <span className="chat__tooldot" aria-hidden="true" />
        {toolLabel(item.name)}
        {item.state === 'running' ? '…' : item.state === 'failed' ? ' (did not work)' : ''}
      </summary>
      {item.summary !== '' && <p className="chat__toolsummary">{item.summary}</p>}
      {item.images.map((img, i) => (
        <img
          key={i}
          className="chat__shot"
          alt="Screenshot the assistant took"
          src={`data:${img.mime};base64,${img.data}`}
        />
      ))}
    </details>
  );
}

function Message({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="chat__msg chat__msg--user" data-testid="chat-user">
          {item.text}
          {item.images.length > 0 && (
            <span className="chat__attached">
              {item.images.length} image{item.images.length === 1 ? '' : 's'} attached
            </span>
          )}
        </div>
      );
    case 'assistant':
      return (
        <div className="chat__msg chat__msg--assistant" data-testid="chat-assistant">
          {item.text}
        </div>
      );
    case 'tool':
      return <ToolRow item={item} />;
    case 'notice':
      return <p className="chat__notice">{item.text}</p>;
    case 'error':
      return (
        <div
          className="chat__error"
          role="alert"
          data-testid="chat-error"
          data-kind={item.errorKind}
        >
          <p>{item.text}</p>
          {['auth', 'permission', 'no_key', 'bad_request', 'vision'].includes(item.errorKind) && (
            <button
              type="button"
              className="btn btn--small btn--secondary"
              onClick={() => openDialog('settings')}
            >
              Open settings
            </button>
          )}
        </div>
      );
  }
}

/** The Chat tab: talk to the built-in assistant, which edits the open design through the same tools an external agent uses. */
export function ChatPanel() {
  const items = useChat((s) => s.items);
  const running = useChat((s) => s.running);
  const turnUsage = useChat((s) => s.turnUsage);
  const { settings, keys } = useChatSettings();
  const canUndo = useAtelier(() => lastStepIsAi());
  const [text, setText] = useState('');
  const [images, setImages] = useState<ImageData[]>([]);
  const [ready, setReady] = useState<{ ok: true } | { ok: false; reason: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void refreshKeys().then(() => chatReadiness().then(setReady));
  }, [
    settings.provider,
    settings.models,
    settings.baseUrl,
    keys.anthropic,
    keys.openai,
    keys.custom,
  ]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [items]);

  const provider = PROVIDERS.find((p) => p.id === settings.provider);
  const model = activeModel(settings);

  const attach = async (files: File[]): Promise<void> => {
    const room = MAX_IMAGES - images.length;
    if (files.length > room)
      showToast(`You can attach up to ${MAX_IMAGES} images.`, { kind: 'error' });
    for (const file of files.slice(0, Math.max(0, room))) {
      try {
        const img = await readImage(file);
        setImages((prev) => [...prev, img].slice(0, MAX_IMAGES));
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'That image could not be added.', {
          kind: 'error',
        });
      }
    }
  };

  const submit = (value: string = text): void => {
    if (running) return;
    if (!settings.acknowledged) return;
    const sent = value.trim();
    if (sent === '' && images.length === 0) return;
    setText('');
    const pictures = images;
    setImages([]);
    void sendChat(sent, pictures);
  };

  if (!settings.acknowledged) {
    return (
      <div className="chat" data-testid="chat-panel">
        <div className="chat__card" data-testid="chat-privacy">
          <h3>Before you chat</h3>
          <p>
            The assistant sends your messages, an outline of your design and any screenshots it
            takes to {provider?.label ?? 'the provider you choose'}. Nothing goes anywhere else, and
            Atelier has no servers of its own.
          </p>
          <p>
            Your API key is kept in your computer&apos;s own keychain, never in a file or in the
            design.
          </p>
          <button
            type="button"
            className="btn btn--primary"
            data-action="chat-acknowledge"
            onClick={() => settingsStore.getState().update({ acknowledged: true })}
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="chat"
      data-testid="chat-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void attach([...e.dataTransfer.files]);
      }}
    >
      <div className="chat__top">
        <span className="chat__model" title="Change this in Settings" data-testid="chat-model">
          {model === '' ? 'No model chosen' : model}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Start a new chat"
          title="New chat"
          disabled={running || items.length === 0}
          data-action="chat-new"
          onClick={() => resetChat()}
        >
          <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="AI settings"
          title="AI settings"
          data-action="chat-settings"
          onClick={() => openDialog('settings')}
        >
          <Settings size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      {ready !== null && !ready.ok && (
        <div className="chat__card" data-testid="chat-setup">
          <p>{ready.reason}</p>
          <button type="button" className="btn btn--primary" onClick={() => openDialog('settings')}>
            Open settings
          </button>
          <p className="dialog__muted">
            Prefer Claude Code or Codex? Use <strong>Connect AI</strong> at the top instead.
          </p>
        </div>
      )}

      <div className="chat__log" ref={log} role="log" aria-live="polite" aria-label="Conversation">
        {items.length === 0 && (
          <div className="chat__empty">
            <p>Ask for a change, or let it look at your design and suggest one.</p>
            <div className="chat__suggestions">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="chat__suggestion"
                  data-action="chat-suggestion"
                  disabled={ready === null || !ready.ok}
                  onClick={() => submit(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {items.map((item) => (
          <Message key={item.id} item={item} />
        ))}
        {running && (
          <p className="chat__working" data-testid="chat-working">
            Working…
          </p>
        )}
      </div>

      <div className="chat__footer">
        {canUndo && !running && (
          <button
            type="button"
            className="btn btn--small btn--secondary chat__undo"
            data-action="chat-undo"
            onClick={() => undoAiTurn()}
          >
            <Undo2 size={13} strokeWidth={1.75} aria-hidden="true" /> Undo AI change
          </button>
        )}
        {turnUsage !== null && (
          <p className="chat__usage" data-testid="chat-usage">
            This reply: {tokensLabel(turnUsage.input)} tokens in, {tokensLabel(turnUsage.output)}{' '}
            out
          </p>
        )}
        {images.length > 0 && (
          <div className="chat__thumbs">
            {images.map((img, i) => (
              <button
                key={i}
                type="button"
                className="chat__thumb"
                aria-label="Remove this image"
                title="Remove"
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
              >
                <img alt="" src={`data:${img.mime};base64,${img.data}`} />
              </button>
            ))}
          </div>
        )}
        <div className="chat__composer">
          <textarea
            ref={input}
            className="chat__input"
            data-testid="chat-input"
            aria-label="Message the assistant"
            rows={2}
            maxLength={8000}
            placeholder="Ask for a change…  (Enter to send, Shift+Enter for a new line)"
            value={text}
            disabled={running}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
              if (files.length > 0) {
                e.preventDefault();
                void attach(files);
              }
            }}
          />
          <label
            className="icon-btn chat__attach"
            title="Attach an image"
            aria-label="Attach an image"
          >
            <ImagePlus size={16} strokeWidth={1.75} aria-hidden="true" />
            <input
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              hidden
              data-testid="chat-attach"
              onChange={(e) => {
                void attach([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </label>
          {running ? (
            <button
              type="button"
              className="btn btn--primary chat__send"
              data-action="chat-stop"
              onClick={() => stopChat()}
            >
              <Square size={13} strokeWidth={2} aria-hidden="true" /> Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--primary chat__send"
              data-action="chat-send"
              disabled={text.trim() === '' && images.length === 0}
              onClick={() => submit()}
            >
              <Send size={13} strokeWidth={2} aria-hidden="true" /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
