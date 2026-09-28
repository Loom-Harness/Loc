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

// Phoenix: the collision landed on the FILE PATH as well as the name, and that
// is what made it destructive rather than merely confusing. Both render
// functions ran, but the operation schema went to
// `${snake(op)}_${snake(agg)}_request.ex` and the workflow's to
// `${snake(wf)}_request.ex` — the same path on a collision — and the workflow
// loop runs second, so `files.set` overwrote the operation's module. One module
// survived carrying the WORKFLOW's fields, and both `$ref`s in `<api>_spec.ex`
// pointed at it.
//
// Resolution is deployable-scoped here, not per context, because
// `<App>Web.Api.Schemas` is ONE namespace (and the schema dir one directory) for
// the whole deployable — a per-context scope would leave two hosted contexts
// free to collide inside it.
describe("phoenix request-component modules (F-026)", () => {
  const ELIXIR_SRC = `system Dispatch {
  subdomain Field {
    context Work {
      aggregate WorkOrder with crudish {
        title: string
        scheduled: bool

        operation schedule(at: string) {
          scheduled := true
        }
      }
      repository WorkOrders for WorkOrder { }

      workflow scheduleWorkOrder transactional {
        create(note: string) {
          let w = WorkOrder.create({ title: note, scheduled: false })
        }
      }
    }
  }
  api WorkApi from Field { }
  storage primary { type: postgres }
  resource workState { for: Work, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Work]
    dataSources: [workState]
    serves: WorkApi
    port: 4000
  }
}`;

  it("emits BOTH schema modules to distinct files, each with its own fields", async () => {
    const files = await generateSystemFiles(ELIXIR_SRC);
    const dir = "api/lib/api_web/api/schemas";
    const opFile = files.get(`${dir}/work_orders_schedule_work_order_request.ex`);
    const wfFile = files.get(`${dir}/workflows_schedule_work_order_request.ex`);

    // The defect: exactly one of these used to exist, under the shared path
    // `schedule_work_order_request.ex`, carrying the workflow's fields.
    expect(files.has(`${dir}/schedule_work_order_request.ex`)).toBe(false);
    expect(opFile).toBeDefined();
    expect(wfFile).toBeDefined();

    expect(opFile).toContain("defmodule ApiWeb.Api.Schemas.WorkOrdersScheduleWorkOrderRequest do");
    expect(wfFile).toContain("defmodule ApiWeb.Api.Schemas.WorkflowsScheduleWorkOrderRequest do");
    // Each carries its OWN params — the operation's `at`, the workflow's `note`.
    expect(opFile).toContain("required: [:at]");
    expect(wfFile).toContain("required: [:note]");
  });

  it("points each spec path at its own module, and every $ref resolves", async () => {
    const files = await generateSystemFiles(ELIXIR_SRC);
    const spec = [...files].find(([p]) => p.endsWith("_spec.ex"))?.[1] ?? "";
    expect(spec).not.toBe("");
    expect(spec).toContain("ApiWeb.Api.Schemas.WorkOrdersScheduleWorkOrderRequest");
    expect(spec).toContain("ApiWeb.Api.Schemas.WorkflowsScheduleWorkOrderRequest");

    // A renamed module the spec still references by its old name is a COMPILE
    // error, not a spec defect — so pin that every referenced schema module is
    // actually defined by some emitted file. This is the assertion that would
    // fail on a half-applied rename.
    const defined = new Set(
      [...files.values()]
        .flatMap((c) => [...c.matchAll(/defmodule (ApiWeb\.Api\.Schemas\.\w+) do/g)])
        .map((m) => m[1]),
    );
    const referenced = new Set([...spec.matchAll(/ApiWeb\.Api\.Schemas\.\w+/g)].map((m) => m[0]));
    expect([...referenced].filter((r) => !defined.has(r))).toEqual([]);
  });
});

// The canonical CREATE request is minted by its own rule and is NOT an
// `agg.operations` entry — measured, `agg.operations` for a `crudish` aggregate
// is `[schedule, update]` with no `create` in it, and every backend emits
// `Create<Agg>Request` from a separate path. The first version of this module
// enumerated owners from `agg.operations` alone and therefore never saw the
// create request, so a workflow named `create<Agg>` collided with it and nothing
// was qualified. That was a reachable instance of the very defect this module
// exists to close, so it is pinned here.
// Phoenix's create schema is emitted UNCONDITIONALLY (the schema loop has no
// gate; only the spec's reference to it is gated, on the derived create entry),
// so `create_<agg>_request.ex` is an occupied path whether or not the document
// links to it. That is why the elixir owner list carries a create owner for
// every aggregate rather than gating on `emitsRestCreate` the way the Hono side
// does: the minter's contract is "the owners this backend actually publishes",
// and a path is occupied either way.
describe("phoenix create request is an owner too (F-026)", () => {
  const ELIXIR_CREATE_COLLIDES = `system P {
  subdomain S {
    context C {
      aggregate WorkOrder with crudish {
        title: string
        scheduled: bool
        operation schedule(at: string) { scheduled := true }
      }
      repository WorkOrders for WorkOrder { }
      workflow createWorkOrder {
        create(note: string) { let w = WorkOrder.create({ title: note, scheduled: false }) }
      }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: elixir, contexts: [C], dataSources: [r], port: 4000 }
}`;

  it("splits the create schema from a workflow named create<Agg>", async () => {
    const files = await generateSystemFiles(ELIXIR_CREATE_COLLIDES);
    const dir = "api/lib/api_web/api/schemas";

    // The defect: one `create_work_order_request.ex`, carrying whichever the
    // second loop wrote.
    expect(files.has(`${dir}/create_work_order_request.ex`)).toBe(false);
    const aggFile = files.get(`${dir}/work_orders_create_work_order_request.ex`);
    const wfFile = files.get(`${dir}/workflows_create_work_order_request.ex`);
    expect(aggFile).toBeDefined();
    expect(wfFile).toBeDefined();
    expect(aggFile).toContain("defmodule ApiWeb.Api.Schemas.WorkOrdersCreateWorkOrderRequest do");
    expect(wfFile).toContain("defmodule ApiWeb.Api.Schemas.WorkflowsCreateWorkOrderRequest do");
    // Each carries its own input: the aggregate's create field, the workflow's param.
    expect(aggFile).toContain("required: [:title]");
    expect(wfFile).toContain("required: [:note]");

    // `schedule` / `update` do not collide here, so they keep short names.
    expect(files.has(`${dir}/schedule_work_order_request.ex`)).toBe(true);
    expect(files.has(`${dir}/update_work_order_request.ex`)).toBe(true);

    // Every schema module the spec references must exist, or the app will not
    // compile — the assertion a renamed-but-unreferenced module fails.
    const spec = [...files].find(([p]) => p.endsWith("_spec.ex"))?.[1] ?? "";
    const defined = new Set(
      [...files.values()]
        .flatMap((c) => [...c.matchAll(/defmodule (ApiWeb\.Api\.Schemas\.\w+) do/g)])
        .map((m) => m[1]),
    );
    const referenced = new Set([...spec.matchAll(/ApiWeb\.Api\.Schemas\.\w+/g)].map((m) => m[0]));
    expect([...referenced].filter((r) => !defined.has(r))).toEqual([]);
  });
});

describe("the create request is an owner too (F-026)", () => {
  const CREATE_COLLIDES = `system P {
  subdomain S {
    context C {
      aggregate WorkOrder with crudish {
        title: string
        scheduled: bool
        operation schedule(at: string) { scheduled := true }
      }
      repository WorkOrders for WorkOrder { }
      workflow createWorkOrder {
        create(note: string) { let w = WorkOrder.create({ title: note, scheduled: false }) }
      }
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}`;

  it("qualifies Create<Agg>Request against a workflow named create<Agg>", async () => {
    const files = await generateSystemFiles(CREATE_COLLIDES);
    const routes = files.get("api/http/workOrder.routes.ts") ?? "";
    const workflows = files.get("api/http/workflows.ts") ?? "";

    expect(routes).toContain('}).openapi("WorkOrdersCreateWorkOrderRequest");');
    expect(workflows).toContain('}).openapi("WorkflowsCreateWorkOrderRequest");');
    // Neither side may still publish the bare name the other also minted.
    expect(routes).not.toContain('openapi("CreateWorkOrderRequest")');
    expect(workflows).not.toContain('openapi("CreateWorkOrderRequest")');
    // The const identifier and the `schema:` reference move with the label, or
    // the emitted TypeScript does not compile.
    expect(routes).toContain("const WorkOrdersCreateWorkOrderRequest = z.object({");
    expect(routes).toContain("schema: WorkOrdersCreateWorkOrderRequest }");

    // `schedule` does NOT collide in this model, so it stays short — the narrow
    // property, checked on the same document as a real collision.
    expect(routes).toContain('}).openapi("ScheduleWorkOrderRequest");');
    expect(routes).toContain('}).openapi("UpdateWorkOrderRequest");');

    const published = [...files.values()]
      .flatMap((c) => [...c.matchAll(/\.openapi\("(\w+Request)"\)/g)])
      .map((m) => m[1]);
    expect(new Set(published).size).toBe(published.length);
  });

  it("does not invent a create owner for an aggregate with no REST create", () => {
    // Gated by the shared `emitsRestCreate` predicate: listing a create owner
    // that is never emitted would qualify a workflow that never clashed.
    const names = resolveRequestComponentNames([
      { kind: "workflow", workflow: "createWorkOrder" },
      { kind: "operation", aggregate: "WorkOrder", operation: "schedule" },
    ]);
    expect([...names.values()].sort()).toEqual([
      "CreateWorkOrderRequest",
      "ScheduleWorkOrderRequest",
    ]);
  });

  it("qualifies a create/workflow collision with the aggregate plural", () => {
    const names = resolveRequestComponentNames([
      { kind: "create", aggregate: "WorkOrder" },
      { kind: "workflow", workflow: "createWorkOrder" },
    ]);
    expect([...names.values()].sort()).toEqual([
      "WorkOrdersCreateWorkOrderRequest",
      "WorkflowsCreateWorkOrderRequest",
    ]);
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

// Java is the third shape this defect takes, and the one that cannot be fixed
// by renaming. `ScheduleWorkOrderRequest` is part of the GENERATED code's own
// API — the controller binds it, the service takes it — so only the PUBLISHED
// name may diverge, via springdoc's `@Schema(name = ...)` (the analogue of
// .NET's `CustomSchemaIds`). The class name stays put.
//
// The customizer's `RequiredSet` table is the other half of the same bug: it is
// keyed by PUBLISHED name, so pre-fix a collision made two `setRequired` calls
// target one key and the survivor reinforced the wrong field set for BOTH
// endpoints. Distinct published names split the table too.
describe("java request components (F-026)", () => {
  const JAVA_COLLIDES = COLLIDING_SRC.replace(
    "deployable api { platform: node, contexts: [Work], dataSources: [r], port: 3000 }",
    "deployable api { platform: java, contexts: [Work], dataSources: [r], port: 8080 }",
  );
  const JAVA_CLEAN = JAVA_COLLIDES.replaceAll("scheduleWorkOrder", "bookWorkOrder");

  const SRC_ROOT = "api/src/main/java/com/loom/api";
  const AGG_REQ = `${SRC_ROOT}/features/workorders/ScheduleWorkOrderRequest.java`;
  const WF_REQ = `${SRC_ROOT}/application/workflows/ScheduleWorkOrderRequest.java`;

  it("publishes each colliding record under an owner-qualified name, keeping the class name", async () => {
    const files = await generateSystemFiles(JAVA_COLLIDES);
    const agg = files.get(AGG_REQ);
    const wf = files.get(WF_REQ);
    expect(agg).toBeDefined();
    expect(wf).toBeDefined();

    // The class name is load-bearing for the generated code, so it is UNCHANGED
    // on both — the divergence is entirely in the published name.
    expect(agg).toContain("public record ScheduleWorkOrderRequest(");
    expect(wf).toContain("public record ScheduleWorkOrderRequest(");

    expect(agg).toContain('@Schema(name = "WorkOrdersScheduleWorkOrderRequest")');
    expect(wf).toContain('@Schema(name = "WorkflowsScheduleWorkOrderRequest")');
    // The annotation is worthless without its import.
    for (const c of [agg, wf]) {
      expect(c).toContain("import io.swagger.v3.oas.annotations.media.Schema;");
    }

    // Each keeps its own field set — the aggregate operation's param vs the
    // workflow's. If the two had been conflated, these would match.
    expect(agg).toContain("String at");
    expect(wf).toContain("String note");
  });

  it("leaves a non-colliding record's published name alone", async () => {
    const files = await generateSystemFiles(JAVA_CLEAN);
    const agg = files.get(AGG_REQ);
    const wf = files.get(`${SRC_ROOT}/application/workflows/BookWorkOrderRequest.java`);
    expect(agg).toBeDefined();
    expect(wf).toBeDefined();
    // No collision => no qualification, and so no annotation and no import: the
    // fix must be inert on every model that did not have the bug.
    for (const c of [agg, wf]) {
      expect(c).not.toContain("@Schema(name =");
      expect(c).not.toContain("import io.swagger.v3.oas.annotations.media.Schema;");
    }
  });

  it("gives the customizer's required-set table one entry per owner", async () => {
    const files = await generateSystemFiles(JAVA_COLLIDES);
    const customizer = files.get(`${SRC_ROOT}/config/OpenApiContractCustomizer.java`) ?? "";
    const rows = [...customizer.matchAll(/new RequiredSet\("(\w+)", List\.of\(([^)]*)\)\)/g)].map(
      (m) => [m[1], m[2]] as const,
    );

    // Pre-fix both `setRequired` calls keyed on `ScheduleWorkOrderRequest`, so
    // the table held ONE row for two endpoints with different required fields.
    const keys = rows.map(([k]) => k);
    expect(keys).not.toContain("ScheduleWorkOrderRequest");
    expect(keys).toContain("WorkOrdersScheduleWorkOrderRequest");
    expect(keys).toContain("WorkflowsScheduleWorkOrderRequest");

    const byKey = new Map(rows);
    expect(byKey.get("WorkOrdersScheduleWorkOrderRequest")).toContain('"at"');
    expect(byKey.get("WorkflowsScheduleWorkOrderRequest")).toContain('"note"');

    // A duplicate key means the later row silently wins at runtime.
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("publishes a unique name for every request record in the tree", async () => {
    const files = await generateSystemFiles(JAVA_COLLIDES);
    // springdoc computes the document at runtime, so the static proxy for
    // "no two components collide" is: the published name of every emitted
    // request record — the `@Schema(name=)` override when present, else the
    // class name — is distinct.
    const published: string[] = [];
    for (const [path, content] of files) {
      if (!path.startsWith(`${SRC_ROOT}/`) || !path.endsWith("Request.java")) continue;
      const cls = /public record (\w+)\(/.exec(content)?.[1];
      if (!cls) continue;
      published.push(/@Schema\(name = "(\w+)"\)/.exec(content)?.[1] ?? cls);
    }
    expect(published.length).toBeGreaterThan(1);
    const dupes = published.filter((n, i) => published.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });
});
