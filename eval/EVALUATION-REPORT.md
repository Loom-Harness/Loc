# Loom DSL — Architecture Council Evaluation Report

Prepared by: senior staff engineer spike, time-boxed hands-on evaluation.
Evaluation window: 2026-09-13, single session (~1 hour wall-clock of active
tool use; see `eval/EVAL-LOG.md` for the full chronological trail).
Repo evaluated: `Loom-Harness/loc` @ `09427a5`.

---

## Recommendation

**Pilot on a non-critical project only.**

Conditions to move up to **Adopt with conditions**: (1) the five SILENT
codegen gaps found in this spike (F-008 through F-012) are fixed and a
regression test exists per gap; (2) the workflow-only cross-aggregate
orchestration model is either fixed (same-context restriction lifted, or
turned into a clear compile-time diagnostic) or accepted in writing as a
permanent architectural limit the team designs around; (3) README.md and
`docs/workflow.md` are re-verified to parse/run before the next external
demo — trivial to fix, but their current state materially damages the "speed
of no-code" claim on first contact. Conditions to move up to **Adopt**:
sustained after those, plus a second engineer other than this evaluator
independently reproducing a green FieldOps-scale build across at least two
backends, and 90 days of the project's own commit/fix cadence continuing at
anything close to its current rate without the bus factor risk (see Risk
register) materializing.

**Why not lower than Pilot**: nothing found in this spike was unfixable, silently
irrecoverable data loss, or a broken security boundary — tenant isolation,
auth, and field masking all held up under direct attack in the one path
tested end-to-end (node/Hono + React). The generator's error messages are
frequently excellent, and its migration-safety story (refuses destructive
drops by default, correctly detects renames as data-preserving) is
genuinely better than most hand-rolled migration tooling. **Why not higher
than Pilot**: this evaluation found five distinct SILENT gaps — valid
`.ddd`, `ddd generate system` exits 0, and the emitted code does not compile
or crashes at runtime — inside the toolchain's own core, load-bearing
constructs (a plain aggregate operation, a workflow, an e2e test, a
scaffolded UI page, a Python route handler), all inside a single ~450-line
domain model built in under two hours. A project this young (~20 days old;
see Risk register) with this SILENT-gap density is not something to bet a
company's flagship product on yet, but it is a serious, unusually
fast-moving effort worth a bounded, low-stakes trial.

---

## Executive summary

Loom is a DSL and multi-target code generator: you write a domain model once
— aggregates, value objects, workflows, a page-level UI DSL, auth/tenancy
rules — and it emits a complete, runnable, "you own it" application across
five backend frameworks and six frontend frameworks, wired together with
Docker Compose, database migrations, and generated tests. The pitch is "the
speed of no-code, the keys to the codebase": faster than hand-rolling a
CRUD-heavy backend, without the lock-in of a no-code platform.

**What it genuinely does well.** For the one path this evaluation exercised
end-to-end (Node/Hono backend, React/Mantine frontend), the output is real:
it compiled cleanly, booted against a real Postgres database, and correctly
enforced every business rule this evaluator tried to violate — a
multi-currency invariant, a state-machine precondition, tenant isolation
under direct attack, a masked field, and a role-gated cross-tenant report.
Error messages from the compiler are frequently excellent — specific,
line-numbered, and often naming the exact fix. The generated migration
tooling correctly distinguishes a safe rename from a destructive drop and
refuses the latter by default. Scaffolding a runnable app from a 25-line
model took under two minutes.

**What it cannot yet do reliably.** The moment a domain model uses more than
one of the language's "advanced" constructs together — a workflow spanning
two contexts, a UI scaffolded across a subdomain served by two deployables,
an aggregate with two child collections on the Python backend — the
generator can silently produce code that does not compile or crashes at
runtime, with the validator reporting zero errors. Five such gaps were found
in this one evaluation session, inside the exact constructs (workflows,
multi-deployable systems, eventing to a separate service) that a real
multi-tenant B2B product needs on day one. Two of the project's own
reference docs (the README's flagship example and the entire workflow
reference doc) do not parse against the current language version. The
project itself is roughly three weeks old, and roughly 80% of its commit
history is AI-agent-authored under what appears to be a single human's
supervision — see the Risk register for what that means for support and
continuity.

---

## Claim verification matrix

Claims are quoted from `README.md` and the docs it links (verified against
this repo, not marketing copy elsewhere). Grades: **Verified** (ran it,
worked as claimed) / **Partially verified** (worked in the one path tested,
not confirmed broadly) / **Unverified** (not tested this pass, budget) /
**Contradicted** (tested, does not hold).

| Claim | Grade | Evidence |
|---|---|---|
| "The speed of no-code" | Partially verified | `ddd new` → running, HTTP-testable app in ~2 min (EVAL-LOG Phase 0). But the README's own front-door example doesn't parse (F-001) — the *actual* first-contact experience is closer to 35-40 min of debugging obsolete syntax before reaching that speed. |
| "Real, owned source code... keys to the codebase" | Partially verified | Hand-edited a `scaffold-once` file, regenerated, edit survived byte-for-byte (EVAL-LOG Phase 5.4) — this specific, well-documented customization path is real. Not tested: page-level `unfold`, overriding a repository method by name (budget). |
| "Zero vendor lock-in" | Unverified | Not tested this pass — would require actually abandoning Loom mid-project and measuring the rewrite cost. Structurally plausible (generated code is plain idiomatic TS/React with an MIT license — README, `docs/license-faq.md`) but unmeasured. See Fit analysis / exit cost discussion. |
| "No scaling cliff" | Unverified | Phase 5's scaling test (25-40 aggregates) was not attempted this pass — budget. Flagged as a real gap in this evaluation's coverage, not a pass. |
| "No drift between layers" | Contradicted (partially) | The additive-change diff was genuinely clean (EVAL-LOG Phase 5.1) — frontend/backend/migration stayed in lockstep for a trivial field add. But F-011 shows a UI scaffolded across a multi-deployable subdomain can drift into calling a backend that doesn't serve the aggregate at all — the layers silently disagree. |
| Five backends (Hono/.NET/Phoenix/Java/Python) | Partially verified | Node/Hono: generated, compiled, booted, full HTTP round trip (Phase 2). Python: generated, but **found a runtime `NameError`-class bug (F-012)** via `mypy`. .NET/Phoenix/Java: **unverified** — no toolchain available for .NET in this environment; Java/Elixir not attempted (budget). Sample size: **2 of 5 backends actually exercised**, one of which failed. |
| Six frontends (React/Vue/Svelte/Angular/Feliz/Flutter) | Unverified | Only React exercised (compiled clean, not run in a browser). **1 of 6.** |
| Thirteen design packs, swappable | Unverified | Not tested this pass — budget. |
| "Pick a runtime per deployable, switch any time" | Unverified | Not tested (would require regenerating the same FieldOps model onto a second backend and diffing behavior — budget did not allow after the Python defect investigation). |
| Visual playground (typed editor, system builder, live preview, test runner) | Unverified | Not reachable/tested in this sandboxed environment this pass. |
| `requirement`→`solution`→`testCase`→`ddd verify` traceability | Partially verified | The declarations parse and wire correctly; `ddd verify` ran and produced a structured verdict file, but a test recorded as `"passed"` in the results JSON did not flip its testCase to `VERIFIED` in one quick smoke test — exact semantics not confirmed (budget; see EVAL-LOG). |
| "LLM-safe... validation gates catch hallucinated fields... before any code is emitted" | **Contradicted** | This is the headline claim this evaluation falsifies most directly: F-008, F-010, F-011, F-012 are all "`ddd generate` exits 0, code doesn't compile/run" — the validation gate did not catch the problem before emission, in four separate constructs. |
| "1,300+ test files / 9,000+ tests" | Unverified (plausible) | Not independently counted; not implausible given repo size, but not verified this pass. |

---

## Target-matrix table

Backend × frontend × (generates / compiles / boots / wire-identical). Cells
this evaluation did not test are marked **unverified** — not a pass.

| Backend | Generates | Compiles | Boots + HTTP round trip | Notes |
|---|---|---|---|---|
| Node/Hono | ✅ | ✅ (0 tsc errors, 3 deployables) | ✅ full scenario incl. tenancy/auth/masking | The one fully-verified path (Phase 2). |
| Python/FastAPI | ✅ | ❌ **mypy: 14 errors, incl. a real runtime `NameError`** (F-012) | Unverified | `python -m compileall` passed (syntax-only; doesn't catch the bug). |
| .NET | ✅ (generate-only) | Unverified — no `dotnet` SDK in this environment | Unverified | F-008's undefined-reference pattern spot-checked and reproduced in the emitted C# (`Domain/Jobs/Job.cs`) without a full `dotnet build`. |
| Phoenix/Elixir | Unverified | Unverified | Unverified | Not attempted — budget. |
| Java/Spring Boot | Unverified | Unverified | Unverified | Not attempted — budget (Gradle/Maven were available but not reached). |
| React | ✅ | ✅ (0 tsc errors, after fixing F-011) | Compiled only, not browser-run | |
| Vue / Svelte / Angular / Feliz / Flutter | Unverified | Unverified | Unverified | Not attempted — budget. |

**Sample size actually exercised this pass: 2 of 5 backends generated+
inspected, 1 of 5 fully compiled+booted+HTTP-tested; 1 of 6 frontends
compiled. Do not read anything in this report as a broader backend/frontend
claim than that.**

---

## What it's like to actually use it

**Phase 0 (cold start).** `npm install && node bin/cli.js --help` worked
immediately, ~35s. The README's own "Quick example" — the very first thing
a newcomer is invited to copy-paste — failed with 8 distinct, unrelated
defects (F-001): an entirely removed keyword (`module`→`subdomain`), a
removed deployable field, an unsupported literal-list style, a removed
value-object constructor form, a removed test-assertion form, a missing
required clause, missing infrastructure wiring, and a call to a method the
example's own model never declares. None of these are subtle — this is the
landing page's flagship code block. The sanctioned path (`ddd new` →
`generate system` → boot) worked perfectly on the first try: 1 second to
scaffold, 1.2 seconds to generate 83 files, and (working around a sandbox-
specific Docker/TLS limitation, not a Loom defect) a real HTTP round trip
against Postgres in about two minutes, with correct RFC-7807 error bodies,
UUIDv7 ids, and optimistic-concurrency versioning out of the box.

**Phase 1 (modeling FieldOps).** The core DDD vocabulary — aggregates,
value objects, invariants, enums, guarded state machines via
`precondition` — is pleasant and reads like well-factored hand-written
domain code. The ceiling appears fast, though, once the model needs more
than one aggregate to cooperate: a natural "customer owns many sites"
containment couldn't simultaneously be the target of a cross-aggregate `X
id` reference (F-003, forcing a real remodel); a row-level "technician sees
only their own records" rule couldn't be expressed against the natural
typed foreign key and needed manual denormalization (F-005); and the
project's own recommended security posture (`denyByDefault`) turned out to
be structurally incompatible with its own terseness macro (`crudish`) with
no escape hatch (F-004). None of these individually is a dealbreaker — each
has a documented-by-this-evaluation workaround — but they arrived in the
first 90 minutes of modeling a realistic domain, not at some exotic edge.

**Phase 5 (maintenance — this is where the verdict actually turned).** The
additive-change and rename-migration stories are genuinely excellent: clean,
minimal diffs; a rename correctly detected as a `RENAME COLUMN` (not a
destructive drop+add) against a database with real data, with the data
verified intact after; a destructive delete correctly refused by default
with a clear message and an explicit `--allow-destructive` escape hatch.
Hand-written code in the one sanctioned "yours forever" file survived a
regenerate byte-for-byte, exactly as its own header comment promises, while
a file marked "auto-generated, do not edit" was silently (and correctly, per
its own contract) overwritten. **If the maintenance story were only this,
the verdict here would be Adopt with conditions.** What pulled it back to
Pilot was Phase 2's compile step: building the very same FieldOps model
surfaced five separate SILENT gaps (F-008 through F-012) that `ddd parse`
and `ddd generate system` waved through with zero errors, each one a
plausible, un-exotic modeling choice a real team would make on day one of a
B2B app like this.

---

## Gap register

**HONEST gaps** (clear diagnostic, no crash) — F-001*, F-003, F-004, F-005,
F-006*, F-007 (Variant A only). *F-001/F-006 are doc-staleness, not compiler
refusals, but every actual compiler rejection encountered while fixing them
was a clean, well-worded diagnostic.

**SILENT gaps** (exit 0 / crash where a diagnostic belongs, wrong or
non-compiling output) — F-007 (Variant B), F-008, F-009 (crash, not
silently-wrong, but rule-3-flagged), F-010, F-011, F-012. **6 of 12
numbered findings are in this bucket — the majority.**

**DOCUMENTED limitations** — none found during the blind Phases 0-6 (this
narrow domain model never surfaced a "not supported" label up front). Phase
7 reconciliation reclassified F-003 and F-005 after the fact: both are
deliberate, internally-documented design constraints (`CLAUDE.md`'s
`X id` rule; the single-table-query `find` design), not oversights — real
friction for a buyer, but known and intentional, not silent.

**Reconciliation split (Phase 7)**: of the 10 non-positive findings, **5
were confirmed genuinely unknown to the maintainers** (F-004, F-007, F-008,
F-010, F-011 — absent from every internal audit/mission/retrospective), **1
is a known mechanism with a fresh uncovered regression** (F-012), **2 are
known/intentional by design** (F-003, F-005), and **2 are instances of a
heavily-tracked general class** (stale docs — F-001, F-006) that simply
hadn't been individually logged yet.

**Positive findings** — F-002 (10/10 adversarial inputs produced clean,
specific, actionable diagnostics with zero crashes); the migration-safety
behavior in Phase 5; the tenant-isolation/auth/masking behavior in Phase 2.

By severity: **S1 (blocker): 5** (F-008, F-009, F-010, F-011, F-012— all
SILENT-class or crash-class). **S2 (major): 5** (F-001, F-004, F-006,
F-007). **S3 (friction): 2** (F-003, F-005). **S4: 0 filed separately**
(several minor rough edges — e.g. `this.field :=` assignment rejected, a
reserved `log` identifier, coarse-grained `ddd breakpoints` output — noted
in EVAL-LOG but not filed as standalone findings given time budget).

---

## Phase 7 reconciliation (read only after Phases 0-6 were complete)

Per the evaluation contract, all internal maintainer material (`CLAUDE.md`,
`docs/new-plan/`, `docs/audits/`, `experience_gathered.md`) was off-limits
until this point. Reading it now materially changes how several findings
should be weighted — some are intentional design decisions this evaluator
mistook for gaps; others are genuinely unknown to the maintainers, which is
itself informative.

- **Known/intentional, not a bug**: F-003 (entity/part can't be a
  cross-aggregate reference target) is a deliberate, structurally-enforced
  design choice — `CLAUDE.md` documents the rule verbatim, and
  `docs/new-plan/T8-dx-tooling-ai.md` records the maintainers already
  examined and confirmed a diagnostic for this exact shape is
  architecturally unreachable. F-005 (denormalize for row-level queries) is
  consistent with a deliberately single-table-query-only `find` design, not
  an oversight. These stay in this report as genuine friction — a team will
  still hit them — but they are not surprises to the vendor.
- **Genuinely unknown to the maintainers (verified via `docs/new-plan/`,
  `docs/audits/`, `experience_gathered.md` — none mention them)**: **F-004,
  F-007, F-008, F-010, and F-011 are novel findings**, absent from every
  mission, audit, and retrospective in the repo. F-011 is a particularly
  sharp case: the source comment this evaluation quoted, claiming the
  broken code path is "now DEAD on valid `.ddd`," is stated as fact in the
  codebase but was never independently verified by any internal audit —
  this evaluation's repro is the first evidence it's false. F-007 is a
  recurrence of a defect *class* the team already found and fixed in a
  sibling construct (`domainService` cross-context access,
  `docs/audits/language-gaps-2026-08.md`) — the fix was never generalized to
  `workflow` bodies.
- **Known class, this instance missed**: F-001 and F-006 (stale docs) are
  not individually tracked, but "stale docs desynced from a moving grammar"
  is the single most-repeated finding across the project's own internal
  audits (`docs/new-plan/T9-toolchain-health.md` M-T9.46 alone lists 10
  other per-feature docs found to contradict the code). `docs/workflow.md`
  and `README.md` simply weren't on the list yet. The "v2 syntax" `Money`
  constructor change this evaluation found mid-investigation is a real,
  confirmed language migration (`src/diagnostics/messages.ts`) that nothing
  ever went back and updated the README for.
- **Known mechanism, fresh regression**: F-012 (Python missing-import
  `NameError`) is generated by a mechanism (`docs/new-plan/T9-toolchain-
  health.md` describes a "fragile-by-construction" regex-based import
  scanner) that already caused and had one prior instance of this exact bug
  class fixed (#1961) — but the underlying fragility was explicitly logged
  as remaining tech debt, not hardened. This evaluation's `WorkOrder` (4
  foreign ids, 2 optional) is simply a shape the existing corpus doesn't
  cover yet.
- **Overclaiming check**: no README or docs-site claim was found to
  directly contradict what the internal material says ships today — the
  project is unusually candid internally about its own gaps (see Project
  health below). The overclaiming this evaluation found is narrower and
  more mundane: stale *examples*, not false feature claims.

**Project health.** `git log` (668 commits visible in this checkout,
2026-08-31 to 2026-09-13) undersells the pace: `docs/new-plan/README.md`
references 3,253+ commits by 2026-09-02 alone, and PRs are past #2889 today
— **on the order of 50+ commits/day sustained for two weeks.** Authorship is
an AI-agent swarm, not a team of engineers: of the last 200 commits, 156 are
authored "Claude" and 43 by a single human (Michał Kupiec) who appears
almost exclusively merging PRs — a human gatekeeper over a fleet of agent
sessions, exactly as `CLAUDE.md`'s own operating instructions (draft-PR
claiming to avoid collisions, mandatory rebase-before-each-unit-of-work) are
written to coordinate. **The project explicitly does not claim to be
finished**: its own most recent internal audit's verdict is *"a finished
compiler wrapped in an unfinished product"* — not installable via npm (no
`files`/`exports`/publish workflow), no dependency-freshness CI gate, and a
fuzzer that already found a real cross-backend bug wired into no workflow.
Internal trackers repeatedly and candidly note their own unreliability
("status banners rot in BOTH directions, fast" — `experience_gathered.md`).
**This cuts both ways for a buyer**: the velocity and self-awareness are
genuinely impressive and explain why so much surface area exists at all
after ~20 days — but "a single human supervising an AI fleet, publicly
admitting the product isn't finished, publishing 50 commits a day" is about
as far from an enterprise-support-contract vendor profile as a source-
available project can get. See Risk register.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Silent codegen gaps in production** — a construct compiles through validation but the emitted code is broken (this evaluation's core finding class) | High (5 found in one ~450-line model) | High — ships broken features that look done | Compile-gate EVERY generated deployable in CI, every commit, on every backend the team actually ships (not just the one this evaluation happened to fully exercise); never trust `ddd generate`'s exit code alone |
| **Vendor / bus-factor risk** — confirmed in Phase 7: repo is ~20 days old (3,253+ commits by day 3 per the project's own tracker), ~78% of recent commits AI-agent-authored, one human ("Michał Kupiec") acting as sole PR-merge gatekeeper over a fleet of Claude agent sessions; the project's own most recent internal audit concludes "a finished compiler wrapped in an unfinished product" — not yet installable via npm, no dependency-freshness CI gate | High | Severe if the one maintaining human departs, reprioritizes, or the velocity is a temporary sprint that doesn't continue | Do not adopt for anything the company cannot afford to fork and maintain in-house; budget for reading the generator's own source before it's needed in anger; ask directly about support-contract/commercial-backing plans before committing |
| **Docs drift faster than the compiler** — two of a handful of docs an evaluator reads in the first hour (README, `docs/workflow.md`) do not parse against current syntax (F-001, F-006) | High (found twice independently in one session) | Medium — costs onboarding time, erodes trust, but doesn't ship bad code | Treat every doc's code sample as unverified until you've run it; ask the vendor for a CI gate that runs every doc's `.ddd` sample through `ddd parse` |
| **Cross-cutting features (workflows, multi-deployable eventing) are the least mature surface** | Medium-High (3 of 5 S1 findings are workflow/multi-deployable-related) | High — this is precisely the surface a real B2B product needs (background jobs, service-to-service eventing) | Pilot on a domain that minimizes cross-aggregate workflows and multi-deployable UIs until this hardens |
| **Breadth claim (5 backends/6 frontends) may be one-real-path-plus-demos** | Medium (1/5 backends fully verified, 1/5 found broken, 3/5 untested; 1/6 frontends touched) | Medium-High if the team picks a backend other than Node/Hono expecting parity | Before committing to a non-Node backend, repeat this evaluation's Phase 2 compile-and-boot discipline on that specific backend first |
| **Exit cost if abandoned in year two** | Unmeasured this pass | Unknown | The generated code is plain, idiomatic, MIT-licensed source with no runtime SDK lock-in observed in the one path tested — structurally low exit cost is plausible but not measured; budget a real spike on this before betting on it |

---

## Fit analysis

**Where Loom is clearly a good fit**: an internal tool, an admin panel, a
back-office CRUD app, or a genuine pilot/prototype where the team can
tolerate finding and working around a SILENT gap occasionally, and where the
domain is mostly single-aggregate CRUD with modest cross-aggregate logic.
The scaffold-to-running-app speed and the migration-safety story are real
wins for exactly this shape of project.

**Where it is clearly the wrong choice today**: anything where a background
job / cross-service workflow / eventing pipeline is core to the product (this
evaluation found workflows to be the single most defect-dense surface), or
where the team cannot afford a silent production incident traced back to
"the compiler said this was fine." A regulated, uptime-critical, or
security-sensitive product should not adopt this today without its own
compile-gate-everything discipline layered on top.

**Where FieldOps (the council's actual candidate) falls**: multi-tenant B2B
SaaS with workflows, cross-service eventing, and tenant-isolation-critical
data is close to the worst-case shape for what this evaluation found —
not because any single defect is fatal, but because the product's own
requirements (a scheduling workflow spanning three aggregates, a separate
notifier deployable, row-level security) are exactly the constructs that
produced this session's five S1 findings.

---

## Comparison against realistic alternatives

- **A conventional framework (e.g., a typed Node/Python stack) + an AI
  coding assistant.** Slower to first running app than Loom, but the
  "silently broken code that passes CI" failure mode this evaluation found
  is arguably *more* dangerous with a raw AI assistant (no domain-model
  source of truth at all) and *less* dangerous with Loom (a single `.ddd`
  file to re-verify, not a sprawling hand-written codebase) — a wash on
  quality risk, a clear win for Loom on initial velocity, given the caveats
  above about compile-gating.
- **A no-code/low-code platform** (Bubble, Retool, etc.). Loom's exit cost
  is plausibly much lower (plain generated source vs. a proprietary
  runtime) — not measured this pass, but structurally credible from what
  was generated. No-code platforms don't have this evaluation's SILENT-gap
  problem in the same way (their runtime is the product, not generated
  source you compile yourself) but trade that for the lock-in Loom's pitch
  explicitly targets.
- **An in-house scaffolding layer** (a team's own Yeoman/Cookiecutter-style
  generator). Loom's language is far richer (invariants, workflows, tenancy,
  auth as first-class model constructs, not templated boilerplate) — a real
  advantage if it works, a real risk multiplier where it doesn't (an
  in-house generator's bugs are at least debuggable by the team that wrote
  it; Loom's are not, absent deep source-diving like this evaluation did).

---

## Top 10 fixes ranked by adoption impact

1. Fix the five SILENT codegen gaps found in this one session (F-008,
   F-010, F-011, F-012, and F-007 Variant B) — each is "validator says
   fine, output doesn't run." This is the single highest-leverage category.
2. Turn F-009's crash (raw JS stack trace on `api.workflows.X()` against a
   backend) into a `loom.*` diagnostic.
3. Fix or clearly gate cross-context repository access from workflows
   (F-007) — right now it's an inconsistent trap, not a documented limit.
4. Re-run README.md's and docs/workflow.md's own code samples through
   `ddd parse` in CI, on every merge (F-001, F-006).
5. Give `crudish` a way to compose with `denyByDefault` (F-004) — or
   document the incompatibility loudly, including in the `ddd new` scaffold
   comment that currently invites the broken combination.
6. Let `scaffold(subdomains: [...])` know which deployable(s) actually serve
   each aggregate, and skip or warn instead of emitting a broken page
   (F-011).
7. Compile-gate the Python backend's own example corpus with `mypy` in CI
   against a model with 2+ foreign ids and 2+ `contains` collections
   (F-012) — the shape that broke here is not exotic.
8. Give repository `find`s a documented "denormalize for query access"
   pattern with tooling support (an index suggestion already exists — this
   evaluation saw it fire, unprompted, which is a good sign the team can
   build this), rather than leaving it to the author to discover (F-005).
9. Document the "part vs. its own aggregate" containment-vs-reference
   trade-off explicitly (F-003) — it is a modeling decision every
   non-trivial domain will face on day one.
10. Publish a changelog / deprecation policy for language-version bumps
    (the "v2 syntax" `Money` constructor change found in F-001 suggests at
    least one breaking revision has already happened silently from a
    docs-freshness standpoint).

---

## Coverage and limits of this evaluation

**What this evaluation covered well**: Phase 0 cold start; a realistic
~450-line multi-aggregate domain model with tenancy, auth, masking,
workflows, channels/eventing, file upload, and traceability; a full
compile-and-boot-and-HTTP-attack pass on exactly one backend/frontend pair;
the core additive/rename/destructive-delete/hand-edit-survival evolution
tests against a real database with real data; 10 adversarial malformed
inputs; a handful of CLI surfaces (`--dry-run`, `i18n extract`, `verify`,
`snapshot`, `breakpoints`).

**What this evaluation did NOT cover, and where confidence is low**:
- **Backend/frontend breadth**: only 2 of 5 backends and 1 of 6 frontends
  were touched at all; only 1 backend was fully compiled-and-booted. No
  claim in this report about .NET, Phoenix, Java, Vue, Svelte, Angular,
  Feliz, or Flutter should be read as tested — they are explicitly
  unverified, not passing.
- **Design packs**: none of the 13 were exercised.
- **Scaling** (Phase 5.6): a 25-40 aggregate model was never built; no data
  on parse/generate/build time at realistic scale.
- **Docker/compose boot**: abandoned after a sandbox-specific TLS/proxy
  limitation (documented as environmental, not a Loom defect) cost 25
  minutes on one failed attempt; substituted a direct-`tsx`-boot-against-
  local-Postgres methodology that still exercised real HTTP/DB behavior but
  not the actual `docker-compose.yml` orchestration, healthchecks, or
  multi-container startup ordering.
- **Toolchain upgrade risk, team-workflow/merge-conflict behavior,
  Kubernetes/Helm output, the browser playground, the VS Code
  extension/LSP, the MCP/agent-tool surface, and a from-scratch LLM-
  authoring trial** were not attempted — pure budget constraints, not
  negative findings.
- **`ddd verify`'s exact VERIFIED-threshold semantics** were smoke-tested
  only; one quick test did not flip to VERIFIED and the reason was not
  chased down.
- Every finding in this report comes from **one evaluator, one session,
  one sandboxed environment** — no second engineer independently
  reproduced anything here, which the recommendation's conditions call for
  before moving past Pilot.

This report's confidence is **high** on: the language's core DDD
expressiveness, the migration-safety story, the auth/tenancy security
posture on the one path tested, and the existence (not full extent) of the
SILENT-gap problem. Confidence is **low** on: anything about the four
untested backends, five untested frontends, and the scaling/ops story.
