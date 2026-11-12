// The well-formedness verifier is wired into every lowering, and a violation it
// finds refuses the model as an internal error at the `.ddd` span — never
// silently reaching codegen.  The corpus sweep and the per-arm mutation proof
// live in `verify-lowered-corpus.test.ts`.

import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const model = (body: string) => `
system R { subdomain S { context C {
  enum St { Open, Done }
  aggregate Case with crudish {
    title: string
    status: St
${body}
  }
  repository Cases for Case { }
} } }
`;

describe("loom.ir-ill-formed — the post-lowering backstop", () => {
  it("a clean model lowers with no violations", async () => {
    const { model: ast, errors } = await parseString(
      model(`    operation close(reason: string) {
      let next = Done
      status := next
      title := reason
    }`),
      { validate: true },
    );
    expect(errors).toEqual([]);
    expect(lowerModel(ast).loweringViolations).toBeUndefined();
  });

  it("an ill-formed lowering is refused at its .ddd span, with the violation named", async () => {
    // Seed the violation directly: a model whose lowering disagrees with itself
    // is a compiler defect, so no well-formed source reaches this path once the
    // AST validators refuse every construct lowering cannot express.
    const { model: ast } = await parseString(model(`    operation touch() { status := Done }`), {
      validate: true,
    });
    const lowered = lowerModel(ast);
    const op = lowered.systems[0]!.subdomains[0]!.contexts[0]!.aggregates[0]!.operations.find(
      (o) => o.name === "touch",
    )!;
    const loom = enrichLoomModel({
      ...lowered,
      loweringViolations: [
        {
          kind: "assign-target",
          where: "C.Case.touch",
          detail: "`ghost` — `ghost` is not a stored member of `this`",
          origin: op.origin,
        },
      ],
    });
    const diags = validateLoomModel(loom).filter((d) => d.code === "loom.ir-ill-formed");
    expect(diags).toHaveLength(1);
    expect(diags[0]!.message).toContain("assign-target C.Case.touch");
    expect(diags[0]!.origin?.kind).toBe("source");
  });

  it("stays silent when the AST layer already refused the model", async () => {
    // `zzz` does not resolve (an author error); whatever lowering makes of the
    // recovered model is not reported on top of it.
    const r = await validate(model(`    operation touch() { zzz := Done }`));
    expect(r.diagnostics.some((d) => d.code === "loom.ir-ill-formed")).toBe(false);
    expect(r.ok).toBe(false);
  });
});
