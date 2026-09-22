// `this.id` in a criterion must survive being USED.
//
// The language contradicted itself.  `criterion ById(i: Part id) of Part =
// this.id == i` validated — the criterion-side check admits `this.id` in as
// many words, because "the key is a real stored column on every backend" — and
// then every way of using it was refused:
//
//     repository Parts for Part { find byId2(i: Part id): Part? where ById(i) }
//     -> loom.find-where-unknown-field: unknown field 'this.id' on aggregate 'Part'
//
// So you could declare the predicate and not call it (F-003).  The one lookup
// an author most wants to express — "the row with this FK" — was expressible
// and unusable.
//
// The strictness was not arbitrary: `firstUnknownColumnRef`'s `allowSelfId`
// option says find/retrieval `where`s stay strict because "a workflow-instance
// read-model source has no `id` column".  True — but such a source is not an
// aggregate, so `agg` never resolves for it and the branch does not run.  Where
// `agg` DOES resolve it came from `ctx.aggregates`, and every aggregate carries
// an implicit `<Name> id` that is a stored column.  The two sites now pass the
// option the criterion site always passed.
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

const sys = (members: string) => `
system X {
  subdomain S {
    context C {
      aggregate Part { sku: string }
${members}
    }
  }
  storage p { type: postgres }
  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}
`;

const CRITERION = `      criterion ById(i: Part id) of Part = this.id == i`;

async function errors(source: string): Promise<string[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "");
}

describe("a criterion on `this.id` is usable, not just declarable", () => {
  it("declaring it is accepted (it always was)", async () => {
    expect(await errors(sys(`${CRITERION}\n      repository Parts for Part { }`))).toEqual([]);
  });

  it("USING it from a find is accepted too", async () => {
    const src = sys(
      `${CRITERION}\n      repository Parts for Part { find byId2(i: Part id): Part? where ById(i) }`,
    );
    expect(await errors(src)).toEqual([]);
  });

  it("USING it from a retrieval is accepted too", async () => {
    const src = sys(
      `${CRITERION}\n      retrieval OneById(i: Part id) of Part { where: ById(i) }\n      repository Parts for Part { }`,
    );
    expect(await errors(src)).toEqual([]);
  });

  it("and the emitted SQL names the real id column", async () => {
    // Acceptance is worth nothing if the generated query is wrong — this is the
    // half that says the relaxation was safe rather than merely quiet.
    const src = sys(
      `${CRITERION}\n      repository Parts for Part { find byId2(i: Part id): Part? where ById(i) }`,
    );
    const files = await generateSystemFiles(src);
    const repo = [...files].find(([p]) => p.endsWith("part-repository.ts"))![1];
    expect(repo).toContain("eq(schema.parts.id, i)");
  }, 60_000);

  it("a genuinely unknown field is STILL refused", async () => {
    // The relaxation is `id`-shaped, not a hole: everything else keeps the
    // strict field-list check that stops the generator emitting SQL against a
    // column that does not exist.
    const src = sys(
      `      criterion Bogus() of Part = this.nope == "x"\n      repository Parts for Part { find b(): Part[] where Bogus() }`,
    );
    const codes = await errors(src);
    expect(codes.length).toBeGreaterThan(0);
  });
});
