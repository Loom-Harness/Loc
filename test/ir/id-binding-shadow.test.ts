import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";
import { buildLoomModel } from "../_helpers/ir.js";

// ---------------------------------------------------------------------------
// F-025 — a binding named `id` must SHADOW the implicit aggregate identity.
//
// `id` is the one magic identifier the GRAMMAR resolves rather than the
// lowerer: `IdRef: {infer IdRef} 'id';` sits in `PrimaryExpr` before `NameRef`,
// so a bare `id` in expression position is never a `NameRef` and never reaches
// `resolveNameRef`.  `Parameter.name` meanwhile admits `id` through
// `LooseName`, so `create(id: WorkOrder id)` declares a binding whose every USE
// the parser has already decided means `this.id`.
//
// The result validated `0 error(s), 0 warning(s)` and emitted, on every backend,
// an implicit-receiver access inside a module-level function that has no
// receiver:
//
//     const wo = await workOrders.getById(this._id);   // hono — does not compile
//     wo = await work_orders.get_by_id(self._id)       // python — ruff F821
//
// Two legs, deliberately:
//
//   1. THE IR INVARIANT (`refKind`).  Loom IR is fully resolved and backends
//      never re-resolve, so the wrong `refKind` at lowering IS the whole defect.
//      Asserting it here catches the class for every backend at once, including
//      ones that do not exist yet.
//
//   2. THE EMITTED SCOPE.  The same shape the frontend `emitted-unbound-
//      identifiers` gate takes, applied to the backends that execute domain
//      logic: a workflow body is a module-level function, so `this` / `self` in
//      it names nothing.  This is what a reader of the bug report sees, and it
//      is what fails if a FUTURE backend renders the `id` marker somewhere the
//      `refKind` assertion cannot reach.
//
// SCOPE — `id` is the ONLY colliding name, and the grammar is why.  The other
// magic identifiers in expression position are `this` (`ThisRef`), `now()`
// (`NowExpr` — needs the parens, so a bare `now` is an ordinary `NameRef`),
// `currentUser` and the ambient resource handles.  Of those, only `currentUser`
// and a resource name are spellable as a parameter name, and both DO reach
// `resolveNameRef`, where their precedence over locals is an explicit,
// documented decision ("always wins over locals so a let-binding can't shadow
// it") rather than a parser accident.  A parameter named after a DECLARED
// aggregate member already shadows correctly, because `resolveNameRef` consults
// `env.locals` before the owner's members — pinned below so it stays that way.
// ---------------------------------------------------------------------------

/** Every object reachable from a value, flattened — deliberately structural
 *  (`Object.values` recursion) rather than a hand-rolled `ExprIR.kind` switch,
 *  which `ir-walk-census` exists to forbid and which would go blind the moment
 *  the IR grows a kind. */
function everyNode(value: unknown, out: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const v of value) everyNode(v, out);
    return out;
  }
  if (value && typeof value === "object") {
    out.push(value as Record<string, unknown>);
    for (const v of Object.values(value)) everyNode(v, out);
  }
  return out;
}

/** The implicit-identity EXPRESSION marker, `{kind:"id"}`.  Distinguished from
 *  the id TYPE (`{kind:"id", targetName, valueType}`) — a parameter declared
 *  `id: WorkOrder id` legitimately carries the latter, and a filter that
 *  conflated them would report the fix as still broken. */
const identityMarkers = (nodes: Record<string, unknown>[]) =>
  nodes.filter((n) => n.kind === "id" && !("targetName" in n));

const refKindsNamed = (nodes: Record<string, unknown>[], name: string) =>
  nodes.filter((n) => n.kind === "ref" && n.name === name).map((n) => n.refKind);

describe("a binding named `id` shadows the implicit aggregate identity (F-025)", () => {
  it("a workflow `create` parameter named `id` lowers to a param ref, not the identity marker", async () => {
    const model = await buildLoomModel(`
context Work {
  aggregate WorkOrder {
    title: string
    done: bool
    operation close() { done := true }
  }
  repository WorkOrders for WorkOrder { }
  workflow closeOrder {
    create(id: WorkOrder id) {
      let wo = WorkOrders.getById(id)
      wo.close()
    }
  }
}
`);
    const wf = model.contexts.flatMap((c) => c.workflows ?? []).find((w) => w.name === "closeOrder");
    const nodes = everyNode(wf?.statements ?? []);

    // The defect: the argument lowered to the implicit-identity marker, which
    // every backend renders as `this._id` / `self._id` — inside a module-level
    // function with no receiver.
    expect(identityMarkers(nodes)).toEqual([]);
    // What it must be instead.
    expect(refKindsNamed(nodes, "id")).toEqual(["param"]);
  });

  it("an aggregate operation parameter named `id` shadows the aggregate's own id", async () => {
    const model = await buildLoomModel(`
context Work {
  aggregate WorkOrder {
    title: string
    trace: string
    operation record(id: string) { trace := id }
  }
  repository WorkOrders for WorkOrder { }
}
`);
    const agg = model.contexts.flatMap((c) => c.aggregates).find((a) => a.name === "WorkOrder");
    const op = agg?.operations.find((o) => o.name === "record");
    const nodes = everyNode(op?.statements ?? []);
    expect(nodes.length).toBeGreaterThan(0);
    expect(identityMarkers(nodes)).toEqual([]);
    expect(refKindsNamed(nodes, "id")).toEqual(["param"]);
  });

  it("with NOTHING bound, `id` keeps its magic meaning inside an aggregate", async () => {
    const model = await buildLoomModel(`
context Work {
  aggregate WorkOrder {
    title: string
    trace: string
    operation mark() { trace := string(id) }
  }
  repository WorkOrders for WorkOrder { }
}
`);
    const agg = model.contexts.flatMap((c) => c.aggregates).find((a) => a.name === "WorkOrder");
    const op = agg?.operations.find((o) => o.name === "mark");
    // The fix SHADOWS the marker, it does not remove it: an aggregate body that
    // binds nothing named `id` still means `this.id`.
    expect(identityMarkers(everyNode(op?.statements ?? []))).toHaveLength(1);
  });

  it("a parameter named after a declared member shadows it too (the same rule, already held)", async () => {
    const model = await buildLoomModel(`
context Work {
  aggregate WorkOrder {
    title: string
    trace: string
    operation retitle(title: string) { trace := title }
  }
  repository WorkOrders for WorkOrder { }
}
`);
    const agg = model.contexts.flatMap((c) => c.aggregates).find((a) => a.name === "WorkOrder");
    const op = agg?.operations.find((o) => o.name === "retitle");
    expect(refKindsNamed(everyNode(op?.statements ?? []), "title")).toEqual(["param"]);
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — the emitted code, on every backend that executes domain logic.
// ---------------------------------------------------------------------------

const FIVE_BACKENDS = `
system IdShadow {
  subdomain Ops {
    context Work {
      aggregate WorkOrder {
        title: string
        done: bool
        operation close() { done := true }
      }
      repository WorkOrders for WorkOrder { }
      workflow closeOrder {
        create(id: WorkOrder id) {
          let wo = WorkOrders.getById(id)
          wo.close()
        }
      }
    }
  }
  storage pg { type: postgres }
  resource workState { for: Work, kind: state, use: pg }
  api WorkApi from Ops
  deployable honoApi    { platform: node   contexts: [Work] dataSources: [workState] serves: WorkApi port: 3000 }
  deployable dotnetApi  { platform: dotnet contexts: [Work] dataSources: [workState] serves: WorkApi port: 8080 }
  deployable javaApi    { platform: java   contexts: [Work] dataSources: [workState] serves: WorkApi port: 8081 }
  deployable pyApi      { platform: python contexts: [Work] dataSources: [workState] serves: WorkApi port: 8000 }
  deployable phoenixApi { platform: elixir contexts: [Work] dataSources: [workState] serves: WorkApi port: 4000 }
}
`;

/** How each backend spells an implicit-receiver access — the rendering of the
 *  `{kind:"id"}` marker.  Every backend's `id` leaf is `<thisName>.<idAccessor>`
 *  with a `this._id` / `self._id` special case (see each `render-expr.ts`), and
 *  `thisName` is the receiver the emitter assumes: `this` (TS/.NET/Java),
 *  `self` (Python), `record` (Phoenix).  A workflow body is a module-level
 *  function / static handler, so NONE of those are bound in it.
 *
 *  The Phoenix spelling is why this is a pattern over receivers rather than a
 *  list of literals: under the seeded defect Phoenix emits
 *  `Context.get_work_order(record.id)`, which an earlier draft of this regex —
 *  `this._id|self._id|this.Id` — read as clean. */
const UNBOUND_RECEIVER = /this\._id|self\._id|\b(?:this|self|record)\.(?:_?id|_?Id)\b/;

/** One entry per deployable in `FIVE_BACKENDS`: the emitted directory prefix
 *  (`serviceSlug` of the deployable name) and how THAT backend renders the one
 *  statement under test — `let wo = WorkOrders.getById(id)`.
 *
 *  Spelled per backend rather than as one loose pattern because the two loose
 *  attempts each went blind on a different backend.  Matching `getById(` /
 *  `get_by_id(` never reached Phoenix, which renders the read as a context
 *  function.  Widening to every file with "workflow" in its path instead swept
 *  in the Phoenix controller's serializer — `"id" => record.id` over a bound
 *  `record` parameter — and reported the FIXED tree as broken.  The coverage
 *  assertion below is what turns a third such omission into a failure. */
const BACKENDS: readonly { dir: string; read: RegExp }[] = [
  { dir: "hono_api/", read: /workOrders\.getById\(/ },
  { dir: "dotnet_api/", read: /_?workOrders\.GetByIdAsync\(/i },
  { dir: "java_api/", read: /workOrdersRepository\.getById\(/ },
  { dir: "py_api/", read: /work_orders\.get_by_id\(/ },
  { dir: "phoenix_api/", read: /Context\.get_work_order\(/ },
];

describe("the emitted workflow binds the `id` parameter on every backend (F-025)", () => {
  it("no backend renders an implicit receiver where the parameter was meant", async () => {
    const files = await generateSystemFiles(FIVE_BACKENDS);

    const offenders: string[] = [];
    const covered = new Set<string>();
    for (const [path, content] of files) {
      const backend = BACKENDS.find((b) => path.startsWith(b.dir));
      if (!backend) continue;
      for (const line of content.split("\n")) {
        if (!backend.read.test(line)) continue;
        covered.add(backend.dir);
        if (UNBOUND_RECEIVER.test(line)) offenders.push(`${path}: ${line.trim()}`);
      }
    }

    // The gate must actually REACH every backend's lowered read — a leg that
    // inspected four of five would pass on a fifth it never looked at
    // (experience_gathered.md §59/§63).
    expect([...covered].sort()).toEqual(BACKENDS.map((b) => b.dir).sort());
    expect(offenders).toEqual([]);
  });
});
