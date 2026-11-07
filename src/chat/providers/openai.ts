/**
 * OpenAI Chat Completions (`POST /v1/chat/completions`), also used for any OpenAI-compatible server
 * (OpenRouter, Ollama, LM Studio...). Function calling only. Tool messages cannot carry images, so a
 * screenshot returned by a tool is sent as a following user message with an `image_url`.
 */
import { cleanSchema } from './schema';
import type {
  Block,
  ChatMessage,
  Provider,
  ProviderId,
  ProviderReply,
  SendRequest,
  StopReason,
  ToolCall,
} from '../types';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const dataUrl = (mime: string, data: string): string => `data:${mime};base64,${data}`;

function convert(message: ChatMessage): Json[] {
  if (message.role === 'assistant') {
    const text = message.blocks
      .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const calls = message.blocks
      .filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use')
      .map((b) => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
    return [
      {
        role: 'assistant',
        content: text === '' ? null : text,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      },
    ];
  }
  const out: Json[] = [];
  const pictures: Json[] = [];
  for (const b of message.blocks) {
    if (b.type !== 'tool_result') continue;
    out.push({
      role: 'tool',
      tool_call_id: b.toolUseId,
      content: b.text === '' ? '(no output)' : b.text,
    });
    for (const img of b.images) {
      pictures.push({ type: 'image_url', image_url: { url: dataUrl(img.mime, img.data) } });
    }
  }
  const content: Json[] = [];
  for (const b of message.blocks) {
    if (b.type === 'text') content.push({ type: 'text', text: b.text });
    else if (b.type === 'image')
      content.push({ type: 'image_url', image_url: { url: dataUrl(b.mime, b.data) } });
  }
  if (pictures.length > 0) {
    content.unshift({ type: 'text', text: 'The tool returned this image:' }, ...pictures);
  }
  if (content.length > 0) out.push({ role: 'user', content });
  return out;
}

const FINISH: Record<string, StopReason> = {
  stop: 'end',
  tool_calls: 'tool',
  function_call: 'tool',
  length: 'length',
  content_filter: 'refusal',
};

function makeProvider(id: ProviderId): Provider {
  return {
    id,

    buildBody(req: SendRequest): unknown {
      return {
        model: req.model,
        // OpenAI's current models want max_completion_tokens; compatible servers know max_tokens.
        ...(id === 'openai'
          ? { max_completion_tokens: req.maxTokens }
          : { max_tokens: req.maxTokens }),
        messages: [
          { role: 'system', content: req.system },
          ...req.messages.flatMap((m) => convert(m)),
        ],
        tools: req.tools.map((t) => {
          const schema = cleanSchema(t.inputSchema);
          return {
            type: 'function',
            function: { name: t.name, description: t.description, parameters: schema },
          };
        }),
      };
    },

    parse(json: unknown): ProviderReply {
      const choice =
        isObject(json) && Array.isArray(json.choices) && isObject(json.choices[0])
          ? json.choices[0]
          : null;
      const message = choice !== null && isObject(choice.message) ? choice.message : null;
      if (message === null) throw new Error('The answer had no message.');
      const toolCalls: ToolCall[] = [];
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        if (!isObject(call) || !isObject(call.function)) continue;
        const name = call.function.name;
        const args = call.function.arguments;
        if (typeof call.id !== 'string' || typeof name !== 'string') continue;
        try {
          const input: unknown =
            typeof args === 'string' && args.trim() !== '' ? JSON.parse(args) : {};
          toolCalls.push({ id: call.id, name, input });
        } catch {
          toolCalls.push({
            id: call.id,
            name,
            input: {},
            badArguments: typeof args === 'string' ? args.slice(0, 200) : '',
          });
        }
      }
      const usage = isObject(json) && isObject(json.usage) ? json.usage : {};
      const finish = typeof choice?.finish_reason === 'string' ? choice.finish_reason : 'stop';
      const stop = FINISH[finish] ?? 'end';
      return {
        text: typeof message.content === 'string' ? message.content : '',
        toolCalls,
        stop: toolCalls.length > 0 && stop === 'end' ? 'tool' : stop,
        usage: {
          input: Number(usage.prompt_tokens ?? 0) || 0,
          output: Number(usage.completion_tokens ?? 0) || 0,
        },
      };
    },
  };
}

export const openai = makeProvider('openai');
export const custom = makeProvider('custom');
