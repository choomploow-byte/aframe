# Manual end-to-end: a real AI tool driving Atelier

Everything below the model is automated and passing (the built MCP server, the real `claude mcp` CLI in an isolated config, the live app in Chrome, and the production desktop window; see `docs/06` test matrix). The one thing a script cannot do is **be a model**: let Claude Code or Codex decide to use the tools. This is that check, about five minutes. Please report what you see at each step.

## Before you start
1. Install Atelier (or run `npm run tauri:dev`) and open it once, so `~/.atelier/mcp/atelier-mcp.mjs` exists. Check:
   ```
   node "%USERPROFILE%\.atelier\mcp\atelier-mcp.mjs" doctor
   ```
   (macOS/Linux: `node ~/.atelier/mcp/atelier-mcp.mjs doctor`.) Everything should say `[ok]` except hosts you have not set up yet.
2. Keep the Atelier window **visible** while testing (screenshots also work minimised, but you want to watch).
3. If you would rather not touch your real Claude Code config first, use a scratch one: set `CLAUDE_CONFIG_DIR` to an empty folder before starting `claude`.

## A. Claude Code
1. In Atelier: top bar **Connect AI**, tab **Claude Code**, **Copy**. (The text has the real path in it.)
2. Open Claude Code in any folder, paste, press Enter. Expected: it runs `node "…atelier-mcp.mjs" install --claude`, which prints `[ok]` lines, then reports the atelier tools.
   - If the tools do not appear: run `/mcp`, restart Claude Code, run `node "…" doctor`. Note what `doctor` says.
3. In the Connect dialog, the pill in the top bar should be green and the test line should say connected. Ask Claude something that uses a tool (step 5): the test line turns "your AI tool just used Atelier".
4. Create or open a project in Atelier (the sample is fine).
5. Say: **`in atelier, improve my design`**. Expected, in order:
   - it looks at the design (`get_design`), loads a skill (`load_skill`), edits (`apply_changes`), and **takes a screenshot** (`screenshot`);
   - on the canvas you see the changes arrive live: an "An AI is editing…" chip, a brief pulse on what changed, and a toast "The AI changed the design" with **Undo**;
   - Ctrl+Z in Atelier takes the whole change back in one step.
6. Select a frame in Atelier and say **`in atelier, make the selected frame more premium`**. It should call `get_selection` and edit that frame.
7. Add an annotation (Phase 6 adds the pin tool; until then ask: `in atelier, leave a note on the headline saying why you chose that font`) and check `get_annotations` / `resolve_annotation` are used.
8. Close the Atelier window and ask Claude to change a colour. Editing should still work; a screenshot request should answer with a clear "open Atelier" message.

### What to report
- Did Claude Code **show the screenshot image** inline? If it only showed text, say so: the tool also saves each screenshot as a PNG (the `path` in its result, under `~/.atelier/exports/screenshots/`) and Claude can open that file instead.
- Any step where it took more than about 20 seconds, asked for permission unexpectedly, or used the wrong tool.
- The exact wording of any error.

## B. Codex
1. Connect dialog, tab **Codex**, Copy, paste into Codex.
2. Expected: `~/.codex/config.toml` gains a block between `# >>> atelier …` and `# <<< atelier <<<` with `[mcp_servers.atelier]`, and `~/.codex/AGENTS.md` gets a short Atelier note. Restart Codex.
3. Repeat A5 with Codex. Codex's default tool timeout is 60 s; Atelier sets 120 s for itself. Report whether screenshots come back, and whether Codex displays or merely mentions the image.

## C. Cursor (optional)
`node "…atelier-mcp.mjs" install --cursor`, reload Cursor, check Settings > MCP shows `atelier` with its tools.

## Undo everything
```
node "…atelier-mcp.mjs" uninstall
```
removes only what `install` added (and each edited file keeps a `.atelier-bak` copy of the original).
