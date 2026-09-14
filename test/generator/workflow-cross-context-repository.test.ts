// Cross-backend regression for `loom.workflow-cross-context-repository`
// (the emitted-output half; the validator half is
// `test/ir/workflow-cross-context-repository.test.ts`).
//
// THE SHAPE.  A `workflow` in context `Dispatch` whose body loads through
// context `Directory`'s repository.  `lowerWorkflow` indexes the repositories
// it resolves `let` reads against from the ENCLOSING context's members alone,
// so `matchRepoCall` declines the foreign name and the statement never becomes
// a `repo-let` `WorkflowStmtIR` — it falls through to the generic `expr-let`
// arm, leaving the receiver as a `ref` with `refKind: "unknown"`.  Consequences,
// all silent before the gate: the `repo-let` case's own
// `loom.workflow-unknown-repository` branch is unreachable, no backend
// instantiates the repository or awaits the call, and every backend renders the
// unresolved receiver VERBATIM.
//
// The give-away is the SAME-CONTEXT sibling `let wo = WorkOrders.getById(...)`
// in the same body, two lines down: it lowers to a real `repo-let`, gets its
// repository constructed and its call awaited.  The two lines sit next to each
// other in the emitted file, one correct and one dangling.
//
// This test does two things, in this order — the structure the
// `domain-service-cross-context-read` twin established:
//
//   1. proves the emission is genuinely broken on ALL FIVE backends (the
//      evidence that makes this a model-level gate rather than five per-backend
//      fixes), and
//   2. proves phase ⑦ rejects the model, so no user reaches that emission.
//
// `generateSystemFiles` asserts phase ⑦, so the emission legs go through
// `generateSystemFilesUnchecked`: emitting from the model the gate rejects IS
// their subject.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFilesUnchecked } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

/** Both contexts ride ONE deployable over ONE database, so this is not a
 *  distribution question — the two contexts compile into the same project,
 *  share one transaction, and the name STILL does not resolve. */
const SRC = (platform: string) => `
system CrossContextTest {
  subdomain Core {
    context Directory {
      aggregate Technician with crudish { skills: string[] }
      repository Technicians for Technician { }
    }
    context Dispatch {
      aggregate WorkOrder with crudish {
        status: string
        operation assign() { status := "Assigned" }
      }
      repository WorkOrders for WorkOrder { }
      workflow scheduleWorkOrder transactional {
        create(workOrderId: WorkOrder id, assignTo: Technician id) {
          let tech = Technicians.getById(assignTo)
          let wo = WorkOrders.getById(workOrderId)
          precondition tech.skills.count > 0
          wo.assign()
        }
      }
    }
  }
  storage primary { type: postgres }
  resource dirState { for: Directory, kind: state, use: primary }
  resource dispState { for: Dispatch, kind: state, use: primary }
  deployable api { platform: ${platform}, contexts: [Directory, Dispatch], dataSources: [dirState, dispState], port: 3000 }
}
`;

const WHY =
  "the dangling cross-context emission loom.workflow-cross-context-repository stands in front of is the subject; the gate rejects this model by design";

/**
 * Per backend: the generated workflow file, the DANGLING statement it renders
 * for the cross-context read, and the same-context sibling that renders
 * correctly two lines below it.  Captured 2026-09-13 by generating this exact
 * system on each backend:
 *
 *   TS      `const tech = Technicians.getById(assignTo);` — no repository
 *           constructed, no `await`                          → TS2304.
 *   .NET    `var tech = Technicians.GetById(command.AssignTo);`  → CS0103.
 *   Java    `var tech = Technicians.getById(assignTo);`      → "cannot find
 *                                                                symbol".
 *   Python  `tech = Technicians.get_by_id(assign_to)`        → NameError (F821).
 *   Phoenix `with tech <- (technicians.get_by_id(assign_to)),` — the ref is
 *           snake-cased into a LOCAL that was never bound  → "undefined
 *                                                              variable".
 *
 * If a backend ever learns to emit a cross-context read for real, the gate is
 * what has to change first — this table is the evidence it rests on.
 */
const BACKENDS: {
  platform: string;
  file: string;
  dangling: string;
  /** The same-context `let` in the same body, emitted correctly. */
  sibling: string;
}[] = [
  {
    platform: "node",
    file: "api/http/workflows.ts",
    dangling: "const tech = Technicians.getById(assignTo);",
    sibling: "new WorkOrderRepository(",
  },
  {
    platform: "dotnet",
    file: "api/Application/Workflows/ScheduleWorkOrderHandler.cs",
    dangling: "var tech = Technicians.GetById(command.AssignTo);",
    sibling: "IWorkOrderRepository",
  },
  {
    platform: "java",
    file: "application/workflows/DispatchWorkflows.java",
    dangling: "var tech = Technicians.getById(assignTo);",
    sibling: "var wo = workOrdersRepository.getById(workOrderId);",
  },
  {
    platform: "python",
    file: "api/app/http/workflows_routes.py",
    dangling: "tech = Technicians.get_by_id(assign_to)",
    sibling: "WorkOrderRepository",
  },
  {
    platform: "elixir",
    file: "api/lib/api/dispatch/workflows/schedule_work_order.ex",
    dangling: "with tech <- (technicians.get_by_id(assign_to)),",
    // Phoenix routes the local load through the context module rather than the
    // repository directly — the contrast is the same: a resolved call vs an
    // unbound snake-cased local.
    sibling: "{:ok, wo} <- Context.get_work_order(work_order_id),",
  },
];

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) {
    throw new Error(`no generated file ending in ${suffix}; got:\n${[...files.keys()].join("\n")}`);
  }
  return files.get(key)!;
}

describe("workflow cross-context repository read — the emission the gate stands in front of", () => {
  for (const { platform, file, dangling, sibling } of BACKENDS) {
    it(`${platform} emits a dangling receiver for the cross-context read`, async () => {
      const out = bySuffix(await generateSystemFilesUnchecked(SRC(platform), WHY), file);
      expect(out).toContain(dangling);
      // Nothing in the file constructs, injects or imports the foreign
      // repository — that is what makes the line dangling rather than merely
      // oddly named.  (Matching on the repository DECLARATION name, which only
      // a real wiring line would carry.)
      const wiring = out
        .split("\n")
        .filter((l) => /Technician(Repository|Jpa|Service)|ITechnicianRepository/.test(l));
      expect(wiring).toEqual([]);
      // ...while the SAME-CONTEXT sibling two lines down is wired properly.
      // This is the contrast that makes the defect unambiguous: one body, two
      // `let`s of identical shape, only the local one emitted correctly.
      expect(out).toContain(sibling);
    });
  }

  it("phase ⑦ rejects the model, so none of that emission is reachable", async () => {
    const { model, errors } = await parseString(SRC("node"));
    expect(errors).toEqual([]); // phases ① + ④ are clean — this was the SILENT part
    const diags = validateLoomModel(enrichLoomModel(lowerModel(model)));
    const hit = diags.find((d) => d.code === "loom.workflow-cross-context-repository");
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("error");
    expect(hit!.source).toBe("Dispatch/scheduleWorkOrder");
  });

  it("the gate is platform-independent — it fires for every backend's system", async () => {
    for (const { platform } of BACKENDS) {
      const { model } = await parseString(SRC(platform));
      const diags = validateLoomModel(enrichLoomModel(lowerModel(model)));
      expect(
        diags.filter((d) => d.code === "loom.workflow-cross-context-repository"),
        `expected the cross-context gate to fire on platform ${platform}`,
      ).toHaveLength(1);
    }
  });
});
