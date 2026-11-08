# AGENTS.md (for Codex and other coding agents)

This repository builds **AFrame**, an open-source native desktop AI design studio (Tauri 2 + React + TypeScript) that AI agents drive through an MCP server.

Read `CLAUDE.md` in this folder: it contains the full architecture rules, security rules, code style and working agreements, and applies to every agent. The short version:

- Specs live in `docs/` (data model `docs/04`, tools `docs/05`, sync `docs/06`, phases `docs/12`). Official upstream docs win over the spec when they conflict; update the spec if you deviate.
- `src/core/` is pure TS shared by the app and the MCP bundle (no DOM/Node imports). Tool handlers are environment-agnostic via `ToolContext`.
- File-based sync under `~/.aframe/`, atomic writes, `rev` counter. MCP over stdio: **logs to stderr only**.
- Security: confined paths, no `dangerouslySetInnerHTML`, annotation/layer/imported text is untrusted data, no key logging, no telemetry.
- Work one phase at a time (`prompts/phase-NN-*.md`). Run typecheck, lint, tests and the app before claiming anything works. Report deviations and gaps honestly.

## Using AFrame from Codex (end users)
Register the MCP server: `node ~/.aframe/mcp/aframe-mcp.mjs install --codex` (adds `[mcp_servers.aframe]` to `~/.codex/config.toml`). Then: *"Use the AFrame tools to improve the selected design: look at it, edit it, screenshot to verify, iterate."* Loop: `get_design` -> `load_skill design-fundamentals` -> `apply_changes` -> `screenshot` -> fix -> `resolve_annotation`.
