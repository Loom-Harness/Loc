import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type {
  AggregateIR,
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  EnrichedLoomModel,
  EnrichedSystemIR,
  EntityPartIR,
  RawLoomModel,
  WireField,
} from "../../src/ir/types/loom-ir.js";
import { responseWireFor } from "../../src/ir/util/response-wire.js";
import type { Model } from "../../src/language/generated/ast.js";
import { withBackendSystem } from "./backend-system.js";
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

/** The API-read wire rows of an aggregate or entity part, read from the declared
 *  `<X>Response` record of its owning context in `loom`.  The context must be
 *  hosted by a deployable (that is what declares the records); asking about an
 *  unhosted one throws, as `responseWireFor` does. */
export function responseRows(
  loom: EnrichedLoomModel,
  ent: AggregateIR | EntityPartIR,
): WireField[] {
  for (const ctx of enrichedContexts(loom)) {
    const owns = ctx.aggregates.some((a) => a === ent || a.parts.some((p) => p === ent));
    if (owns) return responseWireFor(ctx.payloads, ent);
  }
  throw new Error(`responseRows: no context owns '${ent.name}'`);
}

/** Host every context of `source` on one node deployable so the model carries the
 *  declared `<X>Response` records `responseRows` reads.  A source with no
 *  `system` is wrapped by `withBackendSystem`; one with a `system` gets the
 *  storage, resources and deployable spliced in before the system's closing brace. */
export function hostSource(source: string): string {
  const open = /^\s*system\s+[A-Z]\w*[^{]*\{/m.exec(source);
  if (!open) return withBackendSystem(source, "node").source;
  let depth = 1;
  let i = open.index + open[0].length;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") depth--;
  }
  const close = i - 1;
  const body = source.slice(open.index, close);
  const names = [...body.matchAll(/\bcontext\s+([A-Z]\w*)\b[^{\n]*\{/g)].map((m) => m[1]!);
  const eventLog = /persistedAs:\s*eventLog/.test(body);
  const lower = (c: string) => c.charAt(0).toLowerCase() + c.slice(1);
  const resources = names.flatMap((c) => [
    `  resource ${lower(c)}HostState { for: ${c}, kind: state, use: hostDb }`,
    ...(eventLog
      ? [`  resource ${lower(c)}HostLog { for: ${c}, kind: eventLog, use: hostDb }`]
      : []),
  ]);
  const sources = names.flatMap((c) => [
    `${lower(c)}HostState`,
    ...(eventLog ? [`${lower(c)}HostLog`] : []),
  ]);
  const splice = [
    "  storage hostDb { type: postgres }",
    ...resources,
    "  deployable hostApi {",
    "    platform: node",
    `    contexts: [${names.join(", ")}]`,
    `    dataSources: [${sources.join(", ")}]`,
    "    port: 8080",
    "  }",
    "",
  ].join("\n");
  return source.slice(0, close) + splice + source.slice(close);
}

/** `buildLoomModel` over `hostSource(source)`: the model's contexts are hosted, so
 *  `responseRows` can read their declared response records. */
export async function buildHostedModel(source: string): Promise<EnrichedLoomModel> {
  return buildLoomModel(hostSource(source));
}
