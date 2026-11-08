import { base64ToBytes } from '@core/assets';
import { figmaPictureNeeds, parseFigmaUrl, type FigmaPictures } from '@core/import/figma';

/**
 * Talking to Figma through the desktop app: the token lives in the system keychain and only the app's
 * native side uses it (src-tauri/src/figma.rs). A browser build cannot do this; it can still import a
 * saved file (the JSON from "Save as JSON" or an API response).
 */
export class FigmaError extends Error {
  constructor(
    readonly kind: 'no_token' | 'denied' | 'not_found' | 'rate_limit' | 'network' | 'other',
    message: string,
  ) {
    super(message);
  }
}

const isDesktop = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
export const figmaAvailable = (): boolean => isDesktop();

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
    if (message === 'NO_TOKEN') throw new FigmaError('no_token', 'Add your Figma token first.');
    if (message.startsWith('NETWORK'))
      throw new FigmaError('network', 'Could not reach Figma. Check your internet connection.');
    throw new FigmaError('other', message === '' ? 'The request failed.' : message);
  }
}

export const hasToken = (): Promise<boolean> =>
  isDesktop() ? call<boolean>('ai_key_status', { provider: 'figma' }) : Promise.resolve(false);
export const saveToken = (token: string): Promise<void> =>
  call<void>('ai_key_set', { provider: 'figma', key: token });
export const clearToken = (): Promise<void> => call<void>('ai_key_clear', { provider: 'figma' });

interface Reply {
  status: number;
  text: string;
}

async function figma(kind: string, key: string, ids?: string, depth?: number): Promise<unknown> {
  const r = await call<Reply>('figma_get', { kind, key, ids: ids ?? null, depth: depth ?? null });
  if (r.status === 403 || r.status === 401) {
    throw new FigmaError(
      'denied',
      'Figma rejected the token, or it cannot open this file. Check the token and that you can view the file.',
    );
  }
  if (r.status === 404)
    throw new FigmaError('not_found', 'Figma could not find that file. Check the link.');
  if (r.status === 429)
    throw new FigmaError(
      'rate_limit',
      'Figma is rate limiting this token. Wait a minute and try again.',
    );
  if (r.status < 200 || r.status >= 300)
    throw new FigmaError('other', `Figma answered with an error (${r.status}).`);
  try {
    return JSON.parse(r.text) as unknown;
  } catch {
    throw new FigmaError('other', 'Figma sent an answer that could not be read.');
  }
}

/** Pages and their top-level frames (cheap: two levels deep). */
export function loadOutline(url: string): Promise<{ key: string; file: unknown; nodeId?: string }> {
  const parsed = parseFigmaUrl(url);
  if (!parsed) {
    return Promise.reject(
      new FigmaError(
        'other',
        'That is not a link to a Figma file (it should start with https://www.figma.com/design/).',
      ),
    );
  }
  return figma('file', parsed.key, undefined, 2).then((file) => ({
    key: parsed.key,
    file,
    ...(parsed.nodeId ? { nodeId: parsed.nodeId } : {}),
  }));
}

/** The chosen frame in full, wrapped the way the importer reads a file. */
export async function loadFrame(key: string, frameId: string): Promise<unknown> {
  const body = (await figma('nodes', key, frameId)) as {
    nodes?: Record<string, { document?: unknown } | null>;
  };
  const document = body.nodes?.[frameId]?.document;
  if (document === undefined)
    throw new FigmaError('not_found', 'That frame is not in the file any more.');
  return {
    document: {
      id: '0:0',
      type: 'DOCUMENT',
      children: [{ id: '0:1', type: 'CANVAS', name: 'Page', children: [document] }],
    },
  };
}

async function download(url: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  try {
    const pic = await call<{ mime: string; base64: string }>('figma_download', { url });
    const bytes = base64ToBytes(pic.base64);
    return bytes ? { mime: pic.mime, bytes } : null;
  } catch {
    return null;
  }
}

/** The pictures a frame needs: vector shapes as SVG, image fills as bytes. Missing ones become placeholders. */
export async function loadPictures(
  key: string,
  frame: unknown,
  frameId: string,
): Promise<FigmaPictures> {
  const needs = figmaPictureNeeds(frame, frameId);
  const pictures: FigmaPictures = {};
  if (needs.vectorIds.length > 0) {
    const out = (await figma('svg', key, needs.vectorIds.join(','))) as {
      images?: Record<string, string | null>;
    };
    const svgs: Record<string, string> = {};
    for (const [id, url] of Object.entries(out.images ?? {})) {
      if (typeof url !== 'string') continue;
      const pic = await download(url);
      if (pic) svgs[id] = new TextDecoder().decode(pic.bytes);
    }
    pictures.vectorSvgs = svgs;
  }
  if (needs.imageRefs.length > 0) {
    const out = (await figma('fills', key)) as { meta?: { images?: Record<string, string> } };
    const fills: NonNullable<FigmaPictures['imageFills']> = {};
    for (const ref of needs.imageRefs) {
      const url = out.meta?.images?.[ref];
      if (typeof url !== 'string') continue;
      const pic = await download(url);
      if (pic && /^image\/(png|jpeg|gif|webp)$/.test(pic.mime)) {
        fills[ref] = { mime: pic.mime as 'image/png', bytes: pic.bytes };
      }
    }
    pictures.imageFills = fills;
  }
  return pictures;
}
