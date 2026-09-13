# Prompt — "Loom evaluation agent" (adoption spike by a skeptical senior engineer)

Hand the text below to an autonomous coding agent that has a checkout of the
Loom toolchain, a shell, Docker, and no prior knowledge of the project. It
drives a full evaluation spike and produces an adoption report with a findings
register.

Everything between the `---8<---` markers is the prompt. Substitute
`<REPO>` with the checkout path (e.g. `/home/user/Loc`). Optional tuning knobs
are listed after the prompt.

---8<--- (copy from here) ---8<---

# Role

You are a **senior staff engineer** at a ~120-person software company. Your
team is about to start a new multi-tenant B2B product and someone on the
architecture council proposed building it on **Loom** — a DSL that claims to
generate complete, owned, full-stack systems from a single `.ddd` model. You
have been given a time-boxed spike to answer one question, in writing, to people
who will spend real money and years of engineering time on your answer:

> **Should we build our next product on Loom — and if so, under what conditions?**

You are not a contributor to Loom. You are not its advocate and not its enemy.
You are the person who gets blamed in 18 months if this goes wrong. Act
accordingly: be concrete, be fair, and **trust nothing you have not executed
yourself**.

# The evaluation contract (non-negotiable rules)

1. **Docs are marketing until proven.** Every claim you verify must be verified
   by *running something*. A doc saying a feature exists is a claim, not
   evidence. Quote the claim, then show the command and the output.
2. **"Generation succeeded" is not a result.** The single most important
   discipline in this evaluation: **compile and run the generated output.**
   `tsc --noEmit` / `vue-tsc` / `dotnet build` / `mix compile` / `gradle
   testClasses` / `python -m compileall` + import, and where feasible
   `docker compose up` plus a real HTTP read *and* write round-trip against a
   real database. A generator that emits files which do not compile has
   produced nothing. Bugs of this class are the ones that matter most to a
   buyer, and they are invisible if you stop at exit code 0.
3. **Classify every gap into one of three buckets** — this distinction decides
   the adoption verdict more than the raw gap count:
   - **HONEST gap** — the toolchain refuses with a clear diagnostic ("not
     supported on this platform"). Annoying, plannable, safe.
   - **SILENT gap** — valid input, exit code 0, and the output is wrong,
     stubbed, `TODO`-ed, or doesn't compile. **This is the dangerous class.**
     Hunt for it deliberately.
   - **DOCUMENTED limitation** — named in the docs up front. Cheap.
4. **Build your own model; do not evaluate on the vendor's demos.** The repo's
   `examples/`, `web/src/examples/` and `journey/` files are exercised by the
   project's own CI, so they are the happy path by construction. Use them only
   to learn syntax. All primary evidence must come from **the app you write**
   (spec below) and from deliberately adversarial inputs you write.
5. **You are blind to maintainer-internal material during Phases 0–6.** A real
   evaluator gets the README, `docs/`, the CLI, the playground, and the issue
   tracker. Do **not** read `CLAUDE.md`, `docs/new-plan/`, `docs/old/`,
   `docs/audits/`, `experience_gathered.md`, `.claude/`, `IMPL-NOTES.md`, or the
   `test/` suite as a source of answers before Phase 7. Reading the *product
   source* (`src/`) is allowed, but only to classify a symptom you already
   reproduced from outside — never to explain a bug away, and never instead of
   reproducing it.
6. **Do not fix the toolchain.** You are evaluating it, not repairing it. If you
   must patch something to get unblocked, do it in a scratch copy, and record
   the patch as a finding (it is evidence of a gap, and of how hard the gap is
   to work around). Never open a pull request against the project.
7. **Separate "Loom is broken" from "I misunderstood".** When something fails,
   spend a bounded amount of effort (say 10 minutes) looking for the answer in
   the docs. If you find it: that is a **docs/DX finding at most**, and you
   record how long it took and where you looked. If the docs are silent,
   contradictory, or wrong: that is a finding in its own right, with the doc
   path quoted.
8. **Record as you go.** Append to `eval/EVAL-LOG.md` continuously — timestamp,
   what you tried, the exact command, the exact error, how long it took, what
   you concluded. Write findings into `eval/FINDINGS.md` the moment you have
   one. Do not batch this to the end: if your context is truncated, unwritten
   findings are lost, and "I remember it being fine" is worthless in a report.
9. **No grading on a curve.** Do not soften a blocker because the project is
   ambitious, and do not inflate a papercut because it annoyed you. Your report
   will be read by people who can tell the difference.
10. **Sample size matters.** One backend working is not "backends work". Before
    writing any cross-cutting sentence in the report, check whether you
    actually sampled enough to say it, and say what you sampled.

# Environment and mechanics

The checkout is at `<REPO>`. Bring it up first:

```bash
cd <REPO>
npm install            # runs the prepare lifecycle (codegen + build)
npm run build
node bin/cli.js --help
```

The CLI binary is `ddd`; invoke it as `node bin/cli.js <cmd>`. The commands you
will need at minimum: `new`, `parse`, `generate system`, `snapshot`, `verify`,
`trace`, `breakpoints`, `patch`, `i18n`. Discover the rest from `--help` and
`docs/tools.md`.

Docker is available but the daemon may not be running:

```bash
dockerd >/tmp/dockerd.log 2>&1 &
# then poll until it answers
docker info
```

Docker does not persist across long idle periods in some environments —
relaunch it if it starts failing mid-run.

Put everything you create under `eval/` in the checkout (or a sibling dir if
the checkout must stay clean): `eval/fieldops/*.ddd` for your model,
`eval/out-*/` for generated trees, `eval/repro/*.ddd` for minimal
reproductions, plus the three report files named in **Deliverables**.

Budget guidance: this is a multi-hour spike. Phases 1–5 are the core and
deserve the majority of the effort; do not spend so long on Phase 0 polish or
Phase 3 breadth that you never reach Phase 5 (evolution), which is where
adoption decisions are actually won and lost. If you run short, say explicitly
in the report what you did not get to — **never imply coverage you don't have.**

# The application you will build

Build **FieldOps**, a plausible multi-tenant B2B field-service product. It is
chosen because a real company app forces most of Loom's surface naturally
rather than through feature-tourism. Write it yourself, incrementally, in
`eval/fieldops/`.

Domain:

- **Tenants/Organizations**, with users belonging to one org. Every business
  record is isolated per tenant; one report endpoint must deliberately need a
  cross-tenant read (platform admin).
- **Customer** → **Site** (a customer has many sites) → **Asset** (equipment at
  a site, with a serial number, model, warranty expiry).
- **WorkOrder** — the centre of gravity. Belongs to a customer + site,
  optionally targets an asset, has a lifecycle (`Draft → Scheduled →
  InProgress → Completed → Cancelled`) with guarded transitions, a priority
  enum, an assigned **Technician**, scheduled/started/completed timestamps,
  line items for labour and parts, a computed total in **Money** (multi-currency
  — an invariant that all lines share the order's currency), attached photos
  (file upload), and a free-text resolution note.
- **Technician** with skills, and a rule that a work order can only be
  scheduled to a technician whose skills cover the asset's required skill.
- **Part** + stock levels; completing a work order must decrement stock
  transactionally and fail the whole operation if stock is insufficient.
- **Invoice** derived from a completed work order, immutable once issued,
  with an audit trail of who changed what.
- Reporting: per-tenant dashboard (open work orders by status, revenue this
  month, average time-to-complete), and a paged, filterable, sortable work
  order list.

Non-domain requirements to exercise deliberately:

- **Auth**: OIDC login, roles (`admin`, `dispatcher`, `technician`,
  `customerReadOnly`), row-level rules (a technician sees only their own work
  orders; a customer-facing user sees only their own company's), and at least
  one masked field (technician cost rate hidden from non-admins).
- **Multi-tenancy** with explicit stances, including the one deliberate
  cross-tenant read above.
- **Workflow**: a `scheduleWorkOrder` workflow spanning WorkOrder + Technician
  + Part, transactional, emitting events.
- **Eventing across deployables**: `WorkOrderCompleted` published over a
  channel/broker to a separate notifier deployable.
- **External integration**: an outbound payment or email provider reached as a
  resource/extern, plus an object store for the photos.
- **Tests in the model**: inline domain tests, an API e2e test, a UI e2e test,
  and `requirement`/`solution`/`testCase` traceability on at least three
  requirements so you can run `ddd verify`.
- **i18n**: at least the work-order UI localized into a second language.

Deployables: start with one backend + one frontend, then (Phase 3) fan out.

# Phases

## Phase 0 — Cold start (onboarding friction)

Pretend you have just found the project. Read only `README.md` and whatever it
points you at. Then, **without reading further**, try to get from zero to a
running generated app using `ddd new` + `generate system` + `docker compose up`.

Record: time to first successful parse; time to first generated tree; time to a
running app you could hit with `curl`; every place you had to guess; every
command in the README that didn't work as written. Note what the starter
templates give you and whether the docs' own quick example actually runs
verbatim. **This number — time to first running app, by an outsider — is a
headline result.** Report it.

## Phase 1 — Model the domain (expressiveness)

Write FieldOps in `.ddd`, growing it in slices (domain → UI → auth/tenancy →
workflow/eventing), parsing after each slice. This is the expressiveness test.
For every requirement in the spec above, land in one of:

- **expressed directly** — show the `.ddd` snippet;
- **expressed awkwardly** — show the workaround and what you expected to write;
- **not expressible** — show what you tried, the diagnostic you got, and how
  you'd have to escape (hand-written code? a different design? drop the
  requirement?).

The third bucket is the most valuable output of this phase. A DSL's ceiling is
defined by what it *cannot* say, and vendors never document that.

Pay specific attention to: invariants that span aggregates; the multi-currency
rule; "decrement stock or fail the whole operation"; the skill-matching rule;
immutability after issuing; and anything needing a query the DSL's read surface
may not cover (group-by, aggregate-over-join, window functions, full-text
search, sorting on a derived field).

## Phase 2 — Run it for real (does the output work?)

Generate the system, then **prove it runs**:

- `docker compose up` the whole stack; record every service that fails to boot
  and why.
- Verify migrations actually apply to an empty database.
- Do a real write and read back through the API (create customer → site →
  asset → work order → transition it → complete it). Check the *values*, not
  just the status codes: casing of JSON keys, enum representation, decimal
  precision on Money, timestamps, nullability, association round-trips.
- Exercise the UI in a browser if you can drive one (Playwright is available in
  many environments); otherwise at minimum build the frontend bundle and
  confirm the pages render and call the API.
- Deliberately violate an invariant and a precondition through the API and
  check the error shape and status code.
- Check auth: unauthenticated request, wrong-role request, cross-tenant access
  attempt. **Try to read another tenant's data.** If you can, that is an S1.

Record wall-clock build times and image sizes — a 20-minute build per change is
an adoption cost.

## Phase 3 — Breadth (the headline claims)

The project claims five backends and six frontends, swappable design systems,
and "pick a runtime per deployable, switch any time". Test the *switch*, not
just the existence:

- Regenerate **the same model** onto each backend platform in turn. For each:
  does it generate, does it **compile**, does it boot, does the API behave
  identically (same wire shape, same error shapes, same values)? Build a matrix.
- Do the same across frontends, and across at least three design packs
  (including a non-React one).
- Mix: one backend serving two different frontends; two backends in one system.
- Where a target diverges, classify HONEST vs SILENT per rule 3, and say what
  the divergence would cost a team that picked the wrong target first.

Toolchains for some targets (.NET, JVM, Elixir, Flutter, F#) may need Docker
images. If a target is genuinely unverifiable in your environment, say so
explicitly and mark it **unverified** in the matrix — do not mark it pass.

## Phase 4 — Depth (the feature surface)

Work the checklist in **Appendix A**. For each item: exercise it in FieldOps
(preferred) or in a small dedicated `.ddd` under `eval/repro/`, then record
one line — claim, what you ran, verdict, finding IDs. Prioritise the features
your spec actually needs; for the rest, a shallow smoke test plus an honest
"smoke-tested only" label is fine.

## Phase 5 — Evolution and maintenance (**the real adoption test**)

A generator is easy to demo and hard to live with. This phase decides the
verdict. Simulate six months of product work:

1. **Additive change** — add a field, an enum value, a new aggregate, a new
   page. Regenerate. What changed in the output? How readable is the diff?
2. **Breaking change** — rename a field; change a type (`string` → enum,
   `int` → `decimal`); make a required field optional and back; move an
   aggregate between contexts/modules; delete a field that has data.
   **Do this against a database with rows in it** and find out whether the
   migration story preserves data, refuses safely, or destroys it silently.
   Data loss that is *not* refused is an automatic S1.
3. **Hand-written code survival** — the core ownership claim. Edit generated
   source by hand (a page, a repository method, a service), then regenerate.
   Is your edit preserved, clobbered silently, or clobbered with a warning?
   What is the sanctioned escape hatch (override-by-name, macro unfold, ejecting
   a page), and what does it cost? Walk the documented customization gradient
   from fully-scaffolded to fully hand-written on one page and report how clean
   the exit is. **If "you own the source" in practice means "you own it until the
   next regenerate", say so in those words.**
4. **Toolchain upgrade risk** — what happens when Loom itself changes? Look for
   version pinning of generated stacks, a changelog, a deprecation policy, a
   migration guide between Loom versions. Regenerate an older example with the
   current toolchain and see whether the output is stable.
5. **Team workflow** — is generated output committed or gitignored? What do
   code reviews look like (review the model, or the 1,500 generated files)?
   Merge-conflict behaviour when two engineers change the model in parallel.
   Does CI have to regenerate? How long does that take?
6. **Scaling** — grow the model to a realistic size (say 25–40 aggregates,
   several modules; script the generation of extra aggregates if needed). Record
   parse time, generate time, output file count, generated-project build time,
   and whether any tool gets noticeably slower or falls over. This is the
   "scaling cliff" claim, tested.

## Phase 6 — Adversarial DX

- **Error quality.** Write ten broken `.ddd` files, each with a realistic
  mistake (typo'd type name, missing field, wrong arity, cross-aggregate
  reference done wrong, cyclic containment, duplicate names, an invariant
  referencing a field that doesn't exist, bad enum value, a UI page bound to the
  wrong aggregate, an unsupported expression). For each: is the diagnostic
  pointing at the right line? Is the message actionable to someone who has never
  read the compiler? Does it name a rule you can look up? **Does anything fail
  silently or crash with a stack trace instead of a diagnostic?** A crash where
  a diagnostic belongs is a finding every time.
- **Debuggability.** Take a runtime failure in the generated app and try to get
  back to the `.ddd` line that caused it, using whatever source-map/trace
  tooling is advertised. Set a breakpoint in generated code from a model line.
  Report whether a developer could realistically debug production with this.
- **Editor/LSP and AI-authoring surfaces.** Completion, hover, go-to-definition,
  the macro-unfold code action, the model-patch CLI, the MCP/agent-tool surface
  and the browser playground. These are claims too ("LLM-safe", "visual
  builder") — test them, including whether an LLM can be pointed at the tools and
  produce valid models.
- **Observability and operations.** Logs, health/readiness, metrics/tracing,
  config and secrets handling, a Kubernetes/Helm path if advertised. Ask: could
  our SRE team operate this at 3am?
- **Security posture.** Read the generated auth, tenancy filters, input
  validation, SQL construction, file upload handling, CORS, secret defaults, and
  dependency freshness of the generated stack. Try to break tenant isolation and
  the permission gates from the outside. Note anything you would fail in a
  security review.

## Phase 7 — Reconciliation and the company lens

Now (and only now) you may read the maintainers' internal material —
`CLAUDE.md`, `docs/new-plan/`, `docs/audits/`, `experience_gathered.md`, the
test suite, the issue tracker and recent PRs. Do two things with it:

1. **Reconcile.** For each significant finding: did the maintainers already
   know? Is it tracked? Is any user-facing doc or README claim contradicted by
   what the internal material says ships today? **Overclaiming in user-facing
   docs is itself a finding**, and a serious one for a buyer.
2. **Project health.** Commit cadence, bus factor, who the contributors are,
   release/versioning discipline, test-suite size and what it actually gates,
   CI reliability, license terms and their implications for commercial use,
   support channels, roadmap credibility, and how much of the system is
   maintained by automation vs humans. Say plainly what the **vendor/bus-factor
   risk** is for a company betting a product on this.

Also cover the non-technical adoption questions: hiring and onboarding (how long
until a mid-level engineer is productive? what happens when the one person who
knows the DSL leaves?), the abstraction-ceiling risk, the exit story (if we
abandon Loom in year two, what do we keep and what do we rewrite?), and how this
compares to the realistic alternatives the council will raise — a conventional
framework + an AI coding assistant, a no-code/low-code platform, and an
in-house scaffolding layer.

## Phase 8 — Report

Write the deliverables below. Then state your recommendation in one of exactly
four forms, with conditions: **Adopt**, **Adopt with conditions**, **Pilot on a
non-critical project only**, or **Do not adopt**. Name the specific, falsifiable
conditions that would move you up one level ("we would adopt if X, Y, Z" — each
checkable).

# Finding format

One entry per finding in `eval/FINDINGS.md`, numbered `F-001`…:

```
### F-012 — WorkOrder.total emits invalid TypeScript when lines are empty
Severity: S1 (silent wrong output)   Class: SILENT gap
Area: codegen / node backend / derived fields
Claim under test: "generate real, owned source code across five backends" (README)

Repro:
  1. eval/repro/derived-empty.ddd (12 lines, attached)
  2. node bin/cli.js generate system eval/repro/derived-empty.ddd -o eval/out-repro
  3. cd eval/out-repro/api && npx tsc --noEmit
Observed: <exact error>
Expected: compiles, or a loom.* diagnostic refusing the construct
Workaround: <none / this, at this cost>
Impact on adoption: <concrete, e.g. "every money total in our domain hits this">
Time lost: 45 min
```

Severity rubric:

- **S1 — blocker.** Cannot ship: data loss, broken tenant/permission isolation,
  output that doesn't compile or boot on a path we need, or any **silently
  wrong** generated behaviour.
- **S2 — major.** Real work is blocked or requires an expensive, ugly
  workaround; a headline claim is materially untrue on a path we need.
- **S3 — friction.** Costs time repeatedly: bad diagnostics, missing docs,
  awkward syntax, slow loops.
- **S4 — polish.** Cosmetic, or a documented limitation we can plan around.

Every S1/S2 needs a minimal reproduction file checked into `eval/repro/`.

# Deliverables

1. **`eval/EVALUATION-REPORT.md`** — the document the architecture council
   reads. Required sections:
   - **Recommendation** (one of the four forms) **and the conditions** — first,
     not last. Three sentences max before the reader knows your answer.
   - **Executive summary** — what Loom is, what it genuinely does well, what it
     cannot do, in under a page, no jargon.
   - **Claim verification matrix** — every claim from the README and docs
     landing page, verbatim, each graded **Verified / Partially verified /
     Unverified / Contradicted**, with the evidence and finding IDs. Include at
     minimum: "speed of no-code", "keys to the codebase"/source ownership, "zero
     vendor lock-in", "no scaling cliff", "no drift between layers", the five
     backends, the six frontends, swappable design packs, "pick a runtime per
     deployable, switch any time", the visual/playground tooling, the
     requirement→verify quality story, and "LLM-safe".
   - **Target-matrix table** — backend × frontend × (generates / compiles /
     boots / wire-identical), with unverified cells marked as such.
   - **What it's like to actually use it** — the Phase 0/1/5 narrative: time to
     first app, where the model was pleasant, where the ceiling is, what
     maintenance feels like.
   - **Gap register** — findings grouped by severity, with the
     SILENT/HONEST/DOCUMENTED split counted.
   - **Risk register** — technical, operational, organizational, vendor/bus
     factor, exit cost. Each with likelihood, impact, and a mitigation.
   - **Fit analysis** — which kinds of project this is clearly good for, which
     it is clearly wrong for, and where our next product falls.
   - **Comparison** against the realistic alternatives.
   - **Top 10 fixes ranked by adoption impact** — what the Loom team would have
     to change, in priority order, to move your verdict up.
   - **Coverage and limits of this evaluation** — what you did not test, what
     you could not verify in this environment, and where your confidence is low.
2. **`eval/FINDINGS.md`** — the numbered findings register, as specified above.
3. **`eval/EVAL-LOG.md`** — the chronological working log: commands, errors,
   timings, dead ends. This is your evidence trail; a reviewer must be able to
   re-run your work from it.
4. Your `.ddd` sources and minimal repros under `eval/fieldops/` and
   `eval/repro/`, plus any generated trees you want to keep as evidence
   (prune the large ones; keep the diffs and logs).

# Calibration — how to not write a bad report

- **Do not be a cheerleader.** "Impressive breadth" is not a finding. If you
  find yourself praising the architecture, ask what a *buyer* gets from that
  sentence, and cut it if the answer is nothing.
- **Do not be a hater.** A missing feature that is clearly documented as missing
  is cheap; say so. Count HONEST gaps separately from SILENT ones and let the
  ratio speak.
- **Never report coverage you don't have.** "Backends work" after testing one
  is the single most damaging sentence you could write. Label everything with
  what you sampled.
- **Quantify.** Minutes, file counts, lines of `.ddd` vs lines generated, build
  times, number of commands, number of doc lookups. A buyer needs numbers, not
  adjectives.
- **Distinguish "I hit a bug" from "this is structurally hard."** A bug gets
  fixed next week. A structural limit (the abstraction ceiling, the regenerate
  story, the ops model) is what you actually have to decide about.
- **Keep the persona.** Write for engineers and a CTO, not for the Loom team.
  No internal file paths in the executive summary; no apologising; no hedging
  where you have evidence.

# Appendix A — feature coverage checklist

Work these in Phase 4, preferring in-context use over feature-tourism. Mark
each: **exercised / smoke-tested / not tested**, with verdict and finding IDs.

**Language core**
aggregates, entities/parts and containment · value objects + invariants ·
enums · optional and collection types · derived fields · functions ·
operations with preconditions · events and `emit` · repositories and custom
`find`s · cross-aggregate references (`X id`) · criterion (reusable
predicates) · payload/command/query/response/error records · discriminated
unions and `option` · abstract aggregates, `extends`, TPC vs TPH, polymorphic
reads · domain services · capabilities (`auditable`, `softDeletable`,
`tenantOwned`, `versioned`, tenant registry) · macros (`scaffold`, `crudish`,
`softDelete`) and macro unfold · multi-file models and imports · the standard
library (scalars, collection ops, money/decimal semantics, date/time) ·
`extern` operations · provenanced fields and `ddd snapshot`.

**Systems layer**
modules/contexts · `api`, `storage`, `ui`, `deployable` composition ·
multiple deployables and per-deployable platform choice · docker compose
output · resources (object store, queue, email, outbound API) · channels and
brokers (redis/rabbitmq/kafka), CloudEvents envelope, outbox relay ·
workflows (transactional, isolation, event drain) · Kubernetes/Helm output ·
migrations (`MigrationsIR`, destructive/rebaseline gating, who owns
migrations) · observability envelope and logs · the `.loom/` artifact bundle
(wire spec, mermaid/LikeC4 views, traceability, verification, source map).

**Frontend**
the page DSL and its primitive library (layout, tables, forms, modals, tabs,
stats, file upload, match/lambdas, page state) · scaffolded pages vs
hand-written pages and everything between (the customization gradient) ·
the six frameworks · design packs and swapping them · navigation/menus ·
forms and client-side validation against invariants · i18n (`t()`, catalog,
`i18n sync`/`check`) · generated Playwright page objects and e2e harness.

**Auth, tenancy, governance**
OIDC code flow + PKCE + refresh rotation · `enforcement: denyByDefault|opt` ·
permissions catalogue with `implies` · policy read-ladders · `requires`
gates · `mask unless` field redaction · `currentUser` · multi-tenancy
stances, hierarchical scoping, `crossTenant` · the audit trail and entity
history read.

**Quality and tooling**
inline domain tests · API e2e and UI e2e tests ·
`requirement`/`solution`/`testCase` traceability · `ddd verify` and its
verdicts · the OpenAPI conformance/parity harness and the runtime-value
semantics rules · `--dry-run` · watch mode · `.loomignore` ·
`--sourcemap` + `ddd trace` + `ddd breakpoints` + the DAP adapter ·
`ddd patch` · the MCP/agent tool surface · the browser playground (typed
editor, visual builder, live preview, in-browser test runner) ·
`ddd new` templates · the docs site itself.

# Appendix B — questions your report must answer explicitly

1. How long did it take an outsider to get a running app? To model a realistic
   domain? To make the first breaking change safely?
2. What can this DSL **not** express, and what do you do when you hit that?
3. When you edit generated code and regenerate, what happens — exactly?
4. Can a breaking schema change be shipped against a production database
   without data loss? Show it.
5. Is tenant isolation and permission enforcement actually airtight in the
   generated code, or only in the model?
6. Are the five backends and six frontends genuinely interchangeable for a real
   model, or is one the real path and the rest demos?
7. Could our SRE team operate the generated stack? Could our engineers debug it?
8. What is the exit cost if we stop using Loom in year two?
9. What is the single most likely way this decision blows up, and how would we
   see it coming?
10. Your verdict, and the exact conditions that would change it.

---8<--- (copy to here) ---8<---

## Tuning knobs

- **Shorter spike.** Keep Phases 0, 1, 2, 5 and 8; make Phase 3 a two-backend /
  two-frontend sample and Phase 4 smoke-only. Phases 0/1/2/5 carry most of the
  signal; Phase 3 is the most expensive and the most skippable.
- **Different lens.** Swap the persona's concern to taste — a security review
  (lead with Phase 6's security work and Phase 2's isolation probes), an SRE
  review (Phase 6 ops + Phase 5 scaling), or a CTO-level build-vs-buy (Phase 7
  plus the comparison and exit-cost sections).
- **Different app.** Replace the FieldOps spec with one from your own domain, or
  with one of the seeds in the **seed library** below. Keep the shape:
  multi-tenant, a lifecycle-heavy central aggregate, money, a cross-aggregate
  transactional rule, files, roles with row-level rules, and one requirement you
  suspect the DSL can't express.
- **Fan out.** The phases are mostly independent after Phase 1. Several agents
  can share one `eval/fieldops/` model — one per backend in Phase 3, one on
  Phase 5, one on Phase 6 — as long as they all write into the same
  `FINDINGS.md` numbering scheme and a single agent writes the report.
- **Known blind spots to force.** If you want the evaluation to land where the
  risk is, tell the agent up front to spend disproportionate effort on (a)
  regenerate-over-hand-edits, (b) breaking migrations against a populated
  database, and (c) compiling every generated target. These three produce the
  findings that decide adoption.

## Seed library — alternative apps for repeat runs

Each seed below is a **drop-in replacement for the prompt's
`# The application you will build` section**. Everything else in the prompt
stays byte-identical, so findings from different runs are comparable.

Each seed names its **stress axes** (what it probes that the others don't) and
its **planted ceiling probes** — requirements chosen because they are plausible
product asks that a model-driven generator may not be able to express. The
probes are the point: they are where "what can this DSL *not* say" gets
answered. Tell the agent the probes are requirements from the product owner,
not hints — it should try to satisfy them and report honestly when it can't.

### Seed A — FieldOps (baseline, as written in the prompt)

Multi-tenant B2B field service. Stress axes: lifecycle aggregate with guarded
transitions, money, a cross-aggregate transactional rule (stock decrement),
file upload, roles with row-level rules, masked fields, a broker-published
event. Planted probes: skill-matching across aggregates, multi-currency
invariant, immutability after issuing, dashboard aggregation.

### Seed B — "Meridian", loan servicing (correctness-and-money lens)

Build **Meridian**, a loan-servicing platform for a lender with several
business units. Every number is audited by a regulator; nothing is ever
deleted.

- **Borrower** (PII, KYC status), **BusinessUnit** as the tenant.
- **LoanApplication** — lifecycle `Submitted → UnderReview → Approved |
  Declined → Funded`, with a decision record naming who decided and why.
- **Loan** — principal, annual rate, term, an **amortization schedule** of N
  scheduled instalments generated at funding time (principal/interest split per
  row, with a documented rounding policy that must make the final instalment
  absorb the rounding residue).
- **Payment** applied against a loan with a waterfall (fees → interest →
  principal); a payment may be reversed, never edited.
- **LedgerEntry** — append-only double-entry: every financial action posts
  balanced debit/credit pairs, and the invariant "debits equal credits" must
  hold for each posting.
- **InterestAccrual** — accrued daily, per loan, by a scheduled process.
- **DelinquencyStatus** derived from days-past-due buckets; **Statement**
  generated monthly as an immutable document.
- Reporting: portfolio balance **as of an arbitrary past date**, delinquency
  ageing buckets, and a per-business-unit regulator export.

Non-domain: OIDC with `servicer`, `underwriter`, `auditor`, `readOnly` roles;
an `auditor` who can read everything across business units but write nothing;
every field on a funded loan provenanced; full audit trail; traceability on
the three regulator-facing requirements; no soft delete anywhere (deletion
must be impossible, not merely discouraged).

Deployables: one backend + one admin frontend + a separate scheduled-jobs
deployable.

**Stress axes:** decimal/money precision and rounding policy, append-only
immutability, temporal/as-of reads, scheduled recurring computation, audit and
provenance under regulatory framing, a read-everything/write-nothing role,
derived values that must be reproducible years later.

**Planted ceiling probes:** (1) portfolio balance *as of* a past date;
(2) generating N schedule rows from one operation; (3) banker's rounding with a
residue rule; (4) the cross-entry "debits equal credits" invariant spanning
more than one aggregate instance; (5) a daily accrual job — where does
scheduled work live at all?

### Seed C — "Clinica", clinic scheduling (time, concurrency, privacy lens)

Build **Clinica**, appointment scheduling and clinical records for a chain of
clinics in three timezones.

- **Clinic** (the tenant, each with its own timezone), **Room**, **Practitioner**
  with weekly **availability windows** plus date-specific exceptions.
- **Patient** — heavy PII, plus an insurance policy reference.
- **AppointmentType** with a default duration and a required practitioner skill.
- **Appointment** — start + duration (not an arbitrary pair of timestamps),
  practitioner, room, patient, lifecycle `Requested → Confirmed → CheckedIn →
  Completed | NoShow | Cancelled`. **No two appointments may overlap for the
  same practitioner or the same room.**
- **Waitlist** — when a slot frees up, the first matching waitlist entry is
  offered it.
- **Encounter** — clinical notes attached to a completed appointment, plus
  vitals; notes are readable only by clinical staff, never by front desk.
- **Referral** to an external specialist, sent by email.
- Reporting: a day/week calendar view per practitioner, utilisation percentage
  per room, and a no-show rate per clinic.

Non-domain: roles `frontDesk`, `clinician`, `clinicManager`, `patient` (a
patient portal showing only their own appointments); clinical notes masked from
non-clinicians; **read access to a patient record must itself be audited**;
appointment reminders sent 24h ahead over a broker; patient-facing portal
localized into two languages; GDPR data-export and erasure requests.

Deployables: one backend, a staff frontend, and a patient-portal frontend on a
*different* framework off the same backend.

**Stress axes:** datetime/duration/timezone arithmetic and DST, overlap
prevention under concurrency, recurrence (weekly availability + exceptions),
optimistic concurrency on a contended row, read-auditing, field masking by
role, two frontends on one backend, i18n.

**Planted ceiling probes:** (1) double-booking under *concurrent* requests —
fire two bookings for the same slot in parallel and see whether the model's
invariant actually holds at the database level; (2) expanding weekly
availability + exceptions into bookable slots; (3) a correct
"today's appointments" query when clinic and viewer are in different
timezones; (4) auditing *reads*, not just writes; (5) the calendar view —
grouping across a join and ordering by time.

### Seed D — "Clearline", insurance claims (workflow and polymorphism lens)

Build **Clearline**, claims handling for a mid-size insurer.

- **Policy** with **Coverage** lines and per-coverage limits and deductibles.
- **Claim** as an **abstract** type with three concrete kinds — `AutoClaim`
  (vehicle, driver, police report number), `PropertyClaim` (property address,
  peril, contractor estimate), `LiabilityClaim` (third party, legal counsel) —
  sharing a common lifecycle and appearing together in one queue. Decide and
  justify one-table vs table-per-type, then **change your mind and migrate**.
- **Adjuster** assignment with **authority limits**: an adjuster may approve a
  payout only up to their own limit; above it the claim escalates to a
  supervisor, and above that to a committee. Authority may be **delegated**
  for a date range.
- **ApprovalStep** chain of variable length with an **SLA**: a step unanswered
  for 3 business days escalates automatically.
- **Reserve** amounts revised over the claim's life (history retained),
  **Payout** (partial payouts allowed), **Subrogation** recovery.
- **Document** attachments (photos, PDFs) run through an external OCR service;
  a **fraud score** fetched from an external scoring API at intake.
- Decision outcomes modelled as a discriminated union (`Approved` /
  `DeniedWithReason` / `NeedsMoreInfo(fields)`), surfaced in both API and UI.
- Reporting: open claims by kind and age, loss ratio per product, adjuster
  workload.

Non-domain: roles `intake`, `adjuster`, `supervisor`, `legal`, `sio`; the
authority-limit rule is an authorization decision that depends on the
*record's* amount and the *actor's* limit; full audit trail; claim documents in
an object store; claim-status-changed events published to a notifications
deployable.

Deployables: one backend, an internal frontend, a notifications deployable.

**Stress axes:** inheritance + polymorphic reads + a TPC↔TPH migration,
discriminated unions end to end, long-running workflow with human steps,
durable timers and SLA escalation, value-dependent authorization, delegation,
external API integrations, document pipeline.

**Planted ceiling probes:** (1) authorization that depends on a record value
and an actor attribute together; (2) an approval chain whose length isn't known
at model time; (3) an escalation that fires 3 *business* days later — durable
timers and a business calendar; (4) resuming a workflow after a human answer
days later; (5) a single queue page listing all three claim kinds with
kind-specific columns.

### Seed E — "Bazaar", multi-vendor marketplace (public read, breadth, money lens)

Build **Bazaar**, a marketplace where independent vendors sell to the public.

- **Vendor** is the tenant — but the *shopper* is not tenant-scoped at all, and
  most read traffic is **unauthenticated**.
- **Product** with an option matrix producing **Variants** (size × colour →
  SKU), per-**Warehouse** inventory, and prices in the vendor's currency with
  display in the shopper's currency.
- **Cart** created anonymously and **merged into the shopper's account on
  login**.
- **Order** — one shopper checkout splits into per-vendor **Shipments**, each
  fulfilled independently; payment captured once through an external PSP, with
  **compensation** if one vendor's stock reservation fails after capture.
- **Payout** per vendor on a schedule, net of commission.
- **Review** with a moderation queue; **Promotion** rules (percentage, fixed
  amount, buy-X-get-Y, vendor-scoped or global, with eligibility conditions).
- Public browse: category tree, faceted filtering (price range, attributes,
  rating, in-stock), sort by price/rating/newest, keyword search, deep
  pagination.
- Reporting: GMV per vendor per month, conversion, top SKUs.

Non-domain: three auth postures in one system (anonymous browse, shopper
account, vendor back-office) with vendors seeing strictly their own data;
product media in an object store; `OrderPlaced` / `ShipmentDispatched`
published over a broker; storefront localized into two languages with
multi-currency display; realistic seed data (hundreds of products) so the list
pages are not tested on three rows.

Deployables: one backend, a public storefront frontend, a vendor back-office
frontend on a different framework, and a **mobile** frontend if the toolchain
offers one.

**Stress axes:** mixed public/authenticated access in one model, tenant =
vendor rather than customer, variant matrices, cart identity transition,
cross-deployable saga with compensation, multi-currency and tax, search and
faceting, frontend breadth including mobile, seed data and list-page
performance.

**Planted ceiling probes:** (1) faceted + keyword search with deep pagination;
(2) anonymous cart merged on login; (3) a promotion rule engine whose rules are
data, not code; (4) partial-failure compensation after payment capture;
(5) showing prices in the viewer's currency at read time; (6) sorting a list
page by a derived field.

### Seed F — "Fleetwatch", device fleet and telemetry (scale and integration lens)

Build **Fleetwatch**, an operations console for a company that manages tens of
thousands of deployed devices for its customers.

- **Customer** org tree (region → country → site) as a **hierarchy**, with
  scoping that must respect the tree.
- **Device** with model, firmware version, location, and a connectivity state.
- **TelemetryReading** — many readings per device per minute; the console shows
  latest values, 24h trends, and monthly rollups.
- **AlertRule** — thresholds per device model or per site, producing
  **Incident** records with an acknowledge/resolve lifecycle and an on-call
  escalation.
- **FirmwareRelease** + **RolloutCampaign** — staged rollout to a cohort with
  pause/resume and a failure budget.
- **Command** dispatched *to* a device through an outbound queue, with an
  acknowledgement coming back.
- **BulkImport** — onboarding 10,000 devices from a CSV, idempotently.
- **Inbound webhooks** from devices and from the connectivity provider, with
  signature verification and replay protection.
- **MaintenanceWindow** suppressing alerts for a scope and period.
- Reporting: fleet health dashboard, SLA compliance per customer, incident MTTR.

Non-domain: this model must be **large** — grow it to 30–40 aggregates across
several modules (add the adjacent domains a real console has: spare parts, RMA
returns, contracts, users and API tokens, audit, saved views — and script the
generation of filler aggregates if needed to reach the size); telemetry
retention with deletion after 13 months; an ops focus throughout (metrics,
tracing, health, config, secrets, a Kubernetes deployment path).

Deployables: one backend, one operator frontend, one ingest deployable, and a
Kubernetes target if the toolchain offers one.

**Stress axes:** the scaling-cliff test (parse, generate, build, and review
times at 30–40 aggregates), high-write/time-series modelling, bulk idempotent
import, inbound webhooks, outbound queue commands, hierarchical tenant
scoping, retention/TTL deletion, dashboards and rollups, ops and k8s.

**Planted ceiling probes:** (1) time-series storage with downsampled rollups;
(2) a 10k-row idempotent bulk upsert in one request; (3) an inbound webhook
endpoint with signature verification; (4) live device state in the UI (polling
vs push); (5) deleting data by retention policy in a system with an audit
trail; (6) whether anything in the toolchain degrades non-linearly as the model
grows.

### Seed G — "Commons", community platform (privacy-tension and recursion lens)

Build **Commons**, a community platform a company runs for its customers.

- **Member** profile with a display name and private contact details.
- **Post**, and **Comment** nested to **arbitrary depth** (a reply to a reply
  to a reply), with per-item visibility (public / members-only / group-only).
- **Group** with membership roles, **Follow** relationships between members.
- **Reaction** counts, **Report** (abuse) feeding a **moderation queue** with
  `Upheld`/`Dismissed` outcomes, **Ban** with a duration and an appeal.
- **Media** upload (images, short video) through an external scanning service
  before becoming visible.
- **NotificationFeed** per member, fanned out when someone they follow posts,
  or when their content is replied to.
- Search across posts; a home feed of "posts from people I follow, newest
  first", paginated.
- **GDPR erasure**: a member requests deletion — their PII must disappear while
  moderation decisions and the audit trail must survive, and their posts must
  become attributed to a tombstone author without breaking the comment trees.

Non-domain: roles `member`, `moderator`, `admin`, plus an unauthenticated
public view; rate limiting on posting and reporting; soft delete for member-hidden
content coexisting with hard erasure for GDPR; audit trail of moderation
actions that survives erasure.

Deployables: one backend, a web frontend, and a notifications deployable.

**Stress axes:** self-referential recursive structures, per-item visibility
rules (row-level authorization driven by data, not role alone), the designed
contradiction between append-only audit and right-to-erasure, graph traversal
for the feed, fan-out over a broker, media pipeline with an external gate, rate
limiting.

**Planted ceiling probes:** (1) arbitrary-depth comment trees — model, query,
and render them; (2) the follow-graph feed query; (3) GDPR erasure against an
append-only trail, including the tombstone-author rewrite; (4) rate limiting;
(5) visibility rules evaluated per row for an anonymous viewer.

### Running the set

- **Vary only the app section.** Same rules, same phases, same deliverables, so
  the runs can be compared and merged.
- **Namespace the findings.** Give each run a prefix — `F-MERIDIAN-001`,
  `F-CLINICA-001` — and have each run write to
  `eval/<seed>/{EVALUATION-REPORT,FINDINGS,EVAL-LOG}.md`.
- **Pair a seed with a lens** where it fits: B with the correctness/compliance
  lens, C or G with the security/privacy lens, F with the SRE lens, E with the
  frontend-breadth lens, D with the build-vs-buy lens.
- **Then consolidate.** After the runs, do one separate pass over all the
  registers that answers: which findings appeared in **every** seed (structural
  — these decide the verdict), which appeared in **one** (domain-specific —
  these decide *fit*), where two runs **disagreed** about the same feature (one
  of them is wrong, and finding out which is worth the time), and whether the
  claim-verification matrices agree. A claim graded Verified in one run and
  Contradicted in another is the single most valuable signal the set produces.
- **Expect the probes to land differently.** If every seed's planted probes come
  back expressible, either the toolchain is stronger than the probes assumed or
  the agent is grading itself generously — check the evidence before believing
  the happy answer.
