# 01. Vision and Positioning

## Problem
AI coding agents produce working apps with generic or ugly UI. Non-designers can't judge or fix it: they lack vocabulary ("make it less cramped"), taste, and tools. Design tools (Figma, Canva) are built for humans with design skill and aren't agent-native. AI app builders (v0, Lovable, Bolt) generate code directly, usually hosted, subscription-based and tied to one model.

## Solution
A local, open-source design canvas that is **agent-native**:
- Agents act on it through MCP tools and can see the result.
- Humans can point at things ("this feels off") with annotations instead of design vocabulary.
- Taste is packaged as skills the agent loads.
- Output lands as real code in the user's repo.

## Positioning statement
*For developers who build with AI but can't design, Atelier is the open-source design studio that lets your own AI agent design, see, and refine real UI, then writes it into your codebase. Unlike hosted AI builders, it runs on your machine with your own model and keys.*

## Differentiators (in priority order)
1. **Bring your own agent**: Claude Code, Codex, Cursor, or an API key in the inbuilt chat.
2. **See + annotate + improve loop**: screenshots and pinned comments feed back to the agent.
3. **Design lands in your repo**: component export, not a walled garden.
4. **Open source + local**: no account, no lock-in, files are plain JSON.
5. **Taste skills**: community-extensible design knowledge.

## Competitive landscape (verify before launch, this moves fast)
| Product | What it is | Gap Atelier fills |
|---|---|---|
| v0 (Vercel), Lovable, Bolt | Hosted prompt-to-app builders | Hosted, subscription, one model, not a visual editor |
| Figma (+ Figma Make, Dev Mode MCP) | Pro design tool with AI features | Not agent-native, steep for non-designers, closed |
| Google Stitch, Magic Patterns, Subframe | AI UI generators | Hosted, limited BYO-agent |
| Onlook | Open-source visual editor for React apps | Edits existing code visually; different workflow |
| Anthropic's own design tooling | First-party AI design surface | Not open, tied to one vendor |
| Canva | Template-based graphic design | Not for app UI; closed format |

Strategy: don't compete on "AI makes UI". Compete on **openness, agent-agnosticism, local-first, and the visual feedback loop for non-designers**.

## Success metrics
- Time from install to first AI-improved design: under 5 minutes.
- Install steps for Claude Code connection: 1 (paste one line / one prompt).
- Weekly active projects, GitHub stars, number of community skills.
- Qualitative: "my app finally looks professional".

## Principles
1. **Restraint in UI**: whitespace, one accent colour, few panels. Calm like the Claude app.
2. **The document is the product**: everything is a tool call against the document.
3. **Agent and human are equals**: anything a human can do in the UI, the agent can do via tools, and vice versa.
4. **Local-first, plain files**.
5. **Opinionated defaults**: good design out of the box, minimal choices needed.
6. **Honest limits**: say clearly what imports/exports are approximate.
