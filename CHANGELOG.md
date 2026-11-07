# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Phase 1: pure core library in `src/core/` (types, ids, normalisation, tokens, validation, ops,
  atomic `applyChanges` with tempIds and warnings, `nodeToCss`, outline, migrations, document
  loading, and the `get_design` / `get_node` / `get_tokens` / `apply_changes` tool handlers) with
  213 unit tests, a real-Chrome layout probe (`npm run probe:css`) and a demo (`npm run demo:core`).
- Phase 0: repository foundations (Vite + React shell, strict TypeScript, ESLint, Prettier, Vitest,
  CI skeleton, Tauri 2 shell skeleton).
