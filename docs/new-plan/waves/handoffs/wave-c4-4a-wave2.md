# Wave C4 · packet 4a (Wave 2 follow-through) — hand-off

*Branch: `claude/c4-wave2`. Base: `0a00c3723` (the C4 coordinator head =
`main` @ `a45fc948b` + the wave log). Commit range `0a00c3723..HEAD`,
six commits. Tree fence: `src/generator/**` (no emission change),
`test/system/**` (new files only), `scripts/**`,
`docs/new-plan/waves/wave-2.md`, the rows closed. Never pushed; the wave PR is
the claim.*

| # | row | outcome |
|---|---|---|
| 1 | byte-identical re-check of the corpus snapshots on the merged `main` | **done — clean.** Table below. A new wide instrument, `scripts/capture-corpus-snapshot.mjs`, is the thing that makes this repeatable |
| 2a | `exStr` deleted (the `elixirString` duplicate) | **already done, verified.** Wave 2 packet 2.2 deleted it; `src/generator/elixir/vanilla/seed-emit.ts:34` imports `elixirString` and `:45-52` records why. **One more of the same class found and fixed** — see below |
| 2b | `elixirString` / `elixirRegexBody` enforcement | **done.** `test/system/target-string-funnel-census.test.ts`; elixir is the enforced root and is clean; flutter/feliz measured, baselined and handed off |
| 3 | §F queue rows F2 / F3 / F5 | **F2 done (re-confirmed), F3 flipped `PARTIAL` → `done`, F4 and F5 still open with mission ids.** Table in [`../wave-2.md`](../wave-2.md) §"§F queue — re-verified" and in the audit's own §F table |
| 4 | the seeder contract's remaining readers | **none bypass** — all five read the shared model. The hole that *was* open is the census's **denominator**; closed by `test/system/seeder-contract-denominator.test.ts` |

---

## Row 1 — byte-identical, on the merged tree

Two instruments, because the committed one covers a single entry point.

| instrument | scope | result |
|---|---|---|
| `scripts/capture-baseline-fixture.mjs` → `test/fixtures/baseline-output/` | `examples/acme.ddd`, 288 files | **byte-identical** to what is checked in (`diff -r` exit 0, 0 lines). Re-run again after the `src/generator/**` edit: still identical |
| `scripts/capture-corpus-snapshot.mjs` (**new**) | every `test/fixtures/corpus/*.ddd` × the five `__PLATFORM__` clauses = **395 cells**, **26,424 emitted files**, sha256 per emitted path | **all 395 cells generate** (0 validation errors, 0 throws) on the merged head; **byte-identical** across this packet's `src/generator/**` edit (`--diff` → "BYTE-IDENTICAL: 395 cells, no emitted file differs") |

**No non-identical byte anywhere, so no change to attribute and no defect to
hand off.** Note for whoever reads the wave-2 fold note next: the two
non-determinisms the 2.2/2.5 folds had to normalise (the per-run elixir
`SECRET_KEY_BASE`, the `.ddd` path inside .NET `#line` directives) are **gone**
— `SECRET_KEY_BASE` now comes from `deterministicHex` (`src/platform/elixir.ts:93`)
and the `#line` path is stable within one worktree. Proved rather than
assumed: two consecutive captures on an unchanged tree diff clean, which is
the first thing the instrument was made to check.

`capture-corpus-snapshot.mjs` runs the same `generateSystems` entry point
`ddd generate system` runs (in-process; ~60 s for the whole matrix instead of
~20 min of CLI starts) and records, per cell, either the per-path hash map or
the exact validation/throw text — so a cell that stops generating is a diff
too, not a silent disappearance. Usage is in its header.

## Row 2 — the escape funnels

### 2a — the `exStr` duplicate

Already deleted (wave 2 packet 2.2). Verified on the merged tree. **But the
class was not gone:** `src/generator/elixir/heex-primitives.ts` still carried a
second, *partial* copy of the HEEx attribute funnel —

```ts
` label="${label.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`
```

— against `escapeHeexAttr` (`heex-walker-core.ts:1926`), which escapes `&`,
`"`, **`<` and `>`**. `label` there is a `.ddd` string literal
(`arg.kind === "literal" ? arg.value`), so a label containing `<` emitted
broken markup. It now calls the funnel, which the file already imports. This is
exactly what the Wave 1 hand-off predicted for `exStr` — "correct today, and it
will drift" — except this copy had *already* drifted. **Byte-identical across
all 395 corpus cells.**

### 2b — the enforcement scan

`test/system/target-string-funnel-census.test.ts`. The 2.2 census classifies
every `JSON.stringify(` by destination; that is the half that CALLS an escaper.
This one enumerates the **positions** instead, so it sees the half Wave 1 found
by reading 173 call sites twice:

1. a `${…}` sitting between two literal quote characters of the *emitted*
   language (`…"${value}"…`) — no `JSON.stringify` appears anywhere, which is
   why the 2.2 census is structurally blind to it, and it is the shape every
   one of Wave 1's nine live Elixir sites had;
2. an inline `.replace(…)` escape chain in that position — the `exStr` shape,
   a second implementation of an escaper that already exists;
3. a `${…}` inside an Elixir `~r/…/` sigil body.

Classification: a site is safe when it heads a funnel/naming-normalizer call,
or when every risky identifier it names resolves — through the nearest
preceding same-file `const` — to one. TS string/regex literals are stripped
before tokenizing (a token inside one is a compile-time constant of the
emitter's own source) and safe calls' argument regions are stripped (what
reaches the output is the return value). A binding whose own initialiser names
the identifier being resolved cannot vouch for it, and a binding that is itself
an inline escape chain is unsafe — both rules were added because the first cut
passed real bypasses.

**Enforcement is per root and deliberate:**

| root | mode | state |
|---|---|---|
| `src/generator/elixir/**` | **enforced clean** — the baseline carries no elixir row, asserted explicitly so the property is stated and not implied by an absent key | 0 bypasses after the `heex-primitives.ts` fix |
| `src/generator/flutter/**`, `src/generator/feliz/**` | shrink-only exact per-file baseline (the `diagnostic-uncoded-baseline.ts` rule) | 13 sites across 7 files, handed off below |

Waivers ratchet (every one must match a live site) and are split into
`FUNNEL_DEFINITIONS` (the five canonical escapers, which necessarily build a
quoted literal from a `.replace` chain) and `REVIEWED_SAFE` (6 sites: the
toolchain-authored `APP_SHELL_CHROME` text, four `_obs/` metric-catalogue
constants, and flutter's guarded raw-`RegExp` pair).

**Mutation-proved three ways** (file copy backup, md5-verified on restore —
never `git checkout --`):

| mutation | failing assertion |
|---|---|
| revert the `heex-primitives.ts` fix to its inline `.replace` chain | `src/generator/elixir/** is funnel-clean — the enforced root`, naming `src/generator/elixir/heex-primitives.ts:2003 [quoted] ${label.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}` |
| `~r/${elixirRegexBody(p.pattern)}/` → `~r/${p.pattern}/` in `changeset-validators.ts` | `every \`~r/…/\` sigil interpolation reaches \`elixirRegexBody\``, naming `src/generator/elixir/vanilla/changeset-validators.ts:110 [sigil] ${p.pattern}` (and the elixir-clean assertion too) |
| add a waiver for a site that does not exist | `every waiver is consumed by a live site (waivers ratchet)`, naming `src/generator/elixir/telemetry-emit.ts  ${Metrics.someRetiredMetric.help}` |

### The per-target measurement the row asked for

**dotnet / java / python: no equivalent gap, and no scan needed.** Their
double-quoted string literal has no interpolation form at all (C# needs `$"`,
Python needs `f"`, neither is ever used for a splice), so `JSON.stringify`'s
escaping is already complete target syntax — which is what
`_expr/target.ts`'s `escapeStringLiteral` doc says and what the 2.2 census
already asserts per directory. They are excluded from the scan by that
reasoning, stated in its header.

**The `~r/` half is small and clean.** Seven `~r/` sites under
`src/generator/elixir/**`, five of them fixed patterns; the two that
interpolate (`changeset-validators.ts:110`, `render-expr.ts:761`) both reach
`elixirRegexBody`. The gate now keeps it that way.

**flutter and feliz DO have the equivalent gap, and it is the `exStr` class
again — one escaper per target, spelled several ways with different escape
sets.** Scan only, per the fence; nothing emitted was changed. Hand-off
details below.

## Row 3 — the §F architecture queue

Full table with evidence in [`../wave-2.md`](../wave-2.md) §"§F queue —
re-verified 2026-09-22", and the audit's own status table
(`docs/audits/generator-code-review-2026-08-24.md` §"Architecture queue (§F)")
is restamped to this head so the two cannot drift apart again. Short form:

- **F2** (emission mode explicit on the shared renderers) — `done`, already
  recorded, re-confirmed: `QUERY_EMISSION_MODES`/`QueryEmissionMode` at
  `src/generator/_expr/target.ts:470`, `test/generator/_expr/emission-mode.test.ts`
  present and green.
- **F3** (one ref-walker per IR family) — **flipped `PARTIAL` → `done`**. The
  audit table was the stale copy; ledger `G2667-F3` has read `done` under
  #2770 since packet 2.3. The residue row 16 named is gone
  (`src/generator/python/emit/domain-service.ts:256-258` is two lines over
  `walkStmtExprsDeep`), and the class is now ratcheted rather than drained once
  by `test/system/ir-walk-census.test.ts` + the `CLAUDE.md` convention.
- **F4** (the realtime contract) — **still open, narrowed → M-T4.12
  (`partial`)**. The contract *is* stated in the shared plan now
  (`src/ir/util/realtime-rooms.ts:154-232`, RULE 1 + RULE 2) with one predicate
  `realtimeStreamCredential` that six frontend emitters call, and the live
  hole is closed on all six frontends. Open: the cross-backend RULE 1
  conformance test (asserted at runtime on node only), the durable-event tee
  at write time (§A9 — stays with M-T4.3), a browser-level runtime leg.
- **F5** (the i18n round-trip gate) — **still open → M-T9.39 (`open`)**. Only
  the A13 *instance* gate exists; the four i18n tests under
  `test/generator/_walker/` are unchanged and the general both-directions gate
  does not exist. Already queued as improvement-wave row 3.6 and
  completion-wave row 3f.
- **B3** — still open; both golden-coverage gates still exist independently.

**Decision wanted from the owner:** `improvement-waves-2026-09.md:162` states
Wave 2's exit as *"the 08-24 §F queue rows F2/F3/F5 read `done`"*. F5 is a
whole mission of size M that two later waves already schedule, so that clause
cannot be met by a follow-through packet. Either the exit clause drops F5 (and
cites M-T9.39), or Wave 2 stays formally open until M-T9.39 lands. Not edited
here — that file is outside this packet's fence.

## Row 4 — the seeder contract's readers

**None of the five bypasses the contract on the merged tree.** Each calls
`seederAggregates(ctx)` and reads `createParams` / `persistenceKind` off the
shared model (`typescript/emit/seed.ts:118,123`, `dotnet/emit/seed.ts:64,147`,
`python/emit/seed.ts:55,193`, `java/emit/seed.ts:59,187`,
`elixir/vanilla/seed-emit.ts:95,117,238,281,298`). The `forCreateInput`
mentions still in `java/emit/seed.ts` are comments recording what it used to
do. `test/generator/_persistence/` is green (36 tests).

**What was still open is the census's denominator**, and it is the M-T9.62
class: `seed-model-census.test.ts` hard-codes its five paths, so a **sixth**
seeding emitter — a new backend, or a versioned backend package under
`src/platform/**`, which the census does not even scan — would re-derive the
create shape and the census would stay green because its list never grew.

`test/system/seeder-contract-denominator.test.ts` closes it: it DISCOVERS every
seeding emitter across `src/generator/**` *and* `src/platform/**` (by the
contract's own export vocabulary, plus the file name, so an emitter that
*bypasses* the contract is still found) and asserts the discovered set is the
pinned five, that the reader census names each one, that each reads the shared
model, and that none imports `forCreateInput`/`createInputFields`. `__loom_seed`
is deliberately **not** a discovery marker — seven boot/migration wiring files
name the ship-once marker table without deriving any create shape, and
`_frontend/default-seed.ts` (a form *default*) is listed as not-a-dataset
rather than pattern-excluded.

**Mutation-proved:** a sixth emitter importing `createInputFields` and
`groupByDataset` (`src/generator/java/emit/seed-mutation-probe.ts`) fails all
four assertions by path, the first being *"a file emits seed datasets that no
reader census covers"*.

---

## Hand-offs (outside this packet's fence — scan only, per the row)

### H1 · Feliz has SIX spellings of "escape an F# string body", with THREE different escape sets

`fsString` (`src/generator/feliz/fs-expr.ts:39`) is the declared funnel and
escapes `\`, `"`, `\n`, `\t`. Beside it:

| site | escapes | delta vs `fsString` |
|---|---|---|
| `feliz-target.ts:938` `escapeText` (the `WalkerTarget` seam every markup text slot goes through) | `\`, `"` | no `\n`, no `\t` |
| `feliz-target.ts:942` `escapeAttr` (the attribute twin, added by wave 2 packet 2.2) | `\`, `"` | no `\n`, no `\t` |
| `feliz-target.ts:913` `renderStringLiteral` (the i18n-off spelling of a user-visible VALUE) | `\`, `"` | no `\n`, no `\t` |
| `feliz-target.ts:900` `renderNotice` | `"` only | no `\`, no `\n`, no `\t` — a backslash in the notice text emits a broken F# literal |
| `feliz-target.ts:763` `modalTriggerLabel(call).replace(…)` | `\`, `"` | inline, at one call site |

**Recipe:** make `fsString` (or a bare-body sibling of it, since `fsString`
returns its own quotes) the single implementation and have the five call it.
Expect byte-identical emission on the corpus — run
`node scripts/capture-corpus-snapshot.mjs` before and after and `--diff`. The
baseline row `src/generator/feliz/feliz-target.ts: 5` in
`target-string-funnel-census.test.ts` then drops to 2 (see H3).

**Open PR overlap: #2966 and #2981 both touch `feliz/feliz-target.ts` and
`feliz/wire.ts`** (a form-record name collision; `For` in a value slot). Cited,
not duplicated — this packet changed no Feliz file. Whoever takes H1 should
land after them.

### H2 · Flutter has FOUR functions named for one Dart string escaper, with three different bodies

| site | escapes |
|---|---|
| `flutter/dart-expr.ts:29` `dartString` (canonical) | `\`, `'`, `$`, `\n`, `\t` |
| `flutter/forms-emit.ts:914` `dartStr` | `\`, `'`, `$` |
| `flutter/form-validators.ts:50` `dartStr` | `\`, `'`, `$` |
| `flutter/auth-gate.ts:251` `dartGateString` | `\`, `'`, `$` |
| `flutter/pack.ts:49` `dartStr` | **identity** — and this one is *correct*: its header states the pack contract (the walker already escaped through `flutterTarget.escapeText`, re-escaping would double every backslash). Not a defect; it is the naming hazard — three `dartStr` in three files, two of which do escape |

Live call sites of the weak copies: `forms-emit.ts:1272`, `:1402` (form
labels), `form-validators.ts:136` (a rule message), `realtime.ts:237`.

**Triage the owner should do rather than a blind fix:** decide per call site
whether a `\n`/`\t` can actually reach it. Where it can, route to `dartString`
(or a bare-body sibling); where it cannot, keep one named seam with the
contract written down the way `pack.ts` does. Byte-identical check as in H1.

### H3 · What the baseline rows mean (so the next reader does not over-claim)

Of the 13 baselined sites, the scan cannot resolve four across files, and
those four are **safe** — recorded here so nobody "fixes" them:

- `feliz-target.ts:240` `${fa.label}` and `:592` `${action.label}` — both are
  `humanize(<ID terminal>)` (`feliz/wire.ts:1284`, `:945`).
- `feliz/pack.ts:452` `${label}` — `c.label` off the walker Ctx, already
  escaped through the `escapeText` seam by the pack contract.
- `feliz/wire.ts:3697` `${msg}` — `FelizFieldRule.message`, compiler-synthesised
  from NUMBER terminals (`feliz/form-validators.ts:92-131`), never `.ddd` text.

They stay in the baseline because the scan is single-file by design (a
cross-file resolver is a type-checker, which is a different instrument); the
baseline is the honest place for "unproven here", and the count moving is
still the signal.

### H4 · `render-expr.ts:761`'s non-literal regex fallback (noted, not a funnel bug)

```ts
const pat = raw?.kind === "literal" && raw.lit === "string" ? elixirRegexBody(raw.value) : args[0]!;
return `Regex.match?(~r/${pat}/, ${recv})`;
```

A NON-literal pattern falls back to the rendered expression *inside the sigil*,
so `x.matches(somePattern)` emits `~r/some_pattern/` — a regex matching the
literal text of the variable name, not the variable's value. Not an escaping
defect (that is why it is waived-by-resolution rather than failing the gate),
but it is a silent wrong-emission and it has no owner. Worth a `loom.*`
refusal or a real runtime `Regex.compile` path.

---

## Local gates (on the merged tree, at `6b890f821`)

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | **469 errors / 181 files — unchanged from the C4 baseline**; the two new test files add none |
| `npm run lint` (`biome ci .`) | clean (3263 files) |
| `npm test` (redirected, exit code appended) | see §"npm test" below |
| corpus byte-identical | **395/395 cells identical, 26,424 files** — and the committed `test/fixtures/baseline-output/` regenerates byte-identical |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | clean |

### npm test

Redirected with the exit code appended, per the rules (a piped `npm test | tail`
can never fail):

```
npm test > npm-test.log 2>&1; echo NPM_TEST_EXIT=$? >> npm-test.log

 Test Files  2148 passed | 89 skipped (2237)
      Tests  25408 passed | 6 expected fail | 1185 skipped (26599)
NPM_TEST_EXIT=0
```

No failures, no starvation timeouts, nothing re-run. Two narrower runs were
taken first as an early signal and are green on their own:
`test/system/` (112 files / 2382 tests, the two new scans included) and
`test/generator/{elixir,_persistence,feliz,flutter}` (343 files / 2196 tests —
the directories the one `src/` hunk and the census's three roots touch).

## Ratchet numbers after this packet

| ratchet | before (C4 baseline) | after |
|---|---|---|
| `test/` typecheck errors / files | 469 / 181 | **469 / 181** (untouched — 4b owns this) |
| uncoded validator sites | 128 / 12 files | **128 / 12** (untouched — 4c owns this) |
| `UNDOCUMENTED_CODES` | 365 | **365** (no new `loom.*` code in this packet) |
| target-string funnel bypasses, elixir | (unmeasured) | **0, enforced** |
| target-string funnel bypasses, flutter + feliz | (unmeasured) | **13 across 7 files, shrink-only** |

## Files touched

- `src/generator/elixir/heex-primitives.ts` — one hunk, the `label` attribute
  through `escapeHeexAttr`. No other `src/` file changed.
- `test/system/target-string-funnel-census.test.ts` (new),
  `test/system/seeder-contract-denominator.test.ts` (new) — both new files, per
  the concurrency rule with 4b.
- `scripts/capture-corpus-snapshot.mjs` (new).
- `docs/new-plan/waves/wave-2.md`,
  `docs/audits/generator-code-review-2026-08-24.md` (the §F status table —
  outside the literal fence list, but it *is* the register the row's "flip to
  done with evidence" lives in; two rows and a header stamp, named here so the
  coordinator can see the whole edit).
