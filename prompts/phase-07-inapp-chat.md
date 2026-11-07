# Phase 7: Inbuilt Chat with API Keys

**Read:** docs/08 (authoritative), docs/07 (Chat panel), docs/18 (key handling, CSP connect-src), `prompts/in-app-system-prompt.md`. **Verify current Anthropic and OpenAI API shapes, headers, model ids and browser-access requirements first.**

## Goal
Anyone with just an API key gets the same design superpowers inside the app.

## Tasks
1. **Provider layer** (`src/chat/providers/`): interface from docs/08; `anthropic.ts`, `openai.ts` (also used for custom OpenAI-compatible base URLs); injectable `fetchImpl` so a Tauri HTTP fallback can be swapped in if the webview blocks CORS. Convert provider-neutral messages to each provider's format including images and tool results (OpenAI image-in-tool-result workaround).
2. **Agent loop** (`agent.ts`): max steps, abort, repeated-failure breaker, history transaction per turn, screenshot trimming (keep last 3 full), usage accounting, structured events for the UI (text, tool_start, tool_end with summary, screenshot, error, done).
3. **In-app ToolContext**: getDoc/commit via store, screenshot via the same capture function as the bridge, getSelection from store. Use `core/tools.ts` handlers unchanged.
4. **Chat panel UI** per docs/07: messages, collapsible tool activity, inline screenshots, composer with image attach (paste/drag), `@` mentions for layers/references, model picker, Stop, token usage, suggested prompts, "Undo AI change" toast.
5. **Settings dialog**: provider, API key (masked, test button), model (editable with sensible defaults — verify current ids), base URL (custom), max steps, send-screenshots toggle, theme. Privacy notice on first use. Keys stored per docs/08 (MVP storage) behind an interface ready for keychain.
6. **Human error messages** for 401/403/429/5xx/network/CORS/context-too-long/unsupported-vision.
7. **Mock provider** for tests that scripts a deterministic tool-call sequence; e2e: send "improve the selected frame" -> tool calls applied -> one undo reverts.
8. Wire the system prompt (core design guidance + tool etiquette) and make `load_skill` available; the first user turn auto-includes a compact outline of the doc + selection summary.
9. Connect the Phase 6 "Ask AI to address notes" button.

## Acceptance
- With only an API key, "improve the selected frame" produces a visible improvement and the transcript shows at least one self-screenshot after edits.
- Stop halts within ~1 s with no further edits. One Ctrl+Z reverts an entire AI turn.
- Bad key / rate limit / offline produce friendly, actionable messages.
- No key appears in logs, project files, or exported diagnostics (test it).

## Report back with
Which providers/models you verified live (and which only against mocks), CORS findings in the webview, and token usage for a typical improve task.
