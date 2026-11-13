// Write-time reference admission on the JPA repository's save
// (docs/tenancy.md → "Reference admission"; the decision lives in
// `src/ir/plan/ref-scope.ts`).
//
// Before the row is written, every reference the plan marks `row-tenant` or
// `tenant-registry` is probed under the TARGET's read scope: a JPQL count of
// the target rows whose id is among the values, issued through the
// EntityManager, so the target entity's auto-enabled Hibernate `@Filter`s (the
// tenant floor, the registry self-scope, row rules, deny) and `@SQLRestriction`
// apply exactly as they do to a `findById` of the target.  A count short of the
// distinct values throws a `DataIntegrityViolationException` caused by a
// `foreign_key_violation` (23503) `SQLException`, which the controller advice's
// integrity arm already answers for a reference to a row that does not exist —
// so a row outside the target's read scope is indistinguishable from a missing
// one.  The probe runs with `FlushModeType.COMMIT`, so it never flushes the
// pending row it guards.  A write with no ambient principal (a seed, a system
// write) is unprobed, as it is unstamped.

import { admittedReferences, type ScopedReference } from "../../../ir/plan/ref-scope.js";
import type { AggregateIR } from "../../../ir/types/loom-ir.js";
import { PG_FOREIGN_KEY_VIOLATION } from "../../_persistence/pg-sqlstate.js";
import { jid } from "../java-ident.js";

/** The method the repository's `save` calls first. */
export const ADMIT_METHOD = "_admitReferences";

export interface RefAdmissionCtx {
  basePkg: string;
  schema?: string;
  pool?: readonly AggregateIR[];
}

/** True when `agg`'s save probes at least one reference. */
export function hasAdmittedReferences(agg: AggregateIR, ctx: RefAdmissionCtx): boolean {
  return admittedReferences(agg, ctx.pool ?? [agg]).length > 0;
}

/** The private `_admitReferences(aggregate)` method of the repository impl, at
 *  4-space indent.  Empty when the aggregate admits no reference. */
export function refAdmissionMethod(agg: AggregateIR, ctx: RefAdmissionCtx): string[] {
  const refs = admittedReferences(agg, ctx.pool ?? [agg]);
  if (refs.length === 0) return [];
  const out: string[] = [
    `    /** Refuses a reference outside the target's read scope exactly as one to a row`,
    `     *  that does not exist: the foreign-key violation the integrity advice answers. */`,
    `    private void ${ADMIT_METHOD}(${agg.name} aggregate) {`,
    `        if (${ctx.basePkg}.auth.CurrentUserAccessor.currentOrNull() == null) return;`,
  ];
  refs.forEach((r, i) => {
    const ids = `__ids${i}`;
    out.push(
      `        var ${ids} = ${valuesExpr(r)};`,
      `        if (!${ids}.isEmpty()) {`,
      `            var __found = ((Number) em.createQuery(${JSON.stringify(`select count(e) from ${r.target} e where e.id in :ids`)})`,
      `                .setFlushMode(jakarta.persistence.FlushModeType.COMMIT)`,
      `                .setParameter("ids", ${ids})`,
      `                .getSingleResult()).longValue();`,
      `            if (__found != ${ids}.size()) throw _referenceNotAdmitted();`,
      `        }`,
    );
  });
  out.push(
    `    }`,
    ``,
    `    private static org.springframework.dao.DataIntegrityViolationException _referenceNotAdmitted() {`,
    `        return new org.springframework.dao.DataIntegrityViolationException(`,
    `            "The request references a record that does not exist.",`,
    `            new java.sql.SQLException("reference not admitted", ${JSON.stringify(PG_FOREIGN_KEY_VIOLATION)}));`,
    `    }`,
    ``,
  );
  return out;
}

/** The reference values the row holds, as a distinct set of typed ids with
 *  absent ones dropped. */
function valuesExpr(r: ScopedReference): string {
  let expr = `java.util.stream.Stream.of(aggregate)`;
  for (const step of r.via) {
    const m = jid(step.contain);
    expr += step.collection
      ? `.flatMap(o -> o.${m}().stream())`
      : `.flatMap(o -> java.util.stream.Stream.ofNullable(o.${m}()))`;
  }
  const f = jid(r.field);
  expr += r.collection
    ? `.flatMap(o -> o.${f}() == null ? java.util.stream.Stream.empty() : o.${f}().stream())`
    : `.map(o -> o.${f}())`;
  return `${expr}.filter(java.util.Objects::nonNull).collect(java.util.stream.Collectors.toCollection(java.util.LinkedHashSet::new))`;
}
