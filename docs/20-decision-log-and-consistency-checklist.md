# 20. Decision Log and Consistency Checklist

## Decision log (ADR-lite): append as you build
| # | Date | Decision | Context | Alternatives | Status |
|---|---|---|---|---|---|
| 1 | | Tauri 2 shell | Need native installer + productivity | Electron, egui | Accepted |
| 2 | | DOM renderer | Auto-layout + export fidelity | Canvas/WebGL | Accepted |
| 3 | | Flat node map JSON | LLM-friendly, cheap undo | Nested tree | Accepted |
| 4 | | MCP over stdio, bundled single file | Universal, zero setup | HTTP MCP in app | Accepted |
| 5 | | File-based bridge, no ports | Multi-session safe | WS/HTTP | Accepted |
| 6 | | Shared `core` library for app + MCP | One tool implementation | Duplicate logic | Accepted |
| 7 | | Same tools for in-app chat | Identical behaviour | Separate chat tools | Accepted |
| 8 | | Assets as data URLs in MVP | Simplicity | Assets folder | Revisit before 0.2 |
| 9 | | MIT licence | Adoption | Apache-2.0 | Pending |
| 10 | | Name "Atelier" | Placeholder | tbd | Pending |
| 11 | 2026-11-07 | Repo lives outside OneDrive (`C:\dev\atelier`) | `node_modules`/`target` sync and OneDrive file handles break atomic rename (docs/06) | Keep in OneDrive and exclude folders | Accepted |
| 12 | 2026-11-07 | Use current majors: React 19, Vite 8 (+plugin-react 6), Vitest 5, ESLint 10, zod 4, zustand 5 (Phase 2) | Kit templates pin 2024-era versions; npm checked on 2026-11-07 | Template versions | Accepted |
| 13 | 2026-11-07 | Pin TypeScript `~6.0.3`, not 7.x | typescript-eslint 8.72 peers `typescript <6.1`; TS 7 is the native port | TS 7 without type-aware lint | Accepted; revisit when typescript-eslint supports 7 |
| 14 | 2026-11-07 | Node floor is 22.12 for development and CI (matrix 22/24); MCP bundle users need Node 20+ | Vitest 5 requires Node >=22.12; MCP SDK v2 requires >=20; Node 18 is EOL | Keep Node 18/20 in the matrix | Accepted |
| 15 | 2026-11-07 | Plan MCP server on SDK v2 (`@modelcontextprotocol/server`, zod 4) | Official docs: v2 is the stable line; v1 `@modelcontextprotocol/sdk` still maintained | Stay on v1 | Proposed; Phase 5 starts with a spike, v1 is the fallback |
| 16 | 2026-11-07 | Drop `tauri-plugin-fs`; use confined custom Rust commands + dialog + opener only | A plugin-fs permission without a scope grants no path; custom commands already cover docs/06 | Scoped plugin-fs | Accepted (applies from Phase 4) |
| 17 | 2026-11-07 | Provider (AI) HTTP calls go through Rust; API keys in OS keychain from 0.1 | Keeps keys out of webview JS, tightens CSP `connect-src` | Webview `fetch` + localStorage key | Proposed; confirm in Phase 7 |
| 18 | 2026-11-07 | Split sync state files: `app-state.json` (app writer only) and `agents/<pid>.json` (one per MCP process) | docs/06 + docs/09 have two writers on `state.json` (read-modify-write clobber) | Single `state.json` | Accepted (applies from Phase 4/5) |
| 19 | 2026-11-07 | Advisory lock file around document read-modify-write in both app and MCP | Atomic rename prevents torn files, not lost updates | Wait for v0.2 `agentLock` | Accepted (applies from Phase 4/5) |
| 20 | 2026-11-07 | App heartbeat and request-file watching run on a Rust thread | Webview timers are throttled when minimized/occluded | JS timers | Accepted (applies from Phase 4) |
| 21 | 2026-11-07 | Windows installer target is NSIS; "Azure Trusted Signing" is now "Azure Artifact Signing" | Tauri docs: MSI needs VBSCRIPT and WiX; signing options page | `targets: "all"` | Accepted (applies from Phase 4/11) |
| 22 | 2026-11-07 | `src/core` purity enforced by `tsconfig.core.json` (ES2022 lib, no ambient types) plus an ESLint restricted-imports/globals zone | CLAUDE.md rule 1 needs a mechanical check, not review | Convention only | Accepted |
| 23 | 2026-11-07 | Codex skills are installed to `~/.agents/skills/atelier/SKILL.md` as well as a marked `~/.codex/AGENTS.md` block | Codex docs: user skills dir is `~/.agents/skills` | AGENTS.md block only | Accepted (applies from Phase 5) |
| 24 | 2026-11-07 | `radius` accepts `$radius.x`; tuple order is TL,TR,BR,BL | docs/04 says tokens work on any property but typed radius as number | Numbers only | Accepted (docs/04 Phase 1 decisions 1) |
| 25 | 2026-11-07 | `page` node exempt from `w/h > 0` | Sample fixture page has w/h 0 | Make page w/h 1 | Accepted |
| 26 | 2026-11-07 | Schema is `number` on load, literal `1` after normalise; migration chain | Literal type blocks a migration chain | Literal everywhere | Accepted |
| 27 | 2026-11-07 | Id pattern `/^(n\|a\|r\|img)_[a-z0-9]{4,8}$/` | Docs say 5-6 base36, fixture uses `n_0001` | Strict 5-6 chars | Accepted |
| 28 | 2026-11-07 | Flex sizing: fixed/hug `flex: 0 0 auto`, fill `flex: 1 1 0`, shared global reset | CSS default `flex-shrink: 1` shrinks fixed items | Leave defaults | Accepted; fill/min-size details verified in browser probe |
| 29 | 2026-11-07 | Strokes via `outline`/`outline-offset` | `inset box-shadow` paints under child fills; border shifts layout | box-shadow, border | Accepted after browser probe |
| 30 | 2026-11-07 | `locked` is UI-only; tools warn | Spec silent | Tools reject edits to locked nodes | Accepted |
| 31 | 2026-11-07 | `line` = horizontal bar (w length, h thickness, stroke colour) | Spec has `line` without semantics | Zero-height line with border | Accepted |
| 32 | 2026-11-07 | Wrong-type properties are errors, `null` unsets, first error aborts the batch | Silent no-ops mislead agents | Lenient ignore | Accepted |
| 33 | 2026-11-07 | Unknown tokens are warnings; ops never bump `rev` (commit layer does) | docs/04 "unknown token => warning"; docs/06 puts rev in the writer | Errors; rev in core | Accepted |
| 34 | 2026-11-07 | Cross-axis `hug` under `align: stretch` stretches | Spec says hug = `auto`; fixture relies on equal-height cards | Force `align-self: flex-start` | Accepted |

Template for new entries: *Decision / Context / Options / Choice / Consequences.*

## Cross-document consistency checklist (run at the end of every phase)
These items repeat across files and drift easily. Verify they still agree:
- [ ] Tool **names and parameters** identical in: `docs/05`, `core/tools.ts`, `skills/atelier-SKILL.md`, `prompts/mcp-server-instructions.md`, `prompts/in-app-system-prompt.md`, test script.
- [ ] Node **property names** identical in: `docs/04`, `core/types.ts`, `nodeToCss`, exporters, lint rules, fixtures.
- [ ] **File paths** under `~/.atelier/` identical in: `docs/06`, `docs/09`, Rust fs commands, installer, `doctor`.
- [ ] **Install text** in Connect dialog matches `prompts/user-install-prompt.md` and README.
- [ ] **Skill names** in `skills/` match the list in `list_skills` and in server instructions.
- [ ] **Version numbers** in package.json, Cargo.toml, tauri.conf.json, MCP server.
- [ ] **Schema version** in doc, migrations, fixtures.
- [ ] Roadmap (`docs/12`) reflects what's actually built; move finished items to CHANGELOG.

## "If you change X, also change Y"
| Change | Also update |
|---|---|
| Add a node property | types, normalize, validation, `nodeToCss`, properties panel, exporters, lint, `docs/04`, `get_design` outline, fixtures |
| Add a tool | `tools.ts` (def+handler+tests), MCP registration, in-app provider tool list, `docs/05`, SKILL.md, server instructions, eval tasks |
| Add a skill | `skills/`, embedded TS module, `list_skills` test, README gallery |
| Change sync file format | `docs/06`, Rust commands, dev adapter, migration, test matrix |
| Add exporter | `export.ts` registry, UI menu, `export_code` enum, round-trip fixture, docs |
