// `app/db/read_scope.py` — every declared read restriction, applied by ONE
// SQLAlchemy ORM hook rather than ANDed into each repository read.
//
// The restrictions are the `readScope` fact (`src/ir/enrich/read-scope.ts`):
// capability filters (inherited from an abstract base included), the tenancy
// floor, `policy` deny carve-outs and bare `filter`s.  SQLAlchemy's native
// global-criteria mechanism is a `do_orm_execute` listener on `Session` that
// adds `with_loader_criteria(<RowClass>, …)` to each ORM SELECT; the criteria
// reach every occurrence of the entity in the statement — `select(Row)`,
// `select(func.count()).select_from(Row)`, a column select, a subquery, an
// `exists()` — so no read path can forget one.
//
// Where each restriction is hosted:
//
//   - a standalone aggregate or a TPC (`ownTable`) concrete: on its own row
//     class, its full scope;
//   - a TPH (`sharedTable`) hierarchy: on the ROOT row class.  A criterion on
//     a mapped class reaches its subclasses' queries, but a criterion on a
//     subclass never reaches a query of its base, so each concrete's own
//     restrictions are root-hosted in discriminator-guarded form
//     (`or_(cls.kind != "Car", <pred>)`): `select(CarRow)` applies them,
//     `select(TruckRow)` is untouched by them, and the polymorphic
//     `select(VehicleRow)` applies each to its own rows only.  The
//     discriminator itself is SQLAlchemy's (`polymorphic_identity`).
//
// `ignoring` is the `loom_ignoring` execution option: a read carries the
// capability names its clause drops (`"*"` for `ignoring *`), and the hook
// omits exactly the restrictions with that provenance.  A deny or a bare
// filter has none and is never dropped.
//
// A principal-bound restriction (`currentUser.<claim>`) is a plain expression
// built from the request's principal on every execution — never a lambda,
// whose closure values SQLAlchemy caches.  With no principal it is `false()`:
// a read of tenant-scoped rows answers nothing rather than everything.
//
// Document and event-sourced aggregates are absent: their rows are blobs, so
// their repositories evaluate the same restrictions over the rehydrated
// instance.

import {
  type GuardedReadRestriction,
  type ReadBypass,
  type ReadRestriction,
  readScopeFor,
} from "../../ir/enrich/read-scope.js";
import {
  type EnrichedAggregateIR,
  type EnrichedBoundedContextIR,
  exprUsesCurrentUser,
} from "../../ir/types/loom-ir.js";
import { isTphBase, isTphConcrete } from "../../ir/util/inheritance.js";
import { lines } from "../../util/code-builder.js";
import { snake } from "../../util/naming.js";
import { refuseOutOfVocabulary } from "../_expr/target.js";
import { PY_IMPORTS, pyRef } from "../_imports/python.js";
import { lowerRestrictionToSqlAlchemy } from "./find-predicate.js";
import { rowClassName } from "./py-columns.js";

const sa = (name: string): string => pyRef("sqlalchemy", name);
const orm = (name: string): string => pyRef("sqlalchemy.orm", name);
const schemaRow = (name: string): string => pyRef("app.db.schema", name);
const COLLECTION = pyRef("collections.abc", "Collection");

/** The execution option a read's `ignoring` clause rides on. */
export const PY_IGNORING_OPTION = "loom_ignoring";

/** `install_read_scope` — the hook's installer, called from `app/db/__init__.py`. */
export const PY_INSTALL_READ_SCOPE = pyRef("app.db.read_scope", "install_read_scope");

/** The `.execution_options(loom_ignoring=…)` suffix a read with an `ignoring`
 *  clause carries, or "" when it carries none. */
export function pyIgnoringOption(bypass: ReadBypass | undefined): string {
  if (!bypass) return "";
  if (bypass.bypassAll) return `.execution_options(${PY_IGNORING_OPTION}=frozenset({"*"}))`;
  const caps = [...new Set(bypass.bypassCaps ?? [])];
  if (caps.length === 0) return "";
  return `.execution_options(${PY_IGNORING_OPTION}=frozenset({${caps.map((c) => JSON.stringify(c)).join(", ")}}))`;
}

/** One aggregate whose row class hosts restrictions in the hook. */
interface ScopeHost {
  agg: EnrichedAggregateIR;
  ctx: EnrichedBoundedContextIR;
  restrictions: readonly ReadRestriction[];
  guarded: readonly GuardedReadRestriction[];
}

/** The row classes that host restrictions, in context then pool order.
 *  `sqlScoped` says whether an aggregate's rows are queryable columns (not a
 *  document or event-sourced blob). */
function scopeHosts(
  contexts: readonly EnrichedBoundedContextIR[],
  sqlScoped: (agg: EnrichedAggregateIR) => boolean,
): ScopeHost[] {
  const hosts: ScopeHost[] = [];
  for (const ctx of contexts) {
    const pool = ctx.aggregates;
    for (const agg of ctx.aggregates) {
      // A TPH concrete's restrictions are hosted on its root; any other
      // abstract base owns no table.
      if (isTphConcrete(agg, pool)) continue;
      const tphRoot = isTphBase(agg, pool);
      if (agg.isAbstract && !tphRoot) continue;
      if (!tphRoot && !sqlScoped(agg)) continue;
      const scope = readScopeFor(agg, pool);
      const restrictions = scope.restrictions.filter((r) => r.predicate !== undefined);
      if (restrictions.length === 0 && scope.subtypeRestrictions.length === 0) continue;
      hosts.push({ agg, ctx, restrictions, guarded: scope.subtypeRestrictions });
    }
  }
  return hosts;
}

/** `app/db/read_scope.py`, or null when no aggregate carries a restriction. */
export function buildPyReadScopeFile(
  contexts: readonly EnrichedBoundedContextIR[],
  sqlScoped: (agg: EnrichedAggregateIR) => boolean,
): string | null {
  const hosts = scopeHosts(contexts, sqlScoped);
  if (hosts.length === 0) return null;
  const scopeFns = hosts.map(renderScopeFn);
  return lines(
    `"""Read scope — every declared read restriction, on every ORM read.  Auto-generated.`,
    "",
    "One `do_orm_execute` hook adds each aggregate's restrictions to every ORM",
    "SELECT as `with_loader_criteria`, so a repository read never spells one.  A",
    "subtype's own restriction is hosted on its hierarchy's root row class,",
    "guarded by its `kind`, so it also narrows a polymorphic read of the root.",
    `A read's \`ignoring\` clause is the \`${PY_IGNORING_OPTION}\` execution option; a`,
    "principal-bound restriction with no principal matches no row.",
    '"""',
    "",
    PY_IMPORTS,
    "",
    "",
    `def _bypassed(capability: str, ignoring: ${COLLECTION}[str]) -> bool:`,
    '    return "*" in ignoring or capability in ignoring',
    "",
    "",
    ...scopeFns.flatMap((fn) => [fn, "", ""]),
    `def _read_scope(state: ${orm("ORMExecuteState")}) -> None:`,
    "    if not state.is_select or state.is_column_load or state.is_relationship_load:",
    "        return",
    `    ignoring: ${COLLECTION}[str] = state.execution_options.get(${JSON.stringify(PY_IGNORING_OPTION)}, frozenset())`,
    `    options: list[${orm("LoaderCriteriaOption")}] = [`,
    ...hosts.map((h) => `        *${scopeFnName(h)}(ignoring),`),
    "    ]",
    "    state.statement = state.statement.options(*options)",
    "",
    "",
    "def install_read_scope() -> None:",
    `    """Register the hook on every ORM session (idempotent)."""`,
    `    if not ${sa("event")}.contains(${orm("Session")}, "do_orm_execute", _read_scope):`,
    `        ${sa("event")}.listen(${orm("Session")}, "do_orm_execute", _read_scope)`,
    "",
  );
}

function scopeFnName(h: ScopeHost): string {
  return `_${snake(h.agg.name)}_scope`;
}

/** One host's `_<agg>_scope(ignoring)` — its criteria, minus the bypassed. */
function renderScopeFn(h: ScopeHost): string {
  const row = schemaRow(rowClassName(h.agg.name));
  const entries: { restriction: ReadRestriction; owner: EnrichedAggregateIR; guard?: string }[] = [
    ...h.restrictions.map((restriction) => ({ restriction, owner: h.agg })),
    ...h.guarded.map((g) => ({
      restriction: g.restriction,
      owner: h.ctx.aggregates.find((a) => a.name === g.discriminator) as EnrichedAggregateIR,
      guard: g.discriminator,
    })),
  ];
  const principal = entries.some((e) => exprUsesCurrentUser(e.restriction.predicate));
  const body: string[] = [];
  if (principal) body.push(`    user = ${pyRef("app.auth.user", "current_user")}()`);
  for (const e of entries) {
    const usesPrincipal = exprUsesCurrentUser(e.restriction.predicate);
    const criterion = usesPrincipal
      ? renderCriterion(e.restriction, e.owner, h.ctx, row, "user", e.guard)
      : `lambda cls: ${renderCriterion(e.restriction, e.owner, h.ctx, "cls", "user", e.guard)}`;
    const append = (crit: string, indent: string): string =>
      `${indent}out.append(${orm("with_loader_criteria")}(${row}, ${crit}, include_aliases=True))`;
    const lead = `    # ${describe(e.restriction, e.guard)}`;
    const indent = e.restriction.bypassable ? "        " : "    ";
    const block: string[] = [lead];
    if (e.restriction.bypassable) {
      block.push(`    if not _bypassed(${JSON.stringify(e.restriction.capability)}, ignoring):`);
    }
    if (usesPrincipal) {
      block.push(`${indent}if user is None:`);
      // No principal: no row of this restriction's scope is visible — a
      // subtype's own restriction still leaves its siblings' rows alone.
      const none = e.guard
        ? `${sa("or_")}(${row}.kind != ${JSON.stringify(e.guard)}, ${sa("false")}())`
        : `${sa("false")}()`;
      block.push(append(none, `${indent}    `));
      block.push(`${indent}else:`);
      block.push(append(criterion, `${indent}    `));
    } else {
      block.push(append(criterion, indent));
    }
    body.push(...block);
  }
  return lines(
    `def ${scopeFnName(h)}(ignoring: ${COLLECTION}[str]) -> list[${orm("LoaderCriteriaOption")}]:`,
    `    out: list[${orm("LoaderCriteriaOption")}] = []`,
    ...body,
    "    return out",
  );
}

function describe(r: ReadRestriction, guard: string | undefined): string {
  const what =
    r.kind === "capability"
      ? `${r.capability} capability`
      : r.kind === "tenancy"
        ? `tenancy (${r.tenancy})`
        : r.kind === "deny"
          ? "policy deny"
          : "filter";
  const where = r.inherited ? `, inherited from ${r.declaredOn}` : "";
  return guard ? `${guard} rows only: ${what}${where}` : `${what}${where}`;
}

/** One restriction's criterion over `row` (`cls` in a lambda, the row class
 *  for an eagerly built principal-bound one), guarded by `kind` when it is a
 *  subtype's restriction hosted on its root. */
function renderCriterion(
  r: ReadRestriction,
  owner: EnrichedAggregateIR,
  ctx: EnrichedBoundedContextIR,
  row: string,
  principal: string,
  guard: string | undefined,
): string {
  const lowered =
    lowerRestrictionToSqlAlchemy(r.predicate!, owner, ctx, row, principal) ??
    refuseOutOfVocabulary("sqlalchemy-filter", `read restriction on '${owner.name}'`);
  if (!guard) return lowered.expr;
  return `${sa("or_")}(${row}.kind != ${JSON.stringify(guard)}, ${lowered.expr})`;
}
