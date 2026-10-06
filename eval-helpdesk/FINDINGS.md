# Helpdesk evaluation — consolidated findings

Three iterations of a helpdesk/ticketing system (`v1/` → `v2/` → `v3/`), each booted with `docker compose` and driven
over HTTP and in a browser, with real OIDC tokens from the generated Keycloak. Working notes in `EVAL-LOG.md`;
minimal repros in `repro/`; screenshots in `evidence/`. Overlap with in-flight work checked against all 63 open PRs on 2026-10-04.

**Status key:** `new` = nobody has claimed it · `#NNNN` = an open PR already covers it (don't duplicate) ·
`partial #NNNN` = an open PR covers part of it.

## Critical / security

| id | finding | status |
|---|---|---|
| H-30 | Unauthenticated `POST /__loom/test-reset` truncates every table across all tenants; it's on by default whenever `NODE_ENV != production`, forced on by the generated compose, and the generated e2e suite calls it by default. Running the e2e suite wiped my dev DB. | **new** |
| H-10 | node OIDC: a claim missing from the token is `undefined`, but `!= null` lowers to `!== null`, so `requires currentUser.agentId != null` **passes** for a customer (repro: customer took a ticket, 204). Id claims also aren't checked to be UUIDs. | **new** |
| H-01 | `when`-gated state machine bypassed through `crudish` create/update (`status: Closed` on create → 201). `loom.update-gate-suggestion` only covers fields written by `requires`-gated ops, not `when`-gated ones. | **new** |
| H-11 | `crudish(requires: P)` gates writes only. The auto list stays open, so a customer lists every customer's email. | partial #3109 (auto list becomes an error under denyByDefault) |
| — | Ungated synthesized by-id read (customer reads another customer's ticket / internal notes) | #3109 |
| — | 403 `detail` echoes the gate expression under real OIDC | #3104 |

## Silent compile-breakers (validate says `0 error(s)`, generated code doesn't build)

| id | finding | status |
|---|---|---|
| H-15 | A declared `find all(): T[]` breaks other aggregates' id pickers (`.data?.items` on an array). `repro/find-all-array-picker.ddd` | #2942 (F-015) |
| H-24 | An `X id?` claim assigned into a non-optional field validates. .NET fails CS1503 (node/python build). `requires x != null` doesn't narrow. | **new** |
| H-29 | **Timer-driven escalation never runs.** At the 16:30 tick, pg-boss marked the job `failed` with `currentUser is not available`, because the tenant filter on the criterion read calls `requireCurrentUser()` and there's no principal. The failure only appears in `pgboss.job` (nothing in the api logs), and the job is retried 3× and then dropped. Separately, the node API fails `tsc` (nullable claim into Drizzle `eq` ×3; `currentUser` unbound in a timer-driven handler). The image builds anyway because the Dockerfile only runs tsup. | partial #3085 (typecheck in Dockerfile), #3103 (system principal for reactors/timers); the `find … where col == currentUser.<optional>` typing and the silent pg-boss failure are **new** |

## Runtime / wiring bugs

| id | finding | status |
|---|---|---|
| H-27 | The mailer resolves to `smtp://mail:1025` (resource name), but compose names the service `smtp` (storage name) and sets no `MAIL_URL`, so every send fails with ENOTFOUND | **new** |
| H-28 | When a reactor throws, the command it came from returns 500 even though it already committed. The side effect (Survey + email) is lost with no retry. | partial #3131 (outbox origin), otherwise **new** |
| H-16 | Workflow `create` returns 204 with no body, so the client can't learn the new aggregate's id and the UI navigates to `/workflows` | **new** |
| H-02 | Generic `update` replaces the whole record: omitting an optional field silently nulls it, and no `If-Match` is required | **new** (If-Match for Feliz/Flutter only: #3090) |
| H-03 | Zero-arg operations reject a bare POST (415), and JSON content-type with an empty body gives 400. Only `-d '{}'` works. | **new** |
| H-18 | A `managed` field with no default and no writer is silently `""` forever | **new** |
| H-20 | The scaffold filter bar fires a parameterized find with an empty arg on load (422 ×2) and labels the input with the raw param name | **new** |
| H-21 | The generated Keycloak realm has one demo user with non-UUID id claims and no `permissions`. Custom attributes are dropped until `unmanagedAttributePolicy` is enabled. Compose overrides the model's `clientId`. | partial #3104 (demo tenant row) |

## Expressiveness gaps (the model can't say what the product needs)

| id | finding | status |
|---|---|---|
| H-04 / H-31 | `retrieval` (what the compiler recommends) has no route, hook or page. The deprecation warning flips on for every list `find` once a context has a single criterion. The `ddd new` starter itself ships a dead retrieval. | **new** (criterion.md calls it interim) |
| H-05 / H-18 | Nowhere to stamp creation facts from the principal (`author := currentUser.name`) because `create` bodies are inert. `managed = now()` covers timestamps only. | known: M-T3.16 |
| H-17 | Can't hide a contained collection (or some of its rows) from some callers: `mask unless` isn't allowed on `contains` and there's no row filter. Internal notes had to become their own aggregate. | **new** |
| H-12 / H-13 | Named policies can't be used on `find all` because scaffold copies the gate onto the synthesized List page, where a policy call isn't client-evaluable (two diagnostics for one cause). Page gates reject `null`, so optional id claims can't be role discriminators. | **new** |
| H-35 | A timer tick needs an invented correlation aggregate, which then gets nav and CRUD pages | **new** |
| H-36 | Tenant claim (free string) and registry (UUID ids) aren't connected or validated | partial #3104 |
| H-07 | No multiline / long-text hint for a `string` field in scaffolded forms | **new** |
| H-34 | e2e has no documented workflow verb and runs as a single principal | partial #2976 |

## DX / diagnostics

| id | finding | status |
|---|---|---|
| H-14 / H-32 | Raw Chevrotain errors for: `crudish(requires: <expr>)`, `mask unless` on `contains`, unit `test` at system scope, `migration` inside `system` | partial #3115 (wrong-scope placement) |
| H-22 | Diagnostics talk about compiler internals (`src/generator/_frontend/gate-expr.ts`, "CRASHES … raw stack trace") | **new** |
| H-33 | `timerSource { every: 15m }` is a hard error just because the interval is cron-expressible | **new** |
| H-23 | .NET name collision (`operation reply` + `entity Reply`): honest error, but it's a portability tax | info |
| H-19 / H-37 | Scaffolded UI is an admin console: no "my tickets" for customers, a flat nav with internal aggregates, `X id[]` and derived fields not shown, the floating Sign-out overlaps buttons, and `Child` pluralizes to `/childs` | partial #3112/#3113/#3119 (when-disable, ref labels, version column) |
| H-38 | Keycloak dev identities are lost whenever the realm changes (no volume) | **new** |

## What worked well (for balance)

- Learnable: v1 (107 lines) parsed on the first try. Most diagnostics name the fix, and some are excellent (the tenant-scoped `unique` hint, the `ui: Web { Desk: api }` binding hint, the e2e verb listing).
- **Migrations are the standout:** the destructive-change gate refused NOT NULL tenant columns on populated tables and named the fix. The generated SQL (rename, add-nullable → backfill → SET NOT NULL, enum `CHECK … NOT VALID`) applied cleanly to live v2 data.
- Tenant isolation held under every probe: lists, by-id, projections, and a second tenant.
- `when` → 409 + `can_<op>`, `precondition` → field-pointed 422 with my own message, `requires` → 403, RFC 7807 everywhere, structured logs with trace ids.
- OIDC works end to end against the generated Keycloak. The CA-bundle `certs/` hook handled the TLS-intercepting proxy.
- From model to running 3–5 service stack in about 70–85 s per iteration (Loom's own share: about 3 s).
