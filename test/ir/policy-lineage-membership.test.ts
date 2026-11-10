// `organizationContext.ancestors.contains(<column>)` in a row rule (D-SHARING:
// `shareable`'s Subtree grantee).  What the membership DOES on each backend —
// the column tested against the operating org's lineage, re-read after a move —
// is the `org-context` tenancy harness's job (`test/e2e/tenancy-org-context`);
// this pins where the gate admits the shape and where it refuses it.
import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModelUnchecked } from "../_helpers/ir.js";

const system = (body: string) => `
system S {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain M {
    context C {
      aggregate Org with crudish { name: string  implements tenantRegistry }
      aggregate Memo with tenantOwned, crudish { reader: Org id  note: string }
      aggregate Grant with tenantOwned, crudish { memo: Memo id  org: Org id }
      policy InLineage(o: Org id): bool = organizationContext.ancestors.contains(o)
      ${body}
    }
  }
  storage primary { type: postgres }
  resource cState { for: C, kind: state, use: primary }
  deployable d { platform: node  contexts: [C]  dataSources: [cState]  port: 4000  auth: required }
}`;

async function codes(body: string): Promise<string[]> {
  const m = await buildLoomModelUnchecked(
    system(body),
    "the refusal cases are models the IR validator must reject",
  );
  return validateLoomModel(m)
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
}

describe("organizationContext.ancestors.contains(<column>) in a row rule", () => {
  it("admits a row column, directly and through a policy function", async () => {
    expect(
      await codes(`policy {
        allow on Memo as m where organizationContext.ancestors.contains(m.reader)
        allow on Grant as g where InLineage(g.org)
      }`),
    ).toEqual([]);
  });

  it("admits an `exists` row's column", async () => {
    expect(
      await codes(`policy {
        allow on Memo as m where exists Grant as g where g.memo == m.id && InLineage(g.org)
      }`),
    ).toEqual([]);
  });

  it("refuses a value argument — the query has no column to test", async () => {
    expect(
      await codes(`policy {
        allow on Memo as m where m.note == "x" && organizationContext.ancestors.contains(organizationContext.org)
      }`),
    ).toContain("loom.policy-row-not-queryable");
  });

  it("stays refused in a retrieval `where` (no retrieval renderer arm for it)", async () => {
    expect(
      await codes(
        `retrieval Visible() of Memo { where: organizationContext.ancestors.contains(this.reader) }`,
      ),
    ).not.toEqual([]);
  });
});
