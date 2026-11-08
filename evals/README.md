# Evals

A fixed set of ten design tasks, a runner that drives the real in-app assistant on each, automatic
scores, and a rubric for the human rating. Its job is to tell you whether a change to a skill, the
system prompt or a tool made the assistant better or worse, instead of guessing.

## What a run does

For each task (`tasks.ts`): build the starting design in code (the same bytes every time), select the
layer the task names, send the task's prompt through the **same loop, tools, system prompt and
screenshots as the desktop app** (headless Chrome running the app), then measure the result:

| Measure | Meaning | Bar |
|---|---|---|
| Auto-layout % | frames with children that use row/column layout | at least 80 (not judged on free-placed designs such as a game HUD) |
| On-scale spacing % | gap and padding values on the spacing scale or a multiple of 4 | at least 90 |
| Contrast errors | text below 3:1 against its background | 0 |
| Token % | colours that are tokens | at least 80, for the task that asks for tokens |
| Nodes changed | how much of the design changed | an edit task must change something; the critique task must change nothing |
| Screenshots, tokens in/out | did it check its own work; what it cost | reported, not scored |

A task "meets the automatic bars" only if all of its bars hold. That is necessary, not sufficient: a
design can pass every number and still look dull. The human rating (`RUBRIC.md`) is the real score.

## Running it

```bash
# No key, no network: a scripted baseline that only applies the design check's fixes.
npm run eval:reference

# A live model (your key stays in this process; the page only asks it to send a request).
ANTHROPIC_API_KEY=... npm run eval -- --provider anthropic --model claude-sonnet-5-5
OPENAI_API_KEY=...    npm run eval -- --provider openai --model <model name>
EVAL_API_KEY=...      npm run eval -- --provider custom --base-url http://localhost:11434/v1 --model <name>

# Replay the responses a live run recorded (no key, no network): same tools, same scores.
npm run eval -- --replay evals/out/<run folder>

# One task:  --task improve-cramped-pricing      Another folder:  --out some/folder
```

Each run writes `evals/out/<mode>-<time>/` (ignored by git): `summary.md`, one JSON per task
(measures, tool calls, assistant text, tokens, seconds), a PNG of the result, the recorded provider
responses (live runs) and an empty `ratings.csv` for the human scores. Live runs cost real money:
start with one task.

## The reference baseline

`reference-agent.ts` is not a model. It looks, runs the design check, applies every fix the check
offers and takes a screenshot. It proves the harness works end to end without a key, and its scores are
the floor a real model has to beat: what mechanical fixing alone achieves. See `RESULTS.md`.

## Adding a task

Add an entry to `tasks.ts` (build its start in code; templates are seeded so ids are stable), say what
to look for in `humanFocus`, and add a bar if one of the defaults makes no sense for it.
`tests/node/evals.test.ts` checks that every task builds a valid design and selects a layer that exists.

## What this does not cover

- "Match this reference" and "rebuild this screenshot" need picture fixtures; the set above uses a
  written description for the build task instead. Add image tasks when you have reference images you
  may share.
- It judges one turn of one prompt. Long conversations and tool failures are covered by the unit tests
  for the loop (`src/chat/chat.test.ts`).
