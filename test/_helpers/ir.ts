import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  EnrichedLoomModel,
  EnrichedSystemIR,
  RawLoomModel,
} from "../../src/ir/types/loom-ir.js";
import type { Model } from "../../src/language/generated/ast.js";
import { parseString, parseValid } from "./parse.js";

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

/**
 * Lower + enrich a source the product REFUSES, for a test whose subject is the
 * lowering itself.  The IR twin of `generateSystemFilesUnchecked`, and it takes
 * a reason for the same purpose: this is the only record of why a fixture is
 * allowed to be one no user could compile.
 *
 * The motivating shape is a PROBE MEMBER — `lines.min(λ).p`, where `.p` exists
 * only so the derived expression lowers to a `member` node whose `receiverType`
 * the test can read.  That was silently fine while nothing checked member
 * membership; `loom.unknown-primitive-member` now refuses it, correctly (`.p`
 * is not a member of `money?` on any backend). The probe is still the clearest
 * way to assert a reduction's result type, so it stays — declared invalid
 * rather than quietly relying on a gap.
 */
export async function buildLoomModelUnchecked(
  source: string,
  why: string,
): Promise<EnrichedLoomModel> {
  if (why.trim().length < 15) {
    throw new Error(
      `buildLoomModelUnchecked needs a real reason, not "${why}" — it is the only ` +
        `record of why this fixture is allowed to be one the product refuses.`,
    );
  }
  const { model } = await parseString(source, { validate: false });
  return toLoomModel(model);
}

/** Every bounded context of an ENRICHED model, keeping the enriched type.
 *
 *  `allContexts` in `src/ir/types/loom-ir.ts` is declared `LoomModel →
 *  BoundedContextIR[]`, so every caller that starts from an
 *  `EnrichedLoomModel` silently loses the enriched fields — `eventSubscriptions`,
 *  the enriched `aggregates`/`valueObjects`, … — and reads them back off a type
 *  that does not declare them.  This walks the same two sources (system-bundled
 *  + top-level) without erasing the brand.  Handed off in `wave-c4-4b`: an
 *  overload pair on `allContexts` would remove the need for it. */
export const enrichedContexts = (loom: EnrichedLoomModel): EnrichedBoundedContextIR[] => [
  ...loom.systems.flatMap((s) => s.subdomains.flatMap((d) => d.contexts)),
  ...loom.contexts,
];

/** Every bounded context of ONE enriched system, in subdomain order.
 *
 *  `SystemIR` has no `contexts` field — contexts hang off its subdomains — so
 *  `sys.contexts ?? []` (which several suites wrote) is always the empty array,
 *  and every consumer fed by it silently got no contexts at all. */
export const systemContexts = (sys: EnrichedSystemIR): EnrichedBoundedContextIR[] =>
  sys.subdomains.flatMap((d) => d.contexts);

/** Every aggregate of an ENRICHED model — the enriched twin of `allAggregates`. */
export const enrichedAggregates = (loom: EnrichedLoomModel): EnrichedAggregateIR[] =>
  enrichedContexts(loom).flatMap((c) => c.aggregates);

/** Re-run enrichment over an ALREADY-enriched model.
 *
 *  Enrichment is idempotent by construction and several suites pin exactly
 *  that — but `enrichLoomModel` takes a `RawLoomModel`, whose `__phase?: "raw"`
 *  brand cannot hold the `"enriched"` one the first pass stamped, so the second
 *  application has no spelling that keeps the brand.  The widening lives here,
 *  once, instead of as a cast per idempotency test.  Handed off in
 *  `wave-c4-4b`: widening the parameter to `RawLoomModel | EnrichedLoomModel`
 *  in `src/ir/enrich/enrichments.ts` removes it. */
export const reEnrich = (loom: EnrichedLoomModel): EnrichedLoomModel =>
  enrichLoomModel(loom as unknown as RawLoomModel);
