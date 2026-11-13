// The surface gate (`test/_helpers/frontend-contract-surface.ts`) names each
// way a serialized contract can reach past the exposed wire surface.  Each case
// seeds one defect into a real contract's bytes and requires the gate to name
// it; the unseeded bytes must pass, so a failure is the seed and nothing else.

import { describe, expect, it } from "vitest";
import { buildFrontendContract } from "../../../src/ir/contract/frontend-contract.js";
import type { EnrichedLoomModel } from "../../../src/ir/types/loom-ir.js";
import { dddSourceOf } from "../../_helpers/ddd-corpus.js";
import { surfaceViolations } from "../../_helpers/frontend-contract-surface.js";
import { toLoomModel } from "../../_helpers/ir.js";
import { parseString } from "../../_helpers/parse.js";

type Json = Record<string, unknown>;

async function load(file: string): Promise<EnrichedLoomModel> {
  const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
  expect(errors).toEqual([]);
  return toLoomModel(model);
}

/** The gate's verdict on `file`'s contract after `seed` edits its parsed bytes. */
async function gate(file: string, seed: (c: Json) => void): Promise<string[]> {
  const model = await load(file);
  const sys = model.systems[0]!;
  const contract = JSON.parse(JSON.stringify(buildFrontendContract(model, sys))) as Json;
  expect(surfaceViolations(model, sys, JSON.stringify(contract))).toEqual([]);
  seed(contract);
  return surfaceViolations(model, sys, JSON.stringify(contract));
}

const wire = (c: Json) => c.wire as Record<string, Json[]>;
const response = (c: Json, name: string) => wire(c).responses!.find((r) => r.name === name)!;

describe("Frontend Contract surface gate", () => {
  it("names a domain-only field seeded into a response", async () => {
    const v = await gate("examples/acme.ddd", (c) => {
      (response(c, "OrderResponse").fields as Json[]).push({
        name: "internalMargin",
        type: { kind: "primitive", name: "decimal" },
        optional: false,
      });
    });
    expect(v).toEqual(["wire.responses.OrderResponse: field 'internalMargin' is not on the wire"]);
  });

  it("names a mask predicate or a wrong maskable flag", async () => {
    const v = await gate("test/fixtures/corpus/field-mask.ddd", (c) => {
      const fields = response(c, "EmployeeResponse").fields as Json[];
      delete fields.find((f) => f.name === "salary")!.maskable;
      fields.find((f) => f.name === "grade")!.maskable = true;
      fields.find((f) => f.name === "nationalId")!.maskUnless = { kind: "literal" };
    });
    expect(v).toEqual([
      "$.wire.responses[0].fields[3]: key 'maskUnless' is not shipped by any spec",
      "$: the bytes carry a mask predicate",
      "wire.responses.EmployeeResponse.salary: maskable flag disagrees with the mask",
      "wire.responses.EmployeeResponse.grade: maskable flag disagrees with the mask",
    ]);
  });

  it("names a page expression reading a field off the wire", async () => {
    const v = await gate("examples/acme.ddd", (c) => {
      const found: Json[] = [];
      const visit = (x: unknown): void => {
        if (Array.isArray(x)) x.forEach(visit);
        else if (x && typeof x === "object") {
          const n = x as Json;
          if (n.kind === "member" && (n.receiverType as Json)?.kind === "entity") found.push(n);
          Object.values(n).forEach(visit);
        }
      };
      visit(c.ui);
      expect(found.length).toBeGreaterThan(0);
      found[0]!.member = "costPrice";
    });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/reads 'costPrice', which the receiver's wire shape does not carry$/);
  });

  it("names a record, value object or type edge the surface lacks", async () => {
    const v = await gate("examples/acme.ddd", (c) => {
      wire(c).records!.push({ name: "OrderCostSheet", kind: "payload", fields: [] });
      wire(c).operations![0]!.responseType = { kind: "valueobject", name: "Ledger" };
    });
    expect(v).toEqual([
      "wire.records: OrderCostSheet is not exposed",
      "$.wire.operations[0].responseType: value object 'Ledger' is not on the wire",
    ]);
  });
});
