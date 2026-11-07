# The text a new user pastes into Claude Code / Codex

The Atelier app's **Connect** dialog fills in `{PATH}` with the real absolute path to `atelier-mcp.mjs` (e.g. `C:\Users\Sam\.atelier\mcp\atelier-mcp.mjs` or `/Users/sam/.atelier/mcp/atelier-mcp.mjs`) and copies this to the clipboard.

---

## Claude Code version
```
Please set up the Atelier design app for me.

1. Run: node "{PATH}" install --claude
2. Check that the atelier MCP tools are available (if not, tell me how to restart/reload).
3. Read the atelier skill that was installed and the atelier server instructions.
4. Then tell me, in 3 short lines, how to ask you to design things with it.

From now on, whenever I ask you to design, improve, restyle or rebuild any UI, use the Atelier tools: look at the design first, make changes, take a screenshot to check your work, and keep fixing until it looks good. Keep my existing text unless I say otherwise.
```

## Codex version
```
Please set up the Atelier design app for me.

1. Run: node "{PATH}" install --codex
2. Confirm the atelier MCP server is configured (show me the relevant lines of ~/.codex/config.toml) and tell me if I need to restart Codex.
3. Remember for this project: when I ask you to design or improve UI, use the Atelier tools - inspect the design, edit it, screenshot it to verify, iterate.
```

## Terminal one-liners (for people who prefer them)
```
node "{PATH}" install            # detects Claude Code, Codex, Cursor and asks which
node "{PATH}" doctor             # checks everything is wired up
```

## Generic MCP JSON (any other host)
```json
{ "mcpServers": { "atelier": { "command": "node", "args": ["{PATH}"] } } }
```

## After install: example things to say
- "in atelier, improve my design"
- "in atelier, make the pricing page look more premium and follow my reference"
- "in atelier, address my annotations"
- "in atelier, rebuild this screenshot as an editable design" (attach an image)
- "in atelier, make a mobile version of the selected frame"
- "in atelier, export the landing frame as React into ./src/components"
