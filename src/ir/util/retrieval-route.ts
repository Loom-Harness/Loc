import type { RetrievalRouteTarget } from "../../util/retrieval-route.js";
import type { AggregateIR } from "../types/loom-ir.js";

/** The route-deciding facts of an IR aggregate (see `retrievalRouteServed`). */
export function retrievalRouteTargetOf(agg: AggregateIR): RetrievalRouteTarget {
  return {
    eventLog: agg.persistedAs === "eventLog",
    shape: agg.savingShape,
    extendsBase: agg.extendsAggregate !== undefined,
    abstract: agg.isAbstract === true,
  };
}
