# Alpha test kit

For the first people who try Atelier. Ten tasks, a feedback form and how to send a useful report.

## Who to invite

People who already build software with an AI and are not designers: vibe coders using Claude Code,
Codex or Cursor, ideally on Windows (the only platform the author has run). Five to ten people. Ask them to
use their own API key or their own agent, not yours.

## Setup (10 minutes)

1. Install from the releases page (unsigned: Windows will warn once; *More info*, *Run anyway*).
2. Open it, press **Explore the sample project**.
3. Either **Connect AI** (paste into Claude Code or Codex) or the **Chat** tab and add a key.

## Ten tasks

Do them in order, on the sample project or your own. After each, note whether it worked, how long it took
and anything confusing. These are also the tasks in `evals/tasks.ts`, so results are comparable.

1. Select the cramped pricing page and ask for **"Improve the selected frame"**.
2. On the landing page ask for **"Make this look more professional"**.
3. Press **Check**, then **Fix automatically**. Is the result what you expected?
4. Ask for **"a mobile version of this screen, 390 wide, next to the original"**.
5. Ask the AI to **"put the colours in this design into tokens and use them everywhere"**.
6. Ask for **"Critique my design (no edits)"**. Did it change anything?
7. Drop two notes (press A) and press **Ask AI to address open notes**.
8. Ask for **a login card** (logo, heading, email, password, a primary button, a "forgot password" link).
9. Start from the **Game HUD** template and ask for buttons that react to hover and press.
10. **Export** a frame as React + Tailwind into a real project folder and run it. Did it look right?

If you have a Figma file, also try **Import > Figma** with one frame, and tell us what did not come across.

## Feedback form

Copy this into an issue or an email:

```
Atelier version: (bottom of the keyboard shortcuts sheet, Ctrl+/)      Windows / macOS / Linux:
How I connected: Claude Code / Codex / Cursor / built-in chat (provider and model):
Tasks tried (numbers):
What worked well:
What failed or confused me (task number, what I did, what I expected, what happened):
Did the AI's result look good? (1-5 per task):
Did anything feel unsafe or surprising (files written, keys, screenshots sent)?
Would I use this on a real project? What is missing?
```

## Sending a useful report

- **Recovery page** (the app failed): press **Copy diagnostics** and paste it. It holds the version, your
  system and the error: never your design, notes or keys.
- **The AI could not connect:** run `npx -y atelier-mcp doctor` (or `node atelier-mcp.mjs doctor` from the
  installed app's folder) and paste its output.
- **A bad result:** note the task, the model and the prompt. If you can, attach the screenshot the AI
  took (open the tool line in the chat) and say what looked wrong.

## What we are trying to learn

- Can someone go from install to a first good result without help in under ten minutes?
- Which tasks does the assistant fail at, and with which models?
- Are the plain-language messages enough to recover from a problem?
- Is anything surprising about what is sent where?
