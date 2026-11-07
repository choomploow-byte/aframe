# Phase 0: Foundations

**Read:** docs/03, docs/11, docs/13, docs/14, CLAUDE.md.

## Goal
A clean repo with tooling, conventions and CI so every later phase has rails.

## Tasks
1. Create the repo layout from `docs/03-architecture.md` §9 (empty folders get a `.gitkeep`).
2. `package.json` from `templates/package.json` (verify and pin current versions; remove deps not needed yet). Use npm unless I say otherwise.
3. `tsconfig.json` (strict, `noUncheckedIndexedAccess`, path alias `@core/*`), `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx` showing a styled empty shell (top bar, left panel, canvas area, right panel) using the design language in `docs/07` (CSS variables for light/dark, Inter via fontsource).
4. ESLint (typescript-eslint) + Prettier config; `npm run lint`, `npm run format`.
5. Vitest configured; one trivial passing test.
6. Copy `CLAUDE.md`, `AGENTS.md`, `LICENSE`, `CONTRIBUTING.md` to the root; create `README.md` stub (pitch + dev instructions), `CHANGELOG.md`, `docs/` (copy from kit).
7. GitHub: `.github/workflows/ci.yml` from `templates/github/ci.yml`, issue and PR templates.
8. Initialise git, `.gitignore` (node_modules, dist, target, .atelier-dev), first commit.
9. `scripts/` folder with placeholders: `build-mcp.mjs`, `test-mcp.mjs`.

## Acceptance
- `npm install && npm run dev` serves the shell, themed light/dark via `prefers-color-scheme`.
- `npm run typecheck`, `npm run lint`, `npm test` all pass.
- Folder structure matches the architecture doc.

## Report back with
What you pinned (versions), anything you changed from the templates, and how to run it.
