# 17. Glossary

| Term | Meaning |
|---|---|
| **AFrame** | Placeholder product name |
| **Agent** | An AI (Claude Code, Codex, in-app chat) acting through tools |
| **MCP** | Model Context Protocol: standard for giving agents tools/resources |
| **Host** | The program running the agent and launching MCP servers (Claude Code, Codex, Cursor) |
| **Scene graph** | The tree/graph of design nodes (frames, text, shapes, images) |
| **Doc / project** | One JSON file describing a design project |
| **Node** | One element in the scene graph |
| **Page** | Invisible root node; its children are canvas frames |
| **Frame** | Container node; can auto-layout; top-level frames are artboards |
| **Auto-layout** | Flexbox-like flow layout (direction, gap, padding, alignment) |
| **Hug / Fill / Fixed** | Sizing modes: shrink to content / expand into available space / explicit pixels |
| **Token** | Named design value (colour, font, spacing, radius) referenced as `$name` |
| **Annotation** | A pin/region comment placed by a human or the agent on the canvas |
| **Reference** | Image(s) the design should resemble in style/layout |
| **Skill** | A markdown document of design knowledge/workflow loadable by an agent |
| **Lint** | Automatic design checks (contrast, spacing, etc.) |
| **Bridge** | The file-based request/response mechanism between MCP server and app |
| **Rev** | Monotonic revision counter in each doc |
| **Heartbeat** | The native side's periodic `app-state.json` update proving the app is alive (every 2 s, even when the window is hidden) |
| **Vibe coding** | Building software mostly by directing an AI, often without deep design/engineering skill |
| **Round-trip test** | Export code -> render -> screenshot -> compare to canvas screenshot |
| **Eval** | Repeatable test of AI output quality against a rubric |
| **Sidecar** | Helper process bundled with the app (e.g. headless Chromium), Later |
| **Tauri command** | Rust function callable from the WebView via `invoke` |
| **Capability** | Tauri permission config controlling what the WebView may call |
| **Notarisation** | Apple's malware-scan sign-off required for smooth macOS installs |
