# 06. File Sync and Bridge Protocol

> **Revisions decided before implementation (decision log #18-#20), to be applied when Phase 4/5 rewrites this doc:**
> 1. `state.json` is split: `app-state.json` is written **only by the app** (heartbeat, pid, version, currentProject, selection); each MCP process writes **only its own** `agents/<pid>.json` (`lastAgentSeen`, server version). Wherever this doc or docs/07, 09, 17 say `state.json.lastAgentSeen` / `state.json.appHeartbeat`, read it as the file for that writer.
> 2. Document read-modify-write is wrapped in an advisory lock file (exclusive create, stale after a short TTL) in both the app and the MCP server.
> 3. Heartbeat and request-file watching run on a Rust thread, not JS timers (webview timers are throttled when minimised or occluded).
> 4. Atomic writes use a unique tmp name and `sync_all()`; change detection compares `(mtime, size, rev)`.

Goal: the app and any number of MCP server processes cooperate on the same project with no sockets, no ports, no daemon, and graceful behaviour when the app is closed.

## Home directory
`~/.atelier/` (override with `ATELIER_HOME`)
```
~/.atelier/
  state.json                    { currentProject, appPid?, appHeartbeat: ISO, appVersion }
  projects/
    <id>/
      project.atelier.json      the Doc
      project.atelier.json.bak  previous version (rolling, 1 deep)
  requests/<reqId>.json         agent -> app
  responses/<reqId>.json        app -> agent
  mcp/atelier-mcp.mjs           bundled server, written by the app
  skills/*.md                   shipped + user skills
  exports/                      default export location
  logs/
```

## Document writes
1. Read current file, parse, note `rev`.
2. Apply change to produce new doc with `rev = rev + 1`, `meta.updatedAt`, `meta.lastWriter`.
3. Write to `project.atelier.json.tmp` in the same directory, `fsync`, then **rename** over the real file (atomic on all major OSes).
4. Copy previous file to `.bak` before rename.

### Conflict handling (MVP, deliberately simple)
- MCP tools do **read-modify-write immediately** (milliseconds), so conflicts are rare.
- The app keeps `lastSeenRev`. Every 400 ms it stats the file; if mtime changed it reads and compares `rev`.
  - Remote rev > local rev **and** no unsaved local edits -> load remote, keep selection/viewport, add a history entry "AI change".
  - Remote rev > local rev **and** unsaved local edits (debounce window) -> flush local first by rebasing: re-apply the local pending ops on top of remote when they touch different nodes; if the same node/prop, remote wins and a toast says "AI updated X". (Implementation tip: track a `dirtyNodeIds` set; merge = take remote nodes except dirty ones.)
- App saves with 250 ms debounce after the last local edit, and **before** answering any request.
- Always re-check `rev` right before the app writes; if it moved, merge as above and retry once.

## Request/response (things only the live app can do)
Used for: `screenshot`, `export_image`, `get_selection`, `get_node` bounds, `open_project` switching.

Request file `requests/<reqId>.json`:
```json
{ "id": "req_8f2k1", "type": "screenshot", "createdAt": "...", "project": "p_ab12",
  "params": { "nodeId": "n_hero1", "scale": 1, "annotations": true, "maxWidth": 1600 } }
```
Response file `responses/<reqId>.json`:
```json
{ "id": "req_8f2k1", "ok": true, "completedAt": "...",
  "result": { "width": 1440, "height": 900, "pngBase64": "iVBOR..." } }
```
or `{ "ok": false, "error": { "code": "NODE_NOT_FOUND", "message": "..." } }`.

### Flow
1. MCP server checks app liveness: `state.json.appHeartbeat` within the last 5 s (app updates it every 2 s). If not alive -> immediate error `APP_NOT_RUNNING` with hint "Open Atelier".
2. Writes request (atomic), then polls `responses/<id>.json` every 100 ms, timeout 15 s (screenshots of huge frames: 30 s).
3. App polls `requests/` every 250 ms (only while window exists; also on window focus), handles each exactly once (tracks handled ids), writes response, deletes the request.
4. MCP server reads response, deletes it, returns result.
5. Housekeeping: app and server delete request/response files older than 2 minutes on start and periodically.

### Security of the bridge
- Directory created with user-only permissions (0700 where supported).
- Request `type` is an allow-list; params validated; the app **never** executes arbitrary code from requests.
- Responses may be large (base64 PNG): cap `maxWidth`; scale down above 8 MB.

## Heartbeat
App writes `state.json` (merge) every 2 s: `{ appHeartbeat, appPid, appVersion, currentProject, selection: [ids] }`. Putting `selection` here makes `get_selection` instant and independent of request/response. Selection writes are throttled (200 ms).

## Multiple agent sessions
Each MCP process is independent. Doc writes are atomic and short; `rev` increments are monotonic. Two agents editing at the same time can still interleave at the operation level, which is acceptable for MVP. v0.2: optional `agentLock` with TTL in `state.json` to serialise long edits.

## Multiple projects
`projects/<id>/` per project. App's open project is `state.json.currentProject`. MCP default project resolution: explicit arg > `currentProject` > most recently updated.

## Platform notes
- Windows: rename-over-existing can fail if another process has the file open. Retry loop (5 x 40 ms). Use `fs.rename` with fallback to copy+unlink.
- Paths: always use forward-slash-normalised internal paths; expand `~` yourself.
- Tauri side: custom commands `fs_read`, `fs_write` (atomic), `fs_list`, `fs_remove`, `fs_mtime`, `atelier_home`, all **confined to the atelier home** (canonicalise path, reject `..` and symlink escapes).

## Dev-mode adapter
In browser dev (`vite`), a small Vite plugin exposes the same five operations over HTTP (`/__fs/read` etc.) pointing at a temp home, so the UI and MCP bridge can be developed and tested without Tauri. The frontend `platform/fs.ts` picks the adapter by checking `window.__TAURI_INTERNALS__`.

## Test matrix
- App closed: doc tools work, screenshot errors clearly.
- App open, agent edits: UI updates within ~500 ms, selection preserved, undo works.
- App open, user dragging while agent edits another node: both changes survive.
- Crash mid-write: `.tmp` ignored, `.bak` recoverable ("Restore previous version" in UI).
- Two MCP processes writing concurrently: no corruption, rev strictly increasing.
