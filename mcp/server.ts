/**
 * The AFrame MCP server (docs/05): every tool from the shared core, plus resources and prompts.
 * Transport is stdio, so NOTHING may be written to stdout except protocol messages: all logging
 * goes to stderr.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { getOutline } from '../src/core/outline';
import type { Tool, ToolResult } from '../src/core/tool-kit';
import { PIXELART_FEATURE, PIXELART_TOOL_NAMES } from '../src/core/tools-pixelart';
import { TOOLS } from '../src/core/tools';
import { parseProjectText, projectFile } from '../src/projects/projects';
import type { McpEnv } from './env';
import { MCP_VERSION, PROMPT_RECIPES, SERVER_INSTRUCTIONS } from './generated';
import type { Presence } from './presence';

const PROJECT_PARAM = z
  .string()
  .optional()
  .describe('Project id or exact name. Default: the project open in AFrame, else the newest.');

/** Tools that change nothing (hosts can run them without asking). */
const READ_ONLY = new Set([
  'get_design',
  'get_node',
  'get_selection',
  'get_tokens',
  'get_annotations',
  'get_reference',
  'list_references',
  'list_skills',
  'load_skill',
  'lint_design',
  'list_projects',
  'screenshot',
  'search_icons',
  'list_fonts',
  'component_list',
  'search_library',
  'list_themes',
  'compare_reference',
  'pixelart_get_canvas',
  'find_nodes',
]);

type Block = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** A ToolResult as an MCP tool result: JSON text (and images); errors carry { code, message, hint }. */
export function toCallToolResult(result: ToolResult): { content: Block[]; isError?: true } {
  if (!result.ok) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(result.error) }] };
  }
  const content: Block[] = [{ type: 'text', text: JSON.stringify(result.data) }];
  for (const img of result.images ?? []) {
    content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
  }
  return { content };
}

function registerTool(
  server: McpServer,
  env: McpEnv,
  presence: Presence,
  tool: Tool,
): ReturnType<McpServer['registerTool']> {
  const base = tool.inputSchema as z.ZodObject;
  // A tool that takes a `project` of its own (open_project) keeps it: it is the target, not the selector.
  const ownsProject = 'project' in base.shape;
  return server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: ownsProject ? base : base.extend({ project: PROJECT_PARAM }),
      annotations: {
        readOnlyHint: READ_ONLY.has(tool.name),
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: Record<string, unknown>) => {
      presence.touch();
      if (ownsProject) return toCallToolResult(await env.run(tool, args));
      const { project, ...input } = args;
      const result = await env.run(tool, input, typeof project === 'string' ? project : undefined);
      return toCallToolResult(result);
    },
  );
}

const PROMPTS: { name: string; match: RegExp; title: string }[] = [
  { name: 'improve-design', match: /^Improve my design/i, title: 'Improve my design' },
  { name: 'match-reference', match: /^Match a reference/i, title: 'Match a reference' },
  {
    name: 'rebuild-from-screenshot',
    match: /^Rebuild from a screenshot/i,
    title: 'Rebuild from a screenshot',
  },
  { name: 'critique', match: /^Critique/i, title: 'Critique (no edits)' },
  {
    name: 'make-responsive',
    match: /^Make it responsive/i,
    title: 'Make it responsive / mobile version',
  },
];

export function createAFrameServer(env: McpEnv, presence: Presence): McpServer {
  const server = new McpServer(
    { name: 'aframe', version: MCP_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // Beta features: their tools are registered but hidden until the feature is switched on in
  // AFrame's Settings (the switch is read from settings.json, so no restart is needed). A handler
  // also refuses to run while the feature is off, in case a host kept an old tool list.
  const betaTools: ReturnType<typeof registerTool>[] = [];
  for (const tool of TOOLS) {
    const handle = registerTool(server, env, presence, tool);
    if (PIXELART_TOOL_NAMES.includes(tool.name)) {
      handle.disable();
      betaTools.push(handle);
    }
  }
  const syncBeta = async (): Promise<void> => {
    const on = await env.betaOn(PIXELART_FEATURE);
    for (const handle of betaTools) {
      if (on && !handle.enabled) handle.enable();
      else if (!on && handle.enabled) handle.disable();
    }
  };
  void syncBeta();
  const timer = setInterval(() => void syncBeta(), 2000);
  timer.unref();

  // Resources: skills as documents, and the design outline of each project.
  server.registerResource(
    'skill',
    new ResourceTemplate('aframe://skills/{name}', {
      list: () => ({
        resources: env.skillList().map((s) => ({
          uri: `aframe://skills/${s.name}`,
          name: s.name,
          description: s.description,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'AFrame design skill',
      description: 'Design knowledge to load before designing.',
      mimeType: 'text/markdown',
    },
    (uri, variables) => {
      const skill = env.skillList().find((s) => s.name === String(variables.name));
      if (!skill) throw new Error(`No skill named ${String(variables.name)}`);
      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: skill.body }] };
    },
  );
  server.registerResource(
    'project-design',
    new ResourceTemplate('aframe://project/{id}/design', {
      list: async () => ({
        resources: (await env.listAll()).map((p) => ({
          uri: `aframe://project/${p.id}/design`,
          name: p.name,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'Project design outline',
      description: 'The outline of a project, as get_design returns it.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = String(variables.id);
      const text = await env.home.read(projectFile(id));
      const parsed = text === null ? null : parseProjectText(text);
      if (!parsed?.ok) throw new Error(`Project ${id} cannot be read`);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(getOutline(parsed.doc)),
          },
        ],
      };
    },
  );

  // Prompts: the recipes users reach with slash commands.
  for (const p of PROMPTS) {
    const recipe = PROMPT_RECIPES.find((r) => p.match.test(r.title));
    if (!recipe) continue;
    server.registerPrompt(
      p.name,
      { title: p.title, description: recipe.text.slice(0, 120) },
      () => ({
        messages: [
          { role: 'user' as const, content: { type: 'text' as const, text: recipe.text } },
        ],
      }),
    );
  }
  return server;
}
