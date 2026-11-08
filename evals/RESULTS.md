# Results

Rows are added when a run is done; nothing here is estimated.

## Reference baseline (scripted, no model), 2026-11-08

`npm run eval:reference`. This is the floor: the design check's own fixes, applied mechanically.

| Task | Auto-layout % | On-scale spacing % | Contrast errors | Nodes changed | Screenshots | Automatic bars |
|---|---|---|---|---|---|---|
| improve-cramped-pricing | 100 -> 100 | 97 -> 100 | 7 -> 0 | 9 | 1 | met |
| polish-landing | 100 -> 100 | 86.4 -> 100 | 0 -> 0 | 5 | 1 | met |
| fix-contrast-and-sizes | 50 -> 50 | 0 -> 100 | 1 -> 0 | 4 | 1 | not met |
| mobile-version | 100 -> 100 | 100 -> 100 | 0 -> 0 | 0 | 2 | not met |
| tokenise-colours | 50 -> 50 | 0 -> 100 | 1 -> 0 | 4 | 1 | not met |
| critique-only | 100 -> 100 | 97 -> 97 | 7 -> 7 | 0 | 2 | met (nothing changed, as required) |
| address-notes | 100 -> 100 | 100 -> 100 | 0 -> 0 | 0 | 2 | not met |
| build-login-card | 100 -> 100 | 100 -> 100 | 0 -> 0 | 0 | 0 | not met |
| game-button-states | 52.9 -> 52.9 | 100 -> 100 | 0 -> 0 | 0 | 2 | not met |
| dashboard-hierarchy | 100 -> 100 | 100 -> 100 | 0 -> 0 | 0 | 2 | not met |

Mean after: auto-layout 85.3%, on-scale spacing 99.7%, contrast errors 0.7. Tasks meeting every
automatic bar: 3 of 10.

Reading it: mechanical fixing is enough for the two "improve it" tasks whose problems are contrast and
spacing (it takes the cramped pricing page from 7 contrast errors to 0). It cannot do anything that needs
a decision: building a card, making a mobile version, answering notes, adding states, moving colours
into tokens, or creating a focal point. Those are what a model has to add.

## Live models

None run yet. The harness is verified: it ran all ten tasks through the real assistant loop, tools,
undo and screenshots, and the measures behave as intended on seeded designs (see
`tests/node/evals.test.ts`). The acceptance bar (average human rating of 4 or more; at least 80%
auto-layout, 0 contrast errors and at least 90% on-scale spacing after the agent's edits) needs a live
model and a person to rate. To fill this in:

1. `ANTHROPIC_API_KEY=... npm run eval -- --provider anthropic --model claude-sonnet-5-5`
2. Open the run folder and rate each PNG in `ratings.csv` using `RUBRIC.md`.
3. Add a table here with the date, model, the automatic summary, the mean rating and the three things
   that most improved or hurt the score. Re-run after changing a skill or the system prompt and add a
   before/after row.
