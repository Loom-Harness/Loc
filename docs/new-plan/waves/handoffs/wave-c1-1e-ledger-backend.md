### C1 packet 1e — ledger P1 silent rows (backends) — `claude/c1-1e-ledger-backend`

Tree fence: per each row's `remainingTargets` in the backend generators
(`src/generator/{dotnet,java,python,elixir}/**`, `src/platform/hono/v4/**`,
`src/generator/typescript/**`), `src/generator/money-scale.ts`, the two ledger
files, `test/fixtures/corpus/`. One import-collector seam landed at the IR layer
(`src/ir/util/op-gates.ts`) because that is where the enumeration it needed
already lives — see row 2. Flutter rows (`F2-CFE-1`,
`flutter-form-field-drops`) untouched: packet 1e-ii owns them.

**Ledger P1: 7 → 3.** The three left are `F2-MT640-SORT-DEAD` (handed off
below, re-diagnosed and resized) plus the two flutter rows 1e-ii owns.

## Commits

| sha | what |
|---|---|
| `a8ba87c3d` | corpus fixture — `projection-fold-statements.ddd` |
| `99359abf9` | **F2-XB-4** — fold statements on .NET / java / python / elixir |
| `13f61a3b6` | corpus fixtures — the `requires`-gate service call; `paged-nonrelational.ddd` |
| `bc832f34a` | **F2-CB-C7** — domain-service import at the gate site on node / java / python |
| `34db71b77` | **F2-CB-C1** — paged non-relational carriers on .NET / python |
| `fd3c262dc` | **G2644 / M-T6.60 div. 3** — money range check on all five |
| `b44a634ea` | ledger close + `F2-MT640-SORT-DEAD` re-diagnosis + gate-ledger signatures |

## Fixed

| row | targets fixed | what was wrong | gate | mutation proof (failing assertion) |
|---|---|---|---|---|
| **F2-XB-4** | dotnet, java, python, elixir (node was already correct) | A fold body admits four `StmtIR` kinds (`assign`/`let`/`add`/`remove`, per `foldImpurity`). .NET / java / elixir filtered it to `kind === "assign"`: a `let` vanished while its USES survived (CS0103 / "cannot find symbol" / "undefined variable"), and `+=` / `-=` were dropped outright so the column never accumulated. python dropped `let` the same way and sent `add`/`remove` through the ES-applier renderer, whose list-only `state.f.append(v)` is wrong twice on a read-model row — every non-key column is NULLABLE (AttributeError on the first event for a key) and a scalar `n += v` is not a list at all. | `test/conformance/projection-fold-statement-parity.test.ts` — 5 backends × (vacuity guard + 5 statement-kind arms) = **30 assertions**, sweeping the STATEMENT KIND axis the bug travels on | python drop-`let` → 1 failed (`python > let`); python restore `.append` → 2 failed (`python > add (int)`, `add (money)`); dotnet / java / elixir restore assign-only → 5 failed each (`let`, `add (int)`, `add (money)`, `remove (int)`, `remove (collection)`) |
| **F2-CB-C7** | node, java, python (dotnet already fixed; elixir fully-qualifies) | A `requires` gate is HOISTED out of the operation body to the CALLER (`op-gates.ts`), so it renders `Rules.fee(…)` into the route / service module while every import collector there was derived from the operation BODIES the gate had just been lifted out of. TS2304 / javac "cannot find symbol" / ruff `F821`, from `.ddd` that parses, validates and generates clean. | `test/generator/domain-service-gate-import-parity.test.ts` — its `STILL_MISSING` register is **deleted**; every row now asserts its import POSITIVELY (the same assertion inverted), each behind a vacuity guard that the gate call site is reached | node → `node imports the domain service its gate calls` ("…http/order.routes.ts does not import it"); python → same, `app/http/order_routes.py`; java → same, `features/orders/OrderService.java` |
| **F2-CB-C1** | dotnet, python (node / java / elixir verified correct — flipped, not rebuilt) | The route, the repository declaration and the response model all derive from `pagedReturn(find.returnType)` and declared the 5-argument paged contract; the two IN-MEMORY repository builders (document, eventLog) had no paged branch and kept emitting the 1-argument method. CS0535 + CS0029 on .NET; a 5-arg call into a 1-arg `async def`, then `.items` on a bare aggregate, on python. | `test/conformance/paged-nonrelational-parity.test.ts` — 5 backends × 2 carriers, each requiring the four controls in the DECLARATION and in the IMPLEMENTATION (two different emitted files) **plus** the CALLER's argument count, whose expected value comes from neither emitter | dotnet both carriers → 2 failed (`dotnet > document`, `dotnet > eventLog`, "IMPLEMENTATION omits 'int page'"); python document → 1 failed; python eventLog → 1 failed |
| **G2644 / M-T6.60 divergence 3** | all five (node, java, python, elixir had no guard; .NET's was `decimal.TryParse`'s ~29-digit accident, which misses a 16-digit value) | A 40-digit money string is perfectly WELL-FORMED, so it passed every format guard, reached `NUMERIC(19,4)`, and the DATABASE refused it — the same client-fault-as-server-fault M-T6.48 removed, one layer later. | `test/conformance/numeric-ingress-parity.test.ts` gains the fifth probe row (**6 seam arms**) and **deletes** the divergence-3 pin; the header measurement table is updated, not left stale | node → "missing its integer-digit bound in moneySchema"; dotnet → "missing its post-parse magnitude guard"; java → "missing its integer-digit bound off BigDecimal's own precision"; python → "missing its integer-digit bound in `_money_str`"; elixir → "missing its op-param range guard" AND (separately) "missing its changeset-path validate_change on the money column" |

### Seams, not per-backend patches

- **`callerGates(agg)`** (`src/ir/util/op-gates.ts`) — the ONE enumeration of the
  gates an aggregate hoists, beside the split that creates them. All three
  F2-CB-C7 collectors read it rather than re-listing the gate sites locally,
  because re-enumerating is exactly how the defect was born. The `when` state
  gates and the find read-gates render into the same modules and ride along.
- **`MONEY_INTEGER_DIGITS` / `MONEY_MAX_EXCLUSIVE` / `MONEY_RANGE_MESSAGE`**
  (`src/generator/money-scale.ts`) — derived from `MONEY_PRECISION -
  MONEY_WIRE_SCALE`, so one constant governs the guard and the column, and one
  message text keeps the wire-golden differential from seeing a divergence.
- **`inMemoryPagedFindLines`** (.NET) / **`pyInMemoryPagedFind`** (python) — one
  renderer per backend serving BOTH non-relational carriers, so document and
  eventLog cannot drift apart again. Semantics are java's shipped in-memory
  implementation: filter, then a WHITELISTED sort (`sortableFields`, the same
  allowlist the relational branch uses — an unknown `?sort=` key can never reach
  a property name), then the slice, `total` counted BEFORE the page.
- Every new fold dispatcher is **exhaustive with a `never`-checked default** plus
  a loud throw for the kinds the validator rejects, so none needed a walk-census
  waiver — and the now-stale
  `python/dispatch-builder.ts#projectionHandlerFn` waiver was **deleted** (the
  ratchet caught it, as designed).

### Corpus fixtures added (rule 13)

| fixture | shape it carries |
|---|---|
| `projection-fold-statements.ddd` | a `let` READ BY a later assignment; scalar `+=` / `-=` over `int`; scalar `+=` over `money` (the representation with no `+` operator on three of five backends); collection `+=` / `-=` over a `string[]` column that starts null |
| `paged-nonrelational.ddd` | `find … paged` × `shape: document` AND × `persistedAs: eventLog`, in one system (separate builders on every backend) |
| `domain-services.ddd` (extended) | a `requires` gate that calls a `domainService` — always true, so the fixture's existing e2e still reaches the operation; the point is the IMPORT |

Both new fixtures are signed in `gate-ledger.test.ts`'s `BEHAVIOURAL_ABSENT` with
what a behavioural block would add that the compile tier cannot see (the
ACCUMULATED VALUE of a fold; the PAGE ITSELF) and what blocks it today (a wire
golden per backend). An e2e block was written for `projection-fold-statements`
and reverted for exactly that reason — see "Handed off".

## Verified-and-flipped (no code change)

| row / target | evidence |
|---|---|
| F2-CB-C1 × **elixir** | `defdelegate in_region_invoice(region, page \\ 1, page_size \\ 20, sort \\ "id", dir \\ "asc")` against `def in_region(region, page \\ 1, …)` in `lib/d/ledger/invoice_repository.ex` — arities agree, body filters → counts → sorts → `Enum.slice`. Same on the eventLog carrier. |
| F2-CB-C1 × **node**, **java** | node `async inRegion(region, page, pageSize, sort, dir): Promise<{items,…}>`; java `public Paged<Order> inRegion(String, int, int, String, String)` with the reference in-memory body. |
| F2-CB-C1 × `shape: embedded` | correct on all five (it reuses the relational row table) — `embedded.ddd` owns that shape, so `paged-nonrelational.ddd` deliberately omits it. |
| F2-XB-4 × **node** | `#2705`'s `renderFoldStatement` renders all four kinds with nullable-coalescing accumulate; re-read on this tree. |
| G2644 format arms × java/python/elixir | wave C0's arms all green — `numeric-ingress-parity.test.ts` passes every `a malformed money string is refused` arm. The row's remaining `remainingTargets` were the FORMAT half; only the range half was outstanding, and it is the fix above. |

## Booted / framework-level proof (rules 10 and 12)

`npm test` cannot see a narrowing enforced by pydantic or by a Postgres
constraint, so the money row's two authorities were consulted directly:

- **Postgres 18** (`postgres:18-alpine`, real container) states the bound
  itself: `insert into m values (1000000000000000)` into `numeric(19,4)` →
  `ERROR: numeric field overflow / DETAIL: A field with precision 19, scale 4
  must round to an absolute value less than 10^15`; `999999999999999.9999`
  inserts. That `10^15` is `MONEY_MAX_EXCLUSIVE`, derived independently in
  `money-scale.ts` — the expected value comes from outside both the emitter and
  the test.
- **Real pydantic 2.13** over the EMITTED `app/http/wire_models.py`, imported
  verbatim (no re-typing of the guard): 40 digits → `type=money_range`; 16
  integer digits → `money_range`; `999999999999999.9999` → accept; `0000` + 15
  digits → accept; `12,50` → `money_format`. Refuses exactly at the bound, in
  both directions.

**A full compose boot was NOT reachable** and this is a genuine gap in the
proof, not a claim: the sandbox's docker daemon cannot reach the registry
through the agent proxy (`failed to resolve source metadata for
docker.io/docker/dockerfile:1 … proxyconnect tcp: dial tcp 127.0.0.1:44471:
connect: connection refused`; the daemon's env carries `CLOUDSDK_PROXY_PORT`
rather than the session's `HTTPS_PROXY=…:38077`, and it is a shared ambient
daemon this packet would not restart out from under other agents). The two
proofs above cover the database half and the framework half; what remains
unproven is the HTTP status code each backend renders for the new refusal, which
rides each backend's EXISTING wire-refusal responder (already gated by the
"every backend routes the refusal through its own problem envelope" arm in the
same file). **Worth one `curl` when a runner with working docker egress is
available.**

## Handed off

### `F2-MT640-SORT-DEAD` — re-diagnosed, resized S → M, still open

Its premise was wrong a second time, so the row was corrected rather than built.

- **Reproduced** on this tree: `vanilla-list-read-gate.ddd` with
  `find all(): Order paged` → `Order[]`, then `generate system`. The emitted
  `order_list_live.ex` mounts `assign(:sort_key, "") |> assign(:sort_dir, "") |>
  assign(:page_num, 1)` and the template reads NONE of them — no `phx-click`, no
  `handle_event("loom-sort")`, no pager.
- **But the dead assigns are the residue, not the defect.** The scaffold macro
  passes `sortKey:`/`sortDir:`/`page:`/`pageSize: 10` to the Table in BOTH modes
  (`_body-builders.ts` `makeTable`), and the SHARED walker honours them
  CLIENT-side when the read is not server-paged
  (`_walker/primitives/table.ts`: `serverControls = !serverPaged || …` is true,
  so `renderSortedRows` sorts and the pager `.slice`s). HEEx's parallel engine
  gates on `serverPaged` instead — `heex-primitives.ts:670`,
  `const sortKey = serverPaged ? stateRefArg(expr, "sortKey", ctx) : undefined`.
- **So the same `.ddd` sorts and pages on react/vue/svelte/angular and renders an
  unsorted, unpaged table on Phoenix.** That is a cross-frontend capability gap
  (**M**: port the client-side arm into the HEEx walker), not the S-sized assign
  cleanup it was scheduled as — and it is why this packet did not take the
  ledger's first suggested fix ("drop the affordances"), which would make Phoenix
  a permanently lesser frontend for the same model. That is the parity decision
  M-T6.40 deferred and it is still deferred; it belongs to whoever owns the HEEx
  walker, not to a backend packet.
- The row's JSON now carries the transcript, the resize, the three-file tree
  (`heex-primitives.ts`, `liveview-emit.ts`, `_walker/primitives/table.ts`) and a
  `fix` naming the three edits: drop the `serverPaged` gate on
  `sortKey`/`sortDir`, sort the assign list in the `handle_event("loom-sort")`
  clause `liveview-emit.ts` already emits (it refetches, which is right for
  server mode and wrong for client mode), and slice `pageSize`. The ledger `.md`
  prose bullet was rewritten to match.

### A behavioural block for the two new corpus fixtures

An e2e for `projection-fold-statements` was written and generates cleanly on all
five (`expect(opened.entries).toBe(10)` then `expect(closed.entries).toBe(6)` —
arithmetic that only holds if BOTH the `+=` and the `-=` ran), but
`gate-ledger.test.ts`'s "every e2e-declaring case that boots has a golden to
compare against" requires a committed wire golden per backend, which needs a
capture run this packet could not do. Reverted and signed instead. **The DSL is
in this note's commit history (`99359abf9`'s scratch), and re-adding it is a
capture away** — it is the strongest gate available for this row, because a
dropped `+=` compiles and leaves the column null forever.

### Out-of-fence defects noticed, not fixed

| where | what |
|---|---|
| `src/generator/java/emit/projection-state.ts` | A projection row's non-key columns are rendered with `renderJavaType(f.type)` on a `{...f, optional: true}` FieldIR — the OPTIONAL flag moves, the TYPE does not — so an `int` state field emits a primitive `int` field against a NULLABLE `@Column`. The fold now always writes it before the read, so it is latent rather than live, but a row written by one fold and read before another would have Hibernate set `null` into a primitive. Not this row's defect; filed here so it is not re-discovered. |
| `src/generator/java/render-stmt.ts` `add`/`remove` leaves | The domain-body leaves render `path.add(v)` / `path.remove(v)` without branching on `s.collection`, so a SCALAR `n += v` in an aggregate operation would emit `this.total.add(…)`. Not reached by any fixture here (the projection fold has its own renderer now) and not verified as reachable — worth a probe by whoever owns the java body path. |

## Gates run (this tree, after the last commit)

| command | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | ratchet OK — 182 files, 470 errors, src/ clean (unchanged) |
| `npm run lint` (biome ci) | 0 errors |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `npx vitest run test/conformance/{numeric-ingress-parity,projection-fold-statement-parity,paged-nonrelational-parity,corpus-coverage}.test.ts test/generator/domain-service-gate-import-parity.test.ts test/system/{gate-ledger,ledger-counts,ir-walk-census}.test.ts` | **399 passed** |
| `npx vitest run test/generator/dotnet` | 729 passed (111 files) |
| `npx vitest run test/generator/java` | 566 passed (95 files) |
| `npx vitest run test/generator/python` | 511 passed (90 files) |
| `npx vitest run test/platform/hono test/generator/elixir test/generator/typescript` | 1782 passed (281 files) |
| `node docs/build.mjs` | clean |
