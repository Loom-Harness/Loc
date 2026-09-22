# T6 — Backend parity & generated-code quality

> **Completed missions for this track live in [`archive/T6-done.md`](archive/T6-done.md)** (38 closed as of 2026-09-02). This file lists only the live missions.

*The core matrix (CRUD/relational/ES/inheritance/audit/tenancy) is genuinely all-5 converged, and `backend-parity-gates.test.ts` ("gated xor emitted") is the strongest anti-rot seam in the repo. What's left is a short residue — but several residues have the WRONG failure mode (silent output or generator crash instead of an honest `loom.*` gate). Converting those is cheap and high-value.*

## M-T6.2 — Vanilla-Phoenix gap register drain — `partial` · **M–L** · P2
**ES applier folds — silent fallthrough removed AND every fold shape DRAINED (this session).** The `# unsupported applier statement` comments (`eventsourced-emit.ts` aggregate fold + `workflow-eventsourced-emit.ts` workflow fold) were the last silent-if-reached fallthroughs: a `+=` / `-=` in an `apply(e: E) { … }` compiled GREEN while dropping the transition at runtime (data loss), because the fold renderer only handled `:=` / `let` / `expression`. Both folds now share `src/generator/elixir/vanilla/fold-stmt-emit.ts`, which renders EVERY fold shape and THROWS on anything else (exhaustive dispatch — the discipline validator already rejects `emit`/`call`/`precondition`/`requires`):
- scalar (`balance -= e.amount`) → arithmetic; primitive-collection (`tags += e.tag`) → list append; value-object-collection (`charges += Money{…}`) → plain map appended inline;
- contained-**entity-part** construction (`boxes += Box{…}`, incl. part-in-part) → a plain map over the part's wire shape with a minted `id` + `[]`-defaulted nested containments, since the ES path emits no `%Ctx.Box{}` Ecto struct (mirrors node's `Box._create({ id: Ids.newBoxId(), … })`). No `loom.vanilla-es-applier-*` gate — the shapes are emitted, not gated.

Two adjacent gaps drained with it: (a) a `Money[]` value-object *collection* on an ES aggregate previously emitted a table-backed `<agg>_charges` Ecto schema `belongs_to`-ing the plain-struct ES aggregate (a `mix compile` error over a table the migration never creates) — the value-collection schema emitter now skips ES aggregates (the collection folds inline); (b) `validateVanillaContainmentSupport` wrongly fired for an event-sourced aggregate's part-in-part — it now skips ES aggregates (their parts fold in memory, no relational child tables). All compile-gated by `test/e2e/fixtures/elixir-vanilla-build/vanilla-es-applier-fold.ddd` (`mix compile --warnings-as-errors`, verified — scalar + primitive + VO-collection + entity-part + part-in-part in one aggregate). KNOWN CROSS-BACKEND CAVEAT: minting the contained-part id in the fold is non-deterministic across replays — a shared ES-contained-part limitation on every backend, own follow-up.

**§11c deep part-in-part — DRAINED (this session).** A part that itself declares `contains` (part-in-part) on a RELATIONAL state-based aggregate is now emitted, so `loom.vanilla-containment-unsupported` is **fully retired** (`validateVanillaContainmentSupport` deleted). The gate's stated reason — "the shared migration emits no grandchild table" — was **stale**: the shared `MigrationsIR` DOES carry the grandchild table (python's SQL migration emits it), but the *elixir* migration emitter's part tier only emitted parts FK'd to a parent AGGREGATE, silently dropping one FK'd to a sibling PART (`tags` → `lines`). Fixed across: the migration emitter (grandchild tables emitted after their tier-0 parent, FK-topologically; tier-0 numbering byte-identical), `renderPartSchema` (a relational part's own `contains` → `has_many` on its grandchild table + `belongs_to` its DIRECT parent via `directParentName` + `cast_assoc`), and the read/update preload (`readPreloadRels` nests `[lines: :tags]`). **Boot-verified** on real Postgres: a nested `create → read` round-trip (Order → lines → tags) persists via recursive `cast_assoc` and reads back the nested tags. Compile fixture `vanilla-relational-part-in-part.ddd` + generator/validator tests pinned.

Remaining rows of the old gap register (re-verified 2026-07-13): **§12 residual** document-shape gate still rejects audited/provenanced ops, collection mutation, derived reads (blocked on shared bug #1765), dereferenced-entity members, paged/union finds — drain or leave honestly gated; **§14 tail** audit `wireSnapshot` + `WorkflowsController` `serialize/1` snake_case leak; **§13** LiveView action-button auth not actor-threaded from `socket.assigns`; Phoenix OpenAPI surface for workflow-instance views.

**Register re-verified again 2026-08-14** (docs-only pass, `ae0cb24`) — two corrections to the paragraph above: (a) the **§14 tail is four sites, not two** — `workflow-execution-emit.ts` and `audit-emit.ts` as listed, **plus** `explicit-handlers-emit.ts` (the same `defp serialize(%_{} = struct)` dump on the explicit query/command-handler controller; the file postdates the original count) and a deliberate, in-code-documented carve-out in `eventsourced-emit.ts` (an ES aggregate carrying a **ref collection** keeps the raw dump, because `__ref_ids/1`'s Ecto-assoc semantics don't hold for an in-memory fold). The workflow + explicit-handler serializers are being drained now. (b) the **§12 collection-mutation** clause can no longer lean on "gated upstream by `loom.vanilla-containment-unsupported` anyway" — that gate is retired (see the §11c drain above), so the clause stands on its own. Also confirmed spent and marked as such in the archived doc: §11's "To restore the gate" block (the 5-backend `conformance-parity` flip has landed — `examples/showcase.ddd` carries `platform: elixir`, no skip variable in the workflow), §2's remaining ask (now **inverted** — the wire settled on an *untagged* success record and `union-wire-parity.test.ts` pins that, so acting on the row would regress union parity) and §4's dead-Ash-arm cleanup (done; `relationshipNameFor` has zero occurrences).

> **§13 and §14 RE-VERIFIED DRAINED 2026-09-13 (wave C2, packet 2a); no code.** Both were re-run
> against emitted output on this head rather than read off a PR body.
>
> **§14 (`serialize/1` snake_case tail) — drained at all four sites.** The deployable-level
> controllers now DISPATCH per aggregate through `wireShape`: `controller-serialize.ts` emits one
> `defp serialize(%<App>.<Ctx>.<Agg>{} = record), do: serialize_<ctx>_<agg>(record)` head per hosted
> aggregate ahead of the `%_{}` raw-struct clause, which survives only as the last-resort arm for a
> NON-aggregate struct a handler can return. Generated `workflows_controller.ex` confirms the
> shape. The audit arm is drained the same way: every live `wireSnapshot(...)` call site
> (`context-emit.ts:1203,1392`, `operation-returns-emit.ts:713,909`, `document-emit.ts:914,946,1068,1145`)
> passes `appModule`, so the function's legacy raw-dump branch is unreachable and the snapshot rides
> `<App>.Audit.Wire.wire/1` — the same `wireShape` dispatcher the create/destroy snapshot uses. The
> `eventsourced-emit.ts` ref-collection carve-out stays, documented in code.
>
> **§13 (LiveView action-button auth not actor-threaded) — drained on both halves.** The BUTTON is
> gated (`heex-walker-core.ts:1073` `gateActionButton` wraps it in
> `<%= if (@current_user.role == "manager") do %>` when every `requires` on the op is
> currentUser-only), and the HANDLER threads the actor:
> `PhoenixApp.Sales.confirm_customer!(record, Map.get(socket.assigns, :current_user))`. Re-derived
> by generating `vanilla-auth-op-gate.ddd` and reading `detail_live.ex`, not from the fixture's own
> comment. §12's document clauses are the live remainder — see M-T6.35, whose DERIVED-read clause
> drained in the same packet.
Sources: [vanilla-phoenix-gaps](../old/plans/vanilla-phoenix-gaps.md) §11c/§12/§13/§14, [vanilla-document-route-a](../old/plans/vanilla-document-route-a.md).

## M-T6.11 — Reserved compose slots (was: `PlatformSurface` hooks, DEBT-27) — `blocked(T3/T4 features)` · — · P3
**Corrected 2026-08-14 — the five hooks this mission named do not exist.** `PlatformSurface` (`src/platform/surface.ts`) declares exactly one `emit*` method, `emitProject`; `emitAuthGate` / `emitCompliancePolicy` / `emitTenancyFilter` have zero occurrences anywhere in `src/`, and `emitAuditInit` / `emitI18nAdapter` survive only inside the doc comments of the slots below (a dangling reference worth scrubbing when someone next touches that file).
What is genuinely reserved-but-unwired is **three optional data slots on `ComposeServiceShape`**, undefined on every backend, which the compose orchestrator skips when absent: `auditSidecar` (a separate container draining audit-record events — M-T4.x audit), `policyInitCmd` (an entrypoint wrapper that loads/verifies compliance policies before the main service — M-T3.x authorization/compliance), and `i18nCatalogDir` (the in-container mount path for the i18n catalog — M-T1.11). Tenancy has no reservation at all: multi-tenant filtering ships through the capability/stance machinery ([`docs/tenancy.md`](../tenancy.md)), not a surface hook.
Disposition unchanged: don't build speculatively — each slot fills when its owning feature reaches emission. Tracked here so they aren't forgotten or cargo-culted.

## M-T6.13 — OpenAPI tag grouping — `blocked(D-MISC-C0)` (decision (f), item 3) · **S–M** · P3
Doc-level `x-tagGroups` per served `api` across the five backends (design audited + simulated; resolve decision (f) on .NET/Java per-op tags first).
Sources: [api-openapi-tag-grouping](../old/proposals/api-openapi-tag-grouping.md), ddd-review api-grouping gap.

## M-T6.14 — Small parity leftovers — `partial` (DEBT-12 closed 2026-09-13, wave C2 packet 2a) · **S** · P3

> **DEBT-12 (Phoenix `verify_token`) — VERIFIED SHIPPED 2026-09-13 (wave C2, packet 2a); no code.** Re-run against `src/generator/elixir/auth-emit.ts` on this head, all three of the debt entry's items are emitted: the `verify_token/1` auth helper in BOTH modes — a real OIDC verifier delegating to `<App>Web.Auth.Token` (joken + joken_jwks against the issuer's cached JWKS, `:515-562`) when the system declares `auth { oidc }`, and the permissive dev stub matching the Hono / .NET dev-stub verifiers otherwise (`:331`, `:343`) — the `requires` guard, which is no longer bind-only (`liveview-emit.ts` renders the find's, the projection's and the operation's gate: `:235`, `:281`, `:745`, plus the `live_auth.ex` `on_mount` page gate), and new-parts-in-body, which `debt-prioritized-backlog.md:69` already recorded as shipped (`renderNew` in `heex-walker-core.ts`). Compile-gated by `vanilla-auth-oidc.ddd` / `vanilla-auth-op-gate.ddd` / `vanilla-auth-menu-gate.ddd`. The row was stale, not open. (`auth-emit.ts` is also in-flight on PR #2900, so this close is deliberately documentation-only.)

## M-T6.35 — Persistence-adapter capability gaps — `open`; the `#migrations` + `#schema-*` sub-codes moved to M-T2.17 · **M** · P2

> **Wave C2 packet 2b drained two of this mission's clauses and re-homed three.**
> **`loom.dapper-unsupported#deep-scope` is CLOSED** — a hierarchical
> (`deep`/`global`) tenancy scope filter renders on the Dapper adapter
> (`authzFilterToSql`'s `scope` arm, `src/generator/dotnet/emit/dapper.ts`), the
> `DAPPER_UNSUPPORTED` corpus entry and its `allowlist-ratchet` pin drained to
> zero with it, and `test/e2e/tenancy-hierarchy-dapper.test.ts` proves the subtree
> / delimiter-trap / wildcard-trap reads on a booted backend against a real
> Postgres. The refusal's stated reason — that the sentinel's principal claims
> could not be bound — was a property of the hand-rolled principal-ref collector,
> not of raw SQL; the collector now rides `walkExprDeep` and contributes them by
> kind. **`loom.find-predicate-unsupported` on DAPPER was already drained** before
> this review and is not work: `DAPPER_SUBSET = FULL_SUBSET`
> (`src/ir/util/find-predicate-capability.ts`), so that code narrows mikroorm
> only. **`#migrations` and `#schema-split`/`#schema-ignored` moved to
> [M-T2.17](T2-data-evolution.md#m-t217)** — they are one seam (the boot-time
> schema owner), the ruling on them is `D-DAPPER-ALTER`, and they close on a
> `test:migration-evolution-dapper` leg rather than on anything in this mission.

The non-default persistence adapters reject shapes their EF/Ecto siblings accept: `loom.dapper-unsupported` (features Dapper does not emit), `loom.find-predicate-unsupported` (a find predicate the active adapter cannot lower), `loom.saving-shape-unsupported` (a `shape(...)` the hosting backend cannot persist — **re-classified 2026-09-03**: dormant, not live — every platform key in `PLATFORM_SAVING_SHAPES` already lists all three shapes, and a platform absent from the map is skipped rather than flagged, so this is an unreachable backstop, not a seam any live target trips), `loom.vanilla-document-unsupported` (`shape: document` only partly emitted on Elixir), and — **inherited 2026-08-24 from the now-`done` M-T6.23** — `loom.mikroorm-unsupported`, whose only surviving raiser is the migration-chain one (`migration-checks.ts` `#migrations`: neither MikroORM's `orm.schema.updateSchema()` nor Dapper's boot-time `CREATE TABLE IF NOT EXISTS` can apply a declared migration step, so a rename resolves as DROP + ADD or silently never runs — the `loom.dapper-unsupported#migrations` twin is the same shape). The adapter axis is where "all targets support the whole surface" costs the most, because each adapter multiplies the matrix again — worth confirming per row whether the adapter *cannot* express the shape (a permanent limit, so a rename) or merely *does not yet* (a gap). **`loom.datasource-binding-missing` moved OFF this mission 2026-09-03** — it never fit here: `validateDataSourceCoverage` refuses a hosted aggregate whose deployable declares no matching `dataSource` at all, which is a missing binding, not an adapter capability limit. It is now owned by M-T2.9 (the storage-config tail, where the `dataSource`-binding axis already lives).

> **`vanilla-document-unsupported`'s DERIVED-read clause drained 2026-09-13 (wave C2, packet 2a).**
> `docExprUnsupported` (`src/ir/validate/checks/datasource-checks.ts:316`) refused a
> `refKind: "this-derived"` outright, reasoning from "a derived is not persisted, so there is no
> `data` key to read". True, and irrelevant: `render-expr.ts:446` INLINES a `this-derived` read on
> EVERY vanilla path, because an Elixir struct carries no computed field either (#1765) — so the
> document op body renders `((record.item_count * record.unit_price) + …)` off the rehydrated embed,
> exactly as the relational path does. The gate now recurses into the referenced derived
> (cycle-guarded), so the read is refused only when that derived's own expression is. Verified by
> running the repro both ways; compile-gated by the extended `vanilla-document.ddd` (a two-deep
> chain read from an op guard); pinned in `test/ir/saving-shape-support.test.ts` in BOTH directions —
> a derived over stored fields is accepted, a derived over a value-object METHOD call (which the
> blob's bare map cannot serve) is still refused, and the mutation that replaces the recursion with
> a bare `return false` fails exactly that second case. The rest of the residue — a PROVENANCED op,
> a dereferenced cross-aggregate read, a VO/private/service/resource call, a REFERENCE collection —
> is untouched and still honestly gated.

**Wave C2 packet 2c — the mikroorm rows, re-verified by RUNNING each repro and dispositioned one at a time** (2026-09-13):
- **`loom.find-predicate-unsupported` on mikroorm: drained to one true shape.** The general `this.<refColl>.contains(x)` membership narrowing is GONE — its recorded reason ("needs a correlated join the adapter emits nowhere") was a claim about the EXISTS spelling, not the adapter. `containsMembershipFragment` (`src/generator/typescript/emit/mikroorm-filter.ts`) renders an uncorrelated `id in (select <ownerFk> from <joinTable> where <targetFk> = ?)` `raw()` fragment — the FilterQuery mirror of Dapper's EXISTS subquery and of drizzle's own `inArray` subselect — and the owning aggregate's `associations` are threaded to every site that can carry one (relational + embedded finds, retrievals, query-time projection filters, capability filters). Runtime-proven on a booted app against a real Postgres, with the drizzle adapter run as the oracle on the identical scenario (both answer the same two rows). What is LEFT is strictly smaller and true: a membership whose ARGUMENT is a column (`where o.tags.contains(o.id)`), which only a query-time projection `where` can produce, having no parameters to bind.
- **`#migrations`: owner-ruled, not an adapter limit.** [D-DAPPER-ALTER](../decisions.md#d-dapper-alter--dapper-and-mikroorm-get-a-real-alter-path-in-phase--the-widened-refusal-lands-first) rules the mikroorm twin the same way as dapper — build the chain in phase ⑨ (T2 mission), with the widened post-baseline refusal landing first as the interim. The interim gate is ONE change shared with the dapper half, and phase ⑨ is outside 2c's tree: handed to the coordinator rather than raced.
- **`#schema-split` / `#schema-ignored`: measured EXPRESSIBLE, and the reason the gap exists is narrow.** A MikroORM `EntitySchema` takes a `schema:` key and `updateSchema()` provisions it; the gap is that `renderMikroEntities` is never handed the per-aggregate `resolveDataSourceConfig` that the drizzle `renderSchema` already receives at the same call site (`src/platform/hono/v4/emit.ts:705` vs `:730`). Sized S–M with a booted-app proof required (`updateSchema` creating the Postgres schema); not built in 2c.
- **A NEW finding, filed not fixed:** a query-time `projection … where <alias>.<refColl>.contains(<column>)` on a bare `platform: node` deployable validates clean and then CRASHES codegen ("could not lower to Drizzle, but the validator should have caught this"). The gate keys on `dep.persistence`, which a default deployable does not carry. Ledger row `drizzle-projection-membership-column-arg-crash`; the fix belongs in the target-neutral queryable check, not in an adapter descriptor.

Sources: M-T9.27 register rows. Relates to M-T6.23 (mikroorm) and M-T6.25 (dapper query-time projections) — the same axis, already missioned.

## M-T6.60 — Request-side numeric strictness diverges three ways: TWO need an owner ruling; the third (40-digit money → database 500) was an ordinary defect and is CLOSED by Wave C1 packet 1e-i — `blocked(D-NUMERIC-INGRESS-STRICT)` · **M** · P2

Found 2026-09-08 by M-T6.48's cross-backend ingress matrix (`test/conformance/numeric-ingress-parity.test.ts`). M-T6.48 made *malformed* numeric input answer a typed 4xx on all five backends. It did not make *lenient* input answer the same way, because nothing had ever compared the five. The matrix did, against the real deserializers rather than by reading emitters, and found three rows that still disagree. All three are pinned in that file's second `describe` block as characterizations — each fails the day a backend moves in either direction — so this mission's first act is deleting the pin it closes.

**Divergence 1 — a stringified number for an `int` field.** `{"qty": "5"}` is refused by node (`z.number().int()`), .NET (`System.Text.Json` refuses String→Number without `AllowReadingFromString`) and java (`WireNumberStrictness` fails the `LogicalType.Integer` String coercion, landed in M-T6.48). It is **accepted** by python (pydantic 2 lax mode answers `5`) and elixir (`Ecto.Type.cast(:integer, "5")` answers `{:ok, 5}`). Note this is the one row java was deliberately moved on — the other two are still on their framework's default.

**Divergence 2 — a JSON number for a `money` field.** `{"price": 12.5}` is refused by four backends *structurally*: the request field is typed as a string (`z.string()`, `string Price`, `String price`, `Annotated[str, …]`), so the value never reaches a guard. Elixir's create/update path casts straight onto the `:decimal` column, so nothing types the wire value and `Ecto.Type.cast(:decimal, 12.5)` answers `{:ok, Decimal.new("12.5")}`. **No existing gate saw this** because RS-12 governs the RESPONSE direction — it says how money serializes, not what a request may carry.

**Divergence 3 — a money value too large for the domain type. CLOSED 2026-09-11** (wave C1, packet `1e-ledger-backend`; ledger row `G2644`). A 40-digit money string parsed on node (decimal.js), java (`BigDecimal`), python (a `str` passthrough) and elixir (`Decimal`); .NET's `decimal.TryParse` returned false past ~29 significant digits, so .NET alone answered 4xx — and not for a 16-digit value, which is the same defect a few digits earlier. On the rest the value reached `NUMERIC(19,4)` and the **database** rejected it — exactly the failure shape M-T6.48 was written to remove, arriving one layer later.

> **What landed.** A RANGE check at the same wire boundary each backend's format guard already occupies — node's `moneySchema`, java's `WireFormatException.money`, python's `_money_str`, .NET's `wireParseGuard`, and BOTH of elixir's paths (the op-param `__loom_decimal_param` and, separately, a `validate_change` on every cast money column, because the create/update path never reaches the op-param guard). The bound is derived once, in `src/generator/money-scale.ts`: `MONEY_INTEGER_DIGITS = MONEY_PRECISION - MONEY_WIRE_SCALE`, so one constant governs the guard and the column. One refusal message on all five (`Money out of range: "…"`) because the wire-golden differential compares bodies across backends. A value object's money is deliberately NOT range-checked — it rides a jsonb column with no precision bound, so it cannot produce the failure.
>
> **Verified against the authorities, not the emitter.** Postgres 18 states the bound itself: `INSERT` of `1000000000000000` into `numeric(19,4)` answers `ERROR: numeric field overflow / DETAIL: A field with precision 19, scale 4 must round to an absolute value less than 10^15`, and `999999999999999.9999` inserts. The EMITTED python request model, imported verbatim and run through real pydantic 2, refuses 16 integer digits with `type=money_range` and accepts 15 — the framework-enforced half `npm test` cannot see. `numeric-ingress-parity.test.ts` gained the fifth probe row (six seam arms, each mutation-proved by file-copy revert) and the divergence-3 pin it closes was deleted in the same change.

**Why 1 and 2 are a ruling, and why 3 must NOT wait on it.** Divergences 1 and 2 are backends being *more permissive* than the contract, and narrowing them breaks clients relying on the lenience today — a decision the owner makes, not the codegen.

**Divergence 3 was not that, and was scheduled apart from them (and has since landed).** There is no contract to narrow: nobody depends on "a 40-digit price answers 500". It is the same client-fault-reported-as-server-fault class M-T6.48 removed, surfacing one layer later at the database instead of at the parse. Its fix is a different shape too — a **range** check derived from the money column's precision, not a format guard — so it shares neither the decision nor the code with 1 and 2. Holding it behind an owner ruling stalls an unambiguous defect behind a contract question it does not raise. Land it as an ordinary P2 defect whenever a backend packet is open; land 1 and 2 only after the ruling.

*(Recorded 2026-09-10 from the M-T6.48 matrix session. The wave plan's §5 ruling #4 currently bundles all three as one owner-only item — see the note on [#2849](https://github.com/Loom-Harness/Loc/pull/2849).)*

**The fix, once ruled.** Strict: `model_config = ConfigDict(strict=True)` on python request models (or per-field `Strict()`, which is narrower and does not disturb datetime parsing), and a pre-cast wire-type guard on elixir's changeset path — the natural home is a `__loom_money_field` / `__loom_int_field` validation running before `cast/3`, reusing the `__loom_param_error` responder the op-param arm already emits. (Divergence 3's half of this paragraph is done — see its block above.)

**Verification when it lands.** Delete the matching pin in `numeric-ingress-parity.test.ts` and replace it with a positive seam in the same file — the pin and the seam are the same assertion inverted, so the diff shows the contract moving. Re-run the deserializer measurements (the header table is the record and must be updated with the new row, not left stale). Mutation-prove each backend arm by file-copy revert per the repo rule.

Sources: [numeric-types-audit-2026-08-23](../audits/numeric-types-audit-2026-08-23.md) F12 annex (the stringified-number skew was noted there but never dispositioned); M-T6.48 and its matrix. Relates to RS-12 (money wire scale, response direction) and RS-24 (decimal is a JSON number).

## M-T6.50 — Python saga / workflow emission holes: three collector gaps that ship `F821` into the generated app — `partial` (sites 1 + 3 landed by [#2752](https://github.com/Loom-Harness/Loc/pull/2752), verified 2026-09-11; **site 2 is the only live half**, claimed by [#2850](https://github.com/Loom-Harness/Loc/pull/2850) + wave-c1 packet 1a) · **S–M** · P1

Found 2026-08-30 re-verifying the [08-24 generator review](../audits/generator-code-review-2026-08-24.md)'s follow-up register (rows 14–16); two **reproduced** on `main` @ `aa236ae`, one latent.

> **Narrowed 2026-09-11 (wave C1, packet 1f) by READING the code on the wave base, not the PR bodies.**
> **Site 1 is closed:** `dispatch-builder.ts:21` imports `domainServiceImportLinesForWorkflow` and `:452`
> splices it into the saga-handler file's import block, so the bare `next_attempt(1)` the mission
> reproduced now has its `from app.domain.services.retry import next_attempt`.
> **Site 3 is closed, and closed the way §F3 asked:** `collectStmtExprImports`
> (`python/emit/domain-service.ts:252-254`) is two lines — `walkStmtExprsDeep(st, (e) =>
> collectPyExprImports(e, into))` — so the hand-enumerated 10-of-11 switch is gone and a new
> `StmtIR` kind cannot silently skip imports again. `test/system/ir-walk-census.test.ts` is green
> on this tree with no waiver for either file, which is the ratchet that keeps them closed.
> **Site 2 (own-state assign in an uncorrelated command workflow) is untouched here** — the
> python indentation half is #2850 and the VALIDATOR RULING for its cases (B)/(C) is wave C1
> packet 1a's. This mission closes when that lands; nothing else in it is open. No ledger row in #2668, no other owner. One backend, one class — a renderer emits a name the module never binds — three sites:

1. **`dispatch-builder.ts` emits no domain-service imports at all.** `domainServiceImportLinesForWorkflow` exists (`python/emit/domain-service.ts:291`) and has exactly two callers — `workflows-builder.ts:257` and `emit/aggregate.ts:266`. The saga-handler file is not one of them, and the PY_TARGET leaf renders a domain-service call as the **bare** function name. Reproduced: a saga `on(s: ShipmentRequested)` handler calling `Retry.nextAttempt(1)` emits `next_attempt(1)` at `app/dispatch.py:31` with no `from app.domain.services.retry import next_attempt` → ruff `F821` / `NameError` at first delivery.
2. **Own-state assign in a non-correlated command workflow renders `self._x` at module level.** `workflows-builder.ts:582` builds the route target with `thisName: "self"`, and the `assign` arm (`:817-823`) renders the own-state LHS through that mapping — but the workflow ROUTE is a module-level `async def`, not a method. Reproduced: `create(title: string) { counter := 1 … }` emits `self._counter = 1` into `app/http/workflows_routes.py` → `F821`. (The correlated saga path is correct: it maps to the tracked row via `thisName: "state"`.)
3. **`collectStmtExprImports` misses `variant-match`.** `python/emit/domain-service.ts:243-265` enumerates 10 of the 11 `StmtIR` kinds by hand; nested statements inside a `variant-match` arm contribute no imports. Latent today, and it is §F3's exact shape — the two exported collectors in the *same file* already ride `walkStmtExprsDeep` / `walkWorkflowStmtExprsDeep` (`:283-296`).

**The work:** (1) call the existing helper from `dispatch-builder.ts` (the handler bodies are `WorkflowStmtIR`, so it is the `…ForWorkflow` variant); (2) decide the own-state target for the uncorrelated command shape — the honest options are a local dict the route saves at exit, or a validator refusal if own-state on an uncorrelated workflow has no meaning — and render *that*, not `self`; (3) delete the hand-enumerated switch in favour of the exhaustive walker (the `never`-guard is the point: the next new `StmtIR` kind fails to compile instead of silently emitting an unbound name).

**Verification when it lands.** Per-site generator tests plus a `ruff --select F821` run over the generated tree for each shape (the corpus python gate already runs ruff — the reason these shipped green is that no fixture crosses saga × domainService, or command-workflow × own-state; mint both). Mutation-prove by file-copy revert, per the repo rule.

Sources: [generator-code-review-2026-08-24](../audits/generator-code-review-2026-08-24.md) §Follow-up register (2026-08-30) rows 14–16; §F3 (one ref-walker per IR family) is the durable fix for (3). Relates to §A16 (the three sibling collectors #2667 already migrated onto `src/ir/util/walk.ts`).

## M-T6.56 — Phoenix wire and HEEx divergences: a dropped `derived`, a `:map` value-object column, `Image`/`Icon`/`WorkflowForm` — `open` · **M** · P2 ⚠ verify-first

Found 2026-09-03 by the language-docs audit ([F16](../audits/2026-09-03-language-docs-audit-findings.md), [F20](../audits/2026-09-03-language-docs-audit-findings.md), [F22](../audits/2026-09-03-language-docs-audit-findings.md), [F23](../audits/2026-09-03-language-docs-audit-findings.md); P1/P2). `derivedRenderable` (`src/generator/elixir/vanilla/wire-serialize.ts`) omits a `derived` that reads another `derived` from `serialize/1` while the other four backends ship it — a wire-shape divergence with no gate. On the HEEx side, `renderImage` (`src/generator/elixir/heex-primitives.ts:1510`) and `renderIcon` (`:2151`) read only a named `src:` / a `svg:` literal, ignoring the positional spelling every other target renders (`Image { "/logo.png", alt: … }` emits `<img alt>` with no `src`; `Icon { name: "check" }` an empty span), and the HEEx `WorkflowForm` emits a single `<.input field={@form[:_placeholder]}>` (`heex-primitives.ts:388`) where React emits the real field set.

**The fix:** wire parity for the derived-reading-derived case; the positional spellings and the real workflow param set on HEEx. **F20 may be a DECISION, not a defect** — `total: Money` produces `total_amount` + `total_currency` on node/dotnet/java/python and `add :total, :map` on Ecto, contradicting the "one DDL for everyone" invariant; establish which it is before touching the migration emitter, since the reference chapter already carries it as an honest gap.

**Verification when it lands.** A wire-golden covering the derived chain; per-primitive HEEx tests for the positional spelling and the workflow field set; each mutation-proved by file-copy revert.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F16/F20/F22/F23, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W5.3**. Relates to M-T1.26 (the `Image`/`Avatar` `src:`/`alt:` slots on the JSX targets — same primitives, other side).

> **Verified 2026-09-09 (fleet). F20 is a DECISION — do not touch the Ecto migration emitter.**
> The wire is byte-identical (`serialize_money/1` emits nested `{amount, currency}`), each backend owns
> its own database, and `03-domain-modeling.md:184` already documents the `:map` column. The real docs
> defect is elsewhere: **`docs/generators.md:996` and `:1031` claim `embedded_schema` / a custom
> `Ecto.Type` for value objects and both are false** — the emitter returns `":map"` unconditionally.
>
> **F16 and F23 are both worse than recorded.** F16: the emitted OpenAPI schema declares the dropped
> `derived` AND lists it in `required:`, so the app violates its own published contract on every
> response (audit F60). F23 is not a placeholder but a RUNTIME CRASH — `phx-submit="run_<wf>"` with
> zero `handle_event/3` clauses raises `FunctionClauseError` and kills the LiveView (audit F61).
> **Split F23 out**: shipping the field set without the handler looks correct and still 500s, and its
> only proving leg (`phoenix-ui-e2e`) is in neither the per-PR set nor the merge queue.

> **F16 / F60 CLOSED 2026-09-13 (wave C2, packet 2a).** `derivedRenderable`
> (`src/generator/elixir/vanilla/wire-serialize.ts:91`) now resolves a `this-derived` read instead
> of refusing it: a derived that reads another derived projects exactly when the referenced
> derived's own expression does, with a cycle guard. The renderer was never the blocker —
> `render-expr.ts:446` already INLINES a `this-derived` read (an Elixir struct carries no computed
> field, so `record.<name>` would raise `KeyError`, #1765); only the projection PREDICATE disagreed
> with it. Resolution goes through the same `ctx.agg.derived` list the renderer consults, so a PART
> or VALUE-OBJECT serializer — whose render ctx carries the parent aggregate — still declines rather
> than claiming an inline the renderer would not produce.
>
> Gated by `test/generator/elixir/derived-wire-contract.test.ts` as the INVARIANT rather than the one
> field: for every aggregate response schema in the generated project, `required:` must equal the key
> set `serialize/1` emits — the expected value read off the OpenAPI the backend publishes, not off
> the serializer's emitter. Compile fixture `vanilla-derived-chain.ddd` (three-deep chain, so the
> recursion is exercised). BOOT-PROVED on real Postgres: `GET /api/orders/:id` and the paged list
> both answer `{"subtotal":15,"withTax":30,"label":"n=30",…}`. Mutation: forcing the `this-derived`
> arm back to `false` fails "sweeps every aggregate response schema in the project" and "projects a
> derived that READS another derived".
>
> **RESIDUE, pinned as a characterization in the same file.** A derived whose chain bottoms out on an
> aggregate `function` call keeps the identical self-contradicting contract, by a different
> mechanism: `function-emit.ts` puts `def twice(%Order{} = record)` on the CONTEXT FACADE module,
> which the controller hosting `serialize/1` does not host, so inlining would emit an unbound
> `twice(record)`. Closing it means qualifying the call at this one site (a `RenderCtx` seam) AND
> reconciling the document / part / value-object serializers, which pass a struct the facade's
> guarded clause head does not accept — its own slice. F20 stays a DECISION (see above).

> **F22 CLOSED 2026-09-13 (same packet).** Two HEEx emitters read strictly less of their call than
> every other target. `renderImage` (`heex-primitives.ts:1541`) read only the NAMED `src:`/`alt:`, so
> the positional shorthand the JSX walker renders (`Image { "/logo.png" }` — the same
> first-positional-is-the-value rule Text / Money / EnumBadge follow) emitted an `<img>` with no
> `src` at all, and `decorative: true` was dropped, so a decorative image announced itself to
> assistive tech on LiveView alone. `renderIcon` (`:2205`) `void name`d its `name:` and emitted an
> EMPTY `<span class="loom-icon">` — an element that reads on screen as a rendered icon — while the
> builtin registry it needed was ALREADY imported in the same file (`renderButton`'s `icon:` arm
> resolves through it), so the divergence was a missing call, not a missing capability. Both
> refusals now match the JSX walker arm for arm (`#arg-missing` for nothing named, `#arg-invalid`
> for a name the registry cannot resolve). Pinned by
> `test/generator/elixir/heex-image-icon-positional.test.ts`, every claim stated against the REACT
> emission of the same `.ddd`; mutation-proved twice (dropping the positional fallback; replacing
> the registry lookup with `""`).

> **F61 CLOSED 2026-09-13 (same packet, its own commit as the plan required).** The HEEx
> `WorkflowForm` emitted one `<.input field={@form[:_placeholder]}>` AND `phx-submit="run_<wf>"`
> with zero matching `handle_event/3` clauses — `renderCreateEventClauses` filters
> `kind === "aggregate"`, which is why the workflow binding fell through it silently and a submit
> raised `FunctionClauseError`, killing the LiveView. Now: `renderWorkflowForm`
> (`heex-primitives.ts`) emits one typed `<.input>` per the workflow's command-triggered `create`
> params (resolved through a new `WalkContext.workflowsByName`, derived at walker entry from
> `bcByAggregate` exactly as `projectionsByName` is, so no caller threads a second registry), and
> `renderWorkflowEventClauses` (`liveview-emit.ts`) emits the matching clause over
> `<App>.<Ctx>.Workflows.<Wf>.run/1`. Three things the aggregate create path gets for free are done
> by hand there: the `as:` prefix (`to_form(%{}, as: "<wf>")`, without which the params never arrive
> under the key the clause matches), the REKEY (the form field is `snake(param)`, the workflow module
> destructures the DECLARED name, so a multi-word param would bind `nil`), and COERCION via
> `__wf_param/2` (a browser form submits strings; the HTTP route feeds the same `run/1` typed JSON,
> and a workflow body uses its params directly — no Ecto `cast` in between).
>
> BOOT-PROVED on real Postgres: `handle_event/3` is exported (it did not exist), a submit of
> all-string params runs the workflow inside its transaction, and the row Ecto writes is
> `qty=3` (integer), `total=Decimal.new("9.99")`, `rush=true` — so the coercion and the
> `unit_total` → `unitTotal` rekey are proved by the database, not by the emitter. A param-less
> workflow's clause binds `_raw` and emits no coercer (an emitted-but-uncalled `defp` fails
> `--warnings-as-errors`). Compile fixture `vanilla-workflow-form.ddd`; pinned by
> `test/generator/elixir/heex-workflow-form.test.ts` (8 cases, the `as:` read off the mount and fed
> back into the handler assertion so the two cannot drift); mutation-proved twice — removing the
> `renderWorkflowEventClauses` call fails five cases, disabling the field branch fails two.
>
> **`phoenix-ui-e2e` is still the only leg that would drive this in a browser, and it is in neither
> the per-PR set nor the merge queue** — the reason the plan split F61 out. The boot proof above
> calls the emitted clause directly for exactly that reason.

## M-T6.57 — `envelope` means something different on each of the five backends — scope it before fixing it — `done` (option B ratified as [D-ENVELOPE-RATIFY](../decisions.md), landed 2026-09-10) · **S** · P0

Found 2026-09-03 by the language-docs audit ([F21](../audits/2026-09-03-language-docs-audit-findings.md), P2). The repository layer carries `Envelope<T>` on dotnet and java; node/dotnet/java/python routes return the bare response; elixir's controller returns a JSON array. Five targets, no agreed meaning.

**This is NOT a fix mission.** "Five-way inconsistent" is a parity question, not a bug with a known answer: hand it to the `parity-auditor` skill for the who-emits-what matrix and a decision on what `envelope` *should* mean, then file the fix as its own mission. Do not let an agent guess the intended semantics.

**Verification when it lands.** The matrix, the decision recorded where the carrier is documented, and a successor mission ID for the emitter work.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F21, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W5.4** (`fileTrees: []` — scoping only). Relates to M-T6.14 (DEBT-08 `envelope` carrier, deferred there for "no live use" — this is the evidence that the carrier is not inert).

> **Verified 2026-09-09 (fleet). ESCALATE — this is a P0, not a P2 parity nit (audit F57).**
> `find audit(): Order envelope` reports `0 error(s), 0 warning(s)` and emits **non-compiling** output
> on two backends: Java references `Envelope<T>` in three files and declares it in none; .NET's body
> returns a bare `T` from a signature typed `Task<Envelope<T>>` (CS0029). It is four-way, not five.
> **It survived because NO `.ddd` in the repo uses the carrier** — zero syntactic hits across corpus,
> examples, build fixtures and playground — so every compile gate is blind by construction.
> `docs/generators.md:66` gives generic carriers five ticks; two sit on output that does not build.
> Scoping is done (see the fleet plan); the A/B/C fork needs user sign-off before any emitter change.
> The docs correction is true under every option.

> **CLOSED 2026-09-10 — option B ratified by the user and landed.** `envelope` **means a
> single-row find**: the repository returns `T`, the route returns the bare body, 404 when
> absent — exactly what node and python already shipped (both reproduced clean; the register's
> "python 404s on absent" undersells node, which throws `AggregateNotFoundError` on an empty
> `limit(1)` and 404s too). All five reproduced first: java's three `Envelope<Order>` signatures
> (port / Spring-Data interface / impl, type declared nowhere, `OrderResponse.from(...)` called on
> it) — CONFIRMED; dotnet's `Task<Envelope<Order>>` returning a bare `Order` — CONFIRMED (and the
> query handler then reads `domain.Id.Value` off the carrier); elixir's `Repo.all` + JSON array
> against a single-object OpenAPI — CONFIRMED. Option A (`{id, ts, body}`) stayed blocked: nothing
> in the IR can source `ts`.
> **Fix:** `envelopeReturn` (`src/ir/stdlib/generics.ts`, beside `pagedReturn`) is the one
> recogniser; java unwraps in `findReturn`, dotnet in the new `domainFindShape` (composed with
> `unionFindAsOptionalTwin` at all 8 call sites, so the port/impl/dapper adapters cannot diverge)
> and the dead `Envelope<T>` record is deleted from `dotnet/emit/common.ts`, elixir's four
> `isSingleReturn`/`isDocSingleReturn` predicates gained the carrier arm. node/python: no change
> needed, verified.
> **Fixture:** `test/fixtures/corpus/envelope.ddd` (+ manifest row, `backends: ALL`) — the first
> `.ddd` in the repo to instantiate the carrier, so the per-PR corpus generation gate and every
> backend compile tier now see it. Pinned by `test/generator/envelope-carrier.test.ts`
> (`T envelope` and `T` must emit byte-identically, per backend).
> **Semantics note for readers:** this REMOVES the distinct meaning the keyword was documented to
> carry. `envelope` is now documentation-in-the-signature ("this read yields at most one row"),
> not a wire wrapper. Docs corrected: `generators.md` (the five-tick carriers row, split + noted),
> `payloads.md` §2, `language-reference/04-type-system.md` § `envelope`.
> **Fixture tier — compile, not behavioural, and signed as such.** `envelope.ddd` carries no
> `test e2e` block; it is listed in `E2E_LESS_CORPUS_FIXTURES` and `BEHAVIOURAL_ABSENT`. A block was
> authored and withdrawn: it mints a wire golden, and the find-miss 404 `detail` is **not uniform** —
> node answers `"not found"`, dotnet/java/python/elixir answer `"not_found"` (dotnet's own
> `projectionClauseFor` comment calls `"not_found"` "the canonical find-miss detail token on every
> backend"). A golden captured on the node leg would redden the other four on `main`.
> **TWO SPIN-OFFS, both pre-existing and neither envelope-specific:**
> (a) that 1-vs-4 find-miss `detail` split — any non-optional single find hits it. **CLOSED 2026-09-21 (#2979).** It was worse than 1-vs-4: node answered the token on its `: T?` / `: T option` arms (thrown from `routes-builder.ts`) and the space-spelling on its `: T` / `: T envelope` arms (thrown from `repository-find-builder.ts`) — an INTRA-backend split as well as a cross-backend one. node aligned on `"not_found"`; gated per site across 5 backends x 4 carriers by `test/conformance/find-miss-detail-parity.test.ts`, which also pins RS-27's by-id SENTENCE beside it so the two 404 classes cannot be collapsed. The miss arm of a single-row-find e2e block is no longer blocked;
> (b) a FILTERLESS single-return find on an EVENT-SOURCED aggregate emits
> `Enum.find(all, fn a ->  end)` on elixir — an empty lambda body, invalid Elixir (identical for
> `find pick(): Ev` with no carrier).
> A third, benign: the `envelope` carrier in a PAYLOAD FIELD (the other position the AST gate
> admits) is unreachable — the monomorphized `<T>Envelope` payload has no builder, so nothing can
> construct one.
## M-T6.58 — `handle` and named `create` are lowered, test-pinned and promised by a diagnostic — but no backend emits an entry point — `partial` (the `handle` gate landed; named `create` + the emitter remain) · **L** · P1 ⚠ verify-first, route to `language-feature-developer`

Found 2026-09-03 by the language-docs audit ([F13](../audits/2026-09-03-language-docs-audit-findings.md), P1) — the only finding in the register that is a *missing feature* rather than a defect. `src/ir/lower/lower-workflow.ts:124-174` fills `WorkflowIR.handlers`/`.creates`, `test/ir/workflow-handle.test.ts` pins the lowering, and `loom.duplicate-handler` (`src/diagnostics/messages.ts:310`) promises that a `route -> Ctx.<handle>` is meaningful — yet no emitter reads `wf.handlers`. A workflow with `handle retry(...)` plus `api { route POST "/fulfil/retry" -> C.retry }` produces no route on node or dotnet, and no routes file at all.

**Two honest outcomes:** emit the entry points on all five backends, or gate the declaration and correct `loom.duplicate-handler`'s message. Which one is a design decision with user sign-off, not a fix an agent picks — route it through the `language-feature-developer` skill rather than into a drain wave.

**Verification when it lands.** Whichever end: a route-emission test per backend plus a behavioural leg that POSTs the handler route, or a negative validator test with the corrected message; mutation-proved either way.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F13, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W6.1** (`route: language-feature-developer`). Relates to M-T5.8 (lifecycle-operation route emission — the same "declared entry point, no route" axis).

> **Verified 2026-09-09 (fleet). Recommendation: option (b), and the packet's real content is a third
> thing.** `handle` is NOT entangled with channels — an entry point here is an HTTP route on all five,
> which removes a whole design axis. But **`HandleDecl` has no `by` clause in the grammar**, and
> `HandleIR` carries no correlation, so nothing says which saga instance to run against. That missing
> ADDRESSING surface, not the emitter work, is the real question — and `commandHandler` already covers
> the use case with a full emitter on all five. Named `create` is dropped too, by a different
> mechanism (`lowerWorkflow` picks one primary). The route drop is one identical fail-open five times
> (`if (!h) continue;`) while `api-checks.ts:217-220` actively models the handler name as "the WRITE
> face" — three places promise routing works, zero deliver. **Blocked on M-T6.62** (the workflow-`create`
> miscompile; renumbered from M-T6.60 on 2026-09-10), which must land
> first: option (a) would be built on a create path that miscompiles on all five.

> **Option (b)'s `handle` half LANDED 2026-09-13 — M-T5.34 (#2864 D5, fleet decision D-1(c)).**
> `handle name(…) { … }` is now refused by `loom.workflow-handle-unsupported`, and the three
> places that promised routing works have been cut to zero: `docs/workflow.md`'s members table
> and `docs/language-reference/13-workflows.md` §"create / handle" now say it is refused rather
> than selling it as the multi-command saga surface, and `loom.duplicate-handler`'s message no
> longer implies a `route -> Ctx.<handle>` is meaningful. `examples/showcase.ddd` gave up its
> `handle reset()` (the showcase's contract is "validates with zero errors"), which is why
> `HandleDecl` now sits in the showcase ALLOWLIST and the clause census's `UNAUTHORED_CLAUSES`
> — both entries name this mission as their drain condition.
>
> **What is still open here, unchanged:** (1) the **named `create`** half — still dropped by
> `lowerWorkflow` picking one primary, and deliberately NOT gated by M-T5.34 (a named
> *event*-triggered create IS dispatcher-routed and works; only the named *command* form is
> silent, so one gate would have been wrong for half the shapes); (2) the **addressing**
> question this note already identified as the packet's real content — `HandleDecl` has no `by`
> clause and `HandleIR` carries no correlation, so nothing says which saga instance a handler
> runs against. M-T5.34 deliberately did not answer it: the ruling was that the SILENCE is the
> bug, and the emitter is a feature decision taken with user sign-off. The mission is no longer
> `blocked` on D-HANDLE-REMOVAL for the gate half — that decision is made — but the emitter half
> still routes through `language-feature-developer`.

## M-T6.59 — Phoenix cannot render the `if` statement: an assigning branch would compile and do nothing — `partial` (statement lands; three sub-shapes stay gated) · **M** · P2

Raised 2026-09-03 by the M-FT.11 field-test slice, which added the `if <cond> { … } else { … }` statement to operation bodies. It renders on node / dotnet / java / python through the shared `_stmt/target.ts` spine; elixir is refused up front by `loom.elixir-if-stmt-unsupported` (`src/ir/validate/checks/if-stmt-checks.ts`) rather than half-rendered.

**Why it was gated, not written.** Every Phoenix body renderer threads its result through a REBOUND `record` (Elixir is immutable, so `field := v` is `record = %{record | field: v}`), and a binding made inside an `if` block does not escape the block. The naive rendering compiles clean under `--warnings-as-errors` and then silently does nothing — the exact silent-drop class the repo's gates exist to prevent.

**The shape that works** is a value-producing branch — `record = if <cond> do <stmts>; record else record end` — applied in EVERY vanilla body renderer that owns a `record` (`vanilla/operation-returns-emit.ts`, `vanilla/context-emit.ts`, `vanilla/eventsourced-emit.ts`, `vanilla/function-emit.ts`, `domain-service-emit.ts`), each of which has its own indent and variable conventions. A `return` inside a branch is the sub-case that does NOT fit it (the returning-op path emits `{:ok, …}` tuples as the body's tail expression) and needs either a `with`-chain rendering or a narrower gate of its own.

**Verification when it lands.** A `render-stmt`-level test per touched renderer, an elixir compile leg (`mix compile --warnings-as-errors`) over a model whose `if` branch ASSIGNS, and a behavioural check that the assignment is observable after the call — a compile-only gate cannot see this bug. Delete the `loom.elixir-if-stmt-unsupported` row from `src/diagnostics/unsupported-register.ts` and its arm in `if-stmt-checks.ts` in the same PR, and lower the gap pin.

> **Landed 2026-09-13 (wave C2, packet 2a).** The statement RENDERS on elixir now.
> `src/generator/elixir/vanilla/if-stmt-emit.ts` renders the value-producing shape
> (`record = if … do … record else record end`, with the `else` arm SYNTHESISED when the
> source has none — an Elixir `if` with no `else` answers `nil`, which would null the
> threaded record), wired into `renderReturningStmt`
> (`vanilla/operation-returns-emit.ts:1370`, reused by `context-emit.ts` + `document-emit.ts`),
> `renderPureBlock` (`vanilla/function-emit.ts`) and the domain-service renderer
> (`domain-service-emit.ts:545`).
>
> **The second half was the one a compile gate cannot see.** Every "does this body write a
> column / mutate a containment / touch a ref collection" probe scanned `op.statements` ONE
> LEVEL DEEP, so with the branch rendering correctly the persist tail still emitted
> `change(%{})` with no `force_change` — the branch computed the new struct and `Repo.update`
> wrote nothing. `opBodyStmtsDeep` (`src/generator/elixir/domain/predicates.ts`, riding
> `walkStmtsDeep`) now feeds `persistPutBodies`, `opMutatesState`, `mutatesRefColl`,
> `contextMutatesRefColl`, `contextUsesRefCollOp`, `contextMutatesRelationalContainment` and
> `mutatesEmbeddedContainment`. `function-emit.ts`'s hand-rolled `bodyExprs` switch (five
> kinds, no `if` arm) moved onto `walkStmtExprsDeep` in the same commit — otherwise a param
> read only inside a branch was invisible and the clause head underscored it.
>
> **Boot-proved on real Postgres** (generated project, `mix ecto.migrate` + `mix phx.server`):
> `POST /api/tasks/:id/grade {"bonus":9}` on `score: 5` reads back `score: 14, tier: "gold"`
> — the branch's assignments persisted; a second op with an `else`-less `if` taken and then
> untaken leaves the record intact (`attempts: 3`, not `nil`). Compile-gated by
> `test/e2e/fixtures/elixir-vanilla-build/vanilla-if-stmt.ddd`
> (`mix compile --warnings-as-errors`, green).
>
> **What stays gated**, each a strictly narrower `#slug` of `loom.elixir-if-stmt-unsupported`
> (`src/ir/validate/checks/if-stmt-checks.ts:265`): `#return-in-branch` — an EARLY EXIT, which
> needs the statements FOLLOWING the `if` restructured into a `case` arm (a list-level
> transform that also breaks the same-length/same-order `statementSubRegions` zip the sourcemap
> collector depends on); it IS allowed in a TAIL-VALUE body (domainService / pure `function`),
> where every `return` is already the block's value. `#guard-in-branch` — the op path hoists
> top-level `requires`/`precondition` into a `with :ok <- ensure(…)` chain answering 403/422,
> and a nested one would raise → 500, a wire divergence worse than the refusal.
> `#event-sourced` — an ES command body is sorted into `with`-clauses / `let`s / one
> `events = […]` list, never rendered as a statement sequence, so a conditional `emit` has
> nowhere to go (`eventsourced-emit.ts` grew a throwing arm; its `default: break` would have
> dropped the branch silently). And `#branch-statement` — a CLOSED branch vocabulary
> (`BRANCH_VOCABULARY`) rather than a list of known-bad shapes, because the value-producing
> rendering is not the only thing a branch statement needs: the emitters decide an operation's
> SUPPORTING machinery by scanning `op.statements`, and several of those scans are one level deep
> by design. An `emit` in a branch is the sharp case — it renders fine, `contextEmitsEvent` does
> not see it, so the host module carries no `require Logger` (a compile error), and the S5a
> persist-then-dispatch restructure cannot hoist a CONDITIONAL emit past the commit anyway, so a
> phantom event would fire on a failed write. A PROVENANCED write is the same shape one layer up
> (`opHasProvSite`, `src/ir/util/prov-id.ts:49`, scans top-level statements only). Fail-closed: a
> NEW `StmtIR` kind is refused in a branch until someone decides what it means there. The register
> row narrows rather than drains.
>
> **Hand-off (outside the packet fence).** `loom.function-block-no-return`
> (`src/language/validators/types.ts:906-957`) walks `fn.block` one level deep, so a pure
> aggregate `function` whose only `return`s sit inside an `if` is refused at phase ④ on EVERY
> backend — the identical tail-return shape a `domainService` operation accepts. Not an elixir
> row; the elixir renderer already handles it.

> **Re-classed 2026-09-21 (wave C2, packet 2m) — `D-ELIXIR-IF-BRANCH`.** The four survivors above
> were re-derived on a fresh head and the register row moved `gap` → `scope`, keeping
> `mission: "M-T6.59"` and every arm that fires. The finding that decided it: three of the four
> need a change to HOW a Phoenix body is BUILT (a list-level restructure for the early exit; a
> non-hoisted guard form; a statement spine for ES commands), and the two sharpest members of the
> closed branch vocabulary are **not elixir-local at all** — a conditional `emit` is an event
> ORDERING question the S5a persist-then-dispatch restructure cannot answer (walking deeper does
> not fix it), and a PROVENANCED write in a branch is decided by the TARGET-NEUTRAL `opHasProvSite`
> (`src/ir/util/prov-id.ts:49`), so deepening that scan changes all five backends. This mission
> stays OPEN and owns the body-renderer question; what changed is the claim that a drain sprint
> could close it.

Sources: M-FT.11 (grammar slice: `key` / `if` / `??`). Relates to [`vanilla-phoenix-gaps.md`](../old/plans/vanilla-phoenix-gaps.md).

## M-T6.62 — A command-triggered `create` on a state-bearing workflow miscompiles on all five backends — `in-flight (#2850 + wave C1 1a)` · **M** · P0

*Renumbered 2026-09-10 from `M-T6.60`, which #2840 minted while the numeric-strictness mission above already held that id (two live headings, one id — M-T6.58's "blocked on M-T6.60" was ambiguous). This one is the P0 miscompile; M-T6.60 stays the strictness ruling.*

Found 2026-09-09 by the verification fleet ([F58](../audits/2026-09-03-language-docs-audit-findings.md)).
`workflow Fulfillment { orderId: Order id  status: string  create(orderId: Order id) { status := "Pending" } }`
parses `0 error(s), 0 warning(s)` and emits an **unbound receiver** everywhere: `this.status = "Pending"`
inside an arrow function on node (TS2683, confirmed with `tsc --strict`), `this.Status` on a .NET handler
with no such member, `this.setStatus(...)` on a Java class without it, `self._status` in a module-level
`async def` on python, and an unbound `state` in the Elixir `with`. The create also never loads or saves
the correlation row, so a later `on` reactor logs `event_unrouted` forever.

**Why it survived:** no fixture pairs a workflow `create(params)` with a `state {}` block.

**Blocks [M-T6.58](#m-t658).** Do not build workflow entry points on a create path that does not compile.

### LANDED

- **The receiver binding + correlation-row load/save on all five** — [#2850](https://github.com/Loom-Harness/Loc/pull/2850). The routing key is the create param that NAME-MATCHES the correlation field; the shared predicate is `commandCreateCorrelationParam`.
- **The second spelling of that rule** (wave C1 packet 1a): `create start(order: Order id) { orderId := order … }` — the create takes a differently-named param and ASSIGNS the correlation field from it. #2850's name-match-only rule left this on the unbound path, and it is the shape `test/generator/workflow-instance-gate.test.ts` drives **on all five backends**, so that whole matrix was asserting against output that does not compile. Verified on `d0b24a2`: node `this.orderId = order` in a module-scope arrow (TS2683); .NET `this.OrderId` on a handler with no such member; Java `this.setOrderId(...)`; Elixir `%{state | order_id: order}` with **both** `state` and `order` unbound; python `self = SimpleNamespace(...)` — the silent one, where the write landed in a request-scoped scratch, the saga row was never inserted, and `/workflows/<wf>/instances` answered empty forever. Accepted only when the assignment is a TOP-LEVEL statement whose RHS is a bare param ref (the row is loaded-or-allocated before the body runs, so the key must be certain and already in hand); a conditional or computed key is refused, not emitted unbound.
- **Two emitter bugs the second spelling exposed**, both fixed in the same packet: .NET emitted `var __key = command.<CorrelationField>` where the record member is the PARAM name (`FulfilmentCommand(OrderId Order)` → CS1061), and the Elixir `run/1` param-destructure collector (`collectWorkflowStmtParamRefs`) was a hand-rolled switch over 13 of the 14 `WorkflowStmtIR` kinds with **no `default`** — the missing arm was `assign`, so the param an assignment reads was never destructured and the emitted module named an undefined variable. Migrated onto `walkWorkflowStmtChildren`; its `ir-walk-census` waiver deleted with the fix.
- **The rule now lives once**, at `src/ir/util/workflow-own-state.ts`, because phase ⑦ must refuse exactly what phase ⑧ cannot address; `src/generator/_workflow/create-state.ts` is the generator-side re-export.
- **`loom.workflow-create-correlation-unsupplied`** (+ the `#payload` message variant) closes the give-up: a command create that supplies the key by neither spelling is refused instead of emitted unbound. The `#payload` variant is the form reported on #2850 — `create(c: FileClaim)`, where the key is a FIELD of a payload-typed param. Refused rather than followed one level down: the emitters would render `c.<corr>` against a param with no wire contract (`z.unknown()` — #2886 owns that half), so node still would not compile, and a spelling that works today exists. Revisit once #2886 lands.
- **Rule 13 fixture**: `test/fixtures/corpus/workflow-create-state.ddd` carries both spellings plus an `on(...)` reactor routing back onto the row the create persisted; registered on all five backends and in `E2E_LESS_CORPUS_FIXTURES`.

### REMAINING

- **An UNCORRELATED command workflow (state fields, no id-shaped field) is a five-way parity gap.** M-T6.50 (b) made python emit a request-scoped scratch (`self = SimpleNamespace(_total=0)`) for it, and #2850 fixed that scratch's indentation; node/.NET/Java still emit an unbound `this.<field>`, and Elixir's shape needs re-reading. Not refused — refusing would revoke a shipped emission — so this is emitter work to bring the other four onto python's semantics (or a ruling that the shape is a `scope` limit). Repro: `workflow Tally { total: int  create(base: int) { total := base } }`.
- **A command create whose body does NOT touch own state still allocates no row**, so an `on` reactor for the same key logs `event_unrouted` forever (the reactor path loads, it does not allocate). Deliberately ungated — refusing it would refuse a legitimately stateless command starter — and it is the half of F58's "never loads or saves" that a receiver-binding fix cannot reach.
- **The wire contract for a payload-typed create param** (`z.unknown()` / `TS18046`) is [#2886](https://github.com/Loom-Harness/Loc/pull/2886)'s.
- **An `eventSourced` workflow with state fields and no id-shaped field** is unexamined; the `apply(...)` fold path is `StmtIR`, not `WorkflowStmtIR`, and is out of this packet's scope.

## M-T6.61 — A `match` expression drops an `error` variant's binding on .NET and Java — `done` (2026-09-10, [#2857](https://github.com/Loom-Harness/Loc/pull/2857); re-verified 2026-09-11) · **M** · P0

Found 2026-09-09 by the verification fleet ([F59](../audits/2026-09-03-language-docs-audit-findings.md)),
as bycatch while resolving W3.1's gate-vs-lower fork. For a union carrying an `error` variant, the arm
collapses to `_ =>` (C#) / `case null ->` (Java) and the arm's bound name is left unresolved:

```csharp
Owner = r switch { Hit h => h.Code, _ => n.Resource, };            // `n` unbound
```
```java
this.owner = switch (r) { case null -> n.resource(); case Hit h -> h.code(); };  // `n` unbound
```

Node is correct, and two non-error variants are correct on all three — it is specifically the
error-variant arm. Sites: `src/generator/dotnet/render-expr.ts:324`, `src/generator/java/render-expr.ts:420`.

**Sequencing:** the W3.1 placement gate's message would tell users to switch to exactly this form. Either
this lands first, or that message must not recommend it on .NET and Java.

**Fixed by [#2857](https://github.com/Loom-Harness/Loc/pull/2857) (`f518e31`, 2026-09-10); re-verified 2026-09-11 by Wave C1 packet 1b BY GENERATING, before building anything on top of it.** Both leaves special-cased "exactly one non-error variant + at least one error variant" as a repository union find's OPTIONAL TWIN — an arity guess that also matches an ordinary `Hit | NotFound` DU, whose carriers do exist. The branch is gone on both. Repro (`payload Hit { code: string }` + `error NotFound { resource: string }`, a `Hit or NotFound` operation, `owner := match r { Hit h => h.code, NotFound n => n.resource }`) now emits the arm's binding on both backends:

```csharp
Owner = r switch { HitOrNotFound_Hit h => h.Code, HitOrNotFound_NotFound n => n.Resource, _ => throw … };
```
```java
this.owner = switch (r) { case HitOrNotFound_Hit h -> h.code(); case HitOrNotFound_NotFound n -> n.resource(); default -> null; };
```

and the genuine optional twin still takes the presence-ternary path before `matchVariant` is reached (`var label = outcome is not null ? outcome.Code : outcome.Resource;`). No rebuild; the sequencing constraint on M-T5.28's messages is therefore satisfied — and those two messages prescribe no replacement construct at all, so they stay correct either way. **One adjacent gap surfaced by the repro and NOT owned here:** on elixir the same source is refused by `loom.vanilla-op-call-position` (a sibling-op call outside `return` tail position) — an honest coded gap, already named, no silent decline.

## M-T6.69 — A field named `amount` beside a value object named `Amount` is refused on .NET only — `open` · **S–M** · P1 ⚠ verify-first

Found 2026-09-10 by the [independent completeness audit](../audits/2026-09-10-independent-completeness-audit.md) (F1),
which the deep fuzz leg produced unprompted — three of 400 seeds reduce to this one shape.

**The refusal.** An aggregate carrying both a field named `amount` and a field typed by a
value object named `Amount` raises `loom.dotnet-name-collision` and is accepted on the other
four backends. Reproduced from scratch:

```
valueobject Amount { scale: int }
aggregate Claim with crudish { amount: decimal  price: Amount }
deployable d { platform: dotnet … }   → 1 error   (loom.dotnet-name-collision)
deployable d { platform: java   … }   → OK
deployable d { platform: node   … }   → OK
```

A `Money`/`Amount` value object beside a scalar amount is the most canonical DDD shape there
is; `examples/acme.ddd` escapes only because its value object is named `Money`. The
diagnostic's own remedy is *"rename the declaration … or host this context on a node /
python / elixir / java deployable"* — i.e. move off .NET, which is a portability break dressed
as a naming rule.

**It is an emitter bug.** The generated C# references the type by *simple* name, so a
same-named member hides it (CS0119 / CS1061). Emitting the reference qualified — namespace
qualified, or through a `using` alias — removes the condition entirely.

**Fix, and delete the gate in the same PR.** A waiver that outlives its cause is the shape
this repo already ratchets against. Mutation-prove by restoring the collision and confirming
`dotnet build` fails without the fix and passes with it; add seed 45's shrunk model verbatim
to `test/fixtures/corpus/` so all five backends compile it from then on.

**Sequencing:** this closes the deep fuzz leg's only current failures, so it unblocks
[M-T9.64](T9-toolchain-health.md#m-t964). Relates to [M-T6.36](archive/T6-done.md#m-t636-java-emitter-shape-gaps--done-2026-09-13-wave-c2-packet-2d---m--p1)
(the same class on Java, DRAINED 2026-09-13: a mangled host identifier plus an
explicit `@JsonProperty` / `@RequestParam` / enum converter at every wire site —
the shape this row could follow if the C# collision ever needs emitting rather
than refusing) and to
[M-T9.59](T9-toolchain-health.md#m-t959), which explains why this one did not.
## M-T6.70 — The elixir Schemathesis cell fuzzes the HTML routes, because elixir is the only backend that publishes a `servers` base path — `open` · **S** · P1 ⚠ verify-first

Diagnosed 2026-09-11 while fixing E5 from the Wave C0 schemathesis hand-off
([`waves/handoffs/wave-c0-schemathesis.md`](waves/handoffs/wave-c0-schemathesis.md)), statically, on the
emitted `storefront-elixir` tree — the cell itself was not re-booted, so **verify by booting before acting**.

`src/generator/elixir/vanilla/openapi-emit.ts:827` emits `servers: [%Server{url: "/api"}]`, and the vanilla
router mounts the API under `scope "/api"`. It is the **only** backend that declares a `servers` entry —
node/python/dotnet/java publish none and serve at the root. The harness passes schemathesis
`--url http://127.0.0.1:<port>` (`test/behavioral/schemathesis-core.mjs:171`), which REPLACES the server
base, path included. So every fuzzed request loses the `/api` prefix and lands on the **LiveView/HTML**
scope (`live "/wallets"`, `live "/wallets/:id"`, then the `match :*, "/*path"` catch-all) — not on the
contract under test.

That one mismatch accounts for most of the cell's inventory: **E3** (undeclared success content-type —
LiveView answers `text/html`), **E4** (wrong-verb 405 — the catch-all answers 404), and it is how **E5**
(fixed in Wave C1, see below) was reachable over HTTP at all. **E1** (`TRACE` → 501) is below the app: the
web server refuses the method, so it is a waiver shape on any backend.

Two candidate fixes, and the choice is the mission: teach the harness to honour the spec's server base
(`--url <base><servers[0].url>`, one line, but it silently changes what every backend fuzzes), or make the
four other backends declare their own base so the axis is uniform. Until one lands, the elixir cell's
findings are not statements about the elixir API surface, and it must stay `discovery: true`.

## M-T6.71 — A non-UUID id in a Phoenix LiveView route raises `Ecto.Query.CastError` (500) where the controller answers 422 — `open` · **S** · P2 ⚠ verify-first

Diagnosed 2026-09-11 alongside M-T6.70, statically on the emitted tree (E2 of the elixir schemathesis cell).

The generated **controller** guards its path id — `plug :__cast_path_id` halts with the published 422
(`vanilla/find-controller.ts`). The generated **LiveView** detail page does not: `wallet_detail_live.ex`
calls `PhoenixApp.Storefront.get_wallet(socket.assigns.id)` straight through, so `Repo.get/2` raises
`Ecto.Query.CastError` for anything that is not a UUID and the visitor gets a 500 where the page's own
`:not_found` branch already exists for exactly this case.

Shape to fix: cast in the repository's `find_by_id` (one site, every caller) and return `{:error,
:not_found}`, or mirror the controller's plug in the LiveView `mount`. The first is cleaner but changes
what the CONTROLLER would answer if its plug ever stopped firing (422 vs 404) — decide deliberately, and
gate whichever you pick with a boot-verified request, not a compile.

## M-T6.73 — An explicit `route <METHOD> <PATH> -> <Ctx>.<Handler>` is mounted OUTSIDE `/api` on four of five backends, and python wraps its scalar return — `open` · **S–M** · P1

Measured 2026-09-22 by [#2984](https://github.com/Loom-Harness/Loc/pull/2984), which lifted routed
handlers onto the `test e2e` surface and then booted `corpus/handler-triad` across the behavioural tier
for the first time. **Not a verify-first mission** — every row below is a booted runtime observation from
the per-leg CI logs on head `dcd6d329`, re-derived statically from the emitted trees.

Until that lift, no `test e2e` body could ADDRESS a routed handler at all (`api.<x>.<y>(…)` resolved to an
aggregate, a projection or a workflow only), so **not one of these routes had ever been called on any
backend**. All five emit and all five compile; four serve nothing at the path the caller uses. That is the
silent-gap shape the behavioural tier exists to catch, and it stayed invisible because the only oracle that
could see it did not exist.

| leg | observed | emitted mounting |
|---|---|---|
| node, mikroorm | `POST /api/echo/hi` → `"hi"` (the wire-golden oracle) | under `API_BASE_PATH` |
| dotnet, dapper | `POST /api/echo/hi → 404 "no route for POST /api/echo/hi"` | `[HttpPost("/echo/{text}")]` — a leading slash makes an ASP.NET route ROOT-ABSOLUTE, so the `/api` prefix is ignored |
| java | same 404 | `@RestController` with **no class-level `@RequestMapping`** + `@PostMapping("/echo/{text}")` |
| elixir | same 404 | `router.ex` puts them in `scope "/"` while every aggregate route sits in `scope "/api", DWeb` |
| python | `expected {"result":"hi"} to be "hi"` | path is CORRECT (`include_router(a_router, prefix="/api")`); the divergence is the RESPONSE — it wraps a handler's scalar return in `{"result": …}` |

So there are **two** independent defects, and they want separate treatment:

1. **The prefix (dotnet/dapper, java, elixir).** Every other route class on these backends is mounted under
   `API_BASE_PATH`; the explicit-route emitter is the one that is not. The five emitters all exist —
   `src/generator/{dotnet,java,python,elixir/vanilla}/explicit-handlers-emit.ts` and hono's
   `src/platform/hono/v4/emit.ts` — so this is "emitted at the wrong prefix", **not** "not implemented".
   Fix is per-emitter and small: .NET drop the leading slash and carry the controller prefix, java add the
   class-level `@RequestMapping(API_BASE_PATH)`, elixir move the routes into the existing `scope "/api"`.
2. **The scalar envelope (python).** `{"result": "hi"}` where node answers the bare `"hi"`. This is a
   runtime-VALUE divergence a spec-vs-spec diff cannot see, so it reads as a **conformance-semantics RS-rule
   candidate** (`docs/conformance-semantics.md`) rather than a schema gap — the rule would pin "a routed
   handler returning a scalar answers that scalar, unwrapped". Whether to ratify node's shape or python's is
   an owner call, not a defect ruling; note that #2984's wire golden was recorded on node.

**This is a wire-contract change to a shipped feature** — anyone calling an explicit route on .NET, java or
elixir today is calling it at the root. Decide and record the canonical answer before moving the routes.

**Drain, in one PR:** make the five agree; restore the `test e2e` block #2984 wrote and reverted (it is in
that PR's history at commit `dcd6d329`, `test/fixtures/corpus/handler-triad.ddd`); delete the
`handler-triad` rows from `E2E_LESS_CORPUS_FIXTURES` (`test/ir/api-caller-census-pins.ts`) and
`BEHAVIOURAL_ABSENT` (`test/system/gate-ledger.test.ts`); lower the `BEHAVIOURAL_ABSENT` ratchet in
`test/platform/allowlist-ratchet.test.ts` by one **off whatever main's value is then**; pin the two
id-taking aggregate routes (`getOrderById`, `cancelOrder`) that the fixture's create-less `Order` genuinely
blocks; and re-record `test/behavioral/wire-golden/handler-triad.json`.

**Why #2984 did not narrow the drain to node instead.** `gate-ledger.test.ts` asserts, zero-tolerance and
with no allowlist, that *"a compile-only feature is compile-only on EVERY backend it declares — a split
would mean a per-backend `BEHAVIOURAL_SKIP` entry is doing the hiding, and the per-feature register above
would be the wrong shape to describe it"*, and `BEHAVIOURAL_SKIP` is itself ratcheted at `max: 0`. A
node-only boot is exactly that split. Both gates reject it, so the fixture stays compile-only on every leg
until this mission lands. Changing that invariant is a decision about the ledger's shape, not part of
either this mission or #2984.

## M-T6.72 — Move the .NET capability filters that cannot be model-hosted onto the per-read query — `open` · **L** · P3

Minted 2026-09-13 by wave C2 packet 2b as the named successor
[`D-TPH-SUBTYPE-FILTER`](../decisions.md#d-tph-subtype-filter--a-tph-subtypes-capability-filter-is-a-declared-v1-limit-on-the-ef-adapter-not-a-gap)
requires. It owns the `scope` row `loom.tph-filter-unsupported`.

**The limit.** EF Core registers every query filter in an inheritance hierarchy
on the ROOT entity type, so a `sharedTable` (TPH) SUBTYPE's capability `filter`
reading a column only that subtype declares is not registrable at all. Both
workarounds fail once the query source is a SIBLING subtype (measured on EF Core
10.0.10: a CLR downcast → "No coercion operator is defined between types 'Truck'
and 'Car'"; `EF.Property` → "the specified property does not exist on the entity
type"). `validateTphFilterExpressibility` refuses the model rather than dropping
the restriction silently, which is what the emitter used to do (`tph ? [] :`,
F2-CB-C2). Scoped to the EF adapter: Dapper splices the same predicate into raw
SQL against the shared table, where a subtype column is just a column.

**The build.** Emit the affected filters as a per-read LINQ `.Where(...)` on the
CONCRETE's `DbSet`, which is subtype-typed, instead of a model-level
`HasQueryFilter`.

**Why it is L and not S — the part to get right.** The predicate must reach
EVERY read of that aggregate, and a missed site is neither a compile error nor a
wrong-shaped answer: it is one read path returning rows a declared restriction
excludes. Measured on the emitter: `_db.${setName}` appears 19 times in
`src/generator/dotnet/emit/repository.ts`, and `find-emit.ts`,
`criteria-emit.ts`, `query-projection-emit.ts` and `spec-emit.ts` hold 11 more
`_db.` reads. The sites that must each be threaded: the by-id read, the bulk
by-ids load, the write-scope existence pre-guard, every declared find (a paged
one's COUNT query as well as its PAGE query), every retrieval, every criterion
Specification, every direct-table aggregation, and the polymorphic
`find all <Base>` reader — which must apply each concrete's own filter per
concrete rather than one predicate over the base.

**Scope discipline, from the decision.** Move only the filters that CANNOT be
model-hosted. A model filter is enforced by EF for every query against the
entity, including hand-written ones the customization gradient invites; a
per-read `.Where` is enforced only where the emitter put it. Migrating the whole
adapter would trade a framework-enforced guarantee for an emitter-enforced one
across the board to reach one subtype shape.

**Acceptance.** A booted .NET app on a real Postgres (not a compile) showing the
subtype filter applied on every read path and absent from none — the shape
`tenancy-hierarchy-dapper.test.ts` uses for the Dapper subtree predicate, whose
failure mode is identical. Delete the register row, drop `MAX_OPEN_GAPS` and
close this mission together.

Sources: [`decisions.md`](../decisions.md) D-TPH-SUBTYPE-FILTER;
`src/ir/validate/checks/storage-inheritance-checks.ts`,
`src/ir/util/inheritance.ts` (`nonRootFilterFields`),
`src/generator/dotnet/emit/efcore.ts`. Relates to
[M-T5.7](T5-language-core.md#m-t57) (the inheritance tail).
