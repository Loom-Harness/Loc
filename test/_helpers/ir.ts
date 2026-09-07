import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { EnrichedLoomModel } from "../../src/ir/types/loom-ir.js";
import type { Model } from "../../src/language/generated/ast.js";
import { parseValid } from "./parse.js";

/** Lower + enrich an already-parsed AST Model into the canonical Loom IR.
 *
 *  Returns `EnrichedLoomModel`, not `LoomModel`.  It always did — `enrichLoomModel`
 *  brands its result — but the annotation used to widen it back to the un-enriched
 *  type, which discarded the brand for all 124 dependent test files.  The
 *  consequence was invisible while `test/` went untypechecked: every call that
 *  handed the result to a consumer whose entry point takes an `Enriched*` type
 *  (the validator, the system orchestrator, every generator) was a type error
 *  nobody could see — 89 of them in `migrations-builder.test.ts` alone, all one
 *  `SubdomainIR` vs `EnrichedSubdomainIR` mismatch. */
export const toLoomModel = (model: Model): EnrichedLoomModel => enrichLoomModel(lowerModel(model));

/**
 * Parse a `.ddd` string, assert it validates, then lower + enrich to IR.
 * This is the canonical parse → lower → enrich path every backend consumes.
 */
export async function buildLoomModel(source: string): Promise<EnrichedLoomModel> {
  return toLoomModel(await parseValid(source));
}
