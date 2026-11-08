# AFrame

Open-source, local-first AI design studio. Let Claude Code, Codex or a chat with your own API key design real UI on a canvas you can see, annotate and approve, then export it as code into your repo.

> **Status: early pre-release (v0.3.x).** A Windows installer is on the [releases page](https://github.com/choomploow-byte/aframe/releases) (unsigned: Windows will warn). macOS and Linux build from source but have not been run by the author. Everything below is tested on Windows and in Chrome; what has not been tried is listed in [`docs/14-open-source-and-release.md`](docs/14-open-source-and-release.md).

## What it does

- **A canvas for AI.** Frames with real auto-layout, text, shapes, images, icons, patterns and bevel presets, reusable components with hover and pressed states, tokens for colours, fonts and radii. Games and apps: templates for a landing page, a dashboard, a mobile app, a pricing page, and a game HUD, shop and inventory.
- **Your AI, your way.** Claude Code, Codex and Cursor drive the app through an MCP server (screenshot, edit, lint, export). Or use the built-in chat with your own Anthropic, OpenAI or compatible key, kept in your system keychain. Either way it looks at the design, edits it, takes a screenshot to check its work, and one undo reverses a whole turn.
- **You steer.** Drop numbered notes on anything; the AI reads them, fixes them and replies. Attach reference images with a note and a scope. Press **Check** for contrast, text size, spacing and alignment problems, with one-click fixes.
- **Code out.** Export a frame as HTML + CSS, React + CSS Modules or React + Tailwind (colours stay variables, images become files, class names stay stable between exports), or as PNG or SVG. Verified: every format builds with Vite and renders within 2% of the canvas.
- **Bring designs in.** SVG as editable layers, a Figma frame, a captured web page (prototype), or any image for the AI to rebuild.
- **Local first.** Projects are plain JSON files under `~/.aframe`. No account, no servers of ours, no telemetry.

Start with [`docs/user-guide.md`](docs/user-guide.md); there is a two-minute walkthrough in [`docs/demo-script.md`](docs/demo-script.md).

## Install

1. Download the installer from the [releases page](https://github.com/choomploow-byte/aframe/releases) and run it. It is not code-signed yet, so Windows SmartScreen will say "unknown publisher": choose *More info*, then *Run anyway*. Checksums are next to the installer.
2. Open AFrame and press **Explore the sample project**.
3. Connect an AI: press **Connect AI** and paste the text it shows into Claude Code or Codex, or press the **Chat** tab and add an API key. Then ask: *"in aframe, improve my design"*.

Or only the MCP server, without the app, for an agent that will edit files (screenshots and image export need the app open):

```bash
npx -y aframe-mcp install     # needs Node 20+; registers with Claude Code, Codex and Cursor
```

(`aframe-mcp` is built and tested from a clean install but has not been published to npm yet.)

## Develop

Requirements: Node 22.12+ (or 24), npm, and for the desktop shell Rust (MSVC toolchain on Windows) plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
npm run dev        # UI in the browser at http://127.0.0.1:1420
npm run typecheck
npm run lint
npm test
npm run tauri:dev  # desktop shell (needs Rust)
```

Browser tests (need Chrome; set `CHROME_PATH` if it is not in a standard place):

```bash
npm run test:e2e      # every browser suite: canvas, panels, persistence, a live agent, export, chat, import, accessibility (real mouse and keyboard)
npm run test:visual   # screenshot baselines; UPDATE_BASELINES=1 refreshes them deliberately
npm run test:perf     # frame timing on a 500-node document (optimised build); PERF_NODES=2000 to scale
npm run probe:css     # proves the nodeToCss layout contract in a real browser
```

AFrame saves projects under `~/.aframe`. While developing, point it at a throwaway folder so
tests and experiments never touch your own projects: set `AFRAME_HOME` (the browser dev server
already defaults to `~/.aframe-dev`, and every browser test uses its own temporary folder).

Checking the real desktop window on Windows (WebView2), without clicking around. `npm run tauri:dev`
exposes `window.__aframe`, so the same suites can attach to the running window:

```powershell
$env:AFRAME_HOME = Join-Path $env:TEMP 'aframe-e2ehome'   # a throwaway folder, empty for the persistence suite
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9222'
npm run tauri:dev                                       # in one terminal
$env:CDP_URL='http://127.0.0.1:9222'                    # in another:
node tests/e2e/canvas.mjs; node tests/e2e/panels.mjs; node --import tsx tests/e2e/persistence.mjs
```

Crash and install checks use built executables (no dev server):

```powershell
$env:VITE_DEVTOOLS='1'; npm run tauri:build -- --debug --no-bundle   # debug exe with the test hooks
node tests/e2e/tauri-kill.mjs          # hard-kills the real app mid-save, six times, and checks the files
npm run tauri:build -- --bundles nsis  # the installer: src-tauri/target/release/bundle/nsis/
node tests/e2e/installer-smoke.mjs     # install silently, launch, check, uninstall
node tests/e2e/mcp-desktop.mjs         # an agent through MCP drives the release window (see the file's header)
cd src-tauri; cargo test               # the native side: path confinement, locks, crashes, heartbeat
```

For performance numbers use an optimised desktop build (as above, then launch
`src-tauri/target/debug/aframe.exe` with the debug port).

Specs live in [`docs/`](docs/), standing rules for contributors and coding agents in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).

## Connect an AI

The app's **Connect AI** button shows the exact text to paste into Claude Code or Codex. By hand:

```bash
npm run build:mcp                                  # mcp/dist/aframe-mcp.mjs: the whole server, one file
node mcp/dist/aframe-mcp.mjs install              # Claude Code, Codex, Cursor: whichever are installed
node mcp/dist/aframe-mcp.mjs doctor               # checks Node, the app, each host
node mcp/dist/aframe-mcp.mjs uninstall            # removes exactly what install added
```

What an agent can do with it, beyond frames and text: place icons (`search_icons`), set type in display fonts (`list_fonts`), fill with patterns, add bevel and gloss presets, build reusable components with hover and pressed states (`define_component`, `create_instance`) and check them with `screenshot` and a `state`. New projects can start from a game HUD, shop or inventory, a product landing, a SaaS dashboard, a mobile app or a pricing page. Third-party licences: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

The desktop app carries the same file and puts it in `~/.aframe/mcp/` on launch, which is the path
the AI tools are pointed at. Working on the server: `npm run test:mcp` (the built file driven by the
real MCP client, the installers, and the real `claude` CLI if present) and `npm run test:e2e:mcp` (an
agent editing the running app). What only a real model session can show is in
[`docs/manual-e2e.md`](docs/manual-e2e.md).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version: one phase of the roadmap at a time, small conventional commits, and nothing is called done until it has been run. Skills (markdown the AI loads) are the easiest first contribution: see [`skills/README.md`](skills/README.md). To measure whether a change to a skill or prompt helped, use the eval harness in [`evals/`](evals/README.md).

To pick a different product name: `node scripts/rename.mjs --name "Foo Studio" --slug foostudio` (dry run first; [`docs/release.md`](docs/release.md) lists what it cannot do).

## Licence

MIT
