# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
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
