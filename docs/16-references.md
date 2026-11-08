# 16. References and Further Reading

> Links are the canonical starting points as of writing. **Claude Code must re-check each against current docs before relying on specifics** (APIs, flags and config paths change). Where a URL has moved, search the site.

## Protocols and platforms
| Topic | Where |
|---|---|
| Model Context Protocol (spec, concepts) | https://modelcontextprotocol.io |
| MCP TypeScript SDK | https://github.com/modelcontextprotocol/typescript-sdk |
| Claude Code docs (MCP, skills, settings) | https://docs.claude.com (Claude Code section) |
| Anthropic API docs (messages, tool use, vision, models) | https://docs.claude.com |
| OpenAI API docs (function calling, vision) | https://platform.openai.com/docs |
| Codex CLI (config, MCP servers, AGENTS.md) | https://github.com/openai/codex |
| Tauri 2 docs (commands, plugins, bundling, signing, updater) | https://tauri.app |
| Tauri prerequisites per OS | https://tauri.app/start/prerequisites/ |
| Tauri GitHub Action | https://github.com/tauri-apps/tauri-action |

## Libraries
| Library | Where |
|---|---|
| html-to-image | https://github.com/bubkoo/html-to-image |
| Zustand | https://github.com/pmndrs/zustand |
| Fontsource (bundled fonts) | https://fontsource.org |
| Lucide icons | https://lucide.dev |
| esbuild | https://esbuild.github.io |
| Vitest | https://vitest.dev |
| pixelmatch (visual diff) | https://github.com/mapbox/pixelmatch |
| Puppeteer | https://pptr.dev |

## Design-tool and market references (study these, don't copy them)
- Figma (auto-layout behaviour, properties panel conventions, REST API docs at https://www.figma.com/developers/api)
- Figma's developer tooling for AI/Dev Mode (check current MCP/Dev Mode docs)
- Canva developer platform (https://www.canva.dev) for what's possible/not
- tldraw (https://tldraw.dev) and Excalidraw for infinite-canvas interaction patterns
- Penpot (open-source design tool, SVG-native) https://penpot.app: licence and architecture worth studying
- Onlook (open-source visual React editor), v0, Lovable, Bolt, Google Stitch, Magic Patterns, Subframe: for positioning and UX
- Style Dictionary (design tokens) https://styledictionary.com

## Design knowledge (feeds `skills/`)
- Refactoring UI (Wathan & Schoger): practical visual-design rules for developers
- Material Design 3 and Apple Human Interface Guidelines: spacing, type, touch targets, patterns
- WCAG 2.2 and the APCA contrast discussion: accessibility
- "Laws of UX" for hierarchy/proximity/etc.
- Modular scale tools (type-scale.com) for scale ratios
- Radix Colors / Tailwind palette: colour scales designed for UI
When writing skills, **paraphrase and synthesise in original words**; do not copy text from books or sites.

## Reference implementations to read before building specific parts
| Part | Study |
|---|---|
| Canvas interactions, snapping | tldraw source (check its licence before borrowing any code) |
| Auto-layout semantics | Figma docs + CSS Flexbox spec |
| MCP stdio servers | Official `@modelcontextprotocol/servers` examples |
| Tauri fs/permissions | Tauri v2 capabilities docs |
| DOM-to-code | Any "Figma-to-React" converter write-ups |

## Internal cross-references
`docs/05` tools ⇄ `docs/04` model ⇄ `docs/06` sync ⇄ `docs/09` install ⇄ `skills/aframe-SKILL.md` (must stay consistent: see doc 20 checklist).
