# 19. Performance and Accessibility

## Performance plan

### Rendering
- `NodeView` is `React.memo`'d by node object identity. Because updates replace only changed nodes (structural sharing), unchanged subtrees skip re-render.
- Per-node subscription: `useStore(s => s.doc.nodes[id])` with `Object.is`; parent passes only `id`.
- Viewport culling: don't mount top-level frames fully outside the viewport + margin; render a lightweight placeholder (name + size outline) instead. Remount on entering viewport.
- CSS: `contain: layout paint style` on frames; `will-change: transform` only on the world layer during pan/zoom; avoid `filter`/`backdrop-filter` unless the node uses them.
- Zoom via a single CSS `transform: translate(...) scale(...)` on the world layer (never re-layout nodes). Text may blur at fractional zoom: acceptable; consider `zoom`-aware snapping to device pixels at 100%.
- Selection overlay and guides live in a separate absolutely-positioned layer in screen space, updated via `requestAnimationFrame`, reading rects in batch (avoid layout thrash: read all, then write).
- Large images: store original asset, display a downscaled blob URL; revoke on unmount.

### State
- History entries share structure; cap at 200 entries or 50 MB equivalent; coalesce drags/typing.
- `assets` map excluded from history diffing and from `get_design` output.
- Debounced persistence; serialise off the main thread if > 5 MB (Web Worker).

### Sync
- Poll cost is one `stat` per 400 ms (cheap). Only read/parse the file when mtime changes. Use `structuredClone`-free merge.
- Large docs: consider storing assets as separate files and a per-frame split in v0.2.

### MCP outputs
- Outline mode default; depth and node caps (`maxNodes: 300`) with `truncated: true` and guidance ("call get_design with nodeId to expand").
- Screenshots capped at 1600 px longest side (configurable), JPEG fallback if PNG > 4 MB.

### Measurement
`performance.mark` around render/commit/sync; a hidden debug HUD (Ctrl+Alt+D) showing fps, node count, commit time. Benchmarks in CI with a generated 2,000-node doc.

## Accessibility: two separate concerns

### 1. Accessibility of the editor (Atelier's own UI)
- Full keyboard operability: tab order across panels; arrow keys in layer tree; Enter to rename; Esc to exit modes.
- Roles/labels: `role="tree"` for layers, `aria-selected`, `aria-expanded`; buttons have accessible names; toolbars `role="toolbar"`.
- Focus-visible styles in accent colour with 2px offset; never remove outlines.
- Contrast AA for all UI text in both themes; don't convey status by colour alone (icons + text).
- Respect `prefers-reduced-motion` and `prefers-color-scheme` (default theme = system).
- Screen-reader announcements (`aria-live=polite`) for "AI updated 12 layers", "Annotation resolved".
- Text scaling: UI uses rem; test at 125%/150% OS scaling on Windows.

### 2. Accessibility of what Atelier produces (core product value for vibe coders)
- `lint_design` contrast, text-size, tap-target rules (doc 13).
- Exporters emit semantic HTML (`button`, `nav`, `main`, headings in order), `alt` text, `aria-label` for icon-only controls, visible focus styles in generated CSS, `lang` attr.
- Skill `accessibility.md` teaches agents to design with these constraints first.
- Heading level inference with a warning when skipping levels.
- Colour-blind safe palette suggestions in tokens skill (don't rely on red/green alone).

## Internationalisation (note for later)
UI strings in a single `strings.ts` from day one to make i18n possible. Text nodes support RTL via `dir` property (v0.2). Bundled fonts must include Latin Extended at least; consider Noto subsets later.
