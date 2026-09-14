Verification complete. Keycloak container cleaned up. Here is the report.

---

# Cluster H — systems / ops / auth-stack emission

Fresh `main` `9a8f2fe0` at `/tmp/loom-main`; generated from `/home/user/Loc/eval/fieldops/main.ddd` into `/tmp/agentH/out-oidc` (`242 file(s)`, `0 error(s), 11 warning(s)`).

## 1. Verification table

| Finding | Verdict | Claimed? | Evidence |
|---|---|---|---|
| **F-020** minio image gone | **LIVE** (worse than reported — see below) | **UNCLAIMED** | `docker compose pull` in the generated tree: `Image minio/minio:latest Error pull access denied for minio/minio, repository does not exist or may require 'docker login'` → `valkey … Interrupted`, `postgres … Interrupted`, `axllent/mailpit … Interrupted`. Controls: `quay.io/minio/minio:latest` → `Status: Image is up to date`; `axllent/mailpit:latest` → `docker.io/axllent/mailpit:latest`. |
| **F-024a** `offline_access` refused | **LIVE**, now reproduced *without a browser* | **UNCLAIMED** | `api/auth/handshake.ts:8` = `const SCOPES = "openid offline_access";`; `keycloak/realm.json` demo user `realmRoles: ["user","agent"]`. Booted the emitted realm and ran the token endpoint directly: with `scope=openid` → an access token; with `scope=openid offline_access` → `{"error":"not_allowed","error_description":"Offline tokens not allowed for the user or client"}` — verbatim the `CODE_TO_TOKEN_ERROR` reason. |
| **F-024b** post-login → 404 | **LIVE** | **UNCLAIMED** | `api/auth/handshake.ts:10` `POST_LOGIN = process.env.OIDC_POST_LOGIN_REDIRECT ?? "/"`; `grep -rn 'POST_LOGIN\|OIDC_POST_LOGIN' api/ docker-compose.yml` → the three `handshake.ts` hits and **nothing in compose**. The API is `3000:3000`, the SPA is `3001:3000` — so `/` is the API origin. |
| **F-022** realm mints none of the declared claims | **LIVE**, mechanically proven | **UNCLAIMED** | Decoded a real token from the emitted realm: `role: '<<ABSENT>>'  permissions: '<<ABSENT>>'  tenantId: '<<ABSENT>>'  technicianId: '<<ABSENT>>'` — while `api/auth/oidc.ts:75-80` reads exactly `claim(payload,"role")`, `"permissions"`, `"tenantId"`, `"technicianId"`. Realm has `protocolMappers` absent entirely and one attribute-less user. |
| **F-023** OCC precondition never sent | **LIVE** | **UNCLAIMED** | `grep -rn 'If-Match' web/src \| wc -l` → `0`. `api/http/*.routes.ts` read `c.req.header("if-match")` and `parseIfMatch(ifMatch, aggregate.version)` returns `current` when `header === undefined`. `docs/language.md:584` still says `token` is "✗ body — sent as an optimistic-concurrency *precondition*". |
| **F-038** no lockfile, caret ranges | **LIVE** | **UNCLAIMED** | `find . -name '*lock*'` → 0. `api/package.json` deps are all `^`. Determinism control re-verified: two fresh generations of the same model → `diff -r` = **0 lines**. |
| **F-042** `ddd trace` blind to prod | **LIVE**, and the fix is now *proven sufficient* | **UNCLAIMED** | `api/Dockerfile` ends `CMD ["node", "dist/index.js"]`. `ddd trace` on a `dist/index.js` frame → `no frame matched the sourcemap (0 of 2 stack frame(s))`. `ddd breakpoints … --line 219` → `api/domain/workOrder.ts:135:20` + `:135`, column-accurate. |

**Claim search:** `pull_request_read` on #2900 (dev-stub principal id construction — auth-adjacent, no overlap), #2884, #2864 (read in full; explicitly dedupes against #2862/#2861/#2850, none of it this cluster), plus `list_pull_requests` over all 30 open PRs and `search_pull_requests`/`search_issues` for `minio`, `keycloak realm`, `If-Match optimistic concurrency`, `lockfile package-lock enable-source-maps`, `token_exchange_failed`, `docker compose image pin`. **Every finding in this cluster is UNCLAIMED.**

### Three things that changed vs. the original report

1. **F-020 is worse than "compose aborts".** The failed pull **interrupts the other pulls** — `postgres`, `valkey` and `mailpit` all print `Interrupted`. On a cold machine the buyer gets no image at all, not just a missing minio.
2. **F-024a is reproducible in ~10 seconds with `curl`**, not only through a browser. That makes the regression gate cheap (below).
3. **F-042's "one-line Dockerfile change" is now measured to be sufficient.** I built the real bundle (`tsup v8.5.1` → `dist/index.js.map`, `sources: ["../index.ts", "../db/schema.ts", …]`) and ran it under `--enable-source-maps`. A live frame came back as `at async <anonymous> (/tmp/agentH/out-oidc/api/index.ts:53:3)` — the real `.ts`. Feeding the container-shaped equivalent to `ddd trace`:

```
    at Object.schedule (/app/domain/workOrder.ts:135:20)  →  Field.WorkOrder.schedule  (/home/user/Loc/eval/fieldops/main.ddd:219:21)
ddd trace: annotated 1 of 2 stack frame(s).
```

   The resolver **already** suffix-matches `/app/domain/…` against the map's `api/domain/…` key. No `ddd trace` change is needed. (The unmatched frame is `/app/index.ts`, which is boilerplate — `api/index.ts in map: False` — correctly not a mapped construct.)

---

## 2. Fix plans

### F-020 — the object-store image, and a pin policy — **effort S**

**Root cause.** `src/system/index.ts:1045` `image: minio/minio:latest`. The wider defect is that there is no pin policy at all: image strings are scattered literals across `src/system/index.ts` (7), `src/generator/_obs/tracing.ts:94`, `src/system/kubernetes.ts` (3). Two of them disagree with each other — the compose `rabbitmq` **storage sidecar** at `src/system/index.ts:1056` is `rabbitmq:3-management` (a debian image on an EOL 3.x line) while the compose+k8s **broker** paths use `rabbitmq:4-management-alpine` (`index.ts:988`, `kubernetes.ts:294`). Same `storage { type: rabbitmq }`, two different brokers depending on which code path reads it.

**Change.**
1. `src/system/index.ts:1045` → `quay.io/minio/minio:RELEASE.2025-xx-xxTxx-xx-xxZ` (a dated release tag, as minio publishes; verified reachable: `quay.io/minio/minio:latest` pulls, Docker Hub does not).
2. `src/system/index.ts:1067` mailpit → a version tag (`axllent/mailpit:v1.21`), not `:latest`.
3. `src/system/index.ts:1056` → `rabbitmq:4-management-alpine`, converging on the broker path's pin.
4. Lift all ten strings into one exported table — `src/system/images.ts`, `export const IMAGES = { postgres, keycloak, valkey, rabbitmq, kafka, objectStore, smtp, prometheus, traceCollector }` — consumed by `index.ts`, `kubernetes.ts`, `_obs/tracing.ts`. This is the seam the `dependency-upgrade` skill's "both surfaces" rule wants; it also makes the drift in (3) structurally impossible.

**Test to add.** A new `describe("G11 — every emitted container image is pinned and reachable")` in `test/system/generation-defaults.test.ts` (it already owns `G7b`/`G8`/`G10`, the Dockerfile/image invariants). Two halves:
- *Offline, per-PR:* every value in `IMAGES` matches `/:(?!latest$)[\w.\-]+$/` — i.e. **no `:latest`** — and the compose/k8s emitters contain no image literal outside the table (regex sweep over `src/system/*.ts` + `_obs/tracing.ts`, the same shape as the diagnostic-catalog inline-literal gate).
- *Network, and this is the half that actually catches F-020:* a `docker manifest inspect` over `Object.values(IMAGES)` behind a `LOOM_IMAGE_PINS=1` env gate, wired into an existing docker-bearing post-merge leg (`auth-oidc-compose-e2e.yml` is the natural host — it already boots the emitted compose). **This is a runtime leg, not a unit test:** no static assertion can know that Docker Hub deleted a namespace. It is the only gate that would have caught this, and it takes ~20s.

**Mutation proof.** Revert `IMAGES.objectStore` to `minio/minio:latest` by **copying `src/system/images.ts` aside, editing, and copying back** (never `git checkout --`, per §84). Offline half must fail on the `:latest` assertion; network half must fail with `manifest unknown` / `pull access denied`. State both results in the PR body. Then re-point `rabbitmq` at `3-management` and confirm the literal-sweep half fails.

**Also fix in the same PR (waiver ratchet).** `test/system/storage-sidecars.test.ts:33-34` currently *pins the defect*:
```
expect(compose).toMatch(/image: minio\/minio:latest/);
expect(compose).toMatch(/image: rabbitmq:3-management/);
```
Rewrite both to read from `IMAGES` rather than hard-coding a tag, so the assertion can never again ratify an unpullable image.

**Blind-spot note for the PR body.** `grep -rn 'minio' test/ .github/ scripts/` returns **only** the two `storage-sidecars.test.ts` assertions above and two comments in `test/ir/api-caller-census-pins.ts`. Nothing in CI has ever *pulled* this image. That is why a dead image survived.

---

### F-024 — the login flow, both halves — **effort S** (a) + **S** (b)

#### (a) `offline_access` vs. the realm

**Root cause.** `src/platform/hono/v4/auth-emit.ts:663-669` unconditionally appends `offline_access` to the scope list (identical code in `src/generator/elixir/auth-emit.ts:928-931`, `java/emit/auth.ts:980-984`, `dotnet/auth-emit.ts:355-359`, `python/auth-emit.ts:553-556`), while `renderKeycloakRealm` (`src/system/index.ts:857-945`) seeds the demo user with `realmRoles: ["user","agent"]` and never grants `offline_access`. Keycloak gates the offline scope on that realm role; the authorization-code exchange is refused with `not_allowed` before a token is minted.

**Change.** In `renderKeycloakRealm`, add `"offline_access"` to the seeded user's `realmRoles`. This is strictly the smaller, safer half: `offline_access` is a Keycloak **built-in** realm role, so it needs no `roles.realm` entry, and the generated handshake genuinely needs a refresh token (the `/auth/refresh` rotation the same emitter ships is otherwise dead code). Do **not** drop `offline_access` from `SCOPES` — that would silently delete refresh rotation on all five backends.

**Test to add — a runtime leg, and it must be a *new* one.** Every existing OIDC suite is structurally blind here: `test/e2e/auth-oidc-e2e.test.ts` has exactly **one** `it(...)`, and it (like `auth-oidc-dotnet-e2e.test.ts:197`, `auth-oidc-compose-e2e.test.ts:136`) obtains its token via `grant_type: "password"` with **no `scope` parameter**. `/auth/login` and `/auth/callback` — the code path that carries `SCOPES` — are exercised by no suite in the repo.

The cheap, deterministic gate: extend `test/e2e/auth-oidc-e2e.test.ts` (workflow `hono-oidc-e2e.yml`, `npm run test:auth-e2e`, already docker-bearing and path-scoped per-PR) with a password grant that **passes the scopes the handshake actually sends**:
```
grant_type=password … scope=<the same SCOPES the emitter wrote>
```
asserting a 200 with a `refresh_token`. That reaches the exact Keycloak refusal without driving a browser — proven above.

Worth doing alongside, and cheap since compose is already up in `auth-oidc-compose-e2e`: drive the real redirect once (`GET /api/auth/login` → follow to Keycloak → POST the login form → follow to `/api/auth/callback` → assert 302, not 401). That is the only assertion that would catch a future *third* handshake defect.

**Mutation proof.** Remove `"offline_access"` from the seeded `realmRoles`; the new scoped-grant assertion must fail with `{"error":"not_allowed","error_description":"Offline tokens not allowed for the user or client"}`. Quote that in the PR body — and note that the *unscoped* legacy assertion still passes, which is the whole point.

**Doc correction in the same PR.** `docs/testing.md:40` claims the OIDC e2e proves "the generated backend really performs the OIDC code flow against a dockerized Keycloak — login → callback → token → `User` mapping". It does not; it performs a password grant. Either make the claim true (drive the flow) or correct the row.

#### (b) post-login lands on the API 404

**Root cause.** `src/system/index.ts:1205-1211` emits `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` into the backend service's `environment:` and stops. All five backends read the same variable name — `src/platform/hono/v4/auth-emit.ts:679`, `elixir/auth-emit.ts:1076`, `java/emit/auth.ts:995`, `dotnet/auth-emit.ts:388`, `python/auth-emit.ts:609` — so **one compose line fixes all five**.

**Change.** After line 1210:
```ts
const [spa] = frontendOrigins(sys);
if (spa) lines.push(`    OIDC_POST_LOGIN_REDIRECT: ${JSON.stringify(`${spa}/`)}`);
```
`frontendOrigins(sys)` already exists at `src/system/index.ts:620` and is already used two blocks above to build `CORS_ORIGIN` — so compose cannot disagree with itself about the SPA's origin. When a system has no frontend deployable the variable stays unset and `"/"` remains correct.

Cross-origin is already handled: the SPA's `web/src/api/client.ts:62` sends `credentials: "include"` and `CORS_ORIGIN` is pinned to `http://localhost:3001`, so the session cookie set on `:3000` survives the hop.

**Test to add.** Unit: a `docker-compose.yml` assertion in `test/system/` — an OIDC system with a react deployable on port 3001 emits `OIDC_POST_LOGIN_REDIRECT: "http://localhost:3001/"`, and one **without** a frontend emits no such key (the byte-identical path). Runtime: the `auth-oidc-compose-e2e` redirect walk from (a) asserts the final `Location` is the SPA origin, not `/`.

**Mutation proof.** Delete the `frontendOrigins` line; the unit assertion fails on the missing key, and the compose leg's final `Location` reverts to `/` — which, quoted from the original report, serves `{"status":404,"detail":"no route for GET /"}`.

---

### F-022 — the realm carries none of the declared claims — **effort M**

**Root cause.** `renderKeycloakRealm` (`src/system/index.ts:857`) derives its protocol mappers from `sys.auth.claims`, and `sys.auth.claims` is populated *only* from an explicit `claims { … }` block — `src/ir/lower/lower-auth.ts:44-45`:
```ts
const claims: ClaimMappingIR[] =
  node.claims?.entries.map((e) => ({ field: e.field, path: e.path })) ?? [];
```
FieldOps declares `user { id, email, role, permissions: string[], tenantId, technicianId }` and no `claims {}` block, so `claims` is `[]`, `roleClaim` is `undefined`, and the realm emits **zero** `protocolMappers` and an attribute-less demo user. Meanwhile the *verifier* half (`src/platform/hono/v4/auth-emit.ts`, emitting `api/auth/oidc.ts:73-81`) defaults each claim path to the **bare field name**. The two halves read different sources for the same question: one reads `user {}`, the other reads `claims {}`.

Consequence is worse than 403. `permissions` decodes to `undefined`, and the emitted gate is `(currentUser.permissions).includes("ops.workOrderWrite")` — a `TypeError` on `undefined`, i.e. a **500**, not a clean denial. `tenantId: undefined` then feeds the tenancy `orgPath` derivation.

**Change.**
1. Give the realm emitter the same claim-path source the verifier uses. Extract the "declared claim → token path" resolution into one helper — `src/util/auth-claims.ts`, `resolveClaimPaths(sys): {field, path, type}[]`, defaulting `path` to the field name and letting an explicit `claims {}` entry override. `src/util/` is the right layer (client-safe pure data, consumed by both `src/system/` and `src/generator/`/`src/platform/`, no backward edge). Both the verifier emitters and `renderKeycloakRealm` consume it. *This is the actual fix* — five readers of one question rather than two readers of two.
2. In `renderKeycloakRealm`, emit one `oidc-usermodel-attribute-mapper` per resolved claim, typed off the IR field type: `jsonType.label: "String"` for `string`, `"int"`/`"long"` for numerics, `"boolean"` for `bool`, and `multivalued: "true"` for `string[]` (`permissions`). The existing `loom-role-claim` special case at `src/system/index.ts:892-909` collapses into this loop — delete it.
3. Seed the demo users' `attributes` from the same list: a value per declared claim.
4. **Per-tenant demo users.** When `sys.tenancy` is present, seed **two** users (`demo`/`demo` and `demo2`/`demo2`) with different `tenantId` attribute values, and seed the matching tenant-registry rows into the first-boot seed dataset (`src/generator/_persistence/seed-datasets.ts`) so the two `tenantId`s resolve to real `Organization` rows. Without both halves the tenancy demo still can't run. Name a realistic value per claim type rather than `""` — an empty `tenantId` is indistinguishable from the bug being fixed.

**Test to add.** Two tiers, and both are needed.
- *Unit, per-PR:* in `test/system/`, a model declaring `user { role, permissions: string[], tenantId }` with **no `claims {}` block** must emit a `protocolMappers` entry per field with the right `claim.name`, and `multivalued: "true"` on the array one. This is the assertion that is currently structurally absent.
- *Runtime, and this is the one that matters:* `test/e2e/auth-oidc-e2e.test.ts` (`hono-oidc-e2e.yml`). Its fixture `test/e2e/fixtures/auth-oidc-e2e.ddd` today declares only `id`, `roles: string[]`, `email` with `claims: { roles: "realm_access.roles", email: "email" }` — i.e. it is shaped around exactly the claims Keycloak mints *by default*, which is precisely why this class has never been visible. **Add a second fixture** carrying a custom claim (`tenantId: string`) and an **unmapped** `permissions: string[]` with no `claims {}` block, and assert `GET /api/auth/me` returns them populated. The token-decode I ran above is this assertion in miniature.

**Mutation proof.** Revert the mapper loop to the `roleClaim`-only form. The runtime leg must fail with `tenantId: null` / `permissions: []` from `/api/auth/me` — quote the JSON. Also seed a second defect: emit the mapper for `permissions` **without** `multivalued: "true"` and confirm the array arrives as a scalar string; that proves the test reaches the type arm, not just the presence arm.

**Product framing for the PR body.** The system authenticates and then 500s or denies everything, and the headline B2B feature — hierarchical multi-tenancy — has no way to be demonstrated from a fresh `docker compose up`, because the realm ships one tenant-less user.

---

### F-023 — the client never sends the precondition — **effort M**

**Root cause, three layers.**
1. `src/generator/_frontend/api-module.ts:464/467` — the shared operation-mutation emitter (react/vue/svelte/angular) issues `api.post(\`/${tag}/\${seg(id)}/${opSnake}\`, input)`. The client's `post` (`api/api-client.hbs:194`, and the four per-framework `client.ts` emitters) is `post: (path, body) => request(path, { method: "POST", body: … })` — **it has no headers parameter**, so no call site can send `If-Match` even if it wanted to.
2. `src/platform/hono/v4/emit.ts:348` `parseIfMatch(header, current)` returns `current` when `header === undefined`. Absent precondition ⇒ no precondition. (Same lenient default in the other four: e.g. `src/generator/python/repository-document-builder.ts:171`.)
3. `docs/language.md:584` describes `token` as travelling in the update **body**; all five backends use the **header** (`java/emit/api.ts:103` `@RequestHeader("If-Match")`, `dotnet/emit/api.ts:127`, `python/repository-builder.ts:1257`, `elixir/vanilla/api-emit.ts`). `src/ir/enrich/wire-projection.ts:344-350` hedges — "ETag/header **or body field** … depending on transport" — but no backend takes the body branch.

**Change — and one non-obvious constraint drives the design.** The server is already RFC-correct on both ends: the byId read emits `c.header("etag", versionETag(found.version))` (`api/http/customer.routes.ts:96`). The tempting fix is an ETag cache in `client.ts`. **It would silently fail in a browser.** `ETag` is not a CORS-safelisted response header, and the generated CORS middleware (`api/http/index.ts:77-87`) passes only `{ origin, credentials: true }` — I read hono's `cors` source in the installed tree: `exposeHeaders: []` default, `Access-Control-Expose-Headers` set only `if (exposeHeadersStr)`. With the SPA on `:3001` and the API on `:3000`, `r.headers.get("etag")` returns `null`.

So take the **body** route, which needs no CORS change and works identically on every frontend:
1. Widen the client's `post` to `post: (path, body, init?: { headers?: Record<string,string> })` in `api/api-client.hbs` + the four `client.ts` emitters.
2. `src/generator/_frontend/api-module.ts` — for an aggregate whose wire shape carries a `token` `version` (`updatePreconditions(wireFieldsFor(agg))` is the existing predicate, `wire-projection.ts:350`), emit the hook as `useUpdateX(id: string, version?: number)` and send `{ headers: version != null ? { "If-Match": String(version) } : {} }`. The detail page already holds the parsed read DTO, which carries `version: z.number().int()` — verified in the emitted `CustomerResponse`.
3. Also add `exposeHeaders: ["ETag"]` to the emitted CORS config anyway. It costs one line, it makes the server's own ETag usable by hand-written clients, and leaving a header the server sets unreadable cross-origin is its own small defect.
4. Decide the refusable-condition question explicitly and write it into `docs/language.md`: I'd keep `parseIfMatch`'s lenient default (a `curl` user and every non-browser caller would otherwise break), and instead make the *generated client* always send it. Then correct line 584's matrix cell from "body" to "`If-Match` request header (RFC 9110 §13.1.1); the read DTO carries `version` for the client to round-trip", and drop the dead "or body field" branch from `wire-projection.ts:348`.

**Test to add.**
- *Unit:* `web/src/api/<agg>.ts` for a versioned aggregate contains `"If-Match"`; the current repo-wide count is `0`, so assert `> 0` per frontend. Run it for all four shared-client frontends — the emitter is shared, the `client.ts` is not.
- *Runtime — this is the one that proves the semantics:* the lost-update scenario belongs in `frontend-fullstack-e2e.yml` / `generated-react-e2e.yml`, where a real SPA talks to a real backend. Two browser contexts open the same detail page, both submit; the second must get a **409**, not a silent 204. A unit grep can prove the header is *emitted*; only the runtime leg proves it is *correct* (right value, right row, refreshed after `invalidateQueries`).

**Mutation proof.** Drop the `headers` argument at `api-module.ts:467`. Unit assertion → 0 occurrences; runtime leg → both writes return 204 and the first writer's value is gone. Quote the two status codes. Separately seed a *stale* version (send `If-Match: 1` twice) to confirm the leg distinguishes 409 from 204 — otherwise it is a presence test wearing a semantics test's name.

---

### F-038 — no lockfile, caret ranges — **effort L, and genuinely a design call**

**Root cause and current policy.** Deliberate and centralized: `src/generator/_docker/node-stage.ts:10-24` states the two invariants, and `NPM_INSTALL_BLOCK` (line 57) hard-codes `RUN npm install --no-audit --no-fund` for every node stage. `src/generator/elixir/shell/project.ts:117` documents the same for `mix.lock`. It is enforced *in the defect's direction*: `test/system/generation-defaults.test.ts:256` — `describe("G7b — no emitted Dockerfile runs 'npm ci'")` — asserts no Dockerfile contains `npm ci` **or** `package-lock.json`. Any fix must amend G7b in the same PR (CLAUDE.md's ratchet rule: a fix deletes its waiver).

**The state per backend is not uniform, and that matters for sequencing:**

| backend | pinning | lock |
|---|---|---|
| node (api + web) | `^` caret ranges (`src/platform/hono/v5/pins.ts`) | none |
| python | `>=x,<major` ranges (`src/generator/python/pins.ts:12`) | none (`pyproject.toml`, uv-managed) |
| java | Spring BOM–managed + a few explicit `${VERSION}` constants | no `gradle.lockfile` |
| **dotnet** | **exact** `Version="2.8.16"` etc. (`src/generator/dotnet/emit/program.ts:1226-1241`) | no `packages.lock.json` |
| elixir | `mix.exs` ranges | none, documented |

**The repo has already been burned by this, and the evidence is in-tree.** `src/platform/hono/v5/pins.ts` carries this pin:
```ts
"@hono/zod-openapi": "^1.0.0 <1.5.2 || >1.5.2 <2.0.0",
```
with a ~10-line comment: `1.5.2` shipped a declaration-merging regression that produced "a `strict`/`noImplicitAny` TS7006 on every corpus feature with a cross-field invariant… Not this repo's bug — an upstream type regression on a **floating `^1.0.0` range**." That is F-038 already costing a bisection, with the workaround frozen into the emitter. Lead the PR with it — it converts an abstract supply-chain argument into a measured one.

**Plan — three increments, each independently shippable. Do not attempt all three at once.**

**Increment 1 (S) — make the exposure visible before changing it.** Add a `.loom/dependencies.json` artifact (a sibling of `wire-spec.json` under `src/system/`, per the `.loom/` bundle pattern): every emitted project, its manifest kind, each dependency with its declared range, and whether that range floats. Plus a `ddd` exit-code-neutral summary line. Nothing changes in the build; the buyer and CI can now *see* "47 floating ranges across 2 projects." This also gives increments 2–3 a diffable baseline.

**Increment 2 (M) — exact pins, no lockfile.** Rewrite `pins.ts` on each backend so the emitted manifest carries the exact resolved version (`"hono": "4.12.3"`, `"fastapi": "0.115.6"`) instead of a range, sourced from a version table the `dependency-upgrade` skill's flow already knows how to bump. Cost: **transitive** deps still float (npm without a lock resolves them fresh), so this buys reproducibility of the *direct* layer only — maybe 60% of the risk. Benefit: zero new files, no `npm ci` flow change, G7b survives untouched, and it removes the class the `@hono/zod-openapi` incident belongs to (that was a *direct* dep). **Best value per unit of risk; recommend doing this one first and stopping to measure.**

**Increment 3 (L) — a real lockfile.** Two sub-options, and they differ in where the cost lands:
- *3a — generate the lock at generation time.* `ddd generate system` shells out to `npm install --package-lock-only` (and `uv lock`, `mix deps.get`) in the emitted tree. **This breaks the byte-determinism property you currently have** — re-verified above at `diff -r` = 0 lines — because a lock's content depends on the registry at the moment of generation, not on the model. That is a real loss: determinism is what makes `--dry-run`, the fixture corpus and the `generated-*-build` gates cheap. It also makes generation require network. I would not take this.
- *3b — lock as a committed, opt-in artifact.* Emit no lock; instead emit a `scripts/lock.sh` (or a `ddd lock` subcommand) that the buyer runs **once** after `ddd new`, committing `package-lock.json`/`uv.lock`/`mix.lock` into *their* repo — where a lockfile belongs, since it is a property of a deployment, not of a model. Then change `NPM_INSTALL_BLOCK` to `RUN npm ci --no-audit --no-fund` **conditioned on the lock being present** — the emitted Dockerfile already `COPY package.json ./`; make it `COPY package.json package-lock.json* ./` with `RUN [ -f package-lock.json ] && npm ci --no-audit --no-fund || npm install --no-audit --no-fund`. Generation stays deterministic, `npm ci` becomes reachable, and the regeneration story is unharmed because `.loomignore` already governs "don't clobber my file." **This is the one to plan for.**

**Test to add.** For increment 2: a `pins.ts`-shaped assertion in the fast suite — every value in each backend's `BACKEND_PINS` matches an exact-version regex, no `^`/`~`/`>=`. For increment 3b: amend G7b from "no Dockerfile mentions `npm ci`" to "every Dockerfile's install line is the exact conditional block," and add a runtime leg on an existing docker-bearing build gate (`corpus-build.yml` / `generated-react-build.yml`) that builds **twice** from a committed lock and asserts the resolved tree hash is identical. A static test cannot prove reproducibility; only two installs can.

**Mutation proof.** Increment 2: widen one pin back to a caret; the exact-pin assertion fails. Increment 3b: delete the lock from the fixture and confirm the Dockerfile still builds (the `|| npm install` fallback) *and* that the two-install hash assertion correctly stops holding — proving the gate measures the lock, not the build.

**Cross-reference for the PR body.** `docs/audits/2026-09-10-independent-completeness-audit.md` §F5 reports this independently and adds the second half — there is no advisory or freshness gate on the emitted dependency set either. Increment 1's `dependencies.json` is the natural place to hang one (`npm audit --json` over the emitted manifest, nightly).

---

### F-042 — `ddd trace` against a production stack — **effort S**

**Root cause.** `src/platform/hono/v4/emit.ts:1911` — the `DOCKERFILE_TS` template constant ends `CMD ["node", "dist/index.js"]`. The map is built (`api/tsup.config.ts` has `sourcemap: true`; I measured `dist/index.js.map` at 950 KB) and it **is** shipped (the runtime stage does `COPY --from=build /app/dist ./dist`, which carries the `.map`). Only the runtime flag is missing. The repo already knows the technique — `src/platform/hono/v4/emit.ts:1472` emits `debug: "node --enable-source-maps index.ts"`, `index.ts:155` puts `runtimeArgs: ["--enable-source-maps"]` in `launch.json`, and `test/system/node-debug.test.ts:95` pins the dev script. Production is the one place it was never applied.

**Change.** One line:
```ts
CMD ["node", "--enable-source-maps", "dist/index.js"]
```
Unconditional — not gated on `--sourcemap`. The flag costs nothing until an `Error`'s `.stack` is materialized, and gating it would mean the flag is absent in exactly the builds where a crash is most likely to matter.

**Do NOT teach `ddd trace` to chain through the bundle's map.** Measured: with `--enable-source-maps` on, Node already rewrites the frame to the original file, and `ddd trace`'s resolver already suffix-matches the `/app/`-prefixed path against the map's `api/`-prefixed key — `at Object.schedule (/app/domain/workOrder.ts:135:20) → Field.WorkOrder.schedule (…main.ddd:219:21)`. A second chaining implementation inside `src/trace/` would duplicate what V8 does natively and would need the `.map` shipped to wherever `ddd trace` runs, which it is not. Keep the resolver as-is.

**Test to add.** Unit, fast suite, next to `test/system/node-debug.test.ts` (which already owns this concern): every emitted Dockerfile whose `CMD` invokes `node` on a **bundled** entry (`dist/`) includes `--enable-source-maps`. Write it as a sweep over `allDockerfiles()` (the helper `generation-defaults.test.ts` already uses) rather than a single-fixture assertion, so a future backend that bundles inherits the rule.

**Mutation proof.** Remove the flag; the sweep must fail naming the file. Then the end-to-end proof, which I have already run and which the PR body should quote verbatim: build the emitted api, run `dist/index.js` **without** the flag → `ddd trace` reports `no frame matched the sourcemap (0 of 2 stack frame(s))`; run it **with** the flag → the frame resolves to `Field.WorkOrder.schedule (…main.ddd:219:21)`.

**Credit where due, for the PR body.** The failure message is the best diagnostic I hit in this cluster — it names the bundle-frame problem, the map's coverage, *and* the exact remedy (`node --enable-source-maps`). The defect is that the generator never took its own advice.

**Checked and clear:** the .NET image does not have the analogous problem — `dotnet publish -c Release` emits `.pdb` into `/app/publish`, which `COPY --from=dotnet-build /app/publish ./` carries into the runtime image (`src/generator/dotnet/emit/program.ts:1460/1469`). Java, Python and Elixir do not bundle.

---

## 3. Sequencing — "blocks a buyer's first 30 minutes"

| # | Finding | What the buyer experiences | Effort |
|---|---|---|---|
| **1** | **F-020** | `docker compose up -d --build` aborts with `pull access denied` before *any* service starts — and takes the other three image pulls down with it (`Interrupted`). Minute 2. Nothing else in this list is reachable until this is fixed. | S |
| **2** | **F-024a** | Login → Keycloak → `401 {"error":"token_exchange_failed"}`. The advertised "`docker compose up` logs in out of the box" (the comment at `src/system/index.ts:759`) is false for every OIDC model. Minute 6. | S |
| **3** | **F-024b** | Login now succeeds and lands on `{"status":404,"detail":"no route for GET /"}` — the API origin, not the app. Reads as "it's still broken." Minute 7. Ships with #2; they are one PR. | S |
| **4** | **F-022** | Authenticated, and every gated route 500s (`undefined.includes`) or denies; every tenant-scoped read is empty. The buyer concludes the authz model doesn't work, and multi-tenancy — the headline B2B feature — cannot be demonstrated at all. Minute 12. | M |
| **5** | **F-038** | Invisible at minute 30; decisive at the security review. Also the one with a real design fork, so it should not be rushed behind the four above. | L |
| **6** | **F-023** | Invisible until two users edit the same row in production. Highest *severity per occurrence* (silent data loss), lowest first-impression cost. | M |
| **7** | **F-042** | Only bites after the first production crash, and the error message already tells you what to do. A one-line fix that can ride along with anything. | S |

**Recommended packaging.** Ship **1** alone and immediately — it is a one-file change that unblocks every other verification anyone does against a generated stack, and its runtime pull gate is the reusable part. Ship **2 + 3 + the missing code-flow leg** as one PR: the two defects are sequential (you cannot see #3 until #2 is fixed) and both are caused by the same hole — no gate has ever driven `/auth/login` → `/auth/callback`. Ship **4** next, and treat the shared `resolveClaimPaths` helper as the deliverable rather than the mappers: two halves reading two different sources for one question is the defect, the empty `protocolMappers` array is the symptom. Then **5**, **6**, **7** on their own merits.

The through-line worth putting in each PR body: 1, 2 and 4 are all invisible for the *same structural reason* — every OIDC gate in the repo uses the password grant with no `scope`, against a fixture (`test/e2e/fixtures/auth-oidc-e2e.ddd`) whose `user {}` block declares only claims Keycloak already mints by default, and no CI job has ever pulled the object-store image. Three defects, one blind spot.