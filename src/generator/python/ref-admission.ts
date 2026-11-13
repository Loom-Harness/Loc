// Write-time reference admission on the SQLAlchemy repository's save
// (docs/tenancy.md → "Reference admission"; the decision lives in
// `src/ir/plan/ref-scope.ts`).
//
// At the head of `save`, before the row is written, every reference the plan
// marks `row-tenant` or `tenant-registry` is probed against its target table.
// The target's own tenant restriction is not spelled in the probe: the
// read-scope hook (`app/db/read_scope.py`) adds it to every ORM select, so the
// probe resolves in exactly the rows the target's reads serve — the
// `tenantOwned` floor, or the registry's self-scope — under the principal's
// operating organization.  A reference that does not resolve raises an
// `IntegrityError` whose driver error carries Postgres' `foreign_key_violation`
// SQLSTATE, so the app-wide integrity handler answers it exactly as it answers
// a reference to a row that does not exist: a foreign tenant's row is
// indistinguishable from a missing one.

import { admittedReferences, type ScopedReference } from "../../ir/plan/ref-scope.js";
import type { AggregateIR, BoundedContextIR } from "../../ir/types/loom-ir.js";
import { tableOwnerName } from "../../ir/util/inheritance.js";
import { pythonIdent } from "../../util/naming.js";
import { pyRef } from "../_imports/python.js";
import { PG_FOREIGN_KEY_VIOLATION } from "../_persistence/pg-sqlstate.js";
import { rowClassName } from "./py-columns.js";

const R = {
  select: pyRef("sqlalchemy", "select"),
  IntegrityError: pyRef("sqlalchemy.exc", "IntegrityError"),
};
const schemaRow = (name: string): string => pyRef("app.db.schema", name);

/** The module-level refusal helper's name. */
const REFUSE = "_reference_not_admitted";

/** True when `agg`'s save probes at least one reference. */
export function hasAdmittedReferences(agg: AggregateIR, ctx: BoundedContextIR): boolean {
  return admittedReferences(agg, ctx.aggregates).length > 0;
}

/** The module-level helper: the refusal a probe miss raises.  Empty when the
 *  aggregate admits no reference, so its repository is unchanged. */
export function pyRefAdmissionHelper(agg: AggregateIR, ctx: BoundedContextIR): string[] {
  if (!hasAdmittedReferences(agg, ctx)) return [];
  return [
    "class _ForeignKeyViolation(Exception):",
    '    """The driver-level error a reference outside the row\'s tenant reports:',
    '    the foreign-key violation SQLSTATE, so it is answered as a missing row."""',
    "",
    `    sqlstate = ${JSON.stringify(PG_FOREIGN_KEY_VIOLATION)}`,
    "",
    "",
    `def ${REFUSE}() -> ${R.IntegrityError}:`,
    `    return ${R.IntegrityError}("reference outside the row's tenant", None, _ForeignKeyViolation())`,
    "",
    "",
  ];
}

/** The probe lines at the head of `save` (8-space indent).  `aggVar` names the
 *  aggregate parameter.  Empty when the aggregate admits no reference. */
export function pyRefAdmissionLines(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  aggVar: string,
): string[] {
  const out: string[] = [];
  admittedReferences(agg, ctx.aggregates).forEach((r, i) => {
    const values = `admit${i}`;
    const target = ctx.aggregates.find((a) => a.name === r.target)!;
    const row = schemaRow(rowClassName(tableOwnerName(target, ctx.aggregates)));
    out.push(
      `        ${values} = ${valuesExpr(r, aggVar)}`,
      `        if ${values}:`,
      "            found = (",
      "                await self._session.execute(",
      `                    ${R.select}(${row}.id).where(${row}.id.in_(list(${values})))`,
      "                )",
      "            ).scalars().all()",
      `            if len(set(found)) != len(${values}):`,
      `                raise ${REFUSE}()`,
    );
  });
  return out;
}

/** The distinct reference values the row holds, as a `set` with absent ones
 *  dropped. */
function valuesExpr(r: ScopedReference, aggVar: string): string {
  const field = pythonIdent(r.field);
  let owners = `[${aggVar}]`;
  r.via.forEach((step, i) => {
    const m = pythonIdent(step.contain);
    owners = step.collection
      ? `[c${i} for o${i} in ${owners} for c${i} in o${i}.${m}]`
      : `[c${i} for o${i} in ${owners} if o${i}.${m} is not None for c${i} in [o${i}.${m}]]`;
  });
  return r.collection
    ? `{v for o in ${owners} for v in (o.${field} or [])}`
    : `{o.${field} for o in ${owners} if o.${field} is not None}`;
}
