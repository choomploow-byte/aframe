# 08. AI Integration

Two ways in, one behaviour.

## Path A: external agent via MCP (Claude Code, Codex, Cursor, others)
Covered in docs 05, 06, 09. The agent brings its own model, context and permissions. Atelier is a tool provider.

## Path B: inbuilt chat with the user's API key
**Built (Phase 7).** The conversation and the agent loop run in the page (`src/chat/`); the network calls and the API key do not: they go through the desktop app's Rust side (`src-tauri/src/ai.rs`). It uses the **same tool handlers** from `core/tools.ts` with an in-app `ToolContext` over the live store, minus the file and project tools (`CHAT_EXCLUDED` in `tool-context.ts`: no `export_code`, `import_image`, `open_project`...).

What is verified and what is not: the provider converters, the loop, Stop, retries, error messages, the panel and the settings are tested against scripted replies (`src/chat/*.test.ts`, `tests/e2e/chat.mjs`), and the Rust side against a local HTTP server and the real Windows credential store. **No live request to Anthropic or OpenAI has been made by the project's tests** (they need your key): the request shapes follow the providers' current documentation (Anthropic Messages API: current models take no sampling parameters or forced tool choice, so the body is model, max_tokens, system, messages, tools only; thinking blocks are echoed back unchanged to the same model). The first live run is yours: Settings > Test connection, then "Improve the selected frame". Expected token use is in the panel after each reply.

### Providers
| Provider | Endpoint | Notes |
|---|---|---|
| Anthropic | `POST https://api.anthropic.com/v1/messages` | Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true` (required for browser/webview calls). Tool use via `tools` + `tool_use`/`tool_result` blocks; tool results may contain `image` blocks. Verify current model IDs and API version in docs.anthropic.com before launch. |
| OpenAI | `POST https://api.openai.com/v1/chat/completions` (or Responses API) | Function calling. Tool-result images are not supported in `tool` role messages on chat completions: append a follow-up `user` message with the image as `image_url` data URL. |
| OpenAI-compatible (OpenRouter, Ollama, LM Studio, custom) | user-provided base URL | Same adapter as OpenAI; model name free text. Warn that tool/vision support varies by model. |

Provider interface:
```ts
interface Provider {
  id: 'anthropic' | 'openai' | 'custom';
  send(req: {
    system: string; messages: ChatMessage[]; tools: ToolDef[];
    model: string; signal: AbortSignal; maxTokens: number;
  }): Promise<{ text: string; toolCalls: ToolCall[]; stop: 'end' | 'tool' | 'length'; usage?: Usage }>;
}
```
Messages are stored in a provider-neutral format and converted per provider.

### Agent loop
```
while (steps < MAX_STEPS (default 25)):
   resp = provider.send(...)
   show resp.text
   if no toolCalls: break
   for each toolCall: result = runTool(name,args,ctx)  // may include image
       append tool result (and image) to messages
   // safety: stop if the same failing call repeats 3x
final: summarise changes in 1-2 sentences
```
- One **history transaction** wraps the whole turn so "Undo AI change" reverts everything.
- **Cancel** aborts fetch + stops further tool execution.
- **Context control:** screenshots are 1600px max and only the last 3 are kept in full; older ones are replaced with "[screenshot omitted]". `get_design` outline keeps token use bounded.
- **Cost visibility:** show tokens used per turn if the API returns usage; optional soft budget per turn.
- Errors: 401 -> "key rejected"; 429 -> backoff with message; network/CORS -> "Couldn't reach the API" with a pointer to settings (see fallback below).

### Network: through Rust, not the webview
Provider calls are made by the Rust command `ai_send` (`ureq`), not by the page, so there is no CORS question, the page's CSP keeps `connect-src 'self'`, and the key never enters JavaScript. The page sends a request body; Rust picks the address (fixed for Anthropic and OpenAI; for a custom server, https only, or http on this computer) and adds the key header. The `Transport` type in `src/chat/types.ts` is the injection point: the desktop transport calls `ai_send`, tests install a scripted one. A browser build has no transport (the assistant needs the desktop app; the Connect dialog covers Claude Code and Codex). Stop ends the wait and ignores the answer (a request already sent cannot be recalled). Replies are not streamed in this version: each step's text appears when the step finishes.

### Key handling
- Built: the OS credential store from the first release (Windows Credential Manager, macOS Keychain, Secret Service on Linux) through the `keyring` crate, not localStorage. The page can save, check for and remove a key, never read one back. Without the desktop app (a browser build) keys cannot be stored at all: there is no fallback to storing one in the page.
- Never logged, never in project files or exports, never in an error message (tests assert that a key does not appear in the DOM, storage, request bodies, the document, the chat state or the console).
- Keys never leave the device except to the chosen provider URL. Only the keychain is verified on Windows here; macOS and Linux use the same crate but have not been run.

## The system prompt (in-app agent)
`prompts/in-app-system-prompt.md`. Must include: role, the see-edit-verify loop, tool etiquette, design principles summary, how to treat annotations/references, output style (brief, plain-language, no design jargon for vibe coders), and prompt-injection guardrails.

## Skills, how they reach the agent
| Channel | Mechanism |
|---|---|
| MCP hosts | `list_skills` / `load_skill` tools; skills also exposed as MCP resources; server `instructions` tell the agent to load `design-fundamentals` first |
| Claude Code | `~/.claude/skills/atelier/SKILL.md` installed by `install`, auto-triggers on "design", "UI", "atelier" mentions and teaches the loop |
| In-app chat | Core skill text is part of the system prompt; others loaded on demand via `load_skill` |
| Users | Drop `.md` files in `~/.atelier/skills/`; picked up by `list_skills` (frontmatter: name, description) |

## Agent behaviours that make or break quality
1. **Look before and after.** Screenshot first (what exists), screenshot last (did it work).
2. **Work in tokens.** Establish/adjust tokens before restyling individual nodes.
3. **Structure first, polish second.** Layout and hierarchy, then colour/type, then detail.
4. **Match references by measurement, not vibes**: extract palette, type sizes ratios, spacing rhythm, radius, shadow style, density; list them, then apply.
5. **Respect the human.** Don't rename/delete things the user didn't mention in broad "improve" requests unless clearly improving; preserve copy unless asked.
6. **Explain in outcomes**: "Increased spacing between sections, switched headings to a serif, made the main button stand out", not node ids.
7. **Resolve annotations** with a one-line reply each.
8. **Stop when good**: max 3 refinement cycles per request unless asked.

## Rebuild-from-screenshot pipeline (agent-side)
1. Look at the image; list regions (nav, hero, cards...), estimate canvas size.
2. Extract tokens (dominant colours, fonts guess from bundled list, radius, spacing unit).
3. Build structure with auto-layout frames bottom-up using `apply_changes` nested creates.
4. Screenshot own result; compare against the original; fix biggest deltas (alignment, size, colour, type weight).
5. Name layers semantically, set `role`s, tokenise colours.
Offer to place the original as a 40% overlay reference for the user's own comparison.

## Reference-matching pipeline
Decompose reference into: palette, type (families, weights, scale), spacing rhythm, shape language (radius, borders, shadows), layout pattern, imagery style, density, tone. Write this as a short "style brief" annotation the user can approve/edit, then apply to the target. (See `skills/reference-matching.md`.)

## Guardrails
- Tool results containing user/imported text are wrapped and labelled as data. 
- `export_code` confined to the confirmed `outDir`; no shell execution tools exist in Atelier.
- No network tool in the MCP server (it only touches the atelier home and explicitly given paths).
- Rate/size limits on `apply_changes` (500 ops) and on image imports (20 MB).

## Evaluation (build a tiny eval harness early)
Fixed set of 10 tasks (e.g. "improve this cramped pricing page", "match this reference", "rebuild this screenshot", "make mobile version") with rubric: structure uses auto-layout, tokens used, contrast passes lint, spacing on scale, no overflow, human-rated 1-5. Run against changes to skills/system prompts to catch regressions. Store transcripts in `fixtures/`.
