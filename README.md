# Atelier

Open-source, local-first AI design studio. Let Claude Code, Codex, or an API-key chat design real UI on a canvas you can see, annotate and approve, then export it as code into your repo.

> Status: early development (Phases 0-4: foundations, core library, canvas editor, panels, persistence and sync). There is nothing to install yet. See [`docs/12-roadmap-and-phases.md`](docs/12-roadmap-and-phases.md).

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
npm run test:e2e      # shell smoke + canvas + panels + persistence (real mouse and keyboard)
npm run test:visual   # screenshot baselines; UPDATE_BASELINES=1 refreshes them deliberately
npm run test:perf     # frame timing on a 500-node document (optimised build); PERF_NODES=2000 to scale
npm run probe:css     # proves the nodeToCss layout contract in a real browser
```

Atelier saves projects under `~/.atelier`. While developing, point it at a throwaway folder so
tests and experiments never touch your own projects: set `ATELIER_HOME` (the browser dev server
already defaults to `~/.atelier-dev`, and every browser test uses its own temporary folder).

Checking the real desktop window on Windows (WebView2), without clicking around. `npm run tauri:dev`
exposes `window.__atelier`, so the same suites can attach to the running window:

```powershell
$env:ATELIER_HOME = Join-Path $env:TEMP 'atelier-e2ehome'   # a throwaway folder, empty for the persistence suite
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
cd src-tauri; cargo test               # the native side: path confinement, locks, crashes, heartbeat
```

For performance numbers use an optimised desktop build (as above, then launch
`src-tauri/target/debug/atelier.exe` with the debug port).

Specs live in [`docs/`](docs/), standing rules for contributors and coding agents in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).

## Licence

MIT
