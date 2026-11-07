# Atelier

Open-source, local-first AI design studio. Let Claude Code, Codex, or an API-key chat design real UI on a canvas you can see, annotate and approve, then export it as code into your repo.

> Status: early development. Phase 0 (foundations) only; there is nothing to install yet. See [`docs/12-roadmap-and-phases.md`](docs/12-roadmap-and-phases.md).

## Develop

Requirements: Node 22.12+ (or 24), npm, and for the desktop shell Rust (MSVC toolchain on Windows) plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run dev        # UI in the browser at http://127.0.0.1:1420
npm run typecheck
npm run lint
npm test
npm run tauri:dev  # desktop shell (needs Rust)
```

Specs live in [`docs/`](docs/), standing rules for contributors and coding agents in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).

## Licence

MIT
