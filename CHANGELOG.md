# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Phase 4: persistence and sync. Projects are saved under `~/.atelier/projects/<id>/` (autosave
  within a quarter of a second, a rolling `.bak`, a project lock and compare-and-write so no writer
  can overwrite another's change), the open project and selection are published for agents by a
  native heartbeat, and changes made to the file by an agent or a script appear on screen as one
  undo step, merged property by property with unsaved edits. Projects dialog (Ctrl+O), import and
  export, recovery of damaged projects, agent request handling (`ping`, `get_selection`,
  `open_project`), confined Rust file commands each granted as a named permission,
  single-instance and window-state, a browser dev adapter sharing its code with the future MCP
  server, an NSIS installer, and a three-OS CI build. Verified by 28 Rust tests, 70 Node tests
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
