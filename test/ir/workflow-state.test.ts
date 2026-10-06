// Workflow state fields + correlation field (workflow-and-applier.md A2-S2).
// Covers the lowered `WorkflowIR.stateFields` / `correlationField`, the
// grammar surface (Property as a workflow member), and the IR-level
// correlation rules (`loom.workflow-correlation-required`,
// `loom.correlation-field-ambiguous`).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

function src(workflowBody: string): string {
  return `
    system S { subdomain M { context C {
      aggregate Order { total: int }
      aggregate Payment { amount: int }
      enum FulfillmentStatus { Pending, Done }
      event PaymentReceived { order: Order id, amount: int }
      workflow Fulfillment {
        ${workflowBody}
      }
    }}}`;
}

async function lowerFirstWorkflow(workflowBody: string) {
  const { model } = await parseString(src(workflowBody), { validate: false });
  return allContexts(lowerModel(model))[0].workflows[0];
}

/** Correlation diagnostics (by code) from the IR validator. */
async function correlationDiags(workflowBody: string): Promise<string[]> {
  const { model } = await parseString(src(workflowBody), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter(
      (d) =>
        d.code === "loom.workflow-correlation-required" ||
        d.code === "loom.correlation-field-ambiguous",
    )
    .map((d) => d.code ?? "");
}

describe("workflow state fields — surface + lowering", () => {
  it("parses a workflow with state fields", async () => {
    const { errors } = await parseString(src(`orderId: Order id\n status: FulfillmentStatus`));
    expect(errors).toEqual([]);
  });

  it("lowers Property members into wf.stateFields", async () => {
    const wf = await lowerFirstWorkflow(`orderId: Order id\n status: FulfillmentStatus`);
    expect(wf.stateFields).toBeDefined();
    expect(wf.stateFields?.map((f) => f.name)).toEqual(["orderId", "status"]);
  });

  it("infers the correlation field as the single id-shaped state field", async () => {
    const wf = await lowerFirstWorkflow(`orderId: Order id\n status: FulfillmentStatus`);
    expect(wf.correlationField).toBe("orderId");
  });

  it("leaves correlationField undefined when there is no id-shaped field", async () => {
    const wf = await lowerFirstWorkflow(`status: FulfillmentStatus`);
    expect(wf.correlationField).toBeUndefined();
  });

  it("leaves correlationField undefined when id-shaped fields are ambiguous", async () => {
    const wf = await lowerFirstWorkflow(`orderId: Order id\n paymentId: Payment id`);
    expect(wf.correlationField).toBeUndefined();
  });

  it("leaves stateFields undefined when the workflow declares none", async () => {
    const wf = await lowerFirstWorkflow(`create() { let x = 1 }`);
    expect(wf.stateFields).toBeUndefined();
  });
});

describe("workflow correlation — validation", () => {
  it("accepts a reactor workflow with exactly one id-shaped correlation field", async () => {
    const diags = await correlationDiags(
      `orderId: Order id
       on(paid: PaymentReceived) { let x = paid.amount }`,
    );
    expect(diags).toEqual([]);
  });

  it("rejects a reactor workflow with no correlation field (rule 10)", async () => {
    const diags = await correlationDiags(
      `status: FulfillmentStatus
       on(paid: PaymentReceived) { let x = paid.amount }`,
    );
    expect(diags).toContain("loom.workflow-correlation-required");
  });

  it("rejects a reactor workflow with ambiguous id-shaped fields (rule 19)", async () => {
    const diags = await correlationDiags(
      `orderId: Order id
       paymentId: Payment id
       on(paid: PaymentReceived) { let x = paid.amount }`,
    );
    expect(diags).toContain("loom.correlation-field-ambiguous");
  });

  it("does not require a correlation field when there are no reactors", async () => {
    const diags = await correlationDiags(`status: FulfillmentStatus\n create() { let x = 1 }`);
    expect(diags).toEqual([]);
  });
});

// An event-sourced workflow keys its event stream by the correlation field, so
// it needs exactly one id-shaped field even with only a command-triggered
// create and no `on`: without one there is no stream key, and the .NET / Java
// / Elixir ES emitters have no id class to key it by.
describe("workflow correlation — event-sourced, no event consumers", () => {
  async function esDiags(stateFields: string): Promise<{ code: string; message: string }[]> {
    const { model } = await parseString(
      `
    system S { subdomain M { context C {
      aggregate Order { total: int }
      aggregate Payment { amount: int }
      event Recorded { code: string, count: int }
      workflow Tracker eventSourced {
        ${stateFields}
        archivedCount: int
        create(c: string) { emit Recorded { code: c, count: 1 } }
        apply(rec: Recorded) { archivedCount := archivedCount + rec.count }
      }
    }}}`,
      { validate: false },
    );
    return validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter(
        (d) =>
          d.code === "loom.workflow-correlation-required" ||
          d.code === "loom.correlation-field-ambiguous",
      )
      .map((d) => ({ code: d.code ?? "", message: d.message }));
  }

  it("refuses a command-only eventSourced workflow with no id-shaped field", async () => {
    const diags = await esDiags(`code: string`);
    expect(diags.map((d) => d.code)).toEqual(["loom.workflow-correlation-required"]);
    expect(diags[0].message).toContain("event-sourced workflow 'Tracker' has no correlation field");
    expect(diags[0].message).toContain("event stream");
  });

  it("refuses a command-only eventSourced workflow with two id-shaped fields", async () => {
    const diags = await esDiags(`orderId: Order id\n paymentId: Payment id`);
    expect(diags.map((d) => d.code)).toEqual(["loom.correlation-field-ambiguous"]);
    expect(diags[0].message).toContain("keys its event stream");
  });

  it("accepts a command-only eventSourced workflow with exactly one id-shaped field", async () => {
    expect(await esDiags(`orderId: Order id`)).toEqual([]);
  });
});
