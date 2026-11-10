// `exists <Agg> as <row> where …` — the phase-⑦ position and target rules
// (`src/ir/validate/checks/exists-checks.ts`), the queryable-subset arms
// (`src/ir/validate/checks/shared.ts`) and the in-app read enrichment derives
// (`src/ir/enrich/exists-reads.ts`).  What the quantifier DOES — in a query and
// in a gate — is asserted by the `exists-quantifier` corpus fixture's
// behavioural blocks on every backend; this file pins the programs the
// compiler refuses and the derived read's shape, which no booted tier observes.

import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { allContexts } from "../../src/ir/types/loom-ir.js";
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

  it("is refused in a precondition (evaluated inside the aggregate)", async () => {
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

  it("is admitted in a public operation's requires and when, as a synthesized read", async () => {
    const src = sys(`operation touch(by: string) when exists Share as s where s.target == this.id {
          requires exists Share as s where s.target == this.id && s.grantee == by
          title := by
        }`);
    expect((await codes(src)).filter((x) => x.startsWith("loom.exists"))).toEqual([]);
    const { model } = await parseString(src, { validate: false });
    const ctx = allContexts(enrichLoomModel(lowerModel(model))).find((c) => c.name === "C")!;
    const shares = ctx.repositories.find((r) => r.aggregateName === "Share")!;
    const reads = shares.finds.filter((f) => f.name.startsWith("existsForDocTouch"));
    // One read per quantifier; the gate's own values (`this.id`, `by`) are
    // lifted into parameters, the row's columns stay columns.
    expect(reads.map((f) => [f.name, f.params.length, f.synthesized, f.takeFirst])).toEqual([
      ["existsForDocTouch0", 1, true, true],
      ["existsForDocTouch1", 2, true, true],
    ]);
  });

  it("is admitted in a create gate over a create-input argument, and over its own aggregate", async () => {
    const c = await codes(
      sys(`create(title: string) {
          requires !exists Doc as d where d.title == title
        }`),
    );
    expect(c.filter((x) => x.startsWith("loom.exists") || x.startsWith("loom.lifecycle"))).toEqual(
      [],
    );
  });

  it("is refused in a private operation's gate (its caller is in-app)", async () => {
    const c = await codes(
      sys(`private operation touch() {
          requires exists Share as s where s.target == this.id
          title := "x"
        }`),
    );
    expect(c).toContain("loom.exists-outside-query");
  });

  it("refuses an in-app call to an operation whose gate reads a repository", async () => {
    const c = await codes(
      sys(
        `operation touch() when exists Share as s where s.target == this.id {
          title := "x"
        }`,
      ).replace(
        "repository Docs for Doc",
        `repository Docs for Doc
      commandHandler Touch(d: Doc id) {
        let doc = Docs.get(d)
        doc.touch()
      }`,
      ),
    );
    expect(c).toContain("loom.exists-outside-query");
  });

  it("ANDs the write scope into a `for write` quantifier", async () => {
    const src = sys(`filter exists Share for write as s where s.target == this.id`).replace(
      "repository Docs for Doc",
      "repository Docs for Doc\n      policy { deny write on Share }",
    );
    expect((await codes(src)).filter((x) => x.startsWith("loom.exists"))).toEqual([]);
    const { model } = await parseString(src, { validate: false });
    const ctx = allContexts(enrichLoomModel(lowerModel(model))).find((c) => c.name === "C")!;
    const doc = ctx.aggregates.find((a) => a.name === "Doc")!;
    const node = doc.contextFilters.find((f) => f.kind === "exists");
    // `deny write` admits no row: the row's never-null key tested against null.
    expect(node).toBeDefined();
    expect(JSON.stringify(node)).toContain('"lit":"null"');
  });

  it("prints back to the source it parsed from", async () => {
    const src = sys(`filter exists Share as s where s.target == this.id`);
    const { model } = await parseString(src, { validate: false });
    const found = AstUtils.streamAllContents(model).find((n) => n.$type === "ExistsExpr");
    expect(found).toBeDefined();
    expect(printExpr(found as never)).toBe("exists Share as s where s.target == this.id");
    const w = sys(`filter exists Share for write as s where s.target == this.id`);
    const parsed = await parseString(w, { validate: false });
    const node = AstUtils.streamAllContents(parsed.model).find((n) => n.$type === "ExistsExpr");
    expect(printExpr(node as never)).toBe("exists Share for write as s where s.target == this.id");
  });
});
