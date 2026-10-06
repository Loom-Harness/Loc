# T5 — Language core & type system — completed missions

*Archived 2026-09-02 from [`../T5-language-core.md`](../T5-language-core.md). Every mission below is closed (`done` / `shipped` / `closed` / `concluded` / `withdrawn`); the bodies are moved verbatim (links re-based one level deeper) so the evidence trail stays readable. Nothing here is open work — the live track file lists what remains.*

## M-T5.6 — Strict decimal/money bounds bug — `done` (verified 2026-07-14) · **S** · P1 ⭐ correctness
Sources: [full-code-review-2026-07](../../audits/full-code-review-2026-07.md) #6.

## M-T5.11 — Extern domain extension — `done` (verified 2026-07-13) · —

## M-T5.15 — Scalar-return operation HTTP-contract convergence (BUG-003) — `done` (2026-07-27) · **S–M** · P2 ⭐ parity break
Sources: [showcase-coverage-bugs](../../audits/showcase-coverage-bugs.md) BUG-003.

## M-T5.17 — Surface normalization: aggregate-header modifiers + `httpStatus` — `done` · **S–M** · P3
Sources: language-surface review 2026-07-14, `src/language/ddd.langium` (`Aggregate`/`ApiStatus`), D-DOCUMENT-AXIS §4.

## M-T5.18 — Soft-keyword sprawl: dedup, gate, root-cause reduction — `done` (Tracks B + A + C landed) · **M** · P3
Sources: language-surface review 2026-07-14 #5, `src/language/ddd.langium` (the six identifier rules), M-T5.15 BUG-004.

## M-T5.20 — Route the whole denial ladder through `resolveErrorStatus` — `done` · **M** · P2 ⭐ drift-prone
**DONE (2026-08-18) — every rung of the ladder resolves on all five backends.** `DomainError` is in `STDLIB_ERROR_STATUS` at 422, and both rungs now resolve through `resolveErrorStatus` at the runtime arm *and* the declared OpenAPI response on node/.NET/java/python/elixir. Two shared seams had to move with them: the app-wide `structuralErrorStatuses` fold in `enrichments.ts` only iterated `STRUCTURAL_CONFLICT_ERRORS`, so an override could never reach a ladder rung; and `errorStatuses()` in `openapi-errors.ts` handed back the literals. Proven by `test/conformance/denial-ladder-override-parity.test.ts` — one `httpStatus DomainError -> 418` moves **all five**, asserted as a single cross-backend equality so a backend that silently ignores the clause fails even while its own per-leg suite is green.

**A deliberate deviation from this mission's text, reached independently by both halves of the work.** The brief said to take the RFC 7807 `title` from `errorTitle`. That is wrong here: `errorTitle("DomainError")` is `"Domain Error"`, which breaks RS-15's pinned `"Unprocessable Entity"` *and* the committed `wire-contract` golden. The title instead derives from the **resolved status's IANA reason phrase**, which is strictly stronger against the drift this mission exists to remove — a title and a status read off the same number cannot disagree, which is exactly the elixir `"Precondition Failed"`-against-422 bug class #2300 had to fix by hand.

**`NotFound` — the last rung — closed 2026-08-18.** It was parked because the aggregate-not-found 404 had **two producers, and which fired was backend-dependent**: hono's `getById` threw `AggregateNotFoundError` into `onError`, while .NET returned a bare `NotFound()`, java a `ResponseEntity.notFound()`, python a `None` check — and that bare-return pattern repeated across projection/workflow/find paths. Resolving only the declaration would then have published a status those paths never answered. **M-T6.31 removed the second producer** (every bare framework return became the shared not-found carrier — they were bypassing the app's problem filter and answering an empty-bodied 404 anyway), leaving ONE producer per backend, so `errorStatuses()` now resolves `NotFound` like its four siblings and each backend's handler arm plus its hand-rolled declared sets read the resolved value.

Landing it also drained an intra-function split the `Forbidden` rung had had: `deriveContextOperations` spelled the `httpStatus` resolver inline at two call sites and **omitted it at both `errorStatuses("getById")` calls**, so an override moved a find's declared 404 while `GET /<aggs>/{id}` and its `can_<op>` probe kept publishing 404. Same shape on java's `openapi-customizer.ts`, which passed no resolver at three hand-rolled sites.

Two 404s stay literal **on all five, elixir included**: the framework routing 404 (`no route for <verb> <path>`) and the objectStore blob-absence 404. Neither is the domain rung. Gated by `test/conformance/override-status-census.test.ts`, whose four ratcheting `NotFound` waivers were deleted in the same PR and whose sites now cover both the runtime arm and the declared set per backend.

Original brief follows.
**The ladder is half-routed today, and RS-15 is the proof.** `src/util/error-defaults.ts` already owns a status table plus the `httpStatus <Error> -> <Code>` per-api override path — and the table already names four of the five rungs (`NotFound` 404, `Forbidden` 403, `Disallowed` 409, `ValidationError` 422). But only the **structural-conflict** rung actually reads it: `resolveErrorStatus("Disallowed", …)` / `"UniquenessConflict"` / `"ConcurrencyConflict"` / `"ReferencedInUse"` resolve through the table on every backend, so a user can remap them and the runtime response + the OpenAPI declaration move together by construction. The other rungs — the **domain floor**, `Forbidden`, `NotFound` — are **hardcoded integer literals** at each backend's exception-handler arm (`problem(403, "Forbidden", …)`, `Problem(context, 404, …)`, `problem_response(conn, 422, …)`, …), and `DomainError` is not in the table at all.

Two costs, both now measured rather than hypothetical:
1. **Changing a rung is an N-place edit.** RS-15 moved the domain floor 400 → 422; that was five hardcoded runtime literals across five backends, plus four docs, plus a fixture rebaseline — and the only thing keeping the five in agreement afterwards is a test that asserts the same literal five times. The `Disallowed` rung would have been a one-line table edit.
2. **A user cannot remap it.** `httpStatus DomainError -> 400` (say, for a client that can't handle 422) is inexpressible, even though the identical clause works for `Disallowed`. That asymmetry is invisible from the DSL — nothing tells an author which rungs are overridable.

**The work:** add `DomainError` to `STDLIB_ERROR_STATUS` (422, post-RS-15), then convert each backend's exception-handler arm from a literal to `resolveErrorStatus(<name>, ctx.structuralErrorStatuses)` — the same call shape the conflict rung already uses, so the pattern is copy-paste per backend rather than invention. The RFC 7807 `title` should come from the existing `errorTitle` derivation at the same time (it is hardcoded next to each literal, so it drifts identically — elixir shipped a `"Precondition Failed"` title against a 422 status until #2300 fixed it). Also confirm the **OpenAPI declaration** side reads the resolved value: today the declared `responses` map is built separately from the runtime arm, which is exactly the runtime/declaration drift the override mechanism exists to prevent.

**Verification:** `test/generator/domain-denial-detail-parity.test.ts` already pins the resolved default on all five, so a regression is caught; add one case per backend asserting an `httpStatus DomainError -> 400` override moves BOTH the runtime arm and the declared response. `conformance-parity` guards the cross-backend spec.

Sources: found 2026-07-29 while landing RS-15 (#2300) — the five-place edit *was* the evidence. `src/util/error-defaults.ts`, `docs/old/proposals/exception-less.md` (A1, the table's origin), `docs/conformance-semantics.md` RS-15. Relates to M-T5.17 (which added the `httpStatus` surface this mission finishes wiring).

**Regression + restoration (#2462 → #2340, recorded 2026-08-10):** main's route-derivation unification (#2462) re-derived the DECLARED response set but never re-threaded the `DomainError`/`Forbidden` `httpStatus` override into the four backends' runtime handlers — **silently reverting this mission's own feature** on four backends and elixir's per-op controller; #2340's rebase restored it. `denial-ladder-override-parity.test.ts` did not catch the revert — a default-emission census cannot distinguish "resolved to the default" from "hardcoded", which is exactly M-T9.25 round-2 item 1 (re-run the census UNDER AN OVERRIDE). Those bare returns were M-T6.30/M-T6.31's read-path envelope split, and draining them is what made the `NotFound` rung convertible (see above) — the mission is `done` as of 2026-08-18.

## M-T5.26 — The guarded-optional form the validator itself recommends compiles on one of five backends — `done` ([#2788](https://github.com/Loom-Harness/Loc/pull/2788), merged 2026-09-09) · **M** · P1

**Evidence on `main`:** `unwrapGuardedIntrinsicReceiver` (`src/ir/lower/lower-expr.ts:504`) applied at both typing paths (`:524` `applySuffixToRecv`, `:2726` `inferSuffixType`); pinned by `test/ir/guarded-optional-intrinsic.test.ts` (9 assertions, 6 fail under the file-copy revert of the arm, including `expected { kind: 'optional', … } to deeply equal { kind: 'primitive', name: 'string' }`); acceptance bar met by compiling all five generated backends from one `generate system` (node `tsc --noEmit`, dotnet `/warnaserror`, java `gradle testClasses`, python `mypy --strict`, elixir `mix compile --warnings-as-errors`). The F48 elixir ternary one-liner (`ELIXIR_TARGET.ternary` self-parenthesizes) rode along, pinned by `test/generator/elixir/phoenix-render-expr.test.ts`.

Found 2026-09-03 by the language-docs audit ([F2](../../audits/2026-09-03-language-docs-audit-findings.md), P0). `src/language/validators/types.ts:281` sanctions `x != null ? x.trim() : …` as *the fix* for `loom.intrinsic-nullable-receiver` — and then the guarded call is emitted verbatim rather than through the host idiom. From `note2: string?`, `derived safeNote = note2 != null ? note2.toUpper() : "none"` emits `this._note2.toUpper()` (node), `this.note2.toUpper()` (java), `self._note2.to_upper()` (python), `record.note2.to_upper()` (elixir) — none compile; .NET emits culture-sensitive `ToUpper()` where an unguarded receiver gets `ToUpperInvariant()`. The intrinsic arms of `src/ir/lower/lower-expr.ts` never unwrap the optional receiver the way `checkIntrinsicCalls` does.

**The fix:** unwrap the guarded receiver in the intrinsic lowering arms so the recommended form lowers to each host's idiom, and settle the .NET `ToUpper`/`ToUpperInvariant` inconsistency in the same PR.

**Verification when it lands.** The validator's own recommended form compiles on all five backends; the new lowering arm mutation-proved by file-copy revert.

**Landed 2026-09-06 as [#2788](https://github.com/lemmit/Loc/pull/2788)** (open for review). Cause was narrower and its blast radius wider than the finding said: `applySuffixToRecv` stamped `receiverType` as the **`optional` wrapper**, so the intrinsic dispatch (which keys off `kind === "primitive"`) never consulted the snippet table at all. Unwrapping restored the catalogue **result type** (which had been falling back to `string`) and the `isCollectionOp` disambiguation as well. The **.NET half was not a culture decision**: `ToUpper()` was just `renderMethodCall`'s fallback firing, so fixing the receiver type removes that path and no .NET behaviour change was needed — `ToUpperInvariant()` is the only domain-position spelling, `ToUpper()` survives only in `CS_INTRINSIC_QUERY_RENDERERS` where EF Core cannot translate the Invariant form. Gated by compiling all five generated backends from one `generate system`. Carries a one-line, independent Elixir fix its own compile gate turned up ([F48](../../audits/2026-09-03-language-docs-audit-findings.md) — an unparenthesized ternary is a SyntaxError in non-terminal position), without which the five-backend Done bar cannot be met.

Sources: [language-docs-audit-2026-09-03](../../audits/2026-09-03-language-docs-audit-findings.md) F2 (+ F48), [wave plan](../../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W1.1** (`src/ir/lower/lower-expr.ts`, `src/generator/dotnet/render-expr.ts`, `test/ir/**`). Shares `src/ir/lower/` with M-T5.27 — different files, do not let either widen.

## M-T5.27 — Two valid inputs throw instead of diagnosing: a bare abstract `seed` and a ui-e2e `expect` over a create result — `done` ([#2789](https://github.com/Loom-Harness/Loc/pull/2789), merged 2026-09-09) · **M** · P1

**Evidence on `main`:** F5 — `lowerSeed` lowers an error-recovered row to zero fields, so the source reports its two real diagnostics instead of a `TypeError` (pinned by `test/ir/seed-lowering.test.ts`, plus a `DELIBERATELY_UNPARSEABLE` entry in the inline-`.ddd` census). F6 — both ends: a create-result local reads like a `getById` one (`src/system/ui-e2e-render.ts`, pinned by `test/system/ui-e2e-create-result-read.test.ts`), and the residual raises the new code `loom.locator-matcher-receiver` (`src/language/validators/match.ts:151`, message `src/diagnostics/messages.ts:537`, anchor `src/diagnostics/code-docs.ts:162`, firing-census fixture). `src/system/expect-stmt.ts:16`'s throw is now documented as an invariant the validator makes unreachable. **Residue re-homed:** consolidating that gate into `validateE2ETest` (`src/ir/validate/checks/test-checks.ts:132`, which still has no `locator` handling) is now a named deliverable of **M-T5.28**, whose tree that is.

Found 2026-09-03 by the language-docs audit ([F5](../../audits/2026-09-03-language-docs-audit-findings.md), [F6](../../audits/2026-09-03-language-docs-audit-findings.md), both P0). `seed Party { name: "x" }` on an abstract base dies with `TypeError: Cannot read properties of undefined (reading 'fields')` in `lowerSeed` (`src/ir/lower/lower.ts`) *before* `loom.seed-abstract-aggregate` can fire — the same model as `seed default { Party { … } }` reports the diagnostic correctly. And `expect(<create-result>.<field>).toHaveText("…")` inside `test e2e … against <frontend>` validates clean, then throws `expect requires a matcher` from `renderExpectStmt` (`src/system/expect-stmt.ts:21`, via `src/system/ui-e2e-render.ts:217`); binding the read with `getById` first works.

**The fix:** F5 is ordering — the abstract-seed gate must run before the lowerer dereferences `fields`. F6 is a fork with two acceptable ends: the matcher survives the ui-e2e path, or a `loom.*` code rejects the shape. An internal throw is neither.

**Verification when it lands.** Both inputs produce a diagnostic (or output) rather than a stack trace; each gate mutation-proved by file-copy revert.

**Landed 2026-09-06 as [#2789](https://github.com/lemmit/Loc/pull/2789)** (open for review). **F5 was not an ordering problem and `loom.seed-abstract-aggregate` was never involved** — the grammar consumes `Party` as the *dataset name*, so `name` becomes a row's aggregate ref with no `value=ObjectLit`, and the pipeline had **already produced the two correct diagnostics** (`loom.parse-error` + `loom.linking-error`) that `lowerSeed` then threw away by dereferencing the error-recovered row. `lowerSeed` was the one lowerer trusting the AST type over parse recovery; a recovered row now lowers to zero fields. **F6's fork resolved as both ends:** a create-result local reads like a `getById` one (the lowering had the information all along), *and* new code `loom.locator-matcher-receiver` gates the residual. That gate re-derives the renderer's handle rule at the AST layer deliberately — its proper home is `validateE2ETest` in `src/ir/validate/checks/test-checks.ts`, which is **M-T5.28 / M-T9.44's tree**; consolidating it there is that mission's to pick up. The mutation proof makes the case: under the *renderer* mutation the validator still passed the source and the renderer crashed, so gate and renderer are independent and neither alone covers F6.

Sources: [language-docs-audit-2026-09-03](../../audits/2026-09-03-language-docs-audit-findings.md) F5/F6, [wave plan](../../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W1.4** (`src/ir/lower/lower.ts`, `src/system/expect-stmt.ts`, `src/system/ui-e2e-render.ts`).

## M-T5.29 — Two `system` blocks with no top-level members pass validation — `done` ([#2833](https://github.com/Loom-Harness/Loc/pull/2833), merged 2026-09-09) · **S** · P2

Found 2026-09-03 by the language-docs audit ([F36](../../audits/2026-09-03-language-docs-audit-findings.md), P3). `composition.ts:120-137` only fires when a top-level member must fold into a system, so a source declaring two member-less `system` blocks validates clean. There is no direct "exactly one `system`" gate.

**The fix:** a direct arity check in `src/language/validators/composition.ts`, independent of whether anything needs folding.

**Landed as [#2833](https://github.com/Loom-Harness/Loc/pull/2833).** The register's symptom was wrong and the truth is worse: `generate system` did **not** write only root artefacts — both systems generated in full (69 files, `api` + `api2`) merged into one tree and one `docker-compose.yml`, so two authored systems silently became one deployment. New code `loom.multiple-systems` flags every system after the first, scoped to *more than one* deliberately (zero systems stays the fold-triggered check's business) and counted over the same `composedRoots` import closure so a multi-project workspace is unaffected.

**Evidence on `main`:** `src/language/validators/composition.ts:136-139` raises `loom.multiple-systems`; message `src/diagnostics/messages.ts:183`; docs anchor `src/diagnostics/code-docs.ts:40` → `02-systems-and-topology.md#system`; `test/language/validation/multiple-systems.test.ts` (4 assertions, 2 of them controls — 3 fail under the file-copy revert of the gate, including `expected [] to have a length of 1`).

Sources: [language-docs-audit-2026-09-03](../../audits/2026-09-03-language-docs-audit-findings.md) F36, [wave plan](../../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W3.2**. Relates to M-T5.13 (the zero-system synthesis decision — the other end of the same arity question).
## M-T5.25 — `ignoring` after `group by` parses and is then silently dropped — clause order is load-bearing and nothing says so — `done` (fixed by [#2699](https://github.com/lemmit/Loc/pull/2699); verified 2026-09-11) · **S** · P1

**DONE — verified 2026-09-11 by RUNNING the mission's own repro on the Wave C1 base** (`main` + Wave C0). The proposed fix is what shipped: a phase-④ refusal, not a grammar move. `src/language/validators/bypass-placement.ts` raises `loom.ignoring-clause-placement` for a bypass clause in any position that drops it.

```
projection SalesByStatus { … group by o.status ignoring softDeletable … }
  -> error: 'ignoring softDeletable' sits in a position that DROPS it. A capability-filter
     bypass has three homes: a repository 'find … ignoring …', a query-time projection's
     'where' slot (before 'join' / 'group by' / 'select'), or an inline read bound by a
     'let' ('let xs = Repo.findAll(…) ignoring …'). Written on any other expression it
     parses, binds to that expression, and is never read back — the read still applies
     every filter you asked it to skip. Move the clause to the read it is meant to widen.
  exit 1
```

(Pre-fix, the same source parsed `0 error(s), 0 warning(s)` and lowering dropped the clause.) The sibling positions the mission asked to audit are covered by the same gate — the rule is positional, not per-clause-kind. The heading had stayed `open` since the fix merged; this is the flip, with the transcript above as its evidence. Recorded in `docs/new-plan/waves/handoffs/wave-c1-1f-validator-drops.md`.

Found 2026-08-30 re-verifying the [08-24 generator review](../../audits/generator-code-review-2026-08-24.md)'s follow-up register (row 13); **reproduced on `main` @ `aa236ae`**, no ledger row, no other owner.

`ProjectionQueryClauses` fixes the bypass clause in the `where` position — `('where' filter=Expression)? IgnoringClause? (joins+=ProjectionJoin)* ('group' 'by' …)?` (`src/language/ddd.langium:1581-1586`). But a `group by` operand is an ordinary `Expression`, and `PostfixChain` admits its own trailing `IgnoringClause` (`:2322`, added so an inline `Repo.findAll(…) ignoring softDeletable` parses). So `group by o.status ignoring softDeletable` **parses clean**, binds the clause to the grouping expression, and lowering drops it — the author asked to see soft-deleted rows and silently keeps getting the filtered count.

Reproduced from `test/fixtures/corpus/projection-groupby.ddd` + `softDeletable` on `Order`, generated to node:

```
group by o.status ignoring softDeletable   → .where(and(eq(status,"Confirmed"), not(eq(isDeleted,true))))
where Confirmed / ignoring softDeletable   → .where(eq(status,"Confirmed"))
```

Same model, same intent, opposite data — decided by where in the clause list the word sits.

**The fix (proposed, overridable):** refuse it. A `bypass`/`bypassAll` that survives on a `groupBys` (or `selects`, or a `join`'s `on`) expression after lowering is authoring error, not a feature — raise a `loom.*` code naming the legal position, from the phase-④ validator where the CST still carries the offending span. Moving the grammar instead (hoisting `IgnoringClause` to accept a trailing position too) is the wrong shape: the clause means "bypass the SOURCE's capability filters", which has no per-expression reading. Audit the sibling positions while in here — the same `PostfixChain` trailing clause is admissible anywhere an `Expression` is, including `where`-position sub-expressions and `select` bodies.

**Verification when it lands.** A negative parse/validate test per admissible-but-illegal position; mutation-proved by deleting the gate and watching the fixture above go quiet again. Add the legal-position witness to the projection fixture so the *working* spelling is pinned too.

Sources: [generator-code-review-2026-08-24](../../audits/generator-code-review-2026-08-24.md) §Follow-up register (2026-08-30) row 13. Relates to M-T4.2 (query-time projections), `named-filter-bypass.md` §11.


## M-T5.23 — `long` has no contract: silent corruption past 2^53 on node/python, 3-way divergent overflow — `done` (2026-09-13) · **M** · P2

**DONE — the ceiling is declared, and enforced at all three places it was breached silently.** `D-LONG-AVG-DEFAULTS` took option (a) (declare and enforce, not a representation upgrade), and the ceiling is now ONE fact in ONE place: `LONG_SAFE_MAX` / `integralWireRange` in `src/util/numeric-range.ts` — in `src/util/` because the AST validator and the read-boundary emitters both need it and `language → generator` is the wrong import direction. `_numeric/codec.ts` re-exports it, so the backends keep asking the numeric seam, as they do for `MONEY_WIRE_SCALE`.

| breach | was | now |
|---|---|---|
| an integer LITERAL past 2^53 | `derived big: long = 9007199254740993` validated clean and emitted `9007199254740992` on **every** backend — the `INT` terminal returns a JS `number`, so the digits were gone before any phase could see them | `loom.integer-literal-imprecise` (phase ④), one gate covering all five targets |
| an inbound `long` on the wire | zod 4's `.int()` already refused past ±(2^53−1), so hono **v5** enforced the ceiling by accident of its zod major, while **v4** (zod `^3.25`, whose `.int()` is `Number.isInteger`) accepted `1e19` and wrote it into a bigint column — MEASURED against both majors | `LONG_SAFE`, a `.refine` so it is enforced without being published (a node-only bound in the OpenAPI would make one `.ddd` publish two contracts) |
| an integral AGGREGATE | `sum(int)`/`count(*)` are bigints in SQL: java `intValue()` **wrapped** (a wrong ANSWER), node `Number(...)` rounded past 2^53, python `float(...)` lost digits and pydantic's lax mode re-narrowed the integral float, elixir shipped a value outside its own `format: int32`; only .NET failed | a value that does not fit fails the read on all five — `Math.toIntExact` (java), `__intWire` (node), `int(...)` + the `Int32` bound (python), `__int_wire/4` (elixir) |

Declaring the row field `long` is the author's opt-out for a total that outgrows int32, and `loom.projection-aggregate-type-mismatch` (M-T5.24) admits exactly that widening.

**Residual, recorded rather than closed silently.** Past the ceiling the four non-node backends still ACCEPT an inbound value and store it exactly, so a value written through java and read back through node rounds. That is option (a)'s own shape — it enforces "on the affected paths", the ones whose representation cannot hold more — and the two ways to close it are the representation upgrade (BigInt / string wire on node) or a uniform ingress narrowing, which is the owner-only class `D-NUMERIC-INGRESS-STRICT` owns. Pinned per backend in `test/conformance/numeric-ingress-parity.test.ts`, whose header matrix carries the new `long` row, so a move in either direction fails there.

Gates: `test/language/integer-literal-precision.test.ts`, `test/generator/projection-aggregate-integral.test.ts` (five backends, bounds read from the seam), the ingress matrix row, and the behavioural legs. Every arm mutation-proved by file-copy revert with the failing assertion named (see the PR body); the java arm additionally compile-proved in `gradle:9-jdk25`, the elixir arm under `mix compile --warnings-as-errors`, the python arm under `ruff` + `mypy --strict`.

Original brief follows (status line as it stood).

Found 2026-08-23 by the numeric-types audit ([F13](../../audits/numeric-types-audit-2026-08-23.md)). Node stores `long` as a JS `number` (`bigint(col, {mode: "number"})`, `src/generator/typescript/emit/schema.ts`; mikroorm `ts: "number"`) and python's aggregate arm routes declared int/long sums through `float()` — both silently corrupt past 2^53 while .NET/Java/Elixir carry int64 exactly. Aggregate int-overflow behavior is three-way divergent for the same `.ddd`: Java `((Number) x).intValue()` **wraps silently**, .NET's `(int)` cast **throws** (500), the rest pass the too-big value through. No validator, no doc caveat anywhere.

**The work (proposed default, overridable):** document + validator-enforce a 2^53 safe-integer ceiling for `long` on the affected paths now — an honest `loom.*` diagnostic instead of silent corruption; a representation upgrade (BigInt / string wire) becomes a named follow-up mission only if the ceiling pinches. Route python's declared-int/long aggregates through `int()`. Unify overflow behavior (proposed: Java's wraparound becomes an error like .NET's).

**Verification when it lands.** Validator tests; a >2^53 witness proving the exact backends carry it; python aggregate int test; each mutation-proved.

Sources: [numeric-types-audit-2026-08-23](../../audits/numeric-types-audit-2026-08-23.md) F13 + annex, plan.json N8.

## M-T5.24 — Projection `avg` over money is typed `decimal`: the mean of exact money leaves as a lossy double — `done` (2026-09-13) · **S** · P2

**DONE — `avg` over a money column is `money`, and the declared row type is now checked so the retype is load-bearing.** `aggregateResultType` (`lower-projection.ts`) types the mean of a money column as money; every backend already knew how to format it (`aggregateCoercion`'s `isMoney` arm), so no emitter changed.

**Measuring first showed the retype alone would have been INERT**, which is the part this mission's brief did not have. The DECLARED row field type is what every backend's coercion dispatches on (`aggregateCoercion` reads the declared row deliberately — the response schema is built from it), and NOTHING checked it. On `main` @ `09427a5` all three of these validated clean: `revenue: decimal = sum(o.total)` → `Number(row?.revenue ?? 0)` (money summed exactly in SQL, shipped lossy); `biggest: string = max(o.total)` → a published `z.string()` schema and a NUMBER on the wire, hidden by the row mapper's `as` cast; `lines: money = sum(o.qty)` → an int count dressed as a 4dp money string. So `loom.projection-aggregate-type-mismatch` now requires the declaration to carry the aggregation's own type, with ONE admitted widening (`int` → `long`, which SQL's own `sum`/`count` already are) and optionality excluded on both sides for a different reason each way.

Verified at runtime, not only structurally: the corpus fixture grew `avgTotal: money = avg(o.total)` beside the existing `avgLines: decimal = avg(o.lineCount)` — one fixture, both meanings of `avg` — and its wire golden was re-captured for exactly that one added field (5 lines, reviewed diff-by-diff: `"0.0000"`, `"20.0000"`, `"25.0000"`; no existing value moved, so this is NOT an oracle shift). The node (oracle), python and elixir behavioural legs were all RUN locally and agree byte-for-byte.

Original brief follows (status line as it stood).

Found 2026-08-23 by the numeric-types audit ([F14](../../audits/numeric-types-audit-2026-08-23.md)). `src/ir/lower/lower-projection.ts` stamps query-time `avg → decimal` even over a money column, so the mean of exact money crosses the wire as a float64 JSON number — while the **in-memory** `avg` of the same field types `money?` (`type-system.ts`) and ships the 4-dp string. Same word, two semantics, no gate.

**The work (proposed default, overridable):** retype projection `avg` over a money column to `money` — `aggregateCoercion`'s `isMoney` arm (`src/ir/util/projection-aggregate.ts`) already knows how to format it on all five backends; update the wire-golden capture with the retype.

**Verification when it lands.** A lowering test plus a behavioral golden for an avg-over-money projection; mutation-proved through the coercion.

Sources: [numeric-types-audit-2026-08-23](../../audits/numeric-types-audit-2026-08-23.md) F14, plan.json N9. Relates to RS-12, #2560.

## M-T5.37 — test surface v2: a workflow accessor and three matchers — `done` (2026-09-22 — P9 [#2985](https://github.com/Loom-Harness/Loc/pull/2985) + [#3002](https://github.com/Loom-Harness/Loc/pull/3002), P11a [#2987](https://github.com/Loom-Harness/Loc/pull/2987), P11b [#3001](https://github.com/Loom-Harness/Loc/pull/3001); F6 deferred by the owner) · **M** · P1

Design: [`missions/M-T5.37-test-surface-v2-design.md`](missions/M-T5.37-test-surface-v2-design.md).
Wave 3 of the testability-audit fleet ([findings](../../audits/2026-09-13-testability-audit.md) F5 + F11,
[plan](../../audits/2026-09-14-testability-fleet-plan.md)). Six owner decisions are recorded in the
design doc against who made them; the syntax is signed off.

**Two halves, deliberately sized apart.** The **workflow accessor** (`api.<wf>.run()` /
`.instances()` / `.instance(key)`) touches ONE emitter — the e2e suite is backend-agnostic HTTP,
emitted once by `src/system/e2e-render.ts` and replayed against every compatible backend — and
needs no new route: all five backends already mount the command and instance reads (python states
it plainest, `APIRouter(prefix="/workflows")`). The **matchers** touch FIVE, because unit tests run
in-process. The cheap-looking half is the expensive one.

- **P9 — the workflow accessor** — **LANDED**
  ([#2985](https://github.com/Loom-Harness/Loc/pull/2985), and the payload/response contract behind it in [#3002](https://github.com/Loom-Harness/Loc/pull/3002)). Closes
  F5 and M-T9.12's own follow-up, which says asserting a folded workflow instance's scalars "needs a
  workflow-instance read verb the `test e2e` DSL doesn't have yet". Shipped: `api.<wf>.run({…})` /
  `.instances()` / `.instance(key)`, resolved once in `src/ir/util/e2e-workflow-accessor.ts` and read by
  all three call sites (phase-④ `test-checks`, phase-⑦ `e2e-route-checks`, phase-⑧ `e2e-render`).
  Two things the build had to get right and are worth not re-deriving: route emission gates on
  `wf.correlationField`, **not** `instanceWireShape`, because the latter is enrichment-derived and
  absent at phases ④/⑦; and a slug resolves to a workflow only after `findAggregateBySlug` misses,
  which is safe precisely because `loom.workflow-name-collision` compares *names*, not slugs.
  #3002 then closed the gap the new verbs opened — they were briefly the only routes in the surface
  with no payload or response check at all. Its wording is deliberately **not** the aggregate's: a
  `<Wf>Request` is a plain `z.object` / `BaseModel`, so an unknown key is silently DROPPED and the
  POST still answers 204, which is worse than the aggregate's 422, not milder.
- **P11a — `toThrow(precondition)` / `toThrow(invariant)`** — **LANDED**
  ([#2987](https://github.com/Loom-Harness/Loc/pull/2987)). Unit tier only; refused in an e2e body,
  where both kinds are a 422 whose only discriminator is a `detail` sentence an authored
  `invariant … message` can overwrite. Motivated by a measured false pass: the audit deleted a
  `precondition` from generated source and the test stayed GREEN, because an invariant threw instead.
- **P11b — `toBeNull` / `toBeAbsent` / `toContain`** + verify-and-document the absence conformance
  contract — **LANDED** ([#3001](https://github.com/Loom-Harness/Loc/pull/3001)). Stacked on P11a (shared `intrinsic-matchers.ts`).

**Deferred by the owner, recorded so it is not mistaken for an oversight:** a principal clause for
`test e2e` (F6) — "a gap, not a bug". Consequence: `requires` / `policy` / `mask unless` and tenancy
denial stay untestable from a user's model, and the repo's own coverage of them stays in
`AUTHZ_LADDERS`, harness-side, shipped to nobody.

**Verified on `main` after the last packet merged.** `e3391083d` (#2985) settled at 825 check runs
with all ten `behavioral-*` legs green — including `behavioral-elixir`, which had to be fixed on the way
in: the vanilla Phoenix workflow controller answered `202` + a JSON body where the wire golden and the
other four backends answer `204` + empty. That divergence was real, not a golden that needed re-minting,
and it was closed by [#2994](https://github.com/Loom-Harness/Loc/pull/2994) rather than by weakening the
oracle. `workflow-create-state` carries the first wire golden anywhere that records
`/api/workflows/<wf>/instances`.

## M-T5.22 — Decimal arithmetic has no governing rule: `0.1 + 0.2` diverges on the wire AND in storage — `done` (2026-09-28, Wave C5 moment 5a — RS-37; the precision/refine/doc-drift residue handed off) · **L** · P1 ⭐ ruling GIVEN 2026-09-07: exact

Found 2026-08-23 by the numeric-types audit ([F11](../../audits/numeric-types-audit-2026-08-23.md)). RS-24 pins how a `decimal` *serializes* (a JSON number through a float64) but nothing pins how it *computes*: node/python run float64 arithmetic, .NET/Java/Elixir run exact decimal (System.Decimal / DECIMAL128 / Decimal-context-28). A `derived x: decimal = 0.1 + 0.2` ships — and **persists into the shared unbounded `DECIMAL` column** — `0.30000000000000004` from two backends and `0.3` from three. Single divisions agree only coincidentally (double division is correctly rounded), which is why `7/3` never exposed it.

**Why every existing gate is green.** Zero corpus coverage of float-error-visible decimal arithmetic — and the witness cannot be added first, because it alone turns three backends red against the node oracle. The ruling comes first.

**THE RULING — given by the owner 2026-09-07. `decimal` arithmetic is EXACT.** `0.1 + 0.2` answers `0.3` on every backend, on the wire and in storage. .NET/Java/Elixir already conform; **node and python change to match them**.

This **supersedes the audit's proposed float64/node-oracle default**, which is struck rather than left standing beside it — the rationale for the override: `decimal` exists precisely to avoid binary-float error, so a decimal type that answers `0.30000000000000004` is broken by its own definition. Do not re-open this as "the audit suggested otherwise".

**The cost, accepted knowingly.** This is a WIRE-VISIBLE change on node and python: their API responses and newly-persisted values change. Existing rows are NOT rewritten, so historical rows may disagree with new ones — an implementing PR should say so in its body and consider whether a migration note belongs in `docs/migrations.md`. And the node oracle that the wire-golden and behavioural tiers compare every other backend against MOVES with this change, so those goldens are re-captured as part of this mission (`LOOM_WIRE_UPDATE=1`), reviewed diff-by-diff — never as a drive-by rebaseline.

**Scope the implementation FIRST, before writing any of it.** Python already has `Decimal` in play on the column side (M-T6.45 landed that), so its gap may be narrow. The Hono/node backend is the unknown: it likely needs a decimal library threaded through the domain layer and the derived-field evaluator, and that cost — not the ruling — decides how this mission is sliced. Report the finding before implementing.

**Not at stake, so nobody re-litigates it:** `money` is a fixed-scale-4 string, already exact and identical on all five backends. This ruling concerns plain `decimal` only.

Mint the RS rule per the registry's own claim-the-number protocol (`docs/conformance-semantics.md`). Then add the corpus witness and bring node/python into compliance.

**Also carried here** (same ruling's blast radius, from the register annex): node money arithmetic runs at decimal.js default 20-significant-digit precision (no `Decimal.set` emitted) vs 28+ elsewhere; the inbound `decimal` precision-acceptance skew (Java unlimited vs .NET 28–29 vs double-clamped — a Java-written 30-digit value can `OverflowException` a .NET reader of the same column); and the numeric doc drift (`docs/language.md` host-type table predates #2575 and mislabels Java; the stdlib catalog signature `sum → decimal` in `src/util/collection-ops.ts` disagrees with `type-system.ts`'s body-type rule — fix the catalog, regen `docs:stdlib`).

**This is a COORDINATED MOMENT — one PR, nothing else in it.** Measured
2026-09-10: `jq -r .oracle test/behavioral/wire-golden/*.json | sort | uniq -c`
answers **54 node**, and SEVEN behavioural legs diff against those goldens
(`behavioral`, `-mikroorm`, `-dotnet`, `-dapper`, `-python`, `-java`,
`-elixir`). So the instant node goes exact, all seven are red until all 54 are
re-captured — node, python and the goldens have to land **together, alone**.
Landing it as one row inside a multi-row cross-backend packet is the failure
mode to avoid: there, any other row being wrong is indistinguishable from the
oracle move, and a conflict on the goldens blocks the whole packet. Treat it as
a fourth coordinated moment alongside the three in
[completion-waves-2026-09](../completion-waves-2026-09.md) (A4 `getById`,
`denyByDefault`, `organizationContext`). Note the move is more visible than it
was before [#2807](https://github.com/Loom-Harness/Loc/pull/2807): the differential
now compares number FORMATS as well as values, so an oracle shift diverges on
spelling too, not only on magnitude.

**Verification when it lands.** The new corpus case green on all five behavioral legs; the RS entry in the registry; mutation-proved by reverting one exact-side backend. **Every leg is locally runnable** — including elixir, whose toolchain lifts out of the `hexpm/elixir` image onto the host (`docs/tools.md` → "Running `mix` on the HOST"); verified 2026-09-10 by running `node run-elixir.mjs core-domain` that way (`2 passed, 0 failed`, 0 divergences), which corrects [#2807](https://github.com/Loom-Harness/Loc/pull/2807)'s body where it claims the elixir leg does not run on a sandbox host. It does. Re-capture the goldens against a leg you have RUN, never against CI alone.

Sources: [numeric-types-audit-2026-08-23](../../audits/numeric-types-audit-2026-08-23.md) F11 + annex, plan.json N7. Relates to M-T6.46/M-T6.47 (the response-narrowing halves), RS-24.

**Landed 2026-09-28 (Wave C5 moment 5a).** Scope measured first and reported before building: node's cost was **M, not L** — one leaf (`TS_TARGET`'s binary arm in `src/generator/typescript/render-expr.ts`, plus the `sum` fold and `decimal.round` intercepts), one aggregate import scan, one `package.json` flag; no repository, DTO or wire codec moved, because each chain narrows back to a `number` once at its root (RS-24 is unchanged). Python is the same three sites in `src/generator/python/render-expr.ts` plus one arm of `addPyExprImport`. Witness `test/fixtures/corpus/decimal-exact.ddd` (0.1 + 0.2, a chained multiply, 0.3 / 0.1, a mixed chain, a non-terminating chain `a / 3 * 3`, `1.005.round(2)`, a `sum` fold, and an operation writing a computed value to a stored column) proven red on node and python before the fix (`expected 0.30000000000000004 to be 0.3`) and green, unit + api + wire, on all seven behavioural legs after (node, mikroorm, python, dotnet, dapper, java, elixir — every one run locally). Goldens re-captured from a node run under `LOOM_WIRE_UPDATE=1`: the 63 existing files are byte-identical, `decimal-exact.json` is the one new file. Rule minted as **RS-37** (the gap-free registry refuses an RS-38 before the datetime rule that had reserved 37 lands). Mutation-proved twice on node (revert the leaf → `expected 0.30000000000000004 to be 0.3`; disable only the chain carry → `expected 0.09999999999999999 to be 0.1`). `docs/migrations.md` § "Semantic changes that emit no migration" records that historical rows are not rewritten. **Handed off, not closed here** (none moved a golden, so none rides this PR): node's decimal.js default 20-digit precision (`Decimal.set` / a clone at 28), the inbound decimal precision-acceptance skew, the zod `.refine` that still evaluates a cross-field decimal invariant in doubles (`src/generator/zod-refine.ts`), the numeric doc drift (`docs/language.md` host-type table; `sum → decimal` in `src/util/collection-ops.ts` vs `type-system.ts`), and two side defects the witness found (.NET create param named `e`; java unit `toBe(<int>)` against a decimal) — recipes in [`waves/handoffs/wave-c5-5a-decimal.md`](../waves/handoffs/wave-c5-5a-decimal.md).

## M-T5.28 — `variant-match` off a page crashes all five backends; `for`/`if let` off a workflow emits `this.<unknown>()` — neither is gated — `done` (2026-09-11, Wave C1 packet 1b) · **M** · P1

Found 2026-09-03 by the language-docs audit ([F1](../../audits/2026-09-03-language-docs-audit-findings.md), [F4](../../audits/2026-09-03-language-docs-audit-findings.md), both P0). A `match` over a union in a domain body reports `0 error(s)` and then throws `variant-match statement is frontend-only; it must not reach the <X> backend` from `src/generator/_stmt/target.ts:160` on node, dotnet, java, python and elixir alike — no IR check covers `variant-match` outside a page (`src/ir/validate/checks/store-checks.ts` handles only the page case), and non-exhaustive arms are unchecked too. Symmetrically, `src/ir/lower/lower-stmt.ts` has no arm for `ForStmt`/`IfLetStmt` outside a workflow and no validator rejects them: `operation touch() { for n in notes { owner := n } }` reports `0 error(s), 0 warning(s)` and emits `this.<unknown>();`.

**Resolve the fork before coding.** Each shape can be *gated* or *lowered*. The default is **gate** — both are frontend/workflow-only by design per the source comments, and a gate is S where lowering is L. If the design pass concludes lowering is right, that is a `language-feature-developer` mission: split it out and say so rather than widening this one. Mints codes in `src/diagnostics/messages.ts` — the only Wave-3 packet that may.

**Verification when it lands.** Both shapes raise a `loom.*` code with the offending span; each gate mutation-proved by file-copy revert, reading *which* assertion fails.

**Also carries M-T5.27's residue (re-homed 2026-09-10, Wave C0.4).** [#2789](https://github.com/Loom-Harness/Loc/pull/2789) minted `loom.locator-matcher-receiver` in `src/language/validators/match.ts:151`, deliberately re-deriving the ui-e2e renderer's handle rule at the AST layer because `src/ir/validate/checks/**` was another packet's tree. Its proper home is `validateE2ETest` (`src/ir/validate/checks/test-checks.ts:132`), which already walks these statements with the resolved IR and today has no `locator` handling at all. Consolidate it here while in the file. The mutation proof makes the case that gate and renderer are genuinely independent: under the *renderer* mutation the validator still passed the source and the renderer crashed, so neither alone covers F6.

Sources: [language-docs-audit-2026-09-03](../../audits/2026-09-03-language-docs-audit-findings.md) F1/F4 + "Cross-cutting reading" §2, [wave plan](../../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W3.1**; M-T5.27's `loom.locator-matcher-receiver` consolidation.

**Landed 2026-09-11 (Wave C1 packet 1b).** All three shapes **re-verified on this head before building** — the `match` still threw on all five backends (`variant-match statement is frontend-only; it must not reach the {TS,.NET,vanilla Elixir,Java,Python} backend`), and `for` / `if let` still emitted the `<unknown>` sentinel: `this.<unknown>()` on node/.NET/Java, `self._<unknown>()` on python, `_ = <unknown>(record)` on elixir. The fork resolved as **gate on all three**, per ruling D-FOR-IN-DOMAIN ([completion-waves-2026-09](../completion-waves-2026-09.md) §5 #3), with the honest-gap/permanent-refusal split the ruling asks for: `loom.variant-match-placement` and `loom.if-let-placement` say "permanent placement rule", `loom.for-placement` says "a GAP, not a design rule" and names **M-T5.30** as its successor.

The gate is **phase ④**, not phase ⑦, and that was the one real design call: `for` / `if let` outside a workflow have **no IR node at all** — `lower-stmt.ts`'s fallback has already replaced them with the `<unknown>` call sentinel before an IR check leaf could look — so an IR-level gate could only match on the sentinel, a proxy for the defect rather than the defect. Containment alone decides all three answers, so the check needs nothing lowering would add. One new leaf, `src/language/validators/stmt-placement.ts` (a single `streamAllContents` pass classifying each statement's body owner as frontend / workflow / domain); the `src/generator/_stmt/target.ts` throw survives as an internal-invariant assertion for a caller that generates without validating, with a `default:` arm keeping the `StmtIR.kind` switch exhaustive.

Refusal fixtures live at `test/language/validators/fixtures/stmt-placement-*.ddd` beside their gate, **not** in `test/fixtures/corpus/`: that corpus is a positive matrix (`corpus-coverage.test.ts` requires every `<id>.ddd` to GENERATE on each declared backend) and carries no `expectDiagnostics`-style key in `manifest.ts` or its harnesses, so an expected-diagnostic fixture has no row shape there. A fourth fixture, `stmt-placement-allowed.ddd`, is the over-fire guard — all six legal sites (workflow `create` + `commandHandler` × `for`/`if let`, plus a page `action`'s `match await`) in one source. Four mutation proofs by file copy, each naming its failing assertion, in the hand-off note.

Sources: [language-docs-audit-2026-09-03](../../audits/2026-09-03-language-docs-audit-findings.md) F1/F4 + "Cross-cutting reading" §2, [wave plan](../../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W3.1**, hand-off [`waves/handoffs/wave-c1-1b-placement-fork.md`](../waves/handoffs/wave-c1-1b-placement-fork.md).

## M-T5.34 — the rulings the dev-experience audits deferred, as one diagnostics packet — `done` (2026-09-13) · **M** · P1

Mints three `loom.*` codes in one packet because each one edits the shared catalog (`src/diagnostics/messages.ts`), and separate PRs against that file conflict on every merge. Closes [#2864](https://github.com/Loom-Harness/Loc/pull/2864) findings **D5**, **D6** and **G2**; implements decisions **D-1(c)** and **D-2** of the freight-audit fleet plan (`docs/audits/2026-09-10-freight-fleet-plan.md`, landing with #2864).

**A fourth ruling was drafted and dropped.** The packet also drafted the command-side correlation gate for the case **(B)** that [#2850](https://github.com/Loom-Harness/Loc/pull/2850) deferred. It landed independently on `main` first, as `loom.workflow-create-correlation-unsupplied` (F58 / M-T6.62), with a **better** rule than the draft: it also accepts a `<corr> := <param>` assignment as supplying the key, and fires only when the create body actually touches own state. Nothing was kept from the draft — see the note under "What this packet does not own".

| Code | Refuses | Source |
|---|---|---|
| `loom.workflow-handle-unsupported` | a `handle <name>(…)` continuation — emitted by no backend | #2864 D5 / D-1(c) |
| `loom.entity-part-param-unsupported` | an entity-part-typed parameter on a public action | #2864 D6 / D-2 |
| `loom.reactor-without-starter` | `on(…)` reactors with no `create(…)` starter | #2864 G2 |

**Why each is a ruling and not an emitter.** D-1(c): the silence is the bug; whether Loom grows multi-command sagas is a feature decision — the emitter half stays with **M-T6.58**, whose option (b) this lands. D-2: materializing an entity-part parameter means answering whether client-supplied parts *replace* the collection (new ids, history orphaned) or *merge* by id, which the DSL has never answered — deferred to a proposal, with the diagnostic pointing at the value-object alternative that is already emitted correctly.

**Two boundaries were verified against the emitters rather than assumed**, and both narrowed the packet: a `private` operation emits no wire contract at all (so the D6 gate is public-only), and a declared `create`'s parameter list is not the request contract (so the create position is out of scope — it is #2861's finding, and the create input already emits `<Part>Response` correctly from the aggregate's fields). **What this packet does not own.** The command-side correlation ruling is `loom.workflow-create-correlation-unsupplied`, landed separately; its rule lives in `src/ir/util/workflow-own-state.ts` so the phase-⑦ gate and the phase-⑧ emitters stay exact complements. The **create-parameter-list** question is `loom.create-params-not-wire` (#2861 slice 4, tracked by **M-T5.32**), which is why the entity-part gate here deliberately skips the `create` position rather than widening onto it.

**Cost paid, named here so it is not rediscovered:** `examples/showcase.ddd` authored a `handle reset()`, so the ruling broke the repo's own conformance fixture. It gave up the member (its contract is "validates with zero errors"), which put `HandleDecl` into the showcase ALLOWLIST, the clause census's `UNAUTHORED_CLAUSES`, and cost `HandleIR.statements` its "arrived over a real example" proof. All three name M-T6.58 as the drain condition. The `*-unsupported` gap pin rose 51 → 52 for the `handle` row — the register's intended trade: a silent five-backend hole became a named, owned, drainable one.

**Audit G4 (the value-object-collection create-input asymmetry) is NOT in this packet** — see M-T5.35.

Sources: [#2864](https://github.com/Loom-Harness/Loc/pull/2864) — `docs/audits/2026-09-10-freight-dev-experience.md` D5/D6/G2 and `docs/audits/2026-09-10-freight-fleet-plan.md` D-1/D-2, both landing with that PR (cited by path, not linked, because they are not on `main` yet); #2850's `create-state.ts` header. Lands M-T6.58's option (b) for `handle`.

## M-T5.35 — a value-object collection is required create input; an entity containment is not — `done` ([#2918](https://github.com/Loom-Harness/Loc/pull/2918), merged 2026-09-28; archived 2026-09-29 by wave L0) · **M** · P2 ⚠ carried a five-backend wire-contract change

**Landed as [#2918](https://github.com/Loom-Harness/Loc/pull/2918)** — rule (a), every non-nullable collection field is omittable and defaults to `[]` (the wire-contract change named as such in the PR). Evidence on `main`: `hasImplicitDefault` admits `array` (`src/ir/enrich/wire-projection.ts:200`), a new `empty-collection` omission value is handled in each of the five factory emitters, and Elixir's OpenApiSpex emitter now consumes `isRequiredCreateInput` instead of re-deriving the `bool` arm. Gate: `test/conformance/create-input-collection-parity.test.ts` (8 cases, per-backend mechanism; mutation-proved — 6 of 7 fail on the revert). All nine `behavioral*` legs green with the goldens unshifted. **Named follow-up, not done here:** a behavioural case that OMITS the collection and reads back `[]` (the goldens always supply it) — folded into M-T9.74's corpus list.

Audit **G4** of [#2864](https://github.com/Loom-Harness/Loc/pull/2864), **split out of M-T5.34** rather than folded into it — see "Why it is its own mission" below.

Changing `entity Leg` to `valueobject Leg` turns a clean model into `loom.workflow-create-missing-field … missing required field 'legs'`, fixed only by passing `legs: []`. Reproduced on `main @ 58f7c5e`: the entity spelling of the same aggregate validates `0 error(s)`. An empty collection is the natural default and the entity spelling already treats it that way.

**The asymmetry is structural, not a bug in one predicate.** A containment is not a create-input field at all — `buildCreateInput` reads `agg.fields`, and containments live in `agg.contains` / `agg.parts`. A value-object collection *is* a field, so it falls through to `isRequiredCreateInput`, which relaxes only for nullable, explicitly-defaulted, and implicitly-defaulted types — and `hasImplicitDefault` (`src/ir/enrich/wire-projection.ts`) admits `bool` and nothing else.

**Why it is its own mission, not part of M-T5.34.** The fix is one line (`array` → has an implicit default), and applying it locally made the G4 repro pass and broke **nothing** in the fast suite. That understates it. The predicate is the single source every backend's required-set derivation consumes, so the change moves the **wire contract on all five backends** — zod `.default([])`, the Pydantic field initialiser, the record positional default, the Java `RequiredSet` row, the Ecto changeset — and therefore the `required` arrays in the served OpenAPI documents and `.loom/wire-spec.json`. The fast suite covers none of the tiers that would see that: the wire-golden differential, the 5-way OpenAPI parity diff, and the per-backend compile legs. It is also **wider than G4 asks**: it relaxes *every* non-nullable collection field (`tags: string[]`, `Money[]`), not just the value-object case. M-T5.34 was three refusals, which can only reject models that already miscompiled; this can change the contract of models that work today. Different risk class, different proof obligation, different PR.

**Decide first, then build.** Two candidate rules, and the mission should rule between them rather than assume the one-liner: (a) **every collection field is omittable**, defaulting to `[]` — principled, matches the entity spelling, widest blast radius; (b) **only value-object collections**, which fixes the reported asymmetry but leaves `tags: string[]` required for no stated reason. (a) is the recommendation; it needs the wire-contract change named as such, not slipped in.

**Coordinate with [#2861](https://github.com/Loom-Harness/Loc/pull/2861) slice 4**, whose two create-input gates read this same projection — land behind it.

**Verification when it lands.** The G4 repro pair (value-object vs entity spelling of one aggregate, both clean); the required-set asserted per backend rather than inferred from node; the wire-golden differential and the 5-way OpenAPI parity diff run, not skipped; mutation-proved by file-copy revert.

Sources: [#2864](https://github.com/Loom-Harness/Loc/pull/2864) G4 (`docs/audits/2026-09-10-freight-dev-experience.md`, landing with that PR); `src/ir/enrich/wire-projection.ts` (`hasImplicitDefault` / `isRequiredCreateInput`). Split from M-T5.34.

## M-T5.43 — The variant-`match` STATEMENT keeps a `string` `subjectType`, so the four shape gates never run on it (F56) — `done` ([#3106](https://github.com/Loom-Harness/Loc/pull/3106), L1-V2) · **M** · P2

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](../leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L1-V2 (after M-T5.42) (leftover-waves-2026-09-28).**

Item **V14** (#2838). The expression form of a variant `match` carries its resolved union type; the statement form lowers with `subjectType` left as `string`, so the four shape gates keyed on the subject type (exhaustiveness, unknown variant, binding arity, the error-variant binding) are skipped for it. Pinned as a known gap at `test/ir/variant-match-subject-type.test.ts:70`.

**The fix:** resolve the statement's subject through the same path as the expression form; flip the pinned `it.fails` in the same PR.

**Verification.** The pinned case flips; one negative case per gate on the statement form.
