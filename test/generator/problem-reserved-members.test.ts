// A declared `error` record's fields ride the problem body as extension
// members, beside the RFC 7807 core and the `code` / `params` members every
// refusal carries (#4473).  A field named like one of those is overwritten on
// the wire by the problem member, so the published arm schema must not declare
// it (its value still reaches the client through `params`).  One shared set,
// `RFC7807_MEMBERS`, decides it for every backend.

import { describe, expect, it } from "vitest";
import { opUnionResponses } from "../../src/generator/_payload/union-wire.js";
import { buildLoomModel } from "../_helpers/index.js";

const SOURCE = `
system RM {
  subdomain D {
    context Shop {
      error Rejected { code: string, params: string, reason: string }
      aggregate Order {
        sku: string
        operation reject(): string or Rejected { return Rejected { code: sku, params: sku, reason: sku } }
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable d {
    platform: node
    contexts: [Shop]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

describe("problem body reserved members", () => {
  it("an error record field named code or params is not published as an arm field", async () => {
    const model = await buildLoomModel(SOURCE);
    const ctx = model.systems[0]!.subdomains[0]!.contexts[0]!;
    const op = ctx.aggregates[0]!.operations.find((o) => o.name === "reject")!;
    if (op.returnType?.kind !== "union") throw new Error("reject() must return a union");
    const split = opUnionResponses(op.returnType.variants, ctx);
    const rejected = split.errors.find((e) => e.tag === "Rejected")!;
    expect(rejected.fields.map((f) => f.name)).toEqual(["reason"]);
  });
});

describe("elixir problem_variant — the envelope wins over a same-named record field", () => {
  it("drops every reserved member from the record before merging the envelope", async () => {
    const { renderProblemVariantHelper } = await import(
      "../../src/generator/elixir/vanilla/operation-returns-emit.js"
    );
    const { RFC7807_MEMBERS } = await import("../../src/generator/_payload/union-wire.js");
    const helper = renderProblemVariantHelper();
    for (const m of RFC7807_MEMBERS) {
      expect(helper).toContain(`:${m}`);
      expect(helper).toContain(JSON.stringify(m));
    }
    // The envelope is the second argument of `Map.merge`, so it wins.
    expect(helper).toMatch(/Map\.merge\(\s*Map\.drop\(data, \[[^\]]*\]\),\s*%\{type: type/);
  });
});
