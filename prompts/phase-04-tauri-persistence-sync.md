# Phase 4: Persistence, Tauri Shell, Sync

**Read:** docs/06 (authoritative), docs/18 (Tauri hardening), docs/09 (paths), `templates/tauri/*`.

## Goal
A real desktop app that saves projects and stays in sync with files changed by other processes.

## Tasks
1. **Tauri 2 shell** in `src-tauri/` from templates: verify against current Tauri docs; app id `dev.aframe.app` (placeholder), window 1360x860 min 900x600, title, icons (`scripts/make-icons.py` + `tauri icon`), CSP, single-instance, window-state plugin.
2. **Rust commands** (confined to `~/.aframe`): `aframe_home`, `fs_read`, `fs_write` (atomic tmp+rename, Windows retry), `fs_list`, `fs_remove`, `fs_mtime`. Path canonicalisation and prefix enforcement. Unit-test the path logic in Rust (`cargo test`).
3. **Dev adapter**: Vite plugin implementing the same operations over HTTP for browser dev (temp home via `AFRAME_HOME`).
4. `src/platform/fs.ts` picks adapter at runtime; typed API (`readText`, `writeText`, `list`, `remove`, `mtime`, `home`). `platform/files.ts` for open/save dialogs (Tauri dialog+fs plugins; browser fallback via download/`<input>`).
5. **Projects**: create/open/rename/delete/recent; `projects/<id>/project.aframe.json`; `.bak` rolling copy; schema check + migration on load; corruption recovery UI ("Restore previous version").
6. **Sync service** (`src/sync/sync.ts`): debounced save (250 ms), mtime polling (400 ms), rev compare, dirty-node merge, toast when remote changes arrive, history entry "External change", heartbeat + selection in `state.json` (throttled), request polling skeleton.
7. **MCP bundle embedding** stub: app writes a placeholder `~/.aframe/mcp/aframe-mcp.mjs` and skills dir on launch (real bundle arrives in Phase 5).
8. **Packaging**: `npm run tauri:build` produces an installer on your platform (if system libs are missing in your sandbox, install them or provide the exact commands for me to run). Add CI job (matrix) building on 3 OSes.
9. Tests: sync merge unit tests (fake fs): remote change when clean, when dirty on other node, when dirty on same node; crash-safe write test; Rust path-confinement tests.

## Acceptance
- Edit in the app -> file updates in < 500 ms. A script that bumps a node's fill in the JSON -> the UI changes in < 700 ms, undo restores.
- Killing the process mid-save never corrupts the project.
- Installer builds and launches; app icon and name correct. (State clearly which OSes you could actually test.)

## Report back with
What you could and couldn't test per OS, the final capability set, and anything in docs/06 you changed.
