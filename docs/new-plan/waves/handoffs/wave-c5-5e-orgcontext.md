# Wave C5 · moment 5e (M-T3.6 items 3+5) — `organizationContext` + its fail-closed switch gate — hand-off

*Branch: `claude/c5-orgcontext`. Base: `f7a9866e2` (the C5 coordinator head =
`main` @ `d16aed8f2` + the 5a and 5c folds + the wave log; the merge was a
fast-forward). Commit range `f7a9866e2..HEAD`. Never pushed; the wave PR is the
claim. **The wave PR needs the `run-tenancy` label** — the runtime proof is five
new `tenancy-e2e` cells, and that workflow only runs on a PR under the label (it
also runs in the merge queue).*

**Outcome: all-or-nothing, and it is ALL.** The accessor, the validator gates,
the per-backend runtime gate on all five backends and the five-backend parity
leg landed together (the accessor and every backend's gate share ONE commit,
`1d63a4537`). All five parity legs are green on a booted app; the leg is
mutation-proved on three backends.

| # | row | outcome |
|---|---|---|
| — | **the accessor** | **done.** `organizationContext.orgPath` — ambient, a peer of `currentUser`, ONE member. Lowered in `lowerPostfixChain` (`src/ir/lower/lower-expr.ts:446`) to the derived principal member `currentUser.orgContextPath` (`PRINCIPAL_ORG_CONTEXT_PATH`, `src/util/principal.ts`), so it rides every backend's existing principal threading (`current-user` ref → auth params, ambient accessors, `usesUser` detection) — no second plumbing. Registered as a magic name (`src/language/validators/names.ts`), typed against the principal record (`src/language/type-system.ts`). No grammar change (it parses as an ordinary `NameRef` postfix chain), so no langium regeneration and no printer arm |
| a | **validator-enforced gate** | **done.** `loom.org-context-surface` (AST, `src/language/validators/tenancy.ts:132`): `#member` — bare / any member but `orgPath` / a call; `#frontend` — any read inside a `ui` (page, component, layout, store). `loom.org-context-gate-unmet` (phase ⑦, `src/ir/validate/checks/tenancy-checks.ts:441`): `#no-hierarchy` — no `tenancy by … of <Registry>` whose registry `implements tenantRegistry`; `#no-auth` — a backend deployable hosting a reading context without `auth: required` + `user {}`. Catalog text `src/diagnostics/messages.ts:1474,1478,3857,3863`; anchors in `src/diagnostics/code-docs.ts` → `02-systems-and-topology.md#organizationcontext--the-operating-scope`; firing-census fixtures in `test/system/diagnostic-firing-census.test.ts` (both fire). "Reads" is DERIVED (`src/ir/util/org-context.ts` — `contextReadsOrgContext` / `systemReadsOrgContext`, riding `forEachContextExpr`, a new one-line export of the model-wide enumeration in `src/ir/util/model-exprs.ts`) — never stamped |
| b | **fail-closed runtime gate, five backends** | **done.** Each auth layer resolves the operating scope once per request, BEFORE any handler: header absent/empty ⇒ the principal's own `orgPath`; header `== orgPath` or `startsWith(orgPath + ".")` ⇒ admitted; anything else ⇒ 403 `reason: outside_scope`; any header on a principal with an empty `orgPath` ⇒ 403 `reason: no_principal_scope`. RFC 7807 body (`"title": "Forbidden"`), logged as the NEW catalog event `org_context_denied` (`src/generator/_obs/log-events.ts:220`, warn, fields `org_context`/`reason`/`status`) through each backend's catalog renderer. Sites: node `src/platform/hono/v4/auth-emit.ts:58,325,389,397` (`orgContextFor` / `orgContextForbidden`, `User.orgContextPath`); .NET `src/generator/dotnet/auth-emit.ts:63,912` (`UserMiddleware`, settable `User.OrgContextPath` defaulting to `OrgPath`); java `src/generator/java/emit/auth.ts:131,458,556` (`UserFilter` inside the request `try` so the `finally` clears it; `OrgContext` ThreadLocal holder; `User.orgContextPath()` falls back to `orgPath()`); python `src/generator/python/auth-emit.ts:64,477` (`AuthMiddleware`, `user.org_context_path` off `asdict()`/the `/auth/me` wire; `src/generator/python/index.ts` threads `systemReadsOrgContext`); elixir `src/generator/elixir/auth-emit.ts:118,279,412` (`call/2` wraps the authenticated branch in `case org_context_gate(…)`; `put_org_context/1` seeds `:org_context_path` on EVERY principal the plug builds — API, dev-stub LiveView identity, OIDC session — so a stamp never meets a missing key). Emitted only where the system reads the accessor |
| c | **five-backend parity test** | **done — green on all five.** `test/e2e/tenancy-org-context.test.ts` (one file, one `describe` per backend behind the same env var as its hierarchy sibling) + `assertOrgContextGate` (`test/e2e/support/tenancy-isolation-harness.ts:522`) over `test/fixtures/corpus/org-context.ddd`. Arms: in-scope switch stamps the sub-scope `dataKey` (read back from the table with `psql`) and the row is deep-visible from the parent and the target, hidden from a sibling and from the delimiter-trap root `org_ab`; the operating scope reaches an operation body (`note()` → `scope` read back on the wire); out-of-subtree switches (ancestor, sibling, `org_ab`, unrelated root) are 403 with `count(*) = 0` for the label; a forged header on a `tenantId: ""` token is 403 with no write; the switch refuses a READ and an operation too (request-level); switched reads equal unswitched reads (principal-anchored, (4) verified — not rebuilt); `org_context_denied` appears in the server log. Wired: five `suite: org-context` cells in `.github/workflows/tenancy-e2e.yml` + path triggers, `test:tenancy-org-context{,-python,-java,-dotnet,-elixir}` in `package.json`, the `docs/testing.md` local-run row |
| — | **corpus fixture** | **done.** `test/fixtures/corpus/org-context.ddd`, registered in `manifest.ts` for ALL five backends. Its `tenantOwned` is the reconciled surface's (write stamp on `organizationContext.orgPath`, read filter on `currentUser`) — a user-declared capability of that name replaces the prelude's. Registered as E2E-less (`test/ir/api-caller-census-pins.ts`, "runtime home is tenancy-e2e") and compile-only (`BEHAVIOURAL_ABSENT` in `test/system/gate-ledger.test.ts`) — the subject is a request HEADER the `test e2e` vocabulary cannot set. No wire golden: no wire shape is new (`orgContextPath` never reaches the wire) |
| — | **docs** | **done.** `docs/tenancy.md` → "`organizationContext` — the operating scope and its switch gate" (surface, `.ddd` + generated node output, the gate table, the per-backend seam table, the principal-anchored read rule, what a switched write is and is not visible to, both codes); `docs/language-reference/02-systems-and-topology.md` (new subsection, the anchor target), `05-expressions.md` (the magic-references table), `docs/language.md` (the `tenancy by` row) |

M-T3.6: status line updated — items (3)+(5) `done`; (2b) and (6) stay `open`
exactly as written (not built). README prose line updated; counts regenerated
(`mission-counts --write`: already up to date).

---

## Mutation proofs (file copy backup, never `git checkout --`)

| gate | mutation | failing assertion |
|---|---|---|
| parity leg, **node** | `orgContextFor` → `return requested;` | `to-ancestor: {"id":…}: expected 201 to be 403` (`tenancy-isolation-harness.ts` refusal loop) — the out-of-scope write LANDED |
| parity leg, **python** | the `if not scope or not (…)` guard → `if False and (…)` | `to-ancestor: … expected 201 to be 403` |
| parity leg, **.NET** | `if (!inScope)` → `if (false && !inScope)` | `to-ancestor: … expected 201 to be 403` |
| `loom.org-context-gate-unmet` | drop the `validateOrgContextGate` call | 7 fail: `loom.org-context-gate-unmet fires` (census) + the six gate-precondition tests in `org-context.test.ts` |
| `loom.org-context-surface` | drop the `checkOrgContextSurface` guard | 5 fail: `loom.org-context-surface fires` (census) + the four surface tests (member, unknown member, bare, `ui`) |

Every mutated file was restored from its copy and re-typechecked; zero mutation
markers left (checked by grep).

## Byte-identical emission

`scripts/capture-corpus-snapshot.mjs` on the base (a `git archive HEAD` copy,
built) vs this branch: **425 of 425 existing cells byte-identical**; the only
differences are the 5 ADDED `org-context:*` cells. The gate is emitted only when
`systemReadsOrgContext` holds, so no existing system's header is ever consulted.
**No wire golden moved** (none touched).

## Local gates (merged tree = this branch)

- `npx tsc -b` — clean. `node scripts/test-typecheck.mjs` — OK.
- `npm run lint` / `npx biome ci . --diagnostic-level=error` — 0 errors (the
  one warning, an unused `devClaimStringFields` in `elixir/auth-emit.ts:343`, is
  pre-existing).
- `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` — up to date;
  `node scripts/ledger-counts.mjs --check` — matches.
- `node docs/build.mjs` — exit 0.
- Corpus compile legs for `org-context`: `test:tsc-corpus`, `test:python-corpus`
  (mypy --strict), `test:java-corpus` (JDK 25 + Gradle 9), `test:dotnet-corpus`
  and `test:dapper-corpus` (`/warnaserror`), `test:elixir-corpus`
  (`--warnings-as-errors`, `LOOM_HEX_MIRROR=1`) — all green.
- Parity leg: `npm run test:tenancy-org-context{,-python,-java,-dotnet,-elixir}`
  — 5/5 green (java/dotnet with JDK 25 / .NET 10 extracted from the
  `gradle:9-jdk25` / `dotnet/sdk:10.0` images onto PATH; elixir on the host
  toolchain with `HEX_CACERTS_PATH=/root/.ccr/ca-bundle.crt`).
- Full `npm test` redirected to a file with the exit code appended: first run
  `NPM_TEST_EXIT=1` — three ratchets named the new fixture / module
  (`allowlist-ratchet` BEHAVIOURAL_ABSENT over its max, `wire-contract-divergence`
  novel row `org-context.ddd Books.Org → missing-in-record`, the
  module-global-state census on `org-context.ts`'s WeakMap memo); fixed in
  `e7b195f6f`.  Second run: **`NPM_TEST_EXIT=0` — 2229 files passed / 90
  skipped; 26902 tests passed, 6 expected-fail, 1248 skipped.**

## Ratchets (before → after)

`E2E_LESS_CORPUS_FIXTURES` 27 → 28 · `BEHAVIOURAL_ABSENT` 25 → 26 (its
allowlist-ratchet `max` raised 25 → 26 with a reviewed comment citing M-T3.6 /
M-T9.13) · `wire-contract-divergence` BASELINE +1 (`org-context.ddd Books.Org`,
the existing A1 `tenantRegistry` row, same as `tenancy-hierarchy`) ·
`FIRING_FIXTURES` 70 → 72 · `CODE_DOCS_ANCHORS` 285 → 287 · catalog codes
651 → 653 · corpus cells 425 → 430 · `UNDOCUMENTED_CODES` unchanged (both new
codes are anchored) · authz-gate pins unchanged (the fixture is E2E-less, like
`tenancy-hierarchy`).

## Open-PR overlaps on the fence

Read on 2026-09-28 (open, incl. drafts); none builds `organizationContext`.
- **#2948** (draft, auth bootstrap) plans a typed 4xx at the tenant-STAMP site
  (`src/generator/typescript/emit/audit-stamp.ts`, the .NET interceptor) for a
  missing tenancy claim. This moment does not touch those files; the only
  interaction is semantic — a claim-less principal with an `x-org-context`
  header is already refused (403 `no_principal_scope`) before that stamp runs.
- **#2945** (`currentUser` inside a read filter) — principal threading in
  author-written filters on node/python/elixir. `organizationContext` lowers to
  the same principal ref, so it inherits #2945's fixes; no shared hunks.
- **#2976** (behavioural identity: registry-row principal) — would let the
  behavioural tier drive the tenancy fixtures; `org-context` could then leave
  the E2E-less register for its no-switch half (the switch itself stays a
  header the `test e2e` vocabulary cannot set).
- **#3048** (denyByDefault ⊗ eventLog create gate) — no overlap.
- Sibling **5b** (`claude/c5-golden2`: 422 / datetime serializers, the
  lifecycle-gate ORDER) — no file shared. The switch gate sits in the AUTH
  layer (middleware / filter / plug), ahead of routing, never next to a route's
  lifecycle guard, so there is nothing to order against.

## Hand-offs outside the fence

1. **Skills** (`.claude/skills/loom-test-suites/SKILL.md`, `loom-ci-gates`) —
   add `npm run test:tenancy-org-context{,-python,-java,-dotnet,-elixir}` beside
   the hierarchy line and the `org-context` cells to the tenancy-e2e row.
   Recipe: one line each, mirroring `test:tenancy-hierarchy{,…}`.
2. **The `run-tenancy` label** on the wave PR (above).

## Decisions taken

- **D1 — the carrier is a request header, `x-org-context: <materialized path>`.**
  The proposal (open question 1) and the synthesis (owner question 1) leave it
  open between a header, an `act as` action and a path segment. A header is
  request-level (the brief's requirement), needs no grammar, and is the form the
  proposal names first. The VALUE is the operating org's `dataKey` path, not an
  org id: the containment check is then a pure prefix test against the
  principal's already-resolved `orgPath` (no registry read), and it is the same
  delimiter-correct rule the `deep` ladder uses. A path inside the subtree that
  names no existing org is admitted (it is within the caller's write reach; it
  only scopes the caller's own rows).
- **D2 — the gate lives in the auth layer, not in a synthetic `requires`.** The
  brief pointed at the M-T3.2 item-3 header-`requires` machinery; that machinery
  gates ROUTES (it lowers to a first-body statement / a handler guard). The
  switch is a REQUEST fact, so the fail-closed place is the one per-request seam
  every backend already has — the auth middleware that resolves `orgPath`. It
  refuses before routing, on every route (reads and operations included), and
  cannot be forgotten on a route the way a per-route guard can.
- **D3 — `organizationContext` exposes `orgPath` only.** `orgId`/`tenantId`
  (proposal) are not derivable from a submitted path without a registry read by
  `dataKey`; the `tenantId` stamp stays principal-anchored (the synthesis's own
  example writes `tenantId := currentUser.tenantId`).
- **D4 — hierarchy required.** Under flat tenancy the subtree is a single node,
  so a switch is meaningless; `#no-hierarchy` refuses it rather than admitting a
  no-op accessor (proposal open question 6).
- **D5 — the prelude `tenantOwned` is NOT re-rooted.** It still stamps
  `currentUser.orgPath`; an author opts in by declaring the reconciled
  capability (the fixture does). Re-rooting the prelude would put the gate in
  front of EVERY tenancy system and move every tenancy corpus cell — see W1.
- **D6 — one lowering target.** `organizationContext.orgPath` becomes the
  principal member `orgContextPath` rather than a new `refKind`, so the
  backends' `current-user` detection sites needed no change. The
  principal member name `orgContextPath` is therefore reserved in practice: a
  `user { orgContextPath: … }` claim would collide on the typed backends (not
  guarded; noted).

## Decisions wanted from the owner

- **W1 — re-root the prelude.** Should the built-in `tenantOwned` stamp
  `dataKey := organizationContext.orgPath` (synthesis decision 3 for every
  tenancy system)? Behaviour is unchanged without the header, but every tenancy
  system would then emit the gate and every tenancy corpus cell re-baselines.
  A separate, deliberate change.
- **W2 — `tenantId` under a switch.** A switched row carries the CALLER's
  `tenantId` and the target's `dataKey`: deep-visible from the caller, the
  target and the target's ancestors, but not on the target org's `local` floor.
  Should a switch also stamp the target org's id (needs the registry read D3
  avoided)?
- **W3 — `currentUser.orgPath` disposition** (synthesis owner question 2) —
  kept as the principal's home path; confirm.
