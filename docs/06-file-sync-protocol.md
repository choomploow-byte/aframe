# 06. File Sync and Bridge Protocol

Goal: the app and any number of MCP server processes cooperate on the same project with no sockets, no ports, no daemon, and graceful behaviour when the app is closed.

**Status: built in Phase 4** (the app side and the shared Node module the MCP server will use). What the MCP server itself does with this arrives in Phase 5. Changes against the original draft are listed at the end ("Changes from the first draft"). The implementation lives in `src-tauri/src/{home,fsops,lock,appstate,bridge,layout}.rs` (desktop), `mcp/home-fs.ts` (Node: dev adapter and MCP server) and `src/{platform,projects,sync}/` (webview); the three file implementations are kept in step by tests that exercise the same rules.

## Home directory
`~/.atelier/` (override with `ATELIER_HOME`; the browser dev adapter defaults to `~/.atelier-dev`, never the real one)
```
~/.atelier/
  app-state.json                written ONLY by the app: { appHeartbeat: ISO, appPid, appVersion, currentProject, selection: [ids] }
  settings.json                 written only by the webview: { lastProject }
  agents/<pid>.json             one per MCP process, written only by that process (Phase 5)
  projects/
    <id>/
      project.atelier.json      the Doc
      project.atelier.json.bak  the previous valid version (rolling, 1 deep)
      .lock                     advisory lock, present for milliseconds while a writer works
  requests/req_<id>.json        agent -> app
  responses/<id>.json           app -> agent
  mcp/atelier-mcp.mjs           bundled server (a marked placeholder until Phase 5)
  skills/*.md                   shipped + user skills (README placeholder until Phase 9)
  exports/                      default export location
  logs/
```
Project ids match `^p_[A-Za-z0-9]{3,16}$`; they become folder names, so nothing else is accepted.

## Confinement (every file operation)
All paths from the webview are relative to the home. A path is refused if it is empty (for writes and deletes), absolute, rooted (`/x`, `\x`), contains a drive prefix, `..`, a NUL, or a `:` (Windows alternate data streams), or if the deepest existing ancestor resolves (symlinks, junctions) outside the real home. Deleting or writing "the home itself" is refused. Tauri commands are individually granted in `capabilities/default.json` (`allow-fs-read` etc.); there is no fs, shell, dialog or opener plugin.

## Document writes
A write of `project.atelier.json` is a **compare-and-write on `rev` under the project lock**, done by the same algorithm in Rust (`fsops::write_doc`) and Node (`HomeFs.writeDoc`):
1. Take `<project>/.lock` (exclusive create). On contention wait (15 ms polls, up to 3 s). Windows reports "Access is denied" instead of "exists" while the other side deletes the lock: treat as contention. A lock older than **5 s** belongs to a dead process and is taken over (writers hold it for milliseconds; a hard-killed process therefore delays saving by at most ~5 s).
2. Read the current file. If the caller passed `expectRev` and the file's `rev` differs (or it is unreadable), **write nothing** and return `{ conflict: true, diskRev }`.
3. If the current file is a valid document, write it to `.bak` (atomically). A corrupt file never replaces a good backup.
4. Write the new content to a unique temp file next to the target (`.<name>.<pid>.<n>.tmp`), `fsync` it, rename over the target (retry up to ~1.5 s on Windows when a scanner or sync client holds the file), `fsync` the folder on Unix.
5. Release the lock. Return `{ ok, diskRev, stat: {mtimeMs, size} }` (the stat is taken under the lock, so the writer can recognise its own write).

Readers need no lock: they only ever see a complete old or complete new file. A crash at any point leaves the old file, the `.bak`, and possibly a stale `.tmp` and `.lock`; both are ignored/expired and `.tmp` files are swept at start-up.

`rev` is monotonic: every local commit, undo, redo and cancelled gesture is a new revision (`store.restored` uses the *current* rev + 1, not the snapshot's), and a write is always newer than the file it replaces.

Other files (`app-state.json`, `settings.json`, responses) use the plain atomic write (steps 4 only), each with exactly one writer.

### Conflict handling (as built)
- **Save:** every local change schedules a save 250 ms after the last change, but never later than **2 s** after the first unsaved change (a pure debounce never fires during a long drag). Every save writes a whole committed document, never a half-applied operation.
- **Watch:** every 400 ms the app compares the file's `(mtime, size)` with what it last read or wrote. A difference means someone else wrote it. This also catches a script that edits the JSON by hand without touching `rev`.
- **Merge:** `core/merge.ts` does a three-way merge of `base` (last known on-disk document), `local` (screen) and `remote` (disk), property by property:
  - clean screen: the remote document is adopted as it is (no rev bump, nothing written back), one undo step labelled "AI change" (writer `mcp`/`chat`) or "External change";
  - nothing remote: the local document stays;
  - both changed: per node, per property, per token, per annotation, per asset, the side that changed it wins; if both changed the same property differently **the remote value wins** and the node is named in a toast; a node deleted on one side and edited on the other keeps the remote version; children lists follow whichever side reordered (remote if both), then anything only one side added; orphans (their parent was deleted remotely) are dropped and reported;
  - if the combination would be inconsistent (a cycle, a missing root, schema errors) the remote document is taken whole and undo returns the user's version.
  A merged document is a new revision after both sides, stamped as written by the app, then saved.
- **Not applied mid-gesture:** while a drag/resize transaction or inline text edit is open, an incoming change waits (the next poll looks again).
- **Save conflict:** if the file moved between the check and the write, the compare-and-write refuses; the app merges what it finds and writes again (up to 5 rounds).
- **Damaged or deleted file while open:** the screen version is written back (the `.bak` is untouched) and a toast says so.
- **Failed save:** the status turns to "Can't save" with the reason, the document stays in memory, and the save retries (1 s for a lock, 3 s otherwise).
- **Closing:** the native side asks the page to save first (`atelier://close-requested`), the page flushes and answers `app_quit`; a 4 s grace period quits anyway so a hung page can never block closing.

## Request/response (things only the live app can do)
Used for: `screenshot` (Phase 5), `export_image` (Phase 8), `get_selection`, `get_node_bounds`, `open_project`, and `ping`.

Request file `requests/req_<id>.json` (id letters and digits only, matching the file name):
```json
{ "id": "req_8f2k1", "type": "screenshot", "createdAt": "...", "project": "p_ab12",
  "params": { "nodeId": "n_hero1", "scale": 1, "annotations": true, "maxWidth": 1600 } }
```
Response file `responses/<id>.json`:
```json
{ "id": "req_8f2k1", "ok": true, "completedAt": "...", "result": { "width": 1440, "height": 900, "pngBase64": "iVBOR..." } }
```
or `{ "ok": false, "error": { "code": "NODE_NOT_FOUND", "message": "..." } }`.

### Flow
1. The MCP server checks app liveness: `app-state.json.appHeartbeat` within the last 5 s (the app refreshes it every 2 s from a **native thread**, immediately on a project/selection change at most every 200 ms). Not alive -> immediate `APP_NOT_RUNNING` ("Open Atelier").
2. It writes the request (atomic), then polls `responses/<id>.json` every 100 ms (15 s timeout; 30 s for huge screenshots).
3. A native thread lists `requests/` every 250 ms and emits an `atelier://request` event per new, well-formed file (name `req_[A-Za-z0-9]{1,40}.json`, at most 256 KB) once until the file disappears. The page re-requests announcements on start (`bridge_resync`) for files that arrived before it was listening. (In a browser dev session the page polls instead.)
4. The page validates (`sync/requests.ts`): the id must match the file name, the `type` must be on the allow-list, params are checked field by field, requests older than 2 minutes are dropped. It **saves pending edits first**, runs the handler, writes the response, deletes the request. Each id is handled once. Types that are allowed but not built yet answer `NOT_IMPLEMENTED` immediately instead of timing out. Implemented now: `ping`, `get_selection`, `open_project`.
5. The MCP server reads the response, deletes it, returns the result.
6. Housekeeping: the native side deletes request/response files older than 2 minutes about once a minute; both sides sweep stale `.tmp` files.

### Security of the bridge
- The home directory is created with user-only permissions on Unix (0700); on Windows it inherits the user profile's default permissions.
- Request files are untrusted data: the `type` is an allow-list, params are validated, no value is ever executed or used as a path.
- `app-state.json` only ever contains ids that match `^[A-Za-z0-9_-]{1,64}$` (at most 500 selected ids).
- Responses may be large (base64 PNG): cap `maxWidth`; scale down above 8 MB (Phase 5).

## Heartbeat
`app-state.json` is written by the native side only; the page reports `{currentProject, selection}` (on change, and every 2 s) through `app_state_set`. Because the heartbeat is native, it keeps going when the window is minimised or occluded.

## Multiple agent sessions
Each MCP process is independent. Doc writes take the project lock for a few milliseconds and are compare-and-write on `rev`, so two agents (or an agent and the app) can never overwrite each other's change: the loser reads the new file, re-applies its change, and writes again. Operation-level interleaving of *long* edits is still possible and acceptable for MVP; v0.2 may add an optional `agentLock` with TTL for serialising them.

## Multiple projects
`projects/<id>/` per project. The app's open project is `app-state.json.currentProject` (remembered across runs in `settings.json.lastProject`). MCP default project resolution: explicit arg > `currentProject` > most recently updated. The Projects dialog (Ctrl+O) lists projects newest first, reading only the first 4 KB of each file for its name (the serialiser writes name and rev at the top and the bulky `nodes`/`assets` last).

## Platform notes
- Windows: rename-over-existing and delete can fail while another process holds the file or folder (antivirus, indexer, sync clients). Renames retry for up to ~1.5 s, folder deletes 8 times. Lock creation reports "Access is denied" during another writer's delete: treated as contention.
- Paths: always relative with forward slashes at the API; expand `~` yourself.
- OneDrive and other synced folders are a bad home for `~/.atelier` (handles held during sync); the default is the user profile, not Documents.
- Tauri side: custom commands `atelier_home`, `fs_read`, `fs_read_head`, `fs_write` (atomic), `fs_write_doc` (compare-and-write), `fs_list`, `fs_remove`, `fs_stat`, `app_state_set`, `bridge_resync`, `app_quit`. All file commands are confined as above.

## Dev-mode adapter
In `vite dev`, `scripts/vite-dev-fs.ts` exposes the same operations over `POST /__fs/<op>` using `mcp/home-fs.ts` (the code the MCP server will share), so the app, autosave, sync and the agent bridge run in a normal browser. It only answers requests that carry the header `x-atelier-dev: 1` from a localhost origin (a custom header forces a CORS preflight that is never approved, so other websites cannot reach it). `src/platform/fs.ts` picks the adapter by checking `window.__TAURI_INTERNALS__`. The browser has no native heartbeat thread: the page's periodic report stands in for it.

## Test matrix (what is automated, and where)
| Case | Where | Status |
|---|---|---|
| Path confinement (`..`, absolute, drive, colon, NUL, symlink out, delete-the-home) | `cargo test` (home.rs, fsops.rs), `tests/node/home-fs.test.ts` | automated, Windows verified |
| Compare-and-write, `.bak` rules, lock exclusivity and stale takeover | Rust + Node tests | automated |
| Crash at every step of a write (during temp write, after temp, after backup) | Rust + Node fault injection | automated |
| Many concurrent writers: no lost update, rev strictly increasing | Rust threads; Node in-process; **4 separate Node processes** | automated |
| Hard-kill a writer mid-save, 6 times | `tests/node/home-fs.test.ts` (child processes, SIGKILL) | automated |
| Hard-kill the **real desktop app** mid-save, 6 times, relaunch, lock takeover time | `tests/e2e/tauri-kill.mjs` | automated (Windows) |
| Merge: clean, other node, other property, same property, delete vs edit, children, cycle, tokens, 300 random scenarios | `core/merge.test.ts` | automated |
| Sync: save, debounce + max wait, rev through undo, failed write retry, agent change clean/dirty/same prop/raced, mid-gesture deferral, hand-edited file, deleted or damaged file | `tests/node/sync.test.ts` | automated |
| App open, agent edits: UI within ~500 ms, undo works, user editing another node: both survive | `tests/e2e/persistence.mjs` (browser, and the real window with `CDP_URL`) | automated: file edit -> UI 150-350 ms |
| Edit -> file under 500 ms | same | automated: median ~260 ms |
| Agent requests answered; unknown/planned/malicious requests refused | `requests.test.ts`, `persistence.mjs` | automated: ~100-270 ms |
| Installer installs, app launches, uninstalls | `tests/e2e/installer-smoke.mjs` | automated (Windows) |
| App closed: doc tools work, screenshot errors clearly | Phase 5 | pending |
| macOS and Linux file behaviour, WebKit | CI matrix (`rust-tests`, `tauri-build`) | defined, **not yet run** (no remote) |

## Changes from the first draft
1. `state.json` split into `app-state.json` (app only) and `agents/<pid>.json` (each MCP process): read-modify-write on one shared file loses updates.
2. A project lock plus compare-and-write on `rev` (the draft relied on atomic rename alone, which protects readers but not writers from each other).
3. Heartbeat and request watching run on native threads (webview timers are throttled when hidden).
4. Unique temp names, `fsync`, `(mtime, size)` change detection; `.bak` never replaced by a corrupt file.
5. `fs_mtime` became `fs_stat` (mtime and size); added `fs_read_head`, `fs_write_doc`, `app_state_set`, `bridge_resync`, `app_quit`.
6. A save is never later than 2 s after the first unsaved change (maximum wait), and a stale lock expires after 5 s.
7. Property-level three-way merge (`core/merge.ts`) instead of "dirty node ids"; remote wins same-property clashes.
8. `ping` request type, and an explicit allow-list with `NOT_IMPLEMENTED` for types built in later phases.
9. The dev adapter is guarded by a custom header and lives in `scripts/vite-dev-fs.ts` over the shared `mcp/home-fs.ts`.
