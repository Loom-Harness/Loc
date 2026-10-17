# Helpdesk evaluation — building a ticketing system with Loom as a new user

A developer-persona run on `main` @ `801e0f2b` (2026-10-11). I built a helpdesk over
three iterations. Each iteration stood in for a round of user feedback. Every
iteration was generated, compiled, and booted against Postgres, then exercised over
HTTP. The v2 UI was also driven in Chromium.

| File | What it is |
|---|---|
| `v1.ddd` | First cut: customers, agents, tickets with a status lifecycle, comments, two retrievals |
| `v2.ddd` | Week-1 feedback: auth and roles, server-stamped timestamps, `unique (number)`, SLA timer, "my queue" reads, email on resolve, plus a rename migration |
| `main.ddd` (v3) | Month-1 feedback: hide internal notes, categories and tags, a per-priority dashboard projection, auto-escalation on SLA breach, a stored SLA deadline |
| `repros/` | Minimal `.ddd` repros for the two generator defects |
| `shots/` | Screenshots of the generated React/Mantine UI as an agent and as a customer |

**How it ran.** Docker Hub returned 429 on `node:24-alpine`, so `docker compose up` was
not possible. I followed the generated README's "one deployable at a time" recipe
instead: the node backend ran with `npx tsx` against a host Postgres 16, and the web
app ran with `vite preview`.

## Verdict

The **happy path is very good.** One 150-line file produced a working API, migrations,
a React UI, OpenAPI, a durable cron scheduler, and a reactor chain:

- `can_<op>` endpoints from `when` gates
- 409/422/403 problem details
- dangling-reference 422
- delete-protection 409
- unique → 409

Schema evolution was the standout. The rename heuristic, the `migration` block, the
backfills, the immutable emitted migrations, and the refusal of destructive changes all
caught real mistakes before they shipped.

**It broke down at the first real authorization requirement.** The top feedback item,
"customers can read internal notes and other customers' tickets", cannot be expressed
in the model at all (findings S1–S3). That failure is silent at runtime. Several other
gaps forced awkward workarounds:

- no ticket-number sequence
- the `create` body is inert
- derived fields are not queryable
- a timer needs a phantom aggregate

---

## Findings

Status key: **NEW** = I found no open PR or plan mission for it. **IN FLIGHT #N** = an
open PR covers it. **PLANNED M-x** = a `docs/new-plan` mission tracks it.

### Security / correctness — the model cannot express it, or it is silently wrong

| # | Finding | Status |
|---|---|---|
| S1 | **By-id reads cannot be gated.** `GET /api/tickets/{id}` serves any ticket to any authenticated caller. Eve read Ann's ticket, internal comments included. The workaround of moving notes into a separate `InternalNote` aggregate leaks the same way through `GET /internal_notes/{id}`. The compiler warns (`loom.default-deny-by-id-ungated`) but offers no way to fix it. | IN FLIGHT #3109 (403s by-id under denyByDefault); PLANNED M-T3.19 |
| S2 | **A `filter` cannot branch on role.** `filter currentUser.role == "agent" \|\| this.customer == currentUser.customerId` is rejected (`loom.criterion-not-selectable`: each comparison needs a column). So "agents see all, customers see their own" has no spelling, even though `filter` is the mechanism that would also cover by-id reads. A `currentUser`-only operand is a bind parameter and SQL handles `($1 = 'agent' OR customer = $2)` fine. The by-id warning should also name `filter` as the fix once it works. | NEW |
| S3 | **No row- or element-level masking.** `mask unless` takes caller-only predicates on aggregate fields. "Hide comments where `internal`" (a contained part, keyed on a sibling field) is impossible. | NEW |
| S4 | **The OIDC block removes the dev stub.** With `auth { oidc {…} }` there is no `x-loom-dev-claims` path, so local development needs a running IdP. I had to comment the block out to test my own gates. The scaffolded README tells you to paste the oidc block. There is no env toggle such as `LOOM_AUTH_DEV_STUB=1`. | NEW |
| S5 | **A create guard cannot read its params.** It also cannot stamp a field from `currentUser`, and `currentUser.customerId` (declared `Customer id?`) is not narrowed by a preceding `requires … != null`. A customer opening their own ticket therefore needs a workflow plus a redundant `customer` param guarded by `requires currentUser.customerId == customer`. `loom.lifecycle-guard-unreadable` also says the POST "takes the field-derived create input, not the declared parameter list". That is surprising: the declared params are not the contract. | NEW (relates to M-T3.16, inert create body) |
| S6 | **No system-only operations.** `flagBreached` / `escalate` must be callable by the timer and reactor workflows but not by clients. The only option is a public route with `requires true`. (#3103 adds `currentUser.isSystem` for reactors, which would allow `requires currentUser.isSystem`, but there is still no unrouted, workflow-callable operation.) | partly IN FLIGHT #3103 |

### Generator defects — valid `.ddd` produces broken output

| # | Finding | Repro | Status |
|---|---|---|---|
| G1 | A resource call (`mail.send`) in an **event-triggered** workflow starter: `ddd parse` is clean, then `generate` **throws** on java ("reached the Java renderer without a resource class mapping") and elixir ("unsupported reactor statement kind 'resource-call'"). | `repros/reactor-mailer.ddd` | IN FLIGHT #3187 and #3183 (both fix it) |
| G2 | Workflow `slaSweep` and aggregate `SlaSweep` both map to table `sla_sweeps`. Validation is clean (`loom.workflow-name-collision` is case-sensitive). node `tsc` fails on a duplicate `export const slaSweeps`, and the migration runs `CREATE TABLE … sla_sweeps` **twice**. This was reproduced on node, python and java. The broken snapshot then gets committed to `.loom/snapshots`, so the rename afterwards shows up as `DROP TABLE` (see M4). | `repros/workflow-aggregate-table-collision.ddd` | NEW |
| G3 | The `.NET` backend rejects an `operation comment` beside an `entity Comment` (`loom.dotnet-name-collision`). The rejection itself is honest, but one backend's naming rule forces a domain rename that should be escaped (`@Comment` or a qualified type name). | `main.ddd` with `platform: dotnet` | IN FLIGHT? #3155 / #3185 (reserved-identifier escaping), unconfirmed for this case |

### Migrations / evolution

| # | Finding | Status |
|---|---|---|
| M1 | Adding `unique (number)` to a populated table produced a migration that failed at boot on existing duplicate rows, with no generate-time warning. The boot log line was just `Failed query: CREATE UNIQUE INDEX …` without the Postgres `detail` (which row and which key). The migration was correctly transactional and rolled back. | IN FLIGHT #3141 (unique-on-existing-table warning); the log-detail half is NEW |
| M2 | `implements auditable` on an existing aggregate needs four hand-written backfills (`updatedAt` / `createdBy` / `updatedBy`). The capability could carry its own backfill defaults (`now()` / `"system"`). | IN FLIGHT #3248 (capability-column backfill) |
| M3 | Adding `tags: string[]` cannot be backfilled (`loom.backfill-target-invalid`: collection). `--allow-destructive` then emits `-- TODO backfill` followed by `SET NOT NULL`, which **is guaranteed to fail** on a populated table. An empty array is the natural default for a collection column. I hand-edited the SQL, and regeneration kept my edit: emitted migrations are immutable, which is good. | NEW |
| M4 | There is no "discard the unapplied last migration" command (cf. `ef migrations remove`). After G2, recovering meant deleting snapshots, migrations and ledger by hand. The snapshot is overwritten in place, so without git there is no previous baseline to go back to. | NEW |
| M5 | A backfill cannot use a `duration` (`createdAt + hours(24)`), so I fell back to a raw `sql` step. | NEW (minor) |
| M6 | Moving data between tables (internal comments → `InternalNote` rows) has no migration form beyond raw SQL. | NEW (minor) |
| M7 | The ledger is keyed by source file name (`.loom/<file>.migration-history.json`), so renaming the `.ddd` silently starts a new ledger. Stale `migration "…"` blocks also stay in the source forever with no hint that they have been consumed. | NEW (minor) |

### API surface ergonomics

| # | Finding | Status |
|---|---|---|
| A1 | **Zero-argument operations need `Content-Type: application/json` *and* a `{}` body.** Without the header the response is 415; with the header and no body it is 400 "Malformed JSON". `curl -X POST …/resolve` is the first thing anyone tries. | NEW |
| A2 | **The workflow create returns 204 with no id.** A customer who opens a ticket through `openTicket` cannot learn the ticket's id or number. | IN FLIGHT #3140 (opt-in `create(…): T`) |
| A3 | **Retrievals have no route**, yet `loom.repository-find-deprecated` warns on every list `find` once the context has a criterion and tells you to use one. I followed the advice, lost my routes, and went back to the warned-about `find`s, which leaves three permanent warnings. | PLANNED M-T5.31 |
| A4 | **Declaring `find all() requires …` changes the list response shape** from the paged envelope `{items, page, …}` to a bare array. Adding an auth gate silently breaks clients. | NEW |
| A5 | The default list ignores `?status=` and `?sort=` silently. There is no filtering at all, and the UI sorts and pages client-side over the full set. | NEW (known direction?) |
| A6 | There is no auto-number or sequence type, so the client supplies the human ticket number (`T-1`). Expressing `HD-1001, HD-1002…` takes a counter aggregate plus a workflow. | NEW |
| A7 | **A failing `when` gate inside a timer's loop aborts the whole sweep.** `for t in due { t.flagBreached() }` stops at the first ticket whose `when` fails; the event is `timer_emit_failed` with no per-item isolation or partial commit. A reactor's mail failure (`ENOTFOUND`) was logged and dropped, with no visible retry or outbox. | NEW |
| A8 | The 409 "Disallowed" detail does not say which `when` predicate failed, while the 403 detail echoes the full `requires` source. That is helpful in development but discloses the authorization logic in production. | NEW (minor) |
| A9 | A `find byNumber(number): Ticket?` with no `unique (number)` silently returns one of several duplicates. The compiler could warn that a unique-key find has no matching `unique`. | NEW (minor) |
| A10 | Raw zod text reaches users: `Invalid string: must match pattern /^[0-9a-fA-F]{8}-…$/` for a bad id. | NEW (minor) |

### Expressiveness

| # | Finding | Status |
|---|---|---|
| E1 | `duration` is not a type. `function slaFor(p): duration` fails with "Unknown type 'duration'", and the cascading errors are misleading (`Unknown type 'Urgent'`, because `match p { Urgent => … }` is parsed as a variant/type match). Enums cannot be matched by value; the workaround is the predicate form `match { priority == Urgent => … }`. | NEW |
| E2 | **Derived fields are not queryable.** `dueAt < at` in a criterion gives `loom.retrieval-where-not-queryable`, so the SLA deadline had to be stored, stamped `onCreate`, and recomputed by hand in two operations. | NEW |
| E3 | **A `timerSource` needs a phantom aggregate.** The tick event must carry an id (`sweep: SlaSweep id`), so `SlaSweep` exists only for correlation. It then earns a "no code path can create" suggestion, two denyByDefault warnings, a `sla_sweeps` table, and a scaffolded UI page. | NEW |
| E4 | A `create` with no body (`create(...)`) is a parse error, even though the body is inert anyway. | NEW (minor) |
| E5 | `toThrow(precondition)` is incompatible with an authored `message` (`loom.throw-kind-custom-message`): a backend implementation detail leaks into authoring. | partly IN FLIGHT #3243 (bare `toThrow()`) |
| E7 | **Value-collection membership is not queryable.** `tags: string[]` is a Postgres `TEXT[]` column on every backend, but a `where`/criterion `tags.contains("outage")` is refused (only `X id[]` reference collections get `.contains`, through their join table). Postgres renders it as `'outage' = ANY(tags)` (GIN-indexable). | NEW → H8 mission |
| E6 | Projection `count(t.breached)` in a `group by` gives two contradictory errors: "per-row but not grouped", plus "'count' resolves to nothing — write `count(<alias>.<field>)`", which is exactly what I wrote. | NEW |

### Generated UI (React/Mantine scaffold)

| # | Finding | Status |
|---|---|---|
| U1 | **The list shows every column (14).** The ID column comes first as a truncated UUID, and the table scrolls horizontally. Enum badges are ellipsized ("C…", "Ur…"). See `shots/agent-tickets.png`. | NEW |
| U2 | Derived fields (`dueAt`, `overdue`, `commentCount`) appear in neither the list nor the detail view. | NEW |
| U3 | **User-declared finds (`myQueue`, `unassigned`, `mine`) get hooks but no pages.** A customer gets "Forbidden" on Tickets and has no "my tickets" view, so a customer portal is impossible from the scaffold. | NEW |
| U4 | The Home page links every aggregate regardless of role, while the sidebar is role-filtered (`shots/customer-home.png`). | NEW |
| U5 | The "Open Ticket" workflow form asks a customer to pick a Customer from a dropdown backed by a 403 endpoint. The UI has no way to default a param to `currentUser.customerId`. | NEW |
| U6 | The "New ticket" form exposes `status` and `breached`, so you can create a ticket already Resolved. The author can fix this with `immutable`/`managed`, but the scaffold could avoid editing fields that `when`-gated operations transition. | partly IN FLIGHT #3159 (update-gate suggestion) |
| U7 | Operation buttons are enabled by the state gate (`can_<op>`) only, not by `requires`. A customer sees enabled agent-only buttons that 403 when clicked. With the dev stub there is no way to sign in as a role from the browser; I injected the header through Playwright. | NEW |
| U8 | The "Sign out" button floats over page content (bottom right in every screenshot). | NEW (minor) |

### Docs / diagnostics

| # | Finding | Status |
|---|---|---|
| D1 | `docs/language.md` statements table: `for x in Repo.run(R(args)) { … }`. The validator requires `let xs = Repo.run(…)` first (`loom.workflow-foreach-source`). | NEW |
| D2 | `docs/resources.md` § "Consuming a resource" shows `workflow ArchiveOrder(order: Order id) {`, which is a parse error (workflows are members-only). | NEW |
| D3 | `storage mail { type: smtp, from: "…" }` produced "'from' is a Loom keyword, so it cannot be used as a name". The real fix is `config: { from: … }`; the message should say so. | NEW |
| D4 | Several diagnostics carry no `file:line` (`loom.retrieval-sort-unknown-field`, `loom.current-user-needs-auth-ui`, `loom.default-deny-list-ungated`). Many `default-deny-by-id` warnings all point at the same unrelated line. | NEW |
| D5 | The default-deny warnings repeat per aggregate (11 on v2) and drown real issues. There is no summary mode. | NEW (minor) |

---

## What worked well (keep it)

- `ddd new --template crud` → `parse` → `generate` takes about 2 s, and the starter validates clean.
- `when` gates → 409 plus `can_<op>` endpoints, and the UI disables buttons from them.
- Problem details are consistent: a dangling `X id` → 422, a referenced delete → 409, a unique violation → 409, field-level `errors[]` with `msg.<hash>` codes.
- Migration safety: rename detection, `migration` blocks, backfills, raw `sql`, immutable emitted migrations, transactional apply, and `--allow-destructive` as an explicit opt-in.
- `stamp onCreate { … }` with an expression, `implements auditable`, grouped projections done in SQL.
- The timer → workflow → `Repo.run` loop → `emit` → reactor → operation chain worked end to end (T-2 breached, escalated Low→Normal, deadline recomputed).
- Diagnostics are mostly excellent: actionable, with the fix spelled out (`lifecycle-guard-unreadable`, the nullable-narrowing hint, `current-user-needs-auth-ui`, the rename suggestion that names the exact `migration` block to add).

## Suggested priorities (for the planning discussion)

1. **Authorization expressiveness (S1–S3, S5, S6).** Role-branching `filter` (it also closes by-id), element-level visibility for contained parts, create-time stamping from `currentUser`, and system-only operations. This was the first real requirement and it blocked the product.
2. **Generator/validator correctness (G2, M3, A4, A7).** These are cheap and produce silently broken output today.
3. **API ergonomics (A1, A2 in flight, A3 planned, A6).**
4. **Scaffold UX (U1–U5, U7).** Column selection and order, derived fields, pages for declared finds, role-aware Home and buttons.
5. **Docs and diagnostics (D1–D4, E1, E6).**

---

## Proposed fixes — aligned with Loom's rules

Filters applied to every finding:

- **Owner directive:** gaps and bugs outrank architectural improvements, which outrank new surface.
- **Silent beats honest, inverted:** a silent gap (valid `.ddd` in, broken output out) is fixed or turned into a `loom.*` refusal; it is never left silent.
- **Derive, don't stamp; macros emit final AST.**
- **Decisions that settle some findings:** D-ENVELOPE (every list is `Paged<T>`), D-AUTH-OIDC (dev login is the bundled Keycloak, not a stub), D-MIG-DSL-STEPS (no generated file is ever user-edited; data steps live in the `migration` block), D-MIG-NO-DOWN, D-WHEN-GATE-DOMAIN, D-WRITE-TX.

### Re-classified after the alignment pass

| # | Ruling |
|---|---|
| S4 | **Not a code gap.** Per D-AUTH-OIDC, the dev path with `oidc` is the bundled Keycloak in compose, not an accept-all stub. Fix the *docs*: the generated README's "one deployable at a time" recipe must say how to run the IdP, or say that `oidc` needs compose. → H7 |
| M3 | The fix is **not** "hand-edit the SQL" (D-MIG-DSL-STEPS). A collection column gets its empty value as the derived backfill, so `--allow-destructive` never emits a TODO that is certain to fail. → H3 |
| M4 | Discarding an unapplied migration is new CLI surface over the disposable output tree. → plan mission (H8) |
| M6 | Moving data between tables: the raw `sql` step is the documented pressure valve (D-MIG-DSL-STEPS non-goal). → won't fix; docs mention it (H7) |
| A4 | **A bug, not ergonomics.** D-ENVELOPE says every list read is `Paged<T>`, so gating `find all` must not change the shape. → H4 |
| A7 | **As designed.** D-WHEN-GATE-DOMAIN runs the `when` gate inside the domain method on every caller, so a workflow calling a gated op on a row that fails it is refused. The model was wrong (the criterion did not imply the gate). → docs note (H7), plus a suggestion-level lint candidate in H8 |
| G3 | The C#-member-hides-type collision is a target-escaping matter, in flight in #3155/#3185. → verify only (H1) |
| S1, G1, A2, M1-warning, M2, E5 | In flight (#3109, #3183/#3187, #3140, #3141, #3248, #3243). → excluded |
| S3, S5, S6, A5, A6, E2, E3, E7 | New surface or open design questions (element-level visibility, create-time params/stamps, system-only ops, server-side list filters, sequences, queryable derived fields, timers without a correlation aggregate). → `docs/new-plan` missions with the helpdesk evidence (H8) |

### Fleet slices (each tree-fenced, one agent each)

| Slice | Findings | Fence |
|---|---|---|
| **H1** validator/generator correctness | G2 (table-name collision across workflow/aggregate/projection, case-insensitive) · A9 (unique-key find with no matching `unique`) · E6 (projection `count(x)` diagnostic) · E1 (an enum-subject `match` gets a pointer to the predicate form; `duration` named as expression-only) · E4 (bodyless `create(...)`) · G3 verify | `src/ir/validate/checks/`, `src/language/validators/`, `src/diagnostics/messages.ts`, grammar (E4) |
| **H2** role-branching row filter | S2: a `currentUser`-only comparison is admitted in a capability `filter` / criterion as a bound parameter on all five backends, so "agents see all, customers see theirs" covers by-id reads too; the by-id warning names `filter` as the fix | queryable-subset check + each backend's filter renderer |
| **H3** migrations | M3 (collection add backfills to empty) · M5 (`duration` in a backfill renders as an interval) · M1 log half (`migration_failed` carries the driver's detail) · M7 (consumed `migration` blocks get an advisory) | `src/system/migrations-builder.ts`, `src/generator/sql-pg*`, backend migrate runners |
| **H4** HTTP edge | A1 (zero-arg op accepts no body / no content-type) · A4 (declared `find all` keeps `Paged<T>`) · A10 (a malformed id gets a human message, not the regex) · A8 (409 names the failed `when` predicate's message) | route/request emitters, five backends |
| **H5** scaffold macros | U1 (sane default list columns: natural key first, no raw id column, cap) · U2 (derived fields on detail/list) · U3 (pages for user-declared list finds) · U4 (Home cards respect page `requires`) · U5/U7 (op buttons and workflow forms honour `currentUser`-only gates) | `src/macros/stdlib/scaffold/` |
| **H6** design-pack visuals | U1 badge truncation · U8 sign-out overlay — every pack that shows it | `designs/` |
| **H7** docs and diagnostics | D1 · D2 · D3 (storage `config:` hint) · D4 (diagnostics without `file:line`) · D5 (repeated default-deny warnings summarised) · S4/M6/A7 docs | `docs/`, CLI reporter, `messages.ts` (wording only) |
| **H8** plan missions | S3, S5, S6, A5, A6, E2, E3, M4 and the A7 lint go into `docs/new-plan` tracks, de-duplicated against existing missions (M-T3.16, M-T3.19, M-T5.31) | `docs/new-plan/` only |
