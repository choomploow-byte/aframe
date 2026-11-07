# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Changed
- Brand: the Atelier icon and wordmark (`brand/`) replace the placeholder square, and the accent is
  now purple everywhere: the interface (light and dark), the favicon, annotation pins in agent
  screenshots, the gradient editor's default and the starter tokens of a new project. Desktop
  icons were regenerated from `app-icon.png`.

### Added
- Asset library: your own folder of images (textures, halftones, sunbursts, particles...) kept in `~/.atelier/library/`, filled with `atelier-mcp library add <folder>`, searched and placed by agents with `search_library` and `use_library_asset` (a picture is stored in a project once however often it is used). Not part of the app or repository.
- Game-UI toolkit (decision log #79-#96; version 0.1.1 so installed apps refresh the MCP server): an **icon set** (165 solid icons in one style: coins, gems,
  keys, shields, stars, swords, potions, chests, arrows, close, check, settings and more; Font
  Awesome Free plus five drawn for Atelier) as a new `icon` node that takes a colour token, with
  `search_icons` and `place_icon`, and a labelled placeholder where a name is missing. **Display
  fonts** Lilita One, Luckiest Guy, Bungee and Fredoka with `list_fonts`; weights go to 900 where a
  family has them and a missing weight is never faked. **Pattern fills** (stripes, halftone,
  sunburst, noise) that follow the node's radius and clipping. **Effect presets** (`bevel-raised`,
  `bevel-pressed`, `gloss-top`, `inner-glow`, `hard-3d-bottom`, each with an intensity); text never
  gets a box shadow. **Reusable components** with `hover`, `pressed`, `disabled` and `selected`
  states, per-instance overrides, `define_component`, `create_instance` and `component_list`, and
  `screenshot` with a `state` (including `all`) so an agent can check every state. **Eight
  templates** (product landing, SaaS dashboard, mobile app, pricing page, game HUD, game shop, game
  inventory, blank), each with a token set and a component kit, in the New project dialog. Editing
  fixes: x/y on an auto-layout child now warns and names the parent layout, errors name the bad
  value and the correct form, ids work without `n_`. Six new lint rules. A `game-ui` skill. The
  motion preview (stretch goal) is not built.
- Phase 5: the MCP server and its installers. A single-file server (`mcp/dist/atelier-mcp.mjs`, MCP
  SDK v2, Node 20+) exposes 22 tools, resources and prompts: read and edit designs atomically
  (compare-and-write, safe beside the app and other agents), take screenshots of the live canvas
  (image plus a saved file for hosts that cannot show images; also when the window is minimised),
  read the user's selection, annotations and references, import images (images only, confined),
  lint, and manage projects. `install` / `uninstall` / `doctor` / `print-config` for Claude Code,
  Codex and Cursor (idempotent, backed up, never clobbers). The app embeds the server and installs
  it on launch, has a real Connect dialog (paste-in text with the true path, copy, connection test),
  a green pill while an agent is connected, an "An AI is editing" chip and a pulse on the nodes an
  agent changed. Verified with the built bundle and the real SDK client, the real `claude` CLI in an
  isolated config, an end-to-end test against the app in Chrome, and one against the production
  desktop window.
- Phase 4: persistence and sync. Projects are saved under `~/.atelier/projects/<id>/` (autosave
  within a quarter of a second, a rolling `.bak`, a project lock and compare-and-write so no writer
  can overwrite another's change), the open project and selection are published for agents by a
  native heartbeat, and changes made to the file by an agent or a script appear on screen as one
  undo step, merged property by property with unsaved edits. Projects dialog (Ctrl+O), import and
  export, recovery of damaged projects, agent request handling (`ping`, `get_selection`,
  `open_project`), confined Rust file commands each granted as a named permission,
  single-instance and window-state, a browser dev adapter sharing its code with the future MCP
  server, an NSIS installer, and a three-OS CI build. Verified by 28 Rust tests, 71 Node tests
  (including four separate processes writing one project and hard kills mid-write), a 23-case merge
  suite, a browser suite that also runs against the real window, a kill-the-real-app test and an
  install/launch/uninstall test.
- Fix: undo and redo could produce a revision equal to or older than the current one.
- Phase 3: the panels. Layers (tree, drag to reorder/reparent, rename, hide/lock, filter), a
  Design panel that exposes every document property with multi-selection "Mixed" values, gradient
  and shadow editors, a Tokens tab (edit, rename with reference rewrite, delete, create from
  selection), an Assets tab (image import by picker, drop and paste with magic-byte checks, use as
  reference), top bar, command palette (Ctrl+K), shortcut sheet (Ctrl+/), right-click menus,
  toasts with Undo, a welcome screen, font picker with previews and preloading, and a
  light/dark/system theme without a flash. New `set_tokens` tool. Navigation keys no longer get
  swallowed by canvas shortcuts, so keyboard users can Tab through the whole app. Browser tests for
  the panels also run against the real WebView2 window.
- Phase 2: the canvas editor. Zustand store with undo/redo (coalescing, transactions), a DOM renderer
  driven by `nodeToCss`, pan/zoom (wheel, pinch, space/middle/hand, fit, steps), a DOM-measured
  selection overlay, click/double-click/marquee selection, move with snapping guides, resize
  (shift/alt), auto-layout reorder with an insertion indicator, draw tools (frame, rectangle,
  ellipse, text) with device presets, inline text editing, copy/cut/paste/duplicate/delete, z-order,
  wrap in frame, add auto-layout, nudge, keyboard navigation, a shortcut registry, bundled font
  aliases and a debug HUD. New core helpers `extractSpec` (copy/paste) and `inferAutoLayout`.
  Browser tests: canvas interactions (real input), visual baselines, perf on 500/2000 nodes, also
  runnable against the real WebView2 window.
- Phase 1: pure core library in `src/core/` (types, ids, normalisation, tokens, validation, ops,
  atomic `applyChanges` with tempIds and warnings, `nodeToCss`, outline, migrations, document
  loading, and the `get_design` / `get_node` / `get_tokens` / `apply_changes` tool handlers) with
  213 unit tests, a real-Chrome layout probe (`npm run probe:css`) and a demo (`npm run demo:core`).
- Phase 0: repository foundations (Vite + React shell, strict TypeScript, ESLint, Prettier, Vitest,
  CI skeleton, Tauri 2 shell skeleton).
