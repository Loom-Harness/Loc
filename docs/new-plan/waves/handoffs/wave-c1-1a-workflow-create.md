# Wave C1 hand-off — packet 1a, workflow `create` (M-T6.62, P0) + the `handle` repro (M-T6.58)

*Branch: `claude/c1-1a-workflow-create`, forked from the wave head `bcc1c4c8`.
Commits: `d0b24a2` (merge of `origin/claude/fix-workflow-create` = PR #2850),
`cd427aa` (rule-13 corpus fixture), `30948c9` (the residue fix + the gate).*

---

## 0. The headline, because it changes what "M-T6.62 is fixed" means

**#2850 fixed one of the two spellings of the same rule, and the one it missed is
the one the repo's own five-backend instance-gate matrix is written on.**

A command `create` names the saga instance it addresses through a parameter.
There are exactly two ways to write that:

```ddd
workflow Fulfilment { orderId: Order id  status: string
  create(orderId: Order id) { status := "Pending" } }          // #2850: fixed

workflow Fulfilment { orderId: Order id  stage: string
  create start(order: Order id) { orderId := order
                                  stage := "started" } }        // still broken
```

The second is what `test/generator/workflow-instance-gate.test.ts` drives, on
**node, dotnet, java, python and elixir**. Every assertion in that file was
passing against emitted output that does not compile. Generated on this tree
before the fix:

| backend | emitted | verdict |
|---|---|---|
| node | `this.orderId = order;` in a module-scope arrow | TS2683 |
| dotnet | `this.OrderId = command.Order;` on `FulfilmentHandler` | no such member |
| java | `this.setOrderId(order);` on `OrdersWorkflows` | no such method |
| elixir | `with state <- (%{state \| order_id: order})` | **both** `state` and `order` unbound |
| python | `self = SimpleNamespace(_order_id="", _stage="")` | compiles, **silently drops**: the saga row is never inserted, so `/workflows/fulfilment/instances` answers empty forever |

Reproduce: `/tmp/.../scratchpad/caseE.ddd`, or just generate
`test/generator/workflow-instance-gate.test.ts`'s own `system Shop` on any
platform.

---

## 1. Fixed

| row | what | evidence |
|---|---|---|
| **M-T6.62 residue — second spelling** | `commandCreateCorrelationParam` now also accepts `<corr> := <param>` as a TOP-LEVEL statement of the facade create (RHS must be a bare param ref). The five emitters are untouched: they already take a `ParamIR` and key on it, so the existing load-or-allocate / bind / save seam applies verbatim. | Regenerated `caseE.ddd` on all five: node `const state = (await loadFulfilment(db, order)) ?? …`; dotnet `var __key = command.Order;` + `FindAsync(x => x.OrderId == __key …)`; java `fulfilmentStateRepository.findById(__key).orElseGet(…)` + `save(state)`; python `state = await _load_fulfilment(session, __key)` and **no** `SimpleNamespace`; elixir `%{"order" => order} = params` + `key = params["order"]` + `Repo.update!`. Pinned by 5 new cases in `test/generator/workflow-create-state.test.ts`. |
| **.NET key read off the wrong member** | `workflow-emit.ts:1409` emitted `var __key = command.${upperFirst(correlationField)}`. The record is `FulfilmentCommand(OrderId Order)` — member named for the PARAM — so `command.OrderId` is **CS1061** on a project that otherwise builds. Now `upperFirst(corrParam.name)`; the state-side comparison still names the column. | `expect(handler).toContain("var __key = command.Order;")`, `…not.toContain("var __key = command.OrderId;")` |
| **Elixir param destructure lost `assign`** | `collectWorkflowStmtParamRefs` was a hand-rolled `switch` over **13 of the 14** `WorkflowStmtIR` kinds with **no `default`** — the missing arm was `assign`. So the param an assignment reads (`orderId := order`) was never destructured off `run/1` and the emitted module named an undefined variable. Migrated onto `walkWorkflowStmtChildren`, exactly like its already-migrated sibling `collectWorkflowStmtParamRefsAll`. | `expect(wf).toContain('%{"order" => order} = params')`. Its `ir-walk-census` waiver is **deleted** in the same commit (the ratchet flagged it as stale the moment the switch went — the census earning its keep). |
| **One rule, one home** | The whole correlation rule moved to `src/ir/util/workflow-own-state.ts`. Phase ⑦ must refuse exactly what phase ⑧ cannot address — a shape the validator admits and the emitter cannot key IS the original bug — and the validator cannot import down-pipeline from `generator/`. `src/generator/_workflow/create-state.ts` is now a re-export shim carrying the narrative. | `tsc -b` clean; `pipeline-layering.test.ts` green. |

## 2. Gated (new `loom.*` code)

| code | refuses | fixture | message key |
|---|---|---|---|
| `loom.workflow-create-correlation-unsupplied` | a command create that writes own state and supplies the correlation key by **neither** spelling (`create(oid: Order id) { status := … }`), including a CONDITIONAL assignment (`if true { orderId := order }` — a key only sometimes set is not an address) | `test/system/diagnostic-firing-census.test.ts` FIRING_FIXTURES + 4 cases in `test/ir/workflow-own-state-addressable.test.ts` | default |
| ↳ `#payload` variant | the form reported on #2850 — `create(c: FileClaim)`, where the key is a FIELD of a payload-typed param | 3 cases in the same file | `…#payload` |

Anchored in `code-docs.ts` → `13-workflows.md#workflow--state` (the
`diagnostic-docs-anchors` gate checks the heading exists). No
`unsupported-register.ts` row: the code is not "a target can't do this" — it is
"this create names no instance", and the author fixes it in the source.

### Why `#payload` is a refusal and not an extension — decided from the code

The packet asked for a decision. **Refuse**, for two reasons that are both in
the tree today:

1. **The key expression would not compile anyway.** `create(c: FileClaim)`
   emits `z.object({ c: z.unknown() })` (verified: `caseD.ddd` → node
   `workflows.ts`), so `body.c` is `unknown` and `body.c.orderId` is TS18046.
   Following the key one level down would trade an unbound receiver for an
   `unknown`-typed key — a different miscompile, not a fix. That wire-contract
   half is **#2886**'s and is explicitly out of this fence.
2. **A spelling that works today exists**, and the message names it:
   `create(orderId: Order id, c: FileClaim)`. A refusal with a working remedy
   is honest; a silent unbound receiver is not.

**Revisit when #2886 lands.** At that point `c.<corr>` is a typed expression and
the extension becomes a one-function change in
`correlationAssignedFromParam`'s sibling — but it still needs the five emitters
to take a key *expression* rather than a `ParamIR`, which is the real cost.

## 3. Flipped

| file | change |
|---|---|
| `docs/new-plan/T6-backend-parity.md` § M-T6.62 | `open` → `in-flight (#2850 + wave C1 1a)`, with **LANDED** and **REMAINING** subsections, each row carrying its evidence line. |

## 4. Handed off

| row | repro | why not here |
|---|---|---|
| **An UNCORRELATED command workflow is a five-way parity gap** — `workflow Tally { total: int  create(base: int) { total := base } }` | node/dotnet/java emit `this.total = base` (unbound). python emits `self = SimpleNamespace(_total=0)` + `self._total = base` — a **deliberate, shipped** request-scoped scratch (M-T6.50 (b), `test/generator/python/python-domainservice-collector-gaps.test.ts`), whose indentation #2850 itself fixed. elixir's shape is `vanilla-workflow-own-state-assign.test.ts` and needs re-reading. | I **built and then removed** a `loom.workflow-state-uncorrelated` refusal for this: it broke 7 existing green tests, including python's own M-T6.50 (b) pin and #2850's own indentation test. Refusing would revoke a shipping emission. This is emitter work — bring the other four onto python's semantics — or an owner ruling that the shape is a `scope` limit. **Do not re-mint the refusal without reading M-T6.50 (b) first.** |
| **A command create that does NOT touch own state still allocates no row** | `create(oid: Order id) { let o = Order.create({sku:"x"}) }` + `on(e: X) by e.oid { … }` → the reactor path *loads*, it does not allocate, so it logs `event_unrouted` forever. | Gating it would refuse a legitimately stateless command starter. It is the half of F58's "never loads or saves" a receiver-binding fix structurally cannot reach. Recorded in M-T6.62 REMAINING and in the check's own header comment. |
| **`eventSourced` workflow with state fields and no id-shaped field** | unexamined | `apply(...)` folds are `StmtIR`, not `WorkflowStmtIR`; different rendering path. |
| **`scripts/mission-counts.mjs` does not exist on this tree** | `node scripts/mission-counts.mjs --write` → `MODULE_NOT_FOUND`; `ls scripts/ \| grep -i mission` is empty (only `ledger-counts.mjs`). | The C1 preamble instructs every packet that touches a track file to run it. Either C0 packet 0.4 was to add it and did not, or the instruction is stale. **Coordinator: resolve before the fold**, or every C1 packet's hand-off will carry this line. `docs/build.mjs` was run instead and is green. |

## 5. M-T6.58 (`handle` / named `create`) — repro only, no removal

Per the packet: `D-HANDLE-REMOVAL` is owner-only and **is not present in
`docs/decisions.md` on this tree**. Nothing implemented. What I verified:

**The #2850 comment understates it.** It is not only that `handle` emits no
route — an api block that *explicitly declares the route* emits nothing either,
with zero diagnostics.

```ddd
workflow Fulfillment {
  orderId: Order id  status: string
  create(orderId: Order id) { status := "Pending" }
  handle approve(note: string) { status := "Approved" }
  handle reject(reason: string) { status := "Rejected" }
}
api FulfilApi from Ops { route POST "/fulfil/approve" -> Fulfil.approve }
```

`ddd parse` → `0 error(s), 0 warning(s).` `ddd generate system` → 43–68 files
per backend, and **`grep -ril approve` over the whole emitted tree returns
nothing on all five** — no route, no handler, no method, not even a mermaid
node. The only routes on the workflow are `POST /fulfillment`,
`GET /fulfillment/instances`, `GET /fulfillment/instances/{id}`. Repro files:
`scratchpad/handle.ddd`, `scratchpad/handle-route.ddd`.

So a saga can be **started** and **read** and never **advanced**, and three
places say otherwise: `lowerWorkflow` fills `WorkflowIR.handlers`,
`test/ir/workflow-handle.test.ts` pins that lowering, and
`api-checks.ts:217-220` models the handler name as the write face.

### `loom.duplicate-handler` — what is wrong with it, precisely

Current text (`messages.ts:314`):

> Duplicate handler '{name}' in context '{ctx}'; a {kind} shares its name with another handler or a workflow 'handle'. **A 'route -> {ctx}.{name}' would be ambiguous** — handler and workflow-handle names must be unique within a context.

The *uniqueness rule it enforces is real*; the **second sentence is the false
promise**. `route -> Ctx.<workflow-handle>` is not ambiguous — it resolves to
nothing at all, on every backend. The corrected wording should keep the rule
and drop the claim:

> Duplicate handler '{name}' in context '{ctx}'; a {kind} shares its name with another handler or a workflow 'handle'. Names must be unique within a context: a `commandHandler` owns the `route -> {ctx}.{name}` surface, while a workflow `handle` is an in-process continuation that emits no entry point today (M-T6.58).

**And a code is missing.** `route POST "…" -> Ctx.<workflow-handle>` is a
give-up with no diagnostic — the exact class wave C1 1d drains. Suggested name
if the owner rules *gate* rather than *build*:
`loom.workflow-handle-no-entry-point`, raised from `api-checks.ts` where the
route target resolves to a `HandleIR` rather than a `CommandHandlerIR`. Not
minted here: which of build-vs-gate it is IS the ruling.

## 6. Gates run, with counts

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `npx vitest run test/ir/ test/system/ test/conformance/ test/generator/` | **1510 files passed, 1 skipped · 17340 tests passed, 1 expected fail, 31 skipped** |
| `node scripts/test-typecheck.mjs` | `OK — 182 files, 470 errors, src/ clean` (baseline unchanged) |
| `npm run lint` (`biome ci .`) | 0 errors (22 warnings / 4 infos, all pre-existing) |
| `node docs/build.mjs` | green |
| `node scripts/mission-counts.mjs --write` | **script does not exist** — see §4 |

Docker legs (corpus compile, behavioural) were **not** run: four cores are
shared by five agents and the new fixture's value is exactly those legs. The
coordinator should expect `corpus-{tsc,dotnet,java,python,elixir}-build` to pick
up `workflow-create-state` on the folded tree.

## 7. Mutation proofs

Every revert done by **file copy** (`cp <file>.bak <file>`), never
`git checkout -- <path>`.

| # | mutation | result | first failing assertion |
|---|---|---|---|
| 1 | `commandCreateCorrelationParam` → `return undefined` when a correlation field exists (i.e. the whole #2850 fix) | 5 failed / 1 passed in `workflow-create-state.test.ts`; all five backends regress to the F58 shapes (`this.status`, `this.Status`, `this.setStatus`, `self._status`, unbound `state`) | `expect(wf).toContain('key = params["orderId"]')` — `workflow-create-state.test.ts:108` |
| 2 | the second spelling removed (`return undefined` before `correlationAssignedFromParam`) | **18 failed / 17 passed**; the ENTIRE five-backend `workflow-instance-gate.test.ts` matrix goes red at validation | `expect(await codes(…)).not.toContain("loom.workflow-create-correlation-unsupplied")` — `workflow-own-state-addressable.test.ts` |
| 3 | .NET key back to `command.${corrPascal}` | 1 failed / 10 passed | `expect(handler).toContain("var __key = command.Order;")` — `workflow-create-state.test.ts:240` |
| 4 | Elixir collector's `assign` arm removed (`if (st.kind === "assign") return;`) | 1 failed / 10 passed | `expect(wf).toContain('%{"order" => order} = params')` — `workflow-create-state.test.ts:270` |
| 5 | the whole validator check disabled (`if (stateFields.length >= 0) return;`) | 9 failed | both `diagnostic-firing-census` fixtures: "`loom.workflow-create-correlation-unsupplied` did not come out of its own fixture" |

## 8. Rule-13 fixture

`test/fixtures/corpus/workflow-create-state.ddd` — registered in
`manifest.ts` (ALL five backends) and in `E2E_LESS_CORPUS_FIXTURES`
(`test/ir/api-caller-census-pins.ts`; the census's own ratchet demanded it).
It carries:

- `workflow Fulfillment` — spelling 1 (`create(orderId: Order id)`), plus an
  `on(e: OrderShipped)` reactor that routes by name-match back onto the row the
  create must have persisted, so a backend that binds the receiver but skips the
  save still compiles and still drops the event;
- `workflow Escalation` — spelling 2 (`create raise(order: Order id) { escalatedOrder := order … }`);
- a domain `test "…"` block and **no** `test e2e`, so the cell is behavioural-tier
  by the unit-only route (`boots && !declaresE2e`) without minting a five-way
  wire golden for a cascade no golden covers yet — the `numeric-operands` /
  `collection-op-shapes` posture. `gate-ledger.test.ts` green, no
  `BEHAVIOURAL_ABSENT` entry needed.

## 9. Files touched (fence check)

Inside the fence: `src/generator/_workflow/create-state.ts`,
`src/generator/dotnet/workflow-emit.ts`,
`src/generator/elixir/vanilla/workflow-execution-emit.ts`,
`src/ir/validate/checks/workflow-checks.ts`, `src/diagnostics/messages.ts`,
`test/fixtures/corpus/`, `docs/new-plan/T6-backend-parity.md` (M-T6.62 heading
only).

Outside the stated fence, deliberately, each one line of reason:

- **`src/ir/util/workflow-own-state.ts` (new)** — the rule has to live where
  both phase ⑦ and phase ⑧ can read it; `generator/` is down-pipeline of the
  validator. New file, no other packet names `src/ir/util/`.
- **`src/diagnostics/code-docs.ts`** — the C1 preamble requires a `code-docs`
  anchor in the same commit as a minted code.
- **`src/diagnostics/unsupported-register.ts`** — two `site:` line numbers in
  `workflow-checks.ts` drifted because my check is above them; the register's
  own gate demanded the re-point. No row added or removed.
- **`test/system/ir-walk-census.test.ts`** — deleted the waiver my elixir fix
  made stale; the ratchet fails otherwise, by design.
- **`test/system/diagnostic-firing-census.test.ts`**, **`test/ir/api-caller-census-pins.ts`**,
  **`test/generator/workflow-create-state.test.ts`** — the registers each new
  code / fixture is required to join.
