import { ProviderError } from './types';

/** The provider's own message from an error body, if it sent one. */
function detail(text: string): string {
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json === 'object' && json !== null) {
      const error = (json as { error?: unknown }).error;
      if (typeof error === 'string') return error;
      if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
      }
    }
  } catch {
    /* not JSON */
  }
  return text.slice(0, 300);
}

/** Turns an HTTP failure into a message a person can act on. Never includes request data or keys. */
export function errorFromResponse(status: number, text: string): ProviderError {
  const why = detail(text);
  const lower = why.toLowerCase();
  if (status === 401) {
    return new ProviderError(
      'auth',
      'The provider rejected your API key. Open Settings, check the key and try again.',
    );
  }
  if (status === 403) {
    return new ProviderError(
      'permission',
      'This key is not allowed to do that (often a model or region it has no access to). Check the key and model in Settings.',
    );
  }
  if (status === 404) {
    return new ProviderError(
      'bad_request',
      'The provider does not know that model or address. Check the model name (and the base URL for a custom provider) in Settings.',
    );
  }
  if (status === 429) {
    return new ProviderError(
      'rate_limit',
      'The provider is rate limiting this key. Wait a little and try again, or pick a smaller model.',
      true,
    );
  }
  if (status === 529 || lower.includes('overloaded')) {
    return new ProviderError(
      'overloaded',
      'The provider is busy right now. Try again in a moment.',
      true,
    );
  }
  if (
    status === 413 ||
    /prompt is too long|context (length|window)|maximum context|too many tokens|request too large/.test(
      lower,
    )
  ) {
    return new ProviderError(
      'context',
      'This conversation has become too long for the model. Start a new chat, or select a smaller part of the design.',
    );
  }
  if (status === 400 && /image|vision|multimodal/.test(lower)) {
    return new ProviderError(
      'vision',
      'This model could not take images. Turn off "Send screenshots" in Settings, or choose a model that can see.',
    );
  }
  if (status >= 500) {
    return new ProviderError(
      'server',
      'The provider had a problem on its side. Try again in a moment.',
      true,
    );
  }
  return new ProviderError(
    'bad_request',
    `The provider refused the request${why ? `: ${why}` : '.'}`,
  );
}

export function networkError(): ProviderError {
  return new ProviderError(
    'network',
    'Could not reach the provider. Check your internet connection (and the base URL for a custom provider).',
    true,
  );
}

export const noKeyError = (): ProviderError =>
  new ProviderError('no_key', 'Add your API key in Settings first.');
