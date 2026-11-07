# Phase 3: Panels and Polish

**Read:** docs/07 (all), docs/04 (every property must be editable), docs/19 (a11y of the editor).

## Goal
A non-designer can build and tweak a screen by hand, in a UI that feels calm and premium.

## Tasks
1. **Design system for the app UI** (`src/ui/`): buttons, icon buttons, inputs, number-scrub field (drag, arrows, math), select, segmented control, toggle, tabs, popover, tooltip, context menu, dialog, toast (with action), colour field with popover. CSS variables for light/dark exactly per docs/07. Icons: Lucide.
2. **Layers panel**: tree with expand/collapse, rename (double-click/F2), eye/lock toggles, drag to reorder/reparent with drop indicators, selection sync, search filter, type icons. `role="tree"` a11y.
3. **Properties panel**: sections per docs/07 (Layout, Auto-layout, Fill, Stroke, Effects, Typography, Image, Role/Name). Multi-selection shows mixed values. Sizing-mode dropdowns (Fixed/Hug/Fill). Token-aware pickers (swatch list first). Gradient editor (2-stop linear/radial is enough).
4. **Tokens tab**: edit colours/fonts/spacing/radii; "extract from selection" helper (create token from a node's colour); show usage counts.
5. **Assets tab**: import images (picker, drag-drop, paste), thumbnails, insert onto canvas, mark as reference (Phase 6 completes the reference UI).
6. **Top bar**: project name (editable), theme toggle, undo/redo, zoom control, export menu stub, "Connect AI" pill (stub opens a placeholder dialog).
7. **Command palette** (Ctrl+K) reusing the shortcut registry. **Shortcut sheet** (Ctrl+/).
8. **Fonts**: bundled families selectable with live preview; ensure they load before first paint of text (font loading API) so measurement and screenshots are correct.
9. **Empty/first-run states** written with care, including a sample project loader.
10. A11y pass on editor chrome (focus rings, roles, labels, live regions).

## Acceptance
- You can hand-build a landing hero (nav, headline, subhead, two buttons, image card) in under 5 minutes using only panels + canvas, using auto-layout and tokens.
- Every property in docs/04 is reachable in the UI.
- Light and dark themes look intentional; no layout shift or unstyled flashes on load.
- Keyboard-only: you can select layers, change fill, rename and delete without a mouse.

## Report back with
Screenshots of light and dark themes (use puppeteer), list of shortcuts implemented, and any panel you simplified.
