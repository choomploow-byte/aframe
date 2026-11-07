/**
 * The agent loop (docs/08): ask the model, run the tools it asks for, send the results back, repeat.
 * Pure apart from the injected `transport`, `runTool` and `sleep`, so a script can drive it in tests.
 *
 * Guarantees:
 *  - stops at `maxSteps`, when `signal` aborts (no tool runs after that), or when the same tool call
 *    fails three times in a row;
 *  - screenshots older than the last few are replaced by a note, so context stays bounded;
 *  - rate limits, overload and server errors are retried (twice, with a pause), other failures end
 *    the turn with a message written for the person;
 *  - tool output is data: it goes back to the model as a tool result, never merged into the system prompt.
 */
import { errorFromResponse, networkError } from './errors';
import { providerFor } from './providers';
import {
  ProviderError,
  type Block,
  type ChatMessage,
  type ImageData,
  type ProviderId,
  type ToolCall,
  type ToolDef,
  type Transport,
  type Usage,
} from './types';

export interface ToolOutcome {
  ok: boolean;
  /** What the model reads: JSON of the result or of the error. */
  text: string;
  images: ImageData[];
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; input: unknown }
  | {
      type: 'tool_end';
      id: string;
      name: string;
      ok: boolean;
      summary: string;
      images: ImageData[];
    }
  | { type: 'usage'; usage: Usage }
  | { type: 'retry'; message: string }
  | { type: 'error'; error: ProviderError };

export type TurnOutcome = 'done' | 'stopped' | 'max_steps' | 'error' | 'repeated_failure';

export interface TurnOptions {
  provider: ProviderId;
  model: string;
  system: string;
  /** The conversation so far (without the new message). */
  history: ChatMessage[];
  /** The person's new message. */
  message: Block[];
  tools: ToolDef[];
  transport: Transport;
  runTool: (name: string, input: unknown) => Promise<ToolOutcome>;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  maxSteps?: number;
  maxTokens?: number;
  /** How many screenshots stay in full (the rest become a note). */
  keepImages?: number;
  /** Pause between retries; a test passes a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TurnResult {
  outcome: TurnOutcome;
  /** The conversation after this turn (history + everything added). */
  messages: ChatMessage[];
  usage: Usage;
  error?: ProviderError;
}

const OMITTED = '[screenshot left out to keep the conversation short]';
const RETRY_PAUSES = [1500, 4000];

/** Keeps the newest `keep` images in tool results and replaces older ones with a note. */
export function trimImages(messages: ChatMessage[], keep: number): ChatMessage[] {
  let seen = 0;
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const m = out[i] as ChatMessage;
    if (m.role !== 'user' || !m.blocks.some((b) => b.type === 'tool_result' && b.images.length > 0))
      continue;
    const blocks = m.blocks.map((b) => {
      if (b.type !== 'tool_result' || b.images.length === 0) return b;
      const stay: ImageData[] = [];
      let dropped = 0;
      for (const img of [...b.images].reverse()) {
        if (seen < keep) {
          seen += 1;
          stay.unshift(img);
        } else dropped += 1;
      }
      return dropped === 0
        ? b
        : {
            ...b,
            images: stay,
            text: `${b.text}\n${OMITTED}${dropped > 1 ? ` (${dropped})` : ''}`,
          };
    });
    out[i] = { ...m, blocks };
  }
  return out;
}

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

export async function runAgentTurn(opts: TurnOptions): Promise<TurnResult> {
  const provider = providerFor(opts.provider);
  const maxSteps = opts.maxSteps ?? 25;
  const maxTokens = opts.maxTokens ?? 8192;
  const keep = opts.keepImages ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => abortableSleep(ms, opts.signal));
  const usage: Usage = { input: 0, output: 0 };
  let messages: ChatMessage[] = [...opts.history, { role: 'user', blocks: opts.message }];
  const failures = new Map<string, number>();

  const finish = (outcome: TurnOutcome, error?: ProviderError): TurnResult => ({
    outcome,
    messages,
    usage,
    ...(error ? { error } : {}),
  });

  for (let step = 0; step < maxSteps; step += 1) {
    if (opts.signal.aborted) return finish('stopped');

    // Ask, retrying the failures that are worth a second go.
    let reply;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const body = provider.buildBody({
          system: opts.system,
          messages: trimImages(messages, keep),
          tools: opts.tools,
          model: opts.model,
          maxTokens,
        });
        let res;
        try {
          res = await opts.transport(opts.provider, body, opts.signal);
        } catch (e) {
          if (opts.signal.aborted) return finish('stopped');
          throw e instanceof ProviderError ? e : networkError();
        }
        if (opts.signal.aborted) return finish('stopped');
        if (res.status < 200 || res.status >= 300) throw errorFromResponse(res.status, res.text);
        let json: unknown;
        try {
          json = JSON.parse(res.text);
        } catch {
          throw new ProviderError(
            'server',
            'The provider sent an answer that could not be read. Try again.',
            true,
          );
        }
        reply = provider.parse(json, opts.model);
        break;
      } catch (e) {
        const error =
          e instanceof ProviderError
            ? e
            : new ProviderError('unknown', 'The answer from the provider could not be understood.');
        const pause = RETRY_PAUSES[attempt];
        if (error.retryable && pause !== undefined) {
          opts.onEvent({ type: 'retry', message: `${error.message} Trying again…` });
          await sleep(pause);
          if (opts.signal.aborted) return finish('stopped');
          continue;
        }
        opts.onEvent({ type: 'error', error });
        return finish('error', error);
      }
    }

    usage.input += reply.usage.input;
    usage.output += reply.usage.output;
    opts.onEvent({ type: 'usage', usage: { ...usage } });
    if (reply.text !== '') opts.onEvent({ type: 'text', text: reply.text });

    const blocks: Block[] = [];
    if (reply.text !== '') blocks.push({ type: 'text', text: reply.text });
    for (const call of reply.toolCalls) {
      blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
    }
    messages = [
      ...messages,
      {
        role: 'assistant',
        blocks,
        ...(reply.raw
          ? { raw: { provider: opts.provider, model: opts.model, content: reply.raw } }
          : {}),
      },
    ];

    if (reply.stop === 'refusal') {
      const error = new ProviderError(
        'refusal',
        'The model declined to do that. Try rephrasing what you want the design to do.',
      );
      opts.onEvent({ type: 'error', error });
      return finish('error', error);
    }
    if (reply.toolCalls.length === 0) {
      if (reply.stop === 'length') {
        opts.onEvent({
          type: 'text',
          text: '(The reply was cut off because it hit the length limit. Ask me to continue.)',
        });
      }
      return finish('done');
    }

    // Run the tools, in order, and answer all of them in one user message.
    const results: Block[] = [];
    let repeated = false;
    for (const call of reply.toolCalls) {
      if (opts.signal.aborted) {
        // The assistant message has tool calls without answers: answer them so the history stays valid.
        results.push(skipped(call));
        continue;
      }
      opts.onEvent({ type: 'tool_start', id: call.id, name: call.name, input: call.input });
      const out: ToolOutcome =
        call.badArguments !== undefined
          ? { ok: false, text: '{"error":"The arguments were not valid JSON."}', images: [] }
          : await opts.runTool(call.name, call.input).catch((e: unknown) => ({
              ok: false,
              text: JSON.stringify({ error: e instanceof Error ? e.message : 'The tool failed.' }),
              images: [],
            }));
      const key = `${call.name}:${JSON.stringify(call.input)}`;
      if (out.ok) failures.delete(key);
      else {
        const n = (failures.get(key) ?? 0) + 1;
        failures.set(key, n);
        if (n >= 3) repeated = true;
      }
      opts.onEvent({
        type: 'tool_end',
        id: call.id,
        name: call.name,
        ok: out.ok,
        summary: summarise(out),
        images: out.images,
      });
      results.push({
        type: 'tool_result',
        toolUseId: call.id,
        text: out.text,
        images: out.images,
        isError: !out.ok,
      });
    }
    messages = [...messages, { role: 'user', blocks: results }];
    if (opts.signal.aborted) return finish('stopped');
    if (repeated) {
      opts.onEvent({
        type: 'text',
        text: 'I kept hitting the same problem, so I stopped. Tell me what you would like instead.',
      });
      return finish('repeated_failure');
    }
  }
  opts.onEvent({
    type: 'text',
    text: `I stopped after ${maxSteps} steps. The work so far is on the canvas; ask me to carry on.`,
  });
  return finish('max_steps');
}

function skipped(call: ToolCall): Block {
  return {
    type: 'tool_result',
    toolUseId: call.id,
    text: '{"error":"Stopped by the user before this ran."}',
    images: [],
    isError: true,
  };
}

function summarise(out: ToolOutcome): string {
  if (out.ok) return out.images.length > 0 ? 'Screenshot taken' : 'Done';
  try {
    const parsed: unknown = JSON.parse(out.text);
    if (typeof parsed === 'object' && parsed !== null) {
      const message = (parsed as { message?: unknown; error?: unknown }).message;
      if (typeof message === 'string') return message.slice(0, 160);
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'string') return error.slice(0, 160);
    }
  } catch {
    /* plain text */
  }
  return out.text.slice(0, 160);
}
