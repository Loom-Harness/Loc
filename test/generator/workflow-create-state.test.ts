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
