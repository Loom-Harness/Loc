// What the Frontend Contract carries and refuses, on two corpus models: one
// whose aggregates all have declared response records (`examples/acme.ddd`) and
// one whose aggregate is masked (`test/fixtures/corpus/field-mask.ddd`).

import { describe, expect, it } from "vitest";
import { FrontendContractError } from "../../../src/ir/contract/allowlist.js";
import { buildFrontendContract } from "../../../src/ir/contract/frontend-contract.js";
import type { EnrichedLoomModel, ExprIR } from "../../../src/ir/types/loom-ir.js";
import { dddSourceOf } from "../../_helpers/ddd-corpus.js";
import { toLoomModel } from "../../_helpers/ir.js";
import { parseString } from "../../_helpers/parse.js";

async function load(file: string): Promise<EnrichedLoomModel> {
  const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
  expect(errors).toEqual([]);
  return toLoomModel(model);
}

describe("Frontend Contract", () => {
  it("ships the declared response records and no derived wire record", async () => {
    const model = await load("examples/acme.ddd");
    const contract = buildFrontendContract(model, model.systems[0]!);
    const responses = contract.wire.responses.map((r) => r.name);
    expect(responses).toContain("OrderResponse");
    expect(responses).toContain("OrderLineResponse");
    const records = contract.wire.records.map((r) => r.name);
    expect(records).toContain("CreateOrderCommand");
    // `<Agg>Wire` restates the derived shape; it never ships.
    expect(records.filter((n) => n.endsWith("Wire"))).toEqual([]);
    expect(contract.wire.operations.map((o) => o.id)).toContain("createOrder");
    expect(contract.ui.uis[0]!.pages.length).toBeGreaterThan(0);
    // No source origin (a local path) and no server-side node rides along.
    const bytes = JSON.stringify(contract);
    expect(bytes).not.toMatch(/"origin":|"find":|"operation":/);
  });

  it("ships a masked field as a flag and never its predicate", async () => {
    const model = await load("test/fixtures/corpus/field-mask.ddd");
    const contract = buildFrontendContract(model, model.systems[0]!);
    const employee = contract.wire.responses.find((r) => r.name === "EmployeeResponse")!;
    const masked = employee.fields.filter((f) => f.maskable).map((f) => f.name);
    expect(masked).toEqual(["salary", "nationalId", "badge"]);
    const review = contract.wire.responses.find((r) => r.name === "ReviewResponse")!;
    expect(review.fields.filter((f) => f.maskable).map((f) => f.name)).toEqual(["note", "summary"]);
    const bytes = JSON.stringify(contract);
    expect(bytes).not.toContain("maskUnless");
    expect(bytes).not.toContain("unmask");
  });

  it("refuses a domain read in a page body, naming where", async () => {
    const model = await load("examples/acme.ddd");
    const page = model.systems[0]!.uis[0]!.pages[0]!;
    const smuggled: ExprIR = {
      kind: "exists",
      aggregate: "Order",
      binding: "o",
      where: { kind: "literal", lit: "bool", value: "true" },
    };
    page.body = smuggled;
    expect(() => buildFrontendContract(model, model.systems[0]!)).toThrowError(
      FrontendContractError,
    );
    expect(() => buildFrontendContract(model, model.systems[0]!)).toThrowError(
      /ui WebApp\.pages\[0\]\.body: exists: a domain read never ships/,
    );
  });

  it("refuses a field no spec classifies", async () => {
    const model = await load("examples/acme.ddd");
    const page = model.systems[0]!.uis[0]!.pages[0]! as unknown as Record<string, unknown>;
    page.repositoryPlan = { tables: ["orders"] };
    expect(() => buildFrontendContract(model, model.systems[0]!)).toThrowError(
      /pages\[0\]\.repositoryPlan: unclassified field/,
    );
  });
});
