# Wave C4 · packet 4d — callable unification (M-T5.21) + the `RouteTarget` decision (M-T9.26)

Branch: `claude/c4-callable`, cut from the C4 coordinator head with packet 4a folded (`ae464314c`).
Plan: [`../../completion-waves-2026-09.md`](../../completion-waves-2026-09.md) §4; wave log [`../wave-c4.md`](../wave-c4.md).
Rules: §3 there (rules 10–18), §3/§3a of [`../../improvement-waves-2026-09.md`](../../improvement-waves-2026-09.md), and the packet's COMMON RULES.

---

## Outcome in one line

**Row 1 (M-T5.21): Phase 1 LANDED in full — `open` → `partial`.** One callable production (three shared grammar fragments at twelve sites), the declared legality table `CALLABLE_SITES`, one validator that reports *why*, and the `lower/` duplication drained. Byte-identical across the corpus on all five backend platforms; mutation-proved three ways. **Phases 2–4 handed off** with the exact recipe and the reason they were not taken here (fence collision with packet 4c).
**Row 2 (M-T9.26): re-measured; the seam is CONFIRMED and slice 1 is BLOCKED on the design's own §2.6** — mission stays `open` with the ⚠ discharged and the block named. Neither `done` nor `declined` was taken, and §Row 2 says plainly why forcing either would have been false.

---

## Row 1 — M-T5.21 callable unification

### What landed

| piece | file | note |
|---|---|---|
| the one production | `src/language/ddd.langium` (fragments at the `FunctionDecl` comment block) | `CallableLeadModifiers` / `CallableSigModifiers` / `CallableGates`, in the aggregate-`operation` header order every other site is a fork of |
| included at twelve sites | `ddd.langium` — `Operation`, `Create`, `Destroy`, `Apply`, `FunctionDecl`, `CommandHandler`, `QueryHandler`, `DomainServiceOperation`, `WorkflowCreateDecl`, `HandleDecl`, `OnDecl`, `ActionDecl` | both `extern` spellings parse on the handlers (design Phase 1: "every legacy spelling stays legal") |
| regenerated parser | `src/language/generated/{ast,grammar}.ts` | `npm run langium:generate`, zero drift |
| the legality table | `src/language/callable-sites.ts` (new) | keyed by `$type`; states TODAY's surface exactly — no capability added, none removed |
| the one validator | `src/language/validators/callable-sites.ts` (new) | `loom.callable-modifier-not-allowed-here`, one `#<slug>` catalog arm per site kind |
| wiring | `src/language/validators/index.ts:17`, `src/language/ddd-validator.ts:38,412` | one barrel export, one `guard("callable-sites", …)` |
| wording | `src/diagnostics/messages.ts` (7 entries, appended in the `callable-sites.ts` section) | `#lifecycle`, `#applier`, `#function`, `#handler`, `#domain-service`, `#workflow`, `#page-action` |
| docs anchor | `src/diagnostics/code-docs.ts:40` → `06-behavior-and-statements.md#the-callable-modifier-surface` | a real anchor, not an `UNDOCUMENTED_CODES` row |
| firing fixture | `test/system/diagnostic-firing-census.test.ts` `FIRING_FIXTURES` | `audited` on a `domainService` operation |
| printers | `src/language/print/print-structural.ts` — `callableLead` / `callableSig` / `callableGates` + twelve call sites | a dropped slot would erase the refusal on `unfold` |
| macro factories | `src/macros/api/factories.ts` — `create` / `destroy` / `commandHandler` / `queryHandler` | state the whole modifier set at today's defaults |
| the `lower/` drain | `src/ir/lower/callable-params.ts` (new) + `lower-members.ts` ×2, `lower-domain-service.ts`, `lower-workflow.ts` ×4 | seven copies of the parameter binder → one leaf |
| docs | `docs/language-reference/06-behavior-and-statements.md` §"The callable modifier surface"; `docs/language.md` validation-rules list | the per-site table, the header order, the worked error |

### The before / after that matters

```ddd
domainService Pricing {
  operation quote(base: int) audited : int { return base }
}
```

Before — phase ①, nothing to act on:

```
drive.ddd:4:39 error: Expecting token of type '{' but found `audited`.
```

After — phase ④, with the reason:

```
drive.ddd:4:34 error: 'audited' is not allowed on a domain-service operation. A domain
service is a stateless, context-internal calculator: no instance to gate, no route to
authorize, no persistence to audit — and its body already refuses repository / extern /
emit / this-write. Move the rule to the aggregate operation that owns the state.
```

`operation rename(n: string) audited { … }` on an aggregate stays clean — the table says it carries `audited`.

### The table as landed (today's surface, exactly)

| site (`$type`) | `private` | `extern` | `audited` | `requires` | `when` | deny reason |
|---|---|---|---|---|---|---|
| `Operation` | ✓ | ✓ | ✓ | ✓ | ✓ | `lifecycle` |
| `Create` / `Destroy` | — | — | ✓ | — | — | `lifecycle` |
| `Apply` | — | — | — | — | — | `applier` |
| `FunctionDecl` | — | — | — | — | — | `function` |
| `CommandHandler` / `QueryHandler` | — | ✓ | — | — | — | `handler` |
| `DomainServiceOperation` | — | — | — | — | — | `domain-service` |
| `WorkflowCreateDecl` / `HandleDecl` | — | — | — | ✓ | — | `workflow` |
| `OnDecl` | — | — | — | — | — | `workflow` |
| `ActionDecl` | — | — | — | — | — | `page-action` |

Not rows, deliberately (design §"What this explicitly does NOT change"): `Criterion` (carries `of <T>` / `as <alias>`, inlined at call sites), `Component` (returns markup), `UiFunction` (extern **by construction** — the `extern from "<path>"` clause *is* its body, so there is no modifier surface to police). `HandleDecl` is kept as a site and neither removed nor renamed — D-HANDLE-REMOVAL is undecided and owner-gated.

### Mutation proofs (three; every revert by file copy, never `git checkout --`)

1. **The table is actually read.** `CALLABLE_SITES.DomainServiceOperation.modifiers: []` → `["audited"]`.
   Fails `explains 'audited' on a domain-service operation (was an unexplained parse error)` at
   `AssertionError: expected [] to include 'loom.callable-modifier-not-allowed-here'`.
2. **The widening is real.** `CallableSigModifiers` dropped from `DomainServiceOperation` in `ddd.langium`, re-generated, rebuilt.
   Fails the same leg at `the widened spelling must PARSE — a parser error means the grammar never opened, which is the state this mission replaced: expected [ …(4) ] to deeply equal []`.
3. **The printer does not eat the refusal.** `callableLead(node)` dropped from `printFunctionDecl`.
   Fails `does not silently drop a refused modifier on unfold` at `expected 'function twice(x: int) extern: int = …' to contain 'private function twice'`.

**Proof 2 caught a vacuous assertion — record it.** The first draft asserted `codes).not.toContain("loom.parse-error")` over `doc.diagnostics`. Phase-① parser errors do **not** live there (they are on `parseResult.parserErrors`), so under the mutation the diagnostics array came back **empty** and the assertion passed over a source that never parsed at all — the exact shape `experience_gathered.md` §59/§63 records. The leg now reads `doc.parseResult.parserErrors`, and the test carries a comment saying why. A reviewer reading only "the gate went red" would have accepted the first draft.

### Byte-identical result — stated, as the wave requires

`node scripts/capture-corpus-snapshot.mjs` (packet 4a's instrument: every `test/fixtures/corpus/*.ddd` × the five backend platforms through the same `generateSystems` entry point `ddd generate system` uses), captured on the merged tree before any edit and again after each slice:

| snapshot | cells | emitted files | diff vs. before |
|---|---|---|---|
| before (merged tree, no edits) | 395 (ok 395, non-generating 0) | 26 424 | — |
| after the grammar widening + regenerated parser | 395 | 26 424 | **BYTE-IDENTICAL: no emitted file differs** |
| after the validator + printers + firing fixture | 395 | 26 424 | **BYTE-IDENTICAL: no emitted file differs** |
| after the `lower/` parameter-binder drain | 395 | 26 424 | **BYTE-IDENTICAL: no emitted file differs** |

Not one byte differs on any of the 26 424 emitted files, so there is no line to justify. `test/fixtures/baseline-output/` needed no regeneration for the same reason — it is a subset of what the corpus snapshot covers, and the fixture tests read it back green in the full run. The AST printer round-trip (`print-structural-roundtrip.test.ts`) and `print-completeness.test.ts` are green; no new printable union member was added, so no new printer arm was owed — the twelve existing arms grew the shared header helpers instead.

### Why Phases 2–4 did NOT land here — a decision, not an omission

The packet brief asked for the six duplicate diagnostic pairs to be collapsed onto one code with `#slug` arms. **They were not, and the reason is the fence.**

- The packet's tree fence reads: *"`src/language/validators/**` (the ONE `CALLABLE_SITES` legality validator; nothing else — packet 4c is draining every other validator file concurrently, so do not touch their bodies)."*
- Four of the six pairs are raised in `src/language/validators/structural.ts` (lines 360, 374, 391, 400, 442, 472, 494) — 4c's file, whose body the fence forbids.
- The other two are raised in `src/ir/validate/checks/workflow-checks.ts` (1008, 1111) — **not in packet 4d's fence at all**; `src/ir/validate/checks/**` is 4c's.
- 4c's branch is not pushed (packets never push), so the collision could not even be measured, only assumed.
- The design itself sequences this as Phase **2**, after Phase 1, and says *"coordinate with the diagnostics-registry mission so each retirement is one registry row."*

Landing it would have put six string renames plus five shared-file edits (`messages.ts`, `code-docs.ts`, `fix-hints.ts`, `diagnostic-firing-census.data.ts`, `diagnostic-docs-undocumented.ts`) into the middle of another packet's drain, on files it is rewriting. **Recipe below so it is one pass for whoever takes it after 4c folds.**

### Hand-off — Phase 2 (the six duplicate pairs), outside this packet's fence

Order matters: the renames first, then the three ratchet lists, then the anchors.

| retire | onto | raised at |
|---|---|---|
| `loom.workflow-applier-on-non-event-sourced` | `loom.applier-on-non-event-sourced#workflow` | `src/language/validators/structural.ts:360` |
| `loom.workflow-duplicate-applier` | `loom.duplicate-applier#workflow` | `structural.ts:374` |
| `loom.workflow-event-sourced-mutation` | `loom.event-sourced-direct-mutation#workflow` | `structural.ts:391` |
| `loom.workflow-emitted-event-no-applier` | `loom.emitted-event-no-applier#workflow` | `structural.ts:400` |
| `loom.workflow-create-unknown-field` | `loom.create-unknown-field#workflow` | `src/ir/validate/checks/workflow-checks.ts:1111` |
| `loom.workflow-unknown-name` | `loom.unknown-name#workflow` | `workflow-checks.ts:1008` |

The `#<slug>` machinery already exists and is already used by this exact family (`loom.applier-on-non-event-sourced#ast` / `#ir`, `loom.duplicate-applier#ast` / `#ir` — `src/diagnostics/messages.ts`), so no new mechanism is needed: keep the `diagMessage` key literal, attach the bare non-prefixed `code:`, and `codeOfMessageKey` does the rest. Then, in the same change:

1. `src/diagnostics/messages.ts` — re-key the six entries; **append, never reorder** (4c appends here too).
2. `src/diagnostics/code-docs.ts` — drop `loom.workflow-applier-on-non-event-sourced` (line 125 today); the non-prefixed code already has the anchor.
3. `src/language/fix-hints.ts:265` — fold the `loom.workflow-applier-on-non-event-sourced` hint into the `loom.applier-on-non-event-sourced` one at :257.
4. `test/system/diagnostic-firing-census.data.ts` — delete the six retired codes from `COVERED_ELSEWHERE` (lines ~355–364).
5. `test/system/diagnostic-docs-undocumented.ts` — delete the same six (lines ~355–361). Both lists ratchet, so a stale row fails the gate; that is what makes the retirement delete its own slack.
6. `test/ir/workflow-dataflow-checks.test.ts:63,68` asserts on `loom.workflow-unknown-name` — update to the bare code.
7. Mutation-prove it the way this packet did: re-add one retired code to `COVERED_ELSEWHERE` and confirm `diagnostic-catalog.test.ts`'s orphan invariant reddens.

Gate: `npx vitest run test/system/diagnostic-catalog.test.ts test/system/diagnostic-docs-anchors.test.ts test/system/diagnostic-firing-census.test.ts` (465 assertions), then the corpus snapshot (a diagnostic rename emits nothing, so it must stay byte-identical).

### Hand-off — Phases 3 and 4, with the measured remainder

- **Phase 3, one `extern` spelling.** Three legacy positions survive: the handler **prefix** (`extern commandHandler …` — `ddd.langium` `CommandHandler` / `QueryHandler`, and what `print-structural.ts` re-emits), the `component` **suffix-with-path**, and ui `function`'s **extern-as-body**. The uniform infix spelling already parses on the handlers as of this packet, so Phase 3 is now: warn on the prefix (`loom.extern-legacy-position`, `fix-hints.ts` already has the machinery), codemod the corpus in the same PR, flip the printers to the infix form, then remove. `Component` / `UiFunction` are the harder half — their `from "<path>"` is not optional, so the "one spelling" has to carry the path, which is a surface decision, not a refactor. **Size: M for the handlers, M for the other two, and they are independent.**
- **Phase 4, re-derive the exclusions.** Walk `CALLABLE_SITES` row by row. Every row's comment already states *why* today, which is the input Phase 4 needs; what it must not do is quietly flip a `—` to a `✓`. **Each cell turned on is an emitter obligation on eleven targets under the no-permanent-skips policy** — that is the whole cost model the mission exists to protect, so a Phase-4 PR that widens a row owes the eleven emissions, not a table edit. The first row to walk is §Open question 4 (`commandHandler` / `queryHandler`, disposition B′).
- **Measured remainder, stated honestly.** The design's §Proposal sketches a single `Callable` rule that *replaces* the twelve, with `CallableKeyword` / `CallableName` / `CallableBody` sub-rules. This packet landed the **modifier/clause** half of that — the half that carried the author-visible cost — and left the name/params/body-form axes per rule. Collapsing those is a much larger AST change (`Operation.body` vs `FunctionDecl.block` vs `CommandHandler.body` vs `DomainServiceOperation.stmts` are four property names for one concept) touching every lowerer, printer, validator and LSP dispatch, and the design's own §Open questions 1 and 3 (does `apply`/`on` belong; is the optional `create`/`destroy` name worth keeping) are **unsettled** — they should be settled before that collapse, not during it. Sizing it from this packet's experience: the property-name unification alone is an L.

### Two silent gaps found while draining `lower/` — not fixed here, deliberately

Both are recorded in `src/ir/lower/callable-params.ts` and at the call sites, because the seven-copies structure is exactly what hid them:

1. **A `domainService` operation drops a parameter default.** Every callable site shares one `Parameter` rule, which parses `param: T = <expr>`; `lowerDomainServiceOperation` has never lowered it, so no emitter ever sees one. Validates clean, emits a parameter with no default.
2. **A workflow `handle` does the same.** (A workflow `create` does lower them; an aggregate `operation` / `create` / `destroy` does too.)

Held at today's behaviour on purpose — turning either on is a capability change on eleven targets, not a refactor, and this packet's gate is byte-identity. They are now one boolean argument apart (`lowerCallableParams(…, { defaults: true })`) instead of four divergent copies. **Suggested disposition:** a validator that *refuses* a default at the two sites that drop it (honest gap, cheap), or the emitter work to honour it (capability, eleven targets). Either is a fresh mission row; neither is M-T5.21's.

---

## Row 2 — M-T9.26 `RouteTarget`

### The verdict

**The seam is CONFIRMED by the mission's own accept/reject test. Slice 1 is BLOCKED by the mission's own sequencing prerequisite. The mission stays `open`, with the ⚠ discharged.**

The packet brief asked to close it `done` or `declined`. **Neither is true, and forcing one would have been the dishonest outcome:**

- `declined` would contradict the evidence gathered — the anti-criterion the mission set for itself does not fire, and the coupling has *grown*.
- `done` would be false — no extraction code landed.

So the packet delivers what the decision actually needs: the re-measurement, the criterion evaluated against it, the block named, and a one-line next action. That is the same discipline §2.6 was written to enforce, and the same shape the original brief used when it recorded #2340 as the blocker. **Decision wanted from the owner: none — this is unblocked automatically when #2918 merges.** If the owner wants the mission closed regardless, `declined` would have to be argued against the numbers below, not from them.

### Re-measurement (merged C4 tree, 2026-09-22, post-#2462)

Emitter-side coupling, `src/platform/hono/v4/` + `src/generator/typescript/`:

| token | sites |
|---|---|
| `c.req` | 63 |
| `c.json` | 34 |
| `OpenAPIHono` | 33 |
| `createRoute` | 29 |
| `@hono/` imports | 26 |
| `app.openapi` | 23 |
| `from "hono/` imports | 14 |

**217 sites across 22 files** — up from the brief's pre-unification **183 across 18**. The route-builder unification (#2453–#2462) did not shrink the shell. `src/platform/hono/v5/` delegates to v4's emitters through `makeHonoPlatform` and contributes **zero** HTTP-shell coupling of its own, so the measurement basis is unchanged from the brief's.

### §2.6b measured, not estimated — the accept/reject test

Every method in the §2.3 contract counted against the real emitter call sites, bucketed by the slice that would port it:

| contract method | slice 1 | 2 | 3 | 4 | 5 | other | TOTAL |
|---|---:|---:|---:|---:|---:|---:|---:|
| `imports` | 2 | 4 | 2 | 5 | 4 | 15 | **32** |
| `respondJson` | 17 | 0 | 0 | 7 | 0 | 6 | **30** |
| `requestPath` | 9 | 4 | 2 | 2 | 0 | 7 | **24** |
| `route` | 9 | 7 | 4 | 0 | 0 | 2 | **22** |
| `openRouter` | 3 | 4 | 3 | 0 | 2 | 4 | **16** |
| `ctxGet` | 1 | 2 | 2 | 0 | 0 | 7 | **12** |
| `errorHandler` | 1 | 3 | 1 | 0 | 0 | 6 | **11** |
| `closeRouter` | 1 | 2 | 1 | 2 | 2 | 2 | **10** |
| `sseStream` | 0 | 0 | 0 | 0 | 10 | 0 | **10** |
| `mountChild` | 0 | 0 | 0 | 0 | 0 | 8 | **8** |
| `readParam` | 6 | 0 | 0 | 0 | 0 | 0 | **6** |
| `readBody` | 3 | 0 | 0 | 0 | 0 | 1 | **4** |
| `ctxSet` | 0 | 0 | 1 | 1 | 0 | 2 | **4** |
| `respondEmpty` | 2 | 0 | 0 | 0 | 0 | 0 | **2** |
| `readQuery` | 1 | 0 | 0 | 0 | 0 | 0 | **1** |
| `rawRequest` | 0 | 0 | 0 | 1 | 0 | 0 | **1** |

**14 of 16 multi-use.** The two singles are `readQuery` and `rawRequest` — and §1.3 already classifies `rawRequest` as the deliberate `adapter` exception, so the only genuinely new single-use method is `readQuery`, which folds into `readParam`'s leaf if a reviewer wants it gone. **§2.6b's "a method used exactly once is dead contract surface" does not fire.** Within slice 1 alone the core methods stay multi-use (`respondJson` 17, `route` 9, `requestPath` 9, `readParam` 6, `readBody` 3, `openRouter` 3), so the easiest-first ordering holds exactly as §2.5 writes it.

Method → token mapping used (so the count is reproducible, not asserted): `route` = `app.openapi(`, `readParam` = `c.req.valid("param")`, `readQuery` = `c.req.valid("query")`, `readBody` = `c.req.valid("json")`, `respondJson` = `c.json(`, `respondEmpty` = `c.body(null` / `c.newResponse`, `requestPath` = `c.req.path`, `rawRequest` = `c.req.raw`, `openRouter` = `newApp()` / `: OpenAPIHono`, `closeRouter` = `return app;`, `mountChild` = `app.route(`, `ctxSet`/`ctxGet` = `c.set(` / `c.get(`, `errorHandler` = `app.onError`, `sseStream` = `streamSSE` / `writeSSE` / `onAbort`, `imports` = `from "@?hono`.

### §2.6 quiet-baseline check — the block

`git diff --numstat origin/main...origin/<branch> -- src/platform/hono/v4/ src/generator/typescript/` over every open branch:

| branch (PR) | files in the blast radius |
|---|---|
| **`claude/vo-collection-create-input` (#2918)** | **`routes-builder.ts` +24/−2**, `generator/typescript/emit/aggregate.ts` +4 |
| `claude/loom-fieldops-eval-ebi6es` (#2980) | `auth-emit.ts` +9/−5 (slice 4), plus four `generator/typescript/` files |
| `claude/fix-four-codegen-defects` (#2947) | `emit/aggregate.ts`, `repository-find-predicate.ts` |
| `claude/fix-currentuser-in-criteria` (#2945) | `repository-find-builder.ts`, `repository-find-predicate.ts` |
| every other open branch (11 checked, incl. #2984, #2983, #2966, #2942, #2871, #2874, #2911, #2862, #2943, #2977, #2978) | none |

#2918 lands **inside slice 1's only file** and changes emitted output (it is a create-input fix), which is precisely the condition §2.6 names: *"if another in-flight PR changes what the emitters emit, there is no fixed target to be identical to, and the gate degrades from a proof into a diff against a moving reference."*

### Next action (unchanged contract, no redesign owed)

1. Wait for **#2918** to merge, then re-run the quiet-baseline check above (one command, one minute).
2. Build slice 1 exactly as §2.5 writes it: `RouteSpecIR` + `renderRoutesWith` + `HONO_TARGET` leaf table, home at `src/platform/hono/v4/route/` (§Open question 1 — promote to `src/generator/_route/` only at a second consumer), porting `routes-builder.ts` only. Nine `app.openapi(createRoute({…}), async (c) => {…})` emission sites; the bespoke part is each site's `createRoute` payload (`request.params` / `.query` / `.body` and a varying `responses` block via `problemResponseLines`), so `RouteSpecIR` must carry schema references as opaque already-rendered strings — which is what §2.3's `ZodSchemaRef` already says.
3. One seam the contract sketch does not yet have, found while reading the emitter: `routes-builder.ts:1196` emits `c.header("etag", versionETag(found.version))` on the get-by-id route under `versioned`. It is a response-header write with no `RouteTarget` method. Add `setHeader(name, expr)` — or fold it into `respondJson`'s options — when slice 1 is written; do not discover it mid-port.
4. Gate per §2.5: corpus snapshot byte-identical + `npm test` + `hono-build.yml`.
5. **Do not start with slice 4 or 5 to route around the block.** §2.6 already explains why: they are the `adapter` and `structural` exceptions, and deriving the contract from its two worst-fit consumers is how a seam ends up with the single-use methods §2.6b rejects.

---

## Local gates (on the merged tree, before hand-off)

| gate | result |
|---|---|
| `npm run langium:generate` | zero drift — regenerated output committed (`ast.ts`, `grammar.ts`) |
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | `OK — 181 files, 469 errors, src/ clean` — the M-T9.50 baseline is **unmoved**, as a packet outside 4b's fence must leave it |
| `npm run lint` (`npx biome ci .`) | clean, 3267 files |
| corpus byte-identity | **BYTE-IDENTICAL: 395 cells, no emitted file differs** (3 captures: post-grammar, post-validator, post-`lower/`) |
| `npm test` (redirected, exit code appended) | see §"Full-suite result" below |
| `node scripts/mission-counts.mjs --check` | OK (regenerated with `--write` after the two status edits) |
| `node scripts/ledger-counts.mjs --check` | OK |
| `node docs/build.mjs` | OK |

Targeted runs along the way: `test/language/print/` 350 passed, `test/ir/` 3379 passed, the three diagnostic gates 465 passed, the new `test/language/validation/callable-sites.test.ts` 12 passed.

### Full-suite result

<!-- npm-test-result -->

---

## Open-PR overlaps — cited, not duplicated

| PR | what it touches | how this packet composed around it |
|---|---|---|
| **#2982** (`id` as a parameter name) | the wave log calls it "a GRAMMAR change on `ddd.langium`"; **its diff shows otherwise** — it touches `src/ir/lower/lower-expr.ts` and `src/language/type-system.ts` only, with no grammar hunk. Read first, as instructed. | No overlap. This packet does not touch `lower-expr.ts` (the new `callable-params.ts` *imports* `lowerExprInContext` from it, adding no hunk) or `type-system.ts`. The wave log's fence note for 4d should be corrected: #2982 is not on the grammar. |
| **#2984** (routed handlers on `test e2e`) | `src/system/e2e-render.ts`, `src/ir/validate/checks/{e2e-route,test}-checks.ts`, `src/ir/util/routed-handler.ts`, **`src/diagnostics/messages.ts`**, **`src/diagnostics/code-docs.ts`**, `docs/language.md`, plus a new corpus fixture `handler-triad.ddd` | Shared files only. Both of this packet's `messages.ts` / `code-docs.ts` hunks are **appends into distinct regions** (a new `callable-sites.ts` section between the `bypass-placement.ts` and `channel.ts` sections; one anchor row at the head of `CODE_DOCS_ANCHORS`) — nothing reordered. The `docs/language.md` hunk is a single bullet inserted at the head of the "Validation rules" list. It does **not** touch the HTTP shell M-T9.26 measures, so it is not a §2.6 blocker. Its new corpus fixture will add 5 cells to the next snapshot baseline — re-capture `before.json` after it folds. |
| **#2871 / #2874 / #2949** (validators) | `ui-checks`, `ui-page-structure-checks`, read-path validators, `loom.unknown-primitive-member` | No overlap: this packet adds one **new** validator file and touches no existing validator body. |
| **packet 4c** (`claude/c4-uncoded`, not pushed) | `src/language/validators/**`, `src/ir/validate/checks/**`, `src/diagnostics/**` | The reason Phase 2 was handed off rather than landed — see §"Why Phases 2–4 did NOT land here". This packet's only edits under 4c's fence are the two **appends** to `messages.ts` / `code-docs.ts` plus a one-line barrel export and two lines in `ddd-validator.ts`; no existing validator body is touched. |
| **#2918** (`claude/vo-collection-create-input`) | `routes-builder.ts` +24/−2 | Not an overlap — it is the **M-T9.26 §2.6 blocker** this packet measured. |

---

## Decisions taken

1. **Phase 1 widens the modifier/clause surface only, not the name/params/body axes.** The design sketches one `Callable` rule replacing all twelve. The modifier half is what carried the author-visible cost (the unexplained parse error) and is byte-identically gateable; the property-name half (`body` / `block` / `stmts` for one concept) is an L touching every lowerer, printer and LSP dispatch, and §Open questions 1 and 3 are unsettled. Splitting there is a decision, recorded here so a later reader does not read "Phase 1" as "all of it".
2. **The reason slug is per SITE KIND, not per modifier.** Seven catalog arms, not thirty-five cells. The reason a modifier is refused is a property of what the site *is*.
3. **The deny arms are spelled out, one `diagMessage("…#slug")` per reason, rather than indexed by `site.why`.** `diagnostic-catalog.test.ts` reads string-literal keys and string-literal `code:`s only; a computed key is invisible to all four of its invariants and would let the wording drift back out of the catalog unnoticed. The `deny` helper is the forwarding shape that scanner follows through, so the `code:` is still stated once.
4. **`CALLABLE_SITES` lives at `src/language/` (design §Open question 2), not `src/util/`.** One consumer today. It is pure data with no Langium import, so a second consumer (`lower/`, `print-structural.ts`) can take it without a back-edge; it moves at the third.
5. **`HandleDecl` stays a site, unrenamed and unremoved** — D-HANDLE-REMOVAL is undecided and owner-gated, as the packet brief requires.
6. **The two parameter-default drops were preserved, not fixed.** Byte-identity is this packet's gate; the fix is a capability change on eleven targets.
7. **M-T9.26 closed as neither `done` nor `declined`** — see §Row 2 for why either would have been false.

## Decisions wanted from the owner

1. **Phase 2 routing.** Land the six-pair collapse as its own follow-up after 4c folds (recipe above, ~1 hour), or fold it into 4c's drain? It is one `#slug` rename family and both packets touch the same five ratchet files.
2. **The two parameter-default drops** (domain-service operation, workflow `handle`): refuse them with a validator (honest gap, cheap) or emit them on eleven targets (capability)? Either way it wants a mission row; it is not M-T5.21's.
3. **M-T5.21 status wording.** Landed as `partial` with Phases 2–4 named. If the owner prefers `open` with a Phase-1-done note, that is a one-line edit to `docs/new-plan/T5-language-core.md:102`.
4. **`readQuery`** (§Row 2): the one genuinely new single-use contract method. Keep it for symmetry with `readParam`/`readBody`, or fold it into the leaf table when slice 1 is written?
