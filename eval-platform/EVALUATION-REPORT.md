# Loom — platform evaluation for a new project

**Date:** 2026-09-22 · **Repo state:** `86628b3f` (`Loom-Harness/loc`, fresh `main`)
**Brief:** evaluate Loom as the platform for a new project, going through a real dev
cycle, with particular attention to its claims about **technologies, multiple stacks,
and switching between them**.
**Method:** everything below was executed in this session. No claim is repeated from a
doc without running it. Defect detail, repros and mutation proofs are in
[`FINDINGS.md`](FINDINGS.md).

---

## 1. Recommendation

**Adopt for a new project — with two conditions and one hard exclusion.**

Loom is substantially stronger than a code generator. In one session I modelled a
multi-tenant, OIDC-authenticated order-management system in ~130 lines, generated a
7-service stack across **five backends and six frontends from one source file**, and
had a real HTTP API serving production-grade traffic — RFC 7807 errors, ETag/If-Match
optimistic concurrency, Prometheus metrics, self-applying migrations — against real
Postgres 18. Its own test suite is **25,920 tests, all green**.

The stack-switching claim is the strongest part of the product and it largely holds:
**the frontend tree is byte-identical across all five backend choices, and the backend
tree is byte-identical across all six frontend choices.** That decoupling is real,
verified, and rare.

### Conditions

1. **Pick your backend before you write the model, and compile on it in CI from day
   one.** Stack switching is excellent *structurally* and unreliable *semantically*: the
   same model compiles on some backends and not others, and on Elixir a business rule can
   vanish silently (F-1). The value proposition "swap the platform line" is true for the
   wiring, not yet for arbitrary domain logic.
2. **Treat `ddd generate` as a step that does not verify its own output.** Generation
   reporting `0 error(s)` does not mean the emitted project compiles. Every defect I
   found in this class was invisible until the target toolchain ran. Your pipeline must
   run `tsc`/`dotnet build`/`gradle`/`mypy`/`mix compile` on the generated tree.

### Hard exclusion

**Do not use Elixir as the backend for anything with enforceable business rules**
until F-1 is closed — it is the one target that silently drops a declared invariant
and compiles green.

### What would move this to unreserved "Adopt"

F-1 closed (member existence validated in the compiler, and no backend allowed to drop
an invariant silently); F-3 closed (the migration rename heuristic must not reclassify
drop+add and bypass the destructive gate); and a tagged release with a changelog —
`package.json` still reads `0.1.0` and there are no releases.

---

## 2. What I actually ran

| Leg | Result |
|---|---|
| Repo's own fast suite (`npm test`) | **2184 files, 25,920 tests passed, 0 failed**, 6 expected-fail, 13m |
| `ddd new` → parse → generate → compile → boot → HTTP | Completed end to end |
| Generation matrix, 5 backends × 6 frontends | **30/30 generate clean** |
| Backend compiles, scaffold model | node ✅ · python ✅ · java ✅ · **dotnet ❌ (F-2)** |
| Backend compiles, feature-rich model | elixir ✅ · node/python/java/dotnet ❌ (all F-1) |
| Frontend builds | react ✅ · vue ✅ · svelte ✅ · **feliz ✅** · shadcn-pack react ✅ · angular/flutter see §6 |
| Runtime | Generated Hono API booted on real Postgres 18, self-migrated, 12 HTTP behaviours verified |
| Runtime, full stack | Built React SPA served + proxied to the live API: create → FK-valid write → read-back ✅ |
| Tenancy isolation e2e (repo harness) | ✅ passed |
| Determinism | Two runs byte-identical |

---

## 3. Feature-by-feature

### 3.1 Language and modelling — **strong**

Writing a realistic 130-line domain (tenancy, OIDC, permissions, policies, enums, value
objects with regex invariants, derived fields, operations with preconditions, events,
criteria/retrievals, an aggregating projection) took **7 iterations**, each resolved by
one precise diagnostic. Learnability is good. Two syntax facts cost me time and are
worth knowing up front: boolean operators are `||`/`&&` (`or` is reserved for type
unions, and using it produces a confusing `Expecting token of type ':'`), and operation
preconditions are `precondition <expr>`, not a guard clause.

### 3.2 Diagnostics — **the standout feature**

Genuinely better than most commercial compilers. Representative, all real, all
correctly located, each naming the fix:

- `loom.tenant-owned-claim-type` — caught that my claim was `guid` while `tenantOwned`
  provides `tenantId: string`, and said it "mis-compiles typed backends". This is a
  silent-codegen bug caught *at validation time*.
- `loom.tenant-registry-not-constructible` — caught that my tenant registry had no
  create path, so the first tenant could never exist (a chicken-and-egg I had not seen).
- `loom.current-user-needs-auth-ui` — named exactly how it breaks *per frontend*
  ("react `undefined.<claim>`, invalid Dart on flutter, an unbound match on feliz").
- Design-pack mismatch errors list the valid packs for that framework.

The gap: this quality stops at the boundary of member-existence checking (F-1).

### 3.3 Stack switching — **structurally excellent, semantically incomplete**

The headline claim, tested directly.

**What holds:**
- All 30 backend × frontend combinations generate cleanly.
- `web_app/` is **byte-identical** across `node|dotnet|java|python|elixir`.
- `api/` is **byte-identical** across `react|vue|svelte|angular|feliz|flutter`.
- `.loom/wire-spec.json` is **byte-identical across all five backends** (same SHA-256).
- Migration DDL across node/java/python differs only in driver-specific statement
  separators — the schema is genuinely derived once from the shared `MigrationsIR`.
- Design-pack swap is a one-word change that correctly swaps the whole UI dependency
  stack (Mantine → Radix/Tailwind → MUI → Chakra), and the swapped result still builds.

**What does not hold:**
- Switching the frontend is **not** a one-line change: `design:` is coupled to the
  framework, so `platform: react` → `vue` also requires `design: mantine` → `vuetify`.
  The diagnostic is excellent, so this is friction, not a trap — except on Flutter,
  where `design:` accepts anything and silently does nothing (F-4).
- Domain-logic parity is not guaranteed. One ordinary line behaves five different ways
  (F-1), and the dangerous case is Elixir compiling green with the rule removed.

### 3.4 Generated code quality — **high**

Not template sludge. The emitted aggregate is an encapsulated class with private state,
getters, optimistic-concurrency `version`, and a separate `_rehydrate` that skips
invariants with a comment explaining *why* ("invariants guard transitions, not loads").
The HTTP layer emits OpenAPI 3.1 with `operationId`s, declares 403/415/422 in the
contract, and returns `application/problem+json`. Schema emits FKs with
`ON DELETE RESTRICT` **and an index on the FK column**. Python passes `mypy --strict`.

### 3.5 Runtime behaviour — **production-grade**

Against real Postgres 18, verified by hand:

| Behaviour | Result |
|---|---|
| Self-applying migrations on boot | ✅ (drizzle migrator, journalled) |
| Create → UUIDv7 id | ✅ |
| `ETag: "1"` = aggregate version | ✅ |
| Derived field computed in list payload | ✅ (`display`) |
| Invariant violation | ✅ 422 `problem+json` with JSON-pointer `errors[]` — frontend-bindable |
| Optimistic concurrency | ✅ ETag 1 → 204 → ETag 2 → stale If-Match → **409** |
| FK violation | ✅ 422, clean message, **no SQL leakage** |
| Unknown id | ✅ 404 |
| Wrong content-type | ✅ 415 |
| Prometheus `/metrics` | ✅ per-route/status counters |
| Correlation + request ids | ✅ on every response |

One design fact to know: the API is **command-oriented, not REST**. Updates are
`POST /api/<plural>/{id}/update`; `PUT` returns 405.

The loop closes at the UI too: serving the built React bundle and pointing its proxy at
the running API, a `POST /api/tasks` carrying a real `Project` foreign key round-trips
through the SPA's own API path and reads back correctly — the generated frontend and
backend agree on the wire without any hand-wiring.

### 3.6 Auth, authorization, tenancy — **strong, with one documented hole**

`enforcement: denyByDefault` genuinely refuses to build until every reachable command
and declared read carries a `requires` gate. Gates emit correctly (403 in the OpenAPI
contract, checked before the operation, RFC 7807 body). `crudish(requires: <Policy>)`
works — despite the starter template claiming it hasn't landed (F-5).

Tenancy is enforced **in SQL on every read path** — `getById`, `findManyByIds`,
`findAll` and the criterion retrieval all `AND` in
`eq(schema.orders.tenantId, requireCurrentUser().org)`. Not post-fetch filtering. The
repo's tenancy isolation e2e passes.

The known hole is disclosed rather than hidden: the synthesised by-id read has no
surface to attach a gate to, so under `denyByDefault` it serves to any authenticated
caller. The compiler **warns about each one** (`loom.default-deny-by-id-ungated`), names
the mission tracking it, and states precisely what tenancy does and does not cover. That
is the right way to ship a known gap.

### 3.7 Migrations — **good engine, one unsafe heuristic**

Field rename emits `ALTER TABLE ... RENAME COLUMN` (data-preserving). A pure drop is
correctly refused with an excellent message naming the destructive change, the
`--allow-destructive` escape, and the backfill alternative. But drop+add of an unrelated
same-typed field is silently reclassified as a rename, so data lands in the wrong
column with no flag and no warning (F-3). The gate is good; the heuristic routes
around it.

### 3.8 Tooling and artifacts — **broad**

`--dry-run` gives an accurate write/skip/unchanged plan. Generation is byte-deterministic.
The `.loom/` bundle is genuinely useful: C4 model, four mermaid views, AsyncAPI,
`wire-spec.json` for contract diffing, migration history, i18n catalog, provenance
snapshots. `--sourcemap` + `ddd breakpoints` resolves the correct generated *files* but
mostly reports line `:1` (F-6) — useful for navigation, not yet for breakpoints.

### 3.9 Project maturity — **the main non-technical risk**

`package.json` is `0.1.0`; there are no releases, no tags, no changelog, no stated
compatibility policy. Against that: the test suite is large and green, CI gating is
unusually sophisticated (a merge queue, an event-driven `pr-gate` aggregate check,
mutation-proof requirements written into the contributor rules), and the codebase
comments explain *why* decisions were made to a degree I rarely see. The engineering
discipline is real; the release engineering does not exist yet.

---

## 4. Defect summary

| # | Sev | Finding |
|---|---|---|
| F-1 | S2/S1 | Undefined member access on a scalar field passes validation and reaches codegen. `money.amount` fails to compile on node/python/java/dotnet and is **silently dropped on Elixir**. |
| F-2 | S2 | The shipped `ddd new --template crud` starter **does not compile on .NET** — the aggregate named `Task` collides with `System.Threading.Tasks.Task` (17 errors). Mutation-proved. |
| F-3 | S1 | Migration rename heuristic reclassifies drop+add as a rename, bypassing the destructive gate and moving data into the wrong column. |
| F-4 | S3 | `design:` on a Flutter deployable accepts any value and is a silent no-op. |
| F-5 | S3 | The starter template documents `crudish(requires:)` as unavailable; it shipped. |
| F-6 | S3 | `ddd breakpoints` resolves files but mostly reports line `:1`. |

---

## 5. What I would do on day one

1. Choose the backend now. On this evidence **node, python or java**; .NET is fine once
   you avoid `Task` as an aggregate name; **not Elixir** until F-1 closes.
2. Wire the target toolchain's compiler into CI against the generated tree. This single
   step converts every S2 defect in this report into a build failure you see immediately.
3. Turn on `enforcement: denyByDefault` from the first commit — it is opt-in, and it is
   the feature that makes the authorization story trustworthy.
4. Treat migration diffs as reviewable artifacts. Read the emitted SQL on any change
   that removes a field; do not trust the rename inference (F-3).
5. Keep the `.ddd` as the source of truth and the generated tree as build output. The
   customization story exists, but nothing I saw makes hand-edits safe by default.

---

## 6. Coverage limits of this evaluation

Recorded so the scorecard is not over-read. These are **environment constraints, not
Loom defects**:

- **Feliz did build** once the sandbox proxy CA was injected into its build container:
  F# → Fable → a 303 KB vite bundle, exit 0. Its Dockerfile pins
  `mcr.microsoft.com/dotnet/sdk:8.0` while the .NET *backend* targets `net10.0` — two
  .NET majors in one generated tree, worth tidying.
- **Angular was not completed** here: it requires Node ≥ 22.22.3 (host has 22.22.2;
  Loom's own Dockerfile correctly pins `node:24`), and its in-container `npm install`
  exceeded the time I had. **Flutter was not built** — no Flutter SDK available.
- Every container build in this sandbox needs the TLS-intercepting proxy's CA installed
  (NuGet, hex.pm, nodesource, npm all fail without it). None of these are Loom defects.
- The full `docker compose up` stack never finished building here: `npm install` inside
  the build container cannot reach the host-local proxy without `--network=host`. I
  verified runtime by booting the generated API directly against a Postgres container
  instead, which exercised the same code.
- Backends were compiled, not booted, except node. Cross-backend *runtime* wire
  equivalence is therefore asserted from the identical `wire-spec.json` and the repo's
  own wire-golden differential, not re-measured here.
