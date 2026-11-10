// The registry tree on `persistence: mikroorm` validates clean — no diagnostic,
// no silent unscoping: the tenant floor is an ordinary FilterQuery, and an
// unlowerable principal filter crashes codegen rather than vanishing.  The
// runtime agreement is `test/e2e/tenancy-hierarchy-mikroorm.test.ts`.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";
import { corpusSource } from "../fixtures/corpus/harness.js";

async function errorsFor(platform: string): Promise<string[]> {
  const src = corpusSource("tenancy-hierarchy").replaceAll("__PLATFORM__", platform);
  const { model, errors } = await parseString(src, { validate: true });
  if (errors.length > 0) return errors;
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}`);
}

describe("the registry tree × the mikroorm adapter", () => {
  it("validates clean", async () => {
    expect(await errorsFor("node { persistence: mikroorm }")).toEqual([]);
  });

  it("still generates clean on the default adapter", async () => {
    expect(await errorsFor("node")).toEqual([]);
  });
});
