import { describe, expect, it } from "vitest";
import { detectRenamesReport } from "../../src/i18n/renames.js";
import type { BoundedContextIR } from "../../src/ir/types/loom-ir.js";
import { modelTextContextOf } from "../../src/ir/util/model-text-owner.js";
import { modelTextDefaultOfKey, modelTextRefOfKey } from "../../src/util/model-text-key.js";

const ctx = (name: string, enums: string[] = []): BoundedContextIR =>
  ({
    name,
    aggregates: [],
    workflows: [],
    valueObjects: [],
    enums: enums.map((e) => ({ name: e, values: [] })),
  }) as unknown as BoundedContextIR;

describe("modelTextContextOf", () => {
  it("prefers the home context", () => {
    expect(modelTextContextOf("Status", ctx("B", ["Status"]), [ctx("A", ["Status"])])).toBe("B");
  });

  it("picks the same owner whatever order the contexts are listed in", () => {
    const a = ctx("A", ["Status"]);
    const c = ctx("C", ["Status"]);
    expect(modelTextContextOf("Status", undefined, [c, a])).toBe("A");
    expect(modelTextContextOf("Status", undefined, [a, c])).toBe("A");
  });

  it("is undefined when no context declares the type", () => {
    expect(modelTextContextOf("Nope", undefined, [ctx("A")])).toBeUndefined();
  });
});

describe("modelTextRefOfKey", () => {
  it("inverts the key constructor and derives the English default", () => {
    expect(modelTextRefOfKey("Sales.Status.value.InProgress")).toEqual({
      ctx: "Sales",
      type: "Status",
      facet: "value",
      member: "InProgress",
    });
    expect(modelTextDefaultOfKey("Sales.Status.value.InProgress")).toBe("In Progress");
    expect(modelTextRefOfKey("_system.Status.name.other").ctx).toBeUndefined();
  });

  it("rejects a key that is not an identity key", () => {
    expect(() => modelTextDefaultOfKey("WebApp.page.Home.heading.abc")).toThrow(/not an identity/);
  });
});

describe("detectRenamesReport - unqualified step", () => {
  it("reports a step two contexts satisfy and carries neither", () => {
    const base = { "A.Order.rule.r": "R", "B.Order.rule.r": "R" };
    const theirs = { "A.Invoice.rule.r": "R", "B.Invoice.rule.r": "R" };
    const report = detectRenamesReport(base, theirs, {
      columns: [],
      tables: [{ from: "Order", to: "Invoice" }],
    });
    expect(report.ambiguous).toEqual([{ from: "Order", to: "Invoice", contexts: ["A", "B"] }]);
    expect(report.moves.filter((m) => m.via === "declared")).toEqual([]);
  });

  it("is not ambiguous when only one context renamed", () => {
    const base = { "A.Order.rule.r": "R", "B.Order.rule.r": "R" };
    const theirs = { "A.Invoice.rule.r": "R", "B.Order.rule.r": "R" };
    const report = detectRenamesReport(base, theirs, {
      columns: [],
      tables: [{ from: "Order", to: "Invoice" }],
    });
    expect(report.ambiguous).toEqual([]);
    expect(report.moves.map((m) => m.to)).toEqual(["A.Invoice.rule.r"]);
  });
});
