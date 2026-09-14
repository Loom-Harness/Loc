# Wave C2 · packet 2c (node / Hono / Drizzle / MikroORM) — hand-off

*Branch: `claude/c2-node`. Base: the coordinator commit `29db198c1` on
`claude/loom-review-planning-adz0n4`, then `origin/main` @ `3af62c469` merged in before the
final gate run. Tree fence: `src/platform/hono/**`, `src/generator/typescript/**`, plus the
tests / corpus fixtures / register rows / docs / ledger a closed row requires.*

> **Fence note the coordinator should read first.** Four of this packet's rows close a
> `loom.*` register row, and a register row's GATE never lives in the packet's own tree — it
> lives in `src/ir/validate/checks/**` or `src/language/validators/**` by construction. I
> read "…plus the register rows, docs and the ledger **that a row you close requires**" as
> covering the gate site of a row I close, because on the literal reading no C2 packet could
> close any register row. Every such hunk is single-purpose and named in the table below so
> you can compose it at fold. Nothing else outside the fence was edited — the two places
> where the fix genuinely lived elsewhere are hand-offs, not edits.

## Rows

| row | outcome | proof (the assertion that fails when the fix is reverted) |
|---|---|---|
| `loom.audited-returning-operation-unsupported` | **implemented** — register row deleted, `MAX_OPEN_GAPS` 27 → 26 | `test/generator/typescript/audited-returning-route.test.ts`: restoring the `!audit && !prov` dispatch fails *"the union's 200 must be declared: expected … to contain `200: { description: "OK" …`"* (drizzle) and *"expected … to contain `const result = await db.transactional(…`"* (mikroorm). 1 of 4 still passes — it is the unaudited control. |
| `loom.find-predicate-unsupported` on mikroorm | **implemented for the general shape**; narrowed to one true shape (below) | `test/generator/typescript/mikroorm-predicate-subset.test.ts` + `test/adapters/node-mikroorm-query-projections.test.ts`: stubbing `containsMembershipFragment` to null fails *"expected … to contain `raw("id in (select __j.doc_id from doc_tags __j where __j.tag_id = ?)", [t])`"* and the `order_tags` twin. |
| pairwise **F11** (node × `embedded` × TPH) | **re-classed** → [`D-EMBEDDED-TPH`](../../decisions.md); `COMPILE_WAIVERS` entry deleted | `test/language/parsing/aggregate-inheritance.test.ts`: dropping `embedded` from `forcesOwn` fails *"forces ownTable for an EMBEDDED concrete of a sharedTable base (D-EMBEDDED-TPH)"* with `expected [] to include 'loom.es-tph-forced-own-table'`. |
| M-T2.10 `embedded` on Drizzle relational | **verified stale**, and its real residue closed by the row above | measured by generating; below |
| M-T4.3 item 4 (mikro outbox in the save tx) | **verified already done** (D-WRITE-TX said so; re-measured) | measured by generating; below |
| issue #2649 / M-T5.14 node arm | **verified already done** | `test/generator/typescript/handler-reading-service.test.ts` (5 cases, green on this head) |
| `loom.mikroorm-unsupported#migrations` | **owner-ruled, handed off** (D-DAPPER-ALTER rules the mikroorm twin a BUILD; the interim gate is shared with dapper/2b) | — |
| `loom.mikroorm-unsupported#schema-split` / `#schema-ignored` | **measured expressible, not built** — the one missing thread named below | — |
| `G2646` node arm | **both rows dispositioned**: `-node-mounts-ui-false` gets its owner (M-T9.4 A7.4); `-projection-on-event-no-channel` has no node arm — handed to 2f | — |

## What each row actually changed

### 1. `audited` / `provenanced` × a RETURNING operation (M-T6.32) — implemented

`emitOperationRoute` dispatched to `emitReturningOperationRoute` only when `!audit && !prov`,
so `operation settle(fee: int): int or NotFound` marked `audited` fell into the void-204
handler: the route declared **204 only** and the declared result — error variants included —
was discarded. python, .NET, java and elixir all emit both halves (I read all four); node was
the only backend that could not, and the gate was the honest stopgap.

The audit/provenance transaction block is now emitted by ONE helper —
`auditProvTxLines` (`src/platform/hono/v4/routes-builder.ts:1752`) — that both handlers call.
The returning handler passes `capture: true`, so the transaction RETURNS the tagged result
(`db.transaction` / `em.transactional` both resolve to their callback's value) and the
ProblemDetails translation runs on the committed value. D-WRITE-TX's "state + audit +
provenance in one tx; dispatch after commit" is unchanged.

```ts
// emitted, persistence: drizzle
const result = await db.transaction(async (tx) => {
  const repoTx = new OrderRepository(tx, __deferred);
  const aggregate = await repoTx.getById(Ids.OrderId(id));
  const before = repoTx.toWire(aggregate);
  const __result = aggregate.accept();
  await repoTx.save(aggregate);
  const after = repoTx.toWire(aggregate);
  await tx.insert(schema.auditRecords).values({ /* …, */ before, after, status: "ok" });
  return __result;
});
await __deferred.flush();
if (result.type === "NotFound") { return c.json({ /* problem */ }, 404); }
return c.json(result, 200);
```

**Files (fence):** `src/platform/hono/v4/routes-builder.ts`.
**Files (gate of the closed row):** `src/ir/validate/checks/storage-inheritance-checks.ts`
(the check deleted), `src/ir/validate/checks/system-checks.ts` + `src/ir/validate/validate.ts`
(its two references), `src/diagnostics/messages.ts`, `src/diagnostics/unsupported-register.ts`,
`test/system/diagnostic-firing-census.test.ts`, `test/system/diagnostic-docs-undocumented.ts`,
`test/system/unsupported-register.test.ts` (pin 27 → 26), and
`test/ir/capabilities/audited-returning-operation-support.test.ts` (deleted — superseded).

The byte-identical gate (rule 7) held: `audited.ddd` generated on `29db198c1`'s emitter and on
this one is `diff -r` identical on **both** persistence adapters, so the void handler moved no
bytes when its block was extracted.

### 2. MikroORM reference-collection membership — implemented

> **Correction, and the miss that produced it.** The first version of this row rewrote
> `MIKROORM_SUBSET` into a four-line walk that looked only for the surviving column-argument
> narrowing. That silently deleted THREE behaviours the descriptor also owned — naming the
> offending operator on an arithmetic node, reporting the FIRST unlowerable node
> (left-branch-before-right), and rejecting a bare NON-boolean column in a predicate position
> (`filter this.name`, which must not become `{ name: true }`) — along with the
> `isBareBooleanColumn` / `isQueryableIntrinsicCall` / `COMPARE_OPS` vocabulary they were
> written in. `test/ir/util/find-predicate-capability.test.ts` pins all three and went red;
> I never ran it, having assumed `mikroorm-predicate-subset.test.ts` was this module's
> coverage. It is not — that one covers the EMITTER, this one covers the DESCRIPTOR.
> The walk is now the original structure with exactly one arm changed: membership no longer
> decides the narrowing by itself, it defers to `isColumnArgMembership`, through a single
> `judgeMembership` helper both the predicate and the value position call so they cannot
> drift. **Lesson for the wave:** when a change guts a pure helper module, grep for a test
> file named after the MODULE, not only for tests named after the feature.

`MIKROORM_SUBSET` refused every `this.<refColl>.contains(x)` with the reason *"needs a
correlated join the adapter emits nowhere"*. That was a claim about the **EXISTS spelling**,
not about the adapter: an uncorrelated `id in (select …)` says the same thing and needs no
outer alias — and it is exactly what the drizzle twin already emits
(`inArray(articles.id, db.select({id: articleTags.articleId})…)`). The EXISTS form genuinely
could not have worked: MikroORM names the root table `e0` in the SQL it builds, so a fragment
correlating on `<table>.id` fails with *missing FROM-clause entry*.

```ts
// emitted, persistence: mikroorm
const rows = await em.find(ArticleRow, {
  [raw("id in (select __j.article_id from article_tags __j where __j.tag_id = ?)", [t])]: [],
});
```

The owning aggregate's `associations` are threaded to every call site that can carry one:
relational + embedded finds, retrievals, query-time projection filters and capability filters.

**What is LEFT of the narrowing**, and it is strictly smaller and true: a membership whose
ARGUMENT is a **column** rather than a bindable value (`where o.tags.contains(o.id)`). Only a
query-time projection `where` can produce one, having no parameters. So the register row
stays a `gap` with a narrowed `what` rather than being deleted — I did not want to buy a pin
decrement with a wrong claim.

**Files (fence):** `src/generator/typescript/emit/mikroorm-filter.ts`,
`…/mikroorm-relational.ts`, `…/mikroorm-embedded.ts`,
`src/platform/hono/v4/projection-query-routes-builder.ts`.
**Files (descriptor of the closed row):** `src/ir/util/find-predicate-capability.ts`,
`src/diagnostics/unsupported-register.ts` (row wording).

### 3. pairwise F11 — re-classed under `D-EMBEDDED-TPH`

`shape: embedded` × TPH did not work on **any** backend that implements `embedded`, three
different ways: node's drizzle embedded repository named `schema.things` while a TPH
concrete's row lives in `schema.thingBases` (19 × TS2339 per case; MikroORM had the same
defect one name over, `ThingRow` vs `ThingBaseRow`) — **and** the schema emitter did not put
the jsonb containment column on the owner table either: it emitted a relational `lines` CHILD
table, so re-pointing the repository would have moved the error rather than removed it.
Python emits BOTH tables (F13, 2e's row); .NET maps no containment at all; and the phase-⑨
migration DDL (`src/system/migrations-builder.ts:180-186`) mirrors the schema emitter on all
three.

The language already forces `ownTable` for the two other non-relational shapes under a
`sharedTable` base (D-ES-TPH: `persistedAs: eventLog`, `shape: document`). `embedded` is the
third and was simply missed. Rule 4's `forcesOwn` gains it; the message names the shape; the
pairwise composer writes the forced override for it as it already does for the other two, so
the cover reaches `embedded × ownTable` — which compiles on **both** node adapters
(`tsc --noEmit` clean, verified on generated projects).

The full rationale, the alternative that was declined (build it: two emitters plus the
phase-⑨ DDL on each of node/python/.NET, held together by a drizzle-schema-vs-migration
agreement nothing currently gates), and the fact that it is reversible by deleting one
disjunct are in `docs/decisions.md` § **D-EMBEDDED-TPH**.

**Files (fence):** `test/pairwise/compose.ts`, `test/pairwise/waivers-compile.ts`,
`test/pairwise/axes.test.ts`, `test/language/parsing/aggregate-inheritance.test.ts`.
**Files (gate of the closed row):** `src/language/validators/inheritance.ts`,
`src/diagnostics/messages.ts`, `docs/decisions.md`, `docs/inheritance.md`,
`docs/language-reference/08-inheritance-and-polymorphism.md`.

> **2e:** F13 loses its source the same way. Your `COMPILE_WAIVERS` entry for
> `embedded × tph` on python should go with it once you re-run the cover.

### 4–6. The three verify-and-close rows

- **M-T4.3 item 4** — *stale*. `test/fixtures/corpus/outbox.ddd` under `persistence: mikroorm`
  emits the whole mikro half: `emitMikroOutboxMachinery`
  (`src/platform/hono/v4/workflow-builder.ts:1414`) builds `createOutboxDispatcher` +
  `startOutboxRelay` over a `LoomOutboxRow` entity; `index.ts` wires
  `createOutboxDispatcher(db, inProcessEvents)`; the relay drains with
  `nativeUpdate(LoomOutboxRow, …)`. Item 5's first bullet is stale with it:
  `mikroSaveTxLines` (`src/generator/typescript/emit/mikroorm-config.ts:85`) wraps every write
  in `em.fork({keepTransactionContext:true}).transactional(...)`, `MIKRO_OUTBOX_DRAIN_LINES`
  drains `pullEvents()` **before** it, `MIKRO_OUTBOX_RECORD_LINE` records the durable ones on
  the callback's own `em` **inside** it, and only `dispatchAfterCommit` is dispatched after —
  D-WRITE-TX exactly (`G2667-C4` landed). **What still reproduces on node** is the other
  bullet: workflow-step / extern-handler / timer emits insert outbox rows outside any
  transaction (`workflow-builder.ts:1239-1244`, deliberately fenced with the reason inline).
  That is the remaining node deviation from D-WRITE-TX and it is NOT closed here — see the
  decisions list.
- **M-T2.10 `embedded` on Drizzle** — *stale as written*. Generated: a `shape: embedded`
  aggregate emits `lines: jsonb("lines").notNull()` on its own table and the repository
  reads/writes jsonb. It emitted **relationally in exactly one crossing** — under a TPH base —
  which is F11, closed above.
- **#2649 / M-T5.14 node arm** — *already closed on BOTH caller sites*: `readPortResolver(ctx)`
  is threaded through `honoWorkflowStmtTarget` for statement bodies
  (`workflow-builder.ts:1968`) **and** through the explicit handler's `return` render
  (`explicit-handlers-builder.ts:480,491`), with `serviceReadPorts` constructing the port
  repos. `remainingTargets` (dotnet, java, python, elixir) unchanged.

### 7. `loom.mikroorm-unsupported` — the three sub-codes

- **`#migrations`** — **not an adapter limit; already ruled.** `D-DAPPER-ALTER` says in as
  many words that the mikroorm twin "is ruled the same way": build the `MigrationsIR` chain
  in phase ⑨ behind a `__loom_migrations` ledger and flip `!usingMikro`
  (`src/platform/hono/v4/emit.ts:1067`), as a named **T2 mission**, with the widened
  post-baseline refusal landing FIRST as the interim. **Handed off, deliberately:** the
  interim gate is ONE change covering dapper AND mikroorm (2b's row
  `dapper-no-schema-evolution`) and it needs the phase-⑨ snapshot store
  (`fsSnapshotStore(outDir)`), which is neither packet's tree. Two packets racing one gate is
  the shape rule 3 exists to prevent. **Coordinator: give this to one owner, not to both of
  us.**
- **`#schema-split` / `#schema-ignored`** — **measured EXPRESSIBLE, and the gap is one
  missing argument.** A MikroORM `EntitySchema` takes a `schema:` key and `updateSchema()`
  provisions it. The reason the adapter ignores the binding's `schema:` / `tablePrefix:` is
  that `renderMikroEntities` is never handed the per-aggregate `resolveDataSourceConfig` the
  drizzle `renderSchema` receives **at the same call site** — compare
  `src/platform/hono/v4/emit.ts:705` (mikro: `shapeOf` only) with `:730` (drizzle:
  `resolveDataSource`). The work is: thread it in; emit `schema:` + the prefixed `tableName:`
  on the aggregate / part / join / projection / saga / event-stream entities (the machinery
  tables — `audit_records`, `provenance_records`, `__loom_outbox`, `loom_timer_runs` — stay
  unqualified, matching drizzle, where I verified at runtime that `audit_records` lands in
  `public` while `orders` lands in `shop`); then **prove on a booted app that
  `updateSchema({safe:true})` creates the Postgres schema** rather than failing on a missing
  one. Sized S–M. Not built in 2c; no code changed for it. The register row's old wording
  ("genuinely cannot express") is corrected either way.

### 8. `G2646` node arm — both rows dispositioned, neither is emitter work

- **`G2646-open-node-mounts-ui-false`** is a FEATURE the other four backends ship, not a gap a
  refusal could close — so it stays `open` with an owner rather than becoming a `scope` row.
  The owner exists already: **M-T9.4's A7.4 "fullstack-embed seam on `PlatformSurface`"**. The
  ledger row now carries the shape the four that ship it agree on (SPA bundle built in a
  multi-stage Dockerfile stage into the server's static root, api routes under `/api/*`, an
  index.html fallback) and what it means on Hono (`serveStatic` from
  `@hono/node-server/serve-static` + an `app.get('*')` fallback, `mountsUi: true` on **both**
  `src/platform/metadata.ts:170` and `src/platform/hono/v4/index.ts:60` —
  `descriptor-consistency.test.ts` pins the pair — plus the frontend build stage in the
  emitted Dockerfile), and that it needs a booted-app proof, which is why it does not belong
  in a packet whose other rows are refusals.
- **`G2646-open-projection-on-event-no-channel` has no node arm.** The early-return is in
  `deriveEventSubscriptions` (`src/ir/enrich/enrichments.ts:1303`); NO backend derives the
  subscription, so none folds. node's emitter is already correct downstream of it (it mounts
  its fold tee off `isMaterializedProjection`, `src/generator/typescript/emit/routes.ts:120`,
  and folds the moment a subscription exists). Under `D-PROJECTION-IMPLICIT-SUB` the fix is
  ONE change on the shared IR plus a corpus case — **2f's**, not five per-backend arms.

## New finding, filed not fixed

**`drizzle-projection-membership-column-arg-crash`** (new ledger `open` row, P3, S).
A query-time `projection … where <alias>.<refColl>.contains(<column>)` on a **bare
`platform: node`** deployable validates clean (`0 error(s), 0 warning(s)`) and then **crashes
codegen**: `internal: where-clause for projection 'MyTotals' could not lower to Drizzle, but
the validator should have caught this`. `validateFindPredicateAdapterSupport` keys on
`dep.persistence`, which a default deployable does not carry, and `firstNonQueryableNode`
admits the shape. **Pre-existing** — reproduces identically on `29db198c1`; found while
re-pointing the mikroorm fixture that used to witness the old, wider narrowing. The
recommended fix is target-neutral (stop admitting a membership whose argument is not a
bindable value, which covers all five backends and every site at once, and is what
`orm-adapter-checks.ts`'s own header prescribes); the narrow alternative (resolve the default
adapter in the gate) fixes node only. Either way `isColumnArgMembership` in
`find-predicate-capability.ts` is deleted in the same PR.

## Local gates (on the merged tree, after `git merge origin/main` @ `3af62c469`)

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | `ratchet OK — 182 files, 470 errors, src/ clean` (my one new assertion needed `String(e.message ?? "")`; the two older siblings in that file are the remaining baseline there) |
| `npm run lint` | 0 errors, 23 warnings — all pre-existing on the base |
| `node scripts/mission-counts.mjs --check` | up to date (regenerated: `open` 60 → 59, `partial` 66 → 67) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `npm test` | ran on a machine at load 20-60 (several agents sharing it): **17 files / 31 tests red**, fully accounted for below. THREE were real and are fixed; four were a missing workspace symlink in my worktree; the other 24 were 30s timeouts under that load, each re-run green or shown to carry `Test timed out in 30000ms` rather than an assertion. |
| node compile leg, **both** adapters | `npm install` + `npx tsc --noEmit` clean on generated projects for: the audited-returning repro (drizzle + mikroorm), the provenanced-returning twin, the membership find (mikroorm), the extended `audit-history` corpus fixture, and `embedded, inheritanceUsing: ownTable` (drizzle + mikroorm) |
| behavioural node leg | `cd test/behavioral && node run.mjs audit-history` — **1 passed, 0 failed** on the extended fixture |
| runtime | five booted apps on a real `postgres:18-alpine` (not PGlite) — below |

### The full red set from that run, and what each was

Reading the rollup ONLY from the tail of a running log hid two of these from my first report;
the list below is the whole `❯ … failed` set, which is what a later reader should trust.

| what | files | disposition |
|---|---|---|
| **real, fixed** | `ir/api-caller-census` (2) | the stale `audit-history` wire golden — re-captured in `96e4daa7c` |
| **real, fixed** | `ir/util/find-predicate-capability` (6) | `0ad9d790a` gutted the descriptor; restored in the follow-up commit, with five mutation proofs |
| **real, fixed** | `system/diagnostic-docs-anchors` (1) | retiring `loom.audited-returning-operation-unsupported` shrank the undocumented list 369 → 368 and I did not lower `UNDOCUMENTED_BASELINE` with it. The ratchet did exactly its job; the baseline is now 368, mutation-proved by putting 369 back (fails *"only shrinks"*) |
| **environmental, not code** | `platform/packaging-split-{core-pkg,fs-discovery}` (4) | `discoverBackendsFs` scans `node_modules/@loom/*`, which npm creates from the root `workspaces: ["packages/*"]`. That directory did not exist in my worktree, so discovery found no `node_modules/@loom/…` links. `ls -la node_modules/@loom` → ENOENT; after symlinking the six `packages/*` into it by hand, **146/146 pass**. No commit in this packet touches `packages/`, `fs-discovery.ts` or the root `package.json`. **If you see these red, run `npm install` at the repo root before reading anything into them.** |
| **timeouts** | 11 files | below |

**The timeouts, re-run and proven.** None is an assertion failure and none touches this
packet's blast radius; each was the file's own per-test timeout blown by contention (the
first number is the recorded duration in the loaded run):

| case | loaded run | isolation re-run, same tree |
|---|---|---|
| `emitted-unbound-identifiers` — `showcase.ddd` | **598s** against a 120s timeout | ✅ |
| `showcase-completeness` — AST-node-kind coverage | 41s (its own stdout printed "all 170 AST kinds covered", i.e. the body had succeeded) | ✅ |
| `cli-tooling-truth` — 3 cases (`--json` guidance, `--design angularMaterial`, `--design daisyui`) | 31-52s each | ✅ |
| *(the three files above, together)* | — | **3 files, 53 tests, 0 failed** |
| `new.test.ts` — `dotnet/crud`, `elixir/blank` | 36s / **560s** | **17/17 passed** (150s total) |
| `corpus-mutation` — `core-domain x M1.valueObject.parent` | **525s** | **passed** (5s) |

Plus, from the same run and re-checked afterwards: `cli/cli`, `cli/generate-diagnostic-parity`,
`cli/migrations-destructive`, `cli/regen-prune`, `cli/verify-cli` and
`system/playground-feature-examples` — 5 still-red cases across them on a re-run at load 26,
**every one carrying `Test timed out in 30000ms`** and not one an assertion (a `.ddd` that
parses in milliseconds was taking 74 s). These shell out to `node bin/cli.js`, which is what
makes them the first to starve.

So the fast suite is green on this tree once the three real failures above are fixed; the rest
of what the loaded run measured was the machine, and four of it was my worktree's `npm
install`.

### Booted-app proofs (rule 10)

1. **audited returning, drizzle** — migrated with `drizzle-kit migrate`, then
   `POST /api/orders/{id}/accept` → `200` with `{"type":"string","value":"OR2"}`, and
   `public.audit_records` carries the row with `before.reserved=false`,
   `after.reserved=true`, `status=ok` and a non-null correlation id. Before this packet the
   same model was refused at validation; before the gate it answered a bodiless 204.
2. **the corpus fixture's own e2e, twice** — `test/fixtures/corpus/audit-history.ddd` grew an
   audited returning `settle(fee: int): int or NotFound`. Its emitted
   `e2e/AuditHistorySystem.e2e.test.ts` passes against the booted app on real Postgres
   (`settled.value === 8`, the trail's third entry `action === "settle"` with the single
   `quantity` 5 → 8 change), and the **behavioural node leg** runs the same suite green on
   PGlite (`node run.mjs audit-history` → 1 passed, 0 failed).
3. **the wire golden, RE-CAPTURED here** — `test/behavioral/wire-golden/audit-history.json`
   (`LOOM_WIRE_UPDATE=1 node run.mjs audit-history`, node is the oracle, 12 requests). It
   records `POST /api/orders/{id}/settle` → **200** `{"type":"int","value":8}` and the third
   trail entry, so it is now the answer key the other four backends' legs must match. I read
   all four other emitters before extending the fixture and each already writes the audit row
   AND returns the tagged result for this shape (python `record_audit` + `return result`;
   .NET's `SettleHandler` stages the `AuditRecord` and the controller switches on the union;
   java's `OrderService.settle` saves the `AuditRecord` then `return result`; elixir wraps
   `D.Audit.record` and the save in one `Repo.transaction` and answers
   `{:ok, %{type: "int", value: …}}`), so the crossing should not diverge — but it is the one
   thing in this packet I could not run on all five, and it is the first place to look if a
   sibling leg goes red.
   **`api-caller-census.test.ts` is what forces this**, not just the behavioural leg: it
   cross-checks the IR-derived called set against the golden's recorded requests, so a fixture
   that gains a caller without a re-capture fails the FAST suite. That was the one genuine
   `npm test` failure, and it is fixed.
4. **mikroorm membership** — 3 articles / 2 tags,
   `GET /api/articles/tagged?t=<red>` returns exactly `A-red` + `C-both` and excludes
   `B-blue`.
5. **the drizzle oracle for (4)** — the identical `.ddd` with the default adapter, the
   identical scenario, returns the identical two titles. Two independent lowerings agreeing is
   the value read from outside the emitter that rule 12 asks for.
6. **the PAGED membership** — the shape with the real hazard, since a MikroORM `raw()`
   fragment's cache key is consumed on use and a paged find issues TWO statements
   (`em.count` + `em.find`). The emitter splices the fragment per statement, as the
   deep-scope sentinel's own note requires, and the booted app confirms it:
   `?page=1&pageSize=2` → `{total: 3, totalPages: 2}` with `[R1, R2]`, `?page=2` → `[R3]`,
   the blue-tagged row excluded from both.

## Open-PR overlaps (cited, not duplicated)

| PR | files it touches on this fence | what I did |
|---|---|---|
| **#2886**, **#2894** | `workflow-builder.ts` | **not touched.** My audit/provenance extraction is entirely inside `routes-builder.ts`. |
| **#2903** | the projection route builders | `projection-query-routes-builder.ts` is touched — **two hunks only**: `mikroFilterFor` takes `(filter, p, ctx)` and resolves the source aggregate's associations, and `mikroCapabilityFilters` passes `agg.associations`. No numeric / aggregate code. |
| **#2872** | `repository-find-hydrate.ts`, `repository-save-builder.ts` | **not touched.** |
| **#2881** | `value-objects.ts` | **not touched.** |
| **#2899** | drizzle `schema.ts` value-collection drift | **not touched** — the F11 re-class means `emit/schema.ts` needed no change at all. |
| **#2900** | `auth-emit.ts` | **not touched.** |

## Hand-offs outside the fence

1. **2f / whoever owns `src/ir/enrich/enrichments.ts`** — `D-PROJECTION-IMPLICIT-SUB`: drop
   the `channels.length === 0` early-return in `deriveEventSubscriptions` (`:1303`) and derive
   the subscription unconditionally, plus the corpus case. Node needs nothing.
2. **2b + whoever owns phase ⑨** — the widened self-provisioning post-baseline refusal
   (D-DAPPER-ALTER's interim (b)) is ONE gate covering dapper AND mikroorm. One owner.
3. **whoever owns `src/ir/validate/checks/query-checks.ts`** — the new ledger row
   `drizzle-projection-membership-column-arg-crash`; the recommended fix is target-neutral.
4. **2e** — pairwise F13's waiver loses its source with D-EMBEDDED-TPH.
5. **Coordinator** — nothing on the wire golden: `audit-history.json` is re-captured in this
   branch. If a sibling backend's behavioural leg disagrees with it on the `settle` entries,
   that is a real cross-backend divergence to diagnose, not a stale capture.

## Decisions needed from the owner

1. **D-EMBEDDED-TPH** (new, `proposed`, default applies after 48 h) — refuse
   `shape: embedded` under a TPH base instead of building it on three backends. This is the
   one row I closed by re-classification rather than by emitting, and the alternative is
   sized in the entry.
2. **node's remaining D-WRITE-TX deviation** — workflow-step / extern-handler / timer emits
   still insert outbox rows outside any transaction (`workflow-builder.ts:1239-1244`).
   D-WRITE-TX says such a path "opens one for the same set rather than inserting outside one",
   so this is now a DEFECT rather than a fenced choice — but the file is claimed by #2886 and
   #2894, so I left it. It needs an owner and a slot, not a ruling.
3. **`loom.mikroorm-unsupported#schema-*`** — build it (S–M, sized above) or accept the
   adapter's `public`-only placement permanently.
