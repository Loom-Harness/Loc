# Wave CR1 — packet a

Rows: **P0-3** (shared generator seams fire no backend compile gate) and **P1-1** (two e2e
suites no CI path can execute), from `docs/audits/code-review-2026-09-13.md`.

Base: `76ef74ad`. Branch: `worktree-agent-a4a6b95e9f77f716f`.
Commits: `c0333aeb` (row 1) → `2b3d37b4` (row 2).

Gates: `npx tsc -b` clean; `npm run lint` clean (24 pre-existing warnings, none in touched
files, exit 0); `docker://rhysd/actionlint:latest -pyflakes= --severity=warning` clean over
every workflow, plus the YAML-parse check `workflow-lint.yml` runs.

`npx vitest run test/system`: one full run of the complete suite came back
`1 failed | 2196 passed | 30 skipped`, the single failure being `draft-gate.test.ts` on the
first placement of the embed job (see the Row 2 disposition) — fixed, then re-verified. The
box was subsequently saturated by three parallel agents' suites on 4 cores (load 19), so the
final confirmation was run as the exhaustive set of `test/system` suites that read
`.github/workflows/**` or `package.json` — the only files this packet touches outside its two
gate files — all 16 of them: `skip-gate-reachability`, `workflow-path-coverage`,
`workflow-artifact-uploads`, `workflow-npm-scripts`, `pr-gate`, `flake-budget`,
`local-run-mapping`, `main-red-alarm-coverage`, `merge-queue-readiness`, `draft-gate`,
`system`, `sourcemap`, `node-debug`, `generation-defaults`, `escape-funnel-census`,
`diagnostic-firing-census` → **1102 passed, 18 skipped, 0 failed**.

---

## Row 1 (P0-3) — shared generator seams

### What I changed, and why that approach

I took **approach (a)**, refined. Approach (b) — flipping the backend gates to `src/**` plus
per-backend `!` exclusions — is immune to this bug class, but it is immune the way a
sledgehammer is: `java-build` would then fire on every `src/generator/vue/**` change unless
somebody remembers to subtract it, and the thing that has to be remembered is exactly the
thing that rotted the first time. (b) trades a hand-maintained positive list for a
hand-maintained negative one.

So the gate now *derives* the required seam set instead of anybody listing it:

> A workflow whose `paths:` claims a **whole platform generator tree**
> (`src/generator/<plat>/**`) must also watch every `src/generator/_*` dir reachable in that
> tree's import closure — **cut at the boundary of any platform dir the workflow does not
> claim**.

Two properties make this hold up:

* **No false positives by construction.** The cut is what buys it. `src/generator/java/index.ts`
  genuinely imports the React/Vue/Svelte/Angular generators (it emits the embedded
  `ClientApp/` bundle), so a naive closure demands `java-build` watch the body walker — which
  it neither compiles nor claims. Cutting at undeclared platform dirs drops that edge and
  leaves only seams java's own emitters import directly (`java/emit/api.ts → _payload/union-wire.ts`,
  `java/render-stmt.ts → _stmt/leaves.ts`, `java/index.ts → _i18n/validation-catalog.ts`,
  `java/emit/entity.ts → _frontend/server-default.ts`, …).
* **The escape hatch is precision, not vagueness.** A gate that wants to stay narrow narrows
  its *platform* claim to subdirs — the way `elixir-vanilla-obs-e2e.yml` already names
  `src/generator/elixir/vanilla/**` — and the rule stops applying to it. You cannot get out
  of it by being less specific.

The rationale comment at the top of `workflow-path-coverage.test.ts` that granted the
original exemption ("those are genuinely per-target") is replaced; it was inverted, and the
inversion is what the review measured.

**Second defect found and fixed in the same file:** the seam matcher has to be `_[a-z0-9]+`.
`_i18n` has a digit in it, so `_[a-z]+` silently drops the one seam that decides
validation-catalog membership for all five backends — a blind spot inside the new gate itself,
found because `_i18n` never appeared in any closure.

### Scope of the workflow fix

**20 workflows.** The 19 the gate now fails, plus `behavioral-e2e-elixir.yml`.

`behavioral-e2e-elixir` passes the gate on its own (the gate unions globs across triggers, and
its `push:` block is broad `src/**`), but its `pull_request:` block listed `_expr` only — and
Elixir is the one backend with **no broad per-PR compile net**, because `corpus-build.yml`'s
`src/generator/**` covers every backend *except* Elixir, which lives in the separately
enumerated `corpus-elixir-build`. So it is fixed too: that is literally the audit's headline
sentence ("a change to `_payload/union-wire.ts` compiles no Elixir project on any per-PR gate").

I deliberately did **not** broaden the per-PR blocks of `behavioral-e2e-{java,dotnet,python,dapper,mikroorm}`
or `generated-{react,vue,svelte,angular}-e2e` — see "found but not fixed" below.

### Before → after

Seam globs (`src/generator/_*/**`) per workflow, counted across all its `paths:` blocks.
The seam list is per-workflow (it is the closure of *that* workflow's platform claim), which
is why the totals differ — elixir gates carry `_walker`/`_packs` (HEEx lives in the elixir
tree), the SQL backends carry `_type`/`_docker`, the frontends carry neither `_stmt` nor `_type`.

| workflow | before | after |
|---|---|---|
| `auth-oidc-compose-e2e.yml` | — (0) | 14 |
| `behavioral-e2e-elixir.yml` | `_expr` (1) | 16 |
| `corpus-elixir-build.yml` | `_expr` (1) | 16 |
| `dotnet-build.yml` | `_expr` (1) | 15 |
| `dotnet-obs-e2e.yml` | `_obs` (1) | 15 |
| `dotnet-oidc-e2e.yml` | `_auth` (1) | 15 |
| `elixir-oidc-e2e.yml` | — (0) | 16 |
| `elixir-vanilla-build.yml` | `_expr`, `_frontend` (2) | 16 |
| `generated-feliz-build.yml` | `_frontend`, `_walker` (2) | 14 |
| `generated-flutter-build.yml` | `_frontend`, `_walker` (2) | 14 |
| `hono-build.yml` | `_expr` (1) | 14 |
| `hono-obs-e2e.yml` | `_obs` (1) | 14 |
| `hono-oidc-e2e.yml` | `_auth` (1) | 14 |
| `java-build.yml` | `_expr` (1) | 15 |
| `java-obs-e2e.yml` | — (0) | 15 |
| `java-oidc-e2e.yml` | `_auth` (1) | 15 |
| `phoenix-ui-e2e.yml` | `_frontend` (1) | 16 |
| `python-build.yml` | `_expr` (1) | 15 |
| `python-obs-e2e.yml` | — (0) | 15 |
| `python-oidc-e2e.yml` | `_auth` (1) | 15 |

Concretely, for the audit's example: a change confined to `src/generator/_payload/union-wire.ts`
now fires `corpus-elixir-build`, `elixir-vanilla-build` and `behavioral-e2e-elixir` per-PR.
Before, it fired none of them.

**Runner-cost note (a real trade, stated plainly).** This is not free: an `_obs` / `_auth` /
`_walker` edit now triggers the obs/oidc legs that already claimed the whole backend tree.
I accepted it because the alternative is the status quo — a gate that names a backend and then
cannot see half of what emits it — and because the rule comes with a cheap, honest way out
(narrow the platform claim; the elixir obs leg is the worked example, and it needed no seam
globs at all as a result). If the runner budget says otherwise, the fix is to narrow those
legs' platform claims, not to re-exempt the seams.

### Mutation proof

Two mutations, both reverted with `cp` from a scratchpad copy (never `git checkout --`,
per `experience_gathered.md` §84).

**(1) Revert the fix in one workflow** — deleted the two `- 'src/generator/_payload/**'` lines
from `java-build.yml`:

```
FAIL test/system/workflow-path-coverage.test.ts > java-build.yml watches every shared
     generator seam its platforms delegate into
AssertionError: java-build.yml claims a whole platform generator tree but does not watch
  src/generator/_payload/**.
  … expected [ '_payload' ] to deeply equal []
```

Exactly one seam named, exactly the one removed — the gate reaches the thing it names, and is
not passing on a coarser signal. Restored → 90/90 green.

**(2) Seed the digit-blind matcher** — narrowed `SEAM_RE` back to `_[a-z]+`:

```
FAIL test/system/workflow-path-coverage.test.ts > the closure walker resolves what it
     claims to > sharedSeams finds the seams a backend claim really reaches
AssertionError: expected [ '_adapters', '_auth', …(12) ] to include '_i18n'
```

Restored → green. The second proof matters because that mutation makes the gate *quieter*, not
louder: without the pin, `_i18n` would just never be required of anybody and every workflow
would still look compliant.

---

## Row 2 (P1-1) — two suites no CI path can execute

### Verified independently

`grep -rn 'LOOM_EMBED_E2E_PHOENIX\|LOOM_AUTH_GATE_E2E'` across the whole tree at `76ef74ad`:
every hit is inside the two test files themselves, one `docs/old/plans/vanilla-phoenix-gaps.md`
line and one `docs/audits/e2e-suite-review.md` line. **No `package.json` script, no workflow,
no helper.** Confirmed.

`embed-react-elixir.test.ts`'s header said it "reuses the phoenix-obs-e2e.yml workflow's
postgres service + BEAM setup". That workflow was renamed to `elixir-vanilla-obs-e2e.yml`;
the rename orphaned the suite and nothing noticed, because nothing *could* — a
`describe.skipIf` skip is indistinguishable from a pass in every report.

### The new gate — `test/system/skip-gate-reachability.test.ts`

Zero-tolerance, no allowlist. Scans every `test/**/*.ts` for
`(describe|it|test)(.\w+)*.(skipIf|runIf)(…)`, resolves the argument's identifiers against
local `const` bindings (transitively, bounded to 4 hops — `PHX_RUN` is built from `ENABLED`
which is built from `process.env.LOOM_*`, and a scanner that only looked inside the call would
find almost nothing and report a clean tree), then requires every `LOOM_*` it finds to be set
by a `package.json` script or a `.github/workflows/*.yml`.

False-positive handling, all three classes the packet warned about:

* **Generated-app env vars** (`LOOM_CHANNEL_LIFECYCLE_BUS_URL`) and **manual tuning knobs**
  (`LOOM_FUZZ_SEEDS`, `LOOM_CORPUS_*_CASE`, `LOOM_WIRE_UPDATE`) are out of scope structurally:
  they are not read inside a skip expression, so the scan never sees them.
* **Escape hatches** — a read whose *unset* state already satisfies the condition, i.e.
  compared with `!==`/`!=`. `test/e2e/e2e.test.ts` has
  `… && process.env.LOOM_E2E_ALLOW_NO_DOCKER !== "1"`: unset means the suite **runs**, so
  nothing is stranded. Classified and excluded — and there is a test pinning that it is still
  *seen*, so the classifier cannot quietly become a blind spot.
* **"a workflow that runs `npm run test:x` counts as setting whatever that script sets"** falls
  out for free: the settable set is the union over package.json *and* the workflows.

Comments are stripped before scanning. This file was its own first false positive: its own
prose contains `` `describe.skipIf(` `` with an unbalanced paren, which made the argument scan
run to EOF and swallow the `process.env.LOOM_X` in a doc comment 60 lines later.

Vacuous-success pins: >60 skip gates found, >50 settable vars found, the identifier-hop
resolution demonstrated on `generated-java-build.test.ts`, and the escape-hatch classification
asserted in both directions.

### Mutation proof

The gate's first run, on the un-wired tree, is itself the proof — it named exactly the two
suites the audit did, and nothing else:

```
AssertionError: These suites skip themselves unless a LOOM_* var is set, and nothing sets it:
  test/e2e/auth-gate-ui-e2e.test.ts — LOOM_AUTH_GATE_E2E
  test/e2e/embed-react-elixir.test.ts — LOOM_EMBED_E2E_PHOENIX
  … expected [ …(2) ] to deeply equal []
```

Re-proved after wiring by reverting one half of the fix — deleted the `"test:embed-phoenix"`
line from `package.json` (restored by `cp` from a scratchpad copy):

```
AssertionError: These suites skip themselves unless a LOOM_* var is set, and nothing sets it:
  test/e2e/embed-react-elixir.test.ts — LOOM_EMBED_E2E_PHOENIX
  … expected [ Array(1) ] to deeply equal []
```

### Disposition of the two suites: **both WIRED, neither deleted**

Neither is redundant — I checked what else covers each before deciding:

* **`embed-react-elixir.test.ts`** — the mix-compile gate (`elixir-vanilla-build.yml`) compiles
  the `vanilla-embed-react.ddd` fixture but never boots it, and `phoenix-ui-e2e` boots LiveView,
  not the embed. So the assertions here (`GET /app` → SPA shell out of `priv/static/app`,
  `GET /api/<agg>` → JSON on the same origin) are the *only* proof that a Plug.Static mount or
  a SpaController fallback pointed at the wrong path fails before a user's first boot.
  **Wired** as `npm run test:embed-phoenix` + a new `embed-react-runtime` job in
  `phoenix-ui-e2e.yml`, reusing that file's postgres sidecar + `setup-beam` + hex cache and
  its `LOOM_OBS_PG_URL` handshake — thematically the same question ("does the generated
  Phoenix app actually serve its UI?"), one job over LiveView and one over the embedded SPA.
  Tier: that workflow's existing trigger — `push: main`, `workflow_dispatch`, or the `run-e2e`
  label on a PR. Its suite + fixture are added to that workflow's paths.

  (First attempt put it in `elixir-vanilla-obs-e2e.yml` — the file its header actually named
  post-rename. `test/system/draft-gate.test.ts` rejected that: every entry job of a workflow
  with a *plain* `pull_request:` trigger must carry the verbatim draft-gate `if:`, and mine
  was `github.event_name != 'pull_request'`, which is strictly stricter but not that string.
  Satisfying it by concatenating the literal would have been gaming the check, and satisfying
  it honestly would have put a 20-minute unvalidated job on every elixir-vanilla PR.
  `phoenix-ui-e2e.yml` is label-opt-in (`types: [labeled]`), so it is outside that gate's
  population by design and the job's restriction is expressed honestly.)
* **`auth-gate-ui-e2e.test.ts`** — the only runtime proof that a `requires`-gated menu entry,
  page guard and operation button actually hide/show client-side (`currentUser.role === …`
  evaluated in the browser against a mocked `/auth/me`), across all four SPA frameworks plus a
  server-rendered Phoenix half. The frontend build gates compile the markup; none of them runs
  it. **Wired** as `npm run test:auth-gate-ui` + a new `auth-gate-ui-e2e` job in
  `auth-oidc-compose-e2e.yml`, on that workflow's existing trigger: `push: main`,
  `workflow_dispatch`, or the `run-oidc` label on a PR. Never on an unlabeled PR — four
  `vite build`s plus a Playwright browser download is not a per-PR cost.

Both test files' headers now name their CI home (and the `phoenix-obs-e2e.yml` reference is
corrected), so the next rename has a second place to go stale — and the new gate catches it
either way.

**No new workflow FILES.** `test/system/local-run-mapping.test.ts` requires a
`docs/testing.md` row for every workflow file, and `docs/**` is outside this packet's fence;
adding jobs to existing workflows keeps the change inside it.

---

## Found but not fixed

1. **The coverage gate unions `paths:` globs across triggers, and several workflows rely on
   that deliberately.** `elixir-vanilla-obs-e2e.yml` says so in a comment ("the coverage test
   unions globs across triggers, so this block only needs the per-PR blast radius"). Measured
   per-trigger instead, ten workflows carry the five generation-path globs on `push:` only and
   **not** on `pull_request:` — `dotnet-obs-e2e`, `dotnet-oidc-e2e`, `elixir-vanilla-obs-e2e`,
   `elixir-vanilla-vo-e2e`, `hono-obs-e2e`, `hono-oidc-e2e`, `java-obs-e2e`, `java-oidc-e2e`,
   `python-obs-e2e`, `python-oidc-e2e`, plus the four `generated-*-e2e` SPA smokes. So a change
   confined to `src/util/naming.ts` fires none of them *on a PR*. That is the same bug shape as
   P0-3 one level down, and it is a deliberate tiering decision, not an oversight — which is
   why I did not unilaterally reverse it here. It wants its own row and a runner-budget
   decision.
2. **`behavioral-e2e-*.yml` are not recognised as generation gates at all.** The existing
   derivation keys on resolved `test/**/*.test.ts` entry points or an inline
   `bin/cli.js generate`; those legs drive generation through a `.mjs` case driver, so they
   score as non-generation and every assertion in the file skips them silently. Same
   "looked covered, wasn't" shape the file already documents for
   `generated-{feliz,flutter}-build`. Not fixed — widening the reader would pull ~6 more heavy
   legs into both invariants at once.
3. **No `run-*` label row.** The two new jobs ride existing triggers rather than minting a
   `run-embed-e2e` / `run-auth-gate` label, because the `loom-ci-gates` skill's label table
   lives under `.claude/skills/` (gitignored, outside the fence). If the coordinator wants
   per-PR opt-in for either, that is a label + a skill row away.
4. **Neither new job has ever run.** They cannot be validated in this sandbox (hex.pm egress is
   behind the TLS-fingerprint proxy; the auth-gate leg wants a Playwright browser download).
   Their **first `push: main` run should be watched** — `embed-react-runtime` in particular,
   since it is the one that can newly redden `main`.
