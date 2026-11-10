// ---------------------------------------------------------------------------
// Feature atoms — which feature values (`src/util/target-capabilities.ts`
// `FEATURE_AXES`) an aggregate carries, read off the enriched IR.
//
// The capability table's feature-tuple rows are refused, and witnessed, at the
// aggregates that carry BOTH features of a tuple.  One detector per feature
// value, as a `Record` over the `Feature` union, so a new axis value cannot ship
// without the predicate that finds it.
// ---------------------------------------------------------------------------

import { type Feature, type FeatureTuple, tupleFeatures } from "../../util/target-capabilities.js";
import type { AggregateIR } from "../types/loom-ir.js";
import { type AggPool, baseOf, effectiveLayout } from "./inheritance.js";
import { aggregateIsEventSourced } from "./resolve-datasource.js";

type AtomDetector = (agg: AggregateIR, pool: AggPool) => boolean;

const hasCapability =
  (cap: string): AtomDetector =>
  (agg) =>
    agg.capabilities?.includes(cap) ?? false;

/** An inheritance participant on `layout`: the abstract base, or a subtype. */
const inHierarchy =
  (layout: "sharedTable" | "ownTable", role: "base" | "subtype"): AtomDetector =>
  (agg, pool) => {
    if (role === "base" && !agg.isAbstract) return false;
    if (role === "subtype" && !baseOf(agg, pool)) return false;
    return effectiveLayout(agg, pool) === layout;
  };

/** Whether an aggregate carries each feature value.  `persistence:document`
 *  reads the DECLARED saving shape: a `resource … shape: document` binding that
 *  re-shapes a whole context is not seen here. */
export const FEATURE_DETECTORS: Readonly<Record<Feature, AtomDetector>> = {
  "persistence:state": (agg) => !aggregateIsEventSourced(agg) && agg.savingShape !== "document",
  "persistence:eventLog": (agg) => aggregateIsEventSourced(agg),
  "persistence:document": (agg) => !aggregateIsEventSourced(agg) && agg.savingShape === "document",
  "capability:versioned": hasCapability("versioned"),
  "capability:softDeletable": hasCapability("softDeletable"),
  "capability:auditable": hasCapability("auditable"),
  "capability:tenantOwned": hasCapability("tenantOwned"),
  "capability:shareable": hasCapability("shareable"),
  "capability:provenanced": (agg) => agg.fields.some((f) => f.provenanced),
  "inheritance:tph-base": inHierarchy("sharedTable", "base"),
  "inheritance:tph-subtype": inHierarchy("sharedTable", "subtype"),
  "inheritance:tpc-base": inHierarchy("ownTable", "base"),
  "inheritance:tpc-subtype": inHierarchy("ownTable", "subtype"),
};

/** The aggregates of `pool` that carry both features of `tuple`. */
export function aggregatesWithTuple(tuple: FeatureTuple, pool: AggPool): readonly AggregateIR[] {
  const [a, b] = tupleFeatures(tuple);
  return pool.filter((agg) => FEATURE_DETECTORS[a](agg, pool) && FEATURE_DETECTORS[b](agg, pool));
}
