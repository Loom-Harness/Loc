// Vanilla foundation — workflow-instance read endpoints (vanilla-foundation
// -tdd-plan.md slice 5; workflow-instance-visibility.md).
//
// This is the slice that retires the deferred-Phoenix workflow-instance-views
// gap.  On `foundation: vanilla` a correlation-bearing workflow gets:
//   - a saga-state Ecto schema (already plain Ecto on the ash path — reused),
//   - a `WorkflowInstancesController` reading it via the app Repo
//     (`Repo.all` / `Repo.get`) and projecting the cross-backend
//     `instanceWireShape` (camelCase keys ← snake struct fields),
//   - `GET /api/workflows/<snake>/instances` + `.../instances/:id` routes.
// No Ash anywhere — the read is a plain `from … |> Repo.all` analogue, exactly
// as the visibility proposal promised for the vanilla path.

import { describe, expect, it } from "vitest";
import { emitVanillaWorkflowInstances } from "../../../src/generator/elixir/vanilla/workflow-instances-emit.js";
import type { EnrichedBoundedContextIR, WorkflowIR } from "../../../src/ir/types/loom-ir.js";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

function ctxWith(workflows: WorkflowIR[]): EnrichedBoundedContextIR {
  return {
    name: "Fulfillment",
    enums: [],
    valueObjects: [],
    events: [],
    aggregates: [],
    repositories: [],
    workflows,
    views: [],
    eventSubscriptions: [],
  } as unknown as EnrichedBoundedContextIR;
}

function emit(workflows: WorkflowIR[]): {
  out: Map<string, string>;
  routes: ReturnType<typeof emitVanillaWorkflowInstances>;
} {
  const out = new Map<string, string>();
  const routes = emitVanillaWorkflowInstances("acme", "Acme", ctxWith(workflows), out);
  return { out, routes };
}

describe("vanilla foundation — workflow-instance read endpoints", () => {
  it("emits nothing controller-side when no workflow is observable", () => {
    const { out, routes } = emit([]);
    expect(routes).toEqual([]);
    expect(out.has("lib/acme_web/controllers/workflow_instances_controller.ex")).toBe(false);
  });

  it("wires through the full pipeline (parse → lower → generateSystems)", async () => {
    const SRC = `
      system Sys {
        subdomain F {
          context F {
            aggregate Order { customerId: string  status: string  total: int }
            repository Orders for Order {}
            aggregate Shipment {
              orderRef: Order id
              status: string
              operation markTracked() { status := "Tracked" }
            }
            repository Shipments for Shipment {}
            event OrderPlaced { order: Order id, at: datetime }
            event ShipmentRequested { shipment: Shipment id, order: Order id, at: datetime }
            workflow OrderFulfillment {
              orderId: Order id
              attempts: int
              create(p: OrderPlaced) by p.order {
                let ship = Shipment.create({ orderRef: p.order, status: "Pending" })
                emit ShipmentRequested { shipment: ship.id, order: p.order, at: now() }
              }
              on(s: ShipmentRequested) by s.order {
                let ship = Shipments.getById(s.shipment)
                ship.markTracked()
              }
            }
          }
        }
        storage primary { type: postgres }
        resource fState { for: F, kind: state, use: primary }
        deployable api { platform: elixir  contexts: [F]  dataSources: [fState]  port: 4000 }
      }
    `;
    const { model } = await parseString(SRC, { validate: false });
    const files = generateSystems(model).files;
    const keys = [...files.keys()];
    const schema = keys.find((k) => k.endsWith("/workflows/order_fulfillment_state.ex"));
    const ctrl = keys.find((k) => k.endsWith("/controllers/workflow_instances_controller.ex"));
    const router = keys.find((k) => k.endsWith("_web/router.ex"));
    expect(schema, "saga-state schema not emitted").toBeDefined();
    expect(ctrl, "instances controller not emitted").toBeDefined();
    expect(files.get(ctrl!)!).not.toContain("Ash");
    expect(files.get(router!)!).toContain("/workflows/order_fulfillment/instances");
  });
});

// ---------------------------------------------------------------------------
// The instance LIST is a bare array — the shape this backend's own OpenAPI
// spec already declares, and the shape the other four backends serve.
//
// Phoenix wrapped it: `json(conn, %{data: data})`, i.e. `{"data": [...]}`,
// while `renderWorkflowInstanceListResponseSchema` emitted
// `type: :array` for the very same endpoint.  The backend disagreed with
// ITSELF, which is why the spec-diffing conformance-parity gate stayed green —
// the spec was right, only the runtime was wrong.
//
// It surfaced instead in `channels-e2e`, whose elixir leg reads
// `GET /api/workflows/fulfil/instances` and calls `.some(...)` on the body.
// On a wrapper that throws, the suite's probe swallows it, and the failure
// arrives 10s later as an unexplained "timed out waiting for correlated Fulfil
// instance" — the delivery half having already passed.
//
//   node    httpCtx.json(rows)                      → [...]
//   python  return [{"orderId": row.order_id} …]    → [...]
//   java    public List<FulfilInstanceResponse> …   → [...]
//   elixir  json(conn, %{data: data})               → {"data": [...]}   ← was
// ---------------------------------------------------------------------------

describe("workflow-instance LIST wire shape", () => {
  const SRC = `
  system Api {
    subdomain F { context F {
      aggregate Order with crudish { code: string }
      repository Orders for Order {}
      workflow OrderFulfillment {
        orderId: Order id
        create(code: string) { let o = Order.create({ code: code }) }
      }
    } }
    api A from F
    storage pg { type: postgres }
    resource fState { for: F, kind: state, use: pg }
    deployable api { platform: elixir  contexts: [F]  serves: A  dataSources: [fState]  port: 4000 }
  }`;

  it("agrees with the array-typed list schema this backend emits for it", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const files = generateSystems(model).files;
    const schemaKey = [...files.keys()].find((k) =>
      k.endsWith("order_fulfillment_instance_list_response.ex"),
    );
    expect(schemaKey, "instance list-response schema not emitted").toBeDefined();
    // Spec says array; the controller above must therefore send an array.
    expect(files.get(schemaKey!)!).toContain("type: :array");
  });
});
