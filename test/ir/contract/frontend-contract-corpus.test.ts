// The Frontend Contract over every tracked `.ddd` model the validators accept.
//
// Each model's contract must build — no denied construct, no unclassified
// field reached from a UI body or the wire surface — and must be JSON-exact:
// equal to its own `JSON.parse(JSON.stringify(…))`, so the bytes a frontend
// target reads carry everything the in-memory value does.  A floor on the
// population that carries a UI keeps the sweep from passing vacuously.

import { describe, expect, it } from "vitest";
import { buildFrontendContracts } from "../../../src/ir/contract/frontend-contract.js";
import { dddSourceOf, trackedDddFiles } from "../../_helpers/ddd-corpus.js";
import { toLoomModel } from "../../_helpers/ir.js";
import { parseString } from "../../_helpers/parse.js";

describe("Frontend Contract over the corpus", () => {
  it("builds a JSON-exact contract for every model", async () => {
    const failures: string[] = [];
    let withUi = 0;
    let built = 0;
    for (const file of trackedDddFiles()) {
      const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
      if (errors.length > 0) continue;
      try {
        for (const contract of buildFrontendContracts(toLoomModel(model))) {
          built++;
          if (contract.ui.uis.some((u) => u.pages.length > 0)) withUi++;
          const roundTrip = JSON.parse(JSON.stringify(contract));
          if (!isDeepStrictEqual(roundTrip, contract)) failures.push(`${file}: not JSON-exact`);
        }
      } catch (e) {
        failures.push(`${file}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
    expect(built).toBeGreaterThan(550);
    expect(withUi).toBeGreaterThan(120);
  }, 900_000);
});

function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b) && sameShape(a, b);
}

/** Strict structural equality: `undefined` values and `undefined` array slots
 *  count, which `JSON.stringify` alone would hide. */
function sameShape(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameShape(x, b[i]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
