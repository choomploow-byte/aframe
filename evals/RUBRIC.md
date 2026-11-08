# Human rating rubric

Rate each task's result (the PNG in the run folder, and the design in the app if you want to look
closer) from 1 to 5 in `ratings.csv`. Look at the picture first, then at the assistant's words.

| Score | Meaning |
|---|---|
| 5 | You would ship it. Clear hierarchy, consistent spacing, nothing to fix, and it did what was asked. |
| 4 | Good, with one small thing you would tweak. |
| 3 | Better than before, but a visible flaw remains (cramped, flat, mismatched). |
| 2 | Barely changed, or changed in ways that do not help. |
| 1 | Worse than before, broke the layout, lost the person's content, or did something other than asked. |

Also note, in `notes`, anything from this list that happened (they matter more than the score):

- it changed copy or structure the person did not mention;
- it never took a screenshot, or took one and ignored a visible problem;
- it said something is done that is not;
- it used jargon or layer ids in its summary;
- it positioned things by hand where auto-layout was the right tool;
- for the critique task: it edited the design.

Task-specific points are in `humanFocus` in `tasks.ts`. Rate a run at least twice (a day apart) before
trusting a difference smaller than one point: the same assistant varies between runs.

## Acceptance (docs/12, Phase 9)

Average of 4 or more over the ten tasks with a strong model, and the automatic bars met on every edit
task. Neither has been measured with a live model yet (see `RESULTS.md`).
