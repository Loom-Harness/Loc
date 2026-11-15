// `loom.requires-not-leading`: a `requires` past an operation body's leading
// run sits outside the gate ladder.  The warning fires only where moving the
// gate into the leading run keeps its meaning — it reads no field and no
// `let` — so the negatives are the substance.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

async function fired(op: string): Promise<string[]> {
  const src = `
  system S {
    user { id: guid  role: string }
    subdomain M { context C {
      aggregate A {
        total: int
        create(total: int) { total := total }
        ${op}
      }
      repository As for A { }
    } }
    storage pg { type: postgres }
    resource st { for: C, kind: state, use: pg }
    api Api from M
    deployable d { platform: node, contexts: [C], dataSources: [st], serves: Api, port: 3000, auth: required }
  }`;
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === "loom.requires-not-leading")
    .map((d) => d.message);
}

describe("loom.requires-not-leading", () => {
  it("fires on a principal or parameter gate after another statement", async () => {
    expect(
      await fired(
        `operation p(n: int) { total := total + 1\n requires currentUser.role == "agent" }`,
      ),
    ).toHaveLength(1);
    expect(await fired(`operation p(n: int) { total := total + 1\n requires n > 0 }`)).toEqual([
      expect.stringContaining("'requires n > 0' in A.p follows another statement"),
    ]);
  });

  it("stays quiet on the leading run, a row-reading gate and a gate on a local", async () => {
    expect(await fired(`operation p(n: int) { requires n > 0\n total := n }`)).toEqual([]);
    expect(await fired(`operation p(n: int) { total := n\n requires total < 100 }`)).toEqual([]);
    expect(
      await fired(`operation p(n: int) { let m = n * 2\n requires m < 100\n total := m }`),
    ).toEqual([]);
  });
});
