// `loom.workflow-cross-context-repository` — a workflow `let` reading a
// repository declared in ANOTHER context.
//
// THE SHAPE.  `lowerWorkflow` (and `ctxAggRepoMaps`, its `handle`/`on` twin)
// index `reposByName` from the enclosing `ctx.members` ALONE, so
// `matchRepoCall` declines a foreign repository name and the `let` never
// becomes a `repo-let` `WorkflowStmtIR` — it falls through to the generic
// `expr-let` arm, leaving the receiver as a `ref` with `refKind: "unknown"`.
// The `repo-let` case's own `loom.workflow-unknown-repository` branch is
// therefore UNREACHABLE for this shape.
//
// The point of this suite is that ONE root cause used to surface as TWO
// different behaviours, and the gate has to collapse both:
//
//   Variant A — the binding is later an op-call receiver (`part.decrement(qty)`)
//               → `loom.workflow-unknown-binding`, fired on the USE rather than
//                 the `let`, worded as if the variable name were a typo, plus a
//                 cascading `loom.transactional-no-effect` warning.
//   Variant B — the binding is only READ (`precondition tech.skills.count > 0`)
//               → NOTHING.  Zero errors, zero warnings, broken codegen.
//
// Both must now yield exactly ONE diagnostic, and the SAME one.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

/** Variant A — the cross-context binding is used as an op-call receiver. */
const VARIANT_A = `
system WorkflowCrossContext {
  subdomain Core {
    context Inventory {
      aggregate Part with crudish {
        stockLevel: int
        operation decrement(qty: int) {
          precondition stockLevel >= qty
          stockLevel := stockLevel - qty
        }
      }
      repository Parts for Part { }
    }
    context Dispatch {
      aggregate Ticket with crudish {
        partId: Part id
        note: string
      }
      repository Tickets for Ticket { }
      workflow consume transactional {
        create(ticketId: Ticket id, partId: Part id, qty: int) {
          let part = Parts.getById(partId)
          part.decrement(qty)
        }
      }
    }
  }
  storage primary { type: postgres }
  resource inventoryState { for: Inventory, kind: state, use: primary }
  resource dispatchState { for: Dispatch, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [Inventory, Dispatch]
    dataSources: [inventoryState, dispatchState]
    port: 3000
  }
}
`;

/** Variant B — the cross-context binding is only READ.  Note the SAME-context
 *  sibling `let wo = WorkOrders.getById(...)`, which must stay legal. */
const VARIANT_B = `
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
  deployable api { platform: node, contexts: [Directory, Dispatch], dataSources: [dirState, dispState], port: 3000 }
}
`;

/** The same system as VARIANT_B with BOTH aggregates in ONE context — the
 *  legal shape the gate must leave completely alone. */
const SAME_CONTEXT = `
system SameContextTest {
  subdomain Core {
    context Dispatch {
      aggregate Technician with crudish { skills: string[] }
      repository Technicians for Technician { }
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
  resource dispState { for: Dispatch, kind: state, use: primary }
  deployable api { platform: node, contexts: [Dispatch], dataSources: [dispState], port: 3000 }
}
`;

/** A cross-context read inside a named `handle` member — a body
 *  `validateWorkflowBody` never even visits (it only sees the primary create),
 *  so only the new gate can catch it. */
const IN_HANDLE = `
system HandleCrossContext {
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
      workflow scheduleWorkOrder {
        workOrderId: WorkOrder id
        create(workOrderId: WorkOrder id) {
          let wo = WorkOrders.getById(workOrderId)
          wo.assign()
        }
        handle reassign(workOrderId: WorkOrder id, assignTo: Technician id) {
          let tech = Technicians.getById(assignTo)
          precondition tech.skills.count > 0
        }
      }
    }
  }
  storage primary { type: postgres }
  resource dirState { for: Directory, kind: state, use: primary }
  resource dispState { for: Dispatch, kind: state, use: primary }
  deployable api { platform: node, contexts: [Directory, Dispatch], dataSources: [dirState, dispState], port: 3000 }
}
`;

async function diagnose(src: string) {
  const { model, errors } = await parseString(src);
  // Phases ① + ④ are clean on every fixture here — that is what made the
  // failure SILENT rather than merely badly worded.
  expect(errors).toEqual([]);
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const CODE = "loom.workflow-cross-context-repository";

describe("workflow reading a repository from another context", () => {
  it("variant A (binding used as an op-call receiver) is rejected by the cross-context gate", async () => {
    const diags = await diagnose(VARIANT_A);
    const hits = diags.filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("error");
    expect(hits[0]!.source).toBe("Dispatch/consume");
    // The message names all three facts the author needs: the repository, the
    // context that owns it, and the workflow's own context.
    expect(hits[0]!.message).toContain("'Parts'");
    expect(hits[0]!.message).toContain("'Inventory'");
    expect(hits[0]!.message).toContain("'Dispatch'");
  });

  it("variant B (binding only read) is rejected by the SAME gate — it used to be silent", async () => {
    const diags = await diagnose(VARIANT_B);
    const hits = diags.filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("error");
    expect(hits[0]!.source).toBe("Dispatch/scheduleWorkOrder");
    expect(hits[0]!.message).toContain("'Technicians'");
    expect(hits[0]!.message).toContain("'Directory'");
  });

  it("both variants report ONE diagnostic, and the same code — the inconsistency is the bug", async () => {
    const a = await diagnose(VARIANT_A);
    const b = await diagnose(VARIANT_B);
    // Exactly one diagnostic each, of either severity: the cross-context error
    // and nothing else.  Before the fix A produced `workflow-unknown-binding` +
    // a `transactional-no-effect` warning, and B produced nothing at all.
    expect(a.map((d) => d.code)).toEqual([CODE]);
    expect(b.map((d) => d.code)).toEqual([CODE]);
  });

  it("the misleading cascade is gone — no unknown-binding, no transactional-no-effect", async () => {
    const a = await diagnose(VARIANT_A);
    const codes = a.map((d) => d.code);
    // The op-call's receiver is unbound ONLY because its `let` crossed the
    // boundary; saying so again at the USE described the same defect twice, and
    // described it wrongly.
    expect(codes).not.toContain("loom.workflow-unknown-binding");
    // ...and the mutation the author wrote is real, so the workflow is not
    // "transactional with no effect" — that warning was pure cascade.
    expect(codes).not.toContain("loom.transactional-no-effect");
  });

  it("a cross-context read inside a `handle` member is caught too", async () => {
    const diags = await diagnose(IN_HANDLE);
    const hits = diags.filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    // The `where` names the member, so the author knows WHICH body to fix.
    expect(hits[0]!.message).toContain("handle 'reassign'");
  });

  it("the same system with both aggregates in ONE context stays valid", async () => {
    const diags = await diagnose(SAME_CONTEXT);
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    expect(diags.filter((d) => d.code === CODE)).toEqual([]);
  });

  it("one diagnostic per repository, not per mention", async () => {
    // The same foreign repository read twice in one body states one boundary
    // problem — the author fixes it once.
    const src = VARIANT_B.replace(
      "let tech = Technicians.getById(assignTo)",
      "let tech = Technicians.getById(assignTo)\n          let tech2 = Technicians.getById(assignTo)",
    );
    const diags = await diagnose(src);
    expect(diags.filter((d) => d.code === CODE)).toHaveLength(1);
  });
});
