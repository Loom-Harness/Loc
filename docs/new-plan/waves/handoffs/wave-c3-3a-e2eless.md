# Wave C3 · packet 3a — the E2E-less drain + the compile-only cells (M-T9.13)

Branch `claude/c3-e2eless`, base `7d8b26a0c` (the C3 coordinator head = `main` @ `d2a0bc02c` + the wave log). Never pushed; the wave PR (#3058) is the claim. Plan row: [`../wave-c3.md`](../wave-c3.md) §Packets, "3a".

**Verdict.** Of the 22 fixtures in this packet's fence, **4 drained** (block + node-minted golden, green on all seven legs, each mutation-proved), **6 had a block written, booted, and HELD** on the runtime defects the block found (every one of the six waivers named the wrong blocker), and **12 were re-checked and re-reasoned** in place. The plan's two blanket exits are not met and cannot be from this fence: `E2E_LESS_CORPUS_FIXTURES` ≤ 6 would need the six held fixtures' defects fixed (C3 is test-only), and compile-only cells ≤ 10 is below the 25 cells the six FENCED fixtures alone hold.

| register | before | after |
|---|---|---|
| `E2E_LESS_CORPUS_FIXTURES` (`test/ir/api-caller-census-pins.ts`) | 28 | **24** (6 fenced + 18 reasoned) |
| `BEHAVIOURAL_ABSENT` (`test/system/gate-ledger.test.ts`) — ratchet max in `allowlist-ratchet.test.ts` | 26 | **23** |
| compile-only ledger cells (the gate-ledger `compileOnly` set) | 130 (26 features × 5) | **115** (23 × 5) |
| `UNATTRIBUTED_CALLS` | — | +1 row (`corpus/workflow-primitive-params`: `api.topUp.run`, the workflow-accessor `notLifted` class) |

`numeric-operands` drained from the E2E-less register without moving the ledger: its domain `test` block already scored its cells `behavioural`; what it gained is the api block and a golden.

---

## 1. Drained

Every golden was minted from the node leg (`LOOM_WIRE_UPDATE=1 node run.mjs <case>`), then the four cases were replayed on the final head on all seven legs: node (in-process PGlite), mikroorm, python, dotnet, dapper, java, elixir — **4 cases compared, 0 divergences, 0 failures on each leg** (the `workflow-primitive-params` block was touched once more after that run and re-verified alone on all seven). Leg toolchains: a private `postgres:17-alpine` on :5481 (one database per leg), `/opt/dotnet` (SDK 10), JDK 25 + Gradle 9 lifted from `gradle:9-jdk25`, Elixir 1.18.4 / OTP 27 lifted from the `hexpm/elixir` image (`docs/tools.md` recipe).

| fixture | what the waiver said | what was true | block reads back | mutation (seeded in the compiled toolchain under `out/`, file-copy backup/restore) → failing assertion |
|---|---|---|---|---|
| `principal-read-filter` | "the harness cannot seed a row owned by the authenticated principal — `devClaimKind` carries `string`/`string[]` only" | the claim is `user.id: guid`, and every backend's dev-stub principal carries the SAME built-in value for it — the zero guid (`src/generator/_auth/dev-stub-id.ts`, each stub table's `guid` arm). A row seeded with it IS the caller's | `mine()` = 2 of 3 rows, `mineByState(false)` = the one open row, the principal-free `byTitle` sees both "Boiler" rows, handing the other row over moves `mine()` to 3 | `repository-find-predicate.js:499` renders the principal member as a foreign guid → `expect(mine.count()).toBe(2)`: **expected 0 to be 2** |
| `numeric-operands` | "a golden would pre-empt the un-ruled decimal divergence (M-T5.22)" | M-T5.22 is ruled (RS-37, C5 5a) | the four right-hand operand shapes after create, after `restock`, and after an update that makes `int == decimal` TRUE (the arm the unit block never asserts) — over values HYDRATED from `numeric` columns | `numeric-codec.js:39` decimal `repo-read` → identity (the column stays a string) → `expect(equal.sameAsGoal).toBe(true)`: **expected false to be true** — while the in-memory unit block stays green, which is the point |
| `extern` | "`Order` has no create; give it one and drive the preconditions" | exactly that — so `Order` gained `crudish` | `confirm` 422 on `riskScore < 80`, `flag` 422 on its param bound, `cancel` mutates, then `confirm` 422 on `isMutable()`; the refusals wrote nothing | `emit/aggregate.js:435` drops the `this.check<Op>()` call → `expect(api.orders.confirm(risky)).toThrow(422)`: **got 501** (the scaffold's not-implemented) |
| `workflow-primitive-params` | "the behavioural runner cannot yet address a workflow's create surface" | stale since the workflow accessor (`api.<wf>.run(…)`, M-T5.36 F5) | every param kind (int/long/bool/decimal/datetime/enum/VO/optional) crosses the route; `holder`/`balance`/`active`/`tier` land in the row; `qty: 0` and `flag: false` arrive as SENT | `workflow-builder.js:737` binds `flag` to `false` (the scalar default a missing key used to bind on java) → `expect(ada.active).toBe(true)`: **expected false to be true** |

Two fixture changes rode the drains and are worth naming: `extern`'s `flag` precondition and (in the held `vo-id-reference` block) the VO invariant gained a `message`, for the reason in D5 below.

**Register / ratchet proofs.** Tightening the ratchet by one more (`max: 22`) fails with `BEHAVIOURAL_ABSENT (test/system/gate-ledger.test.ts) has 23 entries, over the pinned max 22`. Re-adding `"extern"` to `E2E_LESS_CORPUS_FIXTURES` fails `api-caller-census.test.ts` › "lists every corpus fixture that has no `test e2e` block at all". Both restored by file copy.

## 2. Defects handed off (C3 is test-only — nothing under `src/` was edited)

Each was found by booting a `test e2e` block on a fixture the waiver said had nothing to find. The blocks are in §3; restoring one = re-applying its fixture change, re-minting the golden from node, deleting the register + `BEHAVIOURAL_ABSENT` rows, lowering the ratchet.

| id | tree | fixture | leg | request → actual (expected) | suspect |
|---|---|---|---|---|---|
| **D1** | node, python, .NET-EF, mikroorm | `collection-op-shapes` | node | `GET /api/orders/{id}` after `addLine`: `byPriceDesc[0].sku` is `undefined` (expected `"B"`) — the wire carries the private-field domain instance (`byPriceDesc: root.byPriceDesc.map((a) => (a))`) | `src/generator/typescript/repository-wire-builder.ts:193` — `if (t.kind === "entity") return expr;` in `wireProjectionValue` (a DERIVED entity array bypasses the containment arm's `wireProjectionEntity`) |
| | | | python | same GET → 500, `ResponseValidationError … ('response', 'byPriceDesc', 0, 'price') Input should be a valid string, input Decimal('1.5000')` (the emitted `"byPriceDesc": list(root.by_price_desc)`) | `src/generator/python/repository-builder.ts` `wireValue` (~:1848) has no `entity` arm |
| | | | dotnet (EF) | boot abort (134): `Unable to determine the relationship represented by navigation 'Order.ByPriceDesc' of type 'List<LineItem>'` | `src/generator/dotnet/emit/efcore.ts` — no `builder.Ignore(x => x.<Derived>)` for a derived navigation-typed member (dapper is green) |
| | | | mikroorm | `POST /api/orders` → 500: `insert … "codes" … values ('[7,2,9]', …) — invalid input syntax for type integer` (an `int[]` bound as JSON text into `integer[]`) | the MikroORM entity's scalar-array property type (node `persistence: mikroorm` emitter) |
| **D2** | language / e2e surface | `workflow-command-payload`, `workflow-enum-state` | parse | `api.claims.all()` → `loom.parse-error#reserved-name: 'claims' is a Loom keyword` — `aggregate Claim` declares cleanly but its e2e slug is unaddressable (`claims` is the OIDC `claims:` map keyword, `src/language/ddd.langium:190`) | the member-chain rule behind `api.<slug>` should admit soft keywords, or the slug should be escapable; both held blocks rename `Claim` → `ClaimRecord` to proceed |
| **D3** | .NET-EF, java, mikroorm, elixir | `enum-collection` | dotnet | `GET /api/teches/{id}` → 500: `InvalidCastException: Reading as 'System.Int32[]' is not supported for fields having DataTypeName 'text[]'` | `src/generator/dotnet/emit/efcore.ts:952` — the `leaf.kind === "enum"` `HasConversion<string>()` arm is scalar-only; `List<Skill>` gets no element converter (dapper is green) |
| | | | java | same GET → 500: `No enum constant com.loom.d.domain.enums.Skill.2` (ordinals persisted into `text[]`) | `src/generator/java/emit/jpa-annotations.ts:217` — the `@Enumerated(EnumType.STRING)` arm is scalar-only |
| | | | mikroorm | same GET → 500: `root.skills.map is not a function` (the `text[]` hydrates as the raw array literal) | MikroORM property type for an enum array |
| | | | elixir | `POST /api/teches/{id}/retrain` → 500: `Ecto.ChangeError: value ["Plumbing", "HVAC", "Electrical"] for D.Dispatch.Tech.skills in update does not match type {:array, #Ecto.Enum<…>}` — the operation param is written uncast (create is fine) | elixir operation persist for an enum-array param; see also open #2966 ("an array-of-enum Ecto field") before building |
| **D4** | java, elixir | `vo-id-reference` | java | first `POST /api/docks` → 500: `column d1_0.value does not exist` — the embedded override is `@AttributeOverride(name = "ship", column = @Column(name = "berth_ship"))`, but `ShipId` is itself an embeddable whose component is `value` | `src/generator/java/emit/jpa-annotations.ts:118` (`voOverrides`) and `voElementOverrides` — an `id`-typed VO field needs the path `ship.value` |
| | | | elixir | `mix ecto.migrate` fails: `column "berth_ship" does not exist` — the VO is stored as ONE `:map` column (`add :berth, :map`) yet the migration emits `create index(:docks, [:berth_ship])` | `src/generator/elixir/migrations-emit.ts`, the index arm over the shared MigrationsIR's flattened VO column |
| **D5** | observation (not a defect by the code's own statement) | `vo-id-reference`, `extern` | python, dotnet | a MESSAGE-LESS bound answers each framework's default text: node `"Position must be at least 1"`, python `"Input should be greater than or equal to 1"`, .NET `"'Position' must be greater than or equal to '1'."` | `src/generator/zod-refine.ts` `singleFieldMessage` says this is "node-local" by design; it is still three wire contracts for one rule. The held/drained blocks use MESSAGED rules (the ruled M-T1.11 contract) instead. Worth a `D-` ruling |
| **D6** | elixir | `workflow-enum-state` | elixir | `POST /api/claim_records/{id}/file` → 500: `not_null_violation … column "claim_state" of relation "reviews"` — the saga row is INSERTED before the create body's enum assignment reaches it | the elixir workflow-state persist (`lib/d/review/workflows/review/state.ex` in the output; the event-triggered create path under `src/generator/elixir/`) |
| **D7** | elixir | `workflow-command-payload` | elixir | `POST /api/workflows/claim_handling` → 500: `KeyError: key :cargo not found in: %{"amount" => …, "cargo" => …}` at `lib/d/claims/workflows/claim_handling.ex:19` — a payload-typed param arrives string-keyed, the body reads atom keys | the payload-param binding in the elixir workflow emitter |
| **D8** | elixir | `projection-implicit-sub` | elixir | `POST /api/orders/{id}/ship` → 500: `Ecto.ChangeError: value ~U[…] for D.Orders.Workflows.FulfilmentState.shipped_at in update does not match type :string` — an optional `datetime` workflow-state field typed `:string` (RS-38's `Loom.Datetime` never reached workflow-state schemas) | the elixir workflow-state schema type map |

Two more measured facts the next drain needs:

- **The six held blocks are green everywhere else.** `projection-implicit-sub`, `workflow-enum-state` and `workflow-command-payload` pass on node / mikroorm / python / dotnet / dapper / java (the non-node legs ran the blocks before two late strengthenings — the enum reorder in `workflow-enum-state` and the 422 probe in `workflow-command-payload`; node ran the final text, and both strengthenings were mutation-proved there: dropping the create's assignment reads `"UnderReview"`, a `z.any()` payload schema turns the 422 into a 500). `collection-op-shapes` is fully green on dapper, java and elixir; `enum-collection` on node, python and dapper; `vo-id-reference` on node, mikroorm and dapper with the final (messaged) block, and on python and .NET-EF with every assertion passing and only D5's message text diverging (they ran the message-less draft).
- **`projection-implicit-sub`'s old waiver was falsified by mutation, not argued.** Re-seeding the original defect (`deriveEventSubscriptions` returning `[]` without channels, `out/ir/enrich/enrichments.js:1273`) leaves the carried twin `projection` GREEN and turns the held block red (`GET …/workflows/fulfilment/instances/{id}` → 404) — the twin could never see it.

## 3. The held blocks (restore each with its fixture change)

Fixture changes: `collection-op-shapes` — `aggregate Order with crudish`. `enum-collection` — none. `vo-id-reference` — `aggregate Ship with crudish`, and `invariant position > 0 message "A berth position starts at 1"`. `workflow-enum-state` — rename `Claim` → `ClaimRecord` (aggregate, repository `ClaimRecords`, `ClaimFiled.claim`, `Review.claim`), add `operation file() { emit ClaimFiled { claim: id, at: now() } }`, reorder `enum ClaimState { UnderReview, Filed, Approved }` (so the seed ≠ the assignment). `workflow-command-payload` — rename `Claim` → `ClaimRecord` (aggregate, repository, `ClaimRecord.create`). `projection-implicit-sub` — none. Each block goes after the `deployable d { … }` block.

```text
test e2e "collection-op shapes evaluate to the right VALUES, not merely compile" against d {
  let o = api.orders.create({ customer: "Ada", discount: money("2.50"), codes: [7, 2, 9] })
  let empty = api.orders.getById(o)
  expect(empty.hasLines).toBe(false)
  expect(decimal(empty.lineTotal)).toBe(0)
  expect(empty.dearest).toBe(null)
  expect(empty.uniquePrices.count()).toBe(0)
  expect(decimal(empty.owed)).toBe(-2.5)
  api.orders.addLine(o, { sku: "A", qty: 2, price: money("1.50") })
  api.orders.addLine(o, { sku: "B", qty: 1, price: money("10.00") })
  api.orders.addLine(o, { sku: "C", qty: 4, price: money("1.50") })
  let full = api.orders.getById(o)
  expect(full.hasLines).toBe(true)
  expect(full.lines.count()).toBe(3)
  expect(decimal(full.lineTotal)).toBe(19)
  expect(decimal(full.dearest)).toBe(10)
  expect(full.byPriceDesc.count()).toBe(3)
  expect(full.byPriceDesc.first().sku).toBe("B")
  expect(full.linePrices.count()).toBe(3)
  expect(full.uniquePrices.count()).toBe(2)
  api.orders.dropCode(o, { code: 2 })
  let dropped = api.orders.getById(o)
  expect(dropped.codes.count()).toBe(2)
  expect(dropped.codes.contains(9)).toBe(true)
  expect(dropped.codes.contains(2)).toBe(false)
  api.orders.addCode(o, { code: 4 })
  expect(api.orders.getById(o).codes.count()).toBe(3)
  api.orders.update(o, { customer: "Ada", discount: money("0.75"), codes: [1] })
  let updated = api.orders.getById(o)
  expect(decimal(updated.owed)).toBe(-0.75)
  expect(updated.codes.count()).toBe(1)
  expect(decimal(updated.lineTotal)).toBe(19)
  let listed = api.orders.all()
  expect(listed.total).toBe(1)
  api.orders.destroy(o)
  expect(api.orders.getById(o)).toThrow(404)
}
```

(`collection-op-shapes` needs the harness `PgArray` arm this packet added to `web/src/runtime/ddl.ts` — commit `ff7539b1a` — or it dies in DDL synth on the node leg before its first request.)

```text
test e2e "an enum collection round-trips as member names, in order" against d {
  let t = api.teches.create({ name: "Ada", grade: "Senior", skills: ["HVAC", "Electrical"], certifications: ["gas", "high-voltage"] })
  let read = api.teches.getById(t)
  expect(read.grade).toBe("Senior")
  expect(read.skills.count()).toBe(2)
  expect(read.skills.first()).toBe("HVAC")
  expect(read.skillCount).toBe(2)
  expect(read.certifications.first()).toBe("gas")
  api.teches.retrain(t, { next: ["Plumbing", "HVAC", "Electrical"] })
  let retrained = api.teches.getById(t)
  expect(retrained.skills.count()).toBe(3)
  expect(retrained.skills.first()).toBe("Plumbing")
  expect(retrained.skillCount).toBe(3)
  api.teches.update(t, { name: "Ada", grade: "Junior", skills: [], certifications: [] })
  let cleared = api.teches.getById(t)
  expect(cleared.grade).toBe("Junior")
  expect(cleared.skills.count()).toBe(0)
  expect(cleared.skillCount).toBe(0)
  let listed = api.teches.all()
  expect(listed.total).toBe(1)
  api.teches.destroy(t)
  expect(api.teches.getById(t)).toThrow(404)
}
```

(`Tech` pluralises to `teches` — the conservative `ch → es` rule.)

```text
test e2e "a value object's Ship id survives both the embedded and the collection path" against d {
  let maru = api.ships.create({ name: "Maru" })
  let vega = api.ships.create({ name: "Vega" })
  let dock = api.docks.create({ name: "North", berth: { ship: vega.id, position: 1 }, berths: [{ ship: maru.id, position: 2 }, { ship: vega.id, position: 3 }] })
  let read = api.docks.getById(dock)
  expect(read.berth.ship).toBe(vega.id)
  expect(read.berth.position).toBe(1)
  expect(read.berths.count()).toBe(2)
  expect(read.berths.first().ship).toBe(maru.id)
  expect(read.berths.first().position).toBe(2)
  expect(api.docks.create({ name: "Bad", berth: { ship: maru.id, position: 0 }, berths: [] })).toThrow(422)
  api.docks.update(dock, { name: "North", berth: { ship: maru.id, position: 5 }, berths: [{ ship: vega.id, position: 6 }] })
  let moved = api.docks.getById(dock)
  expect(moved.berth.ship).toBe(maru.id)
  expect(moved.berths.count()).toBe(1)
  expect(moved.berths.first().ship).toBe(vega.id)
  expect(api.docks.all().total).toBe(1)
  expect(api.ships.all().total).toBe(2)
  expect(api.ships.getById(maru).name).toBe("Maru")
  api.ships.update(maru, { name: "Maru II" })
  api.docks.destroy(dock)
  api.ships.destroy(vega)
  api.ships.destroy(maru)
  expect(api.docks.getById(dock)).toThrow(404)
}
```

```text
test e2e "an enum-typed saga state is persisted as its member name" against d {
  let agency = api.agencies.create({ name: "Lloyd" })
  let rec = api.claim_records.create({ reference: "CLM-1" })
  expect(api.review.instances().count()).toBe(0)
  api.claim_records.file(rec)
  let review = api.review.instance(rec)
  expect(review.claimState).toBe("Filed")
  expect(api.review.instances().count()).toBe(1)
  expect(api.claim_records.getById(rec).reference).toBe("CLM-1")
  api.claim_records.update(rec, { reference: "CLM-2" })
  expect(api.claim_records.all().total).toBe(1)
  expect(api.agencies.getById(agency).name).toBe("Lloyd")
  api.agencies.update(agency, { name: "Lloyd's" })
  expect(api.agencies.all().total).toBe(1)
  api.agencies.destroy(agency)
  api.claim_records.destroy(rec)
  expect(api.claim_records.getById(rec)).toThrow(404)
}
```

```text
test e2e "a command payload crosses the workflow route and lands every field" against d {
  let cargo = api.cargos.create({ code: "CRG-1" })
  api.claimHandling.run({ c: { cargo: cargo.id, description: "Dented crate", amount: money("125.50"), priority: 2, note: "handle with care" } })
  api.claimHandling.run({ c: { cargo: cargo.id, description: "Wet pallet", amount: money("10.00"), priority: 5 } })
  expect(api.claimHandling.run({ c: { cargo: cargo.id, description: "No amount", priority: 1 } })).toThrow(422)
  let filed = api.claim_records.all({ sort: "priority", dir: "asc" })
  expect(filed.total).toBe(2)
  let first = filed.items.first()
  expect(first.description).toBe("Dented crate")
  expect(decimal(first.amount)).toBe(125.5)
  expect(first.priority).toBe(2)
  expect(first.note).toBe("handle with care")
  expect(first.cargo).toBe(cargo.id)
  let second = filed.items.where(c => c.priority == 5).first()
  expect(second.description).toBe("Wet pallet")
  expect(second.note).toBe(null)
  expect(api.claim_records.getById(first).description).toBe("Dented crate")
  api.claim_records.update(second, { cargo: cargo.id, description: "Wet pallet", amount: money("12.00"), priority: 5, note: "dried" })
  expect(api.claim_records.getById(second).note).toBe("dried")
  expect(api.cargos.getById(cargo).code).toBe("CRG-1")
  api.cargos.update(cargo, { code: "CRG-2" })
  expect(api.cargos.all().total).toBe(1)
  api.claim_records.destroy(first)
  api.claim_records.destroy(second)
  api.cargos.destroy(cargo)
  expect(api.claim_records.all().total).toBe(0)
}
```

```text
test e2e "an uncarried event still folds the read model and drives the reactor" against d {
  let ord = api.orders.create({ customerId: "c-1", status: "Draft" })
  api.orders.place(ord)
  let placed = api.orderBoard.byKey(ord)
  expect(placed.status).toBe("Placed")
  let started = api.fulfilment.instance(ord)
  expect(started.shippedAt).toBe(null)
  expect(api.fulfilment.instances().count()).toBe(1)
  api.orders.ship(ord)
  let shipped = api.orderBoard.byKey(ord)
  expect(shipped.status).toBe("Shipped")
  let reacted = api.fulfilment.instance(ord)
  expect(reacted.shippedAt == null).toBe(false)
  expect(api.orderBoard.list().count()).toBe(1)
  api.orders.update(ord, { customerId: "c-2", status: "Draft" })
  expect(api.orders.getById(ord).customerId).toBe("c-2")
  expect(api.orderBoard.byKey(ord).status).toBe("Shipped")
  expect(api.orders.all().total).toBe(1)
  api.orders.destroy(ord)
  expect(api.orders.getById(ord)).toThrow(404)
}
```

The three workflow blocks call `api.<wf>.run/instance/instances` and projection reads, so each drain also needs its `UNATTRIBUTED_CALLS` row (the `notLifted` class), exactly as `workflow-primitive-params` got one.

## 4. The twelve re-reasoned entries (every one re-checked against the emitters on this head)

| fixture | disposition | the reason now recorded |
|---|---|---|
| `auth-id-claim`, `auth-id-claim-stub` | reasoned permanent | no route reads `customerId`; the stub value is knowable (the zero id) but nothing answers differently for it |
| `projection-split-deployables` | reasoned permanent | two backend deployables (every runner's finder throws on a second) and neither `serves:` an api |
| `api-call` | reasoned permanent for this tier | two deployables; its leg is `api-call-e2e` (3e's row) |
| `channels-broker`, `channels-broker-workflow` | needs a broker service on four legs | the node half was right ("no docker"); the four real-process legs cannot BOOT without a broker URL — python's `init_channel_transports()` raises at startup (verified in the generated `app/channels.py` + `main.py` lifespan) |
| `outbox` | needs a relay-drain step or a poll form | node never starts the relay; the other four run it asynchronously and `test e2e` has no `eventually` |
| `resources` | value judgement kept | the five CRUD routes would boot (python's clients resolve config lazily) but re-assert crudish; `POST /archive` is sidecar I/O |
| `handler-resource-ops` | sidecars | addressability landed (#2984), mounts are #3024, sidecars unchanged |
| `extern-handlers` | reasoned for the corpus tier | the old addressing refusal is stale (#2984); no preconditions, so every call pins the scaffold; mounts are #3024 |
| `find-bypass` | waits on #2976 | the cross-tenant ladder rung asserts status, and a leaking `ignoring` read answers 200 |
| `org-context` | tenancy-e2e's | `test/e2e/tenancy-org-context.test.ts` is its leg; the e2e renderer has no header form |

## 5. Local gates (final head)

| gate | result |
|---|---|
| `npx tsc -b` | exit 0 |
| `node scripts/test-typecheck.mjs` | exit 0 ("test/ and src/ are both clean") |
| `npx biome ci . --diagnostic-level=error` | exit 0, 3417 files |
| `NODE_USE_ENV_PROXY=1 node scripts/mission-counts.mjs --check` | up to date (no mission changed status — M-T9.13 stays `partial`) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | exit 0, no broken-link output |
| `npm test` (full, `NPM_TEST_EXIT` appended) | **exit 0** — 2230 files passed / 90 skipped; 27045 tests passed, 6 expected-fail, 1264 skipped |
| corpus tsc (`LOOM_TS_BUILD=1 LOOM_CORPUS_TSC_CASE=<id>`) on the four changed fixtures | 4 / 4 pass (the node behavioural leg bundles with esbuild and never type-checks, so this is the node compile proof for the `crudish` additions); the other four compile legs are implied by the booted legs that built them (`dotnet run`, `gradle bootJar`, `mix compile`, `uv sync`) |

## 6. Open PRs on the fence

- **#2976 / #2977 / #2978 / #3024** — the six fenced fixtures; untouched. #3024's diff was read first: it is the answer for `handler-triad` and the mount half of `extern-handlers` / `handler-resource-ops`, and no drain here needed it, so nothing is stacked on it.
- **#2966** (draft, "an array-of-enum Ecto field") — may overlap D3's elixir arm; check before building.
- **#2945** ("`currentUser` inside a read filter … two backends that drop the filter entirely") — `principal-read-filter` drained green on all five backends on this head, so whatever #2945 fixes is not this fixture's shape (its golden will catch a regression there).
- **#2918** (a collection create-input field may be omitted) — the held `collection-op-shapes` block omits the `lines` containment from create (the validator refuses the key today); re-check the block's create body when #2918 lands.
- The harness `PgArray` arm in `web/src/runtime/ddl.ts` is the arm #2977's body said it would add; #2977 is still a stub commit, so there is no conflict yet — whichever lands second drops its copy.
