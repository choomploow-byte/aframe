/**
 * Provider-neutral chat types (docs/08). Messages are stored in this form and converted per
 * provider at send time, so changing provider or model mid-conversation never needs a migration.
 */

export type ProviderId = 'anthropic' | 'openai' | 'custom';

export interface ImageData {
  mime: string;
  /** Base64, no data-URL prefix. */
  data: string;
}

export type Block =
  | { type: 'text'; text: string }
  | ({ type: 'image' } & ImageData)
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      toolUseId: string;
      text: string;
      images: ImageData[];
      isError: boolean;
    };

export interface ChatMessage {
  role: 'user' | 'assistant';
  blocks: Block[];
  /**
   * The provider's own content for an assistant turn, kept so it can be sent back unchanged to the
   * same model (Anthropic needs thinking blocks echoed exactly while a tool loop is running).
   */
  raw?: { provider: ProviderId; model: string; content: unknown[] };
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface SendRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  model: string;
  maxTokens: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Set when the provider sent arguments that were not valid JSON. */
  badArguments?: string;
}

export interface Usage {
  input: number;
  output: number;
}

export type StopReason = 'end' | 'tool' | 'length' | 'refusal';

export interface ProviderReply {
  text: string;
  toolCalls: ToolCall[];
  stop: StopReason;
  usage: Usage;
  /** The provider's own assistant content (see `ChatMessage.raw`). */
  raw?: unknown[];
}

/**
 * A provider is a pair of pure converters: how to ask, and how to read the answer. It never does
 * I/O; the transport (Rust in the app, a script in tests) carries the request.
 */
export interface Provider {
  readonly id: ProviderId;
  buildBody(req: SendRequest): unknown;
  /** Reads a successful (2xx) JSON answer. */
  parse(json: unknown, model?: string): ProviderReply;
}

/** Carries a request body to the provider and returns the raw HTTP outcome. Never sees a key. */
export type Transport = (
  provider: ProviderId,
  body: unknown,
  signal: AbortSignal,
) => Promise<{ status: number; text: string }>;

export type ErrorKind =
  | 'auth'
  | 'permission'
  | 'rate_limit'
  | 'overloaded'
  | 'server'
  | 'network'
  | 'context'
  | 'vision'
  | 'bad_request'
  | 'refusal'
  | 'no_key'
  | 'unknown';

/** A failure with a message written for the person using the app. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    /** Whether trying again soon might work. */
    readonly retryable = false,
  ) {
    super(message);
  }
}
