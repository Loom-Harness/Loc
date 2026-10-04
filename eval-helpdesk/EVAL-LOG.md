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
| UI (Playwright screenshots `evidence/v1-*.png`) | home, list, detail, create, op-modal all render. |

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
