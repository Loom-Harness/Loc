# Wave C2 packet 2i — feliz (hand-off)

*Branch `claude/c2-feliz`, cut from the batch-2 coordinator head `118d0a3f7` (which is `main` @ `9713ffa18` + the wave log). Fence: `src/generator/feliz/**` plus the tests, the diagnostics catalog/register rows, and `src/platform/feliz.ts`. Never pushed, no PR — the coordinator folds the branch.*

## Rows → outcome

| row | outcome |
|---|---|
| `feliz-navbar-ignores-page-requires` (ledger P2, ownerless) | **BUILT** — ledger row → `done` |
| `store-lifetime-target-unsupported#field` | **FELIZ HALF BUILT** — the F# codec table drained to the union; the register row's `what` narrowed to the record-shaped residue. Flutter half → 2j |
| `sourcemap-feliz-flutter-not-emitted` (feliz half) | **BUILT** — ledger row narrowed to the flutter half with the mirror recipe |
| M-T1.16 rule-specific validation messages via `invariant-classify` | **BUILT** — the mission's one named follow-up; ledger row narrowed to the flutter half |
| `feliz-async-effect-unsupported` (F66 classifier promotion) | **BUILT** — the subject half promoted to a target-agnostic `loom.async-effect-subject-unsupported`; the Feliz row keeps only the component host |
| the 10 deferred component shapes | **MEASURED, NOT BUILT** — see below |
| M-T3.9 scaffolded History section | **PREMISE STALE — already shipped on feliz; the mission text corrected** (and for flutter + HEEx too, both verified by generating) |

Two ledger rows outside the row list were closed on the way, both inside the fence:
`feliz-persist-codec-stale-code-name` (P5 stale prose) and a **new silent-codegen defect**
the persist work exposed (below, under the persist row).

## What landed, with file:line and the mutation proof

### 1. `feliz-navbar-ignores-page-requires` — the navbar advertised routes the backend 403s

`src/generator/feliz/index.ts` `renderNavbar` took `(pages, brand, i18nEnabled)` and read only
`p.route` / `p.name`. Under `auth: ui` a three-page app whose `/tickets` page carries
`requires currentUser.role == "agent"` emitted

```fsharp
Html.li [ prop.children [ Html.a [ prop.href "/tickets"; prop.text "Ticket List" ] ] ]
```

unconditionally, while the page view below it rendered `| _ -> forbiddenView`. Every other
target gates the entry (`_frontend/menu-emitter.ts`'s `requiresJs` for the four JSX
frontends).

`renderNavbar` now takes `pageGate` and wraps a gated entry in the same claims guard the
gated page view and the gated action button already use — **one line per entry**, because F#
keys a newline-separated list element by its first-token column and a multi-line guard would
have to re-indent against the surrounding `prop.children [ … ]` block:

```fsharp
(match model.CurrentUser with Some currentUser when currentUser.Role = "agent" -> Html.li [ … ] | _ -> Html.none)
```

Ungated entries and gate-free apps keep the bare `Html.li [ … ]`.

**Mutation proof** (file-copy backup, never `git checkout --`): collapsing the ternary to the
bare `li` fails `test/generator/feliz/auth-gate.test.ts` →
*"gates a navbar entry on its page's `requires`, and leaves ungated entries bare"* with
`expected 'module App…' to contain '(match model.CurrentUser with Some cu…'`.

### 2. `store-lifetime-target-unsupported#field` — and a silent-codegen defect underneath it

**The defect found first, which has nothing to do with `persist:`.** An `enum` / `datetime` /
`guid` `state {}` cell emitted F# that cannot Fable-compile at all, from a `.ddd` reporting
`0 error(s), 0 warning(s)`:

```
store Filters { state { mode: Status  at: datetime  ref: guid } }
```
```fsharp
FiltersMode: Status            // FS0039 — no `type Status` is ever emitted into App.fs
| FiltersSetMode of Status     // same
FiltersAt = ""                 // `fsZeroValue` fell through to "" against System.DateTime
FiltersRef = ""                // …and System.Guid
```

`type-fs.ts` `typeToFs` spelled an enum by its own name while EVERY other seam on this
frontend spells one `string` (`wire.ts` `wireFieldType`, `decoderExprFor`, the query-param
encoder, `auth-gate.ts` `claimFsType`). It now spells `string`, and `fsZeroValue` grew
`System.DateTime.MinValue` / `System.Guid.Empty`. Pinned by
`test/generator/feliz/store.test.ts` on an **in-memory** store, so the fix is proven
independent of `persist:`.

**The row itself.** With the spellings right, `src/ir/util/feliz-persist-codec.ts` drained
toward the flutter table's union — the fix the `feliz-flutter-persist-codec-asymmetry` row
asked for by name: `datetime` and `guid` became scalars (`System.DateTime.TryParse` /
`System.Guid.TryParse`, total by construction, written back as the ISO-8601 `ToString("o")` /
canonical-guid string the JS store builders hold in their `string` cell), an enum rides the
`string` codec, and the list element set became the whole scalar set. `store-persist.ts`
gained the matching `fromRaw` arms, a shared `cellToJson` both the scalar and list writers go
through (so an element and a bare cell of the same type cannot serialise differently), a
widened `listFromCells`, and a new `urlArg`.

**`urlArg` is the non-obvious one:** a Fable `System.DateTime` reaches JS as a `Date`, whose
`String(…)` is the locale form — so `String($0)` inside the `[<Emit>]` url writer would have
written a param neither side could decode. The conversion happens in F# before the boundary:

```fsharp
let private saveFilters (model: Model) : unit =
  saveFiltersRaw (model.FiltersSince.ToString("o")) (string model.FiltersWho) model.FiltersKind
```

**Five codec divergences became one.** `test/ir/util/persist-codec-divergence.test.ts` is
rewritten around the single remaining row — `json`, which F# keeps as raw text and Dart
refuses — plus an AGREE list that now carries the four ex-divergences, so the flutter `json`
arm closes the asymmetry and nothing else can silently re-open it.

**Mutation proofs**, two, each with a file-copy revert:
- dropping the `datetime`/`guid` arms from `felizPersistCodec` fails **8** assertions across
  three suites, first `at: datetime: expected [ Array(1) ] to not include 'loom.store-lifetime-target-unsupported'`;
- dropping the `typeToFs` enum arm + the two `fsZeroValue` arms fails
  *"types an enum cell (and its action payload) as `string`, never the enum name"* and
  *"seeds a datetime / guid cell with the .NET zero its field type accepts"*.

The firing-census fixture for the code moved from a `datetime` cell to a `valueobject` cell
in the same commit (the feliz residue is now exactly the record-shaped types).

### 3. `sourcemap-feliz-flutter-not-emitted` — the feliz half

`src/platform/feliz.ts`'s `emitProject` did not even destructure `sourcemap`, and nothing
under `src/generator/feliz/` touched a `SourceMapRecorder`. Feliz is **not** file-per-page —
one `src/App.fs` holds every view function — so the recording rides `fragment()` (each page's
own view text is the anchor; an absent or non-unique anchor records NOTHING rather than
guessing) instead of the `file()` call the four JS frontends use. `renderAppFs` gained an
`onPageView` callback because it assembles `App.fs` in one `lines(…)` at the end, so a caller
cannot recover the per-page slices from the finished string.

```
# a `ui … with scaffold(…)` app — the `.loom/sourcemap.json` `files` entry:
$ ddd generate system scaffold.ddd -o out --sourcemap
web/src/App.fs: [235,255] WebApp.widgets.List   (macro)
                [256,276] WebApp.widgets.Detail (macro)
                [277,291] WebApp.Home           (macro)

# a hand-written three-page app — the reverse direction now resolves too
# (line 22 is the gated `TicketList` page's `body:`):
$ ddd breakpoints nav.ddd --line 22
web/src/App.fs:163
```

Each recorded range was checked against the emitted file by eye as well as by the test —
`App.fs:156` is `let homeView (model: Model) …` and `:163` is `let ticketListView …`, so the
ranges are the view functions themselves, not the whole module.

`test/generator/feliz/sourcemap.test.ts` asserts the BOUNDARY of each region (first line is
the page's own `let <page>View`, the line after the region is not indented, regions are
disjoint) — a whole-file region would still satisfy a `toBeDefined()` check.
**Mutation proof:** reverting `src/platform/feliz.ts` to the non-forwarding `emitProject`
fails *"records every scaffolded page as a region of the single `src/App.fs`"* with
`no region recorded for web/src/App.fs: expected 0 to be greater than 0`.

Docs: `docs/debugging.md`'s per-target table grew a row for each self-hosting frontend (it
covered backends only), and `docs/new-plan/testing-quality-improvement-plan.md:112`'s
"test-parity" framing is corrected — on feliz the EMISSION was absent, not the test, and
flutter is the same shape.

### 4. M-T1.16 — invariant-derived client validation, with rule-specific messages

The Feliz `Validation` module answered "is this cell empty" and "does this numeric cell's
text parse" and nothing else, so `invariant qty >= 1` let `0` through to a server 422 while
React/Vue/Svelte caught it in the zod schema and Angular in `Validators.*`.

`src/generator/feliz/form-validators.ts` is the F# twin of `angular/form-validators.ts`.
**Fidelity by reuse:** admission goes through the shared `takeSingleFieldChain` gate — the
exact one the zod emitter and `angularValidatorMap` use — so Feliz admits a constraint iff
the other five frontends do; money / `now()` / cross-field rules stay server-only here too
(pinned by two negative cases). Each `SingleFieldPattern` becomes a `(violated, message)`
pair that folds into BOTH the `<form>Valid` submit guard and the `<form><Field>Error`
function.

Three decisions the Flutter twin (2j) should copy rather than rediscover:

1. **A numeric rule is blank- AND unparseable-tolerant.** Every Feliz form cell is a
   `string`; the encoder parses at submit. `(match System.Decimal.TryParse form.qty with
   | true, v -> v < 1m | _ -> false)` answers `false` for both, so the rule never shadows
   `Required` or `Must be a whole number` — each of which has its own rung ahead of it.
2. **Length counts CODE POINTS**, through an `[<Emit>]` `[...$0].length` — the definition the
   server's JSON Schema `minLength`/`maxLength` publishes and the one `tsCodePointLength`
   emits for the JS frontends. `Seq.length` over an F# string counts UTF-16 units, so a
   surrogate pair would count twice.
3. **The rules ride the FIELD (`attachFieldRules`), not the form.** Three emitters decide
   whether a cell is message-bearing — the `Validation` module, the touched-set Model/Msg
   wiring, and the view seam's onBlur + inline error — and they now agree through one
   `isValidatedField`. An OPTIONAL non-numeric field with a `len-max` was message-bearing for
   NONE of them before, so without the union the submit guard refuses with no visible reason.

A form with no translatable invariant emits **byte-identically** to before (the optional
numeric's historical positive spelling `if <parses> then None else <bad>` is preserved
explicitly for that reason), which is what makes the feature provably additive.

**Mutation proof:** making `felizFieldRules` yield nothing fails **7** of the 10 cases in
`test/generator/feliz/invariant-validation.test.ts`, first
`expected 'module App…' to contain 'elif (match System.Decimal.TryParse f…'`.

### 5. F66 — `classifyFelizAsyncEffect` promoted to a target-agnostic gate

The audit's finding, reproduced verbatim on this head before the change:

```
$ ddd generate system f66.ddd -o out      # platform: react
0 error(s), 0 warning(s)
out/web/src/pages/order_detail.tsx:7:
    const result = await Promise.reject(new Error("no remote op for variant-match"));

$ ddd parse f66-feliz.ddd                 # the SAME model, platform: feliz
loom.feliz-async-effect-unsupported page 'OrderDetail' action 'submit': … the awaited
subject is not an aggregate instance operation …
1 error(s), 0 warning(s)
```

Each frontend failed differently and none of them honestly: the four JS walkers emit that
guaranteed unhandled rejection, `heex-walker-core`'s `renderVariantMatchStmt` **throws at
codegen**, and only feliz/flutter said so — behind `if (dep.platform !== "feliz") continue`.

New **`loom.async-effect-subject-unsupported`** (`store-checks.ts:527`) runs for every
MOUNTED UI (the set, not deployable × ui — two deployables can serve the same bundle, and
the answer is a property of the ui), over page AND component actions, using the same
`classifyFelizAsyncEffect` — this is the promotion the audit named, not a new analysis. The
Feliz row narrows to its one genuinely Feliz-specific case (the COMPONENT host, whose trigger
id comes from the host page's route `:id`), and fires only when the subject is otherwise
fine, so one statement never draws two diagnostics.

The statement form **cannot** instead reuse `loom.match-non-union-subject`: a
`StmtIR.variant-match`'s `subjectType` comes from `inferExprType`, whose catch-all is
`string`, so an awaited api-handle call is indistinguishable from a genuine string there —
the defect `test/ir/variant-match-subject-type.test.ts` pins. This gate is SHAPE-based and
needs no type resolution, which is exactly why the promotion was the right fix and
"resolve `subjectType`" was not.

Catalog entry in `messages.ts`, a `code-docs.ts` anchor
(`15-ui-pages-structure.md#effect-markers-and-match-await`), a `FIRING_FIXTURES` entry on a
**react** deployable (the point being that the react arm is the regression), and a register
row. `MAX_OPEN_GAPS` **24 → 25** — one row split into two, no gap drained; the Feliz row's
`what` is now strictly smaller and the new row carries the real work (awaiting a WORKFLOW is
a different route shape, `POST /workflows/<wf>`, with its own result projection on each of
the seven frontend emitters).

`test/ir/async-effect-subject.test.ts` asserts the same answer on `static` / `feliz` /
`flutter`, and that the Feliz code survives for a component host with a GOOD subject.
**Mutation proof:** making the gate's `if (cls.supported) return;` unconditional fails 6 of
its 10 cases, first `static: expected [] to include 'loom.async-effect-subject-unsupported'`.

**Process note, recorded because it is the failure shape CLAUDE.md warns about.** That test
file was written and COMMITTED before it was ever run — its fixture carried a
`workflow placeAll() { }`, which is not the grammar (`10:24 Expecting token of type '{' but
found '('`), so all ten cases threw in the helper rather than asserting anything. The full
`npm test` is what surfaced it; the targeted runs I had done covered the OTHER four rows.
A green targeted run is not evidence for a file you never executed.

**Two things fixed on the way, both worth carrying forward:**

- `store-checks.ts`'s `forEachStmt` was a FLAT loop whose own comment said "the store-action
  body set in v1 is flat (no nested handler lambdas), so a shallow walk over the top-level
  statements suffices". That is exactly the drift CLAUDE.md's *"No hand-rolled IR walks"*
  rule exists to prevent: a `match await` nested inside a `match` arm was invisible to EVERY
  gate in the file — the new one, both Feliz arms, the Flutter arm and the store-action
  checks above them. It now rides `walk.ts`'s exhaustively `never`-checked `walkStmtsDeep`.
  **This is a reach change, not a behaviour change by intent** — the full suite is the
  measurement that no fixture was relying on the shallow walk.
- The new code declares **no `where` param**. `diagnostic-message-hygiene.test.ts` carries a
  44-entry `DEAD_PARAM_DEBT` waiver for builders that declare `where` and never read it (the
  `where`-lead cleanup stripped it from the TEXT only); adding a 45th would have been free
  and wrong. The location still reaches the user as `source`.

## The 10 deferred component shapes — measured, not built

*(`loom.user-component-deferred-target`, the feliz arms)*

`src/ir/validate/checks/ui-component-deferral-checks.ts` `felizDeferrals` reports **nine**
distinct shapes (the "10" in the plan counts the two `paramDeferrals` arms separately per
framework):

| # | shape | emitter site |
|---|---|---|
| 1 | a `slot` parameter | `component-emit.ts` `propType` — a slot has no props-record spelling |
| 2 | an `action` callback parameter | same |
| 3 | an OPTIONAL parameter | same — an F# anonymous record is EXACT, so a call site omitting the field would not typecheck |
| 4 | `derived <name>` reads the route `id` | `derivedNeedsPageScope` |
| 5 | the body reads the route `id` | `renderOne` (`result.usesRouteId`) |
| 6 | the body renders `DestroyForm` | same (the primitive sets `usesRouteId`) |
| 7 | the body renders `Action { <param>.<op> }` | same |
| 8 | the body reads a store | `renderOne` (`result.usedStores`) |
| 9 | the body issues a `<Agg>.byId(…)` read | `wire.ts` `collectBodyReads` + `needsMvuScope` |

These are **not** nine independent fixes — 4–7 and 9 are one structural fact (a Feliz
component is a plain function; the route `id` and the page-entry `pageCmd` fetch are bound by
a PAGE view fn and its `Page` case), and 8 is a second (`usedStores` is resolved against the
page's Model scope). The honest slicing is:

- **S, independent, worth doing first: #3, the optional parameter.** An F# anonymous record
  is exact, but `propType` can spell the field `'T option` and the call site pass `None`.
  That is a self-contained change in `component-emit.ts` + `feliz-target.ts`'s call-site
  seam, with no route/Model interaction. It is also the shape most likely to appear in real
  `.ddd` (an optional label/prop).
- **M, one fix for five rows: #4–#7 and #9.** Thread an explicit id into the component
  props record and bind the component's reads off it, so `usesRouteId` / `needsMvuScope`
  stop being page-only. That is the same slice the `M-T1.20-feliz-match-await` ledger row's
  fix (a) names for the component-hosted `match await`, and it should be done once for both.
- **M, separate: #8.** A component reading a store needs the namespaced Model field in
  scope, which means the component function taking `model` — the same currying ledger row
  **`F2-FFE-4`** (a component invoked from ANOTHER component's body is emitted without the
  `model`/`dispatch` currying) already describes. That row sits in the ledger's `claimed`
  bucket, so check who holds it before starting: the two are one change.
- **#1 and #2 (slot / action params) stay honest gaps** — they need a props channel F#
  anonymous records do not have; the `scope` case for them is real but was not taken here.

**Nothing was re-classed**: the register row `loom.user-component-deferred-target` is shared
with 2h (angular's four arms), so a `scope` re-class or a `MAX_OPEN_GAPS` move on it is a
coordinator-level decision once both packets report. This packet leaves the row untouched and
hands the slicing above to whoever takes it.

## M-T3.9 — the row was stale; the mission text is now corrected

This one is a **verify-first win, not a build**. The mission said: *"the scaffolded section is
narrower than the primitive: it ships on the four JS-family frontends, because Feliz maps
non-`byId` reads to `All<Plural>`, Flutter skips them in `collectFlutterReads`, and HEEx
assigns the list read rather than the trail."* That has not been true for some time.

`HISTORY_CAPABLE_FRAMEWORKS` (`src/generator/_walker/history-read.ts:50`) names **all seven**
frontends, and its own comment states the admission rule that makes the set trustworthy: a
frontend joins *"by collecting the history read AND implementing `Timeline` — the same day, or
not at all"*, precisely because *"a target that renders the primitive but binds the wrong read
is worse than one that renders nothing, because it looks like it works."*

Re-verified the way the register's own rule demands — by GENERATING, not by reading the set.
One `.ddd` (`aggregate Order audited with crudish`, `ui … with scaffold`), three targets:

- **feliz** — `OrderHistory: Remote<AuditEntry list>` on the Model (**not** `AllOrders`), an
  `Api.orderHistory` fetch batched into the detail page's `pageCmd`
  (`| OrderDetail id -> Cmd.batch [ … orderById …; … orderHistory … ]`), and a native
  `Html.orderedList` Timeline under `data-testid="orders-detail-history"`.
- **flutter** — `GET /orders/$id/history` in `lib/reads.dart`, the section in
  `lib/pages/order_detail_page.dart`.
- **HEEx** — `assign(socket, :order_history, load_order_history(socket, …))` from its OWN
  loader, and the `orders-detail-history` card in the template.

So the mission's "Remaining: the frontend half" paragraph is replaced with the measurement and
the three pieces of evidence. **No code changed** — this is a docs correction, and it is the
kind the wave exists to catch: the row would otherwise have been "built" a second time.

## Local gates run on the merged tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | clean — the ratchet caught one new error in `test/ir/async-effect-subject.test.ts` (`LoomDiagnostic.code` is `string \| undefined`); fixed in place, baseline NOT raised |
| `npm run lint` (`biome ci .`) | clean (24 pre-existing warnings, 0 errors) |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| feliz-build leg: `dotnet fable` | **exit 0** — `Fable compilation finished in 25056ms` |
| feliz-build leg: `vite build` | **exit 0** — `98 modules transformed`, `dist/assets/index-*.js 243.94 kB` |
| `npm test` | `2 failed | 2059 passed | 89 skipped (2150)` files, `4 failed | 24180 passed` tests — the 4 are `packaging-split-*`, see below |

**The only failures are the worktree-structural ones packet 2b already documented.**
`test/platform/packaging-split-{core-pkg,fs-discovery}.test.ts` (4 cases) cannot pass in ANY
git worktree: `fs-discovery` walks `node_modules/@loom/*` for workspace symlinks, and a
worktree has none, so it discovers zero backends
(`node@v4: expected undefined to be defined`, `expected 0 to be greater than 0`). 2b's
hand-off records the same `packaging-split-*` family as "cannot pass in ANY git worktree —
proven by recreating them" (it names three files; two of them fail here — the third,
`packaging-split-discovery.test.ts`, never reaches the symlink walk). Nothing in this packet
touches `src/platform/fs-discovery.ts` or the `packages/` manifests.

TWO full runs were needed, and the first one earned its keep twice:

1. `test/system/direct-generate-systems-ratchet.test.ts` refused
   `test/generator/feliz/sourcemap.test.ts` for importing `generateSystems` straight from
   `src/` (I had copied the shape from `vue/sourcemap.test.ts`, which predates the ratchet).
   It now goes through `generateSystemFiles`, so the fixture is asserted valid at phases
   ①/④/⑦ before anything is read out of it.
2. It caught `test/ir/async-effect-subject.test.ts` failing to PARSE its own fixture — see
   the process note under row 5.

The Fable + vite leg ran on a purpose-built showcase carrying **every** emitter change at
once — the gated navbar under `auth: ui`, a `persist: local` store with
`datetime` / `guid` / `enum` / `decimal[]` / `money[]` / `datetime[]` / `guid[]` cells, a
`persist: url` store with `datetime` / `guid` / `enum`, and a `CreateForm` + `OperationForm`
whose aggregate carries length / regex / numeric-range invariants and a `precondition`. So
the `[<Emit>]` `cpLength`, `Regex.IsMatch` with a verbatim `@"…"` pattern, the
`ToString("o")` url args and the whole invariant `Validation` module are all proven to
typecheck under Fable 4.29, not just to look right.

Recipe (the dotnet CA step is required, not optional — `docs/tools.md`):

```bash
docker run --rm --network host -v <web-dir>:/w -w /w -v /root/.ccr:/root/.ccr:ro \
  -e HTTPS_PROXY="$HTTPS_PROXY" mcr.microsoft.com/dotnet/sdk:10.0 bash -c \
  'cp /root/.ccr/ca-bundle.crt /usr/local/share/ca-certificates/proxy.crt \
   && update-ca-certificates >/dev/null && dotnet tool restore \
   && dotnet fable App.fsproj -o out --extension .js'
```

## Open-PR overlaps on this fence

`list_pull_requests` (open, drafts included) on 2026-09-14: the coordinator's reconciliation
named **#2885 + #2860** as the only open PRs touching `feliz-target.ts`, and **#2898** as the
known batch-2 overlap — all three are merged and absent from the open set, so **no open PR
touches `src/generator/feliz/**` today**. Verified by reading the file lists of the PRs that
could plausibly reach the fence (#2927 angular/e2e — no feliz file).

**One real overlap on a SHARED file: [#2896](https://github.com/Loom-Harness/Loc/pull/2896)**
(M-T5.34, the validator-rulings packet) touches `src/diagnostics/messages.ts`,
`src/diagnostics/code-docs.ts`, `src/diagnostics/unsupported-register.ts`,
`test/system/unsupported-register.test.ts` AND
`test/system/diagnostic-firing-census.test.ts` — the same **five** files this packet's F66
commit edits (its own file list, read on 2026-09-14). The hunks here are deliberately minimal
and additive: one new `messages.ts` entry (inserted directly above
`loom.feliz-async-effect-unsupported`), one new `code-docs.ts` line, one new register row +
one edited row, one new `FIRING_FIXTURES` key, and `MAX_OPEN_GAPS` 24 → 25. All five are
append-shaped, so a three-way merge should land them side by side. If #2896 also moves the
pin, **compose** rather than pick — this packet's change is `+1` for a row SPLIT (no gap
drained, no gap added), so it composes with any other delta as an addition.

One further note for the fold: this packet ALSO edits the
`loom.store-lifetime-target-unsupported` entry in `diagnostic-firing-census.test.ts` (the
fixture moved from a `datetime` cell to a `valueobject` cell) — a different key in the same
map, in an earlier commit.

## Edits outside `src/generator/feliz/**`

Each is the gate/registry site a row of this packet owns, named here so the coordinator can
see them at fold:

- `src/ir/util/feliz-persist-codec.ts` — the codec table the row IS.
- `src/ir/util/feliz-async-effect.ts` — the classifier F66 promotes; comments + the reason
  string de-felized.
- `src/ir/validate/checks/store-checks.ts` — **the one file that also sits in 2f's
  `src/ir/**` fence.** Four hunks: the new target-agnostic gate (a new block, inserted
  between the feliz and flutter arms), the feliz arm's condition narrowing to the component
  host, a `?? []` guard on `ui.apiParams` (the new loop runs for every ui-mounting
  deployable, incl. hosts whose uis carry no api handle — a hand-built test IR crashed
  without it), and `forEachStmt` switched from a flat loop to `walkStmtsDeep`. None of 2f's
  named rows touches this file. The `walkStmtsDeep` hunk is the only one that changes what
  the file's OTHER gates see, and it changes it in the direction the census rule wants.
- `src/platform/feliz.ts` — one line, the `sourcemap` forward.
- `src/diagnostics/{messages,code-docs,unsupported-register}.ts` — the F66 code's catalog
  text, anchor and rows (see the #2896 overlap above).
- `docs/debugging.md`, `docs/new-plan/T1-ui-frontend.md` (M-T1.16 + M-T1.20),
  `docs/new-plan/T3-security-governance.md` (the M-T3.9 correction),
  `docs/new-plan/testing-quality-improvement-plan.md`, the gate ledger JSON + `.md`.

## Decisions the owner / coordinator still has

1. **`loom.user-component-deferred-target`** is shared between this packet (nine feliz arms)
   and 2h (four angular arms). Neither packet can re-class or drain it alone. The slicing
   above is the feliz half's honest read; the wave's exit criterion ("retired or carried as a
   register row with owners") needs both halves in one view.
2. **The two Feliz props-channel gaps (`slot` / `action` parameters)** are the only two of
   the nine that are not a threading problem — an F# anonymous record has no content-projection
   or callback channel. They are the natural `scope` candidates with a `D-*` entry; this
   packet did not take that decision because it would fix the row's shape for angular too.
3. **`MAX_OPEN_GAPS` 24 → 25** is a split, not a regression. Worth stating in the fold note so
   the wave's "ratchets to 0" narrative is not read as having moved backwards.
