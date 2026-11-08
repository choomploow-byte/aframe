# Contributing to AFrame

Thanks for helping! The easiest ways in, from lowest to highest effort:

1. **Write a skill** (`skills/community/*.md`): markdown design knowledge agents load on demand. See `skills/README.md`.
2. **Add a template / sample project** (JSON document + screenshot).
3. **Report a bug** with diagnostics (Help → Copy diagnostics, or `node ~/.aframe/mcp/aframe-mcp.mjs doctor`).
4. **Add an exporter or importer** (Vue, Svelte, SVG…): interfaces in `src/core/export` and `src/core/import`.
5. **Improve the editor or the core.**

## Dev setup
Prerequisites: Node 20+, Rust stable, Tauri OS prerequisites (https://tauri.app/start/prerequisites/).
```
npm install
npm run dev          # browser dev with a dev-only filesystem adapter
npm run tauri:dev    # full desktop app
npm test             # unit + MCP integration
```

## Ground rules
- Read `CLAUDE.md` (architecture + security rules) and `docs/20` (consistency checklist).
- Small PRs, conventional commits (`feat:`, `fix:`, `docs:`…), tests for core changes, screenshots/GIFs for UI changes.
- No new dependencies without a reason in the PR.
- For skills: include before/after results from the eval harness on at least 3 tasks.
- Be kind. Follow the Code of Conduct (Contributor Covenant).

## AI-assisted contributions
Welcome. You're responsible for what you submit: run it, read it, and make sure it follows the rules above.

## Security
Please report vulnerabilities privately via GitHub Security Advisories (see `SECURITY.md`), not in public issues.
