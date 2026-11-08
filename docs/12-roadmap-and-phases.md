# 12. Roadmap and Build Phases

Each phase: **goal, deliverables, acceptance criteria, how to verify, estimate** (estimate = focused Claude Code sessions, rough). Phases are ordered so there's a demoable product from Phase 6 onward. Matching prompts: `prompts/phase-NN-*.md`.

---
## Phase 0: Foundations (0.5 session)
**Goal:** repo, tooling, CI skeleton, conventions.
**Deliver:** repo layout (doc 03), `package.json`, `tsconfig` (strict), Vite+React, ESLint/Prettier, Vitest, `CLAUDE.md`/`AGENTS.md`, `LICENSE`, base `README`, GitHub Actions (typecheck+test).
**Accept:** `npm run dev` shows a blank styled shell; `npm run typecheck` and `npm test` pass.

## Phase 1: Core library (1-2 sessions)
**Goal:** the shared brain, fully testable with no UI.
**Deliver:** `types.ts`, `ids.ts`, `normalize`, `ops.ts`, `apply.ts` (atomic batches, tempIds, validation + error codes), `tokens.ts` (resolver), `style.ts` (`nodeToCss`), `tools.ts` skeleton (definitions + read tools), unit tests, `fixtures/sample-doc.json` loads and round-trips.
**Accept:** >= 90% line coverage of ops/apply/style; bad batches change nothing; sample doc passes validation; `nodeToCss` snapshot tests for each layout case in doc 04.

## Phase 2: Canvas renderer and interactions (2-3 sessions)
**Goal:** see and manipulate a document.
**Deliver:** Zustand store + history; `NodeView` recursive renderer; viewport pan/zoom; selection overlay from DOM measurement; select/marquee/move/resize/nudge; tools to draw frames/rect/ellipse/text; inline text editing; delete/duplicate/copy/paste; undo/redo with coalescing; snapping guides (basic); keyboard shortcuts.
**Accept:** load sample doc and edit it smoothly at 60fps with 500 nodes; undo/redo reliable across all actions; auto-layout frames reflow live when children change; screenshots of renderer match expected fixtures.

## Phase 3: Panels (2 sessions)
**Goal:** non-designer-friendly editing.
**Deliver:** Layers tree (rename/hide/lock/reorder by drag), Properties panel (all sections in doc 07), token editor + colour picker with token swatches, assets panel (image import via picker/drop/paste), device presets, light/dark theme, command palette, Claude-like styling pass.
**Accept:** a user can build a landing-page hero by hand from scratch in < 5 min; every property in doc 04 is editable; theme toggle works with no unstyled flashes.

## Game-UI toolkit (built between Phases 5 and 6; decision log #79-#95)
**Goal:** make Atelier good at chunky, glossy game interfaces.
**Delivered:** an icon set and `icon` nodes, four display fonts and `list_fonts`, pattern fills, effect presets, reusable components with states and overrides, state screenshots, seven genre templates with token sets and component kits, editing fixes and lint rules. Details: `docs/04`, `docs/05`. Not built: the motion preview (stretch goal).

## Phase 4: Persistence, Tauri shell and sync (2 sessions)
**Goal:** a real desktop app that saves and syncs.
**Deliver:** `platform/fs.ts` with Tauri + dev-HTTP adapters; Rust commands (confined fs); project open/create/recent; autosave with `.bak`; sync service (mtime polling, rev merge, dirty-node merge); native heartbeat (`app-state.json`); project lock and compare-and-write; property-level merge; `.exe/.app/.AppImage` build via `tauri build`; app icons; single-instance + window-state.
**Accept:** edit in the app -> file on disk updates < 500 ms; edit file externally (script) -> UI updates < 700 ms with undo entry; kill app mid-write -> doc intact; installer runs on a clean Windows VM.

## Phase 5: MCP server, bridge and installer (2-3 sessions)
**Goal:** Claude Code can read/edit designs.
**Deliver:** `mcp/server.ts` with all read/write tools (doc 05), server `instructions`, atomic file I/O, request/response bridge, app-side request handler (screenshot, export_image, get_selection fallback), esbuild bundle, `install/uninstall/doctor` CLI for Claude Code + Codex + Cursor, Connect dialog with copy-paste prompt and test-connection, skill file installed.
**Accept:** from a fresh Claude Code: paste install text -> tools appear -> "in atelier, add a hero section" edits the canvas live; `screenshot` returns an image the agent can describe; works with app closed for doc tools; `doctor` is green; `scripts/test-mcp.mjs` passes in CI.

## Phase 6: Annotations, references, selection (1-2 sessions)
**Goal:** the human-feedback loop (your signature feature).
**Deliver:** annotation tool + overlay + Notes tab; `get/add/resolve_annotation`; references panel (notes/scope, compare overlay); `get_selection`; screenshot `annotations:true` compositing; "Ask AI to address notes" action; "Claude Code is editing..." indicator and changed-node pulse.
**Accept:** drop a pin on a button saying "make this pop", run "in atelier, address my annotations" in Claude Code -> button changes, annotation resolved with reply visible in the UI. **First public demo-able milestone.**

## Phase 7: Inbuilt chat and API keys (2 sessions)
**Status: built (2026-11-08), not yet run against a live provider.** Everything is tested against scripted providers; the first real request needs your key (see docs/08).
**Goal:** works without any CLI agent.
**Deliver:** provider layer (Anthropic, OpenAI, custom), settings UI, agent loop with tools and images, history transaction per turn, stop button, error states, suggested prompts, image attach ("rebuild this screenshot"), context trimming of screenshots, token usage display.
**Accept:** with only an API key, "improve the selected frame" yields a visible improvement with at least one self-screenshot; Stop works; one undo reverts the entire AI turn; 401/429/network errors show human messages.

## Phase 8: Export (1-2 sessions)
**Status: built (2026-11-08).** Verified in Chrome with Vite and Tailwind; see docs/10 for the numbers and what is not covered.
**Goal:** designs land in the user's repo.
**Deliver:** PNG/SVG export UI; HTML+CSS exporter; React (CSS modules) exporter; Tailwind exporter; `export_code` tool with confined output; round-trip pixel-diff test; copy-as-code in context menu.
**Accept:** fixtures export to code that renders within 2% pixel diff; generated React compiles in a Vite template (CI check); no writes outside `outDir`.

## Phase 9: Skills, lint and critique (1-2 sessions)
**Status: built (2026-11-08) except the live evaluation.** Lint rules and fix operations, the Design check dialog and top-bar count, user skills, the critique flow (skill + MCP prompt + a chat suggestion) and the eval harness with its scripted baseline exist and are tested. The acceptance numbers for a model (average rating 4 or more) need a live run and a person: see `evals/RESULTS.md`. The skills were reviewed for consistency with the tools, not rewritten from eval results (there are none yet).
**Goal:** quality by default.
**Deliver:** all skills in `skills/` bundled + `list/load_skill`; user skills folder; `lint_design` with rules in doc 13; critique prompt; eval harness with 10 tasks and rubric; tune system prompts using the eval.
**Accept:** eval average >= 4/5 on the fixed task set with a strong model; lint catches seeded issues (low contrast, 10px text, off-scale spacing, overflow).

## Phase 10: Import (2-3 sessions)
**Status: built (2026-11-08), with two parts unverified**: the Figma importer has never run against a real file or the live API (no token), and the running-app capture has been tried on one small page only. See docs/10 for exact numbers and gaps. No `import_svg` MCP tool was added; agents bring an SVG in with `import_image`, and the editable import is in the app.
**Goal:** bring existing designs in.
**Deliver:** SVG importer; Figma REST JSON importer (+ Rust fetch, token UI, import report); Canva via export+rebuild flow and docs; "import my running app" (localhost URL -> screenshot/DOM -> nodes) as a spike.
**Accept:** 3 real-world Figma files convert with a report and < 20% manual fixing; running-app import gives a usable starting frame for a standard Vite/Next page.

## Phase 11: Polish, packaging, launch (2-3 sessions)
**Goal:** something strangers can install and love.
**Deliver:** onboarding + sample projects/templates, empty/error states, command palette completeness, perf pass (doc 19), accessibility pass, auto-update, signing/notarisation, docs site (README + `docs/`), demo GIF/video script, issue templates, contributor guide, Release workflow for 3 OSes, `atelier-mcp` on npm.
**Accept:** clean-machine install on Win/macOS/Linux < 2 min; Lighthouse-style a11y checks on the UI pass; cold start < 2 s; docs enable a new contributor to run dev in 10 min.

---
## v0.2 Backlog (after launch, prioritise by feedback)
Components + variants + instances · multi-page · rotation · icon library · image placeholders/stock · `lint_design` expansion · variations ("3 options") · local models · streaming chat · responsive preview + breakpoints · keychain · token export · Figma import polish · SVG vector export · PDF export · agent lock · plugin API.

## Later
Prototype interactions · real-time collaboration (CRDT) · cloud sync (optional, self-hostable) · Figma plugin round trip · design-to-code for Vue/Svelte/Flutter/SwiftUI · animation/motion tools · design system generator from an existing codebase · VS Code extension that embeds the canvas · browser-hosted "lite" version.

## Dependency graph
0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> {7, 8} -> 9 -> 10 -> 11. Phases 7 and 8 can run in parallel; skills (9) can be drafted any time since they're markdown.

## Suggested milestones
| Milestone | Phases | What you can show |
|---|---|---|
| M1 "It draws" | 0-3 | Manual editor demo |
| M2 "Claude can design" | 4-6 | The headline demo: Claude Code edits the canvas, sees it, addresses pins |
| M3 "Works with just an API key" | 7-8 | Beginner path + code export |
| M4 "Launch 0.1" | 9-11 | Public release |

## Time reality check
Estimates assume Claude Code doing most of the typing with you reviewing, testing and directing. Real calendar time is dominated by: webview quirks, Tauri/OS packaging, code signing, and tuning agent quality. Reserve at least 25% of total time for polish and the eval loop.
