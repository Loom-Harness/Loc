// Feliz form-record NAME COLLISIONS — F-017 Bug A.
//
// F# has no overloading for records: two `type XForm = { … }` declarations in
// one module are a hard `FS0037`, and the second SHADOWS the first, so every
// reference emitted after it resolves to the wrong record (`FS1129` /
// `FS0039` / `FS0764` on the fields that don't line up).  The generated
// project simply did not compile.
//
// The three form families are keyed by names the model author picks
// independently, and the old flat spellings put them in ONE namespace:
//
//     create     `<Agg>Form`          WorkOrder            → WorkOrderForm
//     operation  `<Op><Agg>Form`      WorkOrder.schedule   → ScheduleWorkOrderForm
//     workflow   `<Wf>Form`           scheduleWorkOrder    → ScheduleWorkOrderForm  ← collision
//
// A `<verb><Aggregate>` workflow beside a `<verb>` operation on that aggregate
// is an ORDINARY naming pattern (it is the one `docs/workflow.md`'s own
// examples use), so this was not an exotic model.  `wire.ts` now gives each
// family a distinct suffix (`…CreateForm` / `…OpForm` / `…WorkflowForm`), and
// no suffix is a suffix of another, so cross-family collision is impossible
// whatever the model calls things.
//
// Compile-proven: before the fix `dotnet build App.fsproj` on the COLLIDE
// system below reported 25 `error FS…`; after it, `Build succeeded`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** An operation form and a workflow form that used to share one record name.
 *  The two forms take DIFFERENT parameters on purpose — shadowing is then not
 *  merely a duplicate declaration but a wrong-fields error too. */
const COLLIDE = `
system Ops {
  api OpsApi from Work
  subdomain Work {
    context Maint {
      aggregate WorkOrder with crudish {
        title: string
        tech: string
        operation schedule(tech: string) { this.tech := tech }
      }
      repository WorkOrders for WorkOrder { }
      workflow scheduleWorkOrder {
        create(workOrder: string, technician: string) {
          let w = WorkOrder.create(title: workOrder, tech: technician)
        }
      }
    }
  }
  storage db { type: postgres }
  resource maintState { for: Maint, kind: state, use: db }
  ui WebApp {
    api Ops: OpsApi
    page Sched {
      route: "/sched/:id"
      body: Stack {
        OperationForm { of: WorkOrder, op: schedule },
        WorkflowForm { runs: scheduleWorkOrder }
      }
    }
  }
  deployable api { platform: node contexts: [Maint] dataSources: [maintState] serves: OpsApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Ops: api } port: 3005 }
}
`;

/** The create-form arm of the same class: a workflow named after the aggregate
 *  a `CreateForm` is built for (`workOrder` / `WorkOrder` → `WorkOrderForm`). */
const COLLIDE_CREATE = `
system Ops {
  api OpsApi from Work
  subdomain Work {
    context Maint {
      aggregate WorkOrder with crudish { title: string  tech: string }
      repository WorkOrders for WorkOrder { }
      workflow workOrder {
        create(summary: string) {
          let w = WorkOrder.create(title: summary, tech: "unassigned")
        }
      }
    }
  }
  storage db { type: postgres }
  resource maintState { for: Maint, kind: state, use: db }
  ui WebApp {
    api Ops: OpsApi
    page Sched {
      route: "/sched"
      body: Stack {
        CreateForm { of: WorkOrder },
        WorkflowForm { runs: workOrder }
      }
    }
  }
  deployable api { platform: node contexts: [Maint] dataSources: [maintState] serves: OpsApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Ops: api } port: 3005 }
}
`;

/** NON-VACUITY control — the same three form families on names that never
 *  collided.  Whatever the disambiguation scheme, this model must still emit
 *  exactly ONE record per form, wired to its own fields. */
const DISTINCT = `
system Ops {
  api OpsApi from Work
  subdomain Work {
    context Maint {
      aggregate WorkOrder with crudish {
        title: string
        tech: string
        operation assign(tech: string) { this.tech := tech }
      }
      repository WorkOrders for WorkOrder { }
      workflow bulkImport {
        create(source: string) {
          let w = WorkOrder.create(title: source, tech: "unassigned")
        }
      }
    }
  }
  storage db { type: postgres }
  resource maintState { for: Maint, kind: state, use: db }
  ui WebApp {
    api Ops: OpsApi
    page New {
      route: "/new"
      body: Stack {
        CreateForm { of: WorkOrder },
        WorkflowForm { runs: bulkImport }
      }
    }
    page Sched {
      route: "/sched/:id"
      body: Stack { OperationForm { of: WorkOrder, op: assign } }
    }
  }
  deployable api { platform: node contexts: [Maint] dataSources: [maintState] serves: OpsApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Ops: api } port: 3005 }
}
`;

async function appFs(src: string): Promise<string> {
  const files = await generateSystemFiles(src);
  return [...files.entries()].find(([p]) => p.endsWith("src/App.fs"))![1];
}

/** Every top-level `type <Name> =` declared in the emitted module, in order.
 *  This is the F# namespace `FS0037` polices, so a duplicate here IS the bug. */
function declaredTypes(app: string): string[] {
  return [...app.matchAll(/^type ([A-Za-z0-9_]+)\b/gm)].map((m) => m[1]);
}

/** Every `Msg` union case name (`  | SubmitFooForm of string` → `SubmitFooForm`). */
function msgCases(app: string): string[] {
  const start = app.indexOf("type Msg =");
  if (start < 0) return [];
  const rest = app.slice(start);
  const end = rest.search(/\n(?=type |let |module )/);
  return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/^\s*\| ([A-Za-z0-9_]+)/gm)].map(
    (m) => m[1],
  );
}

function duplicatesOf(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const n of names) (seen.has(n) ? dupes : seen).add(n);
  return [...dupes];
}

describe("feliz form-record name collisions", () => {
  it("gives an operation form and a same-named workflow form DISTINCT records", async () => {
    const app = await appFs(COLLIDE);
    // The old shared spelling is gone entirely — neither family answers to it.
    expect(app).not.toContain("type ScheduleWorkOrderForm =");
    expect(app).toContain("type ScheduleWorkOrderOpForm =");
    expect(app).toContain("type ScheduleWorkOrderWorkflowForm =");
    // …each carrying its OWN fields (the shadowing symptom was the workflow's
    // form setting the operation record's labels: FS1129 / FS0764).
    const op = app.slice(app.indexOf("type ScheduleWorkOrderOpForm ="));
    expect(op.slice(0, op.indexOf("\n\n"))).toContain("tech:");
    const wf = app.slice(app.indexOf("type ScheduleWorkOrderWorkflowForm ="));
    const wfBody = wf.slice(0, wf.indexOf("\n\n"));
    expect(wfBody).toContain("workOrder:");
    expect(wfBody).toContain("technician:");
  });

  it("declares no duplicate type, Model field or Msg case for the colliding pair", async () => {
    const app = await appFs(COLLIDE);
    expect(duplicatesOf(declaredTypes(app))).toEqual([]);
    expect(duplicatesOf(msgCases(app))).toEqual([]);
    // The Model record's own labels (`FS0037: Duplicate definition of field`).
    const model = app.slice(app.indexOf("type Model ="));
    const fields = [...model.slice(0, model.indexOf("\n\n")).matchAll(/^\s{4}([A-Za-z0-9_]+):/gm)];
    expect(duplicatesOf(fields.map((m) => m[1]))).toEqual([]);
  });

  it("gives a create form and a workflow form named after the aggregate DISTINCT records", async () => {
    const app = await appFs(COLLIDE_CREATE);
    expect(app).not.toContain("type WorkOrderForm =");
    expect(app).toContain("type WorkOrderCreateForm =");
    expect(app).toContain("type WorkOrderWorkflowForm =");
    expect(duplicatesOf(declaredTypes(app))).toEqual([]);
    expect(duplicatesOf(msgCases(app))).toEqual([]);
  });

  it("NON-VACUITY: a non-colliding model still emits exactly one record per form", async () => {
    const app = await appFs(DISTINCT);
    const types = declaredTypes(app);
    const count = (n: string) => types.filter((t) => t === n).length;
    expect(count("WorkOrderCreateForm")).toBe(1);
    expect(count("AssignWorkOrderOpForm")).toBe(1);
    expect(count("BulkImportWorkflowForm")).toBe(1);
    expect(duplicatesOf(types)).toEqual([]);
  });

  it("NON-VACUITY: each non-colliding form keeps its own full MVU wiring", async () => {
    const app = await appFs(DISTINCT);
    for (const [form, setter] of [
      ["WorkOrderCreateForm", "SetWorkOrderCreateFormTitle"],
      ["AssignWorkOrderOpForm", "SetAssignWorkOrderOpFormTech"],
      ["BulkImportWorkflowForm", "SetBulkImportWorkflowFormSource"],
    ] as const) {
      expect(app).toContain(`type ${form} =`);
      expect(app).toContain(`let empty${form} : ${form} =`);
      expect(app).toContain(`| Submit${form}`);
      expect(app).toContain(`| ${setter} of string`);
      expect(app).toContain(`${form}: ${form}`); // the Model field
    }
    // The result Msgs are family-suffixed too, so an op `Done` and a workflow
    // `Done` on the same stem cannot collide either.
    expect(app).toContain("| AssignWorkOrderOpDone of");
    expect(app).toContain("| BulkImportWorkflowDone of");
  });
});
