# Verification-fleet plan — draining the rest of the 2026-09-03 register

**Snapshot 2026-09-09, `main @ adb6b54c0`.** Eight agents re-verified 30 register rows by generating
and reading output. Their verdicts and the new findings are in
[`2026-09-03-language-docs-audit-findings.md`](2026-09-03-language-docs-audit-findings.md); this file
is the ORDER, and the six decisions that gate it.

Per the repo's rule, `docs/new-plan/` is the only authoritative status table. This is a plan snapshot,
not a status register — if the two disagree later, the track file wins.

## What re-verification changed

Of 30 rows examined: **6 were already fixed on `main`**, **5 understated their finding**, **2 named the
wrong symptom**, and **2 were decisions rather than defects**. That is a 50% correction rate, and it is
the argument for the rule the register already carries: run the repro before believing the row.

The two don't-fix verdicts are worth recording so nobody reopens them:

* **F20 — a value object mapping to an Ecto `:map` column is a DECISION.** The wire is byte-identical
  to the other four backends, each backend owns its own database, and `03-domain-modeling.md:184`
  already documents it. Changing the migration emitter would break every existing Phoenix deployment's
  schema for zero wire gain. (There IS a real docs defect beside it: `docs/generators.md:996,1031`
  claim `embedded_schema` / a custom `Ecto.Type` for value objects, and the emitter returns `:map`
  unconditionally.)
* **F29 / F28 — two unreachable gates are DORMANT SAFETY NETS, not dead code.** Both are pinned
  `LATENT_GATES` entries in the firing census. Reword; do not delete.

## The order

### Tier 0 — make the later gates mean something (do first)

| # | Work | Size | Why first |
|---|---|---|---|
| 0.1 | **F63** — fix `WALKER_GLOBS` in `walker-give-up-routing.test.ts` (two entries per tree: `<t>/*.ts` AND `<t>/**/*.ts`), then drain or allowlist the 28 sites it newly sees. | S to fix, L to drain | Every sentinel-based conformance gate is a no-op until this lands. Split the glob fix from the drain. |
| 0.2 | **F65** — re-measure `pr-gate` dispatches WITHOUT a branch filter, then correct `pr-gate.yml`, `docs/ci-gating.md` and PR #2835, which all rest on the artifact. | S | Three artefacts and one open PR currently encode a false premise. |
| 0.3 | **F64 / F55 slice 0** — the per-file code-less ratchet (12 rows, exact counts, shrink-only) + a `UNDOCUMENTED_CODES` length baseline + an assertion that no firing fixture raises `loom.unknown`. | S/M | Stops the class growing; the 123-condition drain is ~10 further slices, ~70-78 h. |

### Tier 1 — the P0s, cheapest first

| # | Work | Size | Note |
|---|---|---|---|
| 1.1 | **F66/F56** — promote `classifyFelizAsyncEffect` to a target-agnostic gate; delete the three private copies of its resolver. | S/M | Zero good-path blast radius. Closes the `Promise.reject` crash. |
| 1.2 | **F19** — Java renders a guarded invariant without its guard. One arm of `buildChecks`; `dotnet/validator-emit.ts:167` is the template. | S | Behaviour-restoring, no sign-off. |
| 1.3 | **F62/F11** — mint `loom.destroy-form-of-unresolved` (3 `#`-slugs) at phase ⑦; optionally fix the Feliz emitter too. | M | Corpus blast radius checked: nothing currently fails. |
| 1.4 | **F17** — one arm in `checkUserComponentSupport` + invert the test that pins the falsehood. **No new code.** | S | A test currently asserts "an extern component is never gated" across all frameworks including Flutter. |
| 1.5 | **F58** — `create` on a state-bearing workflow, five backends. | M | Should be scheduled with Wave 1's class. Blocks W6.1 option (a). |
| 1.6 | **F59** — error-variant binding dropped on .NET and Java. | M | Must land before W3.1's message recommends that form. |
| 1.7 | **F60** — Elixir derived-reads-derived; gate on `required:` ≡ `serialize/1` key set, not per-key. | M/L | Touches `render-expr.ts`'s `ref` leaf, widest reach in its packet. |
| 1.8 | **F61** — HEEx workflow form. **Split out**: shipping the field set without the `handle_event` clause looks correct and still 500s. | L | Route as its own mission. |
| 1.9 | **F18** — Java `ignoring` on two of four read surfaces. The relational half is S/M; the document-store half needs the principal conjunct hoisted out of the shared `findAll()`. | S/M + M | Java already has the correct implementation in `query-projection-reads.ts:161`. |

### Tier 2 — Wave 7, parallel with everything

W7.1 is now pure transcription: all ten rows verified still-wrong with the proving `file:line` in hand,
four of them single-token edits, three of them proven parse errors a reader would hit as a hard failure.
W7.2's headline (F47) is **already fixed** — the sixth stale row — but the residue is real and is worth
more than the row: 30 of 219 fragment links are dead, the slugger mis-handles nested inline markup
(7 headings), there is no `-1` de-duplication, and **the slug rule is written twice**
(`docs/build.mjs:64` and `src/diagnostics/code-docs.ts:23`) in two copies that already disagree. Do the
de-duplication first so the fix lands once.

### Tier 3 — placement gates and parity

W3.1 splits **three** ways, not two: `variant-match` outside a ui action is a permanent refusal;
`if let` outside a workflow is a permanent refusal (its only legal source is a repository read, which an
aggregate operation structurally cannot do); `for` outside a workflow is an **honest gap with no
workaround** and deserves a named successor mission rather than a quiet gate. Neither gate depends on
the `subjectType` work — both key on statement kind and sentinel name, never on a type.

Then W5.2/W5.3 in the order F20 (docs) → F22 → F60 → F61-split-out, and W5.1 per Tier 1.

### Tier 4 — the design missions

Only two, and neither should open as a fix packet: lowering `for` into a domain body, and whether
workflow `handle` should exist at all. On the latter, the evidence points at option (b): `handle` is not
entangled with channels (an entry point here is an HTTP route), but `HandleDecl` carries **no `by`
clause in the grammar**, so nothing says which saga instance to run against. That missing addressing
surface — not the emitter work — is the real question, and `commandHandler` already covers the use case
with a full emitter on all five backends.

## The six decisions this plan is blocked on

1. **`envelope` (F57)** — build the real `{id, ts, body}` wrapper (L, and blocked: nothing in the IR can
   source `ts`), ratify what node and python already do and admit the keyword carries no distinct
   meaning (M, purely subtractive), or refuse it until the first lands (S). The docs correction is true
   under all three.
2. **`handle` (F13)** — shipping surface, or redundant with `commandHandler` and therefore a removal
   track?
3. **`for` in a domain body (F4)** — permanent refusal, or a gap with a named successor mission?
4. **The auto-merge footgun** — a `PreToolUse` hook denying any method but `SQUASH`. Touches
   `.claude/settings.json` and `CLAUDE.md`, i.e. checked-in configuration.
5. **PRs #2832 and #2835** — they contradict each other factually and the one that measured is right;
   #2835's sweep throttle is ~6× too loose against a measured 255 runs/hour and a 1,000/hour ceiling.
   Merge, rebase, or supersede?
6. **The two don't-fix verdicts above** — acknowledge so they are not reopened.

## The recurring shape

Five of the six P0s survived for the same reason: **the corpus does not contain the shape.** `envelope`
has zero uses. No fixture pairs a workflow `create(params)` with `state {}`. The showcase declares no
`extern` component and no unresolvable `DestroyForm`. The leg that would catch the HEEx crash runs in
neither the per-PR set nor the merge queue.

A compile gate over a corpus that lacks the shape proves nothing. Where a fix below adds a gate, it
should add the fixture in the same wave — and, per `CLAUDE.md`, as a separate PR from the emitter fix
so a corpus-wide red does not block the behaviour change.
