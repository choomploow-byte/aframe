import type { ToolContext } from '@core/types';
import { PIXELART_PROMPT, PIXELART_TOOL_NAMES } from '@core/tools-pixelart';
import { create } from 'zustand';
import { runAgentTurn, type ToolOutcome } from '../chat/agent';
import { chatReadiness } from '../chat/session';
import { activeModel, settingsStore } from '../chat/settings';
import { chatToolDefs, createChatToolContext, runChatTool } from '../chat/tool-context';
import { currentTransport } from '../chat/transport';
import type { Block, ToolDef } from '../chat/types';
import { store } from '../store/store';
import { toText } from '@core/pixelart';

/**
 * The AI prompt bar in the Pixel Art editor. It reuses the in-app assistant (same providers, key,
 * transport and tool plumbing) with a pixel art system prompt and ONLY the pixel art tools, so it
 * draws on the same canvas the person is looking at. A whole run is one undo step.
 */
export type PixelAiState =
  | { phase: 'idle' }
  | { phase: 'working'; status: string }
  | { phase: 'done'; message: string }
  | { phase: 'error'; message: string };

export const usePixelAi = create<{ state: PixelAiState }>(() => ({ state: { phase: 'idle' } }));

const set = (state: PixelAiState): void => usePixelAi.setState({ state });

let controller: AbortController | null = null;

export const QUICK_ACTIONS = {
  improve:
    'Improve this pixel art: cleaner shapes, better contrast and readability, a tidy 1-pixel outline. Keep the same subject, size and overall design.',
  shading:
    'Add shading to this pixel art. Choose one light direction (from the top left) and shade each material with 2 to 3 flat tones, plus a highlight. Keep the outline and silhouette as they are.',
  outline:
    'Clean up the outline: make it a consistent 1-pixel line, remove stray single pixels and jagged steps. Do not change the colours or the shapes otherwise.',
} as const;

export function generatePrompt(text: string): string {
  return `Generate pixel art of: ${text.trim()}. If the canvas is empty or does not exist, create one first (32 x 32 unless the subject needs another size). Draw the whole image with pixelart_replace_grid using a limited palette.`;
}

const SYSTEM = `You are AFrame's pixel art assistant, working inside the Pixel Art editor. The person sees the canvas live and will undo you in one step if they do not like the result. Use only the pixelart_ tools.

${PIXELART_PROMPT}`;

function pixelToolDefs(): ToolDef[] {
  return chatToolDefs().filter((t) => PIXELART_TOOL_NAMES.includes(t.name));
}

/** Runs one request. Never throws: problems become the `error` state and the canvas stays as it was. */
export async function runPixelAi(request: string): Promise<void> {
  const text = request.trim();
  if (text === '' || usePixelAi.getState().state.phase === 'working') return;
  set({ phase: 'working', status: 'Checking your AI settings…' });
  const ready = await chatReadiness();
  if (!ready.ok) {
    set({ phase: 'error', message: ready.reason });
    return;
  }
  const transport = currentTransport();
  if (transport === null) {
    set({ phase: 'error', message: 'The AI runs in the desktop app.' });
    return;
  }
  const tools = pixelToolDefs();
  if (tools.length === 0) {
    set({ phase: 'error', message: 'The Pixel Art beta feature is switched off.' });
    return;
  }
  const { settings } = settingsStore.getState();
  const canvas = store.getState().doc.pixelArt;
  // A little context up front saves a tool call; the AI is still told to read the canvas itself.
  const context = canvas
    ? `The canvas is ${canvas.width} x ${canvas.height} with ${canvas.palette.length - 1} palette colours. Current pixels:\n${toText(canvas).rows.join('\n')}`
    : 'There is no canvas yet.';
  const message: Block[] = [{ type: 'text', text: `${context}\n\n${text}` }];
  controller = new AbortController();
  const ctx: ToolContext = createChatToolContext();
  set({ phase: 'working', status: 'Thinking…' });
  // One transaction: everything the AI does in this run is a single undo step.
  store.getState().beginTransaction(`AI: ${text.replace(/\s+/g, ' ').slice(0, 40)}`);
  let touched = 0;
  try {
    const result = await runAgentTurn({
      provider: settings.provider,
      model: activeModel(settings),
      system: SYSTEM,
      history: [],
      message,
      tools,
      transport,
      runTool: async (name, input): Promise<ToolOutcome> => {
        set({ phase: 'working', status: statusFor(name) });
        const outcome = await runChatTool(ctx, name, input, { sendScreenshots: false });
        if (outcome.ok && name !== 'pixelart_get_canvas') touched += 1;
        return outcome;
      },
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'error') set({ phase: 'error', message: event.error.message });
      },
      maxSteps: Math.min(settings.maxSteps, 20),
    });
    if (usePixelAi.getState().state.phase === 'error') return;
    if (result.outcome === 'stopped') {
      set({
        phase: 'done',
        message:
          touched > 0 ? 'Stopped. What was drawn so far is kept; undo to remove it.' : 'Stopped.',
      });
    } else if (result.outcome === 'error' || result.outcome === 'repeated_failure') {
      set({
        phase: 'error',
        message:
          result.error?.message ??
          'The AI could not finish. Your canvas is safe; undo removes anything it changed.',
      });
    } else {
      set({
        phase: 'done',
        message:
          touched > 0
            ? 'Done. Undo (Ctrl+Z) takes the whole change back.'
            : 'The AI made no changes.',
      });
    }
  } catch (e) {
    set({ phase: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' });
  } finally {
    store.getState().endTransaction();
    controller = null;
  }
}

function statusFor(tool: string): string {
  switch (tool) {
    case 'pixelart_get_canvas':
      return 'Looking at your canvas…';
    case 'pixelart_replace_grid':
      return 'Drawing the image…';
    case 'pixelart_create_canvas':
      return 'Making a canvas…';
    case 'pixelart_set_palette':
      return 'Choosing colours…';
    default:
      return 'Drawing…';
  }
}

export function cancelPixelAi(): void {
  controller?.abort();
}

export function dismissPixelAi(): void {
  if (usePixelAi.getState().state.phase !== 'working') set({ phase: 'idle' });
}
