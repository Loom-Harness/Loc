# Wave C1 hand-off — 1g the uncoded-condition ratchet (M-T9.56, gate half)

*Branch `claude/c1-1g-uncoded-ratchet`, cut from `origin/main` @ `bcc1c4c86`.*

**One line:** the gate half of M-T9.56 landed as three shrink-only ratchets, the
uncoded surface is measured at **129 sites (118 errors, 11 warnings) in 12 files**,
and **one** site was drained as the proof the drain path works — leaving **128**
for Wave C4. The `loom.unknown` firing assertion found exactly one live offender on
its first run and it was that same site, so its waiver table ships **empty**.

---

## 1. Measured — the census C4 drains

Scanner: `catalogedSources()` in `test/system/diagnostic-catalog.test.ts` (the same
file list the wording invariants already own), counting the two diagnostic shapes
with no `code:` — Langium's `accept(sev, msg, opts)` where `opts` is absent / not an
object literal / carries no `code`, and the IR-check / macro `{ severity, message, … }`
object literal with no `code`.

| file | uncoded sites | note |
|---|---:|---|
| `src/language/validators/deployable.ts` | 24 | largest row; platform/design/serves/ui-binding family |
| `src/language/validators/statements.ts` | **23 → 22** | one drained here (see §3) |
| `src/language/validators/ui.ts` | 21 | theme props, duplicate pages/apis/params, menu + layout keys |
| `src/language/validators/types.ts` | 15 | operand/convert/default/invariant/derived type mismatches |
| `src/language/validators/match.ts` | 12 | matcher arity + `expect`/`toThrow`/`matches` gates |
| `src/language/validators/datasource.ts` | 9 | resource-knob/kind/storage compatibility |
| `src/language/validators/traceability.ts` | 9 | requirement property/type/status/title/priority/cycle |
| `src/language/validators/structural.ts` | 7 | duplicate parts, derived dupes, containment rules |
| `src/language/ddd-validator.ts` | 6 | duplicate theme/ui/api/storage/resource + api source |
| `src/language/validators/_shared.ts` | 1 | `warnSensitivityDrop` (one helper, many callers) |
| `src/language/validators/repository.ts` | 1 | `requires` must be `bool` |
| `src/language/validators/toplevel-function.ts` | 1 | function return-type mismatch |
| **total** | **129 → 128** | |

`src/ir/validate/checks/**`, `src/macros/expander.ts`, `src/api/evolve.ts` and
`src/api/index.ts` hold **no row** — they are already fully coded, matching the
mission body's "the IR check leaves are clean".

Two numbers the audit stated that this measurement adjusts, both small and both in
the honest direction:

- **129, not 130** (118 errors + 11 warnings, vs the audit's 119 + 11). Measured on
  this tree; the difference is one error site, already drained upstream or never
  matching the audit's shape — not chased, because the ratchet pins what is there
  now, not what was there then.
- **`UNDOCUMENTED_CODES` is 369, not 368** (the mission body's figure). Baseline
  pinned at the live number.

Also measured, and worth recording because it bounds the user-visible blast radius:
**357 standalone tracked `.ddd` files raise `loom.unknown` ZERO times.** The generic
code reaches a user only through a *defect* source, which is why the firing-fixture
population (§2) is the one the assertion targets rather than the clean corpus — and
why no 90-second corpus leg was added to the fast suite for a result that
`ddd-source-census.test.ts`'s zero-error assertion already implies.

### Non-shapes, checked and ruled out

- **Non-`loom.` string codes** (`accept(..., { code: "generic-code" })`): grep over
  all scanned sources → **zero**. The whole uncoded class is "no `code:` at all".
- **A `loom.*` code with no `messages.ts` entry**: already caught — such a site
  either renders `diagMessage("<unknown key>")` (invariant 2, "unknown key") or an
  inline literal (invariant 1). No new gate needed.

---

## 2. Gated — three ratchets, all shrink-only

| gate | file | what it pins | run |
|---|---|---|---|
| **invariant 5** — uncoded-site census | `test/system/diagnostic-catalog.test.ts` + new `test/system/diagnostic-uncoded-baseline.ts` | per-file EXACT count + total, 5 assertions (vacuous-pass guard, no-NEW, no-STALE, exact per-file, exact total) | `diagnostic-catalog.test.ts` 15 tests pass |
| **`loom.unknown` never reaches a user** | `test/system/diagnostic-firing-census.test.ts` | every one of the 89 `FIRING_FIXTURES` sources must raise zero `loom.unknown`; shrink-only waiver `FIXTURES_RAISING_UNKNOWN` (ships **empty**) + a stale-waiver check | `diagnostic-firing-census.test.ts` 210 tests pass |
| **`UNDOCUMENTED_CODES` LENGTH** | `test/system/diagnostic-docs-anchors.test.ts` | list length pinned at **369**, both directions (grow fails; shrink without lowering the baseline fails) | `diagnostic-docs-anchors.test.ts` 118 tests pass |

Why a per-file EXACT count and not a waiver list, recorded in the baseline file's own
header: a code-less site has **no stable key** — line numbers churn under every edit
above them, message text rewords as the check evolves — so a per-site waiver table
would be stale within a week and its staleness would read as a pass. A per-file count
is pinned by construction and ratchets both ways; a row reaching 0 is **deleted**, not
left at 0, same rule as `legacy-generate-path-ratchet.test.ts` / `allowlist-ratchet.test.ts`.

Why the LENGTH baseline is not redundant with the membership check already in that
file: membership ("documented OR listed") is satisfied by *appending the new code to
the undocumented list*. The rule as written therefore read "document it or don't",
and a new code could ship wholly undocumented with nothing watching the total.

---

## 3. Fixed — one site drained, as the proof the path works

`checkEmit`'s unknown-field arm, `src/language/validators/statements.ts`:

```
- accept("error", `Event '${ev.name}' has no field '${f.name}'.`, { node: f, property: "name" });
+ accept("error", diagMessage("loom.emit-unknown-field", { evName: ev.name, f: f.name }), {
+   node: f, property: "name", code: "loom.emit-unknown-field",
+ });
```

The four edits a drain slice owes, all present:

1. wording → `src/diagnostics/messages.ts` (`"loom.emit-unknown-field"`), sited next
   to its IR sibling `loom.workflow-emit-unknown-field` with a comment saying why both
   exist (the IR check only walks WORKFLOW bodies; `checkEmit` sees every `emit`,
   aggregate operations included);
2. docs anchor → `src/diagnostics/code-docs.ts` →
   `06-behavior-and-statements.md#let--emit` (verified live by the anchor test, which
   resolves the slug against the real heading — **not** parked in
   `diagnostic-docs-undocumented.ts`, so the 369 baseline is untouched);
3. firing fixture → `FIRING_FIXTURES["loom.emit-unknown-field"]`, deliberately an
   **aggregate** emit (`create open(...) { emit Opened { …, bogus: owner } }`), i.e.
   the half of the condition the workflow-only IR check never sees and which used to
   reach the user as a bare `loom.unknown` with nothing beside it;
4. baseline row lowered `statements.ts: 23 → 22` in the same commit.

This was **the only** fixture in the firing census raising `loom.unknown` — the gate
found it on its very first run — so draining it is also what makes
`FIXTURES_RAISING_UNKNOWN` empty rather than a one-row waiver. Per the packet brief,
no further sites were drained.

---

## 4. Mutation proofs (file-copy revert throughout — never `git checkout --`)

| # | mutation | assertion that failed | evidence |
|---|---|---|---|
| **a** | added one uncoded `accept("error", \`seeded…\`, {node, property})` to `src/language/validators/repository.ts` | `uncoded diagnostic sites — shrink-only (M-T9.56) > no file grows a NEW uncoded diagnostic` | failure text NAMED the site: `src/language/validators/repository.ts:70 [error] accept("error", \`seeded uncoded condition on '${node.name}'\`, …)`, with `repository.ts: 2 uncoded site(s), pinned 1`. `the per-file count is pinned EXACTLY` and `the total is pinned too` failed alongside. |
| **b** | deleted the `traceability.ts: 9` row from the baseline, site untouched | `no file grows a NEW uncoded diagnostic` → `src/language/validators/traceability.ts: 9 uncoded site(s), pinned 0`, and it printed all nine sites | plus the exact-count and total assertions |
| **c** | drain applied, but the row left at its pre-drain `23` | `no STALE row — a drained file deletes its own line` → `src/language/validators/statements.ts: 22 uncoded site(s) left, still pinned at 23` | this is the assertion that forces a fix to delete its own slack |
| **d** | reverted the §3 call site to its inline uncoded form | `the generic code \`loom.unknown\` reaches no user > loom.workflow-emit-unknown-field's fixture raises no uncoded diagnostic` → received `["error: Event 'Happened' has no field 'bogus'."]` | the gate's *organic* first run had already failed exactly here before the drain — this is the deliberate re-proof |
| **e** | added a seeded `"loom.seeded-undocumented"` catalog entry + its `UNDOCUMENTED_CODES` row (the real shape of "a new code lands undocumented") | `the undocumented-codes LENGTH ratchet > only shrinks` → `expected 370 to be less than or equal to 369` | membership check stayed green throughout, which is the point |

All five files restored by `cp <backup> <path>`; the four diagnostic suites re-run
green afterwards (**350 tests**), and `git status` is clean of the mutations.

---

## 5. Flipped

`docs/new-plan/T9-toolchain-health.md` § M-T9.56 — heading now reads
*"128 validator conditions … — gate half `done`, drain half `open`"*, with two new
subsections: **Gate half — `done`** (the 12-row measurement, the three gates, the one
drained site) and **Drain half — `open` (Wave C4, ~10 slices)**, which states the
per-slice contract: lower your row in `diagnostic-uncoded-baseline.ts` in the same
change; delete the file when the last row goes.

---

## 6. Gates run (counts)

| command | result |
|---|---|
| `npx tsc -b` | clean |
| `npx vitest run test/system/diagnostic-{catalog,docs-anchors,firing-census,message-hygiene}.test.ts` | **350 passed**, 4 files |
| `npx vitest run test/language` | **1897 passed**, 2 skipped, 188 files |
| `npx vitest run test/platform/allowlist-ratchet test/system/gate-ledger test/system/ledger-counts` | 34 passed |
| `npx vitest run test/system/{archived-docs-fence,coverage-guarantee,local-run-mapping}.test.ts` | 325 passed |
| `node scripts/test-typecheck.mjs` | `182 files, 470 errors, src/ clean` — baseline unmoved |
| `node scripts/ledger-counts.mjs --check` | `.md matches the JSON` |
| `node docs/build.mjs` | exit 0, no tracked artefacts |
| `npm run lint` (`biome ci .`) | exit 0 (21 pre-existing warnings, none in touched files) |

Per protocol, the full `npm test` was **not** run (four cores shared).

---

## 7. Handed off — not fixed here

| item | why | what C4 needs |
|---|---|---|
| **128 uncoded sites** (the table in §1) | the drain is Wave C4's, ~10 slices, ~70–78 h | each slice: wording in `messages.ts`, `code:` at the site, an anchor in `code-docs.ts` (or a row in `diagnostic-docs-undocumented.ts` — which then requires raising the 369 baseline deliberately), a `FIRING_FIXTURES` entry so the new code lands in a bucket, and the baseline row lowered in the same change |
| **`docs/new-plan/completion-waves-2026-09.md`** rows 49 / 124 still say "~130" and describe 1g as pending | outside this packet's tree fence (it fences `T9-toolchain-health.md`'s M-T9.56 heading) | coordinator: row 49's target is unchanged (0); the "current" column is now **128**, and 1g's row can be marked landed |
| **Three uncoded sites share one wording across files** (`'requires' must be of type 'bool'` at `repository.ts:37`, `structural.ts:288`, `statements.ts:157`, `statements.ts:264`, `types.ts:905`; and the function-return mismatch at `toplevel-function.ts:67`, `types.ts:869`, `types.ts:922`) | draining one of a family leaves an incoherent surface | C4 should slice **by condition family, not by file** for these two — one code, all sites, one baseline change touching several rows |
| **`_shared.ts:1` is a forwarding helper** (`warnSensitivityDrop`, called from `checkEmit` and siblings) | counted as ONE site by design — the drain touches the helper, not its callers | noted so the row moving 1 → 0 is not mistaken for under-counting |

---

## 8. Files touched

```
 src/diagnostics/code-docs.ts                            (+1 anchor)
 src/diagnostics/messages.ts                             (+1 entry, +5 comment lines)
 src/language/validators/statements.ts                   (the one drained site)
 test/system/diagnostic-catalog.test.ts                  (invariant 5: scanner + 5 assertions)
 test/system/diagnostic-docs-anchors.test.ts             (UNDOCUMENTED_CODES length ratchet)
 test/system/diagnostic-firing-census.test.ts            (loom.unknown assertion + fixture)
 test/system/diagnostic-uncoded-baseline.ts              (new — the drain list)
 docs/new-plan/T9-toolchain-health.md                    (M-T9.56 heading + two subsections)
 docs/new-plan/waves/handoffs/wave-c1-1g-uncoded-ratchet.md  (this note)
```
