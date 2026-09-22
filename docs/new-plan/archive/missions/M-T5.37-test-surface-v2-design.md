# M-T5.37 — test surface v2: a workflow accessor and three matchers — `design` · **M** · P1

*Design pass for wave 3 of the testability fleet
([plan](../../../audits/2026-09-14-testability-fleet-plan.md), findings
[F5, F11](../../../audits/2026-09-13-testability-audit.md)). Owner-signed decisions below;
the syntax is what needs sign-off before any packet starts.*

## What is in, what is out

| Finding | Verdict |
|---|---|
| **F5** — workflows unreachable from `test e2e` | **in** — `api.<wf>.run()` / `.instances()` / `.instance(key)` |
| **F11** — the matcher catalogue | **in** — discriminating `toThrow`, plus absence and containment |
| **F6** — a principal clause for `test e2e` | **DEFERRED by the owner: "a gap, not a bug."** Not built, not designed. The consequence stands and is recorded: `requires` / `policy` / `mask unless` / tenancy denial remain untestable from a user's model, and the repo's own coverage of them stays in `AUTHZ_LADDERS`, harness-side, shipped to nobody |

## 1 — the workflow accessor

Every backend already mounts the routes; python's `APIRouter(prefix="/workflows")` is the
clearest statement of the shape, and the other four agree. **No backend needs a new route —
this is purely a test-DSL reach problem.**

```ddd
test e2e "the workflow schedules a visit and records an instance" against api {
  let tech = api.technicians.create({ name: "Grace", skill: "Plumbing", active: true })
  api.scheduleVisit.run({
    reference: "WO-1", customerName: "Ada", technicianId: tech.id,
    label: "swap valve", price: { amount: 40.0, currency: "USD" }, at: "2026-05-01T09:00:00Z"
  })
  let running = api.scheduleVisit.instances()
  expect(running.length).toBe(1)
  let one = api.scheduleVisit.instance(tech)
  expect(one.status).toBe("Scheduled")
}
```

```ts
// generated — e2e/FieldOps.e2e.test.ts (one file, replayed against all five backends)
await __post(`${base}/api/workflows/schedule_visit`, ({ reference: "WO-1", customerName: "Ada",
  technicianId: tech.id, label: "swap valve", price: ({ amount: 40.0, currency: "USD" }),
  at: "2026-05-01T09:00:00Z" }));
const running = await __get(`${base}/api/workflows/schedule_visit/instances`);
expect(running.length).toBe(1);
const one = await __get(`${base}/api/workflows/schedule_visit/instances/${tech.id}`);
expect(one.status).toBe("Scheduled");
```

Three verbs, three routes, no new wire surface. `.instance(key)` takes the **correlation
key**, and — like every other e2e accessor — a bound `let` has `.id` appended automatically.

**Naming wrinkle to settle at review:** a folded projection already reads
`api.<projection>.byKey(k)`. `.instance(k)` is the same act under a different name. Either
rename to `.byKey()` for consistency, or keep `.instance()` because a saga instance is not a
read-model row. **Recommendation: keep `.instance()`** — the plural `.instances()` has to
exist anyway, and `byKey`/`instances` next to each other reads worse than the pair.

**What it closes beyond F5:** M-T9.12's own follow-up, which states that asserting a folded
workflow instance's scalars "needs a workflow-instance read verb the `test e2e` DSL doesn't
have yet". This is that verb.

## 2 — the matchers

Three additions to the 10-entry catalogue (`src/util/intrinsic-matchers.ts`).

### 2a — `toThrow(precondition)` / `toThrow(invariant)` — **unit tier only**

The audit's own mutation probe is the argument: deleting a `precondition` left the test
**green**, because an invariant threw instead and `toThrow()` cannot tell them apart. The
test went on claiming something it no longer proved.

```ddd
test "a fresh work order cannot be completed" {
  let wo = WorkOrder.create({ reference: "WO-1", customerName: "Ada", status: Draft })
  expect(wo.complete()).toThrow(precondition)
}
```

```ts
// generated (node) — the two kinds differ only by message prefix here
expect(() => { wo.complete(); }).toThrow(/^Precondition failed:/);
```

```elixir
# generated (elixir) — structural: GuardError is `defexception [:message, :kind]`
err = assert_raise Api.GuardError, fn -> Api.Ops.WorkOrder.complete(wo, %{}) end
assert err.kind == :precondition
```

**Owner decision: legal in a unit `test` only; refused in a `test e2e` body.** In-process the
kind is structural (Elixir carries `kind:`; the others carry a stable prefix). Over HTTP both
kinds are a 422 whose only discriminator is the RFC 7807 `detail` sentence — and
`invariant … message "…"` lets the author overwrite exactly that string. Allowing both would
make one matcher mean two strengths of claim, which is the defect [#2959](https://github.com/Loom-Harness/Loc/pull/2959)
just fixed on the ui side. An e2e body keeps `toThrow(<status>)`.

New gate: `loom.e2e-throw-kind-unsupported`, naming `toThrow(<status>)` as the wire-level form.

**Sub-decision for the implementer:** an authored `message` on the rule under test removes the
prefix the node/python/java/.NET lowering reads. Either key off structure everywhere (give the
other four backends the `kind` Elixir already has — cleanest, wider blast radius), or refuse
`toThrow(<kind>)` against a rule carrying a custom `message` (cheap, honest, narrower).
**Recommendation: refuse, and file the structural version as its own mission** — the discriminating
matcher should not drag an error-shape change across five backends on its first outing.

### 2b — `toBeNull()` and `toBeAbsent()` — **two matchers, owner decision**

```ddd
expect(read.estimate).toBeNull()      // present, explicitly null
expect(read.estimate).toBeAbsent()    // the key is not in the payload at all
```

```ts
expect(read.estimate).toBeNull();
expect("estimate" in read).toBe(false);
```

The language has one absence value; the wire has two spellings, and the backends have
disagreed about them before — which is why `absent-optional.ddd` exists. Two matchers let a
test pin the spelling deliberately.

**The risk, and why the owner's second half removes it.** A distinction the domain language
does not have means an author can guess wrong and get a test that fails on a backend for a
reason that is not their bug. That is only safe if the five backends are *held* to one
spelling — so the pair ships **with** the conformance leg, not before it.

**Measured, so the implementer does not have to re-derive it:** that gate largely EXISTS.
`test/_helpers/response-diff.ts:145` unions both key sets and raises a **`key-set`**
divergence, with `null-vs-empty` as a separate kind; `test/behavioral/wire-golden/absent-optional.json`
records `"estimate": null`. So today's enforced contract is **explicit null on all five
backends, gated per-PR**. Consequences:

- `toBeNull()` asserts the currently-gated reality.
- `toBeAbsent()` has **no subject on any backend today** — nothing omits a key. It is
  future-proofing plus a unit-tier concept, and the implementer must decide whether an
  e2e `toBeAbsent()` should therefore be refused for now rather than shipped as a matcher
  that always fails. **Recommendation: allow it and let it fail honestly** — a matcher that
  says "this backend omitted the key" is exactly how the next divergence gets caught.
- The conformance half of this mission is therefore **verify-and-document, not build**:
  confirm the key-set gate reaches optional fields on all five legs, and write the contract
  down where `docs/conformance-semantics.md` names its RS-rules.

### 2c — `toContain()`

```ddd
expect(read.tags).toContain("urgent")       // collection membership
expect(read.title).toContain("Ship")        // substring
```

Both receivers, one matcher, per the type of the subject. The plain assertion every author
reaches for and currently cannot write.

## 3 — where the work lands

Per-phase, following the `language-feature-developer` checklist:

| Phase | Workflow accessor | Matchers |
|---|---|---|
| ① grammar | none — `api.<name>.<verb>()` already parses | none for `toBeNull`/`toBeAbsent`/`toContain`; `toThrow(precondition)` needs the bare kind word to parse as an argument |
| ④ AST validate | resolve `<wf>` against the deployable's workflows; the `e2e-unknown-aggregate` message must stop claiming a workflow is an unknown *aggregate* | matcher arity + the two context gates (kind-form is unit-only; `toBeSameInstant` precedent) |
| ⑤ lower | three call kinds onto the existing e2e call IR | the kind argument onto the `expect-throws` IR node |
| ⑧ codegen | `src/system/e2e-render.ts` only — the suite is backend-agnostic HTTP | five test emitters (`{typescript,dotnet,java,python}/emit/tests.ts`, `elixir/vanilla/tests-emit.ts`) |
| gates | the e2e suite is one file replayed on five backends, so one fixture covers all | per-backend, so five |

**Asymmetry worth noting for packet sizing:** the workflow accessor touches ONE emitter
because the e2e suite talks HTTP; the matchers touch FIVE because unit tests run in-process.
The cheap-looking feature is the expensive one.

## 4 — packets

| # | Packet | Depends on |
|---|---|---|
| **P9** | the workflow accessor, all three verbs, one corpus fixture driving a real saga | — |
| **P11a** | `toThrow(<kind>)` on five backends + the e2e refusal gate | — |
| **P11b** | `toBeNull` / `toBeAbsent` / `toContain` on five backends + verify-and-document the key-set conformance contract | independent of P11a but shares `intrinsic-matchers.ts`; **stack, do not run in parallel** |

Every packet carries the standing rules: re-verify on fresh `main`, claim with a draft PR,
mutation-prove by file copy, run the gate locally.

## 5 — proof obligations

- **P9**: a corpus fixture whose `test e2e` runs a workflow and reads its instance back, green
  on the node behavioural leg; and the mutation — break the saga's own step, the test goes red.
  A passing `.run()` that asserts nothing about the instance would not have caught M-T9.12's
  class, which is the whole reason for the read verbs.
- **P11a**: the audit's exact probe, inverted — delete the `precondition` from a generated
  aggregate and show the test now goes **red** where it previously stayed green.
- **P11b**: `toBeNull` green against `absent-optional`; `toContain` on both receiver kinds;
  and a stated finding on whether the key-set gate genuinely reaches optionals on all five legs.

## Decisions, and who made them

| # | Decision | By |
|---|---|---|
| 1 | Build all three, one design pass first | owner |
| 2 | Principal clause deferred — "a gap, not a bug" | owner |
| 3 | `api.<wf>.run()` + `.instances()` + `.instance(key)` | owner |
| 4 | Discriminating `toThrow` + absence/containment | owner |
| 5 | Discriminating `toThrow` is unit-tier only, refused in e2e | owner |
| 6 | Two absence matchers **and** the conformance gate | owner |
| 7 | `.instance()` over `.byKey()`; refuse `toThrow(<kind>)` against a custom `message` rather than restructuring five error types | proposed here, open at review |
