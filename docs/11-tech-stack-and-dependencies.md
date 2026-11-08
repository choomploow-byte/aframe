# 11. Tech Stack and Dependencies

> **Pinned reality (2026-11-07, decision log #12-#15):** React 19, Vite 8, Vitest 5, ESLint 10, TypeScript ~6.0 (typescript-eslint does not support 7 yet), zod 4, zustand 5, MCP SDK v2, Tauri 2.x (never the 3.0 alphas), no `tauri-plugin-fs`. The table below is the original intent; `package.json` is authoritative.

## Dependency log (why each package is here)
| Package | Added in | Reason |
|---|---|---|
| `react`, `react-dom`, `@fontsource-variable/inter`, `@fontsource-variable/fraunces` | Phase 0 | UI and the editor's own type |
| `zod` | Phase 1 | Tool input schemas shared with the MCP server; `z.toJSONSchema()` feeds MCP and LLM providers |
| `tsx` (dev) | Phase 1 | Runs the TypeScript demo/probe scripts that import `src/core` |
| `pngjs`, `pixelmatch` (dev) | Phase 1 / 2 | Pixel checks in `scripts/css-probe.ts` and the visual-regression baselines |
| `zustand` | Phase 2 | The editor store (`doc`, selection, tool, viewport, history); tiny, no provider needed |
| `lucide-react` | Phase 2 | Toolbar and top-bar icons, tree-shaken |
| `@fontsource-variable/dm-sans`, `space-grotesk`, `playfair-display`, `jetbrains-mono` | Phase 2 | The bundled design fonts listed below; registered as plain-name aliases by `scripts/gen-fonts-css.mjs` |
| `puppeteer-core` (dev) | Phase 0 | Browser tests against system Chrome and the WebView2 window |
| `@tauri-apps/api` | Phase 4 | The official IPC wrapper (`invoke`, `listen`) the Tauri file adapter uses; imported lazily so the browser dev build never loads it |
| Rust `serde`, `serde_json` | Phase 4 | Serialising `app-state.json` and the command results; reading only the `rev` field of a project file during a compare-and-write |
| Rust `dirs` | Phase 4 | The user's home directory for `~/.aframe` (the one platform detail not worth hand-rolling) |
| Rust `tauri-plugin-single-instance` | Phase 4 | A second launch focuses the running window; two apps on one home would fight over the same files. Registered first, as its docs require |
| Rust `tauri-plugin-window-state` | Phase 4 | Remembers window size and position between runs |
| `@modelcontextprotocol/server`, `@modelcontextprotocol/client` | Phase 5 | The MCP SDK v2 (stable line, Node 20+, zod 4): the server is bundled into `aframe-mcp.mjs`; the client is a dev dependency used by the integration and live tests (it is the same code hosts use). Verified by a spike before anything was built on it |
| `esbuild` (dev) | Phase 5 | Bundles the server and its dependencies into one file |
| `html-to-image` | Phase 5 | Rasterises cloned artboards for the `screenshot` tool. Last released April 2025: a known risk, mitigated by cloning into a controlled container, a timer for animation frames, and the real-window test; a native capture is the documented fallback |
| `@fontsource/lilita-one`, `@fontsource/luckiest-guy`, `@fontsource/bungee`, `@fontsource-variable/fredoka` | Game-UI toolkit | The display families for game UI (SIL OFL 1.1, except Luckiest Guy which is Apache 2.0), registered as plain-name aliases by `scripts/gen-fonts-css.mjs` (woff2 only for the static ones) |
| `@fortawesome/free-solid-svg-icons` (dev) | Game-UI toolkit | Build-time source of the icon paths: `scripts/gen-icons.mjs` copies a curated selection into `src/core/icon-data.ts`; nothing from it is imported at run time. Icons CC BY 4.0, attributed in `THIRD-PARTY-NOTICES.md` |
| `tsx` (dev, already present) | Phase 4 | Also runs the persistence e2e and the writer child process, which import the TypeScript file module directly |

Versions below are the *intended major versions at time of writing*. Claude Code must run `npm view <pkg> version` / check docs and pin what's current and compatible; don't blindly trust these numbers.

## Prerequisites on the developer machine
| Tool | Version | Why |
|---|---|---|
| Node.js | 22.12+ or 24 | Build and test (Vitest 5 / Vite 8 need >= 22.12). MCP server runtime: users need Node 20+ to run the MCP bundle |
| npm (or pnpm) | 10+ | Package manager. Pick one, document it. pnpm recommended for the workspace |
| Rust (stable) + cargo | latest stable | Tauri backend |
| Windows | WebView2 runtime (preinstalled on Win 10/11 recent), MSVC Build Tools ("Desktop development with C++") | Tauri build |
| macOS | Xcode Command Line Tools | Tauri build |
| Linux | `webkit2gtk-4.1`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`, `libssl-dev`, `patchelf` | Tauri build (check Tauri's current prerequisites page) |
| Chrome/Chromium | any recent | E2E tests / screenshot round-trip tests (puppeteer-core) |
| Python 3 + Pillow | optional | Icon generation script |

## Frontend runtime dependencies
| Package | Purpose |
|---|---|
| `react`, `react-dom` 18 | UI |
| `zustand` 4/5 | Store |
| `html-to-image` | DOM -> PNG/SVG for screenshots/export |
| `@fontsource-variable/inter`, `dm-sans`, `space-grotesk`, `fraunces`, `playfair-display`, `jetbrains-mono` | Bundled fonts (offline, consistent rendering and export). Add more later |
| `lucide-react` (or lucide static SVGs) | UI icons + design icon library (v0.2) |
| `@tauri-apps/api` 2 | invoke/commands |
| `@tauri-apps/plugin-dialog` | Folder picker for code export (Phase 8). `plugin-fs` is deliberately not used (decision log #16) |
| `zod` | Tool input validation (shared with MCP) |
| `immer` (optional) | Not needed if ops are written with explicit shallow copies |

## MCP server dependencies (bundled, so not required at user runtime)
| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | Server, stdio transport, types |
| `zod` | Schemas (SDK uses it) |

## Dev dependencies
`typescript` 5, `vite` 5/6, `@vitejs/plugin-react`, `esbuild` (bundle MCP), `@tauri-apps/cli` 2, `vitest` (unit tests), `puppeteer-core` (e2e with system Chrome), `eslint` + `typescript-eslint`, `prettier`, `@types/node`, `@types/react*`.

## Rust crates (src-tauri)
`tauri` 2, `tauri-build` 2, `tauri-plugin-dialog` (Phase 8), `serde`, `serde_json`, `dirs` (home dir), optional `reqwest` or `tauri-plugin-http` (CORS fallback + Figma API), optional `keyring` (API keys v0.2), `tauri-plugin-updater` (v0.2), `tauri-plugin-single-instance`, `tauri-plugin-window-state`.

## Why these choices (and alternatives considered)
| Choice | Alternatives | Reason |
|---|---|---|
| Tauri 2 | Electron; native Rust UI (egui/Slint); Qt | Small native installers + web UI productivity. Fully native canvas editors are 5-10x the work (text editing, layout, images). Electron is the fallback if webview inconsistencies bite |
| DOM renderer | Canvas2D / WebGL (PixiJS, Konva), tldraw/Excalidraw core | DOM = free layout/text/export. Konva/Pixi only if perf demands (Later) |
| Zustand | Redux, Jotai, Valtio | Simple, fast, tiny |
| MCP stdio bundle | HTTP MCP server inside the app | Stdio is universal, no ports, zero-config, hosts spawn it themselves |
| File-based bridge | WebSocket/local HTTP | No port clashes, multi-session safe, debuggable by reading files |
| esbuild | tsup, rollup | One-file output with zero config |
| html-to-image | dom-to-image-more, Puppeteer/Chromium sidecar | Works in-webview, no sidecar. Known quirks with fonts/Safari-WebKit: test; sidecar is the fallback |

## Platform webview differences (test early!)
Windows = WebView2 (Chromium), macOS/Linux = WebKit. `html-to-image` and some CSS (e.g. `backdrop-filter`, `gap` in old WebKit, font metrics) can differ. Keep a cross-platform screenshot fixture test in CI (Linux+Windows+macOS runners). If WebKit fidelity is a blocker for screenshots, add an optional Chromium-based renderer sidecar for screenshots only.

## Monorepo or not?
Single package for MVP; `core/` as an internal folder imported via relative paths by app and MCP bundle. If/when publishing `aframe-mcp` and `@aframe/core` to npm, convert to pnpm workspaces: `packages/core`, `packages/mcp`, `apps/desktop`.

## Scripts (package.json)
`dev` (vite), `build:mcp` (esbuild), `typecheck`, `test`, `test:e2e`, `tauri:dev`, `tauri:build`, `icons`, `lint`, `format`.

## Licence compatibility
All listed deps are MIT/Apache-2.0/OFL (fonts: SIL OFL). Keep a `THIRD_PARTY_NOTICES.md` generated in CI. Bundled fonts must remain OFL-compatible; include licence texts.
