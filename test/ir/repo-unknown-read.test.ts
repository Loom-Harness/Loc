// `loom.repo-unknown-read` — a repository read by a name no contract verb
// spells.  A repository declares no reads of its own (D-FINDDECL-REMOVED), so
// `Orders.byCode(c)` in an expression resolves to nothing; unrefused, every
// backend emits a call to a repository method it never generated.  The
// workflow `let` form keeps its own code (`loom.workflow-unknown-repository-method`).

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { buildLoomModel } from "../_helpers/ir.js";

const src = (body: string) => `
  system S { subdomain M { context C {
    aggregate Order with crudish { code: string  unique (code) }
    repository Orders for Order
    criterion ByCode(c: string) of Order = this.code == c
    domainService Q {
      operation taken(c: string): bool { return ${body} != null }
    }
  }}}
`;

async function codes(body: string): Promise<string[]> {
  const model = await buildLoomModel(src(body));
  return validateLoomModel(model)
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
}

describe("loom.repo-unknown-read", () => {
  it("refuses a read by a name no verb spells, with a did-you-mean over the verbs", async () => {
    const model = await buildLoomModel(src("Orders.findByID(c)"));
    const hit = validateLoomModel(model).find((d) => d.code === "loom.repo-unknown-read");
    expect(hit?.message).toContain("repository 'Orders' has no method 'findByID'");
    expect(hit?.message).toContain("Did you mean 'findById'?");
  });

  it("accepts every contract read in the same position", async () => {
    for (const body of [
      "Orders.findBy(code: c)",
      "Orders.find(ByCode(c))",
      `Orders.findById(c)`,
    ]) {
      expect(await codes(body), body).not.toContain("loom.repo-unknown-read");
    }
  });
});
