import type { ProjectionIR } from "../../ir/types/loom-ir.js";

// ---------------------------------------------------------------------------
// The wire fields a query-time projection reads THROUGH a `join` alias
// (`select customerName = c.name` under `join Customer as c on …`).
//
// RS-34: a join is LEFT, so when the target is absent from its own bulk-load
// (soft-deleted, out of tenant, dangling) the source row still ships and every
// such field is wire `null`.  Each backend's response model therefore has to
// ADMIT null on exactly these members — a non-nullable one turns the LEFT JOIN
// into a 500 (FastAPI response validation, a java `int` unboxing `null`) or
// into a type's zero value (.NET `default!` on an `int` reads `0`).  One
// derivation, three consumers (.NET / java / python), so the three row models
// cannot disagree about which members are nullable.
// ---------------------------------------------------------------------------

/** The `select` field names whose expression is a member read off a join
 *  alias.  Empty when the projection declares no `join`. */
export function joinReadFieldNames(proj: ProjectionIR): ReadonlySet<string> {
  const aliases = new Set((proj.query?.joins ?? []).map((j) => j.alias));
  if (aliases.size === 0) return new Set();
  return new Set(
    (proj.query?.selects ?? [])
      .filter(
        (s) =>
          s.expr.kind === "member" &&
          s.expr.receiver.kind === "ref" &&
          aliases.has(s.expr.receiver.name),
      )
      .map((s) => s.field),
  );
}
