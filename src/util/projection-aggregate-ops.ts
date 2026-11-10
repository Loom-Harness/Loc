// The five whole-table aggregation operators a projection `select` names
// (`count`, `sum(a.x)`, …), shared by lowering and the typing pass's mirror of
// the query route's response shape.  Same vocabulary as the collection ops
// (docs/stdlib.md): a `select` position has no collection receiver, so the
// source table itself is the receiver.
export const PROJECTION_AGGREGATE_OPS: ReadonlySet<string> = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
]);
