# 09. Install and Onboarding ("one command / one piece of text")

Requirement: a brand-new vibe coder can get Claude Code (or Codex) talking to AFrame in under a minute with a single paste.

## As built in Phase 5 (what was verified, and what was not)
`node aframe-mcp.mjs install [--claude|--codex|--cursor|--all] [--force]`, `uninstall`, `doctor`, `print-config`, `--version`. With no host flag, `install` sets up every host it finds (by its CLI on PATH or its config folder) and, if there is none, prints the generic JSON. Rules every edit follows: idempotent (a second run changes nothing and says so), a one-time backup `*.aframe-bak` of any file it modifies, an entry called "aframe" that AFrame did not write is never replaced without `--force`, a config file that is not valid JSON is left alone with the manual step printed, and `uninstall` removes exactly what `install` added. The app writes its embedded server to `~/.aframe/mcp/aframe-mcp.mjs` on launch when it is newer (never over a newer or hand-edited file); an `install` run from another copy puts itself there first. Hosts point at that stable path.

| Host | What `install` does | Checked |
|---|---|---|
| Claude Code | `claude mcp add --scope user aframe -- node <path>` (flags before the name, `--` before the command; verified against the installed CLI, 2.1.168). Without the CLI: adds a `stdio` entry to `~/.claude.json`. Writes `~/.claude/skills/aframe/SKILL.md` | **Real CLI**, in an isolated config directory: add, get, idempotent re-add, `claude mcp list` (which starts the server and completes the MCP handshake: "Connected"), remove. Not yet: a real model session using the tools (see `docs/manual-e2e.md`) |
| Codex | A marked block `[mcp_servers.aframe]` in `~/.codex/config.toml` (`command = "node"`, the path as a TOML literal string so Windows paths survive, `startup_timeout_sec = 20`, `tool_timeout_sec = 120`; Codex defaults are 10 and 60), a short marked note in `~/.codex/AGENTS.md` (skipped near Codex's 32 KiB limit), and the skill at `~/.agents/skills/aframe/SKILL.md` | Config format and locations read from the current Codex docs; edits tested against fake homes. **No Codex on this machine: not run against the real host** |
| Cursor | Merges `{ "mcpServers": { "aframe": { "command": "node", "args": [path] } } }` into `~/.cursor/mcp.json` | Tested against fake homes. **Not run against the real host** |
| Anything else | `print-config` | n/a |

`doctor` checks: Node 20+, the server file (and that it is not the placeholder), the AFrame folder, whether the app is running (heartbeat under 5 s), each host's registration (a failure only for hosts it detects), and the Claude skill. Each problem prints a fix. Images: Claude Code shows MCP image results; for any host that does not, `screenshot` also returns the saved file's path (and `returnImage: false` returns only that).

## The three install routes

### Route 1: Paste-into-Claude text (most beginner friendly)
The Connect dialog shows a block like:

> Install the AFrame design app for me. Run: `node "<HOME>/.aframe/mcp/aframe-mcp.mjs" install --claude`. Then confirm the `aframe` tools are available, read the `aframe` skill, and tell me how to use it. From now on, when I ask you to design or improve UI, use the AFrame tools.

`<HOME>` is filled in with the user's real path by the app. Claude Code runs the command, which:
1. Registers the MCP server: runs `claude mcp add --scope user aframe -- node "<path>"` (falls back to editing `~/.claude.json` if the `claude` CLI isn't on PATH, or prints exact manual steps).
2. Writes `~/.claude/skills/aframe/SKILL.md`.
3. Prints "Restart or reload Claude Code if tools don't appear."

### Route 2: One terminal line
```
node ~/.aframe/mcp/aframe-mcp.mjs install
```
Auto-detects Claude Code, Codex, Cursor and installs for each one found (asks which, or `--all`).

### Route 3: Package-manager line (after public release)
```
npx -y aframe-mcp install
```
The npm package contains the same single bundle. Good for users who haven't launched the app yet and for docs/README.

## What `install` does per host
| Host | MCP registration | Skill / instructions |
|---|---|---|
| Claude Code | `claude mcp add --scope user aframe -- node <path>` (or JSON edit) | `~/.claude/skills/aframe/SKILL.md` |
| Codex | Append `[mcp_servers.aframe] command="node" args=["<path>"]` to `~/.codex/config.toml` (idempotent, backup first) | Append a marked block to `~/.codex/AGENTS.md` |
| Cursor | Merge into `~/.cursor/mcp.json` | `.cursor/rules/aframe.mdc` (optional) |
| Generic | Print JSON snippet `{ "mcpServers": { "aframe": { "command": "node", "args": ["<path>"] } } }` | n/a |
All edits: idempotent, create backups (`*.aframe-bak`), never clobber unrelated config, print a diff-like summary. `uninstall` reverses cleanly. `doctor` checks Node version, file presence, host registrations, app heartbeat.

> Config file locations and CLI flags change between host versions. Claude Code must **verify current docs** (Claude Code MCP docs, Codex config docs) and adapt the installer, with fallbacks that print manual steps.

## First-run experience (app)
1. App launches -> writes `~/.aframe/mcp/aframe-mcp.mjs` + skills (overwrites only if bundled version is newer).
2. Welcome screen -> *Connect Claude Code / Codex*, *Use an API key*, *Explore the sample*.
3. Connect dialog watches `agents/<pid>.json` (each MCP server keeps its own file fresh and stamps `lastToolCall` on every call) -> green tick when the first tool call arrives.
4. Suggests first prompts: *"in aframe, improve my design"*, *"in aframe, rebuild this screenshot"* (drag an image to Claude), *"in aframe, make this look like [reference]"*.

## Zero-setup understanding
Even if only the MCP is registered (no skill), the server `instructions` and `list_skills`/`load_skill` mean the agent learns the workflow by itself. The skill file is an extra that improves triggering ("improve my UI" -> uses AFrame without being told).

## Using it from Claude Code (user docs snippet)
```
> in aframe, improve my design
> in aframe, make the hero feel more premium and follow reference "stripe-home"
> in aframe, address my annotations
> in aframe, export the pricing frame as React into ./src/components
> in aframe, make this mobile friendly
```

## Updating
- App update replaces the bundle at `~/.aframe/mcp/`; host config points to that stable path so no re-install is needed.
- Version handshake: MCP server reports its version in `state.json`; app warns if mismatched (e.g. user is using an older `npx` copy).

## Troubleshooting matrix (write into docs + `doctor`)
| Symptom | Cause | Fix |
|---|---|---|
| Tools not visible in Claude Code | Not restarted / wrong scope | `/mcp` check, restart, re-run install |
| "Node not found" | Node missing or not in PATH | Install Node LTS; show link |
| Screenshot times out | App closed or minimised throttling | Open app; keep window visible |
| Changes don't appear | Different project open | Check project name in top bar / `list_projects` |
| Windows path errors | Spaces in path | Quote path; installer handles |

## Distribution of the app
- GitHub Releases: `.msi`/`.exe`, `.dmg`, `.AppImage`/`.deb`.
- Winget / Homebrew cask / Scoop later.
- Code signing: Windows (to avoid SmartScreen warnings), macOS notarisation (otherwise Gatekeeper blocks). Budget time for this; it's the unglamorous part that decides whether non-technical users can install.
