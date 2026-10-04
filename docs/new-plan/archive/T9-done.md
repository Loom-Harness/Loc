# T9 — Toolchain & process health — completed missions

*Archived 2026-09-02 from [`../T9-toolchain-health.md`](../T9-toolchain-health.md). Every mission below is closed (`done` / `shipped` / `closed` / `concluded` / `withdrawn`); the bodies are moved verbatim (links re-based one level deeper) so the evidence trail stays readable. Nothing here is open work — the live track file lists what remains.*

## M-T9.1 — Langium 3.3 → 4.2 — `done` (verified 2026-07-13) · —
Sources: [dependency-upgrades](../../old/proposals/dependency-upgrades.md).

## M-T9.2 — Persistence-emit seam (`PersistenceTarget`) — `concluded` · **XL** · P1 ⭐ (design-first)
The last un-abstracted N: entity/schema/repository/routes emission is hand-written per backend (elixir 70 files / dotnet 61 / java 51 / python 37); every storage feature re-lands N times (part-in-part: 36 files). Design the analogue of `ExprTarget`/`WalkerTarget` for the regular-shaped persistence fragments. **Start from the design brief: [`missions/M-T9.2-persistence-seam-brief.md`](missions/M-T9.2-persistence-seam-brief.md)** — divergence audit first (with the pre-registered decline criterion), then contract + slicing for sign-off, then byte-identical extraction one fragment × one backend at a time (PRs #607–#627 pattern). **T10 target growth stays frozen until this exists.**
**CONCLUDED 2026-07-13** — design + implementation done; see [`missions/M-T9.2-persistence-seam-design.md`](missions/M-T9.2-persistence-seam-design.md). Delivered: (1) full divergence audit + seam design (merged #1876); (2) **the `src/generator/_persistence/` home + the shared seed-dataset spine** extracted from TS/.NET/Python, byte-identical (merged #1876); (3) **`resolvePersistence()` removed** — closes the M-T6.10 core orphan (#1887). **Key finding:** every `Target`-style extraction candidate **declined at the byte level** (§0.4 events/ids/enum; §0.6 wire; §0.7 **QueryTarget**, the flagship) — "regular-shaped" (parallel decision tree) is a strictly weaker property than "byte-identical-extractable" (shared *composition* API), and every ORM composes differently (Drizzle combinators vs SQLAlchemy operators vs EF fluent vs JPA annotations vs Ecto changesets), so composition diverges even where the tree is parallel. The **one** fragment that was parallel *and* composition-free was **seed** — the one that extracted. **Realizable seam = seed + the already-shared substrate** (`MigrationsIR`/`wireShape`/`sql-pg`/`ExprTarget`/`intrinsicKey`/deny-deep detection). This satisfies the brief's actual success criterion ("every divergent fragment deliberately per-backend, reason recorded"). **T10 is unfrozen** — a 6th backend inherits the whole shared substrate + the seed pattern; its persistence *composition* was always going to be per-ORM (not debt a seam could remove). **Follow-up (own PR, S):** remove the four dead `emit*` methods (entangled with the pinned interface + stub mechanism — see §2.7-Q1).
**Refinement (2026-07-17, independent re-read):** the *write* path is a genuine hard wall (five foreign ORM write topologies — EF change-tracking / Spring `save()` / Ecto changeset tuples / Drizzle↔SQLAlchemy insert-onConflict), but the design doc's §0.7 "a shared dispatcher **cannot** unify" framing on the flagship `QueryTarget` is overstated: it defeats only a *string*-returning dispatcher. An **AST-returning** `QueryTarget<Q>` (the doc's own §2.3.1 sketch) absorbs the Drizzle-combinator-vs-SQLAlchemy-operator split as ordinary leaf-spelling and *could* unify TS/Py/Java (the ~9-arm queryable walk + the deep-scope composition are still triplicated). So `QueryTarget` is a **cost/benefit** decline (nets 3 backends; substrate already shared; intrinsic tables stay per-backend), **revisitable under real query-path feature traffic** — not the structural impossibility §0.7 presents. Recorded in the design doc's addendum so a future reader doesn't treat "declined" as "impossible."
Sources: the brief, the design doc, weak-spots §5, maintenance audit.

## M-T9.9 — Authorization filters: sentinel `ExprIR` → discriminated `FilterIR` node — `done` · **M** · P1 (safety)
Sources: realness audit (2026-07-17), `experience_gathered.md` §51.

## M-T9.10 — Elixir in the per-feature corpus compile matrix — `done` · **M** · P2
Sources: found during the 2026-07-21 integrity audit (PR #2203); relates to M-T9.3 (Elixir per-PR parity-boot residue) and M-T6.3.

## M-T9.11 — Cross-backend differential response gate — `done` · **L** · P1 ⭐
**DONE — slices (b) + (c) landed.** The differential is now a **per-PR blocking gate on every backend**, at zero new CI boot cost. Shape: instead of diffing the five backends against each other on one heavy compose boot, each backend is diffed against a **committed canonical golden** (`test/behavioral/wire-golden/{ledger,payments,sales,shapes}.json`, one per shared system, captured from node) — because A ≡ golden ∧ B ≡ golden ⇒ A ≡ B, the N-way differential decomposes into **N independent one-way gates**, each riding a `behavioral-e2e*.yml` workflow that already boots that backend per-PR. That also supplies the thing slice (a) proved was missing: an **oracle**. Pieces: the pure core `test/_helpers/wire-record.ts` (path templating, ordinal-keyed recording, seq-aligned diff with desync short-circuit, waiver matching, report) + 26 fast-suite cases in `wire-record.test.ts`; the runner glue `test/behavioral/wire-differential.mjs`; a recorder spliced into the ONE `fetch`/`app.fetch` chokepoint of all **seven** runner legs (five backends + the `dapper`/`mikroorm` persistence-adapter legs — an adapter must not change the wire); and the ratcheting waiver registry `test/_helpers/wire-waivers.ts` (a waiver that stops matching fails the gate as **stale**, so a fix deletes its waiver in the same PR).
**Verified by booting all five backends against the final registry** (node on PGlite; python on host `uv`; dotnet/java/elixir in their toolchain containers against a real postgres). **The gate found three live divergences on its first five-backend run, none of which any existing gate could see** — both new rules are minted in `test/conformance/semantics-rules.ts` + `docs/conformance-semantics.md`: **RS-13** — elixir answers every create `POST` with the FULL aggregate where the other four (and elixir's own emitted OpenAPI) return the `{id}` envelope; **RS-14** — the `version` INCREMENT path is shape-dependent *and inverted between backends*: canonical document/embedded/plain = 2/2/3, dotnet+java read 1/2/3 (concurrency token bound to a mapped column, but a document aggregate's `version` lives in the jsonb blob), elixir reads 2/1/1 (the mirror image). RS-11 covered version at *create* only, which is why this survived. Also fixed registry drift the sweep exposed: `semantics-rules.ts` still listed RS-11/RS-12 as open after M-T6.11/M-T6.22 (#2255) closed them — only the markdown had been updated. Follow-on fixes **DRAINED in #2292** — RS-13 (elixir create envelope) and RS-14 (the `version` increment on dotnet/java document + elixir embedded/plain) are fixed and the waiver registry is EMPTY again, so the gate enforces cross-backend agreement unconditionally on all seven behavioral legs. That PR also fixed the MikroORM ES-workflow boot crash (`drizzle-orm` imported into a mikroorm project) that had `behavioral-e2e-mikroorm` red on `main` since `43337b5f`. The nightly all-pairs `differential-report.yml` **stays**, now scoped as the DISCOVERY sweep over the wider compose stack (showcase, phoenix) feeding this gate's answer key.
**Follow-on: RS-15 + the error envelope — closed in #2300.** The gate's second sweep found the last of the three coverage gaps `wire-contract.ddd` was minted for: the **error envelope**. A tripped `precondition` split four-vs-one (node/dotnet/java/python **400**, elixir **422**) — and elixir's was the *deliberate* ladder, so this was RS-12's shape (an open canonical decision), not RS-13's (a one-backend bug). Owner decided **422** (RFC 9110 §15.5.21 — well-formed, semantically rejected); the *majority* moved. Landing it needed a second, unplanned fix: the golden is byte-exact and elixir's bare `:precondition_failed` atom carried no message, so its `detail` was a fixed sentence where the other four name the failed predicate — the message half of **M-T6.20**, done early because it was the blocking dependency. The golden now pins the whole 7807 body (`type`/`title`/`status`/`detail`/`instance`) on all five, **with no waiver** — `wire-waivers.ts` is still empty. Two debts the work exposed are scoped, not absorbed: **M-T5.20** (the denial ladder is only half-routed through `resolveErrorStatus`, which is why the flip cost five hardcoded edits) and **M-T6.24** (elixir's two remaining untyped denial edges, one an `inspect/1` leak).

**Follow-on: golden COVERAGE 5 → 24 of a reachable 31 (landed in #2323).** `LOOM_WIRE_UPDATE=1 node run.mjs` with no case filter mints a golden for **every** case; run once during #2300 it produced 28 new files beyond the five tracked. They were deliberately **not** committed: a golden is a *reviewed answer key*, and 28 unread ones would either rubber-stamp whatever node happens to emit (the exact failure RS-11 warns about) or fail five CI legs at once on divergences nobody has looked at. The expansion was done instead in **batches — mint → read → boot → fix or mint an RS-rule → commit**, never waive; the only waivers in `wire-waivers.ts` were the two ratcheting java RS-20 ones. (Those grew to five as later windows onto the same bug opened, and were **all deleted** when java's `version` was moved off JPA `@Version` onto a command-driven guarded bump — the ratchet working as designed.)

**Count the denominator from the runner, not the fixture directory.** The behavioural runner enumerates **31** cases — 26 corpus features + the 5 shared systems. `test/fixtures/corpus/` holds 33 `.ddd` files, but **7 carry no `test e2e` block at all** (`api-call`, `channels-broker`, `extern`, `extern-handlers`, `outbox`, `resources`, `tenancy-hierarchy`), so they never reach the recorder and there is nothing to record. (Two intermediate figures in this paragraph's history — "33" and then "27" — were both wrong, the second because it was derived by subtraction from the fixture *directory* instead of by reading `▶` lines out of an actual run. The runner is the authority.)

**Yield: RS-16 … RS-25 — ten rules across four backends**, and it stayed high to the last batch: the elixir leg's *first ever* boot produced four (RS-21 again, RS-24, RS-25, and a reopened RS-18).

**Coverage is now 31 of 31 — the tail is drained.** The last seven (`eventsourced-workflow`, `saga`, `auth-oidc`, `auth-simple`, `criterion-filter`, `domain-services`, `scaffold-macros`) were minted, read, and booted on **all seven runner legs** — five backends plus the `dapper`/`mikroorm` adapter legs — 49/49 green, **zero divergences**, no new waivers. Two of them (`domain-services`, `scaffold-macros`) put a plain `decimal` inside a user-declared `valueobject`, so they are now the standing regression net for RS-24; the trap there is that `Money` in those fixtures is a **user valueobject with `amount: decimal`**, NOT the `money` intrinsic, so RS-12's fixed-4dp *string* must not apply and RS-24's *number* must.

**The four elixir waivers — the last of the original registry — are drained.** Both were fixed on the diverging backend rather than re-waived, and both waivers went in the same commit as their fix (the ratchet working as designed). **RS-18** — the crudish UPDATE persists through `update_changeset/2`, so the synthesized `operation update(...)` body never ran and a `provenanced` field kept the PREVIOUS write's lineage; the elixir repository `update/2` now re-captures each renderable write site off `Ecto.Changeset.apply_changes/1` and flushes the history in the same save transaction the named-op persist tail uses. **M-T6.20** (three entries, one divergence) — a messaged `precondition` over the operation's own request params answered the DOMAIN-FLOOR 422 where the other four lift it into the `<Op>Request` validator and answer the wire-validation rung; `denial.ts` gains a wire rung (`{:validation_failed, [%{pointer, message, code}]}`), gated on `classifyForWire` against the op's params — so a precondition over `this`-state (`wire-contract`'s `discontinue`) correctly stays on the floor — and ProblemDetails gains one `send_validation_problem/2` sender both 422 rungs share. Verified by booting the whole elixir leg locally: 36 cases compared to golden, **0 divergences**, with no elixir waiver left. (The registry did not stay literally empty — #2563 landed the same day with a narrowly-scoped dotnet entry for `System.Decimal` truncating a projection `avg` past ~15 significant digits, which remains the sole entry.)

**But the remaining hole is bigger than the one that just closed.** 7807 bodies are the single richest vein this tier has ever hit — RS-16, RS-17, RS-19, RS-21, RS-22 and RS-27 were *all* found on an error response — and the goldens barely cover them: **only 4 of 31 record an error body at all** (`operation-returns` 404, `union-find-absence` 404, `state-gate` 409, `wire-contract` 422).

*(An earlier revision of this note claimed **zero** goldens recorded a 4xx. That was an agent's summary I repeated without checking; counting them gives four. The corrected number does not change the conclusion — the recorded 422 is the DOMAIN FLOOR, so the wire-validation rung that RS-27 turned out to cover was genuinely unpinned — but a wrong denominator in a coverage argument is exactly the kind of claim this tier exists to stop being made from memory.)*

Three specific gaps, in priority order:

1. **The `requires` DENIAL is unpinned per-PR — but no longer BLOCKED (updated 2026-08-17).** `auth-simple`/`auth-oidc` record only the *satisfied* guard, and the 401/403 **bodies** are still asserted only by the six `*-oidc-e2e.yml` workflows (`push: main` + `run-oidc` label, not per-PR). The stated blocker — "the fixture cannot express a second, unauthorized principal against one `DEV_CLAIMS` identity" — **shipped in #2515**: `DEV_CLAIMS_UNAUTHORIZED` / `oidc.unauthorizedToken` exist, and the three-rung `AUTHZ_LADDERS` walk asserts 401/403/2xx STATUSES on all five legs. What is left is exactly the golden half: the ladder deliberately rides the **unrecorded** dispatch (recording it would shift the ordinals the goldens align on), so promoting it to a recorded probe is a deliberate rebaseline — the open work of #2541, not a harness gap.
2. **`criterion-filter` pins less than its name implies.** `filter Active` (`!archived`) and `find recent() where archived == false` exclude the *same* row, so the golden cannot tell a working capability filter from a working `where`. `filter InRegion("EU")` is never discriminated (both rows are EU), and nothing point-reads the archived row — the one call that would prove the filter reaches `findById`. The emitter *is* correct (node's `findById` ANDs both criteria in), but the differential is blind to it. One `expect(api.orders.getById(archivedOne)).toThrow(404)` in the fixture makes it real on all five.
3. **`scaffold-macros` never exercises its `softDeletable` half.** `isDeleted`/`deletedAt?` and `softDelete()`/`restore()` are generated but untouched, so nothing pins whether those bookkeeping columns stay off the wire (RS-3) or how a soft-deleted row reads back.

**Practical note on running the loop — the local half is no longer node+python only (2026-08-01).** The earlier note here said `run-dotnet`/`run-java`/`run-elixir` can't run on a dev host. That was true of the *host as shipped*, not of the box: all three toolchains are obtainable locally, and every one of them converted a blind spot into found bugs the same day.
- **.NET** — `dotnet-install.sh --channel 10.0` into `/opt/dotnet`. First run: **four** divergences (RS-19, RS-21, RS-22 ×2).
- **Java** — build in `gradle:9-jdk25`, as `docs/tools.md` already documents for the compile gates.
- **Elixir** — the `hexpm/elixir` image's toolchain **copies out and runs natively**: `docker cp` `/usr/local/lib/{elixir,erlang}` to the host and put their `bin/` on `PATH` (bookworm binaries run fine on the Ubuntu 24.04 host; set `ELIXIR_ERL_OPTIONS=+fnu`). hex.pm is reachable from the host's Erlang, so no `LOOM_HEX_MIRROR` is needed for this path. First run: **four** divergences — RS-18 (reopened), RS-21 (violated a second time, from an unrelated cause), RS-24, RS-25.
So the loop is: mint from node, **read every golden**, then boot **all five** locally before pushing. Reading still matters — RS-17 came out of reading `state-gate` — but the stronger lesson from this batch is the inverse: **RS-18 and RS-19 were both closed as "all five conform" on the strength of a generated-source grep, and both were wrong.** A grep is not a wire observation. The elixir leg was the last one still being reasoned about rather than run, and it was hiding four bugs, one of them a `tenantId` leaking to every client on every GET.

**Two deliberate non-actions**, against the mission text as originally written: (1) the slice-(c) plan said to "retire the RS-rule *assertions* that were pure anti-drift guards" once the gate blocks — **not done, on purpose**: those assertions are mostly `static`-tier (e.g. `enum-casing-parity.test.ts`), running in the fast suite with **no boot**, while this gate needs a booted backend. Trading a cheap per-PR gate for an expensive one is a downgrade; the RS-rules keep both their assertions and their oracle role. (2) Goldens covered the four **shared** `systems/*.ddd` only. ~~The per-feature corpus cases differ per backend (each runs its own manifest subset), so they carry little cross-backend signal.~~ **That rationale was already STALE when written and is retracted (2026-07-30):** the per-backend `corpus-*.json` allowlists were collapsed into the typed manifest (see M-T9.3's own update note), every corpus feature now declares `backends: ALL`, and every per-backend `BEHAVIOURAL_SKIP` map in `cases.mjs` is **empty** — so a corpus-case golden is FULL five-way signal, exactly like a shared-system one. The real reason they are still unminted is the one in the follow-on above: 28 unread answer keys are not worth having. Coverage expansion is the mission, not a nice-to-have.

**Slice (a) built + first real report read** (branch `claude/loom-ci-gates-quality-3s5p0z`, PR #2220): the pure diff engine `test/_helpers/response-diff.ts` (normalize → all-pairs diff → bucketed report — the runtime-value twin of `openapi-normalize.ts`), fast-suite tested at `test/_helpers/response-diff.test.ts` (18 cases pinning the taxonomy: enum-casing, null-vs-empty, key-set, type-mismatch, ordering, value + the id/timestamp normalization). Wired non-blocking into the already-booted stack in `test/e2e/e2e.test.ts` behind `LOOM_DIFF_REPORT=1` (default OFF — cannot perturb the parity nightly), driven by the report-only workflow `.github/workflows/differential-report.yml` (nightly + `run-differential` label, `continue-on-error`, report → job summary + artifact). The capture authenticates via the parity test's minted Keycloak token so it reads showcase's `seed default` rows (an unauthenticated first run was a false green — every guarded read 401'd and diffed nothing).
**First report (run 30277275068):** 99 divergences over node/dotnet/python/java (phoenix skipped as the parity harness does — a coverage gap, historically the biggest divergence source), collapsing to **2 root causes + 1 contaminated** — minted as RS-11/RS-12 (`test/conformance/semantics-rules.ts`). **A key lesson landed here:** the differential finds the *divergence*, but the *oracle* (which side is right) needs the source of truth, NOT a majority vote. (RS-11) `version` init: three backends agree on `0`, node emits `1` — but the `versioned` capability declares `version: int token = 1` (prelude.ts), so **node is correct and the other three are the bugs** (the majority was wrong; had we blind-fixed the outlier we'd have broken the one right backend and entrenched the bug ×3). (RS-12) money wire scale: node `"0"` vs others `"0.00"` — no spec mandates a scale, and java itself drops it in derived contexts, so it's an **open canonical-format decision**, not a node-only bug. The 3rd (derived `seqTag`) is contaminated by slice-(a)'s index alignment → deferred to slice (b). Remaining: (b) **id-keyed** per-request recorder + pull phoenix in + normalizer tuning; (c) promote to a blocking gate. **Follow-on fixes → T6:** the version-init bug is in **dotnet/java/python** (honor `= 1` on create); money needs a canonical-scale decision first.

The runtime contract is enforced two ways today and **neither catches an *unnamed* divergence**: the structural spec-diff (`conformance-parity`) compares OpenAPI *shape*, blind to values; the RS-rules (`docs/conformance-semantics.md`, `test/conformance/semantics-rules.ts`) are a **hand-written registry seeded reactively from past bugs** — each clause born from a `fix:` commit after the drift already shipped (the doc's own evidence: "~40% of the last 50 commits are `fix:`, majority Elixir wire-parity chases … found late"). The behavioral tiers (M-T9.3) boot each backend on the *same* emitted api suite but assert **locally** (each backend passes its own emitted asserts) — nobody diffs backend A's actual response bytes against backend B's, so any field no test author thought to assert (enum casing, `[]`-vs-`null`, timestamp precision, decimal serialization) passes independently on both.
**Build the missing sensor:** replay one identical request sequence across all five booted backends and **diff the normalized response bodies/status/headers pairwise**. Alignment is free — every `test/behavioral/run-*.mjs` already dispatches through one `fetch(BASE + …)` chokepoint running the *same* emitted suite, so request N is the same code path on every backend; key the diff by sequence ordinal, not URL (ids differ per run). This is a **normalized semantic diff, NOT a byte diff** — strip the legitimately-varying fields (uuids, ISO timestamps, id-bearing URLs) on an explicit allowlist, canonicalize key order, then diff what remains. What survives is the contract: field names, enum casing, absence shape, list ordering, decimal value.
**Relationship to the RS-rules (not a replacement — the discovery engine that feeds them):** the differential only catches *disagreement*; it is silent on *consensus-wrong* (all five emit `PENDING` when the wire says lowercase) — that stays an RS-rule (absolute assertion) and on all-five-identically-broken (that stays the behavioral per-backend correctness asserts). When the differential flags a split it says *they disagree*, not *who's right* — the RS-rule remains the **oracle** naming the winner. Net effect: RS-rules are promoted from *net* to *reference answer key*; every divergence the differential surfaces proactively becomes a candidate RS-N+1 you mint **before** paying the fix-commit tax. Folds the runtime-comparison leg of `conformance-full` (T3) into itself; the spec-parity leg stays.
**Slices:** (a) **cheap first cut, non-blocking** (~1 day) — after each backend's suite runs, `GET` the findAll per aggregate, normalize, pairwise-diff, emit a bucketed report artifact (`continue-on-error`, no gate); read the first report to *size the fix* before committing to more. (b) full per-request recorder (tap the `fetch` chokepoint → `record-<backend>.jsonl`) + the normalizer (the real work: money/decimal, null-vs-absent, allowlist tuning) + pairwise differ bucketing divergences by type. (c) once the report is empty (or every survivor is a minted RS-rule), **promote to a blocking gate** and retire the RS-rule *assertions* that were pure anti-drift guards (keep the rule text as oracle). Sequence deliberately report-first: the measurement **is** the estimate for the fix campaign, which is open-ended and priced only once the divergence surface is visible.
Sources: `docs/conformance-semantics.md`, `docs/conformance.md`, weak-spots §"nightly-only feedback loop"; relates to M-T9.3 (behavioral tier is the boot substrate) and the RS-rule registry.

## M-T9.24 — Drain the fleet bug-hunt register — `done` (all 26 items closed; G2 needed one follow-up) · **M–L** · P2
[`docs/audits/fleet-bug-hunt-2026-07-19.md`](../../audits/fleet-bug-hunt-2026-07-19.md) is the repo's largest single bug register: a 12-dimension agent fleet (78 agents) produced **33 raw findings, all 33 surviving two-lens adversarial verification**, deduplicated to **25 unique bugs** — wrong-value, build-break and boot-break, across the type system, all five backends, the walker/frontends, the IR, the scaffold macro and the Phoenix migration emitter. **Until 2026-07-30 no mission tracked it and no plan doc referenced it**; the coverage table's Audits section didn't list it (see the corpus-audit note in [README](../README.md)).

**Step 1 — re-verification — is DONE (2026-07-30).** All 26 items (25 unique + F1b) were re-checked against `main` @ `7938c9b` and the audit now carries a **[scorecard](../../audits/fleet-bug-hunt-2026-07-19.md#scorecard--re-verified-against-fresh-main-2026-07-30)** naming, per row, either the code that closes it or the code that still carries it. **Tally at re-verification: 12 fixed, 13 live; all four groups have since been drained — the register is FULLY closed.**

Eleven items had closed in the eleven days since the hunt — **four of them silently** (B5 Python `money_str`, D1 document optional-containment guards, E1 `tools.jackson` `JsonNode`, E3 finder `collectJavaTypeImports`): no inline note in the audit, no mention in whatever mission fixed them. That is the whole argument for this mission existing. A2 and A4 deserve special mention as *survivors of a near-miss*: A1's `int/int` fix landed the machinery (`isIntDivWidenedToDecimal`) that would close both, and neither was wired to it — A2 because the `avg` desugar stamps `leftType: numPrim` with no `rightType`, A4 because `promoteMoneyOperands` stays literal-only. A4 was reproduced with the CLI (emitted Java calls `BigDecimal.divide(int, MathContext)`, an overload that does not exist).

**Step 2 — drain the 13 survivors in four groups** (the register's own suggested ordering, minus what has since landed):
1. **Numeric semantics — DONE.** All six closed. A2 + A4 landed first, through the `isIntDivWidenedToDecimal` / `rightType` seam A1 had already built and neither was wired to. A3 (Python `%` floored) now lowers to an emitted `trunc_mod` helper — wired by ONE central pass over the finished Python file map, because a `%` re-renders in the aggregate module, the Pydantic wire validator and the route module, and a per-emitter import line would have missed one and shipped an import-time `NameError`. B3 (Elixir `sortBy`) passes the struct's module as `Enum.sort_by/3`'s sorter, the same dispatch `reductionSorter` already used for min/max. B4 (Python money `sum`) emits `Decimal(0)` as the start. C2 (.NET `firstOrNull`) projects value-type elements through `(T?)` so empty is an honest `null`. Each verified against the real toolchain, not by inspection. **Still open from this group's framing:** whether the M-T9.11 wire-golden set covers these value divergences — it did not catch any of the six, which is the more interesting finding.
2. **Java Jackson 3 leftovers — DONE.** E1 and E3 were already fixed; E2's last 3 refs closed as **2 real + 1 false positive**. The two `emit/channels.ts` outbox mappers moved to `tools.jackson`; `openapi-customizer.ts:707` stays on Jackson 2 *correctly*, because it catches the CHECKED `JsonProcessingException` that swagger-core's own (Jackson-2) `Json.mapper().readValue` throws. **The "why was the gate green" question had the predicted answer, and it is a gate weakness:** the emitted `build.gradle` depends on springdoc unconditionally, springdoc drags swagger-core's Jackson 2 onto every generated classpath, so a stale reference compiles — it just serializes the outbox through a second mapper with different config. Nothing a compile gate can see, so the replacement gate is a source-level scan of the Java emitters with the one legitimate reference pinned and explained (`test/generator/java/jackson3-packages.test.ts`).
3. **Boot-breaks — DONE.** G1 became a validator (`loom.field-default-not-constant`): a field default that reads `this` is rejected on aggregates, parts and value objects, with the message pointing at `derived` — rejecting beats the alternatives, since dropping the default and emitting it only where an instance exists BOTH silently change the declared wire contract, and the two behaviours already disagreed per backend (boot-break on node/Python, silent required-field on .NET/Java). G2 is handled where it originates, in `applyDefaultVersioning`: `version: int` is structurally the field the capability splices, so that spelling stays; anything else errors with both ways out named. **I1** moved the per-module version stride out of the Elixir emitter and into `buildMigrations`, which allocates a `versionBlock` per module and PERSISTS it in the snapshot — emitter-side striding was wrong twice over, computed only for initial migrations (so every module's first delta collided) and leaving the emitted filename disagreeing with the version `migrationHistory` recorded, which trips the migration-baseline guard. **I2** routes Ecto's `alterColumnType` through the shared `renderAlterColumnTypeSql` via `execute/1`, so the `USING` cast Postgres demands survives. Both verified by applying the chain to a real Postgres with `mix ecto.migrate`.
4. **Frontend — DONE.** **F1b**: every React pack's `useForm<…>` generic became a single context variable the shell computes, so the RHF three-generic form (`<FormState, unknown, Request>`) is emitted exactly where the schema reaches money — the one wire type whose `z.input` ≠ `z.output` — and nowhere else. En route: the workflows module emitted no dual aliases at all, so a money-bearing `WorkflowForm` had no `FormState` name to reach for; added under the same gate. **F2**: `emitExpr` gained its `match` arm, folding right into nested `exprTernary`s — deliberately NOT a new seam, because `exprTernary` is already implemented by all six walker targets, so one arm in the shared core landed the fix on every frontend in its own idiom (JSX/Vue/Svelte/Angular ternary, F# `if/then/else`, Dart conditional).

**Why P2 and not P1:** every live entry is real, but the class is "known bug with a written repro", not "unknown structural risk". The value was making the register *actionable* — before the scorecard you could not tell which half was real without re-deriving all 26, which is the same as having no register. Pair the sweep with **M-T9.8** (hollow-work audit): both answer "is a green gate telling the truth", and this register is what a good adversarial sweep produces.

**Sibling registers with open rows** (drain alongside, same discipline): [`repo-code-review-2026-07-19.md`](../../audits/repo-code-review-2026-07-19.md) — ~~F2~~ (**fixed 2026-07-30**; note its scope was UNDER-CALLED — 9 templates across 7 packs, and on React a duplicate `style` prop is TS17001, a *build-break* rather than the wrong-value the register claimed), F1 (Angular/Feliz silently drop non-`extern` user components), A1 (= the 07-18 audit's L1), I1–I4 (CI gate weaknesses); and [`repo-code-review-2026-07.md`](../../audits/repo-code-review-2026-07.md)'s **L1–L4 member-lookup consolidation** (`extends`-chain walking in 1 of ~6 enumeration sites, optional-unwrapping in 2 of 4 lookup paths — one shared chain-aware helper, which is also how A1 closes). Its G4 (deployable `serviceSlug` collision) is **done**.

Sources: [`fleet-bug-hunt-2026-07-19.md`](../../audits/fleet-bug-hunt-2026-07-19.md) (per-bug file:line + repro), [`repo-code-review-2026-07-19.md`](../../audits/repo-code-review-2026-07-19.md), [`repo-code-review-2026-07.md`](../../audits/repo-code-review-2026-07.md). Related: M-T9.8 (hollow-work), M-T9.11 (differential gate), M-T5.16 (compiler-internal fragility), M-T9.4 (review remediation residue).

## M-T9.30 — Flake budget: per-leg pass-rate tracking — `done` (landed #2514; unexercised in the field so far) · **S/M** · P1
`ci-red-alarm.yml` watches for a RED TRANSITION, which is the wrong shape for a flake: a flake's steady state is green, so it gets re-run, goes green, and is forgotten. It is equally blind to the **never-green** class — a leg that has never been green has no transition to alarm on (`api-call-e2e`, red on 100% of its main pushes for two days, #2434).

`scripts/flake-budget.mjs` + `flake-budget.yml` are the other half: daily, each monitored leg's recent `main` run history is read through the Actions API and classified; every leg outside budget gets ONE claiming issue labelled `flaky-gate`, updated in place and closed when the leg recovers. A flake is a bug report with a probability attached — this is what files it. Pure core pinned by `test/system/flake-budget.test.ts` against `test/system/fixtures/flake-budget-runs.json`.

Sources: [quality-audit-2026-08](../../audits/quality-audit-2026-08.md) R10. Sibling of `ci-red-alarm.yml` (M-T9.31 owns that alarm's recovery half).

## M-T9.33 — Diagnostic FIRING census: prove every `loom.*` gate is reached — `done` (UNCOVERED drained to 0) · **S/M** · P1 ⭐ retires a recurring manual sweep
**M-T9.8's item (d) has been a recurring manual sweep for a month, reasoning from a number that is wrong by 2.7×.** A code-identity grep over `test/` reports 131 of 413 catalogue codes uncovered; a message-fragment grep says 111; an instrumented full-suite run — recording every code actually constructed through `diagMessage` — says **49**. The static forms fail in both directions: they miss split message assertions (`e.includes("self-hosted") && e.includes("issuer")` in `test/language/auth-block.test.ts`, which covers all five `auth.ts` codes), and they *credit* 23 of the 49 never-fired codes because a register table or a comment names them.

The 49, by raising site: **19** `system-checks.ts` (almost all the backend-capability `*-unsupported` rejections — M-T9.27's whole thesis is that a NAMED rejection makes a gap honest, and nothing asserts any of those names ever fires), **9** `structural-checks.ts` (`match-*` ×3, `duplicate-find`, `when-`/`union-`/`operation-return-unsupported`, …), **8** `workflow-checks.ts` (the 4 M-T9.19 declared unreachable + `duplicate-workflow`, `isolation-requires-transactional`, `workflow-emit-unknown-field`, `workflow-run-unknown-retrieval`), **7** `macros/expander.ts` (the ENTIRE macro-authoring error surface — pairs with M-T9.18), **2** `query-checks.ts`, 4 singletons. Mostly live rather than dead: nine probed directly through `src/api`'s `validate()` all fire, `duplicate-find` among them — a working gate nothing in 16,584 tests reaches.

It also caught a stale coverage CLAIM: M-T9.19 records `loom.workflow-emit-unknown-field` as covered "by message in `validation.test.ts:2051,2099`" — that file no longer exists, no test names the code, and it never fires. The claim survived because nothing could check it.

**Slice 1 landed — `test/system/diagnostic-firing-census.test.ts`.** The design moved during the build, and the move is the interesting part: **the instrumentation was the right measuring tool and the wrong gate.** Recording `diagMessage` over a full run is a whole-run property — `test.yml` shards 4 ways, so it needs a shard-merge in the roll-up job — and it only ever proves *reached*, not *asserted*. So the gate does not search and does not instrument: it **drives**. Each entry in `FIRING_FIXTURES` is a minimal `.ddd` that must make its code come out of `validate()`. Deterministic, shard-safe, no CI plumbing, and the drain it asks for produces real negative tests rather than a report.

Four buckets, every catalogued code in exactly one: `FIRING_FIXTURES` (proven by running it — 11 today), `UNREACHABLE_PINS` (cannot fire; the reason IS the entry, and a pin under 20 chars fails), `UNCOVERED` (no proof yet — 38, shrink-only, registered in `allowlist-ratchet` too), `COVERED_ELSEWHERE` (364, raised by some other test per the census; **frozen — a new code may never join it**). That last rule is what makes it a ratchet: a code added tomorrow fails until its author writes a fixture or pins it.

Stated limit, in the gate's own header: `COVERED_ELSEWHERE` credits coverage measured ONCE. If the test that raised a code is later deleted, nothing notices. It closes "a code arrives with no proof it ever fires", not the general case.

*Mutation-proved, four directions (reverts by file copy):* (1) `if (false && seen.has(find.name))` in `structural-checks.ts` → `loom.duplicate-find fires` fails, naming it; (2) a new `loom.brand-new-check` catalogue entry → "every catalogued code is accounted for" fails, naming it; (3) drain one `UNCOVERED` entry without lowering the baseline → the anti-slack half fails; (4) add one → the shrink-only half fails. Restored, 16/16 green.

**DRAINED to 0 (2026-08-30).** The 31 that remained on fresh `main` — not 38; seven had been drained since the audit — split four ways, and every code was DRIVEN through `validate()` before being classified rather than reasoned about:

| outcome | n | what it means |
|---|---:|---|
| `FIRING_FIXTURES` | 8 | a minimal `.ddd` raises it |
| `UNREACHABLE_PINS`, **checked** | 14 | the gate's capability `Set` is re-read every run |
| `UNREACHABLE_PINS`, prose | 6 | preempted by scope, the grammar, or a crash-only catch |
| `DRIVEN_ELSEWHERE` (new bucket) | 3 | the macro trio — a named test drives them, pointer checked |

**Two design changes.** (1) A latent pin is no longer prose: `LATENT_GATES` names the actual `Set` each gate consults and re-derives the claim on every run, with the backend roster taken from `parseBuiltinPlatformRef` rather than hardcoded — so a sixth backend family fails the pin and names what is missing. Same treatment for the style/layout menus. (2) A fifth bucket, `DRIVEN_ELSEWHERE`, for codes that are reachable but not from `.ddd` (the macro-authoring trio needs a misbehaving MACRO). It carries a pointer and CHECKS it — the named file must exist and name the code — which is the guarantee `COVERED_ELSEWHERE` explicitly cannot make.

**Three false claims found, all the same shape — a written assertion nothing could check.** `loom.workflow-emit-unknown-field`'s "covered by `validation.test.ts`" cited a deleted file (already known); `loom.workflow-name-collision` was recorded unreachable by M-T9.19 and fires cleanly (corrected at the top of this file); and `deployable.ts`'s own comment claims the style/layout mismatch is "reachable via elixir + `directoryLayout: byLayer`" while the same comment block says two lines earlier that an out-of-menu value errors first — `byLayer` is not in elixir's menu, so it does.

**A fourth was in the new gate itself**, caught only by mutation-proving: the `DRIVEN_ELSEWHERE` pointer check was `toContain(code)`, which passes for a RENAMED code (`loom.macro-escapes-host-RENAMED` contains `loom.macro-escapes-host`). It is now a bounded regex. That is `experience_gathered.md` §59's exact shape, inside the gate written to prevent it.

The census is now a pure ratchet at 0: a new `loom.*` code fails it until its author writes a fixture, pins it with a reason, or points at a test that drives it.

Sources: [test-coverage-audit-2026-08-13](../../audits/test-coverage-audit-2026-08-13.md) §3.1. Retires M-T9.8 item (d); feeds M-T9.27 (the register's rejections gain a firing proof) and M-T9.18 (the macro cluster).

## M-T9.34 — Harness honesty: `generateSystemFiles` must assert phases ④+⑦ — `done` for the helper (phases ①+④+⑦ all asserted; the direct-caller migration is the one follow-up) · **M** · P1
**19% of generator-test generations run on a model the product refuses.** Of 4,139 `generateSystemFiles` calls in one full-suite run, **776** emit from a model carrying error-severity diagnostics, across **174 of the 607** test files that use the helper — `ddd generate` exits non-zero on those fixtures. Two gaps compound: the helper documents that it "runs validation but does not assert it", and `generateSystems` **never runs phase ⑦** at all (`validateLoomModel` is called by `src/cli/main.ts` and `src/api/index.ts`, not by the orchestrator), so a fixture is checked against strictly fewer phases than the CLI runs it through.

This is the general case of two instances already found by hand: #2489 (the render-degradation gate's phoenixLiveView leg had been "green on approximately nothing" — it generated from a validator-REJECTED system) and #2512 (a harness running fewer phases than the product, which invented one finding and hid another).

Concentrated, not scattered: `loom.persistence-mode-unsupported` 622, `loom.lifecycle-body-dropped` 161 (the diagnostic for M-T3.16's live security bug — 161 generations pin emitter output produced from models carrying it), `loom.effect-in-lambda` 63, then 12 codes with ≤10 each. The single largest contributor is one fixture builder: the `phoenixSystem` variant in `test/generator/user-visible-slot-coverage.test.ts` declares its deployable with no `storage`/`resource` wiring, so all 72 of its cases generate from a rejected model (confirmed through `validate()`, the CLI's own merge path).

**Slice 1 landed — phase ④ (AST validation).** The design simplified during the build: with the offenders FIXED rather than annotated, no register and no code-matching opt-out is needed. `generateSystemFiles` now throws on any error-severity AST diagnostic (the same posture it already had for syntax errors), and the rare fixture that must stay invalid calls `generateSystemFilesUnchecked(source, why)` — `why` is required and >15 chars, so the exception is a sentence in the diff rather than a silent second import. Keying an opt-out on `loom.*` codes was abandoned on contact: many AST-level `accept()` sites attach no `code`, so a code-matched register would have been unreliable in exactly the cases it existed for.

**51 fixture files drained**, in ~10 classes: 14 uis whose `api X: Y` parameter was never bound by the deploying `deployable` (and three backends that never declared the `serves:` the binding needs); 9 `api … from <Context>` where `from` takes a *Subdomain*; 9 user-visible string concatenations (an i18n **error**, not a warning as `ddd-validator.ts`'s comment claims) converted to backtick templates; 2 context-local value objects moved to the ambient shared kernel (a `ui` body is not inside a context, so a context-scoped VO is unresolvable from a builder call); a11y alt text; `+=` against an `int` (`+=` is collection-only — the fixture's own comment said "scalar arithmetic"); a Feliz `design:` that named a React pack instead of a daisyUI theme; a Phoenix deployable carrying `targets:` (it self-hosts); a `resource for:` pointing at a repository instead of a context; `uuid` for `guid`; a `crudish` aggregate that also hand-wrote the canonical `create`/`destroy`.

**Two findings the drain produced, which is the point of it:**

1. **A product bug, fixed here.** `checkPage`'s single-valued-property loop treated `DerivedProp` as single-valued, so a page's SECOND `derived` was an error — while every one of the six frontends emitted the chain, and four `page-derived` suites asserted that emission. The feature is sequential by design ("a derived may reference an earlier derived", `docs/page-metamodel.md`); the exclusion `ActionDecl` already had is now `DerivedProp`'s too.
2. **Two fixtures kept INVALID on purpose, each naming an open question** (`generateSystemFilesUnchecked`, reason in the call): the record-param handler form `queryHandler GetOrder(query: GetOrderQuery): OrderResponse` cannot link, because `ddd-scope.ts` admits payload/event types in a type position only inside a workflow `create`/`handle` param — so `scaffold-handlers-contracts`' byte-identical claim has been comparing the macro's output against a model the scope provider rejects; and tenancy's documented `dataKey := parent.dataKey + "." + seg` concatenates the nullable managed path, which the type system has no way to narrow (no coalesce, no unwrap intrinsic).

   **The first is now ANSWERED — the form is supported (#2710).** `localTypeScope`'s `allowTransport` gained a third position, `inHandlerContract`: a `commandHandler`/`queryHandler` record PARAM and its `returnType` are transport boundaries, exactly the two slots `src/ir/util/handler-contracts.ts` (`requestRecordFor` / `normalizeHandlerReturn`) was written to read and `scaffoldHandlers` synthesises. Both refs (`GetOrderQuery`, `OrderResponse`) link, `scaffold-handlers-contracts` is back on the CHECKED `generateSystemFiles`, and the emitted output is unchanged — lowering's env-aware NamedType fallback was already resolving the payload by `$refText`, so the widening changes what the product ACCEPTS, not what it emits. Narrowness is pinned in both directions by `test/language/handler-contract-scope.test.ts` (an aggregate field / operation param / find param / value-object field naming a transport record still fails to resolve).

**Slice 2 (phase ⑦) is the bigger half** and is deliberately separate: `generateSystems` does not run `validateLoomModel` either, so asserting it gates the helper on a phase the code under test never sees.

**Slice 2's DRAIN landed (2026-08-17).** Re-measured on fresh `main` first, because the audit's numbers had moved: **974** error-carrying generations of 4,727 calls across **149** files (the audit read 776/174), with `loom.guard-principal-without-auth` (38) and `loom.named-lifecycle-dropped` (26) arriving in the interim. All of it is now drained to zero except sixteen fixtures that are invalid ON PURPOSE, each routed through `generateSystemFilesUnchecked(source, why)` with the reason at the call site — a placeholder-degradation path, a no-auth gating leg, an unreadable projection, a named-only destroy, the no-display id-select fallbacks.

Per class: `persistence-mode-unsupported` 636→0 (103 files), `lifecycle-body-dropped` 161→0 and `named-lifecycle-dropped` 26→0 (15 files), `effect-in-lambda` 63→0 (17 files), `guard-principal-without-auth` 38→0 (9 files), plus a 13-code tail (18 files).

**What the drain found, which is the point of running one:**

- **A validator bug**, fixed with it. `checkBranchOpCalls` (`workflow-checks.ts`) validated an if-let branch's op-call targets against the OUTER binding map only, so a `let` declared inside the branch was reported unknown — while every backend emitter already walks into branch bodies and wires the repository for exactly that shape. Emitters are total, validators are selective; the validator was the wrong side. Mutation-proved, three tests pin it (accept / still-flag-an-unbound-name / no-leak-into-else).
- **A documentation bug.** `docs/language-reference/15-ui-pages-structure.md`'s canonical `state`/`derived`/`action` example taught `onClick: e => { count := count + 1 }`, which the compiler rejects and `docs/actions.md` marks ❌ in its own table. Rewritten to the accepted form with the three framework tabs regenerated from real `ddd generate system` output.
- **A silently truncated fixture.** `total -= 5.00 USD` is not the money literal — the grammar takes `5.00` and leaves `USD` as a stray statement, so the test asserting `Decimal.sub(…, Decimal.new("5.00"))` was passing against the truncated meaning. It is `money("5.00")`.

**The flip landed.** `generateSystemFiles` and `generateSystemResult` now refuse any fixture carrying an error-severity `validateLoomModel` diagnostic, through one shared `assertGeneratable` covering phases ①+④+⑦ so the two entry points cannot drift. The suite is green at exactly its pre-flip count (16,544 / 734) — the drain is what makes a gate land quiet instead of red.

*Mutation-proved three directions* (reverts by file copy, md5 verified both ways): drop a `dataSources:` binding → 19 tests fail naming `loom.persistence-mode-unsupported`; restore an inline effect lambda → fails naming `loom.effect-in-lambda` (a structurally unrelated code, so the gate carries the validator's verdict generally); remove the phase ⑦ block from the helper → **exactly** the three phase-⑦ cases of the new self-test fail and nothing else.

That third direction is why `test/system/generate-helper-gate.test.ts` exists: the drain left the suite green, so if this gate silently stopped gating nothing else in the tree would notice — the failure shape this mission was written to close. It freezes each hand-run mutation, and pins the escape hatch too (still emits from a rejected model, still refuses a syntax error, still demands a real reason).

**One piece remains: the direct-caller slice, now measured.** 223 test files call `generateSystems` directly and never touch the helper, so no flip can reach them. Instrumenting `generateSystems` ITSELF over a full run (9,276 calls) sizes the real damage at **266 error-carrying generations across 54 files** — far less than the file count implies, because most direct callers parse through `parseValid` (which does assert phase ④) or simply have valid fixtures. 201 of the 266 are the same `persistence-mode-unsupported` class. It is NOT a codemod job: tried and reverted, because these fixtures pin seed SQL, migration chains and saga dispatch, so binding a `resource` moves real emitted output and 30 tests fail for reasons that each need reading. `generateSystemResult(source, options?)` now exists in the helper (full `SystemEmission` + options passthrough, both phase gates) so migrating a direct caller is a one-line change rather than a capability loss; the migration itself, and only then a ratchet forbidding the direct import, is the slice.

Sources: [test-coverage-audit-2026-08-13](../../audits/test-coverage-audit-2026-08-13.md) §3.2. Relates to #2354 (the parse-error half, already landed in this helper), #2489, #2512. The remaining half is **M-T9.35** below.

## M-T9.37 — The wire-golden comparator can never fail on excess precision — `done` (Wave 1 follow-up, 2026-09-09) · **S–M** · P1 ⭐ the gate that was blind to M-T6.46, by construction

Found 2026-08-23 by the numeric-types audit ([F16](../../audits/numeric-types-audit-2026-08-23.md)). `toWireEntry` (`test/_helpers/wire-record.ts`) JSON-parses each body before diffing, collapsing every JSON number to a JS double: **deficient** precision (dapper's 15 digits, #2631) changes the parsed double and fails; **excess** precision (Java's 34-digit BigDecimals, M-T6.46) parses to the *identical* double and cannot fail — one-sided by construction. The direction that is currently broken on `main` is exactly the invisible one.

**The fix:** capture each numeric leaf's RAW SOURCE TEXT alongside the parsed double (`WireEntry.numberFormats`, via the reviver's `context.source`) and compare that dimension too, as its own `number-format` divergence kind.

**What "excess precision" turned out to mean — measured, and it is two rules, not one.** The first cut recorded every spelling that differed from `String(value)`, and running it reported **23 divergences on every python leg**: all of them `10.0` where node sends `10`, because Python renders a float64 with its fractional part and V8 does not. Same number under every parser including a decimal-preserving one, neither backend wrong — a bill payable only in waivers nobody could ever delete. The same rule flagged .NET/java rendering a `NUMERIC(19,4)` column at its declared scale (`12.5000`). So the predicate (`offContractNumber`) is **two independent rules**: the spelling denotes a *different exact decimal value* than the canonical rendering (java's `3.333333333333333333333333333333333` against node's `3.3333333333333335`), **or** it carries more than **17 significant digits** — float64's round-trip width — even when the value is identical. The second rule is load-bearing and was nearly dropped: the M-T6.46 mutation re-seeds `10.00000000000000000000000000000000`, which is exactly `10`, so rule 1 alone would have missed the very defect this mission exists for.

`test/_helpers/wire-waivers.ts` stays **empty**. The 23 were the comparator over-reporting, not a backend bill, so nothing needed waiving — the sequencing worry in the original mission text did not materialise.

One companion defect fixed in the same pass: `renderWireReport`'s `ORDER` table did not list `number-format`, so those divergences were **counted in the headline and printed nowhere** — the leg said "5 divergence(s)" and named none of them. A kind missing from that table is the same blind-gate defect one level up.

**Verification when it lands.** The mutation-proof IS the test, and it was run end-to-end through a booted backend rather than at the unit level. Re-seeding the pre-M-T6.46 java shape (response field back to `BigDecimal`, `.doubleValue()` removed) and rebuilding made `core-domain` report **5 `number-format` divergences** naming the exact 34-digit spellings — while every value assertion still passed (`2 passed, 0 failed`), which is precisely the blindness being removed. Restored by file copy, md5-verified, green again.

Measured clean on the restored tree: **python 52 cases / 0 divergences**, **java 52 cases / 0 divergences** (JDK 25 + Gradle 9 extracted from `gradle:9-jdk25`, real Postgres). Elixir's leg could not be run on this host — no matching toolchain, and the CI image tag does not exist — so its serializer was measured directly instead: `__decimal_num/1` is `Decimal.to_float/1` and `Jason` renders the shortest round-trip float, so every spelling it emits is ≤17 digits and canonical. dotnet/dapper/mikroorm were already green under the stricter first cut, and the shipped rule only ever records a subset of what that one did, so no previously-green leg can turn red.

Sources: [numeric-types-audit-2026-08-23](../../audits/numeric-types-audit-2026-08-23.md) F16, plan.json N16. Relates to M-T9.11 (the differential itself), M-T6.46.

## M-T9.44 — The diagnostic-catalog gate's two blind spots: shorthand syntax and a blanket forwarding exemption — `done` · **M** · P1 ⭐ the leverage packet

Found 2026-09-03 by the language-docs audit ([F25](../../audits/2026-09-03-language-docs-audit-findings.md), [F26](../../audits/2026-09-03-language-docs-audit-findings.md), [F30](../../audits/2026-09-03-language-docs-audit-findings.md), P3). `test/system/diagnostic-catalog.test.ts` fails on an inline literal, a mis-keyed message and an orphan entry — but it evidently does not walk `src/ir/validate/checks/**` or the AST validators, which is how two textbook instances survive: `loom.function-block-impure` is raised live with an inline message and **no catalog entry** (`src/ir/validate/checks/structural-checks.ts:1243`; referenced from `validators/structural.ts:327` and `types.ts:809`), and the `when`-gate-references-op-param check raises an inline message with **no `code` at all** (`src/language/validators/statements.ts:110-118`). A third rides along: `loom.projection-event-unkeyed` interpolates `proj.correlationField`, which is `undefined` for exactly the keyless case it fires on — *"…has no 'undefined' field to route by."* (`projection-checks.ts`, `validateHandlers` ~:90).

**Why this is the leverage packet.** Extending the gate's reach retires the F25–F35 class rather than the three instances, and prevents the next one — the register's own "Cross-cutting reading" §3 makes the same argument. **The mutation proof is the deliverable:** the extended gate must FAIL on today's `main` before any of the fixes land, and the PR body must say which assertion failed.

**The fix:** extend the walk, then repair everything it newly catches — mint `loom.function-block-impure`, give the `when`-gate check a code, stop the projection message interpolating `undefined`.

Sources: [language-docs-audit-2026-09-03](../../audits/2026-09-03-language-docs-audit-findings.md) F25/F26/F30 + "Cross-cutting reading" §3, [wave plan](../../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W4.1**. M-T9.45 stacks on this branch rather than waiting for merge.

> **Landed 2026-09-09. The premise in this row's title was wrong, and the correction is the
> finding.** The gate has walked `src/ir/validate/checks/**` and the AST validators all along.
> F25 and F26 survive for two unrelated reasons, both in the scanner rather than its reach:
> `sitesIn` read only `ts.isPropertyAssignment`, so a diagnostic literal using **shorthand**
> `message` was never recorded as a site (exactly two in the scanned surface — F25's, and
> `loweringDiag`'s); and `isForwardedParam` **blanket-exempted** any site whose message is a
> parameter of the enclosing function, a predicate that fired on **zero** sites and so had
> never been exercised. It now retargets to the helper's own in-file call sites, which is what
> makes F25's five inline template literals visible. Extended gate mutation-proved: with the
> defect re-seeded it names all five sites by line under "has no inline wording".
>
> F26's row understates its finding. A site with **no `code:` at all** is invisible to the
> catalog's three invariants too, and that is not one site: **119 errors and 11 warnings**
> against 195 coded sites across the Langium validator surface. Fixing the one site the
> register names would have hidden a class 130 times larger, so the class is filed as audit
> finding **F55** and wants its own mission; the IR check leaves are clean.
>
> Shipped: the two scanner fixes; `loom.function-block-impure` as five `#`-slug variants (with
> the `where` lead dropped — it duplicated `source`, which the gate's own invariant refuses);
> `loom.when-references-op-param`; `loom.projection-event-unkeyed#singleton`, which asks for
> `keyed by` instead of interpolating `undefined`. Refusing a keyless fold is intentional and
> documented, so F30 was message-only exactly as recorded.

## M-T9.45 — Messages that contradict their own gate, comments naming codes that do not exist, one dead gate, one orphan catalog entry — `done` · **M** · P3

Found 2026-09-03 by the language-docs audit (F27–F29, F31–F35, P3). Eight rows, all text, each with a grep behind it: `loom.scaffold-filter-param-unsupported` says `bool`/`datetime`/`guid` "have no input at all" when since #2699 all three render — the gate reads the correct set, only the message (and its stale twin in a comment) lies (`messages.ts:2308-2315`; `ui-checks.ts:1097-1099`); `loom.flutter-primitive-unsupported` names `FileUpload` as "the one deferred primitive" while `FLUTTER_UNRENDERED_PRIMITIVES` is now empty (`messages.ts:1624`; `src/util/flutter-deferred-primitives.ts`); `loom.filter-bypass-unsupported` is unreachable — `FILTER_BYPASS_FAMILIES` holds all five families — and still names three backends as "the honoring backends" (`system-checks.ts:2712`; `messages.ts:1832-1842`); `loom.scaffold-unexpanded` blames "walker-primitive-expander", a pass that no longer exists, and names `view` as a resolvable target (`messages.ts:783`); three comments cite codes that do not exist at all — `loom.workflow-function-block-body` (`ddd.langium:1456`, `loom-ir.ts:1311`), `loom.intrinsic-not-queryable` (`src/util/intrinsics.ts:57`), `loom.spurious-effect-marker` (`src/ir/lower/lower-expr.ts:1080`); and `extern_handlers_registered` sits in the observability catalog with no backend emitting it (`src/generator/_obs/log-events.ts`).

**The fix:** mostly text, but every edit carries the grep that proves the claim it replaces. **F29 needs a decision** — delete the dead gate or add the missing family; the wording is wrong either way.

> **Landed 2026-09-09 (W4.2, stacked on M-T9.44's branch). Three of the eight rows were not
> what they said.**
>
> * **F27 was already half-fixed on `main`.** The message names the correct renderable set
>   today; only its comment twin in `ui-checks.ts` was still stale.
> * **F29 needed no decision — the code had already made it.** The gate is a pinned
>   `LATENT_GATES` entry in the firing census (*"no deployable can reach the `!supported`
>   push"*), i.e. a deliberate dormant safety net, the same shape as F28's Flutter gate. Both
>   are reworded, neither deleted.
> * **F34's symptom was wrong and the truth is much worse.** A stray `await` is not a parse
>   error: `match await <plain state field>` validates with **zero diagnostics** and the four
>   SPA walkers emit `await Promise.reject(new Error("no remote op for variant-match"))` — a
>   guaranteed runtime rejection on every invocation, plus an undefined setter. Root cause:
>   `loom.match-non-union-subject` guards the **expression** `match` only; a `match` in an
>   action body lowers to a `StmtIR` `variant-match` that its visitor never sees. Filed as
>   audit finding **F56** and routed to W2.3, since it is Wave 2's invariant rather than text.
>
> **F56 re-scoped 2026-09-09 (fleet), twice.** (1) "A union-returning subject and a plain `string` one
> carry byte-identical `subjectType`" holds only for the **awaited-call** shape — a `let`-bound subject
> is a `ref`, takes `lowerMatchStmt`'s `subject.type` branch, and resolves to the real union. The
> awaited api-handle call is the only shape Stage 2 `match await` exists for, so the canonical page form
> is exactly the one that cannot be discriminated; the finding stands, the sentence generalised past it.
> (2) **The fix is a promotion, not a type-resolution mission (audit F66).**
> `classifyFelizAsyncEffect` (`src/ir/util/feliz-async-effect.ts`) is already an IR-pure, target-neutral
> classifier of exactly the predicate the SPA walkers need, invoked behind
> `if (dep.platform !== "feliz") continue` — the identical model is refused on a Feliz host and reports
> `0 error(s), 0 warning(s)` on React. Resolving `subjectType` is an optional second half with a real
> trap: fixing it on the EXPRESSION form un-blocks that form into walkers that cannot render it (a
> variant match with `variantArms` and no `arms` falls through to
> `otherwise ?? "/* empty match */ undefined"`), trading a false-positive error for a silent `undefined`.
>
> **F32 was verified by running it, not by reading:** a block-bodied workflow `function`
> parses clean and emits as a real workflow-scoped helper on all five backends, never inlined
> — which also exposed the grammar comment's *second* false claim (that such helpers are
> inlined at each call site), contradicted by the IR comment two files away.
>
> **F35 shipped the class, not the instance.** `catalog-parity.test.ts` only ever checked
> *emitted ⊆ catalogued*; the reverse — a catalog entry no backend emits — had no gate, which
> is how `extern_handlers_registered` outlived its producer. The new orphan invariant scans
> `src/` for each entry's key and event string (every emitter reaches the catalog by key, so
> one grep covers all five backends with no generate and no docker), and holds the three
> documented-reserved entries in a ratcheting `RESERVED_UNEMITTED` waiver that fails both ways.
> Mutation-proved by restoring the deleted entry.

**Verification when it lands.** The extended catalog gate from M-T9.44 stays green; the register-backed claims (`FLUTTER_UNRENDERED_PRIMITIVES`, `FILTER_BYPASS_FAMILIES`) are re-derived from code in the PR body rather than restated.

Sources: [language-docs-audit-2026-09-03](../../audits/2026-09-03-language-docs-audit-findings.md) F27–F29/F31–F35, [wave plan](../../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W4.2** (stacks on W4.1). Relates to M-T9.27 (the `*-unsupported` register — a deleted gate deletes its row).

## M-T9.49 — The .NET half of the same hole: `generateDotnet` was a bare re-export, so 136 of its 150 call sites never reached the helper at all — `done` · **M** · P1 ⭐

Minted 2026-09-03 by Wave G2 packet 2.2 of [verification-waves-2026-09](../verification-waves-2026-09.md), as the hand-off named in [M-T9.48](#m-t948--the-legacy-single-context-generate-path-asserted-nothing--partial-route-1-slice-2-and-the-ratchet-landed-the-residue-is-named-below)'s residue. Closed in the same PR.

**The hole, and why it was bigger than the hand-off said.** `test/_helpers/generate.ts` ended in `export { generateDotnet, generateSystems };` — a bare re-export from `src/generator/dotnet/index.js`. So the helper wrapped it with nothing, exactly as M-T9.48 reported. The part the hand-off could not see is the consequence of a re-export: because the name was ALSO importable from `src/`, only **9 of the 39 caller files reached the helper at all** — **14 of the 150 call sites**. The other 30 files (136 call sites) imported the generator straight from `src/`, outside every gate this helper module has, present *or future*, so wrapping the re-export alone would have pinned a ratchet over a set nothing enforced. The `parseString` column was likewise **17 files**, not the two the hand-off knew about.

**What landed.**
- `generateDotnet` is now a real wrapper in the helper (`assertModelVerifies(model)`, then `generateDotnetProject(model, options)`), sharing the identical body `generateHono` calls so the two legacy paths cannot drift.
- The 30 direct `src/` importers under `test/` (plus `dotnet-eventsourced-emission.test.ts`, which then left the path entirely — 31 import lines in all) were routed back through the helper, so the census can see them.
- The `parseString` → `generateDotnet` hops migrated to `parseValid` — 17 files down to 5. Four of the five are a dedicated "parses + validates cleanly" case that asserts `errors` is empty itself; the fifth is `test/ir/collection-op-lambda-element-type.test.ts`, fenced to another packet. Two `parseString(SRC, { validate: false })` bypasses turned out to validate cleanly and lost the flag.
- `test/system/legacy-generate-path-ratchet.test.ts` now runs its assertions per entry point over a `GATES` table — **`generateHono` 33 files / 62 call sites, `generateDotnet` 39 files / 150** — each with its own exact per-file counts, exact total, and `PARSE_STRING_ALONGSIDE` reasons. Per-gate rather than pooled because two conformance files import both, and a pooled total would let a call migrate from one path to the other without moving.

**Blast radius: 12 tests across 4 files**, each dispositioned by running `ddd parse` on the fixture first:
- `dotnet-projection-emission.test.ts` (4) — a genuine fixture bug: `create place(...)` is a NAMED create, refused by `loom.named-lifecycle-dropped` ("reaches no backend — it drives no route and no factory"). Fixture repaired: dropped the name.
- `dotnet-eventsourced-emission.test.ts` (5) and `dotnet-dispatch-emission.test.ts` (1) — M-T9.48's hosted-capability trap, verbatim (`loom.event-sourcing-backend-unsupported`, `loom.audited-backend-unsupported`). Moved to `generateSystemFiles` with the deployable the fixtures always implied, map re-keyed to drop the deployable dir. The event-log config assertion moved with them from `ToTable("accounts_events")` to `ToTable("accounts_events", "accounts")` — a hosted context owns a schema, which is the emission a user can actually reach.
- `retrieval-emit.test.ts` (2) — `loom.retrieval-loads-unsupported`, refused on every path with or without a deployable (verified both ways). Same disposition as its Hono twin: `generateSystemFilesUnchecked` with a stated reason, because emitting from the refused model IS the test's subject.

**Verification (done).** Re-seeded M-T9.40's mutation (`enumName: undefined` in the context-local enum-value arm of `src/ir/lower/lower-expr.ts`; reverted by file copy, the working tree byte-identical to HEAD under `src/` afterwards) and measured both sides over `test/generator/dotnet` + `test/adapters/dotnet-orchestrator-rewire`: with the assertion, **79 tests across 11 files fail** on `IR verification failed for .ddd fixture — … enum-value ref 'Open' has no enumName — Shopping/Cart/isOpen (FunctionBodyIR.expr)`; with the assertion stripped from `generateDotnet` and the mutation still seeded, **19 across 5** fail, on unrelated string assertions. **60 previously-silent tests now fail.** The ratchet's own directions were mutation-proved too: a ghost pin fails STALE, a dropped pin fails NEW FILE, a bumped count fails both the exact-count and the total assertion, and a ghost reason fails stale-reason — five failures from four seeded defects.

**The residue.** `generateDotnetForContexts` — the system-mode entry one rung below the wrapper — is still imported directly from `src/` by six files; it is out of this row's scope for the same reason the Hono ratchet gates `generateHono` and not `generateTypeScriptForContexts` (the wrapper is the legacy CLI path; the `ForContexts` entry is what the orchestrator itself calls). `test/ir/collection-op-lambda-element-type.test.ts` still reaches BOTH legacy generators from a bare `parseString`; it is fenced to another packet and carries its reason in both `PARSE_STRING_ALONGSIDE` tables. The 150 .NET call sites are a backlog, not an allowance — 66 of them are `generator-dotnet.test.ts` alone, which is also M-T9.42's largest promotion candidate.

> Minted as `M-T9.45` on its branch; renumbered to **M-T9.49** on rebase because #2771's language-docs audit landed `M-T9.44`–`M-T9.47` first. The wave's PR body and commit messages may still say `M-T9.45` — this row is that work.

Sources: [verification-waves-2026-09](../verification-waves-2026-09.md) Wave G2 packet 2.2. Relates to M-T9.48 (the Hono half this mirrors exactly), M-T9.40 (the verifier), M-T9.35 (the direct-orchestrator ratchet both are modelled on).

## M-T9.36 — The numeric wire-codec seam: one decision per backend, enumerated boundaries — `done` ([#2770](https://github.com/Loom-Harness/Loc/pull/2770), wave-2/numeric-codec packet, merged 2026-09-10) · **L** · P2 ⭐ the structural end of the #2545→#2631 series

**Re-verified on `main` after the merge (2026-09-10):** `src/generator/_numeric/{codec,target}.ts` exist, with all five leaf tables in place (`src/generator/{typescript,dotnet,java,python}/numeric-codec.ts` + `src/generator/elixir/vanilla/numeric-codec.ts`) and the enumeration gate at `test/generator/_numeric/boundary-census.test.ts`.

Minted 2026-08-23 by the numeric-types audit (the [root cause](../../audits/numeric-types-audit-2026-08-23.md)). Five PRs in four days (#2545, #2560, #2575 ×3, #2631) fixed the same defect at five different read paths: the number wire contract (money = F4 string, decimal = float64 number, int/long = integer) is one cross-cutting decision implemented as scattered per-backend, per-path coercions — per-row DTO, projection `select`, aggregate, group key, dapper raw SQL. Each new path re-decides; some backends get it wrong; the diagnosis "no fixture exercised this path" was recorded per-bug five times and never made structural.

**The work:** lift the decisions into one per-backend numeric codec table — the generalization of `aggregateCoercion` (`src/ir/util/projection-aggregate.ts`) and #2631's `aggregateLandsOnDouble` — consumed at *every* boundary, plus the gate that makes it stick: a completeness test enumerating the numeric boundaries per backend, so a new read path cannot ship without declaring its codec. Byte-identical-output gated, like every prior seam extraction (`_expr/target.ts` #843, the walker #607–#627).

**Sequencing:** after M-T6.46 and M-T6.47 land — they finish the concrete divergences the seam generalizes, and doing the refactor under them would conflict in every wire emitter.

**Verification when it lands.** Byte-identical emission across the refactor; the boundary-enumeration gate mutation-proved by adding an unregistered boundary.

**Landed 2026-09-03 (#2770, `src/generator/_numeric/`).** `codec.ts` is the decision table verbatim (`NUMERIC_WIRE_CODEC`: money → fixed-scale string, decimal/int/long → number) and `target.ts` defines the `NumericTarget` contract over five boundary kinds (`repo-read` / `projection-read` / `dto-map` / `find-param` / `seed-read`) — the `_expr/target.ts` contract-plus-leaf-tables shape, one per-backend `numeric-codec.ts` leaf table per backend (`src/generator/{typescript,dotnet,java,python}/numeric-codec.ts`, `src/generator/elixir/vanilla/numeric-codec.ts`). Every already-duplicated literal this refactor could find via an exhaustive grep of the fenced trees now routes through it: TS/Hono's repository hydration (relational *and* document adapters), `wireProjectionValue`, the hono aggregate/group-key coercion, and the inbound `moneySchema` parse; .NET's `projectToResponse` and `csCoerce`'s EF aggregate arm (`csDecimalToWireDouble` now lives in the codec module); Java's `domainToWire`/`wireToDomain`, `jpqlCoerce`/`groupKeyCoerce`, and (found by the same grep) the channel-envelope and SSE-realtime money/decimal codecs; Python's `wireValue`/`hydrateScalar`, all six `money_str(...)` call sites, the event-sourced `fromData` decode, and (found the same way) the document-adapter `deserialize` and the in-process dispatcher's `fromPayload`; Elixir's `__money_round`/`__money_wire`/`__decimal_num` helper bodies across five emitter files, plus `coerceOpParam`'s find-param decode.
`test/generator/_numeric/boundary-census.test.ts` is the enumeration gate: it scans every fenced source file for the extracted literal signatures and fails, naming file:line, on any occurrence outside the seam, with a small reasoned waiver list (each ExprTarget intrinsic table, two workflow zero-seeds, one out-of-scope projection accumulator, python's own `money_str` definition, one elixir LiveView display helper) that a second test asserts never goes stale. Mutation-proved three ways (an unregistered boundary, a deleted waiver, a rewritten-but-not-deleted waiver) — see the hand-off note.
**Three genuinely-wrong boundaries turned up along the way and were fixed as separate commits, not folded into the pure extraction**: java's channel-envelope (`emit/channels.ts`) and SSE-realtime (`emit/realtime.ts`) money encoders, .NET's channel-envelope encoder (`emit/channels.ts`), and elixir's cross-deployable broker envelope encoder (`channels-emit.ts`), all formatted money via a bare `.toString()`/`.toPlainString()`/`Decimal.to_string` that echoed the domain value's own scale instead of the canonical RS-12 4dp every other read path pins — the exact #2549 class the audit's F18 flagged as witness-starved (no corpus fixture puts a money field on a channel or realtime payload). Each fix is mutation-proved against a new assertion in that backend's channel/realtime test.
Byte-identical corpus/examples/web-examples diff verified across the pure-extraction commits (55 successfully-generated fixtures out of 128; the rest fail for pre-existing reasons unrelated to this change — legacy single-context sources, unsubstituted `__PLATFORM__` template fixtures, one malformed example); the only differences are the per-generation-run random `SECRET_KEY_BASE` secret in four elixir `docker-compose.yml` files. Local compile legs: .NET (`dotnet build /warnaserror`), Java (`gradle testClasses bootJar`, JDK 25 container), and Python (`ruff` + `mypy --strict` + `pytest`) all green against a fresh money/decimal/int-arithmetic fixture generated post-refactor; the five backend generator vitest suites (dotnet 699, java 535, python 488, elixir 1104, typescript+hono 697 — 3523 tests) all pass, as does `test/platform/pipeline-layering.test.ts`. Full detail: [`docs/new-plan/waves/handoffs/wave-2-numeric-codec.md`](../waves/handoffs/wave-2-numeric-codec.md).

Sources: [numeric-types-audit-2026-08-23](../../audits/numeric-types-audit-2026-08-23.md), plan.json N15, #2545/#2560/#2575/#2631. Relates to M-T9.25 (intra-backend consistency gates).

## M-T9.35 — The direct `generateSystems` callers the phase gate cannot reach — `done` ([#2604](https://github.com/Loom-Harness/Loc/pull/2604) drain + [#2647](https://github.com/Loom-Harness/Loc/pull/2647) ratchet, both merged 2026-08-24) · **M** · P1

> **Status 2026-08-24.** **The drain shipped** ([#2604](https://github.com/lemmit/Loc/pull/2604), merged as `015a7bd`): re-measured on fresh `main` at **277** error-carrying generations across **62** files (the numbers below were 266/54 when this mission was written — `main` moved, as the mission's own "re-measure before starting" line predicted), all drained to **zero**, with **35 files migrated onto `generateSystemFiles`** so the phase ①/④/⑦ gate covers them from here. Done per file with the emission diff reviewed, not by codemod — the same conclusion the mission reached, re-reached by trying it. **Step 3, the ratchet, MERGED 2026-08-24 as [#2647](https://github.com/Loom-Harness/Loc/pull/2647)** — and the mission closes with it. Evidence on `main`: `test/system/direct-generate-systems-ratchet.test.ts` (AST census of every `test/**` importer of `generateSystems`/`generateSystemsFromLoom`, pinned shrink-only in both directions) and `scripts/direct-caller-census.mjs` (regenerates the pin paste-ready). It caught six direct callers on contact, arrived from #2637 and its neighbours while the stack was in flight; all six were **migrated** rather than pinned, so the baseline is still exactly the 200 the drain left. Mutation-proved against a file the drain actually migrated (`dotnet/dotnet-seed.test.ts`) — the first attempt used a still-legitimately-pinned file, passed, and proved nothing.

**M-T9.34 gated the helper; this gates the rest.** 223 test files call `generateSystems` directly and never touch `generateSystemFiles`, so the phase ①/④/⑦ assertions cannot see them. Measuring rather than assuming — instrumenting `generateSystems` itself over one full `npm test` (**9,276 calls**) — puts the real damage at:

| | |
|---|---:|
| error-carrying generations | **266** |
| files | **54** |

Far less than the 223-file surface implies: most direct callers parse through `parseValid` (which *does* assert phase ④, 54 of the 223) or simply have valid fixtures. By code:

| count | code |
|---:|---|
| 201 | `loom.persistence-mode-unsupported` |
| 20 | `loom.field-default-not-constant` |
| 20 | `loom.named-lifecycle-dropped` |
| 10 | `loom.workflow-unrecognised-statement` |
| 6 | `loom.ui-id-ref-no-display` |
| 6 | `loom.lifecycle-body-dropped` |
| 2 | `loom.workflow-create-missing-field` |
| 1 | `loom.guard-principal-without-auth` |

Six of the eight are classes M-T9.34 already drained through the helper, so the fix shapes are known and written up in its slice commits (`storage`/`resource` + `dataSources:`; an emptied canonical `create` body; a canonical rather than named lifecycle action; `user { … }` + `auth: required`). Two are new here: `field-default-not-constant` and `workflow-create-missing-field`.

**Do NOT codemod it.** That was tried against these 54 and reverted: one file stopped transforming and 30 tests failed, because *these* fixtures pin seed SQL, migration chains and saga dispatch — so binding a `resource` moves real emitted output (tables become schema-qualified, `pgTable(…)` → `<ctx>Schema.table(…)`, Ecto gains `prefix:`). Every such move is a real assertion change that needs reading, not a mechanical rewrite. Per file, with the emission diff reviewed.

**Prerequisite, already landed:** `generateSystemResult(source, options?)` in `test/_helpers/generate.ts` returns the whole `SystemEmission` (not just `.files`) and takes `GenerateSystemOptions`, so migrating a direct caller is a one-line change rather than a capability loss. 260 of the direct call sites only wanted `.files`; the rest wanted the full result or `{ sourcemap: true }`.

**Order:** drain the 54, migrate them to the helper, and only then add a ratchet forbidding `import { generateSystems }` in `test/**` with a shrink-only allowlist. A ratchet before the drain just blocks everyone.

**The 54, by generation count** (re-measure before starting — `main` moves):

`test/ir/provenance` 21 · `test/conformance/corpus-mutation` 20 · `test/generator/typescript/realtime-emission` 18 · `test/ir/audited` 13 · `java/java-workflow-dispatch` 11 · `test/platform/dotnet-fullstack` 10 · `hono/hono-seed` 10 · `hono/hono-wire-conformance` 10 · `dotnet/dotnet-wire-conformance` 10 · `java/java-workflow-instances` 7 · `dotnet/dotnet-seed` 7 · `dotnet/dotnet-showcase-compile-regressions` 7 · `java/java-workflow-command-surface` 6 · `python/message-clause` 6 · `hono/hono-destroy-route` 6 · then 39 files with ≤5 each across `elixir/`, `java/`, `python/`, `typescript/`, `test/system/`, `react/`, `flutter/`, `angular/`, `_walker/`.

**How to re-measure** (the technique, since the numbers rot): temporarily add a `validateLoomModel(loom)` call inside `generateSystems` in `src/system/index.ts` behind an env var, append `{file, code}` per call (derive `file` from `new Error().stack`), run `npx vitest run`, tabulate, then **revert by file copy** — never `git checkout --`, which discards unrelated edits in the same file (retro §84, §87).

Sources: M-T9.34's own measurement pass. Blocked-by: nothing — M-T9.34's helper half is landed.

Sources: [test-coverage-audit-2026-08-13](../../audits/test-coverage-audit-2026-08-13.md) §3.2. Relates to #2354 (the parse-error half, already landed in this helper), #2489, #2512.

> **ID note.** M-T9.36–M-T9.38 minted 2026-08-23 by the numeric-types audit. M-T9.35 was allocated to #2604's census drain (since landed above).

## M-T9.32 — Duplicate-claim hygiene — `done` (detection shipped #2495; the ID half shipped in wave C4 packet 4f, 2026-09-22) · **S** · P2

**The ID half is built: `scripts/next-mission-id.mjs`.** It reads BOTH sides of the question `main` cannot answer — the `## M-T<n>.<m>` headings in `docs/new-plan/` (live + archive) AND every open PR's added headings (the `pulls/:n/files` patch, filtered to `docs/new-plan/**.md`) plus any id its title or body names, because a claim announced in a body before the heading lands is exactly the collision window. Per track it prints max-on-main / max-claimed / next-free, names two collision shapes (one id claimed by two open PRs; an open PR minting an id that already exists) and `--check` exits 1 on either. The mint rule is the HEADING (`+## M-Tx.y`), never the id regex — a `Relates to M-T9.8` line in an added paragraph must not move the number; mutation-proved by widening the rule and watching the fixture go from 1 mint to 4. Without `GITHUB_TOKEN` it prints the main-only table and says the answer is INCOMPLETE rather than answering, since a main-only answer that LOOKED complete is the failure mode being fixed. Typed by `scripts/next-mission-id.d.mts`; pinned by `test/system/next-mission-id.test.ts`; `RUNBOOK.md` §2 now tells an agent to run it instead of computing an id by eye. **Not exercised against the live API in the packet's sandbox (no token); the recipe is in [`waves/handoffs/wave-c4-4f-hygiene.md`](../waves/handoffs/wave-c4-4f-hygiene.md).**
Parallel agents collide on claims. Two shapes are on record: #2349/#2351 were **the same branch open twice** (draft + ready), and M-T6.37 was claimed by two PRs in the same hour because **neither could see the other's ID** — it lives on an open branch, not on `main`, so a next-free-ID check that reads `main` cannot find it (the collision note is in [T6](../T6-backend-parity.md)).

**Detection ships** inside the weekly report (`duplicateHeads` / `staleDrafts` in `scripts/quality-delta.mjs`, pinned by its test): open PRs sharing a head branch, and drafts on a head that has not moved in 10 days. Deliberately FLAG-ONLY — nothing closes anyone's PR.

**Open:** the ID half — a next-free-mission-ID check that spans open PR branches, not just `main`. That is the one that would have prevented the M-T6.37 collision, and it is the one still unwritten.

Sources: [quality-audit-2026-08](../../audits/quality-audit-2026-08.md) R12. Minted by [#2495](https://github.com/Loom-Harness/Loc/pull/2495).

## M-T9.38 — Flutter and Feliz have no runtime leg: a money crash ships behind a green compile gate — `done` (2026-09-13, [#2898](https://github.com/Loom-Harness/Loc/pull/2898)) · **L** · P2

Found 2026-08-23 by the numeric-types audit ([F17](../../audits/numeric-types-audit-2026-08-23.md)). `generated-flutter-build.yml` / `generated-feliz-build.yml` are compile-only, and Dart's `(x as num)` on a wire string compiles clean — so F1's crash-on-first-read shipped green. React/Vue/Svelte/Angular have real e2e legs; the two self-hosting frontends (the pair M-T1.20 already flags as carrying most frontend residue) have none.

> **Half the premise was already stale when this row was picked up (2026-09-13).** "FELIZ still has
> none" — the wording in both this mission and its ledger row (`G2644-M-T9.38-frontend-runtime-legs`)
> — rested on `ls test/behavioral | grep -i feliz` being empty and no `*feliz*e2e.yml` existing. Both
> are true and neither is the question: **Feliz has had a real-backend leg since the testid-emission
> PR**, as a BLOCKING `feliz` cell of `frontend-fullstack-e2e.yml` running the SHARED `run-ui.mjs`
> against `sales-system-feliz` — generate → `dotnet fable` + vite → the built bundle and the generated
> Hono backend on PGlite on ONE origin → the emitted `*.ui.spec.ts` page-object round-trip. A leg that
> reuses a shared runner leaves no file with its name on it, so a filename census cannot see it. What
> was genuinely missing was the NUMERIC half, on both legs: `grep -nE 'money|decimal'` over either
> found nothing.

**What landed (#2898).** Both fixtures grew a numeric `Product` row — one field per host type, four
different wire spellings (`money` a scale-4 STRING per RS-12, `decimal` a JSON number per RS-24,
`int`/`long` JSON integers) — and both legs now assert the RENDERED value, so a silently-wrong decode
fails as well as a throwing one. The seed and the expectations live in ONE table
(`test/behavioral/numeric-ui-contract.mjs`) that both legs read, with a fast-suite ratchet
(`numeric-ui-legs.test.ts`) over the fixtures, the wiring and the expectations' discriminating-ness —
without it, deleting a field would leave two nightly legs green and pointless.

Measured on the landing head, locally, both legs: **feliz 11 passed / 0 failed** (the numeric
round-trip fills all four through the real create FORM and reads them back off the detail page),
**flutter 4 passed / 0 failed**. Mutation-proved on both sides: re-seeding F1 (`'${json[…]}'` →
`(… as num).toString()` in `flutter/dart-types.ts`) turns BOTH money-bearing flutter probes red on
`Couldn't load products` while customers and orders stay green; routing the Feliz money decoder
through a double (`feliz/wire.ts`) renders `98.76` for an expected `98.7600` and turns ONLY the new
numeric round-trip red. Each mutation was reverted by file copy, md5-verified, and rebuilt.

Two findings fell out of it, both recorded rather than carried silently: **[M-T9.65](#m-t965)** (a
`money` literal in a ui e2e body is emitted as a bare JS number, losing the scale the api renderer
keeps) and the money RENDERING divergence between the two frontends — Flutter formats through
`NumberFormat.decimalPattern()` and drops the scale, Feliz keeps it. The divergence is pinned in the
contract table so whichever way it is later unified, that table is what changes.

**What is deliberately NOT here, with the reason** (so nobody re-opens this row for it):

1. **Flutter's WRITE half stays seeded over `/api`, not driven through the form.** Flutter web exposes
   a text field to the DOM only while it is focused, so a form-driven write is a flake source — on a
   leg that is already one of the three at a 0 % first-attempt pass rate, that trades a real gate for
   an unreliable one. Form interaction on Flutter is covered in-process instead, by the `flutter test`
   widget tests riding `generated-flutter-build.yml`. The create-submit half of the original ask is
   covered at RUNTIME on Feliz, which posts through the real form.
2. **Per-PR path-scoped promotion.** The mission's "then per-PR once the flake budget holds" half is
   [`verification-waves-2026-09`](../verification-waves-2026-09.md) G1 / wave C0 packet 0.2(b) work
   ([#2636](https://github.com/Loom-Harness/Loc/issues/2636)), not this row's: the legs are wired to
   the `frontend-fullstack` label and run nightly. Note that label predates the `run-<feature>`
   convention this mission's text assumes; renaming it is a `docs/ci-gating.md` + label-registry
   change and was left alone rather than done as a drive-by.
3. **M-T9.14's residue** (flutter per-kind `ExprIR` pinning, the runtime auth-UI leg) is that
   mission's, unchanged.

Sources: [numeric-types-audit-2026-08-23](../../audits/numeric-types-audit-2026-08-23.md) F17, plan.json N17. Relates to M-T9.14 (Flutter runtime gates), M-T1.20, [M-T9.65](#m-t965).

## M-T9.50 — Nothing typechecks `test/`, and a bare `--noEmit` step cannot land — `done` · **L** · P1 ⭐

Minted 2026-09-07 from [verification-waves-2026-09](../verification-waves-2026-09.md) **§7.1**, which was handed to that wave as "a small follow-up" and turned out to be mission-sized on measurement.

**The hole.** `tsconfig.json` carries `"exclude": ["node_modules", "out", "test"]` and no other config covers `test/`. `npm run build` compiles `src/**`; `biome ci .` is a linter. So none of the ~1,993 `.ts` files under `test/` are typechecked by anything — which means a `Record<SomeUnion, …>` written in a test to prove exhaustiveness proves nothing, because no compiler ever reads it. Three Wave G3 packets hit this independently.

**Two measurements, and why they differ — re-measure, do not inherit.** §7.1 measured **811 errors over 327 files** under a vitest-shaped config (`vitest/globals` + DOM lib, `test/fixtures` in scope). Re-measured 2026-09-07 on the wave's head under the *root* config's shape (`types: ["node"]`, `test/fixtures` excluded, `src/**` + `test/**` in one program): **764 errors over 216 files, and 0 under `src/`**. Both are honest; the gap is entirely config shape, and that is the first thing this mission has to settle — the baseline is only meaningful against a pinned `tsconfig.test.json`. Recipe for either number: write a throwaway config **at the repo root** (so `typeRoots` resolve — a config outside the tree fails with `TS2688: Cannot find type definition file for 'node'`), extending `./tsconfig.json` with `composite: false`, `declaration: false`, `noEmit: true`, `rootDir: "."`, `include: ["test/**/*.ts", "src/**/*.ts"]`, `exclude: ["node_modules", "out", "test/fixtures"]`; run `npx tsc -p … --noEmit`; delete it.

**The class, not just the count.** 391 × TS2345 + 111 × TS2322 is **66%** of the 764 and names one shape: partial fixture objects handed to full IR types through loose casts. The tail is small and different — 33 × TS2584, 31 × TS2352, 30 × TS2353, 23 × TS2339. So the drain is mostly *one* refactor (typed fixture builders) repeated, not 216 individual puzzles.

**Why it is not landable as one change.** A `--noEmit` step added to the fast lane before the errors are fixed makes every PR red. The landable shape is the one this repo already uses for waivers: a checked-in `tsconfig.test.json` plus a **per-file baseline that can only shrink**, gated in the shape of `test/system/unsupported-register.test.ts` — a file that drops to zero errors gets deleted from the baseline in the same PR that fixed it, and a clean file that gains an error fails the gate. That buys the invariant on day one (no new untypechecked test file, no new error in a clean one) and lets the rest drain packet by packet.

**Verification when it lands.** Mutation-prove *both* directions, because a baseline gate that only ratchets one way is the failure shape this repo keeps finding: (a) introduce a fresh type error in a file the baseline lists as clean → the gate fails; (b) fix a file's last error without deleting its baseline row → the gate fails as stale. A green first run proves neither.

**Slice 1 landed 2026-09-07.** `tsconfig.test.json` is checked in and pinned — which was this row's stated first task, because the count is a function of the config and means nothing until one is fixed. Measured under it on that head: **768 errors over 219 files, and `src/` clean**. `test-typecheck-baseline.json` records the per-file count and `scripts/test-typecheck.mjs` (`npm run test:typecheck`, ~36s, wired into the `lint + web-tsc` job) gates it in both directions: a file not in the baseline must be at zero, a file in it may not exceed its pin, and a file that IMPROVED fails until the baseline is updated — so a fix and its baseline edit land together and the ratchet records progress rather than merely permitting it. `src/` is checked separately, because the test project pulls it in under different options and a regression there would otherwise be blamed on a test file. Five seeded defects, five distinct failures, each reverted by file copy.

**Slice 2 — the drain — landed 2026-09-22** (wave C4, packet 4b). **469 errors over 181 files → 0**, `test-typecheck-baseline.json` deleted, and `scripts/test-typecheck.mjs` promoted from shrink-only ratchet to a plain GATE: any error under `test/` or `src/` fails. Drained by directory, largest first, one commit each — `test/ir` (106), `test/language` (81), `test/generator` (89), `test/playground` (51), the mid-tier (84), `test/system` (43).

**The 66 % was one shape, and it took three shared helpers, not 181 rewrites.** `test/_helpers/ir-builders.ts` supplies `ExprOf<K>` / `StmtOf<K>` / `TypeOf<K>` / `WorkflowStmtOf<K>` — naming the VARIANT instead of the union is the whole fix, because a builder annotated `ExprIR` cannot be spread-and-extended (`{ ...thisProp("total"), type: MONEY }` is a union of every arm plus that field, which excess-property checking rejects) — plus `primType` / `litExpr` / `paramRef` / `memberExpr` / `matchExpr` and the structural `deployableIR()` / `systemIR()`. `ast.ts` supplies `contextMembersOf` and `nodeName`; `diagnostics.ts` supplies `LspDiagnostic`, `diagText`, `diagCodes` and `lspCodes`. Seventeen suites carried a byte-identical private `codesOf` typed over `{ code?: string }[]` — a parameter no real `Diagnostic` satisfies.

**What the drain FOUND is the argument for the gate.** Eleven fixtures were not merely mistyped, they were not testing what they claimed: `walk.test.ts`'s exhaustiveness tables were missing six IR kinds (`authz-filter`, `duration`, `i18nFormat`, `variant-match`, `if`, `repo-delete`); `projection-fold-statements`' `satisfies Record<StmtIR["kind"], …>` — whose own comment calls it "the ratchet that was missing when `expression` joined the union" — was missing `if`; `unsupported-platforms` was missing `angular`; two React walker suites parsed with `{ valslugation: true }`, a typo for `validation`, so neither ever validated its source; two Feliz suites passed `sys.contexts ?? []` — a field `SystemIR` does not have — and had been emitting from zero contexts; `operation-workflow-gate-parse`'s back-compat case searched the wrong AST level and asserted nothing; and `adapters/contract-shape.test.ts`, a file whose entire purpose is "this fails to compile if the contract drifted", still inhabited `supports()` / `supportedStrategies`, removed by M-T9.2.

**Scope, recorded so it is not re-litigated.** `tsconfig.test.json` now excludes `test/__snapshots__` and the Playwright specs (`**/*.pw.ts`, `test/e2e/support/*.spec.ts`) for the same reason `test/fixtures` was already excluded: they are text the suite copies into a GENERATED project, compiled there against `@mantine/core` / `@playwright/test`, which the toolchain does not depend on. `web/**` stays out of the gate's scope (its own `tsc -b` runs in the same CI job). Three CI scripts (`pr-gate.mjs`, `quality-delta.mjs`, `ledger-counts.mjs`) are still imported with `@ts-expect-error`; a `scripts/*.d.mts` for each removes it, and the directive is self-ratcheting (TS2578 fires the moment one lands).

**Mutation-proved on the promoted gate**, three seeds, each reverted by file copy: an extra key in `walk.test.ts`'s `Record<ExprIR["kind"], …>` → `TS2353 … 'XXmutation' does not exist in type 'Record<…>'`; a boolean-form `match` fixture with its required `variantArms` removed → `TS2345 … is not assignable to parameter of type 'ExprIR'`; and `e.amount` → `e.amountXX` in `src/ir/util/walk.ts` → `1 error(s) under src/`. Each exited 1; the restored tree exits 0.

Sources: [verification-waves-2026-09](../verification-waves-2026-09.md) §7.1. Relates to M-T9.8 (the hollow-work class this belongs to — an assertion the compiler never reads is the purest form of it) and M-T9.35 / M-T9.48 / M-T9.49 (the same "the instrument was never wired to anything" shape, on the generator entry points).

## M-T9.53 — Three `src/` files carry a raw NUL byte, so the tools treat them as binary — `done` (wave C4 packet 4f, 2026-09-22) · **XS** · P3

**CLOSED — and the count was FOUR, not three.** All four raw NULs are now the two-character escape `\0` (runtime string identical, so every key/hash/snapshot is unchanged): `src/system/migrations-builder.ts:581`, `src/ir/util/policy-decision-id.ts:43`, `src/ir/validate/checks/structural-checks.ts:1426` — and `scripts/quality-delta.mjs:457`, which the mission never named and the new repo-wide scan found on its first run. That is the argument for scanning over listing, in one data point. The gate is `test/system/nul-byte-census.test.ts`: no tracked file under `src/`, `test/`, `docs/` or `scripts/` may carry a NUL byte, exact at zero with NO waiver list (those roots are text-only by construction). Three assertions — a vacuum guard pinning the four named files into the scanned set, a probe proving both halves (the scan fires AND `grep -lI` reaches a clean twin while silently skipping the NUL-bearing one), and the live census. Mutation-proved by file copy: re-seeding the NUL into `policy-decision-id.ts` fails with `src/ir/util/policy-decision-id.ts:43 — 1 NUL byte(s), first at offset 2176`. Byte-identical emission confirmed on the 395-cell corpus snapshot.

Minted 2026-09-07 from [verification-waves-2026-09](../verification-waves-2026-09.md)'s hand-off list. Pre-existing on `main`, not introduced by that wave.

**The finding.** `src/system/migrations-builder.ts`, `src/ir/util/policy-decision-id.ts` and `src/ir/validate/checks/structural-checks.ts` each contain **exactly one literal NUL byte**, used as a composite-key name separator. Consequence: `grep -qI` classifies all three as binary, so a plain `grep -r` over `src/` **silently skips them** — including greps an audit or a refactor depends on. The measurement itself demonstrates it: `git grep -lI --perl-regexp` for the byte returns only two of the three, while a `perl -0777` count returns 1 for each.

**The fix is a one-character-class change with no behavioural difference:** write the separator as a two-character escape in source rather than embedding the byte. The emitted string is byte-identical, so every key, hash and snapshot that depends on it is unchanged — which is precisely what makes this safe and why it has been easy to leave alone.

**Verification when it lands.** Assert the *runtime value* is unchanged (the composite keys these three build must be byte-identical before and after — snapshot them across the corpus, do not eyeball the diff), and assert the *files* are no longer binary: `git grep -I` must now reach all three, and a repo-wide check for an embedded NUL in tracked `src/**` text must return empty. The second half is the gate worth keeping — a one-line meta-test in the shape of `test/platform/assertion-free-tests.test.ts` stops the next one from landing.

Sources: [verification-waves-2026-09](../verification-waves-2026-09.md), "Findings handed off, not fixed here". Relates to M-T9.8 (a grep that silently skips files is how hollow work stays hidden).

## M-T9.55 — The give-up routing gate scans 40 of 140 walker files and reports green — `done` (2026-09-11) · P0 ⭐

Found 2026-09-09 by the verification fleet ([F63](../../audits/2026-09-03-language-docs-audit-findings.md)).
`test/system/walker-give-up-routing.test.ts` enumerated its files by shelling
`git ls-files 'src/generator/<target>/**/*.ts'`. **That pathspec matches subdirectories only** —
40 of 140 files were scanned (flutter and feliz at ZERO each) and the test passed. The repo's own
recurring failure shape (`experience_gathered.md` §59, §63): a check that never reaches the thing
it names.

**Closed in three slices.**

| Slice | What landed | Evidence |
|---|---|---|
| 1 — the glob | `WALKER_GLOBS` carries TWO entries per tree (`git ls-files` will not do it with one); the 26 hidden sites appeared | #2843 |
| 2 — route them | all 26 through `giveUp()` — none earned a `NOT_A_GIVE_UP` row, every one is a genuine degradation | #2843 |
| 3 — the drain + the invariant | every give-up now names a catalogued `loom.*` **code**, the tolerated set is **0**, and the walker invariant is a conformance gate | wave C1, packet 1d-i |

**Why slice 3 was needed at all.** Slices 1+2 made every decline FINDABLE and left all ~64 of them
UNEXPLAINED — the reason was prose at the emission site, so the reader of a generated page got a
sentence with nothing to look up. Measured before the slice: `body: Stack { CreateForm { } }` and
`Stack { DestroyForm { } }` are valid `.ddd` (`ddd parse` → `0 error(s), 0 warning(s)`) and generate
a page whose entire body is one `loom:unrendered` comment — a blank screen, no diagnostic anywhere.

**Two slices.** (1) Fix `WALKER_GLOBS` to carry two entries per tree — `git ls-files` will not do it
with one — and watch the 28 sites appear. (2) Drain them: route each through `giveUp()` or add a
reasoned `NOT_A_GIVE_UP` row.

**Claimed by open PR [#2843](https://github.com/Loom-Harness/Loc/pull/2843)** (opened 2026-09-09,
branch `claude/walker-giveup-glob`, 13 files; still open and `mergeable_state: blocked` at 2026-09-10 —
per [the completion plan](../completion-waves-2026-09.md) §4 Wave C0.1 it is red only on the playground
spec #2848 fixes). It carries BOTH slices: the two-entries-per-tree glob fix, and all **26** exposed
sites routed through `giveUp()` with **no** `NOT_A_GIVE_UP` waivers, because every one is a genuine
degradation. Two are load-bearing beyond the tidy-up — `walker-core.ts`'s `unknown layout component`
is where Flutter drops an `extern` component, so **F17**'s discoverability half closes with it, and the
Angular destroy-form fork (**F62**) was emitting give-ups with no marker at all.

**The mutation proof is the part to keep.** Reverting the glob *passes* once all 26 sites are fixed —
neither glob has anything left to find, so that proof is worthless. The real proof seeds the defect and
varies only the glob: one unrouted give-up in `flutter-target.ts` (a file the old glob scanned at zero)
makes the fixed glob **fail** naming `flutter-target.ts:601` while the old one **passes**. Same defect,
same tree, opposite verdicts.

**Landed by Wave C1 packet 1d-i (2026-09-11), on top of #2843:**

`giveUp(target, code, text)` now takes a `DiagnosticMessageKey` (so an invented code fails `tsc`) and
renders it into the comment: `loom:unrendered [loom.page-primitive-arg-missing] CreateForm(of: …): …`.
Five codes minted (`page-primitive-arg-missing` / `-arg-invalid`, `page-ref-unreachable`,
`page-expr-unrenderable`, `page-primitive-target-gap`), three existing ones reused where the
condition already had one (`loom.unresolved-page-ref`, `loom.unknown-page-element`,
`loom.sub-primitive-misplaced` — each is raised ahead of the walker by `ui-page-structure-checks.ts`,
so those sites are a validator's backstop, not a new refusal).

**A second blind spot closed with it.** The routing gate scans for `renderComment`/`renderNotice`
CALLS, so it never saw the parallel HEEx engine, which builds fourteen `<!-- … -->` / `<%!-- … --%>`
give-ups inline with no sentinel at all. Routing those surfaced two silent declines the cross-target
sweep then caught: `QueryView { }` with no `of:` rendered an EMPTY `true ->` arm (a framed panel
reading as "loaded, nothing to show"), and `Icon { }` with neither `name:` nor `svg:` emitted an
empty `<span class="loom-icon">`.

**Gates.** `walker-give-up-routing.test.ts` ratchets the census (every give-up names a catalogued
code; `UNCODED_GIVE_UPS` is shrink-only and EMPTY; a vacuity guard requires > 50 sites over > 10
files). `test/generator/_walker/walker-declines-with-a-code.test.ts` is the invariant W2.3 asked
for — all 58 registry primitives spelled with no arguments, driven through all SEVEN targets, each
bracketed by probe markers so a primitive that renders NOTHING is named rather than hidden in a
joined body. `test/fixtures/walker-give-up-shapes.ddd` is the first checked-in `.ddd` that authors a give-up —
in `test/fixtures/`, NOT the corpus, because two corpus gates state normatively that the corpus is a
BACKEND matrix (`clause-census`'s "the corpus fixtures still carry no `ui`", retro §82, and
`feature-doc-coverage`'s FEATURE_DOCS). Both caught the first placement.

**One gap REVEALED (not introduced).** Giving the HEEx give-ups a sentinel made the cross-frontend
matrix able to see them, and one cell went red: `Console`'s standalone instance-qualified
`OperationForm` is not rendered on LiveView (it needs the `handle_event` + form-binding half
`renderModal` owns). The emitter has said so in the output since #2652; the marker simply carried no
sentinel. Frozen as a reasoned `GAPS` entry with the closing recipe Flutter already used.

**Residue (not this mission's).** Codegen has no diagnostic channel, so the codes reach the user in
the generated comment, not on `ddd generate`'s stderr — lifting them into real CLI diagnostics is a
`src/system/` pass, tracked in the packet hand-off
([`waves/handoffs/wave-c1-1d-giveup-drain.md`](../waves/handoffs/wave-c1-1d-giveup-drain.md)) along with
the HEEx named-icon parity gap the drain deliberately did not smuggle in.

## M-T9.56 — 129 validator conditions reached the user as one non-catalog code; zero do now — `done` (gate half Wave C1 packet 1g, drain Wave C4 packet 4c) · P1

Found 2026-09-09 ([F55](../../audits/2026-09-03-language-docs-audit-findings.md), extended as F64). Across
`src/language/validators/**` + `ddd-validator.ts`: **196 `accept` sites carry a code, 119 errors and 11
warnings do not.** The IR check leaves are clean.

The sharp half: `src/api/report.ts` stamps **`loom.unknown`** on any diagnostic with no code, and
`loom.unknown` is not a catalog key — no docs anchor, no fix hint, no census bucket. 123 distinct
conditions collapse onto one meaningless string on the wire.

**Not a convention.** `docs/architecture/diagnostic-catalog.md:16` states the opposite rule normatively;
the two places the reference calls a message "uncoded" are receipts of the gap. The boundary is
incoherent regardless — seven type-mismatch codes already exist, and the coded `loom.unknown-name` sits
700 lines from six identical uncoded resolution errors.

**A 130-entry waiver is the wrong instrument** (a code-less site has no stable key to waive; line
numbers churn, message text rewords). Use a **per-file EXACT count**, shrink-only, following
`test/system/legacy-generate-path-ratchet.test.ts`, as a fifth invariant inside
`diagnostic-catalog.test.ts` — it already owns the scanners. Add, in the same slice, an assertion that
no `FIRING_FIXTURES` fixture raises `loom.unknown`, and a length baseline for `UNDOCUMENTED_CODES`
(currently unpinned, so new codes can land wholly undocumented).

### Gate half — `done` (Wave C1 packet 1g)

Measured on the tree, not from the audit: **129** uncoded sites (118 errors, 11 warnings) across **12**
files — `deployable.ts` 24, `statements.ts` 23, `ui.ts` 21, `types.ts` 15, `match.ts` 12,
`datasource.ts` 9, `traceability.ts` 9, `structural.ts` 7, `ddd-validator.ts` 6, `_shared.ts` 1,
`repository.ts` 1, `toplevel-function.ts` 1. The IR check leaves, the macro expander and the `src/api/`
entry points hold no row — they are already clean. Three gates landed, all shrink-only:

- **invariant 5** in `diagnostic-catalog.test.ts`, over the per-file baseline
  `test/system/diagnostic-uncoded-baseline.ts`. Grow a row → it fails naming the site; drain one without
  lowering the row → it fails as STALE; a row reaching 0 is deleted, not left at 0. (Wave C4 drained the
  last row, so the baseline file is gone and the invariant is an absolute gate — see the drain half.)
- **`diagnostic-firing-census.test.ts`** — no `FIRING_FIXTURES` fixture may raise `loom.unknown`. On its
  first run it found exactly one (`loom.workflow-emit-unknown-field`'s fixture, hitting
  `statements.ts`'s `checkEmit`); that site was drained here, so its waiver table
  (`FIXTURES_RAISING_UNKNOWN`) ships **empty**. Separately measured: **357** standalone tracked `.ddd`
  files raise `loom.unknown` **zero** times — the generic code reaches a user only through a defect
  source, which is why the fixture population is the one that matters.
- **`diagnostic-docs-anchors.test.ts`** — `UNDOCUMENTED_CODES`' LENGTH is pinned (369). Membership was
  already gated, but membership alone is satisfied by appending the new code to the undocumented list.

One site drained as the proof the drain path works end to end: `checkEmit`'s unknown-field arm now
raises **`loom.emit-unknown-field`** (wording in `messages.ts`, anchor
`06-behavior-and-statements.md#let--emit` in `code-docs.ts`, an aggregate-emit firing fixture — the half
the workflow-only IR check never sees). **128 left.**

### Drain half — `done` (Wave C4 packet 4c, seven slices)

All **128** remaining sites drained, largest validator file first, one commit per file (or per coherent
group of conditions). **109 codes for 128 sites** — 108 minted, and `loom.duplicate-theme-block` reused
with a `#system-scope` slug because `ddd-validator.ts` re-states a rule `composition.ts` already owns
one scope up. Seven more codes carry several `#slug`s for the same reason (one rule, several sentences):
`loom.resource-knob-kind-mismatch` and `loom.resource-knob-storage-mismatch` (4 knobs each),
`loom.ui-binding-missing`, `loom.unresolved-member`, `loom.matcher-e2e-only`,
`loom.layout-slot-duplicate`, `loom.requirement-property-missing`.

Two CONDITION FAMILIES were drained across files rather than by file, per the C1 hand-off's warning that
draining one of a family leaves an incoherent surface: `loom.requires-not-bool` (5 sites —
`statements.ts` ×2, `structural.ts`, `repository.ts`, `types.ts`) and
`loom.function-return-type-mismatch` (3 sites — `toplevel-function.ts`, `types.ts` ×2).

Every code carries a live `code-docs.ts` anchor — **`UNDOCUMENTED_CODES` never grew**, so its pinned
length stands at 365 — and a `FIRING_FIXTURES` entry. Two of the 128 turned out to be UNREACHABLE, found
by trying to write their fixtures, and are pinned in `UNREACHABLE_PINS` with the reason:
`loom.valueobject-contains-entity` (the grammar admits no `Containment` in a `valueobject`) and
`loom.containment-foreign-part` (the scope provider hides other aggregates' parts, so the ref never
links and the check's own `!part` guard returns first).

**Both gates are now absolute.** `diagnostic-uncoded-baseline.ts` is deleted; invariant 5 fails on the
first `accept(...)` shipped without a `code:`, naming its file, line and source text, and the
`loom.unknown` assertion dropped its `FIXTURES_RAISING_UNKNOWN` waiver table (it shipped empty — a
waiver kept past the debt it waived is slack). Invariant 5's vacuous-pass guard stopped counting live
offenders and now drives the scanner with a fixture holding one of each shape, so it holds at any debt
level including none. Both halves mutation-proved: [`waves/handoffs/wave-c4-4c-uncoded.md`](../waves/handoffs/wave-c4-4c-uncoded.md).

## M-T9.57 — `pr-gate` parks: two 2026-09-10 measurements disagree on whether tail `workflow_run` dispatches are dropped — `done` ([#2859](https://github.com/Loom-Harness/Loc/pull/2859) retired every branch-filtered claim; Wave C0 packet 0.3 ([#2863](https://github.com/Loom-Harness/Loc/pull/2863)) counted unfiltered and landed the bounded tail watch — **owner ruling pending on which reading stands**) · **S** · P1

Opened 2026-09-09 as *"every dropped-dispatch claim rests on a measurement artifact"*
([F65](../../audits/2026-09-09-verification-fleet-plan.md)); **measured and closed 2026-09-10**. Title
updated to what the measurement found. Seven PRs in ten days had shipped four incompatible explanations
of one symptom (#2730, #2804, #2812, #2822, #2832, #2835, #2846); this replaces all of them.

**The artifact is real; this mission's accusation was not.** F65 is true of branch-filtered listings in
general — a `workflow_run`-triggered run is attributed to the repository's default branch, so
`list_workflow_runs(branch=<pr-branch>)` structurally cannot return a `pr-gate` evaluation, and all 100
of the last 100 carry `head_branch: main`. It is **not** true of **#2835**, which this mission named as
resting on it. #2835 listed `event=workflow_run` runs **unfiltered** and read them correctly: its #2819
table (last evaluation created 05:48:26, last check completed 05:49:10, *"evaluations created after:
none"*) is the same observation the census below reproduces at scale, and its conclusion — "this was
delivery, not a missing name" — was right. **#2835 was right on mechanism and incomplete on coverage**:
its sweep maps `/pulls?state=open` to head SHAs, so a `gh-readonly-queue/**` head cannot appear in it,
and its own motivating case (the pr-2738 group, 42 min all-green, merged 30 s after one manual re-run)
is exactly the case that sweep cannot reach. Re-measured **unfiltered**
(`/actions/workflows/pr-gate.yml/runs?created=<window>`, matched on time), the picture is unambiguous:

| measurement | result |
|---|---|
| eligible completions → evaluations, 2026-09-10T10:00–16:00Z | 178 completions of listed workflows on non-`main` branches → 172 `PR gate` runs; **13 produced no run at all** (never created — not cancelled, not skipped). ~7% drop rate, in multi-minute windows. 9 of the 13 were on `gh-readonly-queue/**` refs, against 71 of the 178 completions (40%) — over-represented, n too small for more than that |
| parks, last 30 merged PRs | of the 22 whose gate never went red first, **10 parked ≥5 min fully green**: #2846 14 m, #2847 12 m, #2832 14 m, #2742 12 m, #2747 8 m, #2721 11 m, #2756 14 m, #2845 43 m, #2819 46 m, #2674 58 m |
| each park's cause | one missing dispatch. #2819: last check completed 05:49:11Z, last evaluation created 05:48:26Z, **zero `PR gate` runs repo-wide until 06:35:29Z**, with exactly one eligible completion in that window |
| tail size at the last delivered evaluation | outstanding checks median 1, max 7; minutes to the last completion median 1.2, 9 of 10 within 5, max 16.9 |
| cancellation (#2822's premise) | **not the cause** — 479 of 759 evaluations still `cancelled` after `cancel-in-progress: false` (GitHub evicts a superseded *pending* run regardless), and a sample of 15 had zero jobs. The newest arrival, i.e. the tail one, is never the evicted one |
| the read-after-write race (this mission's own hypothesis) | **not the cause** — an evaluation dispatched *by* a completion reads the check-runs API strictly after it |
| the `*/15` cron | six consecutive `schedule` runs gapped 2.0 / 4.5 / 4.6 / 4.5 / 3.6 hours |


### Wave C0 packet 0.3 — the unfiltered counter-measurement and the remedy that landed ([#2863](https://github.com/Loom-Harness/Loc/pull/2863))

The census above is the packet's. Its remedy and proofs follow; #2859's own re-measurement, which
disagrees with the census on whether any dispatch is dropped, is recorded after it. Both stand
until the owner rules; the tail watch stays because it is bounded either way.

**Remedy landed: the tail watch** (`scripts/pr-gate.mjs`). An evaluation that finds the SHA near-green —
`shouldWatchTail`: ≤8 outstanding, none failed, at least one already reported — re-reads the SHA every
30 s for up to 15 min, publishing every change and stopping at the first terminal verdict. The gate no
longer depends on any *future* dispatch, only on the one it is already running in. Both knobs are sized
off the table above; `pending < total` is the conjunct that stops it becoming v1's parked poller, and
the SHA-keyed concurrency group bounds it to one watcher per SHA. `pr-gate.yml`'s eval job timeout
went 10 → 20 min to fit the budget.

**Mutation-proved** in `test/system/pr-gate.test.ts`: the CONTROL arm replays #2819's timeline through
the pre-fix path and asserts the only verdict ever published is `in_progress`. Three seeded defects were
run and each failed the intended arm — unwiring the call site (1 failure), forcing `shouldWatchTail`
false (4), restoring `timeout-minutes: 10` (1).

**Two claims deleted** from `pr-gate.yml`, `docs/ci-gating.md` and `experience_gathered.md` (§113,
with addenda on §93 and §106): the lever table's *"re-running a red check does not re-evaluate the gate
— the dispatch does fire but no verdict reaches the head SHA"* (it does **not** fire: on #2773 the
re-run completed 14:41:09Z and no `PR gate` run exists repo-wide between 14:38:40Z and 14:43:27Z), and
`pr-gate.yml`'s *"NOTHING here cancels"* (479 of 759 evaluations still cancelled — GitHub evicts a
superseded *pending* run regardless of the flag; `docs/ci-gating.md` had this right already, via #2835).

**The tail watch IS the in-queue backstop.** A merge-queue head receives evaluations on both paths a PR
head does — the `merge_group: checks_requested` arm and `workflow_run` completions from inside the group
(`branches-ignore` lists only `main`, deliberately) — and `scripts/pr-gate.mjs`'s single-SHA path is
shared, so a queue head arms and runs the watch identically, bounded to one watcher per SHA by the same
concurrency group. This closes the coverage gap #2835 left, which its own sweep structurally could not.

**One residual, stated rather than fixed.** The formation evaluation cannot arm the watch: at
`checks_requested` no check has reported, and `shouldWatchTail` requires `pending < total` — the
conjunct that stops the watch parking a runner from PR-open. So an in-queue head needs at least one
`workflow_run` dispatch to land while ≤8 checks are outstanding; with 22 gates wired into the queue
there are ~22 chances, but that is a probability, not a guarantee. If every one is dropped the group
parks and its only bound is the queue's 180-minute checks timeout, which ejects rather than heals. The
fix, should in-queue parks survive this change, is a formation-time arm with its own budget — not
another sweep. Honest bounds now: a near-green SHA converges in-run; a SHA that parks outside the
watch's reach waits on repo activity (~10 evaluations per sweep) or the cron (~4 h median), and a queue
head that parks waits on the checks timeout.

### #2859 — the re-measurement that reads the same parks as latency, not loss

Two further gaps found alongside: the sweep enumerates open PRs only, so **inside the merge queue there
is no backstop at all** (a stalled group head's only bound is the timeout, which ejects rather than
heals); and the cron re-measures at a **3.3 h median** against its `*/15` schedule. Honest bounds to
document: ~30 min active, ~3.3 h idle, unbounded in-queue today.

**Packet P3 of [`missions/ci-harness-deferrals-fleet.md`](../missions/ci-harness-deferrals-fleet.md)** — **closed by [#2859](https://github.com/Loom-Harness/Loc/pull/2859) on exactly the verify-first exit this row anticipated.**

**Re-measured: the premise is an artifact, confirmed with numbers.** Of the 100 most recent `pr-gate.yml` runs, the **91** that were `event=workflow_run` **all** carry `head_branch: main` and `main`'s `head_sha`, whatever PR SHA they evaluated; the 8 `pull_request` runs carry their PR branch and the 1 `merge_group` run its queue ref. The check-runs view has the same hole — a `workflow_run` job's check run lands on `main`'s SHA, so a PR head carries exactly **one** `pr-gate-eval` no matter how many evaluations ran (verified on #2843 and #2819). No branch-filtered count can separate "no evaluation fired" from "evaluations fired and are invisible here". Parks are real; the dropped-delivery *attribution* was never evidence, and is now retired everywhere it appeared.

**No tail re-read was built, and the reason is evidence, not caution.** Two green PRs measured the same day reached a terminal verdict with no human lever — #2846 at 14m18s and #2847 at 11m48s from last non-`pr-gate` check to terminal. The late evaluation reads a *fresh* snapshot and publishes `success`: that is latency, not staleness. The #2832 instance this row offered as the hypothesis' anchor rests on the same branch-filtered figure, so it cannot ground a fix. And a sleeping evaluation would re-introduce the runner parking v1 died of while holding the per-SHA concurrency group longer, delaying the next evaluation.

**What the re-measurement found instead, correcting a live comment.** `cancel-in-progress: false` does not mean nothing cancels — GitHub still cancels the superseded *pending* run. Of those 91 evaluations: **66 cancelled, 20 success, 5 queued**. So roughly a fifth of dispatched evaluations execute and a SHA's verdict advances about twice per storm, which is the mechanism behind the 12–14 min lag that had been attributed to dropped dispatches. `pr-gate.yml` claimed "NOTHING here cancels"; it now says nothing cancels a *running* evaluation.

**Part C re-verified rather than inherited** (all three claims came from the session whose central premise was under suspicion): the cron gap holds and is refreshed — 30 runs spanning 100.9 h, mean 3.48 h, median 3.49 h, min 91 min — and **5 of those 30 are `failure`**, 2026-09-09T21:55Z→09-10T13:37Z, the #2835 self-collision window, so the idle backstop was *absent* for ~16 h rather than slow. The open-PRs-only sweep holds, so in-queue the only bound is still the checks timeout, which ejects rather than heals. The "~30 min active" bound was **too generous**: 91 evaluations in 18.4 min yielded 10 sweep-eligible and **exactly 1 survivor** — about one delivered sweep per 18 min.

## M-T9.58 — Every generated-project install runs `--silent`, so a dependency failure names no cause and gets no retry — `done` ([#2858](https://github.com/Loom-Harness/Loc/pull/2858)) · **S** · P1

Minted 2026-09-10 from an audit of deferred comments on merged PRs. This one was **proposed four times across two PRs and picked up by neither** — [#2720](https://github.com/Loom-Harness/Loc/pull/2720#issuecomment-5603540482) ("no fix exists to port, and I am not widening this PR to write one"), [#2770](https://github.com/Loom-Harness/Loc/pull/2770#issuecomment-5621699381) ("I have not changed it here because it is outside this PR's scope"). Each author was right to defer it and wrong to assume someone else would file it; this row is that filing.

**The measurement.** 49 call sites across **23 files**, all under `test/e2e/`, run the generated project's dependency install as `npm install --silent …`. `--silent` sets npm's loglevel to silent, so npm's own `npm error` lines never reach the log — `stdio: "inherit"` does not rescue them, because there is nothing on the stream to inherit. The emitted Dockerfiles are **not** affected (`RUN npm install --no-audit --no-fund`, unsilenced), so this is a CI-harness row, not an emitter one.

**What that costs, twice measured.** On 2026-09-10 three cells failed one registry-resolution window: `generated-angular-build` (`grid × angularMaterial@v1`, `showcase × primeng@v1`) and `elixir-vanilla-build` (`vanilla-embed-angular`). The two Angular cells reported only `Command failed: npm install`. The elixir cell — whose harness is the one that leaves the install unsilenced — carried the actual cause:

```
npm error code ETARGET
npm error notarget No matching version found for @angular-devkit/architect@0.2201.8.
```

One day earlier the same class hit `generated-react-build` (`file-scaffold-system.ddd × mantine@v9`), and there was no unsilenced sibling: the `ETARGET` diagnosis had to be **inferred from step timing** (3.0 s in the failing cell against 11–20 s in the seven that reached `tsc` and `vite`). A gate that can only be diagnosed by accident is the shape `experience_gathered.md` §59/§63 warns about, one rung out — the check reaches its subject, but its failure report does not.

**The fix is two independent halves, and the second is not optional.**

1. **Stop discarding npm's error output.** ~~Prefer capturing stderr and re-printing it on a non-zero exit over deleting `--silent`.~~ **That guidance was wrong, and [#2858](https://github.com/Loom-Harness/Loc/pull/2858) measured why before building to it:** at `--silent`, a failing `npm install` exits 1 with **0 bytes on both streams**, so there is nothing for a capture wrapper to capture. The loglevel itself has to change — `--loglevel=error` yields 356 bytes on the same failure — *and then* be captured. A green run still stays quiet, because `error` emits nothing on success; the volume worry the original guidance was protecting against does not exist at that level. The invariant is unchanged: a failed install names its own cause.
2. **Retry the install once on a non-zero exit**, before failing the cell. This is exactly the "one re-run confirms a flake" rule the CI guidance already applies by hand, moved to where it costs seconds instead of a queue sweep. Once, not a loop — a retry loop laundering a genuinely broken manifest is the failure mode this must not create.

Do both in one place: these 49 sites want a shared `installGeneratedProject(dir)` helper in `test/e2e/`, not 49 edited `execSync` calls. The helper is also where the existing `--prefer-offline` reasoning already written out at `test/e2e/generated-react-build.test.ts:212-219` belongs, instead of living in one file's comment.

**Verification when it lands.** Mutation-prove **both halves separately**, by file copy, never `git checkout -- <path>` (§84):

- *Half 1:* point a generated project's `package.json` at a version that cannot resolve, run one cell, and assert the harness's failure text contains npm's own `npm error code ETARGET` line. The control that stops this going vacuous: the same assertion must **fail** against the pre-fix harness, which reports only `Command failed: npm install`.
- *Half 2:* count invocations. A transient failure (fail once, then succeed) must produce exactly two installs and a green cell; a deterministic failure must produce exactly two and a red one. Asserting only the green case cannot tell a once-retry from an unbounded loop.
- Neither half may change a green cell's exit code or its wall time beyond the capture overhead.

**Packet P1 of [`missions/ci-harness-deferrals-fleet.md`](../missions/ci-harness-deferrals-fleet.md)** — **landed as [#2858](https://github.com/Loom-Harness/Loc/pull/2858)** (`test/e2e/support/npm-install.ts`, 67 call sites across 34 suites, both halves mutation-proved in both directions, plus a ratchet refusing a raw quoted `npm install` in `test/e2e/*.test.ts`). See §5 of the fleet doc for what its measurement corrected.

Sources: deferred comments on merged PRs #2720 and #2770, re-verified on `main` @ `bc7ed8f` (49 sites, 23 files, still unfixed). Relates to M-T9.8 (a gate whose failure report names nothing is how hollow work stays hidden) and to `completion-waves-2026-09.md` wave C0.2, which owns the *flaky-leg* root causes but does not name this one.
