# 15. Risks and Open Questions

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Crowded market / first-party competition** (AI design in major tools, hosted builders) | High | High | Stay open, local, agent-agnostic; own the annotate-see-improve loop and skills ecosystem; move fast to a demo |
| 2 | **Scope explosion** (Figma-class editor) | High | High | Hard MVP cut line (doc 02); ship Phase 6 as first public milestone; no pen tool/vectors |
| 3 | **AI design quality is generic** | High | High | Skills, lint, token-first workflow, reference-matching pipeline, eval harness; invest more in prompts/skills than in editor chrome |
| 4 | **Webview inconsistencies** (WebKit vs WebView2) break screenshots/export | Medium | Medium | Cross-OS CI fixtures; fallback Chromium sidecar for screenshots |
| 5 | **Code signing/notarisation friction** blocks non-technical installs | High | Medium | Budget time/money early (Apple dev account, Windows cert or Azure Artifact Signing, formerly Trusted Signing; EV certs no longer give instant SmartScreen reputation); document workarounds for alpha |
| 6 | **MCP host differences** (config paths, flags, tool-name display, image support in tool results) | Medium | Medium | `doctor`, tested on Claude Code + Codex + Cursor, fallbacks that print manual steps; re-verify with each host release |
| 7 | **Image results in MCP not rendered by some hosts** | Medium | High | Fallback: save PNG to `~/.aframe/exports/` and return the path + textual description; `screenshot` supports `mode: 'inline'|'file'` |
| 8 | **Concurrent edits** (user + agent) cause lost updates | Medium | Medium | Dirty-node merge, atomic batches, undo-per-AI-turn, optional lock later |
| 9 | **Prompt injection** via annotations/imported text/screenshots | Medium | Medium | Treat as data, no shell/network tools, confined file writes, user-confirmed outDir |
| 10 | **Exporter fidelity/ugly code** disappoints devs | Medium | High | Semantic tags, tokens -> CSS vars, round-trip pixel tests, README in output, iterate with real repos |
| 11 | **Figma/Canva import expectations** | High | Medium | Honest UI copy, import report, route Canva via export+rebuild, document limits |
| 12 | **API key security perception** | Medium | Medium | Keychain in v0.2, no telemetry, clear docs, open code |
| 13 | **Perf with large docs** | Medium | Medium | Memoised NodeView, culling, `contain`, outline-trimmed tools; benchmark in CI |
| 14 | **Name/trademark collision** | Medium | Medium | Check early; keep name in a single constant + search/replace script |
| 15 | **Maintainer burnout** | Medium | High | Narrow scope, strong contribution paths (skills), automation, clear roadmap |

## Open questions (decide early, record in doc 20)
1. Name (final). 
2. MIT vs Apache-2.0.
3. Tailwind export in MVP, or CSS-modules only? (Recommend: both, Tailwind via arbitrary values.)
4. Do we support **rotation** in MVP? (Recommend no.)
5. Where do large assets live: data URLs in JSON (MVP) vs `assets/` folder (v0.2)? (Recommend: switch to folder before 0.2 to keep JSON diffable.)
6. Does `screenshot` default to including annotations? (Recommend: off by default; agents ask via `get_annotations` and request overlay explicitly.)
7. Single window multi-project vs one project per window?
8. Ship a bundled Chromium sidecar for screenshots/"import running app"? (Recommend: not in 0.1.)
9. Telemetry: none (recommended).
10. How to handle **responsive design** (breakpoints) in the scene graph: separate frames per breakpoint (MVP, simplest) vs constraint-based? (Recommend separate frames + a "make mobile version" agent flow.)

## Kill criteria / pivot signals
- After alpha, if < 30% of testers reach "first improved design" in 10 min -> fix onboarding before adding features.
- If hosts don't reliably render MCP images -> prioritise in-app chat and file-path fallback.
- If agents produce mediocre output even with skills -> invest in structured "design planning" step (style brief) before edits.
