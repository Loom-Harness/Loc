// `exists <Agg> as <row> where …` — the phase-⑦ position and target rules
// (`src/ir/validate/checks/exists-checks.ts`) and the queryable-subset arms
// (`src/ir/validate/checks/shared.ts`).  What the quantifier DOES is asserted by
// the `exists-quantifier` corpus fixture's behavioural block on every backend;
// this file pins only the programs the compiler refuses, which no booted tier
// can observe.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { printExpr } from "../../src/language/print/print-expr.js";
import { parseString } from "../_helpers/parse.js";

const sys = (members: string, other = ""): string => `
system S {
  subdomain M {
    context C {
      aggregate Share with crudish {
        target: Doc id
        grantee: string
        revoked: bool
        filter !this.revoked
      }
      aggregate Doc with crudish {
        title: string
        ${members}
      }
      repository Docs for Doc
    }
    context Other {
      aggregate Foreign with crudish { doc: string }
    }
  }
  ${other}
}
`;

async function codes(src: string): Promise<string[]> {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
}

describe("exists quantifier", () => {
  it("is admitted in a row filter", async () => {
    const c = await codes(
      sys(`filter exists Share as s where s.target == this.id && s.grantee == this.title`),
    );
    expect(c.filter((x) => x.startsWith("loom.exists"))).toEqual([]);
    expect(c).not.toContain("loom.criterion-not-selectable");
  });

  it("is refused in an operation body (not a query position)", async () => {
    const c = await codes(
      sys(`operation touch() {
          precondition exists Share as s where s.target == this.id
          title := "x"
        }`),
    );
    expect(c).toContain("loom.exists-outside-query");
  });

  it("is refused over another context's aggregate", async () => {
    const c = await codes(sys(`filter exists Foreign as f where f.doc == this.title`));
    expect(c).toContain("loom.exists-cross-context");
  });

  it("is refused over the filtered row's own aggregate", async () => {
    const c = await codes(sys(`filter exists Doc as d where d.title == this.title`));
    expect(c).toContain("loom.exists-unsupported");
  });

  it("refuses the bare quantified row and an unknown row column", async () => {
    expect(await codes(sys(`filter exists Share as s where s.grantee == s.nope`))).toContain(
      "loom.criterion-not-selectable",
    );
    expect(
      await codes(sys(`filter exists Share as s where s.grantee.trim() == this.title`)),
    ).toContain("loom.criterion-not-selectable");
  });

  it("prints back to the source it parsed from", async () => {
    const src = sys(`filter exists Share as s where s.target == this.id`);
    const { model } = await parseString(src, { validate: false });
    const found = AstUtils.streamAllContents(model).find((n) => n.$type === "ExistsExpr");
    expect(found).toBeDefined();
    expect(printExpr(found as never)).toBe("exists Share as s where s.target == this.id");
  });
});
