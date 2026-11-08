# Phase 5: MCP Server, Bridge, Installer

**Read:** docs/05 (authoritative), docs/06 (bridge), docs/09 (installer), docs/18 (confinement), `prompts/mcp-server-instructions.md`, `skills/aframe-SKILL.md`. **Verify current MCP SDK API and the current Claude Code / Codex / Cursor MCP config methods in their official docs first.**

## Goal
Claude Code (and Codex/Cursor) can read and edit designs, see them via screenshots, and be installed with one paste.

## Tasks
1. `mcp/server.ts`: MCP server over stdio using the SDK. Register every tool in docs/05 using the shared `core/tools.ts` definitions and handlers with a **file-backed `ToolContext`** (`mcp/context.ts`): read-modify-write with atomic writes, `rev` bump, `lastWriter: 'mcp'`, Windows rename retries. Logging to **stderr only**. Include the server `instructions` text.
2. Implement remaining tool handlers in `core/tools.ts` (get_node, tokens, annotations, references, import_image with magic-byte + size checks, list/load_skill, lint_design (basic rules now, full in Phase 9), create/open/list projects).
3. **Bridge client** (`mcp/bridge.ts`): liveness check via `state.json` heartbeat, request writer, response poller (100 ms, 15 s timeout), cleanup, clear errors (`APP_NOT_RUNNING`, `TIMEOUT`). `get_selection` from `state.json.selection` with request fallback.
4. **App-side request handler** (`src/sync/requests.ts`): handles `screenshot` (html-to-image of node element or whole frame; scale, maxWidth; waits for fonts/images; optional annotations overlay composited in a canvas), `export_image`, `get_node_bounds`, `open_project`. Writes response; deletes request. Allow-list + param validation.
5. `scripts/build-mcp.mjs`: esbuild bundle -> `mcp/dist/aframe-mcp.mjs` (ESM, node18+, single file, shebang). The app embeds this file (import as raw string at build) and writes it to `~/.aframe/mcp/` on launch if newer.
6. **CLI subcommands** in the same bundle: `install [--claude|--codex|--cursor|--all]`, `uninstall`, `doctor`, `print-config`, `--version`. Idempotent, backups, never clobber foreign config, helpful output. Claude Code: prefer `claude mcp add --scope user ...`, fall back to config edit/printing steps. Writes `~/.claude/skills/aframe/SKILL.md` from `skills/aframe-SKILL.md`.
7. **Connect dialog** (replace Phase 3 stub): tabs per host, the paste-into-Claude text (`prompts/user-install-prompt.md` with real paths filled in), terminal one-liner, copy buttons, "Test connection" (watch `state.json.lastAgentSeen`), status pill in the top bar, "Claude Code is editing..." indicator and pulse on changed nodes.
8. `scripts/test-mcp.mjs`: using SDK Client + stdio: initialise, list tools, create project in temp `AFRAME_HOME`, apply nested batch, get_design outline, bad op atomicity, lint basic, export stub, simulated app responder for screenshot, confinement tests (path traversal, symlink, non-image import).
9. Manual end-to-end with a real Claude Code if available in your environment; otherwise write `docs/manual-e2e.md` with the exact steps for me.

## Acceptance
- From a fresh Claude Code: paste install text -> tools appear -> "in aframe, add a hero section" visibly edits the open canvas live.
- `screenshot` returns an image the agent can describe; with app closed it returns a clear actionable error; doc tools still work.
- `node aframe-mcp.mjs doctor` reports green on a healthy setup, and clear fixes otherwise.
- `npm test` includes the MCP integration test and passes in CI.

## Report back with
Tool list as implemented, host-specific install findings (what actually worked), and any host that doesn't render image results (and the fallback you added).
