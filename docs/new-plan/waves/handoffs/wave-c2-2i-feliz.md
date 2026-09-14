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
| M-T3.9 scaffolded History section | **MEASURED, NOT BUILT** — see below |

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
$ ddd generate system app.ddd -o out --sourcemap
web/src/App.fs: [235,255] WebApp.widgets.List   (macro)
                [256,276] WebApp.widgets.Detail (macro)
                [277,291] WebApp.Home           (macro)
$ ddd breakpoints app.ddd --line 22
web/src/App.fs:163
```

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

New **`loom.async-effect-subject-unsupported`** (`store-checks.ts:520`) runs for every
deployable that mounts a ui, over page AND component actions, using the same
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

## Rows measured but NOT built

### the 10 deferred component shapes (`loom.user-component-deferred-target`, feliz arms)

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
  scope, which means the component function taking `model` — the same currying
  `F2-FFE-4` (a component invoked from ANOTHER component's body is emitted without the
  `model`/`dispatch` currying) already describes. Do them together.
- **#1 and #2 (slot / action params) stay honest gaps** — they need a props channel F#
  anonymous records do not have; the `scope` case for them is real but was not taken here.

**Nothing was re-classed**: the register row `loom.user-component-deferred-target` is shared
with 2h (angular's four arms), so a `scope` re-class or a `MAX_OPEN_GAPS` move on it is a
coordinator-level decision once both packets report. This packet leaves the row untouched and
hands the slicing above to whoever takes it.

### M-T3.9 — the scaffolded History section on feliz

The mission text already states the shape of the gap: *"the scaffolded section … ships on the
four JS-family frontends, because Feliz maps non-`byId` reads to `All<Plural>`, Flutter skips
them in `collectFlutterReads`, and HEEx assigns the list read rather than the trail."*
Verified on this head: `src/generator/feliz/wire.ts` has an `AUDIT_HISTORY_FIND` import and
`test/generator/feliz/feliz-audit-history.test.ts` covers the `Timeline` primitive, so the
PRIMITIVE ships; what does not is the scaffolded section, whose read is a non-`byId`
`history(id)` find that `readsForUi`'s collector folds onto the plural list field.

This is the same collector seam as #9 above (a page-entry read keyed to the hosting page's
`Page` case), so it should be built with that slice rather than separately. Not started —
the packet ran out of budget after the five built rows.

## Local gates run on the merged tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | *(see below)* |
| `npm run lint` (`biome ci .`) | clean (24 pre-existing warnings, 0 errors) |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| feliz-build leg: `dotnet fable` | **exit 0** — `Fable compilation finished in 25056ms` |
| feliz-build leg: `vite build` | **exit 0** — `98 modules transformed`, `dist/assets/index-*.js 243.94 kB` |
| `npm test` | *(see below)* |

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
`src/diagnostics/code-docs.ts`, `src/diagnostics/unsupported-register.ts` AND
`test/system/unsupported-register.test.ts` — the same four files this packet's F66 commit
edits. The hunks here are deliberately minimal and additive:
one new `messages.ts` entry (inserted directly above `loom.feliz-async-effect-unsupported`),
one new `code-docs.ts` line, one new register row + one edited row, and `MAX_OPEN_GAPS`
24 → 25. If #2896 also moves the pin, **compose** rather than pick — this packet's change is
`+1` for a row SPLIT (no gap drained, no gap added), so it composes with any other delta as
an addition.

## Edits outside `src/generator/feliz/**`

Each is the gate/registry site a row of this packet owns, named here so the coordinator can
see them at fold:

- `src/ir/util/feliz-persist-codec.ts` — the codec table the row IS.
- `src/ir/util/feliz-async-effect.ts` — the classifier F66 promotes; comments + the reason
  string de-felized.
- `src/ir/validate/checks/store-checks.ts` — **the one file that also sits in 2f's
  `src/ir/**` fence.** Three hunks: the new target-agnostic gate (a new block, inserted
  between the feliz and flutter arms), the feliz arm's condition narrowing to the component
  host, and a `?? []` guard on `ui.apiParams` (the new loop runs for every ui-mounting
  deployable, incl. hosts whose uis carry no api handle — a hand-built test IR crashed
  without it). None of 2f's named rows touches this file.
- `src/platform/feliz.ts` — one line, the `sourcemap` forward.
- `src/diagnostics/{messages,code-docs,unsupported-register}.ts` — the F66 code's catalog
  text, anchor and rows (see the #2896 overlap above).
- `docs/debugging.md`, `docs/new-plan/T1-ui-frontend.md`,
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
