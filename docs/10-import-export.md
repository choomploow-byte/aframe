# 10. Import and Export

## Export

**Built (Phase 8).** One export core (`src/core/export/`) turns a node into files; the same code serves the Export dialog, the `export_code` tool and the tests. What it does, exactly:

- **One intermediate form** (`ir.ts`) built from `nodeToCss`, so the app, the HTML and both React flavours cannot drift apart. Colour tokens become `var(--color-NAME)`, fonts `var(--font-NAME)`, radii `var(--radius-NAME)`, defined once in `:root` (or the Tailwind `@theme`). A noise pattern is baked from literal colours.
- **Semantic output.** `role` picks `button`, `a`, `nav`, `section`, `ul > li`, `input`; heading text gets `h1`-`h6` by `props.level` or size rank; text inside a button or link is a `span`, other text a `p`; images are `img` with `alt` (a missing one is reported, not invented); icons are inline `svg` (`currentColor`, `aria-hidden` unless labelled). Hidden layers are not exported. Absolutely placed elements carry a comment suggesting auto-layout.
- **Names.** Class names come from layer names (kebab-case, `card`, `card-2`... in document order) and component names are PascalCase of the frame name (`componentName` overrides). The same design always gives the same bytes, so a re-export changes only what the design changed.
- **Three formats.** `html` (`index.html`, `styles.css`), `react-css` (`Name.tsx`, `Name.module.css`, `tokens.css`) and `react-tailwind` (`Name.tsx` with Tailwind v4 utilities, `theme.css` with `@import 'tailwindcss'` and an `@theme` from the tokens, `atelier.css` for what has no exact utility: gradients, patterns, shadows, filters). A declaration only becomes a utility when the mapping is exact; otherwise it stays verbatim in `atelier.css` on the same element, never guessed. Images are written to `assets/` and imported, never inlined. Every export carries `README-atelier.md` (files, the `@fontsource` package per font, hand-editing notes, warnings).
- **Where it goes.** The desktop app saves into a folder the user picks in the system dialog (the page never names a path: `src-tauri/src/export.rs`); a browser build downloads the file, or a `.zip` for several (`zip.ts`, store-only, no dependency). An agent uses `export_code` / `export_image`, which write through `mcp/export-write.ts`. All three apply the same rules (`core/export/paths.ts`, mirrored in Rust): see docs/18.
- **Image export.** PNG at 1x/2x/3x with an optional transparent background (never shrunk, unlike `screenshot`; refused above 8192 px a side) and SVG. The SVG is the same picture as markup (`foreignObject`, fonts embedded): text stays live text, shapes are not converted to editable vector paths.
- **Proof.** `tests/e2e/export.mjs` exports the seven templates and the sample project's two screens in all three formats, builds the React ones with Vite (Tailwind v4 for that flavour) and type-checks them with `tsc` (zero errors), renders each in Chrome and pixel-diffs it against the canvas screenshot: worst difference 1.0% (the mobile template), mean 0.41%, threshold 2%. It also checks PNG size and transparency and that the SVG renders like the PNG. Not covered: a real project other than the Vite one used here, other bundlers, and macOS/Linux rendering.

Not built: component splitting and `.map()` over repeated siblings, design-token files (JSON, Style Dictionary), PDF, true vector SVG.

### PNG / SVG
- PNG: `html-to-image` `toPng` on the node's element; scale 1x/2x/3x; transparent background option.
- SVG: `toSvg` (foreignObject-based, so fidelity matches DOM). Note limitations: not editable vector paths. True vector SVG export of shapes+text is a v0.2 option via a dedicated serializer for simple trees.
- PDF: v0.2 via print-to-PDF of an isolated frame.

### HTML + CSS
`export.ts` walks the subtree, calling `nodeToCss`. Rules:
- Semantic tags from `role`: `button`, `a`, `nav`, `section`, `h1-h6` (heading by font size rank or explicit `props.level`), `p`, `img`, `input`.
- Layout frames -> `display:flex`; `gap`, `padding`, `align-items`, `justify-content` as designed.
- Absolute-positioned children inside `layout:none` frames -> `position:absolute` (flagged with a comment: "consider converting to auto-layout").
- Output: `index.html` + `styles.css` using CSS variables from tokens (`--color-primary`), class names from node names (kebab-case, de-duplicated with suffixes).
- Images: assets written to `assets/` instead of data URLs.

### React
Two flavours:
1. **react-css**: `Component.tsx` + `Component.module.css` (or plain CSS). Props for text content on nodes marked `props.editable`? (v0.2). MVP: static JSX.
2. **react-tailwind**: map CSS to Tailwind utilities with arbitrary values fallback (`gap-[24px]`) and tokens -> `tailwind.config` extension. Requires a mapping table; keep it small and correct; fall back to arbitrary values rather than guessing.
- Component name from the frame name (PascalCase). Sub-frames with `role: 'card'|'section'` can be split into sub-components when repeated (detect structurally identical siblings -> `.map()` over a data array; v0.2).
- Export writes into `outDir` only; refuses paths outside; never overwrites existing files without `overwrite: true` (returns the conflicts).
- Always include a short `README-atelier.md` in the output folder describing what was generated and what to hand-edit.

### Design tokens
CSS variables file, Tailwind theme snippet, JSON (Style Dictionary compatible). v0.2.

### Quality bar for exported code
- No inline pixel soup where tokens exist.
- Valid, formatted (Prettier via a tiny built-in formatter or do consistent string building), accessible (`alt`, `aria-label` for icon buttons, `button` not `div`).
- Round-trip sanity test: export -> render exported HTML in headless Chrome -> screenshot -> pixel diff vs the app's screenshot. Target < 2% difference on fixtures. This test is the single best guard against exporter drift.

## Import

### Images / screenshots (MVP)
- Drag-drop / paste / file picker / MCP `import_image` -> asset + `image` node (or reference).
- "Rebuild as editable design": sends image to the agent (chat or external agent via a prompt) using the rebuild pipeline in doc 08. Atelier itself does **no** OCR/vision locally in MVP.

### SVG (v0.2)
Parse basic shapes (`rect`, `circle`, `ellipse`, `line`, `text`, simple `path` as image fallback), fills, strokes, groups -> frames. Complex paths: rasterise or keep as an SVG-asset image node.

### Figma
Facts to design around (verify current state before building):
- `.fig` is a proprietary binary: **not importable**; don't promise it.
- **Figma REST API** returns a JSON node tree for a file (needs a personal access token; the file key comes from the URL). Browser-origin CORS may block it -> do the request in Rust (`http_post/get` command) in Tauri.
- Figma also offers **Dev Mode / MCP-style tooling** for AI agents (check current docs). Practical power move: a user can run Figma's MCP and Atelier's MCP side by side; the agent reads the Figma frame and recreates it in Atelier with `apply_changes`. Document this as an official workflow with a prompt (`prompts/figma-to-atelier-prompt.md`).
- Converter mapping (v0.2): `FRAME`/`COMPONENT`/`INSTANCE` -> frame (auto-layout props map almost 1:1: `layoutMode`, `itemSpacing`, `padding*`, `primaryAxisAlignItems`, `counterAxisAlignItems`); `RECTANGLE`/`ELLIPSE` -> shapes; `TEXT` -> text (`style.fontFamily/fontSize/fontWeight/lineHeightPx/letterSpacing/textAlignHorizontal`); fills (SOLID, GRADIENT_LINEAR) -> fill; strokes, `cornerRadius`, `effects` (DROP_SHADOW, LAYER_BLUR); IMAGE fills -> fetch via images endpoint -> assets. Vectors/boolean ops -> rasterise via the images endpoint (`format=svg|png`). Unsupported: prototypes, variables mode switching, plugins, masks beyond simple clip.
- Show an **import report**: what converted, what was approximated, what was skipped.

### Canva
Facts: Canva's native format is closed; no general file import. Realistic routes:
1. **Export from Canva** as PNG/PDF/SVG -> import to Atelier -> **rebuild with AI** (works today, imperfect).
2. Canva's developer platform (Connect API / Apps SDK) may allow some design export via authorised app; requires app registration and terms review: treat as *Later*, do not block roadmap on it.
Be honest in the UI: "Canva designs come in as images and are rebuilt by AI."

### Website / HTML (v0.2, high value for vibe coders)
"Import from my running app": user supplies `http://localhost:3000` -> headless capture (screenshot + DOM/computed styles via a small Playwright/Chromium sidecar or Chrome DevTools Protocol) -> convert DOM to nodes (flex containers -> auto-layout, text, images). This directly serves the main audience: improve the UI of the app they just vibe-coded, then export back. Treat as a major v0.2 headline feature. Alternative cheaper MVP: agent takes screenshot of their running app via its own browser tools and uses rebuild pipeline.

### Round-trip with the user's codebase (vision)
Component export (React) + import from code (React/HTML) -> Atelier becomes a visual layer over the repo. Out of MVP scope; keep the exporter's naming deterministic so re-exports produce minimal diffs.
