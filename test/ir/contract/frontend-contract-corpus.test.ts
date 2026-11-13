// The Frontend Contract over every tracked `.ddd` model the validators accept.
//
// 1. Each model's contract builds — no denied construct, no unclassified field
//    reached from a UI body or the wire surface — and is JSON-exact: equal to
//    its own `JSON.parse(JSON.stringify(…))`, so the bytes a frontend target
//    reads carry everything the in-memory value does.
// 2. The serialized bytes carry nothing beyond the exposed wire/API surface
//    (`test/_helpers/frontend-contract-surface.ts`): no field, record, type
//    edge or member read the generated client does not already receive, and a
//    mask only as its `maskable` flag.
//
// One sweep feeds both; a floor on the population that carries a UI keeps it
// from passing vacuously.

import { beforeAll, describe, expect, it } from "vitest";
import {
  buildFrontendContract,
  type FrontendContract,
} from "../../../src/ir/contract/frontend-contract.js";
import type { EnrichedLoomModel, EnrichedSystemIR } from "../../../src/ir/types/loom-ir.js";
import { dddSourceOf, trackedDddFiles } from "../../_helpers/ddd-corpus.js";
import { surfaceViolations } from "../../_helpers/frontend-contract-surface.js";
import { toLoomModel } from "../../_helpers/ir.js";
import { parseString } from "../../_helpers/parse.js";

interface Built {
  file: string;
  model: EnrichedLoomModel;
  sys: EnrichedSystemIR;
  contract: FrontendContract;
}

/** Models the gate refuses for a defect elsewhere, each with its issue. */
const KNOWN_OFF_WIRE: Record<string, string> = {
  // A ui scaffolds a subdomain no deployable serves; validation accepts it.
  "test/fixtures/eval-models/eval/repro/ui-scaffolds-unserved-subdomain.ddd": "#5698",
};

const built: Built[] = [];
const buildFailures: string[] = [];

beforeAll(async () => {
  for (const file of trackedDddFiles()) {
    const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
    if (errors.length > 0) continue;
    const loom = toLoomModel(model);
    for (const sys of loom.systems) {
      try {
        built.push({ file, model: loom, sys, contract: buildFrontendContract(loom, sys) });
      } catch (e) {
        buildFailures.push(`${file}: ${(e as Error).message}`);
      }
    }
  }
}, 900_000);

describe("Frontend Contract over the corpus", () => {
  it("builds a JSON-exact contract for every model", () => {
    expect(buildFailures).toEqual([]);
    const inexact = built
      .filter(({ contract }) => !sameShape(JSON.parse(JSON.stringify(contract)), contract))
      .map(({ file }) => file);
    expect(inexact).toEqual([]);
    expect(built.length).toBeGreaterThan(550);
    expect(
      built.filter((b) => b.contract.ui.uis.some((u) => u.pages.length > 0)).length,
    ).toBeGreaterThan(120);
  });

  it("serializes nothing beyond the exposed wire/API surface", () => {
    const leaking = new Set<string>();
    const leaks = built.flatMap(({ file, model, sys, contract }) => {
      const found = surfaceViolations(model, sys, JSON.stringify(contract));
      if (found.length > 0) leaking.add(file);
      return KNOWN_OFF_WIRE[file] ? [] : found.map((v) => `${file}: ${v}`);
    });
    expect(leaks).toEqual([]);
    // The waiver ratchets: an entry whose model now passes must be deleted.
    expect(Object.keys(KNOWN_OFF_WIRE).filter((f) => !leaking.has(f))).toEqual([]);
  });
});

/** Strict structural equality: `undefined` values and `undefined` array slots
 *  count, which comparing two `JSON.stringify` outputs would hide. */
function sameShape(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameShape(x, b[i]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) =>
    sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}
