# Wave C2 — packet 2m (elixir / Phoenix / HEEx, batch 3) — hand-off

**Branch** `claude/c2-elixir-3` · **base** `e0abfe2c1` (the batch-3 coordinator head, merged first
thing per the kickoff) · **fence** `src/generator/elixir/**`, plus the tests, corpus fixtures,
register / ledger / decision rows a closed row required.

Nothing is pushed and no PR was opened — the wave PR #2970 is the claim, per the kickoff.

**Session note.** The packet was killed by the Opus rate limit minutes after launch on 2026-09-20
and resumed 2026-09-21 05:25Z. The container restarted in between: `dockerd`, the `loom-pg-c2`
Postgres and every scratchpad toolchain were gone, and — the one that costs an hour if you miss it
— **the worktree had no `node_modules` at all**, so `npx tsc` and `npx vitest` hung silently
(they were trying to fetch through the proxy). `ln -s /home/user/Loc/node_modules node_modules`
fixes it; `.gitignore` already covers the link. Also note that in this sandbox **python and perl
in-place writes to repo files hang** (a file copy, `sed -i`, and the Write/Edit tools all work),
which is worth knowing before you write a patch script.

---

## 1. Rows → outcome

| row | outcome | where |
|---|---|---|
| ledger **`F2-MT640-SORT-DEAD`** (P1, the one open P1) | **IMPLEMENTED** — ledger row `open` → `done` | `heex-primitives.ts` `renderTable` · `liveview-emit.ts` `renderLoomTableModule` / `renderTableControlClauses` |
| ledger `G2646-open-heex-layout-inert` (P2) | **CLOSED** — pager arm IMPLEMENTED, `i18nFormat` arm RULED under **D-HEEX-I18N-FORMAT**; row → `done` | same, + `docs/decisions.md` |
| `loom.table-filter-unsupported` (M-T1.1) — the HEEx half packet **2k §5** handed over | **IMPLEMENTED** → row re-kinded `gap` → `seam` | `heex-primitives.ts` `renderTableFilterInput` · `ui-collection-display-checks.ts` |
| ledger `schemathesis-F11-int32-range` (P2) | **IMPLEMENTED** (both halves the ruling does not gate) — row → `done` | `vanilla/openapi-emit.ts` `INT32_SCHEMA` · `vanilla/context-emit.ts` `__loom_int32_param` · `vanilla/changeset-emit.ts` |
| `loom.elixir-if-stmt-unsupported` (M-T6.59) | **RE-CLASSED `scope`** under **D-ELIXIR-IF-BRANCH** | `unsupported-register.ts` · `docs/decisions.md` · `T6-backend-parity.md` |
| ledger `F2-W-06` (sub-second datetime) | **HAND-OFF, measured** — the wire-golden re-capture is NOT elixir-only (§5a) | — |
| `loom.heex-component-host-state-unsupported` (M-T1.27) | **NOT BUILT** — measured hand-off with the exact shape of the missing plumbing (§5b) | — |
| `loom.vanilla-document-unsupported` residue (M-T6.35) | **NOT BUILT** — and deliberately NOT re-classed; §5c says why a `scope` here would be dishonest | — |

**`MAX_OPEN_GAPS` is 17 and `LATENT_SEAMS` is 27 on the merged tree.** This packet moves two
(`table-filter` gap → seam, `elixir-if-stmt` gap → scope); packet **2k**, folded at `b475de6a1`
and merged in here, moved one more (`loom.frontend-prop-type-unsupported` gap → seam). 20 − 3 = 17
gaps, 25 + 2 = 27 seams. Both constants conflicted on the merge — expected, since both packets
edited the same two lines — and were resolved by keeping BOTH prose notes and summing.

---

## 2. What the table row actually did

`renderTable` had ONE mode. `sortKey:` / `sortDir:` / `page:` were read only when
`serverPaged: true`, and `filter:` was never read at all, so for a non-paged
`find all(): T[]` — a document / embedded / event-sourced aggregate's list, and every
hand-written `Table` over an array — Phoenix rendered an unsorted, unpaged, unfiltered table from
a `.ddd` that sorts, pages and filters on all six other frontends, with the scaffold's
`sort_key` / `sort_dir` / `page_num` mount assigns sitting dead. That is one defect the ledger
carried under three names (`F2-MT640-SORT-DEAD`, `G2646`'s pager arm, `loom.table-filter-unsupported`).

There are now two modes. **Server mode is byte-identical.** Client mode threads the bound rows
through a per-deployable helper module in the same order the shared walker applies them —
filter → sort → slice — with the pager counting the FILTERED set:

```heex
<.input type="search" name="q" value={@q} placeholder="Filter…"
        aria-label="Filter table" phx-change="update_q" data-testid="table-filter" />
<.table id="data-table" sort_key={@sort_key} sort_dir={@sort_dir}
  rows={PhoenixAppWeb.Components.LoomTable.page_rows(
          PhoenixAppWeb.Components.LoomTable.sort_rows(
            PhoenixAppWeb.Components.LoomTable.filter_rows(@items, @q),
            @sort_key, @sort_dir, [{"code", :code}, {"total", :total}]),
          @page_num, 10)}>
  …
</.table>
<.pager page={@page_num}
        total_pages={PhoenixAppWeb.Components.LoomTable.total_pages(@items, 10)} />
```

Three decisions inside that are worth carrying forward:

- **A MODULE, not per-page `defp`s** (`lib/<app>_web/components/loom_table.ex`, the `LoomChart`
  pattern — emitted only when a client control uses it). The same calls have to be callable from a
  page LiveView's `~H` *and* from the shared `UiComponents` module the day M-T1.27 lands.
- **The clauses are RELOAD-LESS in client mode** (`TableControlBinding.server`). Server mode's
  `handle_event` re-runs `list_<agg>s/4`; doing that in client mode calls the argument-less
  `list_<agg>s/0` and answers the identical rows — which is *exactly* how Phoenix came to ship
  clickable headers that flip an arrow and change nothing. This is the half the ledger row's own
  fix line got right and the reason the row was M-sized, not S.
- **No atom is ever built from client input.** `sort_rows/4` takes the emitter's
  `{wire key, struct field}` whitelist and `List.keyfind`s the clicked `phx-value-key` against it.
  `String.to_existing_atom/1` on an unauthenticated event payload would be an atom-table leak; the
  generated module contains neither `to_atom` spelling, and the test asserts their absence.

### The int32 row, in one line each

`%OpenApiSpex.Schema{type: :integer, format: :int32, minimum: …, maximum: …}` (was bare
`{type: :integer}`), `__loom_int32_param` in the op-param `with`-chain (a `long` keeps the
type-only `__loom_int_param` — its ceiling is `D-LONG-AVG-DEFAULTS`' 2^53, not int64), and
`validate_number(…)` on every cast `int` column. All three read `src/util/numeric-range.ts`.
**What still waits on the owner:** `D-NUMERIC-INGRESS-STRICT`, which governs TYPE lenience
(`{"qty":"5"}` as a string, a JSON number for `money`). Nothing here changes which types are
accepted — it changes a well-formed integer's answer from a 500 to a 422.

---

## 3. Mutation proofs (each names the failing assertion)

Every mutation was applied in place and reverted **by file copy**, never `git checkout --` (§84).

| fix | mutation | assertion that failed |
|---|---|---|
| client sort / page / filter | `const sortKey = serverPaged ? stateRefArg(…) : undefined` (the pre-fix gate) | `heex-table-client-controls.test.ts` › "sorts and slices the bound rows in the template", "passes a {wire key, struct field} whitelist…", "sorts every column the react target sorts…", "writes the assigns and does not refetch" — 4 of 14 |
| `sort_key(%DateTime{})` normalisation | reduced to the identity, regenerated, re-run ON THE BOOTED APP | the ExUnit proof's "sorting by a datetime column orders CHRONOLOGICALLY, not by struct layout" (§4) |
| `loom.table-filter-unsupported` reachability | drop `phoenixLiveView` from `TABLE_FILTER_FRAMEWORKS` | `diagnostic-firing-census.test.ts` › "the latent capability gates are still latent › loom.table-filter-unsupported" — the `covers-every-frontend` arm, which re-derives the roster from the GRAMMAR (`Framework returns string:`), plus `table-filter-and-controlled-modal.test.ts` › "REACHABILITY…" on the set equality |
| int32 op-param guard + column bound | not a seeded mutation: the pre-fix emitter IS the mutation, and the full suite ran on it | six suites pinned the unbounded output and went red on the change — `wire-numeric-ingress` (× 3 assertions), `numeric-ingress-parity`, `elixir-response-contract`, `provenanced-wire-parity`, `vanilla-extern`, `slice5a-operation-endpoints`, `slice5e-changeset-validators`. A gate that no existing pin noticed would have been the thing to worry about |

Tests that pinned the OLD behaviour were INVERTED in the same commit, named here so a reviewer does
not read them as regressions: `heex-table-controls.test.ts` › "a CLIENT-paged (non-`serverPaged`)
list …" (was "advertises no sort or pager", now "drives its controls WITHOUT a refetch"),
`table-filter-and-controlled-modal.test.ts` › "flags a `filter:` on HEEx…" (now "no longer fires
on HEEx"), and the three `wire-numeric-ingress.test.ts` / `numeric-ingress-parity.test.ts`
assertions that named `__loom_int_param` for an `int`.

### Two harness defects the mutation cycle found — both of the §59/§63 shape

Worth reading, because both made a check pass while never reaching the thing it named:

1. **The first money-sort assertion could not fail.** The seed used `Decimal.new("#{i}.50")` for
   every row — one scale — so Erlang term order on `%Decimal{}` (which compares `coef` before
   `exp`) agreed with value order and the assertion passed with the normalisation removed.
   Re-seeded with mixed scales… and it STILL passed, for a better reason: the column is
   `NUMERIC(19,4)`, so **every value Ecto loads back carries scale 4** and the two orders coincide
   for any fixed-scale column. So the `%Decimal{}` arm is DEFENSIVE (for a Decimal that never went
   through such a column), and the assertion says so in a comment rather than claiming a proof it
   does not make. The `%DateTime{}` arm — whose struct sorts `:day` before `:month` and `:year` —
   IS load-bearing, is discriminated by a 40-day row spread, and is what the mutation proof above
   uses.
2. **The row-extraction regex matched page chrome.** A bare `~r/C\d\d/` over the rendered document
   matched the per-render CSRF token about half the time (26 rows of 25, and `hd/1` could return a
   non-row), and the first anchored fix, `~r/>(C\d\d)</`, matched *nothing* because the emitted
   cell is `<p>\n  C25\n</p>`. Final form allows whitespace, and the codes were re-prefixed `X`
   because `C`, `0` and `7` are all hex digits and a row's UUID kept matching the filter query.

---

## 4. Boot proofs (rule 10 — framework-enforced behaviour on a booted app)

The generated `vanilla-table-client-controls` project, compiled and run inside
`hexpm/elixir:1.18.4` against the real `loom-pg-c2` Postgres (port 5433), with
`mix compile --warnings-as-errors` green and the migrations applied. The interactions are driven
through `Phoenix.LiveViewTest` — a real mount, real `render_click` / `render_change`, real Ecto
structs — **7 tests, 0 failures**:

1. the first page renders exactly 10 of the 25 seeded rows (the slice happens in a real render);
2. clicking a sortable header re-orders the rendered rows, and a second click flips the direction;
3. sorting by the money column orders by value (see the caveat in §3 — this one does not
   discriminate the Decimal arm, and says so);
4. **sorting by the datetime column orders chronologically** — the mutation proof above;
5. the pager walks 10 → 10 → 5 across the three windows;
6. typing in the filter box narrows to one row and a blank query restores all 25;
7. a filter over the MONEY column matches its rendered text (`text/1` is what makes a `%Decimal{}`
   searchable at all).

**Scratch-only adjustments to the generated app, none of which touch the code under test**
(recorded so the next agent can reproduce): `config/test.exs` repointed at :5433 with the default
pool (the emitted default is localhost:5432 + the Ecto sandbox), and `{:lazy_html, only: :test}`
added because `Phoenix.LiveViewTest` cannot parse HTML without it and the emitted app ships no test
tier. **`lazy_html` needs a C toolchain here**: its precompiled NIF download fails the proxy's TLS
check, so the container needs `apt-get install -y build-essential git ca-certificates cmake` and
`GIT_SSL_CAINFO=/root/.ccr/ca-bundle.crt` to build lexbor from source (~3 min, once).

`phoenix-ui-e2e` was NOT run: it requires `mix` on the HOST (`hasElixir()` gates on
`mix --version`), and this host has no BEAM outside docker. The ExUnit proof above drives the same
LiveView through the same mount/click path in-process, which is strictly more than the smoke spec
asserts (it only navigates each param-less route).

---

## 5. Hand-offs and the rows deliberately not built

### 5a. `F2-W-06` — sub-second datetime: the re-capture is NOT elixir-only

Packet 2a left this with a full recipe and two blockers. One of them has cleared (`#2904` is in),
so the question is only the second: **is the wire-golden re-capture elixir-only?** Measured: **no.**

`D-ABSENT-JOIN-DATETIME-WIRE` requires the differential tier's normalisation to narrow in the same
PR "or the fix cannot be seen". That normalisation is ONE regex shared by every backend's leg —
`test/_helpers/response-diff.ts:77`, `ISO_DT_RE`, whose own comment says it exists so that
"`…Z`, `…+00:00`, `.000Z`, no-fraction" all collapse to `<timestamp>`. Narrowing it makes the
goldens carry real precision, captured from node (the oracle) — and then python's six digits and
.NET/java's microseconds diverge from it too, on the same commit. That is the four-backend
coordinated moment the plan calls C5, not an elixir row.

**So the elixir half is ready to go and should travel with that moment**, with 2a's site list
unchanged (`vanilla/schema-emit.ts:199,331-332,359,466`, `audit-emit.ts:120`,
`provenance-emit.ts:143`, and the truncation machinery at `context-emit.ts:243,957-985`,
`operation-returns-emit.ts:302`, `stamp-emit.ts:74-123`, `audit-emit.ts:171`,
`provenance-emit.ts:191`, `dispatch-emit.ts:806`, `query-projections-emit.ts:348-351`).

### 5b. `loom.heex-component-host-state-unsupported` (M-T1.27) — measured, not built

2a deferred this on the `#2906` overlap. `#2906` has merged, so that reason is gone; what remains
is the size, and the measurement is worth more than another deferral note:

- The component walk ALREADY produces all four accumulators. `renderUiComponents`
  (`liveview-emit.ts:2093`) and the per-component walk at `:316` both call `walkBodyToHeex` and
  then **drop** `w.formBindings` / `w.queryBindings` / `w.uploadBindings` / `w.tableControls` —
  `ComponentActionInfo` carries only `actionBindings` / `usedComponents` / `usedStores` /
  `handlers` / `state` / `componentUses`. Adding the four fields and gathering them transitively
  (the `gatherActionBindings` / `gatherLiftedState` shape, `liveview-emit.ts:687-717`) is the
  mechanical half.
- The non-mechanical half is that **a HEEx function component cannot read a host assign**. It reads
  its OWN assigns, so every host-supplied value must be declared as an `attr` on the component
  (`renderUiComponents`' `attrLines`) and passed at the call site (`renderUserComponent`,
  `heex-walker-core.ts:978`) — which is exactly what `liftedStateAttrs` already does for component
  `state`. The set to thread is: `qb.assign` per query binding (`items` / `data`), the projection
  and history assign names, `form`, `<x>_options` per `idOptionsBindings`, and `uploads` (the
  LiveView built-in) for a `FileUpload`.
- **A latent correctness bug to fix in the same slice:** `renderTable`'s `stateRefArg` returns
  `snake(name)` and the markup emits `@#{name}` — NOT `hostStateAssign(ctx.stateOwner, name)`. So
  a Table inside a component would reference an un-namespaced assign even once the hoisting lands.
  `controlledInput` got this right (`#2906`); the table controls did not, because the gate meant
  the path was unreachable.
- **Multi-instance is the ruling this row needs, and it has a precedent.**
  `assertSingleInstancePerStatefulComponent` (`liveview-emit.ts:852`) already refuses two live
  instances of a component with `state`, for exactly this reason (one assign cannot serve two).
  Two instances of a component holding a QueryView is harmless (same rows, idempotent); two holding
  a CreateForm share one changeset, which is wrong. The cheap honest shape is: hoist, and extend
  that existing assertion to components carrying a FORM or an UPLOAD binding.

### 5c. `loom.vanilla-document-unsupported` residue — NOT re-classed, on purpose

The residue is a PROVENANCED op, a dereferenced cross-aggregate read, a VO/private/service/resource
call, and a REFERENCE collection (`X id[]`) on `shape: document`. A `scope` re-class would read as
"the document shape cannot express a join", which is *true of the blob* — but the gate is
`vanilla-` prefixed and fires only on elixir, and nothing in this packet measured whether the other
four backends refuse the same shapes on a document aggregate. Re-classing on the strength of a
plausible story, without that measurement, is precisely the "pin added without the read" this
repo's register header warns about. It stays an honest `gap` until someone runs the four-backend
comparison; that comparison is the work, and it is a `parity-auditor` job rather than an elixir one.

### 5d. Inherited from 2k: D-MODAL-CONTROLLED-OP-FORM's HEEx fork — measured, not built

Packet 2k ruled that `Modal { open: <stateBool>, OperationForm { … } }` is a supported shape whose
`open:` must be HONOURED, and handed the three "supported" targets' forks to their packets — HEEx's
to this one. Confirmed in the tree: `renderModal` (`heex-primitives.ts:152`) parses `open:` into
`openExpr` and, **when there is an `OperationForm` child, never reads it** — the modal is driven
purely by `show_modal("<id>")` from its own trigger. (Without a form child the state-controlled
branch at `:184` already honours it, which is why the register row excludes phoenixLiveView.)

Measured toward the fix, so the next agent starts from facts:

- **Both HEEx packs already declare the attr.** `designs/{coreComponents/v3,daisyui/v1}/core-components.heex.hbs`
  → `attr :show, :boolean, default: false` on `def modal`, so `show={@open}` needs no pack change.
- **But `show` alone is not enough**, and this is the part that makes it a slice rather than a
  one-liner: the component opens via `phx-mounted={@show && show_modal(@id)}`, and `phx-mounted`
  fires ONCE, at mount. A later `@open = true` would not open an already-mounted modal, so the
  element also has to be wrapped in `<%= if @open do %>` to re-mount — and once it is, the
  JS-driven trigger beside it clicks on an element that is not in the DOM.
- **So the real design question is the open/close PROTOCOL**, not the attribute: with `open:`
  bound, the trigger must WRITE the state (a hoisted `handle_event` like `controlledInput`'s
  `update_<field>`) and the component's `on_cancel` JS must CLEAR it, or the modal hides
  client-side while the assign stays true and the next open does nothing. That protocol is the
  same one Angular's `<opKey>Open` signal and Feliz's fork each need; it is worth ruling once
  across the three rather than inventing three.

### 5e. Outside the fence

- **`opHasProvSite` is target-neutral and shallow** (`src/ir/util/prov-id.ts:49`). It is one of the
  two reasons `#branch-statement` cannot be closed inside this fence — deepening it changes what
  node / .NET / java / python put in provenance-flush mode. Recorded in D-ELIXIR-IF-BRANCH.
- **`loom.function-block-no-return` does not descend into `if`** — 2a's §6b hand-off, re-checked
  here and still open (`src/language/validators/types.ts:906-957`). A one-file AST-validator fix
  that unlocks the shape on all five backends.

---

## 6. Decisions taken, and the one still wanted

| tag | what it rules | status |
|---|---|---|
| **D-ELIXIR-IF-BRANCH** | the four `if`-branch sub-shapes are a declared limit of the linear body renderer, owned by M-T6.59, not a drainable gap | proposed (48 h default) |
| **D-HEEX-I18N-FORMAT** | the `i18nFormat` wrapper drop is a permanent, documented LiveView divergence — (b) of the three options 2a listed | proposed (48 h default) |

**Still wanted from the owner:** `D-NUMERIC-INGRESS-STRICT` (§2) — it is owner-only and undecided,
and it is the reason the int32 row shipped its RANGE half only. The string-coercion narrowing
(`{"qty":"5"}`) and the JSON-number-for-`money` narrowing are still waiting on that signature.

---

## 7. Local gates

Run on the merged tree, after the last `git merge` (rule 14).

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | OK — 181 files, 469 errors, `src/` clean (one file and one error BELOW the base, which the ratchet allows) |
| `npm run lint` (`biome ci .`) | 0 errors, 26 warnings — all `noUnusedImports` / `useOptionalChain` on import blocks and expressions this packet did not touch (checked one by one against the base, including the single warning in a file it DID edit, `ui-collection-display-checks.ts:28`, which is the pre-existing `collection-op-site` import block) |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| elixir compile leg (official harness, `LOOM_PHOENIX_VANILLA_BUILD=1 LOOM_HEX_MIRROR=1`, one fixture per invocation) | **5 green**: `vanilla-table-client-controls` (new), plus the int32 blast radius — `vanilla-finds` (an `int` column → `validate_number`), `vanilla-provenance` (the carrier schema), `vanilla-document`, `vanilla-if-stmt`. The new fixture separately booted with its migrations and 7/7 LiveView proofs (§4) |
| `npm test` | **green on the merged tree — 2200 files (2111 passed, 89 skipped), 24 790 passed, 6 expected-fail, 0 failed.** The pre-merge run found **6 failures, all this packet's**, every one a pin on the old emitted output; they are fixed in their own commit and §3 records the two that were gates doing their job |
| behavioral elixir leg | **NOT RUNNABLE ON THIS HOST** — see below |

**The behavioral elixir leg needs a BEAM on the HOST.** `test/behavioral/run-elixir.mjs` spawns
`mix` directly (it is not a docker leg), and this box has no `mix` outside a container; Ubuntu
24.04's packaged elixir is 1.14, and the generated `mix.exs` requires `~> 1.16`, so installing it
does not help. The two routes for whoever has the budget: (a) a `mix` shim that `docker run`s
`hexpm/elixir` with the repo and `/tmp` bind-mounted **at identical paths** so the runner's absolute
`MIX_DEPS_PATH` / cwd resolve the same inside, or (b) `LOOM_BH_ELIXIR_BASE=<url>` against a
manually booted case. What WAS run instead is stronger per-case than the tier's api probe: a real
LiveView mount + `render_click` cycle against a real Postgres (§4).

**One environment finding that contradicts packet 2a's, recorded so the next agent does not
over-engineer around it.** 2a found the shared hex mirror dying after one or two fixtures and
switched to one fresh mirror per fixture. Here a SINGLE `scripts/hex-mirror.py` instance served
~12 consecutive `docker run`s (deps.get, repeated recompiles, the mutation cycles) with no
failure. Both observations are real; the mirror is worth retrying before assuming it must be
per-fixture.

---

## 8. Files touched

```
src/generator/elixir/heex-primitives.ts          (renderTable: two modes; renderTableFilterInput)
src/generator/elixir/heex-walker-core.ts         (tableHelpersUsed, TableControlBinding.server)
src/generator/elixir/liveview-emit.ts            (renderLoomTableModule; reload-less clauses)
src/generator/elixir/vanilla/openapi-emit.ts     (INT32_SCHEMA)
src/generator/elixir/vanilla/context-emit.ts     (__loom_int32_param, INT32_RANGE_MESSAGE)
src/generator/elixir/vanilla/changeset-emit.ts   (validate_number on every int column)
src/ir/validate/checks/ui-collection-display-checks.ts  (+phoenixLiveView)
src/diagnostics/unsupported-register.ts          (table-filter → seam; if-stmt → scope)
test/generator/_numeric/boundary-census.test.ts  (the sort-key waiver)
test/conformance/{numeric-ingress-parity,provenanced-wire-parity}.test.ts
test/generator/elixir/{elixir-response-contract,vanilla-extern}.test.ts
test/generator/elixir-vanilla/slice5{a,e}-*.test.ts
test/generator/elixir/heex-table-client-controls.test.ts   (new)
test/generator/elixir/heex-table-controls.test.ts          (inverted pin)
test/generator/elixir/wire-numeric-ingress.test.ts

test/ir/table-filter-and-controlled-modal.test.ts
test/system/diagnostic-firing-census.test.ts     (LATENT_GATES covers-every-frontend)
test/system/unsupported-register.test.ts         (MAX_OPEN_GAPS 17, LATENT_SEAMS 27)
test/e2e/fixtures/elixir-vanilla-build/vanilla-table-client-controls.ddd   (new)
docs/decisions.md                                (D-ELIXIR-IF-BRANCH, D-HEEX-I18N-FORMAT)
docs/new-plan/T1-ui-frontend.md                  (M-T1.1: the HEEx client leg)
docs/new-plan/T6-backend-parity.md               (M-T6.59: the re-class)
docs/audits/targets-completeness-2026-08-30.{json,md}
```
