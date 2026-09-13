# Loom Evaluation — Working Log

Evaluator: senior staff engineer spike, per architecture-council request.
Repo: `Loom-Harness/loc`, branch `claude/loom-dsl-evaluation-dhw7gb`, base commit `09427a5`.
Start: 2026-09-13T09:19:53Z (all timestamps UTC).

Rules in force: docs are marketing until proven by running something; classify
every gap HONEST/SILENT/DOCUMENTED; blind to maintainer-internal material
(CLAUDE.md, docs/new-plan, docs/old, docs/audits, experience_gathered.md,
.claude/, test/) until Phase 7; never fix the toolchain (scratch-copy patches
only, recorded as findings); never open a PR against Loom.

---

## Phase 0 — Cold start

### 09:19 — repo state
`git log --oneline -5` shows recent merge activity (#2889, #2879, #2875) —
confirms fast-moving main as CLAUDE.md-adjacent docs will later claim, but
noted here only as an observable git fact, not a docs claim.

### 09:20 — `npm install` (per README "Install" section, verbatim minus the
separate `langium:generate`/`build` steps — `npm install` runs the `prepare`
lifecycle which does both)
Command: `npm install`
Result: 35.066s wall clock. Output includes ~17 Langium linter warnings
("Found multiple assignments to 'X' with the '=' assignment operator") —
cosmetic, not blocking. `build:web` step no-ops (web/node_modules absent,
as documented). `npm audit`: 11 vulnerabilities (1 low/6 moderate/4 high) in
dev dependencies — not investigated further in Phase 0 (revisit in Phase 7
security/ops pass if time allows).
`node --version` → v22.22.2 (README says "Requires Node 20+" — satisfied).
`node bin/cli.js --help` → works, lists parse/patch/generate/verify/trace/
breakpoints/snapshot/new/i18n. Matches docs/tools.md's command list.

### 09:21-09:56 — README "Quick example" reproduction (verbatim)
Copied the README's own flagship `.ddd` code block byte-for-byte into
`eval/repro/readme-quickstart.ddd` and ran `ddd parse` on it, per the
evaluation contract's instruction to treat docs as unproven claims.
Iterated fix-by-fix (see full detail in FINDINGS.md F-001): `module`→
`subdomain` (not a keyword at all), `modules:`→`contexts:[...]`, inline
comma-separated aggregate body→newline-separated, `Money(...)`→`Money{...}`
("v2 syntax" diagnostic), bare `expect X`→`expect(X).toBe(Y)`, added missing
`ui:` binding on the React deployable, added `storage`/`dataSource`
declarations, added a `derived display` field on `Product`, and discovered
the e2e test's `api.orders.addLine(...)` call has no corresponding
`operation addLine` on the `Order` aggregate anywhere in the README's own
model — i.e. the example's test could never have passed as printed, even
after every syntax defect is fixed.
Total: 8 distinct validation errors across 8 categories before `ddd parse`
went clean. ~35 minutes elapsed. Logged as **F-001, S2, effectively a
SILENT-for-the-reader doc-freshness gap** (the compiler itself never failed
silently — every rejection carried a diagnostic; the gap is that README.md
was not kept in sync with the language across what looks like at least two
breaking grammar/language revisions: the `module`→`subdomain` rename and a
`Money(...)`→`Money{...}` "v2 syntax" change).
Time-box note: per rule 7, spent the bounded ~10 minutes first checking
`docs/README.md`/`docs/language.md` mentions of `module` vs `subdomain` —
found none disambiguating; escalated to grepping the grammar directly, which
resolved it in under a minute. Correct call per the contract: grammar >
prose when they disagree.
Fixed, fully-parsing version saved for reuse: `/tmp/quickstart-fixed3.ddd`
(not checked in — superseded by the FieldOps model going forward; the
broken-verbatim repro in `eval/repro/readme-quickstart.ddd` is the artifact
that matters for the finding).

### 09:24-09:34 — `ddd new` scaffold path (the sanctioned Phase 0 route)
`node bin/cli.js new phase0app --platform node --template crud -o eval/phase0app`
→ 1.05s, 4 files, clean. `main.ddd` (the scaffold's own model) parses with 0
errors on first try — a sharp contrast with the README's quick example.
`node bin/cli.js generate system main.ddd -o .` → 1.2s, 83 files, 1 benign
warning (a `find` recommendation, not an error).
**Headline Phase 0 number: cold clone → first successful `parse` = ~1 min;
→ first fully generated multi-deployable tree = ~2 min** (dominated by
`npm install`'s 35s, not by anything DSL-specific), **provided you use `ddd
new` and never look at the README's own quick-start code block.** Via the
README's own quick example instead: ~35-40 min (see F-001).

### 09:24-09:50 — `docker compose up -d --build` on the scaffold
Started `dockerd` (not auto-started; 1.5s to answer `docker info`).
`docker compose up -d --build` on the 83-file generated tree: **ran 24m46s
and then FAILED** — `npm error code SELF_SIGNED_CERT_IN_CHAIN` inside the
`api` build stage's `npm install` layer. Root-caused via
`/root/.ccr/README.md` (this sandbox's own proxy-troubleshooting doc,
consulted per rule 7's bounded-effort-before-blaming-the-tool clause): "docker
build / docker run: processes inside containers cannot reach 127.0.0.1:43033
and do not trust the CA" — a **sandbox networking limitation, not a Loom
defect**. The generated Dockerfile does try to accommodate a corporate MITM
proxy (`COPY certs/ ...` + appends to `/etc/ssl/cert.pem`), but that only
patches the OS trust store, not npm's own CA config (`npm config get cafile`
/ `NODE_EXTRA_CA_CERTS`) — worth a light docs/DX note (not logged as a
scored finding: this is this environment's proxy shape, not demonstrably
representative of a typical enterprise network, and rule 6 forbids treating
"I had to route around my sandbox" as evidence against the product).
**Not counted as a Loom finding.** Time cost noted for the record: 24m46s of
wall clock spent on a docker layer that a plain `npm install` in the same
tree (below) completed in 26s.

### 09:50-09:52 — Same generated tree, verified WITHOUT docker (direct npm + local Postgres)
To get a real compile+boot+HTTP signal without fighting the sandbox's docker
networking, switched to the environment's already-installed Postgres 16 and
ran the generated Node backend directly with `tsx`.
  - `cd api && npm install` → 25.8s, 189 packages, 0 vulnerabilities blocking.
  - `npx tsc --noEmit` → **3.3s, 0 errors.** Generated Hono/TS backend compiles clean.
  - `cd ../web_app && npm install` → 12.9s, 78 packages. `npx tsc --noEmit` → 0 errors (React frontend, generated by the same `generate system` run, also compiles clean).
  - `service postgresql start`; `createdb fieldops_phase0`.
  - `npx drizzle-kit migrate` against the empty DB → **applied cleanly, no errors** (the one generated migration file, `20260101000000_core_initial.sql`).
  - Booted the API directly: `DATABASE_URL=... PORT=3000 npx tsx index.ts` → up in <1s, logs `server_listening`.
  - `GET /ready` → `{"status":"ready"}`; `GET /health` → `{"status":"ok"}`.
  - `POST /api/projects {"name":"Acme rollout"}` → `{"id":"01a09a2e-...uuidv7..."}`; `GET /api/projects/<id>` → `{"id":...,"name":"Acme rollout","version":1,"display":"Acme rollout"}`.
  - `POST /api/tasks {"title":...,"project":"<projectId>"}` → succeeds (association round-trip through the generated FK).
  - `GET /api/projects` → paginated envelope `{"items":[...],"page":1,"pageSize":20,"total":1,"totalPages":1}`.
  - Invariant violation: `POST /api/projects {"name":""}` → **HTTP 422**, RFC-7807 `problem+json`-shaped body: `{"type":"about:blank","title":"Validation failed","status":422,"detail":"...","errors":[{"pointer":"/name","message":"Name must be at least 1 character"}]}` — field-level pointer, not just a flat "invalid input."
  - Not-found: `GET /api/projects/00000000-...` → **HTTP 404**, same problem-details shape, human-readable detail naming the id.
**Assessment: this is a genuinely solid, real, unassisted round trip** — real
Postgres, real migration, real HTTP, correct status codes, structured
error bodies, a paginated list envelope, a version field for optimistic
concurrency, and a UUIDv7 (`01a09a2e-...`, time-sortable) id scheme, all
from a 25-line `.ddd` scaffold with zero hand-written code. No SILENT gaps
found in this pass. Logged as a positive Phase 2 data point (not filed as a
numbered finding — nothing was wrong); route prefix is `/api/<plural>` per
`http/index.ts`'s `app.route(...)` calls, not bare `/<plural>` as one might
guess from the README (a 2-minute discovery cost, not worth its own
finding).
Time-box note: the docker path was abandoned after establishing the failure
was environmental, per rule 6/7 — a real docker-network compose boot is
still owed for FieldOps and is planned with `--network host` +
`NODE_EXTRA_CA_CERTS` per the proxy README's own documented workaround,
budget permitting.

## Phase 1/2 — FieldOps model, generate, compile, and a real HTTP round trip

Built `eval/fieldops/main.ddd` incrementally (tenancy → directory → dispatch/
workOrder → billing → auth/permissions → workflow/channels/notifier →
extern/file-upload → traceability/tests), parsing after each slice per the
plan. Full findings from this build are in FINDINGS.md F-003 through F-011;
this log entry is the compile/boot/HTTP narrative.

**First `ddd generate system` + `tsc --noEmit` pass found FIVE separate
SILENT-gap-class defects** in the generated output, all with `ddd parse`
and `ddd generate` reporting 0 errors:
  - F-008: a cross-aggregate repo call inside a plain `operation` (not a
    `workflow`) compiles through the validator, fails `tsc` (`Technicians`
    undefined in `domain/workOrder.base.ts`).
  - F-009: `api.workflows.X(...)` in an e2e test against a *backend*
    deployable crashes `ddd generate system` with a raw JS stack trace.
  - F-010: an inline (non-`let`) `Repo.getById(...)` inside a workflow
    `precondition` is dropped from codegen — undefined name in
    `http/workflows.ts`.
  - F-007 (two variants): a workflow reading a repository from a DIFFERENT
    context than its own either gets a misleading `loom.workflow-unknown-
    binding` (Variant A) or passes validation and produces the same
    undefined-name codegen bug as F-010 with ZERO diagnostics (Variant B).
  - F-011: `ui with scaffold(subdomains: [...])` generates Detail/List pages
    for aggregates whose context is hosted by a DIFFERENT deployable than
    the UI targets (the "separate notifier deployable" architecture this
    evaluation's own spec calls for) — the page ships a literal
    `/* TODO ... */ undefined` data-fetch hook, 38 TS errors across 4 pages
    in the real FieldOps build, `tsc` fails outright.

Fixed all five in the model (documented inline in `eval/fieldops/main.ddd`'s
comments) to get a clean build: converted the ad hoc skill-check `operation`
into a proper `scheduleWorkOrder` workflow; relocated `Part` and `Technician`
into the `Dispatch` context (same-context-only repo access from workflows);
dropped the inline `Assets.getById(...)` skill-match sub-check (AC-001 is
consequently UNDER-TESTED in this build — a real cost of F-010, not a free
workaround); scoped `ui WebApp with scaffold(aggregates: [...])` to only the
`api`-served aggregates instead of `scaffold(subdomains: [Core])`.

**After all five fixes: FieldOps's three deployables (api/Hono, notifier/
Hono, web_app/React+Mantine) all `npm install` + `npx tsc --noEmit` CLEAN.**
198 files, generated in 1.8s from a ~420-line `.ddd` source.

**Real HTTP round trip** (no docker — direct `tsx` boot against the
environment's local Postgres 16 + Redis, per the same environmental
workaround as the phase0 scaffold test; a scratch `test-index.ts` copy
registers a trivial base64-JSON bearer-token decoder in place of the real
OIDC/JWKS verifier — evaluation-only, never touches the generated product,
recorded per rule 6):
  - `drizzle-kit migrate` against an empty DB → clean.
  - Boot → `server_listening`, `auth_enabled: required: true`.
  - Created Organization → Customer → Site → Asset → Technician → WorkOrder
    (Draft) via real HTTP POSTs, each returning a UUIDv7 id.
  - `POST /api/workflows/schedule_work_order` (the transactional, multi-
    aggregate workflow) → **204**, and the WorkOrder correctly shows
    `status: "Scheduled"`, `technicianId`, `technicianUserId` (denormalized
    per F-005) all populated in one atomic call.
  - `start` → 204. `complete` with no lines → **422** `Precondition failed:
    lines.count > 0` (RFC-7807 body). `add_line` with a EUR unit price on a
    USD work order → **422** `Precondition failed: unitPrice.currency ==
    currency` — **the multi-currency invariant is enforced correctly and
    atomically at the API boundary.** `add_line` with USD → 204. `complete`
    → 204, and `GET` shows `status: "Completed"`, `total: {amount: 100,
    currency: "USD"}` — computed correctly from `2 × 50.00`.
  - **Tenant isolation**: a second tenant's token, hitting the FIRST
    tenant's WorkOrder/Customer by id directly → **404** (not 403 — honest
    concealment, consistent with the generated code's own RFC-7807/RFC-9110
    §15.5.4 reasoning found in `auth/middleware.ts`'s comments), and a plain
    list read returns an empty page, not the other tenant's rows. **No
    cross-tenant leak found in this pass.**
  - **Unauthenticated request** → 401, RFC-7807 body, no route/resource
    disclosure.
  - **Field masking**: `technicians/:id` as role `technician` →
    `costRatePerHour: null`; the same request as role `admin` →
    `costRatePerHour: 40` — `mask unless` enforced correctly per-request.
  - **Row-level "mine" find** (`GET /api/work_orders/mine` as the assigned
    technician's `userId`) → returns exactly the one WorkOrder assigned to
    that technician.
  - **Deliberate cross-tenant admin report** (`GET
    /api/work_orders/across_all_tenants`): role `platformAdmin` → 200,
    sees the row; role `admin` (not platformAdmin) → **403** `Forbidden:
    find acrossAllTenants`. The `ignoring *` escape hatch (docs/tenancy.md)
    plus a `requires` role gate composed exactly as documented.
**No SILENT gap found in this entire HTTP-behavior pass** — every
invariant/precondition/auth/tenancy check that should fire, fired, with the
right status code and a well-formed RFC-7807 body every time. This is a
genuinely strong result for the generated node/Hono/React path specifically
— sample size caveat: **one backend (node/Hono), one frontend (React,
compiled but not exercised in-browser this pass)**, not evidence about the
other four backends or five frontends (see Phase 3).

## Phase 5 — Evolution and maintenance

All tests below regenerate INTO THE SAME output directory (`eval/out-
fieldops-inplace`, seeded from the compiling `eval/out-fieldops` build) —
this matters: a fresh `-o` into an empty directory does not exercise the
incremental-migration story at all (it just re-emits one "initial" migration
from scratch, tested and discarded first as a methodology dead end — see
below).

**1. Additive change** — added `internalReferenceCode: string?` to
`WorkOrder`. `generate system` (in-place): **"Wrote 19 file(s), unchanged:
163, preserved (scaffold-once): 1"** — an honest, itemized accounting of
what changed, out of 183 total. New migration file
`20260101500001_core_add_internal_reference_code_to_work_orders.sql`:
`ALTER TABLE ... ADD COLUMN "internal_reference_code" TEXT NULL;` — minimal,
correctly named, additive-only. Applied via `drizzle-kit migrate` against
the live `fieldops` Postgres DB (which already had one real `WorkOrder` row
from the Phase 2 HTTP test) → succeeded, existing row's data untouched,
new column NULL. **Diff readability: excellent** — a `diff -rq` between two
independent fresh-generate trees for this same change touched exactly 10
real source files (all WorkOrder-related: schema, migration, base domain
class, routes, repository, React page/api/e2e-page-object/locale files)
plus 5 derived `.loom/` artifacts; every other one of 183 files was
byte-identical.

**2. Breaking change — rename** — renamed `resolutionNote` → `closingNote`
(field with real data: `"Fixed the AC unit"` on the one existing row).
`generate system` (in-place) emitted `20260101500002_core_migrate.sql`:
**`ALTER TABLE "dispatch"."work_orders" RENAME COLUMN "resolution_note" TO
"closing_note";`** — correctly recognized as a RENAME, not a drop+add.
Applied against the live DB with the real row present →
**data preserved**: `SELECT closing_note FROM work_orders` →
`"Fixed the AC unit"`. **This is the single most important positive result
in this evaluation**: the generator's migration differ is rename-aware
against real, populated data, not just schema-diff-blind add/drop.

**3. Breaking change — destructive delete (the automatic-S1 trigger
test)** — deleted the (already-renamed) `closingNote` field entirely from
`WorkOrder` (real data still present in that column). `generate system`
(in-place, no flag): **REFUSED, exit code 1**:
```
eval/fieldops/main.ddd: migration for module "Core" contains 1 destructive change(s):
  - DROP COLUMN dispatch.work_orders.closing_note
A migration-block backfill step makes a NOT NULL add or flip non-destructive with no flag needed: ...
Otherwise re-run `generate system` with --allow-destructive to apply them. Column/table drops are irreversible; ...
```
No migration file was written on the refusal. Re-running with
`--allow-destructive` correctly emitted
`20260101500003_core_remove_closing_note_from_work_orders.sql` (a `DROP
COLUMN`), gated behind an explicit, named flag — **not applied against the
live DB** (the point — safe refusal by default — was already proven; running
a real irreversible DROP for evaluation purposes only would destroy the one
data point without adding evidence). **This is exactly the behavior Phase 5
rule 2 is built to test for, and it passed**: data loss is refused by
default, with a clear diagnostic naming the exact destructive operation and
the two ways to proceed (an explicit flag, or a documented non-destructive
backfill escape hatch this evaluation did not have time to also test).

**4. Hand-written code survival** — the core "you own the source" claim,
tested directly:
  - Hand-edited `domain/workOrder.ts` (marked `// loom:scaffold-once — this
    file is yours... NEVER overwrites it again`) — replaced the
    `NotImplementedError` stub for the `notifyCustomer` extern operation
    with a real (marker) implementation.
  - Hand-edited `domain/workOrder.base.ts` (marked `// Auto-generated. Do
    not edit by hand.`) — inserted a comment marker directly into a
    generated method body, as a contrasting negative control.
  - Triggered a further regenerate (added `dispatcherNotes: string?`) — a
    real, unrelated model change, not a no-op regenerate.
  - Result: **the scaffold-once file's hand-edit survived byte-for-byte**
    (both the marker comment and the `console.log` implementation
    reappeared unchanged in the regenerated tree). **The always-regenerated
    base file's hand-edit was silently gone** — no warning, no diff
    surfaced, just overwritten — but this is the file's OWN documented
    contract ("Auto-generated. Do not edit by hand."), not a broken
    promise; the split worked exactly as each file's own header advertises.
  **Assessment: on this one construct (an `extern` operation's
  hand-written body), "you own the source" is real and precisely
  scoped — it is not "you own it until the next regenerate," it is "you
  own the specific files the customization gradient designates as yours,
  and the generator is honest about which files those are, in the file
  itself, not just in a doc."** Not yet tested in this pass: the full
  customization gradient's OTHER escape hatches (page-level `unfold`,
  overriding a repository method by name, ejecting a scaffolded UI page) —
  time-boxed out; flagged as a coverage gap for Phase 4/8.

Time-box note: Phase 5's scaling-cliff test (25-40 aggregate model,
generate/parse/build timing at scale) and the toolchain-upgrade-risk test
(regenerating an older example with current toolchain) were **not
attempted** in this pass — see Coverage and limits in the final report.

## Phase 7 (partial, pre-reconciliation) — project health from git history alone

Checked BEFORE reading any internal docs (git log is not "internal material"
under rule 5 — it's ordinary repo history, and its timestamps/authorship are
objective facts, not the maintainers' own characterization of their work).

- `git log --oneline | wc -l` → **668 total commits.**
- `git log --reverse --format=%ad --date=short | head -1` → **first commit
  2026-08-24.** Today is 2026-09-13 per this session's system context —
  **this entire compiler is ~20 days old.**
- Commit-date histogram: 200 commits on 2026-09-03 alone; 106 on 09-07; 110
  on 09-10; 83 on 09-09; 54 on 09-08 — bursty, multi-hundred-commits-a-day
  velocity, not steady human-paced development.
- `git log --format=%an | sort | uniq -c`: **536 commits authored "Claude"**,
  **131 authored by one human ("Michał Kupiec")**, 1 by "claude[bot]" — i.e.
  **80% of all commits in this project's entire history are AI-agent
  commits**, supervised (per branch names like `claude/fix-svelte-picker-
  dedupe`, `claude/loom-audit-roadmap-r67emx`, `claude/loom-review-planning-
  adz0n4`) by what reads as a single human owner running a fleet of coding
  agents against this repo continuously.
This is a first-order input to the vendor/bus-factor risk section of the
final report — flagged here, developed fully in Phase 7's reconciliation
pass (next) and in the report itself.

## Phase 7 — reconciliation against internal material (now permitted)

Delegated to a subagent (full transcript not read into this session's
context per its own instructions; findings integrated directly into
`EVALUATION-REPORT.md`'s "Phase 7 reconciliation" section — see there for
the full per-finding KNOWN/NOT-FOUND breakdown and citations). Headline
results: F-003/F-005 are confirmed intentional, internally-documented design
constraints, not oversights. F-004, F-007, F-008, F-010, and F-011 are
confirmed genuinely absent from every internal audit/mission/retrospective
— novel findings this session surfaced first. F-012 is a known-fragile
mechanism (already caused and partially fixed one prior incident, #1961)
with a fresh uncovered regression shape. F-001/F-006 are individually
unlisted instances of the single most-repeated class in the project's own
internal audits (docs desynced from a fast-moving grammar). Project-health
confirmation: ~20 days old, ~50+ commits/day sustained, ~78% of recent
commits AI-agent-authored under one human PR-merge gatekeeper, and the
project's own most recent internal audit concludes "a finished compiler
wrapped in an unfinished product" — not yet npm-installable, no
dependency-freshness CI gate. No README/docs-site claim was found
contradicted by internal material; the overclaiming found is narrower
(stale examples) than false feature claims.
