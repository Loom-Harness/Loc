// OpenAPI request-component name collisions (eval finding F-026).
//
// TWO independent rules mint request-component names, and they can produce the
// same string without any name being shared between the two declarations:
//
//   * an aggregate operation  → `<Op><Agg>Request`
//   * a workflow              → `<Workflow>Request`
//
// So `operation schedule(at: string)` on `WorkOrder` and `workflow
// scheduleWorkOrder` both spell `ScheduleWorkOrderRequest`.  Neither rule is
// wrong alone; nothing checked that the two halves of one namespace agree
// (`experience_gathered.md` §89's class).
//
// Unlike the .NET case (F14 — Swashbuckle THROWS and the whole document 500s),
// `@hono/zod-openapi` publishes the document happily: both endpoints end up
// `$ref`-ing ONE component, and the survivor carries the workflow's shape.  The
// operation endpoint is therefore PUBLISHED as requiring a body it rejects — the
// silent class.  Measured on the generated Java app (same two rules, springdoc,
// same collapse): POSTing the shape the spec publishes answers 422, the shape
// the code wants answers 204.  Runtime binding was never wrong; the contract was.
//
// The fix adopts the convention .NET already publishes
// (`src/generator/dotnet/schema-ids.ts`) rather than inventing a third
// spelling, and both halves are pinned below: the collision is qualified, AND a
// collision-free model keeps today's short names, so the component set stays
// comparable with the backends that never collided (the shape
// `.loom/wire-spec.json` and the conformance-parity gate compare).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baseRequestComponentName,
  resolveRequestComponentNames,
} from "../../../src/generator/_openapi/request-component-names.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// `operation schedule` on `WorkOrder` + `workflow scheduleWorkOrder`: the
// F-026 reproduction, verbatim from `eval-fieldops/repro/f026/`.
const COLLIDING_SRC = `system Probe {
  subdomain Ops {
    context Work {
      aggregate WorkOrder with crudish {
        title: string
        scheduled: bool

        operation schedule(at: string) {
          this.scheduled := true
        }
      }
      repository WorkOrders for WorkOrder { }

      workflow scheduleWorkOrder {
        create(note: string) {
          let w = WorkOrder.create({ title: note, scheduled: false })
        }
      }
    }
  }
  storage p { type: postgres }
  resource r { for: Work, kind: state, use: p }
  deployable api { platform: node, contexts: [Work], dataSources: [r], port: 3000 }
}`;

// The same model with the workflow renamed so no two owners mint one name —
// nothing may be qualified here.
const COLLISION_FREE_SRC = COLLIDING_SRC.replaceAll("scheduleWorkOrder", "bookWorkOrder");

async function honoApiFiles(src: string): Promise<Map<string, string>> {
  const files = await generateSystemFiles(src);
  return new Map(
    [...files].flatMap(([p, c]) => (p.startsWith("api/") ? ([[p, c]] as [string, string][]) : [])),
  );
}

describe("request-component names (F-026)", () => {
  it("owner-qualifies BOTH halves of a genuine collision", async () => {
    const files = await honoApiFiles(COLLIDING_SRC);
    const routes = files.get("api/http/workOrder.routes.ts") ?? "";
    const workflows = files.get("api/http/workflows.ts") ?? "";
    expect(routes).not.toBe("");
    expect(workflows).not.toBe("");

    // The qualifiers are .NET's: the aggregate PLURAL for an operation, the
    // literal `Workflows` for a workflow — so a fixed node backend AGREES with
    // the ids .NET already publishes instead of minting a third convention.
    expect(routes).toContain('}).openapi("WorkOrdersScheduleWorkOrderRequest");');
    expect(workflows).toContain('}).openapi("WorkflowsScheduleWorkOrderRequest");');

    // The component name is ALSO the emitted const identifier and the `schema:`
    // reference in `createRoute`.  A fix that moved only the `.openapi()` label
    // would emit TypeScript that does not compile, so all three are pinned per
    // file — this is the assertion that fails if the three drift apart.
    for (const [file, name] of [
      [routes, "WorkOrdersScheduleWorkOrderRequest"],
      [workflows, "WorkflowsScheduleWorkOrderRequest"],
    ] as const) {
      expect(file).toContain(`const ${name} = z.object({`);
      expect(file).toContain(`}).openapi("${name}");`);
      expect(file).toContain(`schema: ${name} }`);
    }

    // The defect itself: neither file may still publish the bare name that the
    // other one also minted.
    expect(routes).not.toContain('openapi("ScheduleWorkOrderRequest")');
    expect(workflows).not.toContain('openapi("ScheduleWorkOrderRequest")');

    // Every request component the deployable publishes is unique — the point.
    const published = [...files.values()]
      .flatMap((c) => [...c.matchAll(/\.openapi\("(\w+Request)"\)/g)])
      .map((m) => m[1]);
    expect(published.length).toBeGreaterThan(2);
    expect(new Set(published).size).toBe(published.length);
  });

  it("leaves a collision-free model on today's short names", async () => {
    const files = await honoApiFiles(COLLISION_FREE_SRC);
    const routes = files.get("api/http/workOrder.routes.ts") ?? "";
    const workflows = files.get("api/http/workflows.ts") ?? "";

    expect(routes).toContain('}).openapi("ScheduleWorkOrderRequest");');
    expect(workflows).toContain('}).openapi("BookWorkOrderRequest");');
    expect(routes).not.toContain("WorkOrdersScheduleWorkOrderRequest");
    expect(workflows).not.toContain("Workflows");
  });

  it("keeps the non-colliding siblings of a collision short", async () => {
    // NARROW, per the .NET precedent: `create`/`update` on the same aggregate
    // are minted by the same rule as `schedule` and must not be dragged along.
    const routes = (await honoApiFiles(COLLIDING_SRC)).get("api/http/workOrder.routes.ts") ?? "";
    expect(routes).toContain('}).openapi("CreateWorkOrderRequest");');
    expect(routes).toContain('}).openapi("UpdateWorkOrderRequest");');
    expect(routes).not.toContain("WorkOrdersCreateWorkOrderRequest");
    expect(routes).not.toContain("WorkOrdersUpdateWorkOrderRequest");
  });
});

// A SHIPPED example collides — `web/src/examples/extern-showcase.ddd` declares
// `operation confirm() extern` on `Order` AND `workflow confirmOrder`, and CI's
// `generated-react-build.yml` matrix generates from it.  Measured on the
// pre-fix emitter, its node deployable wrote `const ConfirmOrderRequest` into
// BOTH `api/http/order.routes.ts` and `api/http/workflows.ts`, each
// `.openapi("ConfirmOrderRequest")` with a different shape.  Two files, so
// TypeScript compiled clean — only the OpenAPI registry collapsed, which is
// exactly why this shipped.  Pinned here on the real file rather than a
// synthetic model, so the regression is caught where a user meets it.
describe("shipped examples publish unique request components", () => {
  it("extern-showcase separates the op and workflow bodies", async () => {
    const src = readFileSync(
      resolve(import.meta.dirname, "../../../web/src/examples/extern-showcase.ddd"),
      "utf8",
    );
    const files = await generateSystemFiles(src);
    const routes = files.get("api/http/order.routes.ts") ?? "";
    const workflows = files.get("api/http/workflows.ts") ?? "";
    expect(routes).toContain('}).openapi("OrdersConfirmOrderRequest");');
    expect(workflows).toContain('}).openapi("WorkflowsConfirmOrderRequest");');
    expect(routes).not.toContain('openapi("ConfirmOrderRequest")');
    expect(workflows).not.toContain('openapi("ConfirmOrderRequest")');

    const published = [...files.values()]
      .flatMap((c) => [...c.matchAll(/\.openapi\("(\w+Request)"\)/g)])
      .map((m) => m[1]);
    expect(new Set(published).size).toBe(published.length);
  });
});

describe("resolveRequestComponentNames", () => {
  const op = (aggregate: string, operation: string) =>
    ({ kind: "operation", aggregate, operation }) as const;
  const wf = (workflow: string) => ({ kind: "workflow", workflow }) as const;

  it("is identity for a collision-free owner set", () => {
    const owners = [op("WorkOrder", "schedule"), op("WorkOrder", "cancel"), wf("bookWorkOrder")];
    const names = resolveRequestComponentNames(owners);
    for (const o of owners) {
      expect([...names.values()]).toContain(baseRequestComponentName(o));
    }
    expect([...names.values()].sort()).toEqual([
      "BookWorkOrderRequest",
      "CancelWorkOrderRequest",
      "ScheduleWorkOrderRequest",
    ]);
  });

  it("qualifies a three-way collision and keeps every id unique", () => {
    // `schedule` on `WorkOrder`, `scheduleWork` on `Order`, and workflow
    // `scheduleWorkOrder` all base-spell `ScheduleWorkOrderRequest`.
    const names = resolveRequestComponentNames([
      op("WorkOrder", "schedule"),
      op("Order", "scheduleWork"),
      wf("scheduleWorkOrder"),
    ]);
    expect(names.size).toBe(3);
    expect(new Set(names.values()).size).toBe(3);
    expect([...names.values()].sort()).toEqual([
      "OrdersScheduleWorkOrderRequest",
      "WorkOrdersScheduleWorkOrderRequest",
      "WorkflowsScheduleWorkOrderRequest",
    ]);
  });

  it("never lets a qualified id shadow a name that keeps its short form", () => {
    // `WorkOrders` is both a plural qualifier and — for an aggregate literally
    // named `WorkOrders` — a base-name stem.  Resolving the collision on
    // `ScheduleWorkOrderRequest` must not mint the name the OTHER owner keeps.
    const names = resolveRequestComponentNames([
      op("WorkOrder", "schedule"),
      wf("scheduleWorkOrder"),
      op("Request", "workOrdersScheduleWorkOrder"),
    ]);
    expect(new Set(names.values()).size).toBe(names.size);
  });

  it("dedupes a repeated owner instead of treating it as a collision", () => {
    // Both node builders ask for names; a caller listing an owner twice must
    // not make it collide with itself.
    const names = resolveRequestComponentNames([
      op("WorkOrder", "schedule"),
      op("WorkOrder", "schedule"),
    ]);
    expect([...names.values()]).toEqual(["ScheduleWorkOrderRequest"]);
  });
});
