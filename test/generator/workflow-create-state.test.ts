// F58 / M-T6.60 — a command-triggered `create` on a STATE-BEARING workflow
// emitted an unbound receiver on all five backends.
//
//   workflow Fulfillment {
//     orderId: Order id            // correlation field
//     status: string               // saga state
//     create(orderId: Order id) { status := "Pending" }
//   }
//
// parses `0 error(s), 0 warning(s)` and emitted `this.status = "Pending"` inside
// a Hono arrow function (TS2683), `this.Status` on a .NET handler with no such
// member, `this.setStatus(...)` on a Java service class without it,
// `self._status` in a module-level python `async def`, and an unbound `state` in
// the Elixir `with`-chain.  Each backend already emitted the saga-state row
// (table, POCO/entity/Row/Ecto.Schema) and already loaded-or-allocated it
// correctly on the EVENT-triggered path — only the COMMAND path skipped it, so
// the row was never created either and a later `on` reactor logged
// `event_unrouted` forever.
//
// The fix threads the same load-or-allocate / bind / save-at-exit seam the
// reactor path uses (`thisName: "state"`) through the command route on every
// backend.  The correlation key is the create param that name-matches the
// correlation field — the command-side twin of the reactor's omitted-`by` rule.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const SRC = (deployable: string) => `
system Acme {
  subdomain Ops {
    context Fulfil {
      aggregate Order with crudish {
        sku: string
      }
      repository Orders for Order { }
      workflow Fulfillment {
        orderId: Order id
        status: string
        create(orderId: Order id) {
          status := "Pending"
        }
      }
    }
  }
  api FulfilApi from Ops
  storage primarySql { type: postgres }
  resource fState { for: Fulfil, kind: state, use: primarySql }
  deployable api {
    ${deployable}
    contexts: [Fulfil]
    dataSources: [fState]
    serves: FulfilApi
    port: 8080
  }
}
`;

const fileEndingWith = async (deployable: string, suffix: string): Promise<string> => {
  const files = await generateSystemFiles(SRC(deployable));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix))?.[1];
  expect(hit, `file ending ${suffix}`).toBeDefined();
  return hit as string;
};

describe("command-triggered create on a state-bearing workflow (F58)", () => {
  it("Hono binds the loaded saga row, not `this`", async () => {
    const wf = await fileEndingWith("platform: node", "http/workflows.ts");
    // The defect: `this` inside the route's arrow function.
    expect(wf).not.toContain("this.status");
    // Load-or-allocate keyed by the correlation param, then write through it.
    expect(wf).toContain("const state = (await loadFulfillment(db, orderId)) ??");
    expect(wf).toContain('state.status = "Pending";');
    // The row is persisted, so a later `on` reactor can route to it.
    expect(wf).toContain("await saveFulfillment(db, state);");
  });

  it(".NET binds the loaded saga row, not `this`", async () => {
    const handler = await fileEndingWith("platform: dotnet", "FulfillmentHandler.cs");
    expect(handler).not.toContain("this.Status");
    expect(handler).toContain("ISagaStateStore<FulfillmentState> _sagaState");
    expect(handler).toContain("var __key = command.OrderId;");
    expect(handler).toContain('state = new FulfillmentState { OrderId = __key, Status = "" };');
    expect(handler).toContain('state.Status = "Pending";');
    expect(handler).toContain("await _sagaState.SaveChangesAsync(cancellationToken);");
  });

  it("Java binds the loaded saga row, not `this`", async () => {
    const svc = await fileEndingWith("platform: java", "FulfilWorkflows.java");
    expect(svc).not.toContain("this.setStatus");
    expect(svc).toContain(
      "var state = fulfillmentStateRepository.findById(__key).orElseGet(() -> FulfillmentState._allocate(__key));",
    );
    expect(svc).toContain('state.setStatus("Pending");');
    expect(svc).toContain("fulfillmentStateRepository.save(state);");
  });

  it("Python binds the loaded saga row, not a module-level `self`", async () => {
    const wf = await fileEndingWith("platform: python", "workflows_routes.py");
    expect(wf).not.toContain("self._status");
    expect(wf).toContain("state = await _load_fulfillment(session, __key)");
    expect(wf).toContain('state.status = "Pending"');
  });

  it("Elixir binds the loaded saga row, not a free `state`", async () => {
    const wf = await fileEndingWith("platform: elixir", "workflows/fulfillment.ex");
    // The defect: `with state <- (%{state | status: "Pending"})` — the RHS
    // `state` was never bound anywhere in `run/1`.
    expect(wf).toContain('key = params["orderId"]');
    expect(wf).toContain("case Repo.get(Api.Fulfil.Workflows.FulfillmentState, key) do");
    expect(wf).toContain('with state <- (%{state | status: "Pending"})');
    expect(wf).toContain("Repo.update!");
  });
});

// ---------------------------------------------------------------------------
// Bycatch found while fixing F58: M-T6.50's own-state scratch for an
// UNCORRELATED command workflow (`self = SimpleNamespace(...)`) was emitted at
// the 4-space base while every other line of the route body sits at 8, inside a
// `try:`.  That is an `IndentationError` — the file never parsed, so the fix it
// shipped could never have run.  No gate saw it because no fixture pairs a
// state-bearing workflow with a python deployable.
const UNCORRELATED = `
system Acme {
  subdomain Ops {
    context Fulfil {
      aggregate Order with crudish {
        sku: string
      }
      repository Orders for Order { }
      workflow Fulfillment {
        note: string
        status: string
        create(sku: string) {
          status := "Pending"
        }
      }
    }
  }
  api FulfilApi from Ops
  storage primarySql { type: postgres }
  resource fState { for: Fulfil, kind: state, use: primarySql }
  deployable api {
    platform: python
    contexts: [Fulfil]
    dataSources: [fState]
    serves: FulfilApi
    port: 8080
  }
}
`;

describe("python own-state scratch for an uncorrelated command workflow", () => {
  it("is emitted at the route body's own indent, not one level out", async () => {
    const files = await generateSystemFiles(UNCORRELATED);
    const wf = [...files.entries()].find(([p]) => p.endsWith("workflows_routes.py"))?.[1];
    expect(wf).toBeDefined();
    // The defect: `    self = SimpleNamespace(...)` at the 4-space base inside
    // an 8-space `try:` block.
    expect(wf).not.toMatch(/\n {4}self = SimpleNamespace\(/);
    expect(wf).toContain('        self = SimpleNamespace(_note="", _status="")');
    // Every line of the route body sits at one consistent depth.
    expect(wf).toContain('        self._status = "Pending"');
  });
});

// ---------------------------------------------------------------------------
// The SECOND spelling of the correlation rule, and the residue the name-match
// rule above left behind (F58 / M-T6.62).
//
// `create start(order: Order id) { orderId := order … }` — the create takes a
// differently-named param and ASSIGNS the correlation field from it.  It is
// the shape `test/generator/workflow-instance-gate.test.ts` drives on all five
// backends, so the whole instance-gate matrix was asserting against output
// that does not compile:
//
//   node    `this.orderId = order;`             module-scope arrow (TS2683)
//   dotnet  `this.OrderId = command.Order;`     handler class, no such member
//   java    `this.setOrderId(order);`           service class, no such method
//   elixir  `%{state | order_id: order}`        `state` unbound (and `order`
//                                               too — the param destructure's
//                                               collector had no `assign` arm)
//   python  `self = SimpleNamespace(...)`       SILENT: the write landed in a
//                                               request-scoped scratch, the
//                                               saga row was never inserted,
//                                               and /instances stayed empty
//
// `commandCreateCorrelationParam` now accepts this spelling too (the key is a
// value already in hand before the body runs), so the same load-or-allocate /
// bind / save seam applies with no new emitter path.
const ASSIGNED = (deployable: string) => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish { code: string }
      repository Orders for Order { }
      workflow Fulfilment {
        orderId: Order id
        stage: string
        create start(order: Order id) {
          orderId := order
          stage := "started"
        }
      }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource ordersState { for: Orders, kind: state, use: pg }
  deployable d {
    ${deployable}
    contexts: [Orders]
    dataSources: [ordersState]
    serves: SalesApi
    port: 8080
  }
}
`;

const assignedFile = async (deployable: string, suffix: string): Promise<string> => {
  const files = await generateSystemFiles(ASSIGNED(deployable));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix))?.[1];
  expect(hit, `file ending ${suffix}`).toBeDefined();
  return hit as string;
};

describe("a create that ASSIGNS the correlation field from a param (F58 residue)", () => {
  it("Hono keys the row off the assigned param, not `this`", async () => {
    const wf = await assignedFile("platform: node", "http/workflows.ts");
    expect(wf).not.toContain("this.orderId");
    expect(wf).toContain("const state = (await loadFulfilment(db, order)) ??");
    expect(wf).toContain('state.stage = "started";');
    expect(wf).toContain("await saveFulfilment(db, state);");
  });

  it(".NET reads the key off the COMMAND PARAM, not the correlation field's name", async () => {
    const handler = await assignedFile("platform: dotnet", "FulfilmentHandler.cs");
    expect(handler).not.toContain("this.OrderId");
    // `FulfilmentCommand(OrderId Order)` has no `OrderId` member — emitting
    // `command.OrderId` here was a CS1061 on a project that otherwise built.
    expect(handler).toContain("var __key = command.Order;");
    expect(handler).not.toContain("var __key = command.OrderId;");
    // The state-side comparison still names the COLUMN.
    expect(handler).toContain("FindAsync(x => x.OrderId == __key");
    expect(handler).toContain("await _sagaState.SaveChangesAsync(cancellationToken);");
  });

  it("Java binds the loaded saga row, not `this`", async () => {
    const svc = await assignedFile("platform: java", "OrdersWorkflows.java");
    expect(svc).not.toContain("this.setOrderId");
    expect(svc).toContain(
      "var state = fulfilmentStateRepository.findById(__key).orElseGet(() -> FulfilmentState._allocate(__key));",
    );
    expect(svc).toContain('state.setStage("started");');
    expect(svc).toContain("fulfilmentStateRepository.save(state);");
  });

  it("Python writes the PERSISTED row, not a request-scoped scratch", async () => {
    const wf = await assignedFile("platform: python", "workflows_routes.py");
    // The silent half: a SimpleNamespace here meant the saga row was never
    // written and `/workflows/fulfilment/instances` answered empty forever.
    expect(wf).not.toContain("SimpleNamespace");
    expect(wf).toContain("state = await _load_fulfilment(session, __key)");
    expect(wf).toContain('state.stage = "started"');
  });

  it("Elixir binds BOTH the row and the param the assignment reads", async () => {
    const wf = await assignedFile("platform: elixir", "workflows/fulfilment.ex");
    // The param destructure — its collector had no `assign` arm, so `order`
    // was an undefined variable in the emitted `run/1`.
    expect(wf).toContain('%{"order" => order} = params');
    expect(wf).toContain('key = params["order"]');
    expect(wf).toContain("case Repo.get(D.Orders.Workflows.FulfilmentState, key) do");
    expect(wf).toContain("state = loom_state");
    expect(wf).toContain("Repo.update!");
  });
});
