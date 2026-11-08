# 10. Import and Export

## Export

**Built (Phase 8).** One export core (`src/core/export/`) turns a node into files; the same code serves the Export dialog, the `export_code` tool and the tests. What it does, exactly:

- **One intermediate form** (`ir.ts`) built from `nodeToCss`, so the app, the HTML and both React flavours cannot drift apart. Colour tokens become `var(--color-NAME)`, fonts `var(--font-NAME)`, radii `var(--radius-NAME)`, defined once in `:root` (or the Tailwind `@theme`). A noise pattern is baked from literal colours.
- **Semantic output.** `role` picks `button`, `a`, `nav`, `section`, `ul > li`, `input`; heading text gets `h1`-`h6` by `props.level` or size rank; text inside a button or link is a `span`, other text a `p`; images are `img` with `alt` (a missing one is reported, not invented); icons are inline `svg` (`currentColor`, `aria-hidden` unless labelled). Hidden layers are not exported. Absolutely placed elements carry a comment suggesting auto-layout.
- **Names.** Class names come from layer names (kebab-case, `card`, `card-2`... in document order) and component names are PascalCase of the frame name (`componentName` overrides). The same design always gives the same bytes, so a re-export changes only what the design changed.
- **Three formats.** `html` (`index.html`, `styles.css`), `react-css` (`Name.tsx`, `Name.module.css`, `tokens.css`) and `react-tailwind` (`Name.tsx` with Tailwind v4 utilities, `theme.css` with `@import 'tailwindcss'` and an `@theme` from the tokens, `aframe.css` for what has no exact utility: gradients, patterns, shadows, filters). A declaration only becomes a utility when the mapping is exact; otherwise it stays verbatim in `aframe.css` on the same element, never guessed. Images are written to `assets/` and imported, never inlined. Every export carries `README-aframe.md` (files, the `@fontsource` package per font, hand-editing notes, warnings).
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
- Always include a short `README-aframe.md` in the output folder describing what was generated and what to hand-edit.

### Design tokens
CSS variables file, Tailwind theme snippet, JSON (Style Dictionary compatible). v0.2.

### Quality bar for exported code
- No inline pixel soup where tokens exist.
- Valid, formatted (Prettier via a tiny built-in formatter or do consistent string building), accessible (`alt`, `aria-label` for icon buttons, `button` not `div`).
- Round-trip sanity test: export -> render exported HTML in headless Chrome -> screenshot -> pixel diff vs the app's screenshot. Target < 2% difference on fixtures. This test is the single best guard against exporter drift.

## Import

**Built (Phase 10).** **Import** in the top bar (or the command palette) opens one dialog with four paths. Every import is one undo step and shows a report first: how many layers came across editable, which were changed a little, which were kept as a picture or placeholder, which were left out and why, and which colours repeat (token candidates).

| Path | What comes across | What does not |
|---|---|---|
| **SVG** (`core/import/svg.ts`) | viewBox as the frame size; rect, circle, ellipse, text (tspans on lines), groups as frames; fills, strokes, opacity, translate/scale/rotate; linear gradients (angle from the vector), radial approximated; pictures stored in the file | paths, polygons and diagonal lines are kept as an image of exactly that drawing (look right, not editable); `use`, CSS classes, filters, masks, clip paths, external pictures are reported and skipped; skew in a matrix is dropped. DOCTYPEs and entities are never expanded; scripts and `foreignObject` never run or travel into a kept drawing; limits on size, depth and element count |
| **Figma** (`core/import/figma.ts`) | frames, components and instances as frames (not linked), auto-layout (direction, gap, padding, alignment, wrap, hug/fill/fixed), text styles, solid and gradient fills, strokes with alignment, radii (per corner), drop and inner shadows, layer and background blur, opacity, rotation; vectors as the image Figma exports for them; image fills downloaded | variables and modes, prototype links, constraints, blend modes, masks, mixed-style text (the first style is used), multiple fills (the first is used), angular and diamond gradients (first colour), live boolean shapes. The report names each |
| **Web page** (`core/import/dom.ts`, `scripts/capture-dom.mjs`) | a prototype for starting from the app you already built: flex containers become auto-layout, evenly stacked blocks a column, the rest placed by coordinates; text, colours, radii, borders, shadows, form fields; the page title names the frame | pictures and inline SVG become grey placeholders (nothing is downloaded); sizes are fixed at the captured width (nothing is responsive); CSS grid, transforms, pseudo-elements, filters, background images |
| **Canva or an image** | the picture is added to the canvas, and the built-in assistant (or an external agent, with a sentence copied for you) is asked to rebuild it as editable frames, text and colours | Canva files cannot be opened by anyone else: the dialog says so and does not pretend otherwise |

How Figma is reached: the desktop app keeps your personal access token in the system keychain (same as AI keys) and its Rust side makes the requests (`src-tauri/src/figma.rs`): the file two levels deep for the frame list, then only the chosen frame, then the vectors as SVG and the image fills. The page asks for a short fixed list of requests built from validated pieces (file key, layer ids), never an address; downloads are https from Figma's own hosts only. A browser build cannot reach Figma but imports a saved file (`.json`).

**Proof and limits.** SVG: four fixtures (shapes, a gradient, nested transforms, a path) re-render within 0.00% of the original's pixels in Chrome, and 25 unit tests cover the mapping and hostile files. Figma: 17 unit tests against the hand-written sample (`fixtures/figma-sample.json`, which follows the public schema as best known) and invented edge cases; **no real Figma file has been imported**, so the "less than 20% manual fixing on three real frames" bar is untested, and nothing was run against the live Figma API (no token). Web page: a small demo page (nav, hero, button with shadow, three cards) imports with 1.8% of pixels different; real Vite and Next pages have not been tried, and the first thing they will need is better handling of CSS grid and images. The capture script needs Chrome or Chromium on the machine.


### Images / screenshots (MVP)
- Drag-drop / paste / file picker / MCP `import_image` -> asset + `image` node (or reference).
- "Rebuild as editable design": sends image to the agent (chat or external agent via a prompt) using the rebuild pipeline in doc 08. AFrame itself does **no** OCR/vision locally in MVP.

### SVG (v0.2)
Parse basic shapes (`rect`, `circle`, `ellipse`, `line`, `text`, simple `path` as image fallback), fills, strokes, groups -> frames. Complex paths: rasterise or keep as an SVG-asset image node.

### Figma
Facts to design around (verify current state before building):
- `.fig` is a proprietary binary: **not importable**; don't promise it.
- **Figma REST API** returns a JSON node tree for a file (needs a personal access token; the file key comes from the URL). Browser-origin CORS may block it -> do the request in Rust (`http_post/get` command) in Tauri.
- Figma also offers **Dev Mode / MCP-style tooling** for AI agents (check current docs). Practical power move: a user can run Figma's MCP and AFrame's MCP side by side; the agent reads the Figma frame and recreates it in AFrame with `apply_changes`. Document this as an official workflow with a prompt (`prompts/figma-to-aframe-prompt.md`).
- Converter mapping (v0.2): `FRAME`/`COMPONENT`/`INSTANCE` -> frame (auto-layout props map almost 1:1: `layoutMode`, `itemSpacing`, `padding*`, `primaryAxisAlignItems`, `counterAxisAlignItems`); `RECTANGLE`/`ELLIPSE` -> shapes; `TEXT` -> text (`style.fontFamily/fontSize/fontWeight/lineHeightPx/letterSpacing/textAlignHorizontal`); fills (SOLID, GRADIENT_LINEAR) -> fill; strokes, `cornerRadius`, `effects` (DROP_SHADOW, LAYER_BLUR); IMAGE fills -> fetch via images endpoint -> assets. Vectors/boolean ops -> rasterise via the images endpoint (`format=svg|png`). Unsupported: prototypes, variables mode switching, plugins, masks beyond simple clip.
- Show an **import report**: what converted, what was approximated, what was skipped.

### Canva
Facts: Canva's native format is closed; no general file import. Realistic routes:
1. **Export from Canva** as PNG/PDF/SVG -> import to AFrame -> **rebuild with AI** (works today, imperfect).
2. Canva's developer platform (Connect API / Apps SDK) may allow some design export via authorised app; requires app registration and terms review: treat as *Later*, do not block roadmap on it.
Be honest in the UI: "Canva designs come in as images and are rebuilt by AI."

### Website / HTML (v0.2, high value for vibe coders)
"Import from my running app": user supplies `http://localhost:3000` -> headless capture (screenshot + DOM/computed styles via a small Playwright/Chromium sidecar or Chrome DevTools Protocol) -> convert DOM to nodes (flex containers -> auto-layout, text, images). This directly serves the main audience: improve the UI of the app they just vibe-coded, then export back. Treat as a major v0.2 headline feature. Alternative cheaper MVP: agent takes screenshot of their running app via its own browser tools and uses rebuild pipeline.

### Round-trip with the user's codebase (vision)
Component export (React) + import from code (React/HTML) -> AFrame becomes a visual layer over the repo. Out of MVP scope; keep the exporter's naming deterministic so re-exports produce minimal diffs.
