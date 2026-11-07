# 09. Install and Onboarding ("one command / one piece of text")

Requirement: a brand-new vibe coder can get Claude Code (or Codex) talking to Atelier in under a minute with a single paste.

## The three install routes

### Route 1: Paste-into-Claude text (most beginner friendly)
The Connect dialog shows a block like:

> Install the Atelier design app for me. Run: `node "<HOME>/.atelier/mcp/atelier-mcp.mjs" install --claude`. Then confirm the `atelier` tools are available, read the `atelier` skill, and tell me how to use it. From now on, when I ask you to design or improve UI, use the Atelier tools.

`<HOME>` is filled in with the user's real path by the app. Claude Code runs the command, which:
1. Registers the MCP server: runs `claude mcp add --scope user atelier -- node "<path>"` (falls back to editing `~/.claude.json` if the `claude` CLI isn't on PATH, or prints exact manual steps).
2. Writes `~/.claude/skills/atelier/SKILL.md`.
3. Prints "Restart or reload Claude Code if tools don't appear."

### Route 2: One terminal line
```
node ~/.atelier/mcp/atelier-mcp.mjs install
```
Auto-detects Claude Code, Codex, Cursor and installs for each one found (asks which, or `--all`).

### Route 3: Package-manager line (after public release)
```
npx -y atelier-mcp install
```
The npm package contains the same single bundle. Good for users who haven't launched the app yet and for docs/README.

## What `install` does per host
| Host | MCP registration | Skill / instructions |
|---|---|---|
| Claude Code | `claude mcp add --scope user atelier -- node <path>` (or JSON edit) | `~/.claude/skills/atelier/SKILL.md` |
| Codex | Append `[mcp_servers.atelier] command="node" args=["<path>"]` to `~/.codex/config.toml` (idempotent, backup first) | Append a marked block to `~/.codex/AGENTS.md` |
| Cursor | Merge into `~/.cursor/mcp.json` | `.cursor/rules/atelier.mdc` (optional) |
| Generic | Print JSON snippet `{ "mcpServers": { "atelier": { "command": "node", "args": ["<path>"] } } }` | n/a |
All edits: idempotent, create backups (`*.atelier-bak`), never clobber unrelated config, print a diff-like summary. `uninstall` reverses cleanly. `doctor` checks Node version, file presence, host registrations, app heartbeat.

> Config file locations and CLI flags change between host versions. Claude Code must **verify current docs** (Claude Code MCP docs, Codex config docs) and adapt the installer, with fallbacks that print manual steps.

## First-run experience (app)
1. App launches -> writes `~/.atelier/mcp/atelier-mcp.mjs` + skills (overwrites only if bundled version is newer).
2. Welcome screen -> *Connect Claude Code / Codex*, *Use an API key*, *Explore the sample*.
3. Connect dialog polls `state.json.lastAgentSeen` (the MCP server touches it on every call) -> green tick when first tool call arrives.
4. Suggests first prompts: *"in atelier, improve my design"*, *"in atelier, rebuild this screenshot"* (drag an image to Claude), *"in atelier, make this look like [reference]"*.

## Zero-setup understanding
Even if only the MCP is registered (no skill), the server `instructions` and `list_skills`/`load_skill` mean the agent learns the workflow by itself. The skill file is an extra that improves triggering ("improve my UI" -> uses Atelier without being told).

## Using it from Claude Code (user docs snippet)
```
> in atelier, improve my design
> in atelier, make the hero feel more premium and follow reference "stripe-home"
> in atelier, address my annotations
> in atelier, export the pricing frame as React into ./src/components
> in atelier, make this mobile friendly
```

## Updating
- App update replaces the bundle at `~/.atelier/mcp/`; host config points to that stable path so no re-install is needed.
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
