// Write-time reference admission on the Drizzle repository's save
// (docs/tenancy.md → "Reference admission"; the decision lives in
// `src/ir/plan/ref-scope.ts`).
//
// Inside the save transaction, before the row is written, every reference the
// plan admits is probed against its target table under the target's own
// tenant restriction (`admissionFilter`: the `tenantOwned` floor, or the
// registry's self-scope), lowered exactly as the target's read scope lowers it.  A reference that
// does not resolve raises an error carrying Postgres' `foreign_key_violation`
// SQLSTATE, so every arm that already answers a dangling reference answers it
// the same way: a foreign tenant's row is indistinguishable from a missing one.

import {
  admissionFilter,
  admittedReferences,
  type ScopedReference,
} from "../../ir/plan/ref-scope.js";
import type {
  AggregateIR,
  BoundedContextIR,
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
} from "../../ir/types/loom-ir.js";
import { escapeTargetFieldMember } from "../../util/target-identifiers.js";
import { refuseOutOfVocabulary } from "../_expr/target.js";
import { PG_FOREIGN_KEY_VIOLATION } from "../_persistence/pg-sqlstate.js";
import { lowerToDrizzle, repoTableName } from "./repository-find-predicate.js";

/** The name of the module-level helper a repository with admitted references
 *  declares. */
const REFUSE = "referenceNotAdmitted";

/** True when `agg`'s save probes at least one reference. */
export function hasAdmittedReferences(agg: AggregateIR, ctx: BoundedContextIR): boolean {
  return admittedReferences(agg, ctx.aggregates).length > 0;
}

/** The module-level helper: the refusal a probe miss throws.  Empty when the
 *  aggregate admits no reference, so its repository is unchanged. */
export function refAdmissionHelper(agg: AggregateIR, ctx: BoundedContextIR): string[] {
  if (!hasAdmittedReferences(agg, ctx)) return [];
  return [
    "/** A reference outside the row's tenant.  It carries the foreign-key",
    " *  violation SQLSTATE, so it is answered exactly as a reference to a row",
    " *  that does not exist. */",
    `function ${REFUSE}(): Error {`,
    `  return Object.assign(new Error("The request references a record that does not exist."), { code: ${JSON.stringify(PG_FOREIGN_KEY_VIOLATION)} });`,
    "}",
    "",
  ];
}

/** The probe lines at the head of the save transaction body (6-space indent,
 *  `tx` in scope).  Empty when the aggregate admits no reference. */
export function refAdmissionLines(
  agg: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
): string[] {
  const refs = admittedReferences(agg, ctx.aggregates);
  const out: string[] = [];
  refs.forEach((r, i) => {
    const target = ctx.aggregates.find((a) => a.name === r.target)!;
    const tableName = repoTableName(target, ctx);
    const table = `schema.${tableName}`;
    const filter = admissionFilter(r, ctx.aggregates);
    const scope = filter
      ? (
          lowerToDrizzle(filter, tableName, ctx, { principalAccessor: "requireCurrentUser()" }) ??
          refuseOutOfVocabulary("drizzle-predicate", `reference admission on '${target.name}'`)
        ).expr
      : refuseOutOfVocabulary("drizzle-predicate", `reference admission on '${target.name}'`);
    const values = `admit${i}`;
    out.push(
      `      const ${values} = ${valuesExpr(r)};`,
      `      if (${values}.length > 0) {`,
      `        const found = await tx.select({ id: ${table}.id }).from(${table}).where(and(inArray(${table}.id, ${values}), ${scope}));`,
      `        if (new Set(found.map((row) => row.id as string)).size !== new Set(${values}).size) throw ${REFUSE}();`,
      `      }`,
    );
  });
  return out;
}

/** The reference values the row holds, as a `string[]` with absent ones
 *  dropped. */
function valuesExpr(r: ScopedReference): string {
  const member = (n: string): string => escapeTargetFieldMember("ts", n);
  if (r.via.length === 0) {
    return r.collection
      ? `(aggregate.${member(r.field)} ?? []).map((v) => v as string)`
      : `[aggregate.${member(r.field)}].filter((v) => v != null).map((v) => v as string)`;
  }
  let expr = "[aggregate]";
  for (const step of r.via) {
    const m = member(step.contain);
    expr += step.collection
      ? `.flatMap((o) => o.${m})`
      : `.flatMap((o) => (o.${m} == null ? [] : [o.${m}]))`;
  }
  const f = member(r.field);
  expr += r.collection ? `.flatMap((o) => o.${f} ?? [])` : `.map((o) => o.${f})`;
  return `${expr}.filter((v) => v != null).map((v) => v as string)`;
}
