# 07. UI / UX Specification

## Design language: "calm, warm, restrained" (think the Claude app, not Figma's density)
- **Palette (light):** background `#FAF9F5`, panels `#FFFFFF`, borders `#E8E6DC`, text `#1F1E1D`, muted `#6B6A65`, accent `#C96442` (single accent, used sparingly), selection blue-free: use accent for selection outlines. Canvas background `#F0EEE6` with a very faint dot grid.
- **Palette (dark):** background `#262624`, panels `#30302E`, borders `#41403B`, text `#F5F4EE`, muted `#A3A29B`, same accent.
- **Type:** UI in Inter (or system UI), 13px base, 12px for dense panels; serif (Fraunces) only for empty states/onboarding headlines.
- **Shape:** 8px radius controls, 12px panels/dialogs, 1px borders, soft shadows only on floating elements.
- **Motion:** 120-180 ms ease-out; no bouncy animations; respect `prefers-reduced-motion`.
- **Density:** few panels, generous padding, icon + label only where unclear. No toolbars with 30 icons.

## Layout
```
┌────────────────────────────────────────────────────────────────────────────┐
│ ▢ Atelier   Project name ▾            [Share/Export ▾]  [Connect AI ●]  ☾  │  top bar (44px)
├───────────┬────────────────────────────────────────────┬───────────────────┤
│ Layers    │                                            │ Properties        │
│ (tree)    │              CANVAS                        │ (context-aware)   │
│           │                                            │                   │
│ Assets /  │   [floating toolbar: V F R O T I A]        │  tabs: Design |   │
│ Tokens    │   [zoom: 100% ▾]                           │  Annotations |    │
│ tabs      │                                            │  Chat             │
└───────────┴────────────────────────────────────────────┴───────────────────┘
```
- Left panel (240px, collapsible): **Layers** tab, **Assets** tab (images, references), **Tokens** tab.
- Right panel (300px, collapsible): **Design** (properties), **Notes** (annotations list), **Chat** (inbuilt AI).
- Floating bottom-centre toolbar over the canvas (rounded pill): Select (V), Frame (F), Rectangle (R), Ellipse (O), Text (T), Image (I), Annotate (A), Hand (H). Keyboard hints in tooltips.
- Top-right **Connect AI** pill: green dot when an MCP agent was seen recently, grey otherwise. Opens the Connect dialog.
- Status chip bottom-left: "Claude Code is editing..." while `lastWriter === 'mcp'` changed in the last 3 s (with a subtle accent pulse on changed nodes).

## Canvas interactions
- Pan: space+drag, middle mouse, two-finger scroll. Zoom: ctrl/cmd+wheel, pinch, `+`/`-`, `Shift+1` fit all, `Shift+2` fit selection, `Ctrl+0` 100%.
- Select: click; shift-click to add; marquee on empty canvas; double-click enters a frame / edits text; `Esc` steps up the hierarchy or clears selection.
- Move: drag; arrows nudge 1px, shift+arrows 10px; alt-drag duplicates. Children of auto-layout frames are **not** free-dragged; dragging shows an insertion indicator to **reorder** within the frame (v0.2: reparent).
- Resize: 8 handles on the DOM-measured box; shift keeps ratio; alt resizes from centre. In auto-layout frames, resizing a child switches its axis to fixed.
- Create: drag with the tool to draw; click to create default size; text tool: click and type.
- Snapping: edges/centres of siblings and parent, 6 px threshold, magenta-free guides in accent colour; distance labels on alt-hover.
- Frame presets popover: Desktop 1440x900, Laptop 1280x800, Tablet 820x1180, Mobile 390x844.
- Right-click context menu: duplicate, delete, group-in-frame, add auto-layout, bring forward/back, copy as code, copy as image, "Ask AI about this...".

## Properties panel (context-aware sections)
Layout (x/y/w/h with sizing mode dropdowns hug/fill/fixed, rotation later) · Auto-layout (direction, gap, padding, align, justify, wrap) · Fill · Stroke · Effects (shadow, blur) · Typography (text only) · Image (fit) · Export (PNG/SVG/code) · Role/name.
Colour picker: swatches from tokens first, then custom; hex input; eyedropper (where supported). Number fields support drag-to-scrub, arrows, and math (`16*2`).

## Annotations (the "point at it" feature)
- Tool `A`: click to drop a numbered pin, or drag for a region. Inline popover to type the comment. Enter to save.
- Pins render in an overlay (not part of the design, excluded from exports and screenshots unless `annotations:true`).
- **Notes** tab lists all pins with status chips; click to focus; resolve/unresolve; show agent replies.
- Button: **"Ask AI to address N open notes"**: in-app chat sends them; for external agents, copies the prompt "in atelier, address the open annotations".
- Pin colours: open = accent, resolved = muted check.

## References
- Assets tab > **References**: drop images/screenshots, or paste from clipboard; each has a note and scope (style / layout / everything).
- Side-by-side compare view: toggle shows reference beside the selected frame, or an overlay with opacity slider (for pixel-matching layouts).

## Chat panel (inbuilt AI)
- Message list with: assistant text, collapsible **tool activity** rows ("Updated 12 nodes", "Took screenshot") and inline screenshots the agent looked at.
- Composer: multi-line, attach image (paste/drag), `@` to mention a layer or reference, model picker, **Stop** button.
- Empty state: 4 suggested prompts ("Improve the selected frame", "Match this reference", "Make it mobile", "Critique my design").
- If no API key: friendly empty state with two paths: "Paste an API key" or "Connect Claude Code instead".
- Every agent turn = one undo step ("Undo AI change" shown as a toast action for 8 s).

## Connect dialog (the install experience)
Tabs: **Claude Code** · **Codex** · **Cursor / other**.
1. Big copyable block: *"Paste this into Claude Code"*: a single natural-language prompt (see `prompts/user-install-prompt.md`) that makes the agent run the install command and confirm.
2. Or the exact one-liner for people who prefer the terminal.
3. **Test connection** button: waits for a tool call from an agent (looks at `state.json.lastAgentSeen`) and shows a green "Connected: try: *in atelier, improve my design*".
4. Collapsible "What does this do?": plain-language explanation and the file paths touched.

## Onboarding
First launch: warm full-window welcome (serif headline): **"Design with your AI."** Three paths: *Connect Claude Code/Codex*, *Use an API key*, *Just explore* (opens a sample project). Skippable. Sample project demonstrates auto-layout and tokens.

## Empty & error states (must be written, not left default)
Empty canvas hint, no annotations, agent offline, API error (with human text: "Your API key was rejected. Check it in Settings"), file corrupted (offer restore from `.bak`), MCP version mismatch.

## Keyboard shortcuts (initial)
V F R O T I A H tools · Ctrl+Z/Shift+Z · Ctrl+C/V/D · Del · Ctrl+G wrap in frame · Ctrl+Alt+A add auto-layout · Ctrl+K command palette · Ctrl+/ shortcut sheet · Ctrl+Shift+E export · Ctrl+L focus chat.

## Command palette (Ctrl+K)
Fuzzy list of actions (all tools, export formats, theme, open project, connect). Cheap to build, big perceived-quality win.

## Accessibility of the editor itself
Keyboard-reachable panels, visible focus rings (accent), ARIA roles on layer tree (`tree`/`treeitem`), contrast AA for UI text, reduced motion.
