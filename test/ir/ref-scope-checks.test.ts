// `loom.tenancy-ref-unresolvable` (docs/tenancy.md → "Reference admission"): a
// persisted reference to a `tenantOwned` aggregate of another context is
// stored unchecked.  Under `enforcement: denyByDefault` the model does not
// compile; under `opt` it is reported and compiles.  A severity is a fact
// about validation, which no booted tier observes.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const model = (enforcement: string): string => `
system S {
  user { id: string  tenantId: string }
  auth { ${enforcement}  oidc { issuer: "https://idp.example.com"  clientId: "app" } }
  tenancy by user.tenantId of Org
  subdomain M {
    context A {
      aggregate Org with crudish { name: string }
      aggregate Invoice with tenantOwned, crudish { number: string }
    }
    context B {
      aggregate Claim with tenantOwned, crudish { invoice: Invoice id }
    }
  }
}`;

async function unresolvable(enforcement: string) {
  const { model: m } = await parseString(model(enforcement), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(m))).filter(
    (d) => d.code === "loom.tenancy-ref-unresolvable",
  );
}

describe("loom.tenancy-ref-unresolvable severity follows enforcement", () => {
  it("is an error under the default (denyByDefault) enforcement", async () => {
    const diags = await unresolvable("");
    expect(diags.map((d) => d.severity)).toEqual(["error"]);
    expect(diags[0]!.source).toBe("B/aggregate Claim.invoice");
  });

  it("is a warning under enforcement: opt", async () => {
    expect((await unresolvable("enforcement: opt")).map((d) => d.severity)).toEqual(["warning"]);
  });
});
