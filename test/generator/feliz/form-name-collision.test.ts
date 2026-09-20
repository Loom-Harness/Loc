// Feliz mints every form record, `Msg` case and encoder into ONE flat F#
// module, from three families that each concatenate user names without a
// separator — `<Agg>Form`, `<Op><Agg>Form`, `<Wf>Form`.  They alias.
//
// `WorkOrder.schedule` beside `workflow scheduleWorkOrder` minted
// `ScheduleWorkOrderForm` TWICE, with different fields, from a model that
// validated `0 error(s), 0 warning(s)`; `dotnet build` answered with 31 errors
// (FS0037 duplicate type / Model field / union case, FS1129 + FS0039 on every
// site reading the loser's fields through the winner's record, FS0019 on a
// `Submit…Form` that took a route id at one definition and not the other).
//
// The gate is structural rather than textual: no emitted `type <X> =` may be
// declared twice, and no `Msg` union case may be declared twice — which is the
// property the F# compiler actually enforces, and which a future family minting
// into the same module would break in exactly the same way.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** An operation and a workflow whose preferred form names are the same string:
 *  `schedule` on `WorkOrder` → `ScheduleWorkOrderForm`, and
 *  `workflow scheduleWorkOrder` → `ScheduleWorkOrderForm`. */
const COLLIDING = `
system Field {
  api FieldApi from Ops
  subdomain Ops {
    context Work {
      aggregate Technician with crudish { name: string  derived display: string = name }
      repository Technicians for Technician { }
      aggregate WorkOrder with crudish {
        title: string
        technician: Technician id?
        scheduledAt: datetime?
        operation schedule(tech: Technician id, at: datetime) {
          technician  := tech
          scheduledAt := at
        }
      }
      repository WorkOrders for WorkOrder { }
      workflow scheduleWorkOrder {
        create(workOrder: WorkOrder id, technician: Technician id, at: datetime) {
          let wo = WorkOrders.getById(workOrder)
          wo.schedule(technician, at)
        }
      }
    }
  }
  storage db { type: postgres }
  resource workState { for: Work, kind: state, use: db }
  ui WebApp {
    api Field: FieldApi
    page Orders {
      route: "/orders"
      body: QueryView {
        of: Field.WorkOrder.all,
        loading: Text { "…" }, error: Text { "!" }, empty: Text { "0" },
        data: rows => Stack { For { each: rows, o => Card { o.title } } }
      }
    }
    page OrderSchedule {
      route: "/orders/:id/schedule"
      body: Stack { OperationForm { of: WorkOrder, op: schedule } }
    }
    page RunSchedule {
      route: "/run-schedule"
      body: Stack { WorkflowForm { runs: scheduleWorkOrder } }
    }
  }
  deployable api { platform: node contexts: [Work] dataSources: [workState] serves: FieldApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Field: api } port: 3005 }
}
`;

async function appFs(source: string): Promise<string> {
  const files = await generateSystemFiles(source);
  return [...files.entries()].find(([p]) => p.endsWith("src/App.fs"))![1];
}

/** Every record/DU type the module declares, in `type X =` / `and X =` form. */
function declaredTypes(fs: string): string[] {
  return [...fs.matchAll(/^(?:type|and) (\w+) =/gm)].map((m) => m[1] as string);
}

/** Every `Msg` union case the module declares — the `  | Case` lines inside the
 *  `type Msg =` block, which is where the duplicate `SubmitScheduleWorkOrderForm`
 *  and `ScheduleWorkOrderDone` landed. */
function msgCases(fs: string): string[] {
  const start = fs.indexOf("type Msg =");
  if (start < 0) return [];
  const rest = fs.slice(start);
  const end = rest.search(/\n(?:type|and|let) /);
  const block = end < 0 ? rest : rest.slice(0, end);
  return [...block.matchAll(/^\s*\| (\w+)/gm)].map((m) => m[1] as string);
}

function duplicates(names: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) dup.add(n);
    seen.add(n);
  }
  return [...dup].sort();
}

describe("feliz form-name collisions", () => {
  it("declares no type twice when an op form and a workflow form want one name", async () => {
    const fs = await appFs(COLLIDING);
    expect(duplicates(declaredTypes(fs))).toEqual([]);
  });

  it("declares no Msg case twice", async () => {
    const fs = await appFs(COLLIDING);
    expect(duplicates(msgCases(fs))).toEqual([]);
  });

  it("keeps the aggregate-derived spelling and yields the workflow's", async () => {
    const fs = await appFs(COLLIDING);
    // The operation form claims the historical name — every model without a
    // collision therefore emits byte-identically…
    expect(fs).toContain("type ScheduleWorkOrderForm =");
    // …and the workflow takes the kind-qualified alternative.
    expect(fs).toContain("type WorkflowScheduleWorkOrderForm =");
  });

  it("builds and reads each record through ONE field set", async () => {
    const fs = await appFs(COLLIDING);
    // The op form carries the OPERATION's params (`tech`), the workflow form
    // the WORKFLOW's (`technician`) — the mismatch the F# compiler reported as
    // "does not define a field … named 'technician'.  Maybe you want: tech".
    const opBlock = fs.slice(fs.indexOf("type ScheduleWorkOrderForm ="));
    expect(opBlock.slice(0, 200)).toContain("tech:");
    const wfBlock = fs.slice(fs.indexOf("type WorkflowScheduleWorkOrderForm ="));
    expect(wfBlock.slice(0, 200)).toContain("technician:");
  });
});
