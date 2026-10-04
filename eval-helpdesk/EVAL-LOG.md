# Helpdesk evaluation — working log

Persona: product developer adopting Loom to build an internal/SaaS **helpdesk / ticketing** system.
Checkout: `main` @ bce7f409 (2026-10-04). Node 22, Docker 29 (daemon started by hand).
Every iteration lives in its own folder (`v1/`, `v2/`, `v3/`) with the `.ddd` model; generated output is not committed.

---

## Iteration 1 — MVP (`v1/main.ddd`, 107 lines)

Customers, Agents, Tickets with a status lifecycle (`when`-gated operations), a contained
`Comment` part, a criterion + retrieval for an "open queue". Node/Hono + React/Mantine.

| step | result |
|---|---|
| `ddd new helpdesk` | 4 files, starter parses. |
| first `parse` of my own model | **0 errors on first attempt** (2.5 s). One index suggestion (`Ticket.status`). |
| `generate system` | 94 files, 3.1 s. |
| `docker compose up --build` | Docker Hub returned **429** for `postgres:18-alpine` / `node:24-alpine` (environment, not Loom) — pulled via `mirror.gcr.io` and retagged. Then 70 s to a healthy 3-service stack. |
| CRUD + ops via curl | works; RFC7807 problem+json with field pointers; FK violation → 422 "references a record that does not exist"; `when` gate → 409 "Disallowed"; `GET …/can_close` → `{allowed:false}`. |
| UI (Playwright screenshots, local only) | home, list, detail, create, op-modal all render. |

### Findings (iteration 1)

- **H-01 (high) State machine side door, and the advisory misses it.** `with crudish` exposes `status`,
  `assignee`, `resolvedAt` on both create and update. `POST /tickets` with `"status":"Closed"` → 201;
  `POST /tickets/{id}/update {"status":"New"}` on an Open ticket → 204 — every `when` gate bypassed.
  The docs know this (auth.md "Guarded state transitions": mark it `immutable`), and
  `loom.update-gate-suggestion` exists — but it fires only when a **`requires`**-gated op writes the field.
  A **`when`**-gated op (the canonical state-machine shape, no auth involved) gets no hint. `parse` stayed silent.
- **H-02 (high) Generic update is full-replace and silently nulls omitted optionals.** `update` body omitting
  `assignee` (optional) set `assignee` to `null` and `resolvedAt` to null, 204. No `If-Match`/version
  required either (version went 4→5 with no precondition). A client editing just the subject wipes the assignment.
- **H-03 (med) Zero-arg operations reject a bare POST.** `curl -X POST …/close` → **415**
  "Content-Type must be application/json"; with JSON content-type and empty body → **400 "Malformed JSON"**.
  Only `-d '{}'` works. Every hand-written client / webhook hits this first.
- **H-04 (high, DX) The recommended list-read path is a dead end.** The `ddd new` starter's own comment says
  list `find`s are deprecated and to use `criterion` + `retrieval`. A retrieval emits a repo method
  (`runOpenQueue`) but **no route, no client hook, no page** (criterion.md admits this in a scope note).
  My `OpenQueue` and the starter's `TasksInProject` are dead code; nothing warns that a retrieval is unreachable.
- **H-05 (med) No way to server-default creation facts.** `openedAt` must be sent by the client (required in
  `CreateTicketRequest`; the UI shows a date-time picker for "Opened At"), `status` is a client choice on the
  create form. `create` bodies on state aggregates are inert (`loom.lifecycle-body-dropped`), so the
  natural `openedAt := now()` has no home. (Tested `managed = now()` in iteration 2.)
- **H-06 (low) UI vs API surface disagree on create.** UI create form omits optional fields (`assignee`,
  `resolvedAt`) while the API accepts them — fine, but it means the API is the wider (and unguarded) door.
- **H-07 (low) Long text has no multiline hint.** `description: string` renders as a single-line input; there
  is no `text`/`multiline` type or hint I could find in the docs.
- **H-08 (low) Detail page doesn't show derived fields** (`commentCount`, `display`) and shows `Version`.
  (Version column/row already claimed by draft PR #3119; reference labels by #3113; `when`-disable by #3112.)
- **H-09 (info) Update route is `POST /{id}/update`**, not `PUT`/`PATCH` — surprising for REST clients, undocumented in the README.
- Positive: field-pointed 422s with my own `message` text, `can_<op>` endpoints, structured logs, FK → 422,
  and the CA-bundle `certs/` hook all worked as documented.

---

## Iteration 2 — pilot feedback round 1 (`v2/main.ddd`, ~230 lines)

Simulated feedback from the support-team pilot:
"anyone can close a ticket from the edit form" · "customers must see only their own tickets" ·
"internal notes must be hidden from customers" · "comment author is free text" ·
"agents need *My queue* / *Unassigned*, by priority" · "SLA due date by priority, flag overdue" ·
"tell the customer when it's resolved".

What I did: `user {}` + `auth { oidc }` (denyByDefault), a `permissions` block, two named policies,
`status`/`requester`/`assignee` `immutable`, `openedAt managed = now()`, a `workflow openTicket` that stamps
`requester := currentUser.customerId`, `find mine/myQueue/unassigned` with `currentUser` filters, a derived
`dueAt`/`overdue`, `emit TicketResolved`, a custom `MyQueue` page. Ran it against the generated Keycloak with
four personas (admin, agent, two customers) created through the KC admin API.

| step | result |
|---|---|
| parse attempts to green | 6 (two raw parser errors, one actionable binding error, one batch of 4 UI-gate errors) |
| `generate` | 116 files, "0 error(s)" |
| `docker compose up --build` | **web image failed `tsc`** (H-15) — fixed by switching the list gate to `paged` |
| OIDC end to end | password-grant token from the seeded Keycloak verified by the API; `requires` gates 403 correctly for the declared cases |
| `managed = now()` | works (`openedAt: new Date()` in the factory) — closes H-05 for timestamps |

### Findings (iteration 2)

- **H-10 (critical, security) An absent optional claim passes a `!= null` gate (node OIDC).**
  `toUser()` maps `customerId: claim(payload,"customerId") as Ids.CustomerId | null` — `claim()` returns
  `undefined` for a missing claim, and `currentUser.agentId != null` lowers to `!== null`. So
  `undefined !== null` → gate passes. Repro: customer Ada (token has no `agentId`) → `POST /tickets/{id}/take_it`
  → **204**, ticket moved New→Open; `GET …/can_take_it` → `{allowed:true}`. Same root cause turned an agent's
  `open_ticket` (gate `currentUser.customerId != null`) into a **500** NOT-NULL insert instead of a 403.
  Fix: coalesce to `null` in `toUser` (`?? null`), and/or lower `!= null` on claims to loose `!= null`.
  Also: id-typed claims are not validated as UUIDs (the seeded demo user carries `"demo-customer-id"`).
- **H-11 (high) `crudish(requires: P)` leaves the list read open.** Customer Ada opens `/customers` in the UI
  and sees every customer's name + email. The gate covers create/update/destroy, but the auto `find all`
  is out of default-deny scope (documented) and there is **no warning** that a `crudish(requires:)`
  aggregate still lists to everyone. (By-id leak is the known M-T3.19 / draft #3109.)
- **H-12 (high) Named policies are unusable on `find all`.** `find all(): T paged requires IsAgent()` is valid
  for the backend, but scaffold copies the gate onto the *synthesized* List page, where a policy call is
  not client-evaluable → `loom.ui-gate-expr-unsupported` + `loom.page-gate-not-client-evaluable` **both**
  fire for the same gate, on a page I never wrote. The fix it suggests ("rewrite over claims") means
  inlining the policy body — exactly what named policies exist to avoid. Inline policy bodies at the
  page gate (they are `currentUser`-only by definition), or skip the client mirror for non-evaluable gates.
- **H-13 (med) Page gates reject `null`.** `requires currentUser.agentId != null` on a page → error. Optional
  id claims (`customerId?`, `agentId?`) are the natural role discriminators; I fell back to a `role` string.
- **H-14 (med) Two raw parser errors for documented-adjacent shapes.**
  `with crudish(requires: currentUser.permissions.contains(…))` → `Expecting token of type ')' but found '.'`
  (it takes a policy *name* only); `contains notes: Note[] mask unless …` → `Expecting token of type ':' but found 'unless'`.
  Neither says what is allowed instead.
- **H-15 (high, silent compile-breaker) A declared `find all(): T[]` breaks other aggregates' id pickers.**
  Declaring `find all(): Ticket[] requires …` (the form auth.md documents for gating the list) makes
  `useAllTickets()` return an array, but the `InternalNote` create form's Ticket `<Select>` still reads
  `.data?.items` → `TS2339`. `ddd generate` said 0 errors; `docker compose up` failed in the web image.
  Workaround: declare it `paged`. Repro: `repro/find-all-array-picker.ddd`.
- **H-16 (high) Workflow creates return 204 with no body.** `POST /workflows/open_ticket` → 204; the client cannot
  learn the new ticket's id. The UI's WorkflowForm then navigates to `/workflows` — the customer never sees
  the ticket they just opened.
- **H-17 (high) No way to hide a containment from some callers.** `mask unless` is rejected on `contains`;
  there is also no per-row filter on a contained collection. Internal notes had to become a separate
  aggregate (`InternalNote`) — which is then readable by any customer through the ungated by-id route.
- **H-18 (med) `managed` with no default and no writer is silently `""` forever.** `InternalNote.author managed`
  with an inert `create` → factory writes `author: ""`. No diagnostic that nothing ever assigns it.
  (The real need — "stamp `author := currentUser.name` at creation" — has no home: `create` bodies are inert.)
- **H-19 (med) Customers have no UI path to their own tickets.** The scaffold surfaces `find all` only; the
  `mine` find has no page / menu entry, and the Tickets list is Forbidden for a customer. The sidebar still
  shows Customers / Agents / Tickets / Internal Notes links to everyone (documented caveat C3).
- **H-20 (low) Scaffold filter bar fires a parameterised find with an empty arg on page load.**
  `/internal_notes` → `GET /internal_notes/for_ticket?t=` → 422 twice; the filter input is labelled with
  the raw param name ("T").
- **H-21 (med) Generated Keycloak realm is a demo, not a dev identity story.** One `demo` user whose
  `customerId`/`agentId` are not UUIDs and with no `permissions` claim; adding persona users through the admin
  API silently drops custom attributes until the realm's `unmanagedAttributePolicy` is enabled. Also, compose
  passes `OIDC_CLIENT_ID=helpdesk-app` although the model says `clientId: "helpdesk-web"`, and `audience:` is
  not passed as `OIDC_AUDIENCE` (the realm stamps `aud` itself, so it happens to work).
- **H-22 (low) Diagnostics leak compiler internals.** `loom.ui-gate-expr-unsupported` names
  `src/generator/_frontend/gate-expr.ts` etc. and talks about the generator "CRASHING with a raw stack
  trace" — useful to maintainers, noise to a model author.
- **H-23 (info) `.NET` portability tax.** `operation reply` next to `entity Reply` → `loom.dotnet-name-collision`
  (honest, actionable) — but the same model is fine on node/python/java, so switching backend means renaming domain verbs.
- 403 `detail` echoes the full gate expression under real OIDC (`Forbidden: currentUser.customerId == requester || …`)
  — already claimed by draft #3104.
- Positive: `requires` with `currentUser.customerId == requester` row checks work; `when` + `requires` compose;
  OIDC token verification works out of the box against the generated Keycloak; `can_<op>` respects state.

---

## Iteration 3 — feedback round 2: SaaS, teams, automation (`v3/main.ddd`, ~330 lines)

Feedback: "we now sell this to several companies; data must never mix" · "route to teams, tag tickets" ·
"tickets also arrive by email/phone" · "rename *description* to *body*" · "auto-escalate overdue tickets" ·
"email a satisfaction survey on resolve" · "dashboard: tickets per status" · "we want tests".

Added: `tenancy by user.tenantId of Organization` + `tenantOwned` everywhere, `Team`, `Tag` (+ `Tag id[]` on
Ticket), `channel` enum field with a default, a rename `migration`, backfill `migration` for the new NOT NULL
tenant columns, `timerSource` (cron) → `escalateOverdue` workflow, `TicketResolved` → `askForRating` workflow
(creates a `Survey`, sends mail via a `mailer` resource), a grouped `projection`, one unit test, one e2e test.
Generated **into a copy of v2's output tree** so migrations diff against v2, and booted on **v2's populated database**.

| step | result |
|---|---|
| parse attempts to green | 8. Two raw parser errors (unit `test` at system scope; `migration` inside `system`), one pedantic error (timer `every: 15m`), the rest good, actionable diagnostics |
| first `generate` | refused: **4 destructive changes** (NOT NULL `tenant_id` on populated tables) with the exact fix — excellent |
| migration SQL | rename column, add-nullable → backfill → `SET NOT NULL`, enum `CHECK … NOT VALID`, tenant indexes, join table for `Tag id[]` — **applied cleanly on live v2 data** |
| tenant isolation | second tenant (`globex`) sees empty lists, 404 on a pilot ticket by id, empty projection — works |
| reactor chain | broken out of the box (H-27); after a compose override: Survey created, mail delivered to the Mailpit sidecar, rating rules (422 / 409 / 403) all correct |
| generated unit test | passes (`vitest`, 1 test) |
| generated e2e test | **wiped the dev database** (H-30) then failed |

### Findings (iteration 3)

- **H-30 (critical, security) Unauthenticated full-database wipe.** `POST /__loom/test-reset` truncates every
  table of every tenant (`TRUNCATE … CASCADE`), is in the auth bypass list, and is registered whenever
  `NODE_ENV !== "production"` — plus the generated `docker-compose.yml` forces `LOOM_TEST_RESET: "1"` and publishes
  the api on `0.0.0.0:3000`. Running the generated e2e suite against my dev stack silently erased all customers,
  tickets and agents (it resets by default, `E2E_RESET=per-file`). Anyone on the network can do the same with one
  `curl`. It should at minimum be opt-in (never default-on in compose), require a secret header, and never be the
  e2e default against a stack holding data. (Seam introduced by #2967.)
- **H-27 (high) Mailer host mismatch — the mail reactor 500s out of the box.** `api/resources/smtp.ts` defaults to
  `smtp://mail:1025` (the **resource** name) while compose names the Mailpit service `smtp` (the **storage** name)
  and sets no `MAIL_URL`. `getaddrinfo ENOTFOUND mail`.
- **H-28 (high) A failing reactor fails the originating command *after* it committed, and the side effect is lost.**
  `resolve` committed (`status = Resolved`) but returned **500** because the in-process `TicketResolved` reactor
  threw; the client's retry then gets 409. The Survey was never created and there is no outbox/retry for the
  in-process dispatcher, so the customer is never asked. Either run reactors after the response / with retry, or
  roll back the command.
- **H-29 (high) Generated node API does not typecheck, and nothing tells you.** `tsc --noEmit` on the v3 api: 4
  errors — `find mine(): … where requester == currentUser.customerId` passes a `CustomerId | null` to Drizzle `eq`
  (3×, already present in v2), and **`currentUser` is unbound** in the timer-driven `escalateOverdue` handler
  (`http/workflows.ts:237`) because `escalate()` has a `requires`. The Dockerfile builds with `tsup` only, so the
  image builds and the bug ships as a runtime `ReferenceError` (typecheck-in-Dockerfile is draft #3085; the principal
  for reactors/timers is draft #3103). The validator should reject calling a `requires`-gated op from a
  principal-less trigger until #3103 lands.
- **H-24 (high, silent compile-breaker) `X id?` claim into a non-optional field passes validation.**
  `Ticket.create({ requester: currentUser.customerId })` (claim `customerId: Customer id?`) — the documented null
  rules say a `T?` is not usable where `T` is required, but `loom.construction-field-type` doesn't fire. node and
  python build; **.NET fails `CS1503`** (see portability check below). `requires x != null` does not narrow (by design),
  so there is no way to write this correctly in a workflow except a ternary with a dummy id.
- **H-31 (med) Adding one criterion flips 5 deprecation warnings on, pointing at a dead end.** The interim rule
  "warn on list `find`s only in a context that declares a criterion" means the moment I added one criterion for an
  internal workflow, every list `find` my UI depends on warned `loom.repository-find-deprecated` — recommending
  `retrieval`, which still has no route (H-04).
- **H-32 (med) Two more raw parser errors at placement mistakes.** A unit `test "…" for Ticket` at system scope →
  `Expecting token of type 'e2e'`; a `migration` block inside `system` → `Expecting token of type '}' but found
  'migration'`. (Draft #3115 "a declaration in the wrong scope says where it belongs" looks like the fix.)
- **H-33 (low) `timerSource { every: 15m }` is a hard error** because it is "cron-expressible". It is a perfectly
  clear spelling; a suggestion would do.
- **H-34 (med) e2e tests: no workflow verb in the docs, one principal per run.** The language.md verb table has no
  workflow row (`api.<workflow>.run(…)` is only discoverable from the diagnostic). The suite runs as a single
  `E2E_BEARER_TOKEN`, so "customer can't see another customer's ticket" is not expressible (multi-principal is
  draft #2976).
- **H-35 (med) Timer events need an invented correlation aggregate.** The tick event must carry an `X id` for
  `create(t) by t.run`, so I declared `aggregate EscalationRun` that nothing ever creates — which earns its own
  "no code path can create" suggestion and a sidebar entry + CRUD pages in the UI.
- **H-36 (med) Tenancy claim vs registry are not connected.** The tenant claim is a free string (`"pilot"`), the
  registry `Organization` has UUID ids; nothing checks a claim names a real org, `GET /organizations` as a tenant
  admin is empty, and backfilling `tenantId = "pilot"` is accepted without a matching registry row.
- **H-37 (low) UI gaps on the evolved model.** `tags: Tag id[]` is not displayed on the detail page and has no
  remove op; derived `dueAt`/`overdue` are not shown; the sidebar is a flat list of 9 aggregates (incl. the internal
  `EscalationRun`) — it reads as an admin console, not a helpdesk; the floating "Sign out" overlaps the action row.
- **H-38 (low) Dev identities are wiped on every model change.** Keycloak runs `start-dev` with no volume and
  re-imports the realm, so personas created by hand disappear whenever the realm file changes.
- Positive: the destructive-migration gate and the generated migration SQL are the best part of the toolchain; the
  `unique (label)` on a tenant-owned aggregate warning ("did you mean `unique (tenantId, label)`?") is exactly the
  kind of help a developer needs; tenant isolation held under every probe I tried; the reactor + mailer + survey
  chain worked once the host was fixed.

### Timer result (16:30 UTC tick)

`pgboss.job` → `timer_escalation | failed | Error: currentUser is not available — ensure authMiddleware ran for this
route. at requireCurrentUser … at TicketRepository.runFindAllByOverdueCandidates`. The **tenant filter** fails before
the unbound `currentUser` from H-29 is even reached, so overdue tickets are never escalated, and the api's own log
says nothing (the failure is visible only in the pg-boss table). That makes tenancy and timers incompatible today.
Tenant-scoped system principals are draft #3103; the silent failure is new.

### Portability check (same v2 model, other backends)

`v2/main.ddd` with `platform: node` swapped out (a one-line `sed`, not committed), api image built with `docker build`:

| backend | result |
|---|---|
| python | builds |
| dotnet | first `loom.dotnet-name-collision` (H-23, renamed `reply` → `addReply`), then **CS1503** in `OpenTicketHandler.cs` (H-24) |
| java | `gradle bootJar` failed resolving plugins from the Gradle Central Plugin Repository inside the build container. Probably the sandbox TLS proxy (JVM truststore), **not verified** as a Loom defect |

### Environment note

Late in the session I accidentally replaced `/dev/null` in the container with a symlink (a stray `ln -sfn`).
Restoring it needs `mknod`, which the session's permission policy refused. After that, no new containers could start
and local `git` refused to run, so the files from this point on were pushed through the GitHub API, and the
Playwright screenshots (binary) are not in the PR.
