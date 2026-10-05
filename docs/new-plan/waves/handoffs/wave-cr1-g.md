# Wave CR1 packet CR1-g — the dead-export gate, and the 52 it was missing

**Row:** P1-4 in [`docs/audits/code-review-2026-09-13.md`](../../../audits/code-review-2026-09-13.md).
**Branch:** `worktree-agent-a519c220d7aa0c5f8` · base: the batch-1 tree (`claude/loom-code-review-audit-790gec` @ `be2e3349`).
**Landed:** a two-tier export-surface census in the fast suite, **52 never-referenced exports deleted**, **emission byte-identical**, and an argued recommendation on the 426 module-local exports (§6).

**The tool is NOT knip.** knip was installed, configured for this repo's real shape, and
measured — and it is **silently blind to `src/ir/types/loom-ir.ts`**, which held 2 of the 52.
§2 is the evidence and the root cause. The gate that shipped is a token scan, which
reproduced the audit's 52 exactly.

---

## 1. The finding, re-derived on this tree

The audit's numbers are days old, so the scan was rebuilt from scratch: every top-level
`export`ed declaration in `src/` (TS AST, not regex — `export const a = 1, b = 2` exists
here), against every identifier token in `src/` + `test/` + `web/` + `scripts/` +
`packages/` + `bin/` + `designs/` + the `.hbs`/`.json`/`.yml` template and workflow trees.

| class | count | meaning |
|---|---|---|
| total exported symbols in `src/` | **4,409** | |
| referenced by another file | 3,931 | live |
| **referenced NOWHERE — not even inside their own file** | **52** | tier 1, deleted |
| referenced only inside their own defining module | **426** | tier 2, ratcheted (audit said 417) |

52 on the nose. A `.md` mention does not count as a reference — documenting a symbol is
not using it, and four of the 52 were mentioned only in the audit that found them.

Each of the 52 was then re-checked with `grep -rIw` over **every file in the repo with no
extension filter** — `.hbs` design-pack templates, `pack.json` manifests, `packages/*`
manifests, workflow YAML, the lockfile. Zero hits. The list is in §4.

---

## 2. Why the gate is not `knip`

knip 6.37.0 was installed and given a config that handles every exclusion the packet
named: `src/language/generated/**` (committed langium output) out of the project,
`test/fixtures/**` ignored, `packages/*` as their own workspaces so their publish-shaped
entry points resolve, `web/src/**` added as entry so the playground's `../src` imports
count, `bin/cli.js` + `src/cli/main.ts` + `src/language/main.ts` +
`src/language/main-browser.ts` + `src/mcp/` + `src/dap-server/` as entries, and the three
documented public barrels (`src/api/index.ts`, `src/tools/index.ts`,
`src/macros/api/index.ts` — D-API-TOOLKIT, D-AGENT-TOOLS, `docs/macro-api.md`) as entries
with `includeEntryExports: false`. It runs in **4.7 s** and gets unused-FILES to zero.

It still reports 515 export/type findings, of which 215 are cross-file-referenced by token
— and spot checks showed knip is usually **right** about those: `denialTitle`'s only
cross-file mention is a sentence in a test comment, and angular's `fieldErrorId` collided
with a private function of the same name in `feliz/pack.ts`. knip is the more precise tool
on the module-local class.

**But it has a blind spot it does not report.** A synthetic unused export planted in
`src/ir/types/loom-ir.ts` is reported for `src/util/color.ts`, `src/ir/util/walk.ts`,
`src/generator/_stmt/leaves.ts` and `src/generator/feliz/wire.ts` — and **not** for
`loom-ir.ts`, under the tuned config, under knip's zero-config default, and under a
two-line minimal config. In a throwaway project whose `project` glob is only
`src/ir/types/**`, the same probe IS reported — so the file parses fine; something in the
full graph marks all its exports used.

Root cause, found by grep: **inline `import("…").T` type queries**.

```
src/platform/hono/v4/routes-builder.ts:665:    type: import("../../../ir/types/loom-ir.js").TypeIR;
src/platform/hono/v4/emit.ts:686:    ? (agg: import("../../../ir/types/loom-ir.js").AggregateIR) => {
```

knip treats such a module reference as a wildcard use of that module. Eight modules in
this tree are named that way and are therefore invisible to it:

| module | inline `import("…")` sites |
|---|---|
| `src/language/generated/ast.ts` | 106 (ignored anyway — committed output) |
| **`src/ir/types/loom-ir.ts`** | **76** |
| `src/generator/elixir/heex-walker.ts` | 13 |
| `src/generator/react/templating/preparers/app-shell.ts` | 10 |
| `src/generator/_walker/target.ts` | 2 |
| `src/generator/react/templating/view-models.ts`, `…/api-hook-detector.ts`, `src/generator/_trace/sourcemap.ts` | 1 each |

`loom-ir.ts` is the IR vocabulary every backend imports, it is 4,416 lines, and it held
`currentUserRefIsActorId` and `aggregateStampUsesPrincipal` — 2 of the 52. A gate that is
**invisibly** blind to the repo's hub module is the exact failure shape this wave exists
to stop: it would have been green, and it would not have reached what it names. The
dependency (knip + 17 transitive packages) was not taken.

This is also the call `test/platform/dead-generator-exports.test.ts` already made, in
writing, for the same reason — "deliberately regex-based (no knip / ts-prune dependency)
— the same lightweight, self-contained approach as `pipeline-layering.test.ts`".

---

## 3. The gate: `test/system/export-surface-census.test.ts`

Two tiers, one file, **3.4 s**, in the fast suite (so it rides `tests passed`, a required
check — the packet said "the lint job"; the lint job is not a stronger gate than a
required vitest check, and this is a static census that belongs next to
`ir-walk-census.test.ts` and `diagnostic-catalog.test.ts`, not next to `biome ci`).

**Tier 1 — zero tolerance.** An export whose name appears in no other file *and* nowhere
else inside its own file. There is no dynamic-dispatch story for a name the repo never
spells twice. `ALLOW` is **empty**: all 52 were deleted, not pinned.

**Tier 2 — count ratchet**, the `allowlist-ratchet.test.ts` shape. Exported **values**
(function/const/class) referenced only inside their own module, pinned at **184**, `<=`
asserted plus a strict "you left slack, lower the pin" reminder so the baseline tracks
reality. Types are exempt by construction: a type named in an exported function's
signature *must* be exported for callers to spell the argument, and a token scan cannot
tell that from a genuine over-export (`ExprChildVisitor` in `walk.ts` is the canonical
case).

Vacuity guard: the census asserts it saw >800 src files, >3,000 exports and >2,000
consumer files before either tier runs.

`test/platform/dead-generator-exports.test.ts` **stays**. It is *stricter* than tier 2
over the `render*`/`emit*`/`build*` names it covers — it demands a reference from another
file even for a symbol used inside its own — and it owns the dead-re-export-shim check
that neither tier here does.

### Mutation proof

Two probes, each appended to `src/util/code-builder.ts` and reverted by **file copy**
(`cp .tmp-cr1g/code-builder.mutation-backup.ts …`, never `git checkout --` —
`experience_gathered.md` §84).

**Tier 1** — `export function cr1gMutationProbe(n: number)`, referenced nowhere:

```
FAIL  test/system/export-surface-census.test.ts > export-surface census (P1-4)
      > no export is referenced nowhere at all — not even in its own file
AssertionError: Export(s) referenced NOWHERE — not by another file, not inside their own.
Delete them; that is what this gate is for.  If one is genuinely unreferenceable by name
(dynamic dispatch, a published entry point), pin it in ALLOW with the reason.
src/util/code-builder.ts :: cr1gMutationProbe: expected [ Array(1) ] to deeply equal []

- []
+ [ "src/util/code-builder.ts :: cr1gMutationProbe" ]
```

**Tier 2** — `export function cr1gLocalProbe(…)` plus one in-file call, so it is
over-exported rather than dead:

```
FAIL  test/system/export-surface-census.test.ts > export-surface census (P1-4)
      > the module-local VALUE export count only falls
AssertionError: 185 exported values are referenced only inside their own module
(pinned max 184).  Drop the `export` and lower MODULE_LOCAL_VALUE_MAX in the same PR.:
expected 185 to be less than or equal to 184
```

Both green again after the file-copy revert; `git diff -- src/util/code-builder.ts` empty.

---

## 4. The 52, and how they died

They cluster into six shapes; the first two are findings, not chores.

### 4a. Spent carve-outs — the comment named the condition, and the condition was met

- **`groupKeyColumn`** (`src/ir/util/projection-aggregate.ts`) — "LEGACY narrow reading …
  **The backends that have not yet grown a transform arm still call this**, and each throws
  on `null`". No backend calls it. Every backend grew the transform arm; the last caller
  moved to `groupKeyOf` and the legacy reading stayed. The comment asserts live callers
  that do not exist — the `MAP_UNRENDERED_FRAMEWORK` shape exactly.
- **`dataKeyLikePattern`** (`src/ir/util/tenant-stance.ts`) — "The reference implementation
  — the emitters spell this in their own language, and **the structural test compares their
  behaviour against this**". No test references it. The sibling constant it sits on
  (`DATA_KEY_LIKE_ESCAPED_CHARS`) IS live in `src/generator/_expr/subtree-like.ts`; only
  the reference implementation is orphaned. A cross-backend oracle with no test attached
  to it is a gate that never reached what it named.
- **`PG_RESERVED_IDENT_WORDS`** (`src/generator/sql-reserved.ts`) — "for tests that want to
  enumerate it". None do.
- **`isJavaKeyword`** (`src/util/naming.ts`) — an eleven-line comment calling it "the
  predicate behind `src/generator/java/java-ident.ts`'s `isMangled`". `isMangled` is
  `jid(name) !== name` and has never called it. The comment (and the frozen
  `wave-c2-2d-java.md` row that repeats the claim) outlived the wiring.
- **`PACK_CHROME_PGETTEXT_CALL`** (`src/generator/_packs/pack-chrome.ts`) — "exported so
  tests can assert on the emitted call without re-spelling it". The only test that greps
  greps its `t(` twin.
- **`HEADING_SCALE_PX` / `HEADING_TOLERANCE_PX`** (`src/generator/_packs/spacing-contract.ts`)
  — "the typography half of the contract … measured the same way, **by the same gate**".
  `scripts/measure-pack-spacing.mjs` reads `SPACING_CONTRACT` only. `docs/design-packs.md`
  § "The typography half" described this as a shipped gate; **that section is corrected in
  this packet** to say plainly that the ladder is documented and NOT gated, keeping the
  measured numbers (the 14px/60px divergence) as the motivation for whoever builds the probe.

### 4b. Half-finished removals — a superseding API landed, the old one was left

- **`generateJava`** (`src/generator/java/index.ts`) — "Legacy / **test** entry", called by
  no test; `generateJavaForContexts` / `emitProjectFromContexts` superseded it. Its deletion
  also freed three now-unused imports (`lowerModel`, `enrichLoomModel`, `Model`) — the java
  backend no longer reaches into the lowering phase at all.
- **The five `REACT_/SVELTE_/VUE_/ANGULAR_/LIVEVIEW_DESIGN_PACKS`** (`src/cli/new-templates.ts`)
  — residue of the refactor documented five lines above them, which replaced a hand-written
  per-format list with `DESIGN_PACKS` + `designPacksForFormat(format)`. Callers moved to the
  function; the five aliases were never removed.
- **`OutlineAggregate`** (`src/diagnostics/contract.ts`) — `@deprecated alias of OutlineDecl
  kept for back-compat`, with no back-compat consumer anywhere. A deprecation that outlived
  everything it was deprecated for.
- **`ApiEmitArgs` / `ApiEmitResult`** (`src/generator/elixir/api-emit.ts`) — the signature
  types of an emitter that moved to `vanilla/api-emit.ts`; the module's own header already
  says it "now holds only the cross-cutting route vocabulary".
- **`serializeRefCollLines` / `ContainsFind`** (`elixir/vanilla/ref-collection-emit.ts`),
  **`aggregateHasReturningOp`** (`elixir/vanilla/operation-returns-emit.ts`),
  **`eventRecordConfigClass`** (`dotnet/emit/event-store.ts`), **`workflowSlug`**
  (`platform/hono/v4/workflow-eventsourced-builder.ts`), **`storeImportPath`**
  (`angular/store-builder.ts`).

### 4c. Vacuous or identity helpers

- **`isPureExpression`** (`src/language/type-system.ts`) — `return true`, with a comment
  explaining that the check is structurally impossible to fail because the grammar only
  admits an `Expression` in a `function` body. A gate the grammar made unnecessary,
  preserved as a function. Its orphaned section banner went with it.
- **`documentFields`** (`python/repository-document-builder.ts`) — `return agg.fields`,
  "kept exported for the schema's document model to share the id-typing decision". There
  is no sharer and no decision in the body.
- **`serverSpanName`** (`_obs/tracing.ts`) — `` `${method} ${route}` ``; the backends build
  the OTel span name themselves at the request seam.

### 4d. Parity sets that reached 5-of-5 and stopped being asked (the P2-3 shape)

`dotnetSupportsResource` / `phoenixSupportsResource` / `pySupportsResource` — three
identical per-backend `(sourceType, kind)` predicates, in three backends, called by
nobody. Worth flagging to whoever picks up P2-3: this is the same class, and one of its
members had already gone dead.

### 4e. Duplicated logic — the export lost to an inline re-derivation

**`rulesNeedCodePointLength`** (`feliz/form-validators.ts`) — `feliz/wire.ts` computes the
same predicate inline over a different shape (`f.fields[].rules[]` rather than the
exported `ReadonlyMap<string, FelizFieldRule[]>`). Two implementations of one rule, one of
them unreferenced. Flagged rather than unified: unifying is a behaviour-touching change
and this packet's contract is byte-identical emission.

### 4f. The remainder

`brokerTransportOf`, `redisChannelBindings` (`_channels/`), `LambdaExpr`, `ObjectExpr`
(`_expr/target.ts` — dead types in the core contract file), `MetricKey` (`_obs/metrics.ts`),
`workflowParamPayloadsOf`, `isRecordPayloadType` (`_payload/`), `isRegisteredPrimitive`
(`_walker/registry.ts` — "so the language-side check and the generator-side dispatch can
never disagree", which it guarantees for nobody), `isMaterialPack` (`angular/form-fields.ts`),
`felizHasRealtimeHandlers` (`feliz/realtime.ts`), `currentUserRefIsActorId`,
`aggregateStampUsesPrincipal` (`ir/types/loom-ir.ts` — knip's blind spot),
`systemHasApiResourceBindings` (`ir/util/api-resource-binding.ts`), `enclosingEntityPart`,
`isContainmentRef` (`language/ddd-scope.ts`), `isStdFunctionName` (`language/stdlib.ts`),
`lambdaTakesElementOf`, `SymbolOrigin` (`language/type-system.ts`), `dashboardSeriesFor`
(`macros/stdlib/scaffold/_dashboard-shared.ts`), `auditColumn`
(`util/audit-records-table.ts`), `AA_LARGE` (`util/color.ts`), `StructuralConflictError`
(`util/error-defaults.ts`), `isKnownStorageKind` (`util/source-types.ts`).

Deleting them left 12 imports unused, all removed (`biome check --write --unsafe`, on the
ten named files only).

---

## 5. Gates

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `npm run lint` (`biome ci . --error-on-warnings`, CR1-c's ratchet live) | **0 errors, 0 warnings** |
| `npx vitest run` (full fast suite) | **2,111 files passed, 89 skipped; 24,799 tests passed, 7 expected-fail, 1,161 skipped; exit 0** (893 s) |
| **byte-identical emission** | **460/460 jobs identical**, 32,637 emitted files hashed |
| tier-1 mutation proof | fails as quoted in §3 |
| tier-2 mutation proof | fails as quoted in §3 |

### The byte-identical harness

`generate system` over **every** `.ddd` in `examples/`, `web/src/examples/`, `journey/`
and `test/fixtures/corpus/`, the last one **five times** — once per backend, substituting
its `platform: __PLATFORM__` token — for **460** jobs from 152 `.ddd` inputs. Each run's
whole emitted tree is hashed (every path + every byte, sorted); a generation that legitimately refuses
(no `system` block, a validation error) has its stderr captured and compared instead, so
the diagnostic path is covered too, not just the emit path.

```
jobs: 460  (444 emitted, 16 refused)
emitted files hashed: 32637
identical: 460   DIFFERENT: 0   only-before: 0   only-after: 0
```

Before was captured on the pre-deletion `out/`, after on a fresh `tsc -b`. Zero
difference, which is what a dead-code deletion is supposed to produce — and the check that
would have caught it had any of the 52 been reached dynamically.

---

## 6. The 426 module-local exports — measure, characterise, recommend

426 exports are referenced only inside their own module. Composition:

| kind | count |
|---|---|
| interface | 181 |
| function | 122 |
| type | 61 |
| const | 61 |
| class | 1 |
| **types (interface + type)** | **242** |
| **values (function + const + class)** | **184** |

By tree — **267 of 426 (63%) are in `src/generator/**`**:

| dir | all | values only |
|---|---|---|
| `src/generator/elixir` | 55 | 30 |
| `src/generator/java` | 37 | 18 |
| `src/ir/util` | 35 | 9 |
| `src/generator/_walker` | 25 | 5 |
| `src/generator/python` | 23 | 17 |
| `src/generator/flutter` | 21 | 13 |
| `src/generator/feliz` | 18 | 9 |
| `src/ir/lower` | 18 | 6 |
| `src/generator/angular` | 17 | 12 |
| `src/generator/dotnet` | 12 | 7 |

**Recommendation: do not run a sweep. Ratchet it, and let it drain as a side effect.**

The argument, in three parts.

1. **The 242 type exports are mostly NOT a defect.** A type named in an exported
   function's signature must itself be exported or the caller cannot spell the argument —
   `ExprChildVisitor` in `walk.ts`, `ProvLeaf` in `_stmt/leaves.ts`, `AuthEmitArgs` in
   `elixir/auth-emit.ts` are all of this shape. Distinguishing them needs a real type
   checker, not a token scan, and the tool that has one (knip) is blind to the hub module.
   Sweeping this class would be 242 judgement calls to remove roughly zero real surface.
   They are therefore **measured here and exempted from the ratchet**, deliberately.

2. **The 184 value exports are real over-exports, but a sweep is the wrong instrument.**
   They touch ~150 files, 63% of them inside `src/generator/**`, which is the tree with
   the most concurrent PRs in this repo — the exact collision the packet flags. Dropping
   one `export` is a zero-risk edit *in the PR that is already in that file*, and a
   guaranteed rebase conflict in a PR that exists only to drop it. The ratchet turns each
   one into a chore the next toucher clears for free, which is the same economics that
   made the allowlist ratchet work.

3. **A dedicated follow-up packet is not worth its own runner slot**, and a lint rule is
   not available: Biome has no "exported but module-local" rule, and the rule that would
   have it (`typescript-eslint` + `import/no-unused-modules`, or knip) means either a
   second linter or the blind spot in §2.

So: **no CR1 follow-up packet for the 426.** The ratchet at 184 is the whole
recommendation, plus one convention line — *when you touch a file and see an `export` with
no cross-file caller, drop it and lower `MODULE_LOCAL_VALUE_MAX`*. If the number has not
moved in a quarter, that is the signal to reconsider, and the ratchet will be sitting
there holding the measurement.

One caveat for whoever reads the number later: the token scan **under**-reports, because a
same-named export in a second backend counts as a reference (knip found ~250 module-local
exports this scan calls live, mostly name collisions across backends and re-exports from
internal barrels — `src/language/validators/index.ts` re-exports five `checkDeployable*`
functions that only `checkDeployable` itself calls). 184 is a floor, not a census. It is
the right number to *ratchet*, because it can only be argued down.

---

## 7. Three things that are not this packet's, found on the way

Merging `main` into this worktree produced **two integration failures between branches that
were each green alone**, plus one flake. None is caused by the export-surface work, and the
first two meet whoever folds CR1 the moment they merge `main`.

**(a) 18 workflows red on CR1-a's new `workflow-path-coverage` assertion** — "a gate that
claims a whole platform generator tree must watch every shared `src/generator/_*/` seam that
tree imports". The assertion landed on the wave branch; `src/generator/_test/` landed on
`main` in `8787897d` (#2957, typed id/datetime literals in emitted `test` blocks) *after* the
wave branch's base. Together, a change confined to `_test/arg-coercion.ts` could not fire any
backend compile gate. **Fixed here** (`8596c4e5`), mechanically and exactly as the assertion's
own message prescribes — the glob goes next to `_stmt` in every trigger's `paths:` block.
90/90 green after.

**(b) `auth-verifier-doc-honesty.test.ts` red on CR1-b's emitter change.** The test came from
`main` (`08c52c1b`) pinning `jwtVerify(token, await getJwks(), { issuer: ISSUER })`; CR1-b
moved the audience decision to runtime (`VERIFY_OPTIONS = AUDIENCE ? … : …`). The coordinator
had **already fixed this** on their local branch in `fba42f82` ("re-pin the verifier
doc-honesty gate on the runtime options"), one commit ahead of the `origin/` tip this packet
branched from. Resolved by merging that commit in, not by re-deriving it. Worth recording
because the failure is invisible from either branch alone and looks alarming out of context.

**(c) Four contention timeouts, not regressions.** The first full-suite run on this 4-core box
reported `test/conformance/corpus-mutation.test.ts`,
`test/generator/typescript/generator-ts.test.ts` and `test/adapters/node-mikroorm.test.ts`
failing at **227-228 s each** — three unrelated files sitting on the same hook timeout, with
the corpus file taking 653 s against its usual ~95 s at load average 36 — and a later run
tripped `test/e2e/support/docker-probe.test.ts` ("retries, so one slow moment alone is not
read as absence": `expected 'inconclusive' to be 'available'`). All four pass in isolation
(2,387 / 72 / 77 / 10 tests). The identical duration across three unrelated files is the tell;
budget for it if you run the whole suite locally while anything else is on the box.

---

## 8. Files touched

- `test/system/export-surface-census.test.ts` — **new**, the gate.
- 39 `src/` files — the 52 deletions plus the 12 imports they orphaned.
- `docs/design-packs.md` — § "The typography half" corrected: the gate it described does
  not exist (§4a).
- 18 `.github/workflows/*.yml` — the `src/generator/_test/**` glob (§7, not this packet's
  finding).

Nothing was added to `package.json`; knip was installed to measure it and removed again.

---

## Appendix — the knip config, for whoever revisits it

Not checked in (a config for a tool nothing runs is the same spent-carve-out shape §4a
deletes), but recorded here so the tuning does not have to be redone. If knip ever
stops treating an inline `import("…").T` type query as a wildcard use of the module, this
is the starting point and §2 is the probe that decides whether it is fixed.

```json
{
  "workspaces": {
    ".": {
      "entry": [
        "bin/cli.js", "src/cli/main.ts",
        "src/language/main.ts", "src/language/main-browser.ts",
        "src/mcp/index.ts", "src/mcp/bin.ts",
        "src/dap-server/index.ts", "src/dap-server/bin.ts",
        "src/api/index.ts", "src/tools/index.ts", "src/macros/api/index.ts",
        "scripts/*.{mjs,mts,js}", "test/**/*.ts",
        "web/src/**/*.{ts,tsx}", "web/*.{ts,mts}"
      ],
      "project": ["src/**/*.ts", "!src/language/generated/**"],
      "ignore": ["src/language/generated/**", "test/fixtures/**", "out/**", "web/dist/**"]
    },
    "packages/*": { "entry": ["index.ts", "index.js", "bin.js", "*.js"] }
  },
  "includeEntryExports": false,
  "ignoreDependencies": [],
  "ignoreBinaries": []
}
```

| exclusion / entry | what it is for |
|---|---|
| `!src/language/generated/**` + `ignore` | committed `langium generate` output; regenerating it is the contract, not referencing every symbol in it |
| `packages/*` as its own workspace, `entry: index.ts/index.js/bin.js` | publish-shaped workspaces whose entry points are consumed out-of-tree by design; without this knip reports all five as unused FILES |
| `web/src/**` + `web/*` as ENTRY of the root workspace, not a workspace | `web/` is a separate package that imports the toolchain straight from `../src`; entering its files makes those imports count without needing `web/node_modules` installed |
| `src/language/main-browser.ts` | the browser LSP worker — reached from `web/`, not from any `src/` importer |
| `bin/cli.js` + `src/cli/main.ts` | `bin/cli.js` dynamic-imports `out/cli/main.js`, so the source entry must be named too |
| `src/mcp/**`, `src/dap-server/**` | Node-only islands; the publish wrappers resolve the BUILT `out/`, so nothing in-tree imports them (`dead-generator-exports.test.ts` pins `src/mcp/index.ts` in `ALLOW_SHIMS` for the same reason) |
| `src/api/index.ts`, `src/tools/index.ts`, `src/macros/api/index.ts` as entries | documented public surfaces (D-API-TOOLKIT, D-AGENT-TOOLS, `docs/macro-api.md`); with `includeEntryExports: false` their re-exports stop being reported. `src/language/validators/index.ts` is deliberately NOT here — it is an internal barrel, and knip's 25 findings in it are real |
| `test/fixtures/**` | excluded from vitest discovery on purpose; byte-for-byte snapshots, not a test surface |
| `ignoreDependencies: []` / `ignoreBinaries: []` | present because `["*"]` crashes knip 6.37 — `Invalid regular expression: /*/: Nothing to repeat` |

`.hbs` templates and the filesystem-discovered design packs needed no entry: they name no
`src/` export, which the `grep -rIw` sweep in §1 confirmed independently.
