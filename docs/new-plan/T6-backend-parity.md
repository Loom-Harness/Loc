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
Sources: [vanilla-phoenix-gaps](../old/plans/vanilla-phoenix-gaps.md) §11c/§12/§13/§14, [vanilla-document-route-a](../old/plans/vanilla-document-route-a.md).

## M-T6.3 — Phoenix output hygiene: `mix format` + Dialyzer gates — `deferred` (slice 1 landed) · **L (was M)** · P2
**Slice 1 landed** (`.formatter.exs` scoping): the generated `lib/<app>_web/api/**` OpenApiSpex layer (`<api>_spec.ex` spec module + request/response schema modules) is a machine-emitted nested-struct literal `mix format` reflows by width — **~73% of the whole format diff** on a broad project, never hand-edited — and is now excluded from the format gate via a computed `inputs` (rejects the `_web/api/` subtree, correct for any app name; `renderVanillaFormatterExs`, `shell-emit.ts`).

**Gate activation deferred** after a source-grounded scoping (2026-07-21, real `mix format` in the `hexpm/elixir` image, api_spec excluded):
- `mix format` is **deliberately non-configurable** — no per-rule toggles, no `# format: off` ignore comments/regions. The only dials are `line_length`, `locals_without_parens`, and which files are checked. So the "un-handy" rules (blank-line insertion, `case`-clause consistency, call-wrapping) **cannot be suppressed by config**.
- `line_length` is the one lever for the dominant width-driven wrapping, but it **plateaus**: on the `vanilla-workflows` fixture the churn falls 447→253 diff-lines (98→200) then flattens — an **irreducible ~250-line / 20-file structural residual** (blank lines + clause consistency + un-wrapping emitter pre-wraps) no config reaches. Pushing `line_length` past ~150 also just trades wrap-churn for collapse-churn and leaves 150-col lines.
- Closing the residual means teaching **~10 emitters** (controllers, context, changeset, telemetry, boilerplate, workflows) to replicate the formatter's width + blank-line + clause rules — an **L grind, and brittle**: every future Elixir-emitter edit can silently re-break the all-or-nothing gate, re-checkable only via the slow docker+hex-mirror `mix format` loop. Payoff is cosmetic — generated Elixir already compiles `mix compile --warnings-as-errors` clean.
- **Decision: defer the gate** (same disposition as M-T6.20 — L/risky for a narrow benefit). Reassess if a cheaper mechanism appears (e.g. a real ignore-comment lands in Elixir, or the emitters gain a shared format-aware line builder). Dialyzer/Credo remain future nightly-only.

Reusable tooling from the scoping: a real-formatter diff loop (`startHexMirror` → `generate system` → `mix format` with `import_deps` resolved → diff) makes the grind a measure-fix-remeasure cycle if picked up.
Sources: [vanilla-phoenix-gaps](../old/plans/vanilla-phoenix-gaps.md) §7, [static-analysis-followups](../old/proposals/static-analysis-followups.md) Slices 1–2.

## M-T6.11 — Reserved compose slots (was: `PlatformSurface` hooks, DEBT-27) — `blocked(T3/T4 features)` · — · P3
**Corrected 2026-08-14 — the five hooks this mission named do not exist.** `PlatformSurface` (`src/platform/surface.ts`) declares exactly one `emit*` method, `emitProject`; `emitAuthGate` / `emitCompliancePolicy` / `emitTenancyFilter` have zero occurrences anywhere in `src/`, and `emitAuditInit` / `emitI18nAdapter` survive only inside the doc comments of the slots below (a dangling reference worth scrubbing when someone next touches that file).
What is genuinely reserved-but-unwired is **three optional data slots on `ComposeServiceShape`**, undefined on every backend, which the compose orchestrator skips when absent: `auditSidecar` (a separate container draining audit-record events — M-T4.x audit), `policyInitCmd` (an entrypoint wrapper that loads/verifies compliance policies before the main service — M-T3.x authorization/compliance), and `i18nCatalogDir` (the in-container mount path for the i18n catalog — M-T1.11). Tenancy has no reservation at all: multi-tenant filtering ships through the capability/stance machinery ([`docs/tenancy.md`](../tenancy.md)), not a surface hook.
Disposition unchanged: don't build speculatively — each slot fills when its owning feature reaches emission. Tracked here so they aren't forgotten or cargo-culted.

## M-T6.13 — OpenAPI tag grouping — `blocked(D-MISC-C0)` (decision (f), item 3) · **S–M** · P3
Doc-level `x-tagGroups` per served `api` across the five backends (design audited + simulated; resolve decision (f) on .NET/Java per-op tags first).
Sources: [api-openapi-tag-grouping](../old/proposals/api-openapi-tag-grouping.md), ddd-review api-grouping gap.

## M-T6.14 — Small parity leftovers — `open` · **S** · P3
DEBT-12 Phoenix `verify_token` niche; DEBT-08 `envelope` carrier (deferred — no live use; signpost via M-T5.9a); saga/projection EF `HasColumnName` correlation-column bug (from S7 Slice C review); domain-seam log-catalog §3 residue ⚠ partly stale.

## M-T6.26 — `= default` / required-input parity across create & update paths — `partial` · **S** · P2
*(Renumbered from the placeholder "M-T6.x" and re-statused 2026-08-05 — `landed` isn't a legend status. Create-path parity is done (below, #2377); the update-path halves landed via #2392 ("a default never relaxes an update" — Elixir enforced less than promised, Java rejected what it advertised); the remaining residue is fixed and awaiting merge as PR #2440 — Elixir accepts a PUT that omits a required field (presence is a deserialization question there too), with retro §80 (PR #2415, also awaiting merge) as its documentation twin.)*

Surfaced 2026-08-01 by the `audited` corpus fixture in the behavioral tier, not
by anything audit-specific.

A field declared with a default — `status: int = 0` — is treated as **optional
create input** on node (`z.coerce.number().int().default(0)`, so `POST` without
it succeeds) but the Elixir changeset still `validate_required`s it, so the same
request 422s with `{"pointer":"/status","message":"can't be blank"}`.

Same `.ddd`, same create call, different contract — a wire-level divergence the
per-PR compile gates cannot see (both backends compile fine) and which the
wire-golden differential misses because the request never reaches a comparable
response. It took a behavioral run on the elixir leg to expose it.

**Expected:** `= default` means "the client may omit this; the server supplies
the value" on every backend. Fix is in the Elixir changeset emission — a
defaulted field must be dropped from the required set.

Check the other three backends (python/java/dotnet) before closing: only node
and elixir were observed here, so the split may be wider than 1-vs-1.

**Landed.** The split was **4-vs-1**, not 1-vs-1: python (`status: int = 0`),
java (`RequiredSet("CreateThingRequest", ["name"])`) and dotnet
(`int Status = 0`) already agreed with node. Elixir was the sole outlier —
`changeset-emit.ts` derived its required set from `!f.optional`, ignoring both
the explicit `= default` and the bare-`bool` implicit default, while the IR had
already reified the rule as `CreateInputFieldIR.requiredInput`. Fixed by
consuming it (`isRequiredCreateInput`, now exported alongside a new
`isRequiredUpdateInput` for the PATCH seam).

> **Correction (2026-08-03).** The CREATE half of this is sound and
> runtime-proven. The UPDATE half shipped defective and the sentence that used
> to stand here — "an explicit default stays required and only the bool
> relaxation applies" — described the intent, not the code: `isRequiredUpdateInput`
> tested `hasImplicitDefault` (a *create*-input predicate) first, so it returned
> `false` for **any** `bool`, explicit default or not. `active: bool = true` came
> back omittable and Elixir's changeset stopped enforcing a field its own
> OpenApiSpex schema still advertised. #2392 (landed) fixed the predicate to
> `!isNullable(f)` — only optionality relaxes an update, which is RS-26 (#2329) —
> and found a sibling Java create-seam defect on the way (`emit/dto.ts` re-derived
> omittability as `f.optional || f.default != null`, missing the bare `bool`).
> The docstring, this entry and #2377's PR description all stated the rule
> correctly while one line of code did not; see `experience_gathered.md` §80.
>
> **Residual, still open** (re-verified on `main` after #2392 landed). It makes
> the emitted artifacts agree, but the
> cross-backend divergence survives it: `@update_required` is not enforcement on
> the update seam. Ecto's `validate_required` resolves through `get_field`,
> which falls back to the loaded row, so an omitted key is invisible — verified
> against real Ecto (`omit active+flag against a stored row → valid?=true`).
> Nothing upstream compensates (router is `plug :accepts, ["json"]`, no
> `OpenApiSpex.Plug.CastAndValidate`; the controller passes raw params through).
> A `PUT` omitting the field still answers **204 on Elixir, 422 on the other
> four**. Fixed in PR #2440 (awaiting merge): `update_changeset/2` checks
> presence against the raw attrs before `cast`, roughly where the create path
> already coalesces defaults, using `validate_required/2`'s own error shape so
> `ProblemDetails` still renders 422 `{"pointer":"/<field>"}` unchanged.
> Coverage measured across the corpus: 55 of 56 changesets take the check; the
> document aggregate (separate `cast_embed` emitter) is flagged, not claimed.

Two findings worth keeping:

- **The reported repro under-stated the fix.** `status: int = 0` alone did NOT
  422: a *literal* default is also emitted as the Ecto schema `default:`, so
  `%Agg{}` already carried it and `validate_required` passed by accident. The
  shapes that actually failed were the ones no schema default covers — a bare
  `bool` and an **enum-valued** default (`renderEctoDefault` returns null for
  both). Dropping them from `validate_required` is only half the fix; the
  column is `null: false`, so the changeset now also applies the declared value
  via a `__default/3` step after `cast` (which additionally covers an explicit
  `null` in the body). Server-sourced defaults (`now()`/`currentUser.*`) keep
  their existing controller-side params coalesce.
- **Why every gate was blind.** Compile tier: both backends build. Wire-golden
  differential: the request 422s before producing a comparable response. And
  the OpenAPI parity gate too — Elixir's own *spec* emitter already used the
  correct rule (`wireCreateDefault`), so the disagreement was between Elixir's
  published contract and Elixir's runtime enforcement, which no spec-vs-spec
  diff can see. New gate `test/conformance/create-required-parity.test.ts`
  therefore asserts each backend's **enforcement** surface (changeset / DTO /
  validator) against the canonical `requiredInput` set — verified to fail on
  the pre-fix emitter. `test/fixtures/corpus/audited.ddd` now OMITS the
  defaulted field from its `test e2e` create call, making the behavioral legs
  the runtime half of the same gate.

Not addressed (noted, out of scope): the emitted `change_<create>/1` helper
derives its required set from the create action's *params*, which for a
`crudish` aggregate do not carry the field-level `default` — so it still
over-requires. It has no caller in generated code (every write path goes
through `base_changeset`); threading defaults onto crudish create params would
ripple through every param-driven surface on all five backends.

## M-T6.35 — Persistence-adapter capability gaps — `open`; the `#migrations` sub-code is `blocked(D-DAPPER-ALTER)` · **M** · P2
The non-default persistence adapters reject shapes their EF/Ecto siblings accept: `loom.dapper-unsupported` (features Dapper does not emit), `loom.find-predicate-unsupported` (a find predicate the active adapter cannot lower), `loom.saving-shape-unsupported` (a `shape(...)` the hosting backend cannot persist — **re-classified 2026-09-03**: dormant, not live — every platform key in `PLATFORM_SAVING_SHAPES` already lists all three shapes, and a platform absent from the map is skipped rather than flagged, so this is an unreachable backstop, not a seam any live target trips), `loom.vanilla-document-unsupported` (`shape: document` only partly emitted on Elixir), and — **inherited 2026-08-24 from the now-`done` M-T6.23** — `loom.mikroorm-unsupported`, whose only surviving raiser is the migration-chain one (`migration-checks.ts` `#migrations`: neither MikroORM's `orm.schema.updateSchema()` nor Dapper's boot-time `CREATE TABLE IF NOT EXISTS` can apply a declared migration step, so a rename resolves as DROP + ADD or silently never runs — the `loom.dapper-unsupported#migrations` twin is the same shape). The adapter axis is where "all targets support the whole surface" costs the most, because each adapter multiplies the matrix again — worth confirming per row whether the adapter *cannot* express the shape (a permanent limit, so a rename) or merely *does not yet* (a gap). **`loom.persistence-mode-unsupported` moved OFF this mission 2026-09-03** — it never fit here: `validateDataSourceCoverage` refuses a hosted aggregate whose deployable declares no matching `dataSource` at all, which is a missing binding, not an adapter capability limit. It is now owned by M-T2.9 (the storage-config tail, where the `dataSource`-binding axis already lives).
Sources: M-T9.27 register rows. Relates to M-T6.23 (mikroorm) and M-T6.25 (dapper query-time projections) — the same axis, already missioned.

## M-T6.36 — Java emitter shape gaps — `open` (rewritten 2026-08-31) · **M** · P1
**The two codes this mission was written about were PHANTOMS, and are gone.** `loom.java-projection-field-unsupported` and `loom.java-workflow-instance-field-unsupported` refused an ENTITY (containment-part) typed read-model field. Probing the premise before implementing showed there is nothing to implement: a part type resolves only inside its own aggregate (`src/language/ddd-scope.ts`), so `projection P { line: Line }` and `workflow W { line: Line }` both fail at phase ③ with `Could not resolve reference to NamedDecl named 'Line'` — on EVERY platform, before any java check runs. Two backend-named codes for a shape the LANGUAGE refuses: java read as uniquely limited, and the M-T9.27 register carried two rows nothing could ever drain. Both codes, their register rows, their catalogue entries and their census entries were deleted; the emitters keep their `guardInstanceField` / `guardProjectionField` throws as internal invariants, and `test/generator/java/generator-java-readmodel-gates.test.ts` now pins the unreachability AT THE SCOPE LAYER, so a widening of that rule fails a test instead of crashing codegen. `MAX_OPEN_GAPS` came down accordingly. (The VO-typed half of the original gap was already implemented by M-T6.4.)

**What the mission now owns** is the one REAL java shape gap, inherited from F2-ADP-7's java arm: `loom.java-reserved-identifier-unsupported`. A `.ddd` field / param / operation named after a **Java reserved word** (`case`, `do`, `new`, `int`, …) used to emit `String case;` / `public String case() {` / `record TicketResponse(String case, …)` — uncompilable Java, with zero diagnostics, so the failure surfaced only in a compile tier. It is now refused (java-hosted contexts only; the other four backends are untouched).

Draining it means EMITTING the name instead of refusing it, and the reason that is real work rather than a one-line escape is the language asymmetry the .NET arm hides: C# has verbatim identifiers, so `@case` is lexically `case` and the JSON property System.Text.Json derives is unchanged. Java has none (JLS §3.9), so the only escape is a rename — and a Java record component name IS the Jackson property name. So the fix is a mangled host identifier (`case_`, the spelling `escapeJavaIdent` already uses for LOCALS) **plus an explicit `@JsonProperty("case")` at every wire site**, applied consistently enough that no DTO is missed — a missed site is a silent wire divergence on java alone, which is strictly worse than the compile error. Delete the register row and lower `MAX_OPEN_GAPS` when it lands.
Sources: M-T9.27 register rows; the 2026-08-30 targets ledger rows `M-T6.36` (premise found stale) and `F2-ADP-7` (java arm).

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

*(Recorded 2026-09-10 from the M-T6.48 matrix session. The wave plan's §5 ruling #4 currently bundles all three as one owner-only item — see the note on [#2849](https://github.com/lemmit/Loc/pull/2849).)*

**The fix, once ruled.** Strict: `model_config = ConfigDict(strict=True)` on python request models (or per-field `Strict()`, which is narrower and does not disturb datetime parsing), and a pre-cast wire-type guard on elixir's changeset path — the natural home is a `__loom_money_field` / `__loom_int_field` validation running before `cast/3`, reusing the `__loom_param_error` responder the op-param arm already emits. (Divergence 3's half of this paragraph is done — see its block above.)

**Verification when it lands.** Delete the matching pin in `numeric-ingress-parity.test.ts` and replace it with a positive seam in the same file — the pin and the seam are the same assertion inverted, so the diff shows the contract moving. Re-run the deserializer measurements (the header table is the record and must be updated with the new row, not left stale). Mutation-prove each backend arm by file-copy revert per the repo rule.

Sources: [numeric-types-audit-2026-08-23](../audits/numeric-types-audit-2026-08-23.md) F12 annex (the stringified-number skew was noted there but never dispositioned); M-T6.48 and its matrix. Relates to RS-12 (money wire scale, response direction) and RS-24 (decimal is a JSON number).

## M-T6.50 — Python saga / workflow emission holes: three collector gaps that ship `F821` into the generated app — `partial` (sites 1 + 3 landed by [#2752](https://github.com/lemmit/Loc/pull/2752), verified 2026-09-11; **site 2 is the only live half**, claimed by [#2850](https://github.com/lemmit/Loc/pull/2850) + wave-c1 packet 1a) · **S–M** · P1

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
## M-T6.57 — `envelope` means something different on each of the five backends — scope it before fixing it — `blocked(D-ENVELOPE-RATIFY)` · **S** · P0 ⚠ verify-first

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
## M-T6.58 — `handle` and named `create` are lowered, test-pinned and promised by a diagnostic — but no backend emits an entry point — `blocked(D-HANDLE-REMOVAL)` · **L** · P1 ⚠ verify-first, route to `language-feature-developer`

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
## M-T6.59 — Phoenix cannot render the `if` statement: an assigning branch would compile and do nothing — `open` · **M** · P2

Raised 2026-09-03 by the M-FT.11 field-test slice, which added the `if <cond> { … } else { … }` statement to operation bodies. It renders on node / dotnet / java / python through the shared `_stmt/target.ts` spine; elixir is refused up front by `loom.elixir-if-stmt-unsupported` (`src/ir/validate/checks/if-stmt-checks.ts`) rather than half-rendered.

**Why it was gated, not written.** Every Phoenix body renderer threads its result through a REBOUND `record` (Elixir is immutable, so `field := v` is `record = %{record | field: v}`), and a binding made inside an `if` block does not escape the block. The naive rendering compiles clean under `--warnings-as-errors` and then silently does nothing — the exact silent-drop class the repo's gates exist to prevent.

**The shape that works** is a value-producing branch — `record = if <cond> do <stmts>; record else record end` — applied in EVERY vanilla body renderer that owns a `record` (`vanilla/operation-returns-emit.ts`, `vanilla/context-emit.ts`, `vanilla/eventsourced-emit.ts`, `vanilla/function-emit.ts`, `domain-service-emit.ts`), each of which has its own indent and variable conventions. A `return` inside a branch is the sub-case that does NOT fit it (the returning-op path emits `{:ok, …}` tuples as the body's tail expression) and needs either a `with`-chain rendering or a narrower gate of its own.

**Verification when it lands.** A `render-stmt`-level test per touched renderer, an elixir compile leg (`mix compile --warnings-as-errors`) over a model whose `if` branch ASSIGNS, and a behavioural check that the assignment is observable after the call — a compile-only gate cannot see this bug. Delete the `loom.elixir-if-stmt-unsupported` row from `src/diagnostics/unsupported-register.ts` and its arm in `if-stmt-checks.ts` in the same PR, and lower the gap pin.

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

## M-T6.69 — The elixir Schemathesis cell fuzzes the HTML routes, because elixir is the only backend that publishes a `servers` base path — `open` · **S** · P1 ⚠ verify-first

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

## M-T6.70 — A non-UUID id in a Phoenix LiveView route raises `Ecto.Query.CastError` (500) where the controller answers 422 — `open` · **S** · P2 ⚠ verify-first

Diagnosed 2026-09-11 alongside M-T6.69, statically on the emitted tree (E2 of the elixir schemathesis cell).

The generated **controller** guards its path id — `plug :__cast_path_id` halts with the published 422
(`vanilla/find-controller.ts`). The generated **LiveView** detail page does not: `wallet_detail_live.ex`
calls `PhoenixApp.Storefront.get_wallet(socket.assigns.id)` straight through, so `Repo.get/2` raises
`Ecto.Query.CastError` for anything that is not a UUID and the visitor gets a 500 where the page's own
`:not_found` branch already exists for exactly this case.

Shape to fix: cast in the repository's `find_by_id` (one site, every caller) and return `{:error,
:not_found}`, or mirror the controller's plug in the LiveView `mount`. The first is cleaner but changes
what the CONTROLLER would answer if its plug ever stopped firing (422 vs 404) — decide deliberately, and
gate whichever you pick with a boot-verified request, not a compile.
