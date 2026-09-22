// The wire-shape / contract-record divergence census (M-T5.39, wave C4 packet 4e).
//
// Two things claim to describe an aggregate's READ wire today:
//
//   DERIVED  — `forApiRead(wireFieldsForAggregate(agg))`, recomputed on demand
//              by `src/ir/enrich/wire-projection.ts`.  Every repository
//              `toWire` / serializer / `.loom/wire-spec.json` reads this.
//   DECLARED — the `<Agg>Response` / `<Part>Response` `response` record that
//              `with scaffoldHandlers` splices into the context as real source
//              (M-T5.10 PR1 #1900).  Since PR2–PR7 every backend's response-DTO
//              and schema emitter reads THIS instead.
//
// PR1 landed the records as "inert — byte-identical with vs without", and that
// was true of the fixture it was measured on.  It is not true in general: this
// census injects `with scaffoldHandlers` into every corpus fixture (the only
// way to materialise the records, since NO tracked `.ddd` outside the five
// `scaffold-handlers` compile fixtures uses the macro) and compares the two
// descriptions node by node.
//
// Where they disagree, the two halves of one HTTP response disagree: the
// repository serialises the derived shape while the OpenAPI/zod/record DTO
// declares the record.  Measured on `platform: node`:
//
//   aggregate Order with softDeletable   →  toWire {id,code,status,deletedAt,version}
//                                           OrderResponse {id,code,status,version}
//   aggregate Customer extends Party     →  toWire {id,name,email,tier,version}
//                                           CustomerResponse {id,tier,version}
//
// So this file is NOT a "these should match" assertion — they do not, and
// closing the gap is M-T5.39's job.  It is a SHRINK-ONLY ratchet on the exact
// set of diverging nodes, so (a) the retirement mission has a measured
// denominator instead of an estimate, and (b) a new emitter or capability
// cannot widen the split silently.  Fixing a row means deleting it here.
//
// The baseline is exact per node: a row that stops diverging must be removed,
// and a node that starts diverging fails.  See
// `docs/new-plan/waves/handoffs/wave-c4-4e-wireshape.md` for the class-by-class
// reading of the rows below.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import {
  forApiRead,
  wireFieldsForAggregate,
  wireFieldsForPart,
} from "../../src/ir/enrich/wire-projection.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { BoundedContextIR, TypeIR } from "../../src/ir/types/loom-ir.js";
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
  // ── class A — the record OMITS a field the wire carries ──────────────────
  // A1. capability-injected fields (`softDeletable` / `auditable` /
  //     `tenantRegistry` prelude mixins) reach the derived walk but not the
  //     AST-level `apiReadFields` the record is built from.
  "find-bypass.ddd Orders.Order": "missing-in-record",
  "find-bypass.ddd Orders.Note": "missing-in-record",
  "projection-agg-filters.ddd Orders.Order": "missing-in-record",
  "scaffold-macros.ddd Catalog.Item": "missing-in-record",
  "stamps.ddd Shop.Order": "missing-in-record",
  "policy-document.ddd Registry.Org": "missing-in-record",
  "tenancy-hierarchy.ddd Books.Org": "missing-in-record",
  // A2. fields inherited from an `abstract aggregate` base.  Enrichment merges
  //     the extends chain into the concrete; the record's walk does not — the
  //     coordination note's item 3 (`aggregate-inheritance.md` I2, "the chain
  //     walk has two consumers"), now measured rather than predicted.
  "inheritance.ddd Parties.Customer": "missing-in-record",
  "inheritance.ddd Parties.Vendor": "missing-in-record",
  "inheritance.ddd Parties.Machine": "missing-in-record",
  "inheritance.ddd Parties.Vehicle": "missing-in-record",
  "tph.ddd Fleet.Car": "missing-in-record",
  "tph.ddd Fleet.Truck": "missing-in-record",
  "tph-crossings.ddd Depot.Parcel": "missing-in-record",
  "tph-crossings.ddd Depot.Crate": "missing-in-record",

  // ── class B — the same field, described differently ─────────────────────
  // B1. a containment names the part's own `<Part>Response` record (context
  //     scope cannot reference a raw entity part), the derived shape names the
  //     part.  Deliberate; every DTO emitter already un-suffixes via
  //     `isResponsePayloadName`.  A re-derivation has to undo it.
  "collection-op-shapes.ddd Sales.Order": "containment-response-suffix",
  "core-domain.ddd Orders.Order": "containment-response-suffix",
  "document-collection-read.ddd Shop.Order": "containment-response-suffix",
  "document.ddd Cms.Article": "containment-response-suffix",
  "embedded.ddd Shop.Order": "containment-response-suffix",
  "field-mask.ddd Staff.Employee": "containment-response-suffix",
  "single-containment.ddd Shop.Order": "containment-response-suffix",
  // B2. as B1, plus: an OPTIONAL single containment is `optional<MemoResponse>`
  //     in the record and `Memo` + the `optional` FLAG in the derived shape —
  //     the same fact in two representations.
  "embedded-optional.ddd Shop.Order": "optional-containment-type",
  // B3. `provenanced<T>` — `wireTypeForField` wraps a provenanced field in the
  //     carrier for the wire; the record declares the bare `T`, so the
  //     scaffolded response DTO understates what the serializer emits.
  "provenance.ddd Ordering.Order": "provenanced-carrier-lost",

  // ── class C — same field set, different ORDER ───────────────────────────
  // The derived walk is id → properties → containments → derived, and the
  // `versioned` capability's `version` is a PROPERTY, so it precedes the
  // containment; the record's walk appends it after.  Order is the wire
  // contract for every positional DTO (.NET / Java records, F# records).
  "part-rules-private-op.ddd Billing.Invoice": "field-order",
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

/** Every `test/fixtures/corpus/*.ddd`, with `with scaffoldHandlers` injected on
 *  each plain `context X {` so the contract-record layer actually materialises. */
function corpusFixtures(): { name: string; source: string }[] {
  return trackedDddFiles()
    .filter((f) => f.startsWith("test/fixtures/corpus/") && f.endsWith(".ddd"))
    .map((f) => ({
      name: f.slice("test/fixtures/corpus/".length),
      source: dddSourceOf(f).replace(/^(\s*context\s+\w+)\s*\{/gm, "$1 with scaffoldHandlers {"),
    }));
}

async function census(): Promise<{
  found: Record<string, Divergence>;
  nodes: number;
  uncontracted: string[];
}> {
  const found: Record<string, Divergence> = {};
  const uncontracted: string[] = [];
  let nodes = 0;
  for (const { name, source } of corpusFixtures()) {
    const { model, errors } = await parseString(source, { validate: true });
    // Injection must never break a fixture — a fixture that stops parsing would
    // silently leave the census, which is how a denominator rots.
    expect(errors, `${name}: scaffoldHandlers injection must parse`).toEqual([]);
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
  return { found, nodes, uncontracted };
}

/** Nodes the scaffold contracts NOTHING for.  A node with no record is invisible
 *  to the comparison above, so this list is the census's blind spot and is
 *  pinned exactly — a growing blind spot would shrink the divergence count
 *  without anything being fixed. */
const UNCONTRACTED = [
  // `contractRecords` walks the aggregate's containment closure for part
  // records; this part is reachable only through a PRIVATE operation's rules,
  // so no `<Part>Response` is minted while the derived walk still wires it.
  "part-rules-private-op.ddd Billing.Invoice.Line",
];

describe("wire shape vs. the declared response contract (M-T5.39 census)", () => {
  it("diverges on exactly the baselined nodes — shrink-only", async () => {
    const { found, nodes, uncontracted } = await census();

    // The denominator: a census over an empty population proves nothing, and a
    // node the scaffold never contracts is one the comparison cannot see.
    expect(nodes).toBeGreaterThanOrEqual(120);
    expect(uncontracted.sort()).toEqual(UNCONTRACTED);

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
