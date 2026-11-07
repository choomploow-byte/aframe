# Phase 2: Canvas Renderer and Interactions

**Read:** docs/03 §3-4, docs/07 (canvas interactions), docs/19 (performance), docs/04 layout semantics.

## Goal
Load a document and manipulate it directly with great feel.

## Tasks
1. **Store** (`src/store/store.ts`, Zustand): `doc`, `selection`, `tool`, `viewport`, `editingTextId`, `hover`. Actions call core ops; history (`history.ts`) with transactions + coalescing keys (drag, nudge, typing) and labels; undo/redo.
2. **NodeView**: memoised recursive renderer using `nodeToCss`; `data-node-id`; images via asset data URLs; text rendered via text nodes (no innerHTML). Page renders top-level frames at `x,y`.
3. **Viewport**: pan (space-drag, middle mouse, wheel/trackpad), zoom to cursor (ctrl+wheel/pinch), fit-all, fit-selection, 100%. Transform applied on the world layer only.
4. **Overlay layer** (screen space): selection boxes and 8 resize handles from DOM `getBoundingClientRect`, hover outline, multi-select box, size label, parent highlight while moving, snapping guides.
5. **Selection**: click, shift-click, marquee, double-click to enter/edit, Esc to step out, Tab/Shift+Tab sibling navigation.
6. **Move/resize/nudge** for nodes whose parent is `layout:none`/page. For children in auto-layout frames: drag shows an insertion indicator and reorders; resize sets fixed size on that axis.
7. **Create tools**: Frame (F), Rectangle (R), Ellipse (O), Text (T, click-to-type), Image placeholder (I opens picker in Phase 3), drag-to-draw with live size readout. Device presets menu.
8. **Inline text editing**: contentEditable overlay positioned over the node; commit on blur/Esc; preserve newlines.
9. **Clipboard + edit ops**: copy/cut/paste (paste into selected frame or at cursor), duplicate (Ctrl+D, alt-drag), delete, bring forward/back, wrap-in-frame (Ctrl+G), add auto-layout (Ctrl+Alt+A) which infers direction/gap from child arrangement.
10. **Snapping**: sibling/parent edges and centres, 6px threshold in screen space, guides + distance hints (basic is fine).
11. **Keyboard shortcuts** per docs/07 with a registry so the command palette can reuse it later.
12. Load `fixtures/sample-doc.json` on startup in dev; add a dev-only "generate 500 nodes" action for perf checks.
13. Tests: store/history unit tests; one e2e (puppeteer-core + system Chrome): draw a frame, add a rectangle, move it, undo, redo.

## Acceptance
- 500-node doc pans/zooms/drags at ~60fps (measure and report numbers).
- Undo/redo works for every action above, including text edit and auto-layout add.
- Auto-layout frames reflow immediately as children are added/reordered/resized.
- Selection handles remain exact at all zoom levels and inside flex layouts.

## Report back with
Perf measurements, known interaction gaps, and the overlay measurement approach you used (and any pitfalls).
