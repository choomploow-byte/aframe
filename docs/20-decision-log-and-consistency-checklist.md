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
| 28 | 2026-11-07 | Flex sizing: fixed/hug `flex: 0 0 auto`, fill `flex: 1 1 0`, shared global reset | CSS default `flex-shrink: 1` shrinks fixed items | Leave defaults | Accepted; verified in `scripts/css-probe.ts`: `min-height: 0` on column `fill` collapsed content, so only `min-width: 0` is emitted |
| 29 | 2026-11-07 | Strokes via `outline`/`outline-offset` | `inset box-shadow` paints under child fills; border shifts layout | box-shadow, border | Accepted after browser probe |
| 30 | 2026-11-07 | `locked` is UI-only; tools warn | Spec silent | Tools reject edits to locked nodes | Accepted |
| 31 | 2026-11-07 | `line` = horizontal bar (w length, h thickness, stroke colour) | Spec has `line` without semantics | Zero-height line with border | Accepted |
| 32 | 2026-11-07 | Wrong-type properties are errors, `null` unsets, first error aborts the batch | Silent no-ops mislead agents | Lenient ignore | Accepted |
| 33 | 2026-11-07 | Unknown tokens are warnings; ops never bump `rev` (commit layer does) | docs/04 "unknown token => warning"; docs/06 puts rev in the writer | Errors; rev in core | Accepted |
| 34 | 2026-11-07 | Cross-axis `hug` under `align: stretch` stretches | Spec says hug = `auto`; fixture relies on equal-height cards | Force `align-self: flex-start` | Accepted |
| 35 | 2026-11-07 | Every UI edit is a core op batch dispatched through `applyChanges` (`store.dispatch`); no UI code mutates nodes | CLAUDE.md rules 2 and 4; keeps the editor, chat agent and MCP identical | Direct node mutation in the store | Accepted |
| 36 | 2026-11-07 | History = stack of earlier `Doc` snapshots (structural sharing), 300 ms same-key coalescing, 200 cap, explicit transactions for gestures and AI turns | docs/03 §4; cheap and exact | Patch/inverse-op history | Accepted |
| 37 | 2026-11-07 | `rev` is bumped by every local commit, undo, redo and cancelled transaction (content restores, revision still grows) | docs/06: rev is monotonic for sync | Restore the old rev on undo | Accepted |
| 38 | 2026-11-07 | Selection overlay lives in screen space and is measured from the DOM after React commits (layout effect + ResizeObserver) | Exact handles under auto-layout, zoom and hug/fill; pitfall: rotation (v0.2) needs the element transform, not its bounding box | Compute rects from the model | Accepted |
| 39 | 2026-11-07 | Click selects at the depth of the current selection (first click: the artboard's child); double-click goes one level deeper; Ctrl/Cmd+click is deepest; artboards are moved by their name label or when already selected | Figma-like hierarchy navigation without a layer panel yet | Always select the deepest node | Accepted |
| 40 | 2026-11-07 | Inline text edit happens in the node's own element (`contenteditable="plaintext-only"`), nothing is dispatched while typing, commit on Esc / Ctrl+Enter / blur; empty text deletes the layer | One undo step, correct fonts/metrics for free | A separate editor overlay | Accepted |
| 41 | 2026-11-07 | Bundled fonts are registered as `@font-face` aliases under their plain names ("Inter", not "Inter Variable"), generated by `scripts/gen-fonts-css.mjs` | `nodeToCss` and exported code say `font-family: "Inter"` | Use fontsource names in documents | Accepted (answers Phase 1 open question 1) |
| 42 | 2026-11-07 | `window.__atelier` dev hooks exist only in `vite dev` and the `--mode perf` build (`VITE_DEVTOOLS=1`); performance is measured on the optimised build and in the real WebView2 window | React's dev build is ~13x slower per frame (40 ms vs 3 ms for an artboard drag) and would mislead | Measure the dev server | Accepted |
| 43 | 2026-11-07 | `duplicate` of an artboard places the copy to its right (+40px); of a free-positioned node +16,+16; in a flex parent no offset | Phase 1 open question 3 | Always on top of the original | Accepted |
| 44 | 2026-11-07 | Side panels are 264px (left) and 304px (right), not 240/300 | Token rows (swatch + hex + name + usage + delete) and the Layout controls truncated at the old widths | Smaller type, or hide the usage counts | Accepted (docs/07 updated) |
| 45 | 2026-11-07 | Theme = `data-theme` on `<html>` (`system` removes it), three-way toggle, saved in `localStorage["atelier.theme"]`, applied before first paint by the external `public/theme-init.js` | A UI preference, not part of the document. An external file keeps `script-src 'self'` strict; verified that the attribute is set while `<body>` does not exist yet (no flash) and under the Tauri CSP | Inline script (needs a CSP hash/nonce); applying the theme from React (flashes) | Accepted |
| 46 | 2026-11-07 | Navigation keys (Tab, arrows, Enter, Space) are canvas shortcuts only while the canvas has focus (Tab also needs *something* focused); the window key handler ignores events a widget already handled (`defaultPrevented`). The canvas is focusable (`tabindex=-1`) and takes focus on pointer-down | Found by the keyboard-only test: Tab was swallowed by "select next sibling" so keyboard users could not leave the canvas, and arrow keys in the Layers tree also nudged the node | Per-widget `stopPropagation` | Accepted |
| 47 | 2026-11-07 | Layer drag/drop uses pointer events (not HTML5 drag and drop); zones above / inside / below decide the new parent and index, dropping on a descendant is refused | Identical behaviour in WebView2, WebKit and Chrome; testable with real mouse input | HTML5 DnD (inconsistent in webviews) | Accepted |
| 48 | 2026-11-07 | Panels never build ops by hand: they call `src/store/panel-commands.ts` / `token-commands.ts`, which go through `store.edit(...)` and return `{ok, error}`. Each field uses a coalescing key so a scrub or a typing run is one undo step | One place for undo labels, coalescing and error text | Ops in components | Accepted |
| 49 | 2026-11-07 | Images (PNG, JPEG, GIF, WebP, SVG) are recognised by their first bytes, capped at 20 MB, stored as data URLs in `doc.assets`, and shown only through `<img>` (an SVG's scripts never run: tested). Picker, paste and drop share one importer; rejections are toasts that name the file and list what is accepted | docs/18: never trust file names or declared types | Allow-list by extension | Accepted |
| 50 | 2026-11-07 | Renaming a token rewrites every reference in one undo step; deleting one detaches (nodes keep the literal value) with an Undo toast; names are unique per group. New tool `set_tokens` (merge; `null` removes; spacing replaces the scale) | docs/05 listed `set_tokens`; the panel and the tool share `core/token-edit.ts` | Cascade-delete the uses | Accepted |
| 51 | 2026-11-07 | Brand accent `#C96442` is for lines, fills and icons only. Text on or in accent uses `--accent-strong` (white on it 5.3:1) and `--accent-text` (5.8:1 light, 5.7:1 dark) | Measured: white on the brand colour is 3.9:1, below WCAG AA for small text | Darken the brand colour | Accepted |
| 52 | 2026-11-07 | One shortcut registry feeds the key handler, the command palette (Ctrl+K) and the shortcut sheet (Ctrl+/); only those two carry `global: true` so they work while a field has focus | Keeps the three lists from drifting | Separate lists | Accepted |
| 53 | 2026-11-07 | Tooltips are native `title` attributes for now; no custom tooltip component | Phase 11 polish item; native tooltips are accessible and free | Build a component now | Accepted (known gap) |
| 54 | 2026-11-07 | Project documents are written by compare-and-write on `rev` under a per-project lock file (`.lock`, exclusive create, taken over when 5 s old), in Rust and, identically, in Node (`mcp/home-fs.ts`) | Atomic rename protects readers, not writers from each other: two read-modify-write cycles lose an update. A native call holds the lock for milliseconds, so no TTL race | A lock held across webview round trips; last-writer-wins | Accepted |
| 55 | 2026-11-07 | The lock's stale threshold is 5 s (first draft: 10 s) | A hard-killed writer left saving blocked for the whole window in the crash test; writes hold the lock for milliseconds. PID-liveness checks would be exact but need per-OS code | PID check with `windows-sys`/`libc` | Accepted (follow-up possible) |
| 56 | 2026-11-07 | `state.json` is split: `app-state.json` (written only by the native side), `settings.json` (webview), `agents/<pid>.json` (each MCP process). The heartbeat is a native thread | One writer per file; webview timers are throttled when the window is hidden | One shared state file | Accepted (implements decisions 18-20) |
| 57 | 2026-11-07 | Merge on external change is a property-level three-way merge (`core/merge.ts`); the remote value wins a same-property clash and the node is named in a toast; an inconsistent result falls back to the remote document and undo returns the user's | docs/06: "remote wins"; finer than node-level so dragging one node while an agent edits another loses nothing | Dirty-node sets; operational transform | Accepted |
| 58 | 2026-11-07 | Adopting an external document does not bump `rev` or stamp the writer (`store.adoptExternal`), is one undo step, and is not applied during a gesture or inline text edit | Otherwise every agent edit would be written straight back and rev would double-count | Treat it as a local edit | Accepted |
| 59 | 2026-11-07 | `rev` must grow through undo, redo and cancelled gestures: a restored snapshot takes the *current* rev + 1 (it used its own old rev + 1, which could equal or trail the current one) | Found while building sync: the file's rev must be monotonic. Covered by a store test that fails on the old code | Leave as is | Accepted (bug fix) |
| 60 | 2026-11-07 | Saves wait 250 ms after the last change but never more than 2 s after the first unsaved change | A pure debounce never fires during a long drag, so a crash lost it all (seen in the kill test) | Debounce only | Accepted |
| 61 | 2026-11-07 | Changes are detected by `(mtime, size)`, not by `rev`, and own writes record the stat taken under the lock | The acceptance script edits the JSON without bumping `rev` | Compare `rev` | Accepted |
| 62 | 2026-11-07 | Every Tauri command is a named permission (`allow-fs-read`, ...) granted in the capability file, via the build-script app manifest; `fs_mtime` became `fs_stat`, plus `fs_read_head`, `fs_write_doc`, `app_state_set`, `bridge_resync`, `app_quit` | Least privilege: a page can reach exactly these commands | Open commands for all windows (the default) | Accepted |
| 63 | 2026-11-07 | The window closes through the page: native emits `atelier://close-requested`, the page saves and calls `app_quit`; a 4 s grace period quits regardless | Never lose the last edit, never trap the user behind a hung page | Close immediately | Accepted |
| 64 | 2026-11-07 | Project import/export use the browser's file input and download, not a dialog plugin | No extra plugin or permission; the page only ever sees a file the user picked | `tauri-plugin-dialog` + a path-taking command | Accepted (dialog plugin returns in Phase 8 for the export folder) |
| 65 | 2026-11-07 | Browser test runs always use a throwaway `ATELIER_HOME`; `?nopersist` (honoured only in dev and the dev-hooks build) keeps the canvas tests in memory | A test must never write into a real projects folder (one early run wrote into `~/.atelier-dev`; fixed) | Share the dev home | Accepted |
| 66 | 2026-11-07 | Brand accent is purple (`#5B3CB0` light, `#8A6EE0` dark), replacing the placeholder terracotta; new projects start with the same primary | The logo and wordmark are purple, so the UI, the favicon, the pins and a new document's starter tokens use one colour family. Brand masters live in `brand/`, web copies in `public/brand/`, desktop icons are generated from `app-icon.png` with `tauri icon`. | The placeholder `scripts/make-icons.py` was removed (it would have overwritten the real icon). |

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
