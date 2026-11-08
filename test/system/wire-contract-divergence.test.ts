// The wire-shape / contract-record divergence census (M-T5.40, wave C4 packet 4e).
//
// Two things claim to describe an aggregate's READ wire:
//
//   DERIVED  — `forApiRead(wireFieldsForAggregate(agg))`, recomputed on demand
//              by `src/ir/enrich/wire-projection.ts`.  Every repository
//              `toWire` / serializer / `.loom/wire-spec.json` reads this.
//   DECLARED — the `<Agg>Response` / `<Part>Response` `response` record spliced
//              into every exposed context (the implicit `api X from <Sub>` /
//              deployable `contexts:` form, or `with scaffoldHandlers`).  Every
//              backend's response-DTO and schema emitter reads THIS, through
//              `declaredResponseFor`.
//
// Where they disagree, the two halves of one HTTP response disagree: the
// repository serialises the derived shape while the OpenAPI/zod/record DTO
// declares the record.  The census reads the corpus as written — the records
// are the ones the shipping path carries — and compares the two descriptions
// node by node.  The remaining rows are representational (a containment
// naming its `<Part>Response` record), which every emitter un-suffixes.
//
// It is a SHRINK-ONLY ratchet on the exact set of diverging nodes, so a new
// emitter or capability cannot widen the split silently.  Fixing a row means
// deleting it here.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import {
  forApiRead,
  wireFieldsForAggregate,
  wireFieldsForPart,
} from "../../src/ir/enrich/wire-projection.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { BoundedContextIR, TypeIR } from "../../src/ir/types/loom-ir.js";
import { declaredResponseFor } from "../../src/ir/util/declared-response.js";
import { dddSourceOf, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/parse.js";

/** How a node's two descriptions differ.  `missing` is the one that matters:
 *  the record does not mention a field the wire actually carries. */
type Divergence =
  | "missing-in-record"
  | "extra-in-record"
  | "containment-response-suffix"
  | "optional-containment-type"
  | "provenanced-carrier-lost"
  | "field-order";

/** The exact divergence set, measured 2026-09-22 on the C4 coordinator head.
 *  SHRINK-ONLY: a fix deletes its row. */
const BASELINE: Record<string, Divergence> = {
  // ── class B — the same field, described differently ─────────────────────
  // B1. a containment names the part's own `<Part>Response` record (context
  //     scope cannot reference a raw entity part), the derived shape names the
  //     part.  Deliberate; every DTO emitter already un-suffixes via
  //     `isResponsePayloadName`.  A re-derivation has to undo it.
  "collection-op-shapes.ddd Sales.Order": "containment-response-suffix",
  "core-domain.ddd Orders.Order": "containment-response-suffix",
  // acronym-names' `contains variants: VariantSKU[]` — the same deliberate B1 shape.
  "acronym-names.ddd Catalog.ProductSKU": "containment-response-suffix",
  // part-rules-private-op's `lines: Line[]` (an inferred containment) — the
  // same deliberate B1 shape.
  "part-rules-private-op.ddd Billing.Invoice": "containment-response-suffix",
  // (added with the RS-37 witness — a fixture carrying a containment, so the
  // same deliberate B1 shape; not a new divergence class.)
  "decimal-exact.ddd Lab.Sample": "containment-response-suffix",
  "document-collection-read.ddd Shop.Order": "containment-response-suffix",
  "document.ddd Cms.Article": "containment-response-suffix",
  "embedded.ddd Shop.Order": "containment-response-suffix",
  "field-mask.ddd Staff.Employee": "containment-response-suffix",
  "single-containment.ddd Shop.Order": "containment-response-suffix",
  // M-T6.94's two removal fixtures: a containment (`lines`) and a NESTED one
  // (`Line.notes`), so both the root and the part carry the deliberate B1 suffix.
  "contained-part-removal.ddd Carts.Cart": "containment-response-suffix",
  "contained-part-removal.ddd Carts.Cart.Line": "containment-response-suffix",
  "contained-part-rebuild.ddd Carts.Cart": "containment-response-suffix",
  "contained-part-rebuild.ddd Carts.Cart.Line": "containment-response-suffix",
  // (M-T6.90 two-handles fixture — a containment, the same deliberate B1 shape.)
  "workflow-two-handles-containment.ddd Carts.Cart": "containment-response-suffix",
  // B2. as B1, plus: an OPTIONAL single containment is `optional<MemoResponse>`
  //     in the record and `Memo` + the `optional` FLAG in the derived shape —
  //     the same fact in two representations.
  "embedded-optional.ddd Shop.Order": "optional-containment-type",
  // B3. `provenanced<T>` — `wireTypeForField` wraps a provenanced field in the
  //     carrier for the wire; the record declares the bare `T`, so the
  //     scaffolded response DTO understates what the serializer emits.
  "provenance.ddd Ordering.Order": "provenanced-carrier-lost",
  "provenance-money.ddd Leasing.Lease": "provenanced-carrier-lost",
  "if-branch-shapes.ddd Orders.Tally": "provenanced-carrier-lost",
};

/** The comparable identity of one wire row.  Deliberately narrow: the two
 *  sides are different types (`WireField` vs the record's `FieldIR`) and only
 *  name + type + nullability are common to both — which is exactly the tuple a
 *  DTO emitter renders. */
const key = (w: { name: string; type: TypeIR; optional?: boolean }): string =>
  `${w.name}:${JSON.stringify(w.type)}:${w.optional ? "?" : "!"}`;

function classify(derived: string[], declared: string[]): Divergence | undefined {
  if (JSON.stringify(derived) === JSON.stringify(declared)) return undefined;
  const dOnly = derived.filter((x) => !declared.includes(x));
  const rOnly = declared.filter((x) => !derived.includes(x));
  if (dOnly.length === 0 && rOnly.length === 0) return "field-order";
  if (rOnly.length === 0) return "missing-in-record";
  if (dOnly.length === 0) return "extra-in-record";
  // Both sides name the field; the difference is in its TYPE.  If any row is
  // named on one side only, the split is a field set difference, not a typing
  // one — report it by direction rather than mislabelling it a type mismatch.
  const dNames = new Set(dOnly.map((x) => x.split(":")[0]));
  const rNames = new Set(rOnly.map((x) => x.split(":")[0]));
  if (rOnly.some((x) => !dNames.has(x.split(":")[0]))) return "extra-in-record";
  if (dOnly.some((x) => !rNames.has(x.split(":")[0]))) return "missing-in-record";
  if (rOnly.some((x) => x.includes('"kind":"optional"'))) return "optional-containment-type";
  if (dOnly.some((x) => x.includes('"ctor":"provenanced"'))) return "provenanced-carrier-lost";
  return "containment-response-suffix";
}

/** Every `test/fixtures/corpus/*.ddd`, as written.  Each exposes its contexts
 *  through the implicit `api X from <Subdomain>` form, which splices the same
 *  contract records `with scaffoldHandlers` does — so the census measures the
 *  records the shipping path actually carries, with nothing injected. */
function corpusFixtures(): { name: string; source: string }[] {
  return trackedDddFiles()
    .filter((f) => f.startsWith("test/fixtures/corpus/") && f.endsWith(".ddd"))
    .map((f) => ({ name: f.slice("test/fixtures/corpus/".length), source: dddSourceOf(f) }));
}

async function census(): Promise<{
  found: Record<string, Divergence>;
  nodes: number;
  uncontracted: string[];
  derivedFallback: string[];
}> {
  const found: Record<string, Divergence> = {};
  const uncontracted: string[] = [];
  const derivedFallback: string[] = [];
  let nodes = 0;
  for (const { name, source } of corpusFixtures()) {
    const { model, errors } = await parseString(source, { validate: true });
    // A fixture that stops parsing would silently leave the census, which is
    // how a denominator rots.
    expect(errors, `${name}: corpus fixture must parse`).toEqual([]);
    const enriched = enrichLoomModel(lowerModel(model));
    const contexts: BoundedContextIR[] = [...enriched.contexts];
    for (const sys of enriched.systems)
      for (const sd of sys.subdomains) contexts.push(...sd.contexts);
    for (const ctx of contexts) {
      const byName = new Map(ctx.payloads.map((p) => [p.name, p]));
      for (const agg of ctx.aggregates) {
        const derived = forApiRead(wireFieldsForAggregate(agg)).map(key);
        const rec = byName.get(`${agg.name}Response`);
        if (!rec) uncontracted.push(`${name} ${ctx.name}.${agg.name}`);
        if (rec && !declaredResponseFor(ctx.payloads, agg)) {
          derivedFallback.push(`${name} ${ctx.name}.${agg.name}`);
        }
        if (rec) {
          nodes++;
          // The record omits the grammar-reserved `id` row; re-prepend it so the
          // comparison is of the fields the record actually chose to carry.
          const d = classify(derived, [derived[0], ...rec.fields.map(key)]);
          if (d) found[`${name} ${ctx.name}.${agg.name}`] = d;
        }
        for (const part of agg.parts) {
          const prec = byName.get(`${part.name}Response`);
          if (!prec) {
            uncontracted.push(`${name} ${ctx.name}.${agg.name}.${part.name}`);
            continue;
          }
          nodes++;
          const pd = forApiRead(wireFieldsForPart(part)).map(key);
          const d = classify(pd, [pd[0], ...prec.fields.map(key)]);
          if (d) found[`${name} ${ctx.name}.${agg.name}.${part.name}`] = d;
        }
      }
    }
  }
  return { found, nodes, uncontracted, derivedFallback };
}

/** Nodes the scaffold contracts NOTHING for.  A node with no record is invisible
 *  to the comparison above, so this list is the census's blind spot and is
 *  pinned exactly — a growing blind spot would shrink the divergence count
 *  without anything being fixed. */
const UNCONTRACTED: string[] = [];

/** Aggregates whose record exists but which the response emitters still render
 *  from the derived shape: a record field cannot carry `mask unless`, so
 *  `declaredResponseFor` keeps a masked aggregate on the derived path (which
 *  does carry the predicate).  Pinned exactly so the gap stays visible; it
 *  closes when records carry `mask unless` (#4816) and this list empties. */
const DERIVED_FALLBACK = [
  "audit-history-guarded.ddd Staff.Employee",
  "audit-history-guarded.ddd Staff.Payslip",
  "field-mask.ddd Staff.Employee",
];

describe("wire shape vs. the declared response contract (M-T5.40 census)", () => {
  it("diverges on exactly the baselined nodes — shrink-only", async () => {
    const { found, nodes, uncontracted, derivedFallback } = await census();

    // The denominator: a census over an empty population proves nothing, and a
    // node the scaffold never contracts is one the comparison cannot see.
    expect(nodes).toBeGreaterThanOrEqual(120);
    expect(uncontracted.sort()).toEqual(UNCONTRACTED);
    expect(derivedFallback.sort()).toEqual(DERIVED_FALLBACK);

    const fixed = Object.keys(BASELINE).filter((k) => !(k in found));
    expect(
      fixed,
      "these nodes no longer diverge — delete their BASELINE rows (the ratchet only shrinks)",
    ).toEqual([]);

    const novel = Object.keys(found).filter((k) => !(k in BASELINE));
    expect(
      novel.map((k) => `${k} → ${found[k]}`),
      "new wire/contract divergence — the scaffolded response DTO now describes a different shape than the serializer emits",
    ).toEqual([]);

    const reclassified = Object.keys(found)
      .filter((k) => k in BASELINE && found[k] !== BASELINE[k])
      .map((k) => `${k}: ${BASELINE[k]} → ${found[k]}`);
    expect(reclassified, "a baselined node diverges for a DIFFERENT reason now").toEqual([]);
  }, 120_000);
});
