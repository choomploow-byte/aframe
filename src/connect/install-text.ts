/**
 * The text a new user pastes into their AI tool (prompts/user-install-prompt.md), with the real
 * path to the server filled in. Kept in one place so the dialog, the README and the tests agree.
 */
import { BRAND } from '../brand';

/** The stable server path inside the AFrame home, written the way that machine writes paths. */
export function serverPath(home: string): string {
  const sep = home.includes('\\') ? '\\' : '/';
  return [home.replace(/[\\/]+$/, ''), 'mcp', 'aframe-mcp.mjs'].join(sep);
}

export function claudePrompt(path: string): string {
  return `Please set up the ${BRAND.name} design app for me.

1. Run: node "${path}" install --claude
2. Check that the ${BRAND.mcpServerName} MCP tools are available (if not, tell me how to restart/reload).
3. Read the ${BRAND.mcpServerName} skill that was installed and the ${BRAND.mcpServerName} server instructions.
4. Then tell me, in 3 short lines, how to ask you to design things with it.

From now on, whenever I ask you to design, improve, restyle or rebuild any UI, use the ${BRAND.name} tools: look at the design first, make changes, take a screenshot to check your work, and keep fixing until it looks good. Keep my existing text unless I say otherwise.`;
}

export function codexPrompt(path: string): string {
  return `Please set up the ${BRAND.name} design app for me.

1. Run: node "${path}" install --codex
2. Confirm the ${BRAND.mcpServerName} MCP server is configured (show me the relevant lines of ~/.codex/config.toml) and tell me if I need to restart Codex.
3. Remember for this project: when I ask you to design or improve UI, use the ${BRAND.name} tools - inspect the design, edit it, screenshot it to verify, iterate.`;
}

export function terminalLines(path: string): string {
  return `node "${path}" install            # detects Claude Code, Codex, Cursor and sets up each
node "${path}" doctor             # checks everything is wired up`;
}

export function genericJson(path: string): string {
  return JSON.stringify(
    { mcpServers: { [BRAND.mcpServerName]: { command: 'node', args: [path] } } },
    null,
    2,
  );
}

export const EXAMPLE_PROMPTS = [
  'in aframe, improve my design',
  'in aframe, make the pricing page look more premium and follow my reference',
  'in aframe, address my annotations',
  'in aframe, rebuild this screenshot as an editable design (attach an image)',
  'in aframe, make a mobile version of the selected frame',
] as const;
