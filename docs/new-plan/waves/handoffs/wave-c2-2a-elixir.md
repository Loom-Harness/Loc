# Wave C2 — packet 2a (elixir / Phoenix / HEEx) — hand-off

**Branch** `claude/c2-elixir` · **range** `29db198c1..e3b379d01` (9 packet commits + one `origin/main` merge)
· **fence** `src/generator/elixir/**` (+ the tests, corpus fixtures, register/mission/ledger rows a
closed row requires) · **base** the wave C2 coordinator commit, re-merged with `origin/main`
`7534696f9` before the final gate run.

Nothing is pushed and no PR was opened — the wave PR is the claim, per the kickoff.

---

## 1. Rows → outcome

| row | outcome | where |
|---|---|---|
| **M-T6.59** the `if` statement | **implemented**, gate NARROWED to four `#slug` sub-shapes | `src/generator/elixir/vanilla/if-stmt-emit.ts` (new) · `if-stmt-checks.ts:78` (`elixirIfRefusal`) · `operation-returns-emit.ts:1371` · `function-emit.ts` · `domain-service-emit.ts:545` · `eventsourced-emit.ts:820` |
| **ledger `static-subpath-405`** elixir arm | **implemented** — ledger row moved `open → done` | `vanilla/shell-emit.ts` (`withStaticSubpathGuards`) |
| **M-T6.56 F60** derived-reads-derived wire | **implemented**, gated on `required:` ≡ `serialize/1` | `vanilla/wire-serialize.ts:91` |
| **M-T6.56 F22** positional `Image` / builtin `Icon` | **implemented** | `heex-primitives.ts` `renderImage` / `renderIcon` |
| **M-T6.56 F61** HEEx `WorkflowForm` (own commit) | **implemented** — field set **and** `handle_event` | `heex-primitives.ts` `renderWorkflowForm` · `heex-walker-core.ts` (`workflowsByName`) · `liveview-emit.ts` (`renderWorkflowEventClauses`) |
| **`vanilla-document-unsupported` residual** | **partially drained** — the DERIVED-read clause only | `datasource-checks.ts:316` |
| **M-T6.2 §13 / §14** | **verified already drained**; mission corrected | docs only |
| **M-T6.26** update-seam presence | **verified landed** (#2440 merged); mission `done`, archived | docs only |
| **M-T6.14 DEBT-12** `verify_token` | **verified STALE**; item closed | docs only |
| **M-T6.3** `mix format` / Dialyzer gates | **DECIDED** — `D-PHOENIX-FORMAT-GATE`; mission `done`, archived | `docs/decisions.md` |
| **F2-W-06** sub-second datetime | **HAND-OFF** (§6a) | — |
| **G2646** HEEx pager / `i18nFormat` | **not attempted** — #2906 overlap (§5) | — |
| **`table-filter-unsupported`** (M-T1.1) | **not attempted** — #2906 overlap (§5) | — |
| **`heex-component-host-state-unsupported`** (M-T1.27) | **not attempted** — #2906 overlap (§5) | — |

`MAX_OPEN_GAPS` is **unchanged**: no register row drained to zero. Two rows NARROWED in place
(`elixir-if-stmt-unsupported`, `vanilla-document-unsupported`) and both `what` texts were rewritten
to say exactly what survives — a narrowed row that still reads like the old one is the failure mode
the register exists to prevent.

---

## 2. What each row actually did

### M-T6.59 — the `if` statement renders; the gate narrows to four sub-shapes

Elixir is immutable, so every Phoenix body threads a REBOUND `record` and a binding made inside an
`if` block does not escape it. `renderElixirIfStmt` emits the value-producing shape —
`record = if cond do … record else … record end` — with the `else` arm **synthesised** when the
source has none, because an `else`-less Elixir `if` answers `nil` and would null the threaded
record.

**The half a compile gate cannot see.** Every "does this body write a column / mutate a containment
/ touch a ref collection" probe scanned `op.statements` ONE LEVEL DEEP. With the branch rendering
correctly the persist tail still emitted `change(%{})` with no `force_change`, so the branch
computed the new struct and `Repo.update` wrote nothing. `opBodyStmtsDeep`
(`src/generator/elixir/domain/predicates.ts`, riding `walkStmtsDeep`) now feeds `persistPutBodies`,
`opMutatesState`, `mutatesRefColl`, `contextMutatesRefColl`, `contextUsesRefCollOp`,
`contextMutatesRelationalContainment` and `mutatesEmbeddedContainment`. `function-emit.ts`'s
hand-rolled `bodyExprs` switch (five kinds, no `if` arm) moved onto `walkStmtExprsDeep` for the same
class of reason: a param read only inside a branch was invisible, so the clause head underscored it.

**Refused sub-shapes**, each with its own message:

- `#return-in-branch` — an EARLY EXIT. Expressing it means restructuring the statements that FOLLOW
  the `if` into a `case` arm: a list-level transform, not a statement-level one, and one that breaks
  the same-length/same-order `statementSubRegions` zip the sourcemap collector depends on. It IS
  allowed in a **tail-value** body (a `domainService` operation, a pure `function`), where every
  `return` is already the block's own value — `elixirIfRefusal(stmts, "value")` admits it via
  `returnsAreTailOnly`.
- `#guard-in-branch` — the op path HOISTS top-level `requires`/`precondition` into a leading
  `with :ok <- ensure(…)` chain that answers 403/422; a nested one cannot be hoisted and would
  `raise` → 500, a wire divergence from the other four backends that is worse than the refusal.
- `#event-sourced` — an ES command body is sorted into `with`-clauses / `let`s / one
  `events = […]` list, never rendered as a statement sequence, so a conditional `emit` has nowhere
  to go. `eventsourced-emit.ts` grew a throwing arm; its `default: break` would have dropped the
  branch silently.
- `#branch-statement` — a **closed** branch vocabulary (`BRANCH_VOCABULARY`), not a list of
  known-bad shapes. The value-producing rendering is not the only thing a branch statement needs:
  the emitters decide an operation's SUPPORTING machinery by scanning `op.statements`, and several
  of those scans are one level deep by design. `emit` is the sharp case — it renders fine,
  `contextEmitsEvent` does not see it, so the host module carries no `require Logger` (a compile
  error), and the S5a persist-then-dispatch restructure cannot hoist a CONDITIONAL emit past the
  commit anyway, so a phantom event would fire on a failed write. A PROVENANCED write is the same
  shape one layer up (`opHasProvSite`, `src/ir/util/prov-id.ts:49`, scans top-level statements
  only). Fail-closed, so a NEW `StmtIR` kind is refused in a branch rather than silently admitted.
  **This was found by auditing the emitters' own shallow scans AFTER the `if` renderer landed** —
  the deep-walk fixes (`opBodyStmtsDeep`) covered the write-detection scans; this is the set they
  do not cover because the answer is not "walk deeper", it is "this cannot be conditional".

The projection-fold arm the old gate carried was **dead**: `loom.projection-fold-impure` already
refuses an `if` in a fold on every backend. Deleted.

### `static-subpath-405` — the last arm

`match :*, "<static sub-path>", NotFoundController, :not_found`, spliced in right after the LAST
real route for each one-segment static sub-path inside `scope "/api"`. Real routes still win for
the verbs they serve (phoenix matches in declaration order); every other verb lands on the
controller that already derives `Allow` from `Phoenix.Router.route_info/4` — so the header comes
from the ROUTER, not from a second copy of the route table that could drift, and that action's
existing "exclude my own routes from the probe" rule is exactly what stops the guard routes
reporting themselves as allowed. The guarded set is read off the routes the router actually
mounts, so a backend-specific static route is covered by construction.

### M-T6.56 F60 / F22 / F61

See §3 for proofs. One structural note worth carrying forward: **F60 and the M-T6.35 drain are the
same defect twice.** In both places a PREDICATE refused a `this-derived` read while the RENDERER had
been inlining it all along (`render-expr.ts:446`, #1765). The emitter was never the blocker. If a
third predicate over `ExprIR` turns up that special-cases `this-derived`, check the renderer first.

### The document residue

Only the DERIVED-read clause drained, for exactly the reason above. The rest — a PROVENANCED op, a
dereferenced cross-aggregate read, a VO/private/service/resource call, a REFERENCE collection — is
untouched and still honestly gated; the register row was rewritten to say so rather than left
claiming the whole residue.

---

## 3. Mutation proofs (each names the failing assertion)

Every mutation was applied by **file copy** and reverted by file copy — never `git checkout --`
(§84).

| fix | mutation | assertion that failed |
|---|---|---|
| value-producing `if` | drop the trailing thread-var line in `renderElixirIfStmt`'s `arm` | `if-stmt-emit.test.ts` › "renders a value-producing `if` that REBINDS the threaded record" + "synthesises the `else` arm…" |
| deep persist walk | `persistPutBodies` back to `op.statements` | `if-stmt-emit.test.ts` › "persists the columns a BRANCH assigned — the half a compile gate cannot see" (+ 2 more) |
| static sub-path guard | `withStaticSubpathGuards` → pass-through | `static-subpath-method-guard.test.ts` › "guards EVERY one-segment static sub-path the router mounts" + "places each guard AFTER its real routes and BEFORE the `:id` route" |
| F60 | force the `this-derived` arm back to `false` | `derived-wire-contract.test.ts` › "sweeps every aggregate response schema in the project" + "projects a derived that READS another derived…" |
| F22 `Image` | drop the positional fallback (`const src = srcArg`) | `heex-image-icon-positional.test.ts` › "renders the first positional as `src`, like every other target" |
| F22 `Icon` | replace `lookupBuiltinIcon(name)` with `""` | same file › "renders the builtin glyph for a `name:`…" + "gives up LOUDLY on a name the registry does not resolve" |
| F61 handler | remove the `renderWorkflowEventClauses` call | `heex-workflow-form.test.ts` › 5 cases, incl. "emits a `handle_event` clause matching the form's own `phx-submit`" |
| F61 fields | disable the `runsWorkflow` branch | same file › "emits one typed `<.input>` per workflow param, not a `_placeholder`" + the testid case |
| closed branch vocabulary | delete the `outOfVocabulary` return in `elixirIfRefusal` | `if-stmt-emit.test.ts` › "refuses an `emit` inside a branch (#branch-statement — the CLOSED vocabulary)" |
| doc derived | recursion → bare `return false` | `saving-shape-support.test.ts` › "still refuses a document op reading a derived whose OWN body is unsupported" |

Two tests that were pinning the DEFECT are inverted in the same commits, named so a reviewer does
not read them as regressions: `vanilla-wire-derived.test.ts` › "skips a derived-of-derived" and
`saving-shape-support.test.ts` › "still rejects a DERIVED read in a document operation body".

---

## 4. Boot proofs (rule 10 — framework-enforced behaviour on a booted app)

All four ran a generated project inside `hexpm/elixir:1.18.4` on a real Postgres container
(`mix deps.get && mix ecto.create && mix ecto.migrate && mix phx.server`), behind the hex mirror.

1. **M-T6.59** — `POST /api/tasks/:id/grade {"bonus":9}` on `score: 5` reads back
   `{"score":14,"tier":"gold"}`: the branch's assignments **persisted**, which is the half
   `mix compile` is structurally blind to. A second op with an `else`-less `if`, taken then untaken,
   leaves `attempts: 3` — the synthesised arm did not null the record.
2. **`static-subpath-405`** — `DELETE /api/articles/by_owner` answered **405** with `allow: GET`
   under `application/problem+json` (it answered the `:id` cast's 422 before); `POST` likewise;
   `GET /api/articles/by_owner` still 200; `DELETE /api/articles/<uuid>` still 204 and
   `DELETE /api/articles/not-a-uuid` still 422, so the `:id` route is unshadowed.
3. **F60** — `GET /api/orders/:id` and the paged list both answer
   `{"subtotal":15,"withTax":30,"label":"n=30",…}`; no `KeyError`.
4. **F61** — `handle_event/3` is exported (it did not exist); a submit of **all-string** params runs
   the workflow inside its transaction and Ecto writes `qty=3` (integer),
   `total=Decimal.new("9.99")`, `rush=true` — so the coercion and the `unit_total` → `unitTotal`
   rekey are proved by the DATABASE, not by the emitter. The param-less workflow's clause works too.

The F61 proof calls the emitted clause directly rather than driving a browser, because
`phoenix-ui-e2e` is in neither the per-PR set nor the merge queue — the reason the plan split F61
into its own commit in the first place.

---

## 5. Open-PR overlaps — rows deliberately NOT attempted

`#2906` (+ `#2870`) rewires the exact machinery three of this packet's rows would touch: the
`QueryView` / projection / history load bindings and their new `guard`, `controlledInput`'s
snake-casing fix, `renderMatch`'s `loadGuard`, and `liveview-emit.ts`'s `renderLoadBlocks` /
`withQueryReload` split. Three rows were left for the coordinator to re-dispatch AFTER that lands,
because building them now means composing two rewrites of the same functions at fold time:

- **`loom.table-filter-unsupported` (M-T1.1)** — `filter:` on HEEx `renderTable` needs a bound
  input plus a reload of the read that depends on it. That IS `#2906`'s machinery
  (`controlledInput` + `withQueryReload` + `readDependsOnState`); after it lands the row is
  plausibly a small `renderTable` arm rather than a feature.
- **`loom.heex-component-host-state-unsupported` (M-T1.27)** — hoisting `formBindings` /
  `queryBindings` / `uploadBindings` / `tableControls` out of a `component` into the host LiveView
  touches the same accumulators `#2906` gives a `guard` field to.
- **`G2646` pager arm** — the client pager for a non-server-paged `Table` lands in
  `renderTableControlClauses` / the table-control assigns, beside `#2906`'s reload clauses.

`G2646`'s **`i18nFormat` arm** is separable and was left as-is deliberately: the drop is already
documented at the emission site (`heex-walker-core.ts`, the `i18nFormat` arm — LiveView has no
client-side i18n runtime), and honouring it means adding a CLDR-shaped number/date formatter to the
generated app, which is a feature with a dependency decision in it, not a gap fix. It also does not
belong in `heex-parity.test.ts`, whose freeze list is over walker PRIMITIVES, not `ExprIR` kinds —
so "pin it in the parity freeze" as the ledger row suggests is not actually available. **Owner
decision wanted** (§7).

Rows on files these PRs touch that WERE built kept their hunks minimal and away from the PRs' own:
F22 edits `renderImage` (:1541) and `renderIcon` (:2205) only; F61 adds `renderWorkflowEventClauses`
as a new function plus a one-line call and a one-line mount change. `#2852` (document /
eventsourced / repository-emit, find-controller), `#2900` (auth-emit), `#2895`/`#2904`
(migrations-emit), `#2886` (openapi-emit) and `#2903` (query-projections-emit) were not touched at
all.

---

## 6. Hand-offs

### 6a. `F2-W-06` — sub-second datetime precision (IN fence, deliberately not built)

The decision already exists and is unambiguous: **`D-ABSENT-JOIN-DATETIME-WIRE`** says elixir moves
declared datetime columns to `:utc_datetime_usec` with the matching `timestamptz` column **and
deletes the truncation machinery that exists only because of the old type**, with the wire at
millisecond precision (at most three fractional digits, RS-4's whole-second `…00Z` preserved) and
sub-millisecond input truncated at ingress.

It was not built here for two specific reasons, not for size:

1. **The `<timestamp>` normalisation narrowing and the wire goldens are cross-packet artifacts.**
   The D-tag's own consequence paragraph requires narrowing the differential tier's normalisation
   "in the same PR, or the fix cannot be seen", and moving elixir's serialised precision re-captures
   wire goldens that 2c (node's minimal-digit trim) and 2e (python's six digits) also have to move.
   A packet-local re-capture would be overwritten by theirs.
2. **`migrations-emit.ts` is in flight on `#2904`** (the `addCheck`/`dropCheck` arm + the
   empty-generation guard), and the column-type change lands in the same file.

**Recipe for whoever takes it** (measured on this head): the type sites are
`vanilla/schema-emit.ts:199` (`timestamps(type: :utc_datetime)`), `:331-332` (audit columns),
`:359`, `:466` (`mapTypeToEcto`), `vanilla/audit-emit.ts:120`, `vanilla/provenance-emit.ts:143`.
The truncation machinery that must go with it: `context-emit.ts:243` (op-param ISO cast),
`:957-985` (`__truncate_dt/1` + its two emission predicates at `:795`/`:800`),
`operation-returns-emit.ts:302` (the `force_change` wrap), `stamp-emit.ts:74-123`
(`stampFieldIsDatetime`), `audit-emit.ts:171`, `provenance-emit.ts:191`, `dispatch-emit.ts:806`,
`query-projections-emit.ts:348-351` (`group_key_utc` — check whether second-bucketing is DELIBERATE
there before deleting). Leaving any of them in place truncates on the wider column and half-fixes
the row, which is the trap #2734 named.

### 6b. Outside the fence — `loom.function-block-no-return` does not descend into `if`

`src/language/validators/types.ts:906-957` walks `fn.block` ONE LEVEL DEEP, so a pure aggregate
`function` whose only `return`s sit inside an `if` is refused at phase ④ on **every** backend:

```ddd
function tierOf(points: int): string {
  if points > 10 { return "gold" } else { return "bronze" }
}
```
→ `Block-body function 'tierOf' must 'return' a value of type 'string'.`

The identical tail-return shape in a `domainService` operation validates and renders. Not an elixir
row — the elixir renderer already handles it (`elixirIfRefusal(…, "value")` admits it and
`renderPureBlock` emits it), which is why the code is there and the fixture is not. A one-file fix
in the AST validator unlocks it on all five backends.

### 6c. In-fence residue this packet pinned rather than closed

A `derived` whose chain bottoms out on an aggregate **`function` call** keeps F60's exact
self-contradicting contract — the schema still declares the field `required:` while `serialize/1`
skips it — by a different mechanism: `function-emit.ts` puts `def twice(%Order{} = record)` on the
CONTEXT FACADE module, which the controller hosting `serialize/1` does not host, so inlining would
emit an unbound `twice(record)`. Closing it means qualifying the call at that one site (a
`RenderCtx` seam) AND reconciling the document / part / value-object serializers, which pass a
struct the facade's guarded clause head does not accept. **Pinned as a characterization** in
`derived-wire-contract.test.ts` so it is visible and so the day it is fixed the test says so.

---

## 7. Decisions wanted from the owner

1. **`G2646`'s `i18nFormat` arm.** The ledger's proposed disposition ("honour it or pin it in the
   heex-parity freeze with a reason") is not available as written — the freeze list is over walker
   primitives, not `ExprIR` kinds. The real fork is: (a) add a CLDR-shaped formatter dependency to
   generated Phoenix apps, (b) ratify the drop as a documented permanent LiveView divergence and
   retire the arm from the ledger row, or (c) mint a `loom.*` code so the author is told their
   format is ignored. (b) is the cheap honest answer and matches what the code already says; it
   needs a name.
2. **`D-PHOENIX-FORMAT-GATE` is `proposed`.** Default applies 48 h after merge. It closes M-T6.3 by
   declining the `mix format` gate permanently and leaving Dialyzer unscheduled — the reversal cost
   is one new mission, and the measurement it rests on is the mission's own.

---

## 8. Local gates on the merged tree

Run **after** `git merge origin/main` (`7534696f9`), per rule 14.

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | OK — 182 files, 470 errors, `src/` clean (baseline unchanged) |
| `npm run lint` (`biome ci .`) | 0 errors, 23 warnings (pre-existing) |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | OK |
| `npm test` | **green** — 2017 files, 23538 passed, 7 expected-fail, 0 failed |
| elixir compile leg (`LOOM_PHOENIX_VANILLA_BUILD=1 LOOM_HEX_MIRROR=1`) | **61 of 78 fixtures run, 59 green, 2 host-limited (`vanilla-embed-{angular,feliz}` — SPA build, not `mix compile`), 17 not reached** — see below |

### The elixir compile leg — what ran, and why the whole leg did not

Seven fixtures were compiled **individually**, each `mix compile
--warnings-as-errors` green, chosen to cover every path this packet's
cross-cutting changes touch:

| fixture | why this one |
|---|---|
| `vanilla-if-stmt.ddd` (new) | the `if` renderer: `else`-less, nested, returning-op, containment `+=` in a branch |
| `vanilla-derived-chain.ddd` (new) | F60's three-deep inline |
| `vanilla-workflow-form.ddd` (new) | F61's `run_<wf>` clause + `__wf_param/2`, and the param-LESS clause |
| `vanilla-document.ddd` (extended) | the document residue's derived chain, read from an op guard |
| `vanilla-finds.ddd` | `withStaticSubpathGuards` — the `match :*` routes must parse |
| `vanilla-ref-collections.ddd` | `contextUsesRefCollOp` / `contextMutatesRefColl` now deep-walk |
| `vanilla-es-applier-fold.ddd` | the new throwing arm in `eventsourced-emit.ts` |

**The WHOLE-LEG invocation could not be used on this host, and the reason is
worth carrying forward.** Three attempts died identically on their FIRST or
second fixture — `Request failed (:timeout)` → `** (Mix) No package with name
phoenix … in registry` — while the very same fixture passed when invoked alone.
The suite shares ONE long-lived loopback hex mirror across all 78 cases
(`beforeAll` → `startHexMirror`), and `scripts/hex-mirror.py` is a single Python
process re-originating every hex request; something in it degrades across a long
run. It is not simple CPU contention: the last attempt failed on fixture 1 with
the box idle (load average 0.02).

**So the leg was run fixture-by-fixture instead**, one `vitest` invocation per
`.ddd` with `LOOM_PHOENIX_VANILLA_BUILD_CASE`, which gives each a FRESH mirror.
That works: **61 of 78 fixtures ran before the hand-off deadline — 59 green, 2
host-limited, 0 real failures.** The 17 unreached are the alphabetical tail from
`vanilla-scaffold-*` onward.

The two non-passes are both the `hosts:`-embed SPA arm and neither reaches
`mix compile`:

- `vanilla-embed-feliz.ddd` — `sh: 1: dotnet: not found`. No .NET SDK on this
  host; the Feliz bundle builds via `dotnet fable`.
- `vanilla-embed-angular.ddd` — the Phoenix side fetched and compiled (every hex
  tarball 200), then `runSpaBuild`'s `ng build` failed. Angular's build is the
  heaviest thing in the corpus.

Neither is in this packet's blast radius: it touches no Angular or Feliz
emitter, and the elixir half of both fixtures compiled.

The fixtures that DO exercise every path this packet changed all passed, and are
called out because the 59 are otherwise just a number: `vanilla-if-stmt`,
`vanilla-derived-chain`, `vanilla-workflow-form`, `vanilla-document`,
`vanilla-finds`, `vanilla-ref-collections`, `vanilla-es-applier-fold`,
`vanilla-returns-ref-coll`, `vanilla-returns-body`, `vanilla-provenance`,
`vanilla-audited`.

I also tried tuning hex for the mirror path (`HEX_HTTP_CONCURRENCY=1
HEX_HTTP_TIMEOUT=120` in `hex-mirror.ts`'s `shellPrefix` — the remedy hex itself
prints) and **reverted it**: the run still timed out at hex's default 60 s, so
the knob was not reaching the failing call, and an unproven change to a shared
harness is what the repo's bar forbids. The real finding is the one above — the
SHARED long-lived mirror is what fails, and a per-case mirror does not. That is
a harness improvement someone should make deliberately, with a measurement; it
is not this packet's to land.

**Re-run at fold time:**

```
# whole leg (CI's shape — works on a runner with direct hex.pm access)
LOOM_PHOENIX_VANILLA_BUILD=1 LOOM_HEX_MIRROR=1 \
  npx vitest run test/e2e/generated-elixir-vanilla-build.test.ts

# behind the mirror, if the above starves: one fresh mirror per fixture
for f in test/e2e/fixtures/elixir-vanilla-build/*.ddd; do
  LOOM_PHOENIX_VANILLA_BUILD=1 LOOM_HEX_MIRROR=1 \
    LOOM_PHOENIX_VANILLA_BUILD_CASE="$(basename "$f")" \
    npx vitest run test/e2e/generated-elixir-vanilla-build.test.ts || echo "FAIL $f"
done
```

and, for the wider emitter blast radius (`withStaticSubpathGuards` and
`opBodyStmtsDeep` touch every generated project):

```
npm run test:elixir-corpus        # LOOM_ELIXIR_BUILD=1, ~70 features
```

The corpus leg was **not** attempted — the per-fixture leg above used the whole
window.

**One environment note for the coordinator, not a code finding.** On the first full run four cases
in `test/platform/packaging-split-core-pkg.test.ts` / the fs-discovery suite failed because this
worktree had **no `node_modules/@loom/` link set** — `discoverBackendsFs` walks
`node_modules` and found no workspace package at all, so even the sanity assertion ("the real
backend is still found") was false. Symlinking the four `@loom/*` workspaces makes all 465
`test/platform` cases pass. Nothing in this packet touches `src/platform/**` or `packages/**`; if a
fold run shows the same four, re-link rather than bisect.

Three fixtures were ADDED to `test/e2e/fixtures/elixir-vanilla-build/` (`vanilla-if-stmt.ddd`,
`vanilla-derived-chain.ddd`, `vanilla-workflow-form.ddd`) and one EXTENDED (`vanilla-document.ddd`),
so `elixir-vanilla-build.yml` grows by three cells. `vanilla-document.ddd` is read by no `.test.ts`,
so extending it is safe.

## 9. Files touched

```
src/generator/elixir/vanilla/if-stmt-emit.ts          (new)
src/generator/elixir/vanilla/operation-returns-emit.ts
src/generator/elixir/vanilla/context-emit.ts
src/generator/elixir/vanilla/function-emit.ts
src/generator/elixir/vanilla/eventsourced-emit.ts
src/generator/elixir/vanilla/shell-emit.ts
src/generator/elixir/vanilla/wire-serialize.ts
src/generator/elixir/domain/predicates.ts
src/generator/elixir/domain-service-emit.ts
src/generator/elixir/heex-primitives.ts
src/generator/elixir/heex-walker-core.ts
src/generator/elixir/liveview-emit.ts
src/ir/validate/checks/if-stmt-checks.ts              (the gate the row retires/narrows)
src/ir/validate/checks/datasource-checks.ts           (the gate the row narrows)
src/diagnostics/messages.ts                           (three #slug messages replace one)
src/diagnostics/unsupported-register.ts               (two `what` rewrites + two `site` fixes)
docs/decisions.md                                     (D-PHOENIX-FORMAT-GATE)
docs/new-plan/T6-backend-parity.md, archive/T6-done.md, README.md
docs/audits/targets-completeness-2026-08-30.{ledger.json,md}
test/generator/elixir/{if-stmt-emit,static-subpath-method-guard,derived-wire-contract,
                       heex-image-icon-positional,heex-workflow-form}.test.ts   (new)
test/generator/elixir/vanilla-wire-derived.test.ts    (inverted case)
test/ir/if-stmt-placement.test.ts                     (gate narrowed)
test/ir/saving-shape-support.test.ts                  (inverted case + 2 new)
test/system/diagnostic-firing-census.test.ts          (firing shape for the narrowed code)
test/e2e/fixtures/elixir-vanilla-build/*.ddd          (3 new, 1 extended)
```
