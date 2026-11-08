# Phase 10: Import

**Read:** docs/10 (Import), docs/15 (risks 11), `prompts/figma-to-aframe-prompt.md`. **Verify current Figma REST API shapes and any Figma MCP/Dev Mode tooling before building.**

## Goal
Bring existing designs in honestly, with a clear report of what converted.

## Tasks
1. **Importer registry** `core/import/` (interface: `canImport`, `import(input) -> { nodes, assets, report }`); UI "Import" menu and drag-drop routing by file type.
2. **SVG importer**: rect/circle/ellipse/line/text/g, fills/strokes/opacity/transform (translate/scale only), simple paths -> image asset fallback, viewBox -> frame size.
3. **Figma REST importer**: UI to paste file URL + personal access token (stored like API keys), fetch via a Rust command (CORS), choose frames to import, map nodes per docs/10 (auto-layout props, text styles, fills, strokes, radius, effects), fetch image fills and vector fallbacks via the images endpoint, produce an **import report** (converted / approximated / skipped with reasons). Unit tests with recorded JSON fixtures (`fixtures/figma-sample.json`).
4. **Figma MCP side-by-side workflow**: document and test the prompt in `prompts/figma-to-aframe-prompt.md`.
5. **Canva path**: guided flow (export from Canva as PNG/PDF/SVG -> import -> "rebuild with AI") with honest copy; no pretend direct import.
6. **Import running app (spike)**: given `http://localhost:PORT`, capture screenshot and DOM/computed styles using headless Chrome (puppeteer-core/CDP; find system Chrome or prompt user) -> convert DOM to nodes (flex -> auto-layout, text, images, colours -> tokens suggestions). Timebox it; deliver a working prototype + notes on limits. Consider it a Phase 10b if it grows.
7. Rebuild-from-screenshot convenience: "Rebuild this image" button that opens chat (or copies a ready prompt for external agents) with the image attached and the pipeline from docs/08.

## Acceptance
- 3 real-world Figma frames (provided by the user, or public community files) import with a report and need < 20% manual fixing.
- SVG import fixtures pass visual diff within tolerance.
- Running-app import gives a usable starting frame for a standard Vite/Next page, or a documented reason why not.

## Report back with
Conversion coverage table, what Figma features are unsupported, and your recommendation on the running-app import's viability.
