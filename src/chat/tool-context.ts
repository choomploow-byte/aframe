import { getToolDefinitions, runTool } from '@core/tools';
import type { ToolContext } from '@core/types';
import { store } from '../store/store';
import type { ToolOutcome } from './agent';
import { chatSkills } from './skills';
import type { ToolDef } from './types';

/**
 * Tools the in-app assistant does not get: they act on other projects, read files by path or write
 * to disk, which the assistant has no confirmed folder for. (An external agent has them.)
 */
export const CHAT_EXCLUDED: ReadonlySet<string> = new Set([
  'list_projects',
  'create_project',
  'open_project',
  'import_image',
  'add_reference',
  'search_library',
  'use_library_asset',
  'export_code',
  'export_image',
]);

const MAX_RESULT_CHARS = 60_000;

export function chatToolDefs(): ToolDef[] {
  return getToolDefinitions()
    .filter((t) => !CHAT_EXCLUDED.has(t.name))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/** The tool context for the open document: the same handlers the MCP server runs, on the live store. */
export function createChatToolContext(): ToolContext {
  return {
    getDoc: () => store.getState().doc,
    // Inside the turn's transaction these edits become one undo step.
    commit: (next, meta) => store.getState().commitExternal(next, meta?.label ?? 'AI edit'),
    appOnline: () => true,
    getSelection: () => store.getState().selection,
    screenshot: async (opts) => {
      const { captureScreenshot } = await import('../canvas/screenshot');
      const s = store.getState();
      const out = await captureScreenshot(s.doc, s.viewport.zoom, opts);
      return { pngBase64: out.pngBase64, width: out.width, height: out.height };
    },
    compareReference: async (opts) => {
      const { compareWithReference } = await import('../canvas/compare-reference');
      const s = store.getState();
      return compareWithReference(s.doc, s.viewport.zoom, opts);
    },
    getNodeBounds: async (nodeId) => {
      const { nodeBounds } = await import('../canvas/screenshot');
      return nodeBounds(nodeId, store.getState().viewport.zoom);
    },
    skills: {
      list: () => chatSkills().map((s) => ({ name: s.name, description: s.description })),
      load: (name) => chatSkills().find((s) => s.name === name)?.body ?? null,
    },
  };
}

/** Runs one tool for the model: its result as text, and any pictures it made. */
export async function runChatTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
  options: { sendScreenshots: boolean },
): Promise<ToolOutcome> {
  if (CHAT_EXCLUDED.has(name)) {
    return {
      ok: false,
      text: JSON.stringify({
        code: 'NOT_FOUND',
        message: `The tool "${name}" is not available here.`,
      }),
      images: [],
    };
  }
  const result = await runTool(ctx, name, input);
  if (!result.ok) return { ok: false, text: JSON.stringify(result.error), images: [] };
  let text = JSON.stringify(result.data);
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}... (shortened: ask for a smaller part with nodeId or depth)`;
  }
  const pictures = result.images ?? [];
  if (!options.sendScreenshots && pictures.length > 0) {
    return {
      ok: true,
      text: `${text}\n(The screenshot was not sent: images are switched off in Settings.)`,
      images: [],
    };
  }
  return {
    ok: true,
    text,
    images: pictures.map((i) => ({ mime: i.mimeType, data: i.data })),
  };
}
