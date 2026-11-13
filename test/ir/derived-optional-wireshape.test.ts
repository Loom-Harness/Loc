import { describe, expect, it } from "vitest";
import { buildHostedModel, enrichedAggregates, responseRows } from "../_helpers/ir.js";

// ---------------------------------------------------------------------------
// A derived field's declared type carries its nullability
// (`derived x: T? = …`).  It must flow into `wireShape.optional` so the
// `.loom/wire-spec.json` contract artifact does not list a nullable derived
// in its `required` array (which every backend serves as nullish).
// ---------------------------------------------------------------------------

const SRC = `
context People {
  aggregate Person {
    firstName: string
    nickname: string?
    derived greeting: string = "Hi " + firstName
    derived label: string? = nickname
  }
}
`;

describe("wireShape — derived-field nullability", () => {
  it("carries the derived's declared optionality (not hardcoded non-optional)", async () => {
    const loom = await buildHostedModel(SRC);
    const agg = enrichedAggregates(loom).find((a) => a.name === "Person")!;
    const byName = Object.fromEntries(responseRows(loom, agg).map((f) => [f.name, f]));

    // A non-optional derived stays required.
    expect(byName.greeting.source).toBe("derived");
    expect(byName.greeting.optional).toBe(false);

    // An optional-typed derived must be optional on the wire — otherwise the
    // wire-spec contract lists it as `required` while backends serve it null.
    expect(byName.label.source).toBe("derived");
    expect(byName.label.optional).toBe(true);
  });
});
