/**
 * Anthropic Messages API (`POST /v1/messages`). Current models (Opus/Sonnet/Haiku 5.5, Fable 5.1)
 * reject sampling parameters and forced tool choice and think adaptively by default, so the body
 * carries only what is needed: model, max_tokens, system, messages, tools.
 * Thinking blocks come back inside `content` and must be echoed unchanged to the same model during a
 * tool loop, which is what `ChatMessage.raw` is for.
 */
import { cleanSchema } from './schema';
import type {
  Block,
  ChatMessage,
  Provider,
  ProviderReply,
  SendRequest,
  StopReason,
  ToolCall,
} from '../types';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function toolResult(b: Extract<Block, { type: 'tool_result' }>): Json {
  const content: Json[] = [{ type: 'text', text: b.text === '' ? '(no output)' : b.text }];
  for (const img of b.images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mime, data: img.data },
    });
  }
  return {
    type: 'tool_result',
    tool_use_id: b.toolUseId,
    content,
    ...(b.isError ? { is_error: true } : {}),
  };
}

function convert(message: ChatMessage, model: string): Json {
  if (message.role === 'assistant') {
    if (message.raw?.provider === 'anthropic' && message.raw.model === model) {
      return { role: 'assistant', content: message.raw.content };
    }
    const content: Json[] = [];
    for (const b of message.blocks) {
      if (b.type === 'text' && b.text !== '') content.push({ type: 'text', text: b.text });
      if (b.type === 'tool_use')
        content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
    }
    return { role: 'assistant', content };
  }
  // Tool results must come first in the user turn that answers them.
  const results = message.blocks
    .filter((b): b is Extract<Block, { type: 'tool_result' }> => b.type === 'tool_result')
    .map(toolResult);
  const rest: Json[] = [];
  for (const b of message.blocks) {
    if (b.type === 'text') rest.push({ type: 'text', text: b.text });
    else if (b.type === 'image')
      rest.push({ type: 'image', source: { type: 'base64', media_type: b.mime, data: b.data } });
  }
  return { role: 'user', content: [...results, ...rest] };
}

const STOP: Record<string, StopReason> = {
  end_turn: 'end',
  stop_sequence: 'end',
  tool_use: 'tool',
  max_tokens: 'length',
  refusal: 'refusal',
  pause_turn: 'tool',
};

export const anthropic: Provider = {
  id: 'anthropic',

  buildBody(req: SendRequest): unknown {
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages.map((m) => convert(m, req.model)),
      tools: req.tools.map((t) => {
        const schema = cleanSchema(t.inputSchema);
        return { name: t.name, description: t.description, input_schema: schema };
      }),
    };
  },

  parse(json: unknown): ProviderReply {
    if (!isObject(json) || !Array.isArray(json.content)) {
      throw new Error('The answer from Anthropic had no content.');
    }
    const raw = json.content as unknown[];
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of raw) {
      if (!isObject(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') text += block.text;
      if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
      }
    }
    const usage = isObject(json.usage) ? json.usage : {};
    const stopReason = typeof json.stop_reason === 'string' ? json.stop_reason : 'end_turn';
    const stop = STOP[stopReason] ?? 'end';
    return {
      text,
      toolCalls,
      // A reply that asks for tools is a tool turn whatever the stop reason says.
      stop: toolCalls.length > 0 && stop === 'end' ? 'tool' : stop,
      usage: {
        input: Number(usage.input_tokens ?? 0) || 0,
        output: Number(usage.output_tokens ?? 0) || 0,
      },
      raw,
    };
  },
};
