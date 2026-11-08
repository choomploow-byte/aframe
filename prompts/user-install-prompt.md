# The text a new user pastes into Claude Code / Codex

The AFrame app's **Connect** dialog fills in `{PATH}` with the real absolute path to `aframe-mcp.mjs` (e.g. `C:\Users\Sam\.aframe\mcp\aframe-mcp.mjs` or `/Users/sam/.aframe/mcp/aframe-mcp.mjs`) and copies this to the clipboard.

---

## Claude Code version
```
Please set up the AFrame design app for me.

1. Run: node "{PATH}" install --claude
2. Check that the aframe MCP tools are available (if not, tell me how to restart/reload).
3. Read the aframe skill that was installed and the aframe server instructions.
4. Then tell me, in 3 short lines, how to ask you to design things with it.

From now on, whenever I ask you to design, improve, restyle or rebuild any UI, use the AFrame tools: look at the design first, make changes, take a screenshot to check your work, and keep fixing until it looks good. Keep my existing text unless I say otherwise.
```

## Codex version
```
Please set up the AFrame design app for me.

1. Run: node "{PATH}" install --codex
2. Confirm the aframe MCP server is configured (show me the relevant lines of ~/.codex/config.toml) and tell me if I need to restart Codex.
3. Remember for this project: when I ask you to design or improve UI, use the AFrame tools - inspect the design, edit it, screenshot it to verify, iterate.
```

## Terminal one-liners (for people who prefer them)
```
node "{PATH}" install            # detects Claude Code, Codex, Cursor and asks which
node "{PATH}" doctor             # checks everything is wired up
```

## Generic MCP JSON (any other host)
```json
{ "mcpServers": { "aframe": { "command": "node", "args": ["{PATH}"] } } }
```

## After install: example things to say
- "in aframe, improve my design"
- "in aframe, make the pricing page look more premium and follow my reference"
- "in aframe, address my annotations"
- "in aframe, rebuild this screenshot as an editable design" (attach an image)
- "in aframe, make a mobile version of the selected frame"
- "in aframe, export the landing frame as React into ./src/components"
