// Rule names and the removed `message "..."` clause.  A rule is NAMED
// (`invariant nameShort: …`, `check skuRequired: …`); the `message "..."` clause
// no longer means anything, but the grammar still parses it so the validator can
// raise `loom.rule-message-removed` naming the rule it becomes.  Being a soft
// keyword, `message` still admits an ordinary field/identifier name.

import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { beforeAll, describe, expect, it } from "vitest";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Aggregate, Invariant, Model, Property } from "../../../src/language/generated/ast.js";

describe("invariant/check/precondition rule names and the removed `message` clause", () => {
  let parse: ReturnType<typeof parseHelper>;
  beforeAll(() => {
    parse = parseHelper(createDddServices(NodeFileSystem).Ddd);
  });

  const parseAgg = async (src: string) => {
    const doc = await parse(src);
    const ctx = (doc.parseResult.value as Model).members.find((m) => m.$type === "BoundedContext");
    // biome-ignore lint/suspicious/noExplicitAny: test navigation
    const agg = (ctx as any)?.members?.find((m: { $type: string }) => m.$type === "Aggregate") as
      | Aggregate
      | undefined;
    return { errs: doc.parseResult.parserErrors.map((e) => e.message).join("; "), agg };
  };

  it("sets the rule name on an invariant and a property `check`", async () => {
    const { errs, agg } = await parseAgg(`context C {
      aggregate Product {
        sku: string check skuRequired: sku.length > 0
        name: string
        invariant nameShort: name.length >= 2
        invariant sku.length > 0
      }
    }`);
    expect(errs).toBe("");
    const invs = agg?.members.filter((m) => m.$type === "Invariant") as Invariant[];
    expect(invs.map((i) => i.name)).toEqual(["nameShort", undefined]);
    const sku = agg?.members.find(
      (m) => m.$type === "Property" && (m as Property).name === "sku",
    ) as Property | undefined;
    expect(sku?.checkName).toBe("skuRequired");
  });

  it("still parses the removed `message` clause, for the diagnostic that names its replacement", async () => {
    const { errs, agg } = await parseAgg(`context C {
      aggregate Product {
        sku: string check sku.length > 0 message "SKU is required"
        name: string
        invariant name.length >= 2 message "Name too short"
        invariant sku.length > 0
      }
    }`);
    expect(errs).toBe("");
    const inv = agg?.members.find((m) => m.$type === "Invariant") as Invariant | undefined;
    expect(inv?.message).toBe("Name too short");
    const sku = agg?.members.find(
      (m) => m.$type === "Property" && (m as Property).name === "sku",
    ) as Property | undefined;
    expect(sku?.message).toBe("SKU is required");
    // An unnamed invariant leaves the field undefined.
    const bare = agg?.members.filter((m) => m.$type === "Invariant") as Invariant[];
    expect(bare.find((i) => i.message === undefined)).toBeTruthy();
  });

  it("keeps `message` usable as a field name (soft keyword)", async () => {
    const { errs, agg } = await parseAgg(`context C {
      aggregate Note { message: string }
    }`);
    expect(errs).toBe("");
    const f = agg?.members.find((m) => m.$type === "Property") as Property | undefined;
    expect(f?.name).toBe("message");
  });
});
