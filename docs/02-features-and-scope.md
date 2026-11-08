# 02. Features and Scope

Legend: **MVP** = must ship in v0.1. **v0.2** = next. **Later** = roadmap.

## A. Canvas editor
| Feature | Tier |
|---|---|
| Infinite canvas with pan (space-drag / middle mouse / trackpad) and zoom (ctrl+wheel, pinch, shortcuts) | MVP |
| Top-level frames as artboards (device presets: desktop, tablet, mobile) | MVP |
| Shapes: rectangle, ellipse, line; text; image | MVP |
| Select, multi-select (shift/marquee), move, resize, nudge with arrows | MVP |
| Snapping + alignment guides, smart spacing hints | MVP |
| Align/distribute tools | MVP |
| Auto-layout on frames (row/column, gap, padding, align, justify, wrap) | MVP |
| Sizing modes: fixed / hug / fill | MVP |
| Fills (solid, linear/radial gradient), strokes, corner radius, opacity, shadow, blur | MVP |
| Text: font family (bundled set), size, weight, line height, letter spacing, align, inline edit | MVP |
| Layers panel: tree, rename, show/hide, lock, drag-reorder | MVP |
| Properties panel (context-aware) | MVP |
| Undo / redo (coalesced), copy/paste/duplicate/delete | MVP |
| Design tokens (colours, fonts, spacing) with `$token` references | MVP |
| Rotation | v0.2 |
| Groups / boolean ops / pen tool | Later |
| Components + variants + instances | v0.2 |
| Multi-page documents | v0.2 |
| Constraints / responsive preview (resize frame, see layout reflow) | v0.2 |
| Prototype links / interactions | Later |
| Icons library (Lucide bundled, searchable) | v0.2 |
| Stock/placeholder images, avatar generators | v0.2 |

## B. AI integration
| Feature | Tier |
|---|---|
| MCP server exposing all design tools (see doc 05) | MVP |
| One-line install for Claude Code; Codex support | MVP |
| Server `instructions` so the agent understands AFrame with zero setup | MVP |
| Screenshot tool (frame or node, optional annotation overlay) | MVP |
| `get_selection` ("improve what I have selected") | MVP |
| Annotations: pins and regions with comments; agent reads/resolves them | MVP |
| Reference images attached to a project; agent compares against them | MVP |
| Inbuilt chat with API key (Anthropic, OpenAI, OpenAI-compatible URL) | MVP |
| Chat image attachments ("rebuild this screenshot") | MVP |
| Design skills library, loadable by agent via `load_skill` | MVP |
| `lint_design` automatic checks (contrast, tiny text, spacing inconsistency, overflow, off-grid) | v0.2 |
| Local models via Ollama / LM Studio (OpenAI-compatible) | v0.2 |
| Streaming responses in chat | v0.2 |
| Variations: "give me 3 options" side by side | v0.2 |
| Agent action history with per-step undo | v0.2 |
| API keys in OS keychain | v0.2 |

## C. Import / export
| Feature | Tier |
|---|---|
| Import image/screenshot as image node or as reference | MVP |
| "Rebuild from screenshot" (AI recreates as editable nodes) | MVP |
| Import SVG (basic shapes/text) | v0.2 |
| Export PNG / SVG / PDF of frame | MVP (PNG, SVG), v0.2 (PDF) |
| Export HTML+CSS | MVP |
| Export React (TSX) with CSS or Tailwind | MVP |
| Export design tokens (CSS variables / Tailwind config / JSON) | v0.2 |
| Figma import via REST JSON (needs token; Rust-side HTTP) | v0.2 |
| Figma two-way via Figma MCP / plugin | Later |
| Canva import via exported PDF/SVG/PNG + AI rebuild | v0.2 |
| `.fig` binary import | Not planned (proprietary) |

## D. App / platform
| Feature | Tier |
|---|---|
| Tauri desktop app: Windows, macOS, Linux installers | MVP |
| Light/dark theme, Claude-like clean UI | MVP |
| Project files on disk, recent projects, autosave | MVP |
| Connect dialog showing copy-paste setup for Claude Code / Codex / Cursor | MVP |
| Settings (API keys, model, theme, paths) | MVP |
| Auto-update | v0.2 |
| Code signing / notarisation | v0.2 (needed for smooth installs) |
| Plugin/extension API | Later |
| Optional collaboration | Later |

## Explicit MVP cut line
If scope must shrink: drop gradients UI, snapping, multi-select marquee, Figma anything, PDF, Tailwind export. **Never drop**: auto-layout, screenshot tool, MCP, annotations, reference images, export to React, skills.
