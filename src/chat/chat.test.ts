import { describe, expect, it } from 'vitest';
import { runAgentTurn, trimImages, type AgentEvent, type ToolOutcome } from './agent';
import { errorFromResponse } from './errors';
import { anthropic } from './providers/anthropic';
import { custom, openai } from './providers/openai';
import type { ChatMessage, ProviderId, ToolDef, Transport } from './types';

const tools: ToolDef[] = [
  {
    name: 'get_design',
    description: 'Read the design',
    inputSchema: {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {},
    },
  },
];
const png = { mime: 'image/png', data: 'AAAA' };
const req = (messages: ChatMessage[], model = 'claude-sonnet-5-5') => ({
  system: 'SYS',
  messages,
  tools,
  model,
  maxTokens: 1000,
});

describe('anthropic body', () => {
  it('sends only what current models accept', () => {
    const body = anthropic.buildBody(
      req([{ role: 'user', blocks: [{ type: 'text', text: 'hi' }] }]),
    ) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'max_tokens',
      'messages',
      'model',
      'system',
      'tools',
    ]);
    expect(body.tools).toEqual([
      {
        name: 'get_design',
        description: 'Read the design',
        input_schema: { type: 'object', properties: {} },
      },
    ]);
  });

  it('puts tool results first, with their images, and marks errors', () => {
    const body = anthropic.buildBody(
      req([
        {
          role: 'user',
          blocks: [
            { type: 'text', text: 'and also' },
            {
              type: 'tool_result',
              toolUseId: 't1',
              text: '{"a":1}',
              images: [png],
              isError: false,
            },
            { type: 'tool_result', toolUseId: 't2', text: '', images: [], isError: true },
          ],
        },
      ]),
    ) as { messages: { content: Record<string, unknown>[] }[] };
    const content = body.messages[0]?.content ?? [];
    expect(content.map((c) => c.type)).toEqual(['tool_result', 'tool_result', 'text']);
    expect(content[0]).toMatchObject({
      tool_use_id: 't1',
      content: [
        { type: 'text', text: '{"a":1}' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ],
    });
    expect(content[1]).toMatchObject({ is_error: true, content: [{ text: '(no output)' }] });
  });

  it('replays the provider content unchanged to the same model only', () => {
    const raw = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'ok' },
    ];
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [{ type: 'text', text: 'ok' }],
        raw: { provider: 'anthropic', model: 'claude-sonnet-5-5', content: raw },
      },
    ];
    const same = anthropic.buildBody(req(messages)) as { messages: { content: unknown }[] };
    expect(same.messages[0]?.content).toEqual(raw);
    const other = anthropic.buildBody(req(messages, 'claude-opus-5-5')) as {
      messages: { content: unknown }[];
    };
    expect(other.messages[0]?.content).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

describe('anthropic reply', () => {
  it('reads text, tool calls, usage and the stop reason', () => {
    const reply = anthropic.parse({
      content: [
        { type: 'thinking', thinking: '', signature: 's' },
        { type: 'text', text: 'Looking.' },
        { type: 'tool_use', id: 'tu_1', name: 'get_design', input: { depth: 1 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(reply).toMatchObject({
      text: 'Looking.',
      stop: 'tool',
      usage: { input: 10, output: 5 },
      toolCalls: [{ id: 'tu_1', name: 'get_design', input: { depth: 1 } }],
    });
    expect(reply.raw).toHaveLength(3);
  });

  it('maps refusals and length, and rejects an answer without content', () => {
    expect(anthropic.parse({ content: [], stop_reason: 'refusal' }).stop).toBe('refusal');
    expect(anthropic.parse({ content: [], stop_reason: 'max_tokens' }).stop).toBe('length');
    expect(() => anthropic.parse({})).toThrow();
  });
});

describe('openai body and reply', () => {
  const messages: ChatMessage[] = [
    { role: 'user', blocks: [{ type: 'text', text: 'hi' }] },
    {
      role: 'assistant',
      blocks: [{ type: 'tool_use', id: 'c1', name: 'get_design', input: { a: 1 } }],
    },
    {
      role: 'user',
      blocks: [{ type: 'tool_result', toolUseId: 'c1', text: 'ok', images: [png], isError: false }],
    },
  ];

  it('puts the system prompt first and moves tool images to a following user message', () => {
    const body = openai.buildBody(req(messages, 'gpt-x')) as {
      messages: Record<string, unknown>[];
      max_completion_tokens: number;
    };
    expect(body.max_completion_tokens).toBe(1000);
    expect(body.messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'user',
    ]);
    expect(body.messages[2]).toMatchObject({
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'get_design', arguments: '{"a":1}' } },
      ],
    });
    const follow = body.messages[4] as { content: { type: string; image_url?: { url: string } }[] };
    expect(follow.content.some((c) => c.image_url?.url === 'data:image/png;base64,AAAA')).toBe(
      true,
    );
  });

  it('uses max_tokens for a compatible server', () => {
    const body = custom.buildBody(req(messages, 'llama')) as Record<string, unknown>;
    expect(body.max_tokens).toBe(1000);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('reads tool calls and flags arguments that are not JSON', () => {
    const reply = openai.parse({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              { id: 'a', type: 'function', function: { name: 'get_design', arguments: '{"x":1}' } },
              { id: 'b', type: 'function', function: { name: 'get_design', arguments: '{oops' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    });
    expect(reply.stop).toBe('tool');
    expect(reply.usage).toEqual({ input: 7, output: 3 });
    expect(reply.toolCalls[0]).toMatchObject({ id: 'a', input: { x: 1 } });
    expect(reply.toolCalls[1]?.badArguments).toBe('{oops');
  });
});

describe('errorFromResponse', () => {
  it.each([
    [401, '{}', 'auth', false],
    [403, '{}', 'permission', false],
    [404, '{}', 'bad_request', false],
    [429, '{}', 'rate_limit', true],
    [529, '{}', 'overloaded', true],
    [503, '{}', 'server', true],
    [413, '{}', 'context', false],
    [400, '{"error":{"message":"prompt is too long: 250000 tokens"}}', 'context', false],
    [400, '{"error":{"message":"this model does not support image input"}}', 'vision', false],
    [400, '{"error":{"message":"max_tokens: must be positive"}}', 'bad_request', false],
  ] as const)('%i -> %s', (status, body, kind, retryable) => {
    const e = errorFromResponse(status, body);
    expect(e.kind).toBe(kind);
    expect(e.retryable).toBe(retryable);
    expect(e.message.length).toBeGreaterThan(20);
  });

  it('never repeats the request or a key in its message', () => {
    const e = errorFromResponse(401, '{"error":{"message":"invalid x-api-key sk-ant-SECRET"}}');
    expect(e.message).not.toContain('SECRET');
  });
});

describe('trimImages', () => {
  const shot = (id: string): ChatMessage => ({
    role: 'user',
    blocks: [{ type: 'tool_result', toolUseId: id, text: 'shot', images: [png], isError: false }],
  });
  it('keeps the newest N and notes the rest', () => {
    const out = trimImages([shot('1'), shot('2'), shot('3'), shot('4'), shot('5')], 3);
    const counts = out.map((m) =>
      m.blocks[0]?.type === 'tool_result' ? m.blocks[0].images.length : -1,
    );
    expect(counts).toEqual([0, 0, 1, 1, 1]);
    expect(JSON.stringify(out[0])).toContain('left out');
  });
  it('does not change the original messages', () => {
    const original = [shot('1'), shot('2')];
    trimImages(original, 1);
    expect(JSON.stringify(original)).not.toContain('left out');
  });
});

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

type Step = { status?: number; body?: unknown; throws?: boolean };

function script(steps: Step[]): { transport: Transport; sent: unknown[] } {
  const sent: unknown[] = [];
  let i = 0;
  const transport: Transport = (_p: ProviderId, body: unknown) => {
    sent.push(JSON.parse(JSON.stringify(body)));
    const step = steps[Math.min(i, steps.length - 1)] as Step;
    i += 1;
    if (step.throws) return Promise.reject(new Error('offline'));
    return Promise.resolve({ status: step.status ?? 200, text: JSON.stringify(step.body ?? {}) });
  };
  return { transport, sent };
}

const toolTurn = (id: string, text = '') => ({
  content: [
    ...(text ? [{ type: 'text', text }] : []),
    { type: 'tool_use', id, name: 'get_design', input: { n: id } },
  ],
  stop_reason: 'tool_use',
  usage: { input_tokens: 100, output_tokens: 10 },
});
const endTurn = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 120, output_tokens: 20 },
});

function run(steps: Step[], extra: Partial<Parameters<typeof runAgentTurn>[0]> = {}) {
  const events: AgentEvent[] = [];
  const { transport, sent } = script(steps);
  const ran: string[] = [];
  const promise = runAgentTurn({
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    system: 'SYS',
    history: [],
    message: [{ type: 'text', text: 'improve it' }],
    tools,
    transport,
    runTool: (name, input): Promise<ToolOutcome> => {
      ran.push(`${name}:${JSON.stringify(input)}`);
      return Promise.resolve({ ok: true, text: '{"ok":true}', images: [] });
    },
    signal: new AbortController().signal,
    onEvent: (e) => events.push(e),
    sleep: () => Promise.resolve(),
    ...extra,
  });
  return { promise, events, sent, ran };
}

describe('runAgentTurn', () => {
  it('runs the tools the model asks for, then finishes with its words', async () => {
    const { promise, events, ran, sent } = run([
      { body: toolTurn('t1', 'Let me look.') },
      { body: toolTurn('t2') },
      { body: endTurn('Done: spacing improved.') },
    ]);
    const r = await promise;
    expect(r.outcome).toBe('done');
    expect(ran).toEqual(['get_design:{"n":"t1"}', 'get_design:{"n":"t2"}']);
    expect(
      events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text),
    ).toEqual(['Let me look.', 'Done: spacing improved.']);
    expect(r.usage).toEqual({ input: 320, output: 40 });
    expect(sent).toHaveLength(3);
    // The conversation ends in the assistant's words, and every tool call has its answer.
    expect(r.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
  });

  it('answers every tool call of a turn in one user message', async () => {
    const two = {
      content: [
        { type: 'tool_use', id: 'a', name: 'get_design', input: { k: 1 } },
        { type: 'tool_use', id: 'b', name: 'get_design', input: { k: 2 } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const { promise } = run([{ body: two }, { body: endTurn('ok') }]);
    const r = await promise;
    const answer = r.messages[2];
    expect(answer?.blocks.map((b) => (b.type === 'tool_result' ? b.toolUseId : '?'))).toEqual([
      'a',
      'b',
    ]);
  });

  it('stops at the step limit with the work kept', async () => {
    const { promise, ran } = run([{ body: toolTurn('x') }], { maxSteps: 3 });
    const r = await promise;
    expect(r.outcome).toBe('max_steps');
    expect(ran).toHaveLength(3);
  });

  it('stops after the same call fails three times in a row', async () => {
    const ran2: string[] = [];
    const { promise } = run(
      [
        {
          body: {
            content: [{ type: 'tool_use', id: 'x', name: 'get_design', input: { same: 1 } }],
            stop_reason: 'tool_use',
          },
        },
      ],
      {
        runTool: (n, i) => {
          ran2.push(`${n}${JSON.stringify(i)}`);
          return Promise.resolve({ ok: false, text: '{"message":"bad"}', images: [] });
        },
      },
    );
    const r = await promise;
    expect(r.outcome).toBe('repeated_failure');
    expect(ran2).toHaveLength(3);
  });

  it('does not run tools after the person pressed Stop, and keeps the history valid', async () => {
    const controller = new AbortController();
    const ran: string[] = [];
    const two = {
      content: [
        { type: 'tool_use', id: 'a', name: 'get_design', input: {} },
        { type: 'tool_use', id: 'b', name: 'get_design', input: {} },
      ],
      stop_reason: 'tool_use',
    };
    const { transport } = script([{ body: two }, { body: endTurn('never') }]);
    const r = await runAgentTurn({
      provider: 'anthropic',
      model: 'm',
      system: 's',
      history: [],
      message: [{ type: 'text', text: 'go' }],
      tools,
      transport,
      signal: controller.signal,
      onEvent: () => undefined,
      sleep: () => Promise.resolve(),
      runTool: (n) => {
        ran.push(n);
        controller.abort();
        return Promise.resolve({ ok: true, text: '{}', images: [] });
      },
    });
    expect(r.outcome).toBe('stopped');
    expect(ran).toHaveLength(1);
    const answers = r.messages.at(-1)?.blocks ?? [];
    expect(answers).toHaveLength(2);
    expect(answers[1]).toMatchObject({ isError: true });
  });

  it('stops before sending anything when already aborted', async () => {
    const c = new AbortController();
    c.abort();
    const { promise, sent } = run([{ body: endTurn('x') }], { signal: c.signal });
    expect((await promise).outcome).toBe('stopped');
    expect(sent).toHaveLength(0);
  });

  it('retries a rate limit, then succeeds', async () => {
    const { promise, events } = run([{ status: 429, body: {} }, { body: endTurn('fine') }]);
    const r = await promise;
    expect(r.outcome).toBe('done');
    expect(events.some((e) => e.type === 'retry')).toBe(true);
  });

  it('gives up after two retries with a friendly message', async () => {
    const { promise, sent } = run([{ status: 429, body: {} }]);
    const r = await promise;
    expect(r.outcome).toBe('error');
    expect(r.error?.kind).toBe('rate_limit');
    expect(sent).toHaveLength(3);
  });

  it('does not retry a rejected key', async () => {
    const { promise, sent, events } = run([
      { status: 401, body: { error: { message: 'bad key' } } },
    ]);
    const r = await promise;
    expect(r.error?.kind).toBe('auth');
    expect(sent).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'error' });
  });

  it('turns an unreachable network into a message', async () => {
    const { promise } = run([{ throws: true }]);
    expect((await promise).error?.kind).toBe('network');
  });

  it('reports a refusal instead of pretending it worked', async () => {
    const { promise } = run([{ body: { content: [], stop_reason: 'refusal' } }]);
    expect((await promise).error?.kind).toBe('refusal');
  });

  it('sends the tool result for arguments that were not JSON as an error', async () => {
    const bad = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              { id: 'z', type: 'function', function: { name: 'get_design', arguments: '{nope' } },
            ],
          },
        },
      ],
    };
    const ok = { choices: [{ finish_reason: 'stop', message: { content: 'sorry' } }] };
    const { promise, ran } = run([{ body: bad }, { body: ok }], {
      provider: 'openai',
      model: 'gpt-x',
    });
    const r = await promise;
    expect(ran).toHaveLength(0);
    expect(r.messages[2]?.blocks[0]).toMatchObject({ type: 'tool_result', isError: true });
  });

  it('keeps only the newest screenshots in what it sends', async () => {
    const shot = (id: string) => ({
      content: [{ type: 'tool_use', id, name: 'get_design', input: { id } }],
      stop_reason: 'tool_use',
    });
    const { promise, sent } = run(
      [
        { body: shot('1') },
        { body: shot('2') },
        { body: shot('3') },
        { body: shot('4') },
        { body: shot('5') },
        { body: endTurn('ok') },
      ],
      { runTool: () => Promise.resolve({ ok: true, text: 'shot', images: [png] }), keepImages: 2 },
    );
    await promise;
    const last = JSON.stringify(sent.at(-1));
    expect(last.match(/"type":"image"/g)).toHaveLength(2);
    expect(last).toContain('left out');
  });
});
