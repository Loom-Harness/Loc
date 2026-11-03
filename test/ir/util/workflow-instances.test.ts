import { describe, expect, it } from "vitest";
import type { WireField, WorkflowIR } from "../../../src/ir/types/loom-ir.js";
import { workflowCorrWireField } from "../../../src/ir/util/workflow-instances.js";

// The correlation field on an observable workflow's `instanceWireShape` — the
// row every backend's `/instances/{id}` route reads.

const idType = (targetName = "Order") => ({ kind: "id", targetName }) as never;

const wireField = (over: Partial<WireField> = {}): WireField =>
  ({ name: "orderId", source: "id", type: idType(), ...over }) as unknown as WireField;

const wf = (shape: WireField[] | undefined): WorkflowIR =>
  ({ name: "Fulfil", instanceWireShape: shape }) as unknown as WorkflowIR;

describe('workflowCorrWireField — the `source: "id"` row', () => {
  it("returns the id-sourced field", () => {
    const corr = wireField();
    expect(workflowCorrWireField(wf([corr]))).toBe(corr);
  });

  it("picks it out from among other wire rows, whatever its position", () => {
    // Selection is by `source`, not by index — a positional read would pick the
    // wrong column the moment a workflow declares state before its correlation.
    const corr = wireField({ name: "correlation" });
    const shape = [
      wireField({ name: "status", source: "property", type: idType() }),
      corr,
      wireField({ name: "step", source: "property", type: idType() }),
    ];
    expect(workflowCorrWireField(wf(shape))).toBe(corr);
  });

  it("THROWS, naming the workflow, when no row is id-sourced", () => {
    // Every observable workflow has one by construction, so the absence is a
    // pipeline bug — loud beats a silently wrong path param.
    expect(() => workflowCorrWireField(wf([wireField({ source: "property" })]))).toThrow(
      /'Fulfil'/,
    );
  });

  it("throws for an empty shape and for a MISSING one", () => {
    expect(() => workflowCorrWireField(wf([]))).toThrow();
    expect(() => workflowCorrWireField(wf(undefined))).toThrow();
  });
});
