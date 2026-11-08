# 13. Testing and Quality

## Test pyramid
| Layer | Tooling | What |
|---|---|---|
| Unit (core) | Vitest | ids, normalize, ops, apply (atomic failure, tempIds), tokens resolve, `nodeToCss` snapshots, export string snapshots, lint rules, migrations |
| Unit (platform) | Vitest + fake fs | sync merge logic (dirty-node merge), debounce, request handler |
| MCP integration | `scripts/test-mcp.mjs` (SDK Client + stdio) | list tools, create project, batch ops, bad op atomicity, get_design shapes, export_code to temp dir, path confinement, simulated app screenshot responder, timeouts |
| UI e2e | puppeteer-core + system Chrome against `vite` dev server | create shapes, drag/resize, undo, auto-layout reflow, annotation flow, external file change reflected, chat with a **mock provider** |
| Visual regression | Screenshot fixtures (PNG) with pixel diff (pixelmatch) | Renderer + exporter fidelity |
| Desktop smoke | `tauri build` in CI on 3 OS + launch + check window | Packaging works |
| Agent evals | Script + rubric (doc 08) | Quality of AI behaviour; run manually/nightly with a real key |

## Definition of done (every phase)
1. Acceptance criteria in doc 12 demonstrably met (describe how verified).
2. `npm run typecheck`, lint, unit tests pass; new code has tests.
3. No `any` without a comment; no TODOs without an issue reference.
4. Docs updated (`docs/` and user docs where relevant).
5. Manually exercised in a browser (and in Tauri from Phase 4).
6. Changelog entry.

## Lint rules for `lint_design` (spec)
**As built (Phase 9):** every rule below exists under the id the code uses (`src/core/lint.ts`, `lint-extra.ts`): `contrast`, `text-size` (12px, 14px on frames 480 wide or less), `tap-target`, `spacing-scale`, `radius-consistency` and `radius-variety`, `overflow`, `unaligned` (look-alike siblings 1-3px apart), `too-many-fonts` (more than 2 families or 5 sizes in a screen; a board of reusable masters is exempt), `line-length`, `layer-name`, `image-alt`, `use-token`, `touching`, plus the game-UI rules. Each finding has `fix` (a sentence) and, where the answer is unambiguous, `fixOps`: operations `apply_changes` accepts as they are (a snapped number, the other sibling's value, black or white whichever reads better). A test applies every `fixOps` of a deliberately bad design and checks they all apply and clear their finding. The table below is the original spec.

| Rule id | Severity | Check |
|---|---|---|
| `contrast` | error | Text vs effective background < 4.5:1 (3:1 for >= 24px or >= 18.66px bold). Resolve background by walking ancestors' fills; if gradient/image, sample average or warn "can't verify" |
| `min-text-size` | warn | Body text < 12px (mobile < 14px) |
| `tap-target` | warn | Elements with role button/link/input smaller than 44x44 (mobile) or 32px high (desktop) |
| `off-scale-spacing` | info | gap/padding not in `tokens.spacing` or multiples of 4 |
| `inconsistent-radius` | info | > 3 distinct radii among siblings of same role |
| `overflow` | error | Child bounds exceed clipped parent / text overflows fixed height |
| `unaligned` | info | Sibling edges differ by 1-3 px (near-miss alignment) |
| `too-many-fonts` | warn | > 2 families or > 5 sizes in one frame |
| `line-length` | info | Text blocks > 80 chars wide at the font size |
| `missing-name` | info | Default names ("Frame 12") on non-trivial nodes |
| `missing-alt` | warn | Image nodes without `props.alt` |
| `hardcoded-colour` | info | Colours duplicated >= 3 times that match no token |
| `touching` | warn | Siblings with 0 gap in a row/column of text-bearing elements |
Each finding: `{ rule, severity, nodeId, message, fix?: Op[] }` so the agent can apply `fix` directly.

## Performance budgets
- Interaction latency (drag/resize/type): < 16 ms/frame on 500 nodes.
- Sync reflect of external change: < 700 ms.
- Screenshot round trip (1440x900): < 2.5 s.
- Cold start to interactive: < 2 s on a mid laptop.
- `get_design` outline of 1,000 nodes: < 20k tokens (trim by depth/limits).

## Fixtures to create early
`fixtures/sample-doc.json` (landing page), plus: dashboard, mobile app screen, pricing page with deliberately bad spacing (for improve evals), reference images folder, a Figma-API JSON sample, a screenshot-to-rebuild sample.

## CI (GitHub Actions)
- `ci.yml`: Node matrix 22/24 on ubuntu (Vitest 5 needs >= 22.12), plus a Windows Tauri build smoke job from Phase 4: install, typecheck, lint, unit, MCP integration, e2e (xvfb + Chrome).
- `release.yml`: on tag, `tauri-action` builds Windows/macOS/Linux, uploads to Release; signs when secrets exist; publishes `atelier-mcp` to npm.
- Dependabot weekly; `npm audit` + `cargo audit` in a nightly job.

## Bug-report quality
App has *Help > Copy diagnostics* (versions, OS, sync state, last 100 log lines, no keys/content). Issue template asks for it.
