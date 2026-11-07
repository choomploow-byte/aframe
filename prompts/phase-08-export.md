# Phase 8: Export

**Read:** docs/10 (Export), docs/04 (layout semantics), docs/18 (confinement), docs/13 (round-trip test).

## Goal
Designs land in the user's repo as clean, accessible, believable code.

## Tasks
1. **Exporter registry** `core/export/` with `html`, `react-css`, `react-tailwind`; shared tree-walker producing an intermediate representation (tag, attrs, classNames, styles, children, text) from nodes via `nodeToCss`, so each target only formats output.
2. **Semantics**: tags from `role`, heading levels from size rank/`props.level`, `button`/`a`/`nav`/`section`/`ul>li` detection for repeated siblings, `img` with `alt` from `props.alt`, `aria-label` for icon-only controls, `lang`.
3. **Names & classes**: kebab-case from node names, de-duplicated, stable across re-exports (deterministic ordering, minimal diffs).
4. **Tokens**: emit CSS variables (`:root{--color-primary:...}`) and reference them; Tailwind exporter emits a `tailwind.config` snippet and utilities with arbitrary-value fallbacks; never guess a mapping you can't prove.
5. **Assets**: write images to `assets/` with sensible filenames; no giant data URLs in code.
6. **`export_code` tool**: confined writes (docs/18), conflict reporting, `overwrite` flag, returns file list + preview; generates `README-atelier.md` in the output.
7. **UI**: Export dialog (format picker, target folder picker, preview of main file with copy), "Copy as code" and "Copy as image" in the context menu, PNG/SVG export at 1x/2x/3x, transparent bg option.
8. **Round-trip test**: for each fixture frame: export HTML -> render in headless Chrome at the frame's size -> screenshot -> pixel diff vs canvas screenshot (pixelmatch); fail > 2%. Also compile-check React output inside a minimal Vite template in CI.
9. Docs: `docs/export-guide.md` explaining output structure and how to hand-edit.

## Acceptance
- All fixtures pass the 2% round-trip threshold (report actual numbers).
- Generated React builds with `vite build` in a temp project with zero TS errors/warnings.
- Attempts to write outside `outDir` (including via `..` and symlinks) are rejected (tests).

## Report back with
Pixel-diff numbers, example generated output for the sample landing page, and known fidelity gaps.
