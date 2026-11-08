# 03. Architecture

## 1. System overview

```
 ┌───────────────────────┐        MCP (stdio)        ┌──────────────────────────┐
 │ Claude Code / Codex / │ ────────────────────────► │  aframe-mcp.mjs         │
 │ Cursor / any MCP host │ ◄──────────────────────── │  (Node, bundled, 1 file) │
 └───────────────────────┘                           └────────────┬─────────────┘
                                                                  │ reads/writes files
                                                                  ▼
                                              ~/.aframe/  (doc JSON, requests/, responses/)
                                                                  ▲
                                                                  │ watches / writes (Tauri fs commands)
 ┌────────────────────────────────────────────────────────────────┴───────────┐
 │ AFrame desktop app (Tauri 2)                                              │
 │  ┌────────────── WebView (React + TS) ─────────────────────────────────┐   │
 │  │ Canvas renderer (DOM)  Layers  Properties  Annotations  Chat panel  │   │
 │  │ Zustand store ── core library (types, ops, tools, export, skills)   │   │
 │  │ Sync service (poll + atomic writes)  Agent loop (BYO API key)       │   │
 │  └──────────────────────────────────────────────────────────────────────┘   │
 │  Rust side: tiny fs commands scoped to ~/.aframe, dialog + fs plugins      │
 └─────────────────────────────────────────────────────────────────────────────┘
```

## 2. The key architectural move: one shared `core` library
A TypeScript package with **no DOM and no Node dependencies** used by *both* the app and the MCP server:
- `types.ts`: Document, Node, Annotation, Reference, Tokens
- `ops.ts`: pure functions: create/update/delete/move/duplicate (returning new docs)
- `apply.ts`: `applyChanges(doc, operations)` with validation and structured errors
- `style.ts`: `nodeToCss(node, parent, tokens)` used by the renderer *and* by the code exporter
- `tools.ts`: tool definitions (name, description, JSON schema) + handlers taking a `ToolContext`
- `export.ts`: HTML and React generators
- `lint.ts`: design linter
- `skills/`: skill text as TS string modules (so they bundle without file loaders)

`ToolContext` abstracts the environment:
```ts
interface ToolContext {
  getDoc(): Doc;
  commit(next: Doc, meta?: { source: 'agent'|'user'; label?: string }): void;
  screenshot?(opts: { nodeId?: string; scale?: number; annotations?: boolean }): Promise<{ pngBase64: string; width: number; height: number }>;
  getSelection?(): string[];
  readUserFile?(path: string): Promise<Uint8Array>;   // MCP only
  writeUserFiles?(root: string, files: Record<string,string>): Promise<string[]>; // MCP only (confined)
}
```
- **In the app** (chat agent): `getDoc/commit` hit the live Zustand store; `screenshot` calls html-to-image directly.
- **In the MCP server**: `getDoc/commit` read/write the doc file; `screenshot` writes a request file and waits for the app's response.

One tool implementation, two environments. This guarantees the chat agent and external agents behave identically.

## 3. Rendering approach
DOM nodes, one `div` per scene node, styles from `nodeToCss`. Rationale:
- Auto-layout is real CSS flexbox: what you see is exactly what the exported code does.
- Text rendering, wrapping, fonts and emoji are the browser's, so no custom text engine.
- Export to HTML/React is a tree walk.
- Screenshots via `html-to-image`.
Trade-offs: performance ceiling (thousands of nodes) and no GPU effects. Mitigate with per-node memoisation, viewport culling of off-screen top-level frames, and CSS `contain`. A WebGL/canvas renderer is a *Later* option behind the same scene graph.

Selection overlay: **measure the real DOM** (`getBoundingClientRect`) of the selected element and draw handles in screen space. This keeps handles correct under auto-layout, transforms and zoom.

## 4. State management
- Zustand store: `doc`, `selection`, `tool`, `viewport {x,y,zoom}`, `editingTextId`, `history`.
- Flat node map with structural sharing. An update copies the map shallowly and replaces only changed nodes. History stores prior `nodes` references (cheap).
- History entries coalesce rapid changes (drag, typing) by key + time window (300 ms).
- Agent edits are one history entry per `apply_changes` call, labelled (so "undo AI change" is one keystroke).

## 5. Persistence and sync
See `docs/06-file-sync-protocol.md`. Summary: one JSON file per project, atomic writes, a monotonically increasing `rev`, 400 ms polling of mtime in the app, request/response files for screenshots and selection queries. No sockets or ports.

## 6. Process model
| Process | Responsibility |
|---|---|
| Tauri Rust core | Window, installer, scoped fs commands, dialogs |
| WebView | All UI, store, rendering, in-app agent |
| `aframe-mcp.mjs` (spawned per agent session by the host) | MCP protocol, document tools, file bridge |

The MCP server is **not** started by the app. The agent host starts it (that's how MCP stdio works). It must work whether or not the app is open: read/write tools work on the file; `screenshot` needs the app and returns a clear error otherwise ("Open AFrame to take screenshots").

## 7. Packaging
- App ships the MCP bundle as an embedded string; on launch (and on "Connect") it writes it to `~/.aframe/mcp/aframe-mcp.mjs`, a stable path agents can reference, surviving app updates.
- Skills also written to `~/.aframe/skills/` and, on install, to `~/.claude/skills/aframe/SKILL.md`.
- Installers per OS via `tauri build`; CI matrix builds on GitHub Actions.

## 8. Extensibility seams (design now, build later)
- Node types registry (so components/variants/vector can be added).
- Exporter registry (`html`, `react-css`, `react-tailwind`, `vue`, `svelte`...).
- Importer registry (`image`, `svg`, `figma-json`...).
- Skills directory (user skills in `~/.aframe/skills/`).
- Provider registry for the in-app agent (Anthropic, OpenAI-compatible, Ollama).

## 9. Folder structure
```
aframe/
  package.json  vite.config.ts  tsconfig.json  index.html
  CLAUDE.md  AGENTS.md  README.md  LICENSE
  scripts/  build-mcp.mjs  test-mcp.mjs
  src/
    main.tsx  App.tsx  styles.css
    core/  types.ts ops.ts apply.ts style.ts tools.ts export.ts lint.ts tokens.ts ids.ts skills/*.ts
    store/  store.ts history.ts
    platform/  fs.ts (tauri | dev-http adapter)  files.ts (save/open)  paths.ts
    sync/  sync.ts requests.ts
    canvas/  Canvas.tsx NodeView.tsx Overlay.tsx interactions.ts snapping.ts
    panels/  Layers.tsx Properties.tsx Tokens.tsx Annotations.tsx References.tsx
    chat/  ChatPanel.tsx agent.ts providers/anthropic.ts providers/openai.ts
    dialogs/  Connect.tsx Settings.tsx Export.tsx
    ui/  (buttons, inputs, popovers, icons)
  mcp/  server.ts install.ts   (bundled to mcp/dist/aframe-mcp.mjs)
  src-tauri/  Cargo.toml tauri.conf.json build.rs capabilities/ src/{main.rs,lib.rs} icons/
  skills/  (markdown sources, mirrored into core/skills at build time)
  tests/  core/*.test.ts  e2e/*.mjs
  docs/
```
