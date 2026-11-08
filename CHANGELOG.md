# Changelog

All notable changes are recorded here. Format: [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

## [0.6.0] - 2026-11-08 (pre-release)

### Added

- **Nested components**: a component can hold instances of other components (a card with a Buy button). Changing the inner component updates every card; a card instance can override the button, and a card state can restyle it. Loops are refused.
- **Interactive preview** (Preview button, Alt+P): components react to hover and press, tabs and slots select, `#Name` links go to frames or show panels, with state changes animated. Your design and undo history are untouched.

## [0.5.0] - 2026-11-08 (pre-release)

### Added

- **Beta features** in Settings: a master switch and one switch per feature (everything off by default); a feature that is off is fully hidden, including its AI tools.
- **Pixel Art Editor (beta)**: draw on a palette-indexed grid (16, 32, 64 or custom up to 128), with pencil, eraser, fill, line, rectangle, colour picker, mirror draw, grid, zoom and pan, undo as one step per stroke, a palette editor, PNG export at a whole-number scale, JSON save and open, and an AI bar (Improve, Add shading, Clean up outline, Generate from prompt). Agents get nine `pixelart_` tools that draw on the live canvas.
- Shared text styles, a Roblox ScreenGui export, `compare_reference` (match percentage, worst regions and a difference picture; a Difference blend and Measure button in compare mode), lint exemptions (`props["lint-ignore"]` and an Intentional button), and screenshots that wait for the agent's latest edit.

### Fixed

- Shared text styles were lost when the sync merged a project.
- Tests that failed on macOS and Linux (the export folder guard, the missing credential store, lock waits).

## [0.4.0] - 2026-11-08 (pre-release)

### Added

- Game-UI tools for the AI: `create_widget` (16 finished, token-styled controls such as chunky buttons, currency pills, progress bars, item slots, shop cards, panels, modals, tabs), `list_themes` / `apply_theme` (7 game palettes), `arrange_nodes` (align, distribute, grid, match size), `group_nodes`, `ungroup_node`, `repeat_node` (copies with per-copy text and icons) and `find_nodes`.
- `update_where` (one edit for every layer that matches a name, type or text), blend modes (`blendMode`: overlay, screen, multiply...), and three skills: `shop-patterns`, `game-motion` and `roblox-ui`.
- New layer properties: flip (`flipX`, `flipY`), colour adjust (`hue`, `saturation`, `brightness`, `contrast`), text outline (`textStroke`, `textStrokeWidth`), gradient lettering, and tiled images (`fit: "tile"`, `tileSize`).
- Editor: an Arrange section (align, distribute, grid, same size, flip, ungroup, repeat), a Widgets tab (themes and one-click widgets), outline and gradient controls for text, colour adjust and tiling controls for images, and shortcuts (Alt+A/D/W/S/H/V align, Shift+H/V flip, Ctrl+Shift+G ungroup).
- Snapping for people: snap to other layers' edges and centres anywhere in the same frame, equal-gap guides with the gap shown, an optional grid, and snapping while resizing. A magnet button in the tool bar (and Shift+S) turns it off; Ctrl while dragging skips it once. It never touches the design or the AI.
- The asset library takes the new game UI packs (buttons, panels, banners, sliders, icons, currency, items, eggs, event icons) with folder-aware categories and search filters. The packs stay in your own `~/.aframe/library`; they are not part of the app.

### Changed

- The repository is now `aframe` (was `atelier`); the websites moved to `/aframe/` and `/aframe/pro/`.
- The release workflow no longer fails the macOS job when there is no Apple certificate (the app is built unsigned), and skips the npm publish, with a notice, when no `NPM_TOKEN` secret is set.

## [0.3.0] - 2026-11-08 (pre-release)

Renamed to AFrame, one top bar in the desktop window, and two websites.

### Added
- Two websites from one deployment: the game UI site (`/`) and a new professional UI site (`/pro/`), each linking to the other. The professional one shows the real editor (light and dark) and the app's own exports of the landing, pricing and mobile templates (`scripts/render-site-shots.mjs`).

### Changed
- The desktop window no longer has a native title bar: the app's top bar is the title bar, with minimise, maximise/restore and close at its right end, and an empty stretch of the bar moves the window (a double press maximises or restores it). The window actions are the app's own commands, so the page still gets no general window permissions. Checked in the real desktop window (the buttons, moving between normal and maximised, minimising, and closing through the save-first path); browsers and the browser tests are unchanged.
- The websites' text no longer says export is missing.
- **The product is now called AFrame** (it was Atelier), with a new wordmark (the original sliced A, then "Frame"); the app icon and the A mark are unchanged. New wordmark in the app, website and promo cards, and a new installer name; the brand assets are generated by `scripts/gen-brand.mjs`. The data folder is now `~/.aframe`: the first launch moves an existing `~/.atelier` there (projects, notes, the asset library and skills carry over; if the move is refused because the old app is still running, the old folder keeps being used). API keys and the Figma token saved by the old version are moved to the new keychain entry the first time they are needed. `aframe-mcp install` removes the old "atelier" registrations from Claude Code, Codex and Cursor (only ones that are ours). The old installed app is a separate program: uninstall it from Windows Settings once you have moved. Your saved theme and chat settings in the app start from their defaults once. The GitHub repository and its web address are still `atelier` until you rename them.

## [0.2.0] - 2026-11-08 (pre-release)

Export, a built-in assistant, design checks, imports and launch polish. See the entries below; the unverified parts (live provider runs, a real Figma file, signing, other operating systems) are named in `docs/14-open-source-and-release.md`.

### Changed
- Brand: the Atelier icon and wordmark (`brand/`) replace the placeholder square, and the accent is
  now purple everywhere: the interface (light and dark), the favicon, annotation pins in agent
  screenshots, the gradient editor's default and the starter tokens of a new project. Desktop
  icons were regenerated from `app-icon.png`.

### Added
- Phase 11: polish for a first release. An accessibility audit of the whole interface (WCAG 2 A and AA, light and dark, every dialog) with the problems it found fixed; a recovery page with **Copy diagnostics** (no design content, notes or keys) if a screen ever fails; the welcome screen now offers an API key and importing; the app version is shown in the keyboard shortcuts sheet. Fuzz tests throw thousands of broken files at the loader and importers. `atelier-mcp` is packaged for npm (not yet published); the release workflow checks versions, builds Windows, macOS and Linux into a draft pre-release with checksums (not yet run); `scripts/rename.mjs` renames the product everywhere. New docs: user guide, demo script, alpha test kit, release guide. Performance: a 2,000-layer design stays interactive. Not done: auto-update, code signing, publishing.
- Phase 10: **Import** in the top bar. **SVG**: shapes, text and groups come in as editable layers (gradients, strokes, transforms and all), drawn paths as a picture of exactly that drawing. **Figma**: choose a frame from a file link (your token stays in the system keychain) or a saved file and get its auto-layout, text styles, fills, corners and shadows as layers, with vectors and image fills fetched. **Web page** (prototype): capture the app you are building with `npm run capture-dom -- http://localhost:3000` and import it as a starting frame. **Canva or any image**: the picture is added and the assistant is asked to rebuild it. Every import shows a report of what came across, what changed and what was left out, and is one undo. Figma has not yet been tried on a real file.
- Phase 9: a **Check** button in the top bar counts what needs a look (contrast, tiny text, off-scale spacing, near-miss alignment, too many fonts, text touching text, ...) and opens a list in plain words: **Show** finds the layer, **Fix** repairs one thing and **Fix automatically** repairs everything that has an unambiguous fix, as one undo step. Agents get the same fixes as ready-to-apply operations in `lint_design`. Your own skills in `~/.atelier/skills/` are picked up by Claude Code, Codex and the built-in assistant at once. An eval harness (`evals/`: ten tasks, automatic scores, a rubric, a scripted baseline, and live and replay modes) is there to measure a model before and after a change; no live model has been scored yet. Escape now closes any dialog even after focus has left it.
- Phase 7: a built-in assistant. The right panel has a **Chat** tab (Ctrl+L): ask for a change and it looks at your design, edits it with the same tools Claude Code or Codex would use, takes a screenshot to check its own work and tells you what it did in plain words. Bring your own key (Anthropic, OpenAI or any OpenAI-compatible server, including a local one); the key lives in your system keychain and only the app's native side ever reads it. One **Undo AI change** (or Ctrl+Z) reverses a whole reply; **Stop** halts it at once. Plain-language messages for a rejected key, rate limits, a busy provider, no network, a conversation that is too long and a model that cannot see images. "Ask AI to address N open notes" sends your notes to it. Tested against scripted providers and a local HTTP server; not yet run against a live provider (use Settings > Test connection with your key).
- Phase 8: export. **Export** in the top bar (or Ctrl+Shift+E, the right-click menu, or the command palette) opens a dialog with a live preview: **HTML + CSS**, **React + CSS Modules** or **React + Tailwind**, a copy button, and a folder to save into (a download in a browser). Colours, fonts and radii stay variables; images become files; class names come from your layer names and stay stable between exports. **Image** exports PNG at 1x/2x/3x (with a transparent option) or SVG, or copies the image. Agents get `export_code` and `export_image` with the same safeguards: only inside a folder you confirmed, never over your edited files without asking. Every format builds with Vite (and Tailwind) and renders within 2% of the canvas on all nine fixtures. The screenshot of a node no longer comes out one pixel wide at some zoom levels.
- Phase 6: notes and references. Press **A** to drop a numbered pin or drag a region on anything; the pin follows the node it is on. A **Notes** tab lists them (open / resolved / all, who wrote each, the AI's reply, click to jump), with **Ask AI to address N open notes**. An agent reads them with `get_annotations`, sees them drawn on `screenshot` (`annotations: true`), and answers with `resolve_annotation`. References take a scope and a note, and **Compare** shows one over or beside a frame.
- Asset library: your own folder of images (textures, halftones, sunbursts, particles...) kept in `~/.atelier/library/`, filled with `atelier-mcp library add <folder>`, searched and placed by agents with `search_library` and `use_library_asset` (a picture is stored in a project once however often it is used). Not part of the app or repository.
- Game-UI toolkit (decision log #79-#96; version 0.1.1 so installed apps refresh the MCP server): an **icon set** (165 solid icons in one style: coins, gems,
  keys, shields, stars, swords, potions, chests, arrows, close, check, settings and more; Font
  Awesome Free plus five drawn for Atelier) as a new `icon` node that takes a colour token, with
  `search_icons` and `place_icon`, and a labelled placeholder where a name is missing. **Display
  fonts** Lilita One, Luckiest Guy, Bungee and Fredoka with `list_fonts`; weights go to 900 where a
  family has them and a missing weight is never faked. **Pattern fills** (stripes, halftone,
  sunburst, noise) that follow the node's radius and clipping. **Effect presets** (`bevel-raised`,
  `bevel-pressed`, `gloss-top`, `inner-glow`, `hard-3d-bottom`, each with an intensity); text never
  gets a box shadow. **Reusable components** with `hover`, `pressed`, `disabled` and `selected`
  states, per-instance overrides, `define_component`, `create_instance` and `component_list`, and
  `screenshot` with a `state` (including `all`) so an agent can check every state. **Eight
  templates** (product landing, SaaS dashboard, mobile app, pricing page, game HUD, game shop, game
  inventory, blank), each with a token set and a component kit, in the New project dialog. Editing
  fixes: x/y on an auto-layout child now warns and names the parent layout, errors name the bad
  value and the correct form, ids work without `n_`. Six new lint rules. A `game-ui` skill. The
  motion preview (stretch goal) is not built.
- Phase 5: the MCP server and its installers. A single-file server (`mcp/dist/atelier-mcp.mjs`, MCP
  SDK v2, Node 20+) exposes 22 tools, resources and prompts: read and edit designs atomically
  (compare-and-write, safe beside the app and other agents), take screenshots of the live canvas
  (image plus a saved file for hosts that cannot show images; also when the window is minimised),
  read the user's selection, annotations and references, import images (images only, confined),
  lint, and manage projects. `install` / `uninstall` / `doctor` / `print-config` for Claude Code,
  Codex and Cursor (idempotent, backed up, never clobbers). The app embeds the server and installs
  it on launch, has a real Connect dialog (paste-in text with the true path, copy, connection test),
  a green pill while an agent is connected, an "An AI is editing" chip and a pulse on the nodes an
  agent changed. Verified with the built bundle and the real SDK client, the real `claude` CLI in an
  isolated config, an end-to-end test against the app in Chrome, and one against the production
  desktop window.
- Phase 4: persistence and sync. Projects are saved under `~/.atelier/projects/<id>/` (autosave
  within a quarter of a second, a rolling `.bak`, a project lock and compare-and-write so no writer
  can overwrite another's change), the open project and selection are published for agents by a
  native heartbeat, and changes made to the file by an agent or a script appear on screen as one
  undo step, merged property by property with unsaved edits. Projects dialog (Ctrl+O), import and
  export, recovery of damaged projects, agent request handling (`ping`, `get_selection`,
  `open_project`), confined Rust file commands each granted as a named permission,
  single-instance and window-state, a browser dev adapter sharing its code with the future MCP
  server, an NSIS installer, and a three-OS CI build. Verified by 28 Rust tests, 71 Node tests
  (including four separate processes writing one project and hard kills mid-write), a 23-case merge
  suite, a browser suite that also runs against the real window, a kill-the-real-app test and an
  install/launch/uninstall test.
- Fix: undo and redo could produce a revision equal to or older than the current one.
- Phase 3: the panels. Layers (tree, drag to reorder/reparent, rename, hide/lock, filter), a
  Design panel that exposes every document property with multi-selection "Mixed" values, gradient
  and shadow editors, a Tokens tab (edit, rename with reference rewrite, delete, create from
  selection), an Assets tab (image import by picker, drop and paste with magic-byte checks, use as
  reference), top bar, command palette (Ctrl+K), shortcut sheet (Ctrl+/), right-click menus,
  toasts with Undo, a welcome screen, font picker with previews and preloading, and a
  light/dark/system theme without a flash. New `set_tokens` tool. Navigation keys no longer get
  swallowed by canvas shortcuts, so keyboard users can Tab through the whole app. Browser tests for
  the panels also run against the real WebView2 window.
- Phase 2: the canvas editor. Zustand store with undo/redo (coalescing, transactions), a DOM renderer
  driven by `nodeToCss`, pan/zoom (wheel, pinch, space/middle/hand, fit, steps), a DOM-measured
  selection overlay, click/double-click/marquee selection, move with snapping guides, resize
  (shift/alt), auto-layout reorder with an insertion indicator, draw tools (frame, rectangle,
  ellipse, text) with device presets, inline text editing, copy/cut/paste/duplicate/delete, z-order,
  wrap in frame, add auto-layout, nudge, keyboard navigation, a shortcut registry, bundled font
  aliases and a debug HUD. New core helpers `extractSpec` (copy/paste) and `inferAutoLayout`.
  Browser tests: canvas interactions (real input), visual baselines, perf on 500/2000 nodes, also
  runnable against the real WebView2 window.
- Phase 1: pure core library in `src/core/` (types, ids, normalisation, tokens, validation, ops,
  atomic `applyChanges` with tempIds and warnings, `nodeToCss`, outline, migrations, document
  loading, and the `get_design` / `get_node` / `get_tokens` / `apply_changes` tool handlers) with
  213 unit tests, a real-Chrome layout probe (`npm run probe:css`) and a demo (`npm run demo:core`).
- Phase 0: repository foundations (Vite + React shell, strict TypeScript, ESLint, Prettier, Vitest,
  CI skeleton, Tauri 2 shell skeleton).
