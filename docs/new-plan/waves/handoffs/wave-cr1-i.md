# Wave CR1 — packet i

The two rows CR1-a left as **"found, not fixed"** (`wave-cr1-a.md` § *Found but not fixed*,
items 1 and 2), both of them the same shape as **P0-3**: a gate whose name is on the pull
request and that, for the change in front of it, never ran.

Base: the batch-1 CR1 tree (`claude/loom-code-review-audit-790gec` @ `be2e3349`) merged onto
`origin/main` @ `4b4b76ec`. Branch: `worktree-agent-a643d54be86374b2e`.
Commits: `205a6049` (merge) → `9492c572` (row 2) → `054852c9` (row 1) → HEAD (row 2's third
variant, plus this hand-off). Range: `205a6049..HEAD`, 3 commits, 27 files.

Gates, all on the final tree: `npx tsc -b` clean; `npm run lint` clean — **0** warnings, and
CR1-c's `--error-on-warnings` ratchet is live, so that is enforced rather than tolerated;
`docker://rhysd/actionlint:latest -pyflakes=` with `SHELLCHECK_OPTS=--severity=warning` clean
over every workflow (exit 0), which is `workflow-lint.yml`'s exact invocation.

`npx vitest run test/system` was run in full **twice** and came back green both times —
`102 passed | 1 skipped`, **2262** then **2267** assertions, 0 failed — the second covering
every substantive change here. The box was then saturated by parallel agents' suites (load 11+
on 4 cores) and a third full run had not returned, so the final confirmation on the exact
committed tree is the exhaustive set of `test/system` suites that read `.github/workflows/**`
— all **10** of them: `draft-gate`, `flake-budget`, `local-run-mapping`,
`main-red-alarm-coverage`, `merge-queue-readiness`, `pr-gate`, `skip-gate-reachability`,
`workflow-artifact-uploads`, `workflow-npm-scripts`, `workflow-path-coverage` →
**769 passed, 18 skipped, 0 failed** (115 of them in `workflow-path-coverage.test.ts`). The
only delta between the second full green run and the committed tree is two `expect` failure
MESSAGES and this hand-off file.

> **Note for the coordinator.** The worktree was handed to me on plain `origin/main`, *not* on
> the batch-1 tree, so CR1-a's derived seam requirement was **absent**. I merged
> `claude/loom-code-review-audit-790gec` in myself (`205a6049`), exactly as CR1-e's worktree
> did — the fold should expect that merge commit.

---

## Row 1 — `paths:` were unioned across triggers

### The measurement (derived, not inherited)

CR1-a said "roughly 14". Measured on this tree it is **20** — the difference is the six
`behavioral-e2e-*` legs, which row 2 of this packet is what made visible to the gate in the
first place. The measurement is a per-trigger re-read of every workflow's `paths:` blocks
(the script is `globsByTrigger` in the test file; a throwaway copy was run standalone first).

**The shape is uniform.** All twenty carry `src/ir/**` on `pull_request:` and carry the other
four generation-path dirs on `push:` only. So a change confined to `src/util/naming.ts`,
`src/util/code-builder.ts`, `src/macros/prelude.ts`, `src/language/**` or `src/system/**` fired
**none of these twenty on a PR**.

Costs are median job wall-clock over the last 5 successful runs (11 for the two boundary
cases), read off the Actions API on 2026-09-21. The `/timing` endpoint returns zeroes for this
org, so job `started_at → completed_at` summed over non-skipped jobs is the runner-slot proxy.

| workflow | `pull_request:` missing | seams missing (trigger) | median runner-min | disposition |
|---|---|---|---|---|
| `hono-obs-e2e.yml` | language, macros, system, util | — | **1.0** | fixed |
| `python-obs-e2e.yml` | language, macros, system, util | — | **1.0** | fixed |
| `dotnet-obs-e2e.yml` | language, macros, system, util | — | **1.2** | fixed |
| `python-oidc-e2e.yml` | language, macros, system, util | `_auth` (**push**) | **1.3** | fixed |
| `java-obs-e2e.yml` | language, macros, system, util | — | **1.4** | fixed |
| `dotnet-oidc-e2e.yml` | language, macros, system, util | `_auth` (**push**) | **1.5** | fixed |
| `hono-oidc-e2e.yml` | language, macros, system, util | `_auth` (**push**) | **1.6** | fixed |
| `java-oidc-e2e.yml` | language, macros, system, util | `_auth` (**push**) | **1.8** | fixed |
| `elixir-vanilla-obs-e2e.yml` | language, macros, system, util | — | **1.9** | fixed |
| `elixir-vanilla-vo-e2e.yml` | language, macros, system, util | — | **2.0** | fixed |
| `generated-vue-e2e.yml` | language, macros, system, util | `_adapters _expr _payload _trace` (PR) | **2.6** | fixed |
| `behavioral-heex-ui-e2e.yml` | — | 16 seams (PR) | **2.6** | fixed |
| `generated-svelte-e2e.yml` | language, macros, system, util | `_adapters _expr _payload _trace` (PR) | **2.7** | fixed |
| `generated-react-e2e.yml` | language, macros, system, util | `_adapters _expr _payload _trace` (PR) | **2.8** | fixed |
| `generated-angular-e2e.yml` | language, macros, system, util | `_adapters _expr _payload _trace` (PR) | **4.7** | fixed |
| `behavioral-e2e-python.yml` | language, macros, system, util | 15 seams (PR) | **5.0** | **declared** |
| `behavioral-e2e-dapper.yml` | language, macros, system, util | 15 seams (PR) | **7.8** | **declared** |
| `behavioral-e2e-dotnet.yml` | language, macros, system, util | 15 seams (PR) | **8.9** | **declared** |
| `behavioral-e2e-mikroorm.yml` | language, macros, system, util | — | **10.9** | **declared** |
| `behavioral-e2e-elixir.yml` | language, macros, system, util | `_test` (PR) | **12.6** | **declared** |
| `behavioral-e2e-java.yml` | language, macros, system, util | 15 seams (PR) | **13.1** | **declared** |

(`playground-realm-check.yml` joined the list later — see *Row 2, third variant*.)

**Marginal cost, measured rather than guessed.** A PR that touches these four dirs *and*
`src/ir/**` already fires every one of these legs, so the added firings are only the PRs that
touch the four and **not** `src/ir/**`: **17 of 123** first-parent `src/`-touching commits
between 2026-09-01 and 2026-09-21, i.e. **~14 %**, ~1 PR a day at the current cadence.

### The split, and why there

* **Fixed — 15 workflows, 1.0–4.7 runner-min, ~32 together.** At ~14 % of `src/` PRs that is
  ~32 runner-minutes a day. That is less than one behavioural leg, for gates that currently
  name a backend and cannot see the code that emits it. No budget argument survives contact
  with those numbers, so their `pull_request:` blocks were simply given the generation path
  (and the seams they were missing).
* **Declared — the 6 `behavioral-e2e-*` legs, 5.0–13.1 runner-min, ~58 together.** They share
  their path claims, so they fire as **one family**: six simultaneous slots out of a shared
  ~20, on the leg family that is already this repo's timeout problem child (`behavioral-e2e-java.yml`'s
  own header records a 20 → 30 min cap raise after the cap censored 13 of ~74 runs). Doubling
  the per-PR footprint of that family is a runner-budget decision, not a bug fix, and CLAUDE.md
  is explicit that the pool is the constraint. **So it is declared, not silently inherited.**

The boundary is genuinely narrow — `generated-angular-e2e` at 4.7 is fixed, `behavioral-e2e-python`
at 5.0 is declared — and I am not pretending otherwise. The tie-break is not the 0.3 minutes;
it is that python has no path claim that would separate it from the family burst, whereas the
angular leg fires alone.

### The register is not a comment

`PR_TIER_DECLARED` in `test/system/workflow-path-coverage.test.ts` carries, per entry, a
`reason`, the measured `costMin` and the `measured` date. Four checks ratchet it:

1. **`costMin >= 4`.** A cheap gate has no budget argument to make; the register refuses it and
   says "fix the pull_request block instead."
2. **The fallback must exist AND be compliant.** The whole claim is "this runs on `push: main`
   instead", so the workflow's `push:` block is required to satisfy *both* invariants itself.
   A declaration cannot be a claim about nothing.
3. **Staleness, both directions.** An entry whose `pull_request:` block becomes compliant fails
   as dead weight (one-line deletion); an entry naming a workflow that is not a generation gate
   fails too.
4. **The cost claim expires after 180 days.** This is CR1-d's lesson applied to the *input*
   rather than the verdict: the decision is standing, but the number it rests on is not, and 23
   census waivers became permanent invisibly because nothing re-evaluated what they rested on.

Every other trigger has nothing underneath it, so there is no waiver to grant for one — which
is how the four `*-oidc-e2e` legs' **`push:`-side** `_auth` gap got fixed rather than excused.

### Comment scrub

Nine workflows asserted the behaviour this row removes — *"the coverage test unions globs
across triggers, so this block only needs the per-PR blast radius"*. All nine are gone.
`elixir-vanilla-obs-e2e.yml`'s anti-burst note was the honest one, and it now states the price
instead of implying it is not paid: a generation-path change **does** wake all five obs legs,
at ~14 % of `src/` PRs × ~1–2 runner-min each.

### Mutation proofs

Both reverted with `cp` from a scratchpad copy, never `git checkout --` (§84).

**(1) One trigger only — the row's exact shape.** Deleted the four generation-path globs from
`java-obs-e2e.yml`'s `pull_request:` block, leaving them on `push:`:

```
FAIL  test/system/workflow-path-coverage.test.ts > java-obs-e2e.yml watches every
      pipeline phase it depends on, per trigger
AssertionError: java-obs-e2e.yml filters on `paths:` but a trigger's OWN block does not watch:
  pull_request: src/language/**, src/macros/**, src/system/**, src/util/**
…
Globs are NOT unioned across triggers here: a `push: main` block does not cover the pull
request, which is where the gate's name is shown.
  … expected [ Array(1) ] to deeply equal []
```

Exactly one test failed (1 failed | 109 passed), it named the trigger, and it named exactly
the four globs removed — the gate is not passing on a coarser signal. Restored → 110/110.

**(2) The register is not a blank cheque.** With that mutation still in place, added
`java-obs-e2e.yml` to `PR_TIER_DECLARED` with its real (cheap) cost. The per-gate assertion
duly fell silent — and the hygiene check caught it:

```
FAIL  … > every PR_TIER_DECLARED entry names a real generation gate and carries a
      measured cost
AssertionError: java-obs-e2e.yml declares 1.4 runner-min — below 4, so it has no budget
argument to make.  Fix the pull_request block instead.: expected 1.4 to be greater than
or equal to 4
```

This one matters more than (1): it proves the escape hatch cannot be used to make the gate
quieter, which is the failure mode a register invites.

---

## Row 2 — `behavioral-e2e-*.yml` were not recognised as generation gates

### The bug

`workflow-path-coverage.test.ts` derived "is this a generation gate" from two signals: a
resolved `test/**.test.ts` entry point, or an inline `bin/cli.js generate` in the workflow
source. Each `behavioral-e2e-*` leg runs `node run-<backend>.mjs` from `working-directory:
test/behavioral`, and the CLI spawn lives in *that* file. So the family scored non-generation
and **every assertion in the file skipped it in silence**, CR1-a's new seam requirement
included.

### The fix

`mjsDrivers` (now folded into `entryPoints`) collects `node …/x.mjs` from `run:` steps,
tracking the step's `working-directory:` and stripping `$GITHUB_WORKSPACE/`; `resolveSpec`
resolves `.mjs` specifiers so the driver's own import closure is walked.

**Recognised generation gates: 40 → 47.** The seven are
`behavioral-e2e-{dapper,dotnet,elixir,java,mikroorm,python}` and `behavioral-heex-ui-e2e`
(`behavioral-e2e.yml` and `behavioral-ui-e2e.yml` were already in, through `.test.ts` paths).

### The third variant of the same blindness

Once the reader followed one indirection it was worth asking what else it did not follow. The
answer, measured (`npm run` invocations resolved against each step's own `working-directory`
package.json, across all ~65 workflows) is **bounded and small**: only `web/` scripts, and only
two workflows that were not already gates. `playground-realm-check.yml` runs
`npm run e2e:realm` with `working-directory: web`, so the script lives in `web/package.json` —
invisible to a root-only lookup — and the driver it names, `web/scripts/smoke-runtime.mjs`,
reaches the composer through the **built** `out/system/index.js`, which a source-only closure
can never see. Both halves fixed (`pkgScripts`, and `DRIVES_GENERATION_RE` gaining the `out/`
arm).

**Recognised generation gates: 47 → 49** (`playground-realm-check.yml`, `pages.yml`).
I stopped there deliberately: the measurement says there is nothing else behind that
indirection, so this is a closed hole, not the start of an open-ended widening.

Both halves mutation-proved, each reverted by `cp`:

```
# `npm run` resolved against the root package.json only (the pre-fix reader)
FAIL  … > follows `npm run` into a nested package.json, and the BUILT composer
AssertionError: the `npm run e2e:realm` indirection through web/package.json is not being
followed: expected [] to include 'web/scripts/smoke-runtime.mjs'

# DRIVES_GENERATION_RE's `out/` arm removed
FAIL  … > follows `npm run` into a nested package.json, and the BUILT composer
AssertionError: smoke-runtime.mjs reaches the composer only through the BUILT
out/system/index.js — DRIVES_GENERATION_RE must keep its `out/` arm:
expected false to be true
```

One test failed each time (1 failed | 110 passed), and 115/115 after each restore. The
second matters because the mutation makes the gate *quieter*: without the pin,
`playground-realm-check` would simply have gone back to being invisible.

### What the now-reaching assertions found

Letting the assertions reach the family turned up real work — mostly *not* in the family:

1. **`src/generator/_test/arg-coercion.ts` was dark in 17 workflows.** That seam landed in
   #2957, which merged into `main` *after* the batch-1 branch was cut, and it is the shared
   typed-test-literal rule all five backends import. Every workflow claiming a whole platform
   tree now watches `src/generator/_test/**`. (This is also a live demonstration that CR1-a's
   derived requirement works: the seam set is computed, so a NEW seam is required of everyone
   the day it appears — nobody had to remember.)
2. **The family passes the generation-path invariant only through the trigger union** — their
   `push:` blocks are broad `src/**`, their `pull_request:` blocks are `src/ir/**` + one
   backend + `_expr`. That is row 1, and it is why the two rows compose: row 2 made the family
   visible, row 1 made the union stop excusing it. Six of them are now in `PR_TIER_DECLARED`
   with a measured cost rather than passing quietly.
3. **`behavioral-heex-ui-e2e.yml` was missing 16 of the 17 seams** its platform claim reaches.
   Cheap leg (2.6 min) → fixed outright.
4. **`playground-realm-check.yml` was missing 14 seams** and the whole generation path on its
   only filtered trigger. Cheap (1.0 min) → fixed outright.

### Mutation proofs

The packet is right that a fix to a SKIP is worthless without showing the assertions now reach
the family. Proved in both directions, one seeded defect, two readers.

**(a) The family is classified, and the count changed.** With the fix reverted (the
`mjsDrivers` call in `entryPoints` commented out — a one-line mutation, restored by `cp`), the
suite drops from **110 tests to 96** — fourteen fewer, exactly 7 workflows × 2 per-gate
assertions — and the two new pins fail:

```
FAIL  … > recognises a workflow that generates through a `.mjs` case driver
AssertionError: behavioral-e2e-dapper.yml is not recognised as a generation gate:
expected false to be true

FAIL  … > every PR_TIER_DECLARED entry names a real generation gate and carries a measured cost
AssertionError: behavioral-e2e-dapper.yml is not a path-filtered generation gate:
expected undefined to be defined
```

**(b) A seeded seam gap FAILS where it used to pass in silence.** Deleted
`- 'src/generator/_payload/**'` from `behavioral-heex-ui-e2e.yml`'s `pull_request:` block:

```
FAIL  … > behavioral-heex-ui-e2e.yml watches every shared generator seam its platforms
      delegate into, per trigger
AssertionError: behavioral-heex-ui-e2e.yml claims a whole platform generator tree in a
trigger's block but that same block does not watch:
  pull_request: src/generator/_payload/**
  … expected [ Array(1) ] to deeply equal []
```

Then, **with that seed still in the tree**, reverted the row-2 fix and re-ran: the string
`_payload` appears **zero** times in the whole report, and the test that names the file does
not exist in it. Not passing — *absent*. That is the row in one measurement: a skipped
assertion and a passing one are the same line in the report.

Same seed on a literal `behavioral-e2e-*.yml`: narrowing `behavioral-e2e-java.yml`'s **`push:`**
block (the one trigger its register entry does not excuse) from `src/**` to an enumerated
platform claim fires two assertions —

```
FAIL  … > behavioral-e2e-java.yml watches every shared generator seam its platforms
      delegate into, per trigger
FAIL  … > every PR_TIER_DECLARED entry really has the post-merge tier it falls back on
AssertionError: behavioral-e2e-java.yml's pull_request block is declared post-merge-only,
but its push block does not cover src/generator/_adapters/**, …(16) either — so nothing
covers it at all.
```

— and with the row-2 fix reverted, **zero**. Every mutation restored by file copy; the tree
was verified clean and 110/110 (then 115/115) green after each.

---

## Vacuous-success pins added

Each new derivation gets a pin, because each one is a place where the gate could go quiet
instead of loud:

* `globsByTrigger` really separates triggers — asserted on `behavioral-e2e-java.yml` that the
  **union** watches `src/util/**`, the **push** block watches it, and the **pull_request**
  block does not. If those ever agree, the pin says so rather than passing.
* The per-trigger check is not degenerate: >20 generation gates really have two filtered
  blocks, and `PR_TIER_DECLARED` is non-empty.
* The `behavioral-e2e-*` family is asserted to be generation gates **via a `.mjs` entry and NOT
  via an inline `bin/cli.js`**, plus `run-java.mjs`'s own closure is asserted to reach the CLI —
  so `generates` cannot be riding on some other signal.
* `playground-realm-check`'s entry resolves to `web/scripts/smoke-runtime.mjs`, whose closure
  `generates` **and** does *not* contain `src/system/index.ts` — so the pin cannot pass with
  the `out/` arm of `DRIVES_GENERATION_RE` removed.

---

## Found but not fixed

1. **These twenty legs now fire more often, and nobody has watched them do it.** The marginal
   cost is measured (~14 % of `src/` PRs, ~32 runner-min for the fixed tier) but it is a
   projection from historical commit shapes, not an observation. If the runner pool complains,
   the honest lever is to **narrow the platform claims** of the obs/oidc legs — the escape
   hatch CR1-a built, and the one `elixir-vanilla-obs-e2e.yml` already demonstrates — not to
   re-exempt the generation path.
2. **`PR_TIER_DECLARED` will expire on 2027-03-20.** Six entries, all measured 2026-09-21. When
   the 180-day check fires, the right response is to re-measure with the Actions API (`jobs`
   endpoint, median of `started_at → completed_at` over the last 5+ successful runs), not to
   push the date. The java leg's warm-Gradle-daemon fix projects it at ~7.5 min, so at least
   one of these numbers is already due to fall.
3. **The behavioural family is still the blind spot the wave named, one level down.** Six legs
   that boot five real backends do not run on a PR that touches only `src/util/naming.ts`.
   That is now a written, measured, expiring decision instead of an accident — but it is still
   a gap, and it is the obvious candidate for the next runner-budget conversation. The cheapest
   partial fix, if someone wants one without the full 58 runner-minutes, is to promote **one**
   leg (python at 5.0 min is the cheapest) and leave the other five declared.
4. **`test.yml`'s own `paths:`** were not examined — it runs unfiltered on PRs so the invariant
   is vacuous for it, but it is the one gate where "per-trigger" could hide something and this
   packet did not look.
5. **No workflow files were added, so `docs/testing.md` and the `loom-ci-gates` skill table
   needed no new rows** — but the *tier* of fifteen legs changed materially (their per-PR blast
   radius is now the whole generation path). If the skill's per-workflow rows quote path
   filters, they are now stale; `docs/` and `.claude/` are both outside this packet's fence.
