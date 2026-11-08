import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { store } from '../store/store';
import { showToast } from '../ui/toast';
import { runAgentTurn, type AgentEvent } from './agent';
import { turnContext } from './context';
import { keyStore } from './keys';
import { activeModel, settingsStore } from './settings';
import { refreshUserSkills } from './skills';
import { SYSTEM_PROMPT } from './system-prompt';
import { chatToolDefs, createChatToolContext, runChatTool } from './tool-context';
import { currentTransport } from './transport';
import type { Block, ChatMessage, ErrorKind, ImageData, Usage } from './types';

/** What the chat panel shows. The model's own view of the conversation is `history`. */
export type ChatItem =
  | { id: number; kind: 'user'; text: string; images: ImageData[] }
  | { id: number; kind: 'assistant'; text: string }
  | {
      id: number;
      kind: 'tool';
      callId: string;
      name: string;
      state: 'running' | 'ok' | 'failed';
      summary: string;
      images: ImageData[];
    }
  | { id: number; kind: 'notice'; text: string }
  | { id: number; kind: 'error'; text: string; errorKind: ErrorKind };

interface ChatState {
  items: ChatItem[];
  history: ChatMessage[];
  running: boolean;
  /** Tokens used in the last turn, if the provider reported any. */
  turnUsage: Usage | null;
  totalUsage: Usage;
}

const EMPTY_USAGE: Usage = { input: 0, output: 0 };

export const chatStore = createStore<ChatState>()(() => ({
  items: [],
  history: [],
  running: false,
  turnUsage: null,
  totalUsage: EMPTY_USAGE,
}));

export const useChat = <T>(selector: (s: ChatState) => T): T => useStore(chatStore, selector);

let nextId = 1;
let controller: AbortController | null = null;

type NewItem = ChatItem extends infer T
  ? T extends { id: number }
    ? Omit<T, 'id'>
    : never
  : never;

const push = (item: NewItem): number => {
  const id = nextId++;
  chatStore.setState((s) => ({ items: [...s.items, { ...item, id }] }));
  return id;
};

const patchTool = (callId: string, patch: Partial<Extract<ChatItem, { kind: 'tool' }>>): void =>
  chatStore.setState((s) => ({
    items: s.items.map((i) => (i.kind === 'tool' && i.callId === callId ? { ...i, ...patch } : i)),
  }));

/** Whether the assistant can run now, and if not, what the person should do. */
export async function chatReadiness(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { settings, keys } = settingsStore.getState();
  if (currentTransport() === null) {
    return { ok: false, reason: 'The built-in assistant runs in the desktop app.' };
  }
  if (activeModel(settings) === '') {
    return { ok: false, reason: 'Choose a model in Settings first.' };
  }
  if (settings.provider === 'custom' && settings.baseUrl.trim() === '') {
    return { ok: false, reason: 'Enter your server address in Settings first.' };
  }
  const present =
    keys[settings.provider] ||
    (await keyStore()
      .has(settings.provider)
      .catch(() => false));
  if (!present && settings.provider !== 'custom') {
    return { ok: false, reason: 'Add your API key in Settings first.' };
  }
  return { ok: true };
}

function onEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'text':
      push({ kind: 'assistant', text: event.text });
      break;
    case 'tool_start':
      push({
        kind: 'tool',
        callId: event.id,
        name: event.name,
        state: 'running',
        summary: '',
        images: [],
      });
      break;
    case 'tool_end':
      patchTool(event.id, {
        state: event.ok ? 'ok' : 'failed',
        summary: event.summary,
        images: event.images,
      });
      break;
    case 'usage':
      chatStore.setState({ turnUsage: event.usage });
      break;
    case 'retry':
      push({ kind: 'notice', text: event.message });
      break;
    case 'error':
      push({ kind: 'error', text: event.error.message, errorKind: event.error.kind });
      break;
  }
}

/** Sends the person's message and runs the assistant until it finishes, is stopped or fails. */
export async function sendChat(text: string, images: ImageData[] = []): Promise<void> {
  const trimmed = text.trim();
  if (chatStore.getState().running || (trimmed === '' && images.length === 0)) return;
  // Busy from the first moment, so a second Send during the checks below cannot start another turn.
  chatStore.setState({ running: true, turnUsage: null });
  const ready = await chatReadiness();
  if (!ready.ok) {
    push({ kind: 'error', text: ready.reason, errorKind: 'no_key' });
    chatStore.setState({ running: false });
    return;
  }
  const transport = currentTransport();
  if (transport === null) {
    chatStore.setState({ running: false });
    return;
  }

  const { settings } = settingsStore.getState();
  const state = store.getState();
  const blocks: Block[] = [
    { type: 'text', text: `${turnContext(state.doc, state.selection)}\n\n${trimmed}` },
    ...images.map((i): Block => ({ type: 'image', mime: i.mime, data: i.data })),
  ];
  await refreshUserSkills();
  push({ kind: 'user', text: trimmed, images });
  controller = new AbortController();

  // One transaction: everything the assistant does in this turn is a single undo step.
  const label = `AI: ${trimmed.replace(/\s+/g, ' ').slice(0, 40) || 'edit'}`;
  store.getState().beginTransaction(label);
  const ctx = createChatToolContext();
  try {
    const result = await runAgentTurn({
      provider: settings.provider,
      model: activeModel(settings),
      system: SYSTEM_PROMPT,
      history: chatStore.getState().history,
      message: blocks,
      tools: chatToolDefs(),
      transport,
      runTool: (name, input) =>
        runChatTool(ctx, name, input, { sendScreenshots: settings.sendScreenshots }),
      signal: controller.signal,
      onEvent,
      maxSteps: settings.maxSteps,
    });
    chatStore.setState((s) => ({
      history: result.messages,
      totalUsage: {
        input: s.totalUsage.input + result.usage.input,
        output: s.totalUsage.output + result.usage.output,
      },
    }));
    if (result.outcome === 'stopped') push({ kind: 'notice', text: 'Stopped.' });
  } catch (e) {
    push({
      kind: 'error',
      text: e instanceof Error ? e.message : 'Something went wrong.',
      errorKind: 'unknown',
    });
  } finally {
    store.getState().endTransaction();
    controller = null;
    chatStore.setState({ running: false });
  }
}

/** Stops the assistant: no more tools run and the panel is free again at once. */
export function stopChat(): void {
  controller?.abort();
}

export function resetChat(): void {
  if (chatStore.getState().running) return;
  chatStore.setState({ items: [], history: [], turnUsage: null, totalUsage: EMPTY_USAGE });
}

/** Whether the newest undo step is an assistant turn (so the panel can offer "Undo AI change"). */
export function lastStepIsAi(): boolean {
  return store.getState().history.past.at(-1)?.label.startsWith('AI: ') === true;
}

export function undoAiTurn(): void {
  if (!lastStepIsAi()) return;
  const label = store.getState().undo();
  if (label !== null) showToast('Undid the AI change.');
}
