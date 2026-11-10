import { existsScopePredicates } from "../../ir/enrich/read-scope.js";
import { aggregateTableName } from "../../ir/enrich/storage-names.js";
import type { AggregateIR, ExprIR, TypeIR } from "../../ir/types/loom-ir.js";
import { idColumnVsOperatingOrg, orgAncestorsMembershipArg } from "../../ir/util/org-context.js";
import { principalTerm } from "../../ir/util/principal-term.js";
import { guidClaimAccessorName } from "../../ir/util/tenant-stance.js";
import { intrinsicFor, intrinsicKey } from "../../util/intrinsics.js";
import { snake } from "../../util/naming.js";
import { MAKE_INTERVAL_ARG, temporalInterval } from "../_expr/pg-interval.js";
import { PG_INTRINSIC_SQL } from "../_expr/pg-intrinsics.js";
import { boxedJavaType } from "./render-expr.js";
import {
  claimIsNullBindEntry,
  enumNameBindEntry,
  idListCsvBindEntry,
  principalParamName,
  principalTermBindEntry,
} from "./render-jpql.js";
import { sqlRestrictionIdent } from "./sql-ident.js";

// ---------------------------------------------------------------------------
// Capability-filter predicate → the static SQL fragment behind
// Hibernate's `@SQLRestriction` (the HasQueryFilter / Drizzle-WHERE
// analog: appended to every SELECT for the entity).  Only the
// non-principal, relational subset reaches this renderer — the
// validator gates currentUser-referencing filters and non-relational
// shapes (loom.context-filter-no-principal), so values here are
// literals / enum values / candidate paths only.
//
// Column naming mirrors the migrations builder: `snake(field)`, with
// VO sub-paths flattening to `<field>_<vofield>`.
// ---------------------------------------------------------------------------

/** One principal-derived bind parameter of a filter condition: its `:name`,
 *  the recorded binding entry `principalBindExpr` turns into the Java value,
 *  and the boxed Java type the `@ParamDef` declares. */
export interface FilterParam {
  name: string;
  entry: string;
  javaType: string;
}

/** A principal-referencing predicate as a Hibernate `@Filter` condition: the
 *  SQL with each principal read as a `:param`, and the params it binds. */
export interface FilterCondition {
  condition: string;
  params: FilterParam[];
}

/** Render a restriction that MAY read the request principal.  Every principal
 *  read becomes a named filter parameter, resolved per query by a
 *  `@ParamDef(resolver = ...)`; the parameter names and Java values are the
 *  ones the JPQL EntityManager mode binds (`render-jpql.ts`), so the two
 *  spellings of one predicate cannot disagree.  Every value is null (false,
 *  for a Boolean) without a principal, so the condition matches no row. */
export function renderSqlFilterCondition(
  e: ExprIR,
  enumsPkg: string,
  /** The context's aggregates — needed only to resolve an `exists <Agg> …`
   *  quantifier to the quantified table and its read scope. */
  aggs: readonly AggregateIR[] = [],
  schema?: string,
): FilterCondition {
  const params = new Map<string, FilterParam>();
  const condition = renderSql(e, { params, enumsPkg }, { rows: new Map(), aggs, schema });
  return { condition, params: [...params.values()] };
}

/** Where the columns of an `exists` subquery come from.  The filtered row's
 *  own columns stay UNQUALIFIED — Hibernate's fragment template prefixes every
 *  bare column with the entity's alias, which is what correlates the subquery
 *  — and a quantified row's are qualified with its alias, which the template
 *  leaves alone.  `thisAlias` is set while rendering the quantified aggregate's
 *  own read scope, whose `this` IS the quantified row. */
interface RowCtx {
  thisAlias?: string;
  rows: Map<string, string>;
  aggs: readonly AggregateIR[];
  /** The schema the context's tables live in (see `restrictionHostFor`). */
  schema?: string;
}

interface PrincipalCtx {
  params: Map<string, FilterParam>;
  enumsPkg: string;
}

export function renderSqlRestriction(
  e: ExprIR,
  aggs: readonly AggregateIR[] = [],
  schema?: string,
): string {
  return renderSql(e, undefined, { rows: new Map(), aggs, schema });
}

function bind(p: PrincipalCtx, entry: string, javaType: string): string {
  const name = principalParamName(entry);
  if (!p.params.has(name)) p.params.set(name, { name, entry, javaType });
  return `:${name}`;
}

/** A `currentUser.<claim>` read, or null. */
function claimOf(x: ExprIR): { member: string; type: TypeIR } | null {
  if (x.kind === "paren") return claimOf(x.inner);
  if (x.kind === "member" && x.receiver.kind === "ref" && x.receiver.refKind === "current-user") {
    return { member: x.member, type: x.memberType };
  }
  return null;
}

/** A claim read as a parameter.  An enum claim binds its name: the column
 *  stores the `.ddd` spelling as text. */
function renderClaim(member: string, type: TypeIR, p: PrincipalCtx): string {
  const inner = type.kind === "optional" ? type.inner : type;
  if (inner.kind === "enum") return bind(p, enumNameBindEntry(member), "String");
  return bind(p, member, boxedJavaType(inner));
}

/** `this.id` (the aggregate's own key), or null. */
function selfIdOf(x: ExprIR): Extract<TypeIR, { kind: "id" }> | null {
  if (x.kind === "paren") return selfIdOf(x.inner);
  if (
    x.kind === "member" &&
    x.receiver.kind === "this" &&
    x.member === "id" &&
    x.memberType.kind === "id"
  ) {
    return x.memberType;
  }
  return null;
}

/** The boxed Java type of an id's raw value (a guid). */
function javaIdBoxedValueType(): string {
  return "java.util.UUID";
}

/** The principal-aware arms of a binary comparison, or null when `e` reads no
 *  principal in a shape that needs one. */
function renderPrincipalBinary(
  e: Extract<ExprIR, { kind: "binary" }>,
  p: PrincipalCtx,
  rc: RowCtx,
): string | null {
  const pt = principalTerm(e);
  if (pt) {
    // Fixed for the request, so decided in Java and bound as one Boolean.
    const entry = principalTermBindEntry(pt, p.enumsPkg);
    if (entry === null) throw unsupported("principal term operand");
    return `${bind(p, entry, "Boolean")} = true`;
  }
  if (e.op !== "==" && e.op !== "!=") return null;
  const op = e.op === "==" ? "=" : "<>";
  // An id column against the operating org compares as text (see
  // `idColumnVsOperatingOrg`): the claim binds as a String.
  const orgCmp = idColumnVsOperatingOrg(e);
  if (orgCmp) {
    const org = orgCmp.org as Extract<ExprIR, { kind: "member" }>;
    return `text(${qualifiedColumn(orgCmp.column, rc)}) ${op} ${bind(p, org.member, "String")}`;
  }
  // `this.id == currentUser.<claim>` (the registry self-scope): the claim
  // binds as the id's value type; a string claim against a guid id goes
  // through the principal's `<claim>AsUuid()` accessor, which is null for a
  // missing principal and for a malformed claim alike.
  const leftId = selfIdOf(e.left);
  const rightId = selfIdOf(e.right);
  const idType = leftId ?? rightId;
  const claim = claimOf(leftId ? e.right : e.left);
  if (idType && claim) {
    const claimIsString = claim.type.kind === "primitive" && claim.type.name === "string";
    const param = claimIsString
      ? bind(p, guidClaimAccessorName(claim.member), "java.util.UUID")
      : bind(p, claim.member, javaIdBoxedValueType());
    return `${rc.thisAlias ? `${rc.thisAlias}.` : ""}id ${op} ${param}`;
  }
  // A nullable claim: `==` against a null claim reads as IS NULL, as on every
  // backend, and an absent principal still matches nothing.
  const leftClaim = claimOf(e.left);
  const rightClaim = claimOf(e.right);
  if ((leftClaim === null) === (rightClaim === null)) return null;
  const nullable = leftClaim ?? rightClaim!;
  if (nullable.type.kind !== "optional") return null;
  const colSide = leftClaim ? e.right : e.left;
  const test = `${bind(p, claimIsNullBindEntry(nullable.member), "Boolean")} = true`;
  const cmp = `${renderSql(e.left, p, rc)} ${op} ${renderSql(e.right, p, rc)}`;
  return `(${cmp} or (${test} and ${renderSql(colSide, p, rc)} is ${e.op === "==" ? "" : "not "}null))`;
}

function renderSql(e: ExprIR, p: PrincipalCtx | undefined, rc: RowCtx): string {
  const renderSqlRestriction = (x: ExprIR): string => renderSql(x, p, rc);
  const column = (x: ExprIR): string => qualifiedColumn(x, rc);
  switch (e.kind) {
    case "exists": {
      // `exists <Agg> as s where p` — a correlated EXISTS over the quantified
      // table, carrying that aggregate's own read scope.
      const inner = rc.aggs.find((a) => a.name === e.aggregate);
      if (!inner) throw unsupported(`'exists ${e.aggregate}' without its aggregate in scope`);
      const alias = `q_${snake(e.binding)}`;
      const rows = new Map(rc.rows);
      rows.set(e.binding, alias);
      const terms = [renderSql(e.where, p, { ...rc, rows })];
      for (const pred of existsScopePredicates(inner.name, rc.aggs)) {
        terms.push(renderSql(pred, p, { ...rc, rows, thisAlias: alias }));
      }
      const bare = sqlRestrictionIdent(aggregateTableName(inner, rc.aggs));
      const table = rc.schema ? `${sqlRestrictionIdent(rc.schema)}.${bare}` : bare;
      return `exists (select 1 from ${table} ${alias} where ${terms.map((t) => `(${t})`).join(" and ")})`;
    }
    case "authz-filter": {
      // The DENY carve-out (authorization — deny-wins): the always-false
      // `1 = 0` appended to every SELECT for a read-denied entity.  `deny` is
      // the only filter kind; the typed binding makes a new kind a `tsc` error
      // here, not a silent authorization bypass.
      const _deny: "deny" = e.filter.kind;
      return "1 = 0";
    }
    case "paren":
      return `(${renderSqlRestriction(e.inner)})`;
    case "unary":
      if (e.op === "!") return `not (${renderSqlRestriction(e.operand)})`;
      throw unsupported(`unary '${e.op}'`);
    case "binary": {
      const principal = p ? renderPrincipalBinary(e, p, rc) : null;
      if (principal !== null) return principal;
      if (e.op === "&&")
        return `${renderSqlRestriction(e.left)} and ${renderSqlRestriction(e.right)}`;
      if (e.op === "||")
        return `(${renderSqlRestriction(e.left)} or ${renderSqlRestriction(e.right)})`;
      // `this.placedAt + days(1)`: Postgres interval arithmetic, the same
      // `make_interval` fragment the dapper and drizzle lowerings emit.
      const interval = temporalInterval(e);
      if (interval) {
        const side = renderSqlRestriction(interval.operand);
        const amount = renderSqlRestriction(interval.duration.amount);
        return `(${side} ${interval.op} make_interval(${MAKE_INTERVAL_ARG[interval.duration.unit]} => ${amount}))`;
      }
      const isNull = (x: ExprIR): boolean => x.kind === "literal" && x.lit === "null";
      if ((e.op === "==" || e.op === "!=") && (isNull(e.left) || isNull(e.right))) {
        const operand = isNull(e.left) ? e.right : e.left;
        return `${renderSqlRestriction(operand)} is${e.op === "!=" ? " not" : ""} null`;
      }
      const SQL_OP: Record<string, string> = {
        "==": "=",
        "!=": "<>",
        "<": "<",
        "<=": "<=",
        ">": ">",
        ">=": ">=",
      };
      const op = SQL_OP[e.op];
      if (!op) throw unsupported(`binary '${e.op}'`);
      return `${renderSqlRestriction(e.left)} ${op} ${renderSqlRestriction(e.right)}`;
    }
    case "method-call": {
      // `organizationContext.ancestors.contains(<column>)` — the lineage binds
      // as one comma-joined parameter (see `idListCsvBindEntry`) and the
      // column is compared as text: `text(col) = any(string_to_array(:p, ','))`.
      const lineageArg = orgAncestorsMembershipArg(e);
      if (lineageArg) {
        if (!p) throw unsupported("principal lineage read");
        const receiver = e.receiver as Extract<ExprIR, { kind: "member" }>;
        const param = bind(p, idListCsvBindEntry(receiver.member), "String");
        return `text(${renderSqlRestriction(lineageArg)}) = any(string_to_array(${param}, ','))`;
      }
      // Queryable scalar intrinsic (src/util/intrinsics.ts) over a candidate
      // path — `filter this.code.startsWith("root")`, `filter
      // this.code.trim() == "x"`.  The static path admits it because every
      // operand here is a literal or a column: no parameter binding is needed,
      // which is the only thing `@SQLRestriction` cannot express.  Shares the
      // Postgres text table with the Dapper repository emitter.
      if (e.receiverType.kind === "primitive") {
        const snippet = intrinsicFor(e.receiverType.name, e.member)?.queryable
          ? PG_INTRINSIC_SQL[intrinsicKey(e.receiverType.name, e.member)]
          : undefined;
        if (snippet) {
          return snippet(
            renderSqlRestriction(e.receiver),
            e.args.map((a) => renderSqlRestriction(a)),
          );
        }
      }
      throw unsupported(`method call '${e.member}'`);
    }
    case "ref":
      if (e.refKind === "this-prop" || e.refKind === "this-vo-prop") return column(e);
      if (e.refKind === "enum-value") return sqlString(e.name);
      throw unsupported(`ref '${e.refKind}' (only candidate fields and enum values are static)`);
    case "member": {
      if (e.receiver.kind === "ref" && e.receiver.refKind === "current-user") {
        if (!p) throw unsupported("principal claim read");
        return renderClaim(e.member, e.memberType, p);
      }
      // Candidate field (`this.isDeleted` → is_deleted), flattened VO
      // sub-path (`this.audit.deletedAt` → audit_deleted_at), or an enum
      // value spelled `Enum.value`.
      if (e.receiverType.kind === "enum") return sqlString(e.member);
      return column(e);
    }
    case "literal":
      switch (e.lit) {
        case "string":
          return sqlString(e.value);
        case "int":
        case "long":
        case "decimal":
        case "money":
          return e.value;
        case "bool":
          return e.value;
        // `@SQLRestriction` is SQL text appended to every query, so `now()` is
        // read at query time, not when the entity class loads.
        case "now":
          return "now()";
        default:
          throw unsupported(`literal '${e.lit}'`);
      }
    default:
      throw unsupported(`expression kind '${e.kind}'`);
  }
}

/** A column reference: the quoted column, prefixed with the alias of the row
 *  it belongs to when that is not the filtered row itself (see `RowCtx`). */
function qualifiedColumn(e: ExprIR, rc: RowCtx): string {
  const rowName = rowOf(e);
  const alias = rowName !== undefined ? rc.rows.get(rowName) : rc.thisAlias;
  if (rowName !== undefined && alias === undefined)
    throw unsupported(`'${rowName}' outside its 'exists'`);
  const col = sqlRestrictionIdent(columnPath(e));
  return alias ? `${alias}.${col}` : col;
}

/** The `exists` binding a column path is rooted at, or undefined for `this`. */
function rowOf(e: ExprIR): string | undefined {
  if (e.kind === "member") {
    if (e.receiver.kind === "ref" && e.receiver.refKind === "row") return e.receiver.name;
    return rowOf(e.receiver);
  }
  return undefined;
}

/** The UNQUOTED column a candidate path names — `this.isDeleted` → `is_deleted`,
 *  the flattened VO sub-path `this.audit.deletedAt` → `audit_deleted_at`.
 *
 *  Built as one string and quoted ONCE by the caller.  Quoting the segments as
 *  they are produced would put the quotes inside the flattened name
 *  (`"order"_deleted_at`), which is why this is a separate walk rather than a
 *  wrapper around `renderSqlRestriction`'s recursion. */
function columnPath(e: ExprIR): string {
  if (e.kind === "ref" && (e.refKind === "this-prop" || e.refKind === "this-vo-prop")) {
    return snake(e.name);
  }
  if (e.kind === "member") {
    if (e.receiver.kind === "this") return snake(e.member);
    if (e.receiver.kind === "ref" && e.receiver.refKind === "row") return snake(e.member);
    return `${columnPath(e.receiver)}_${snake(e.member)}`;
  }
  throw unsupported(`expression kind '${e.kind}' in a column position`);
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function unsupported(what: string): Error {
  return new Error(
    `@SQLRestriction renderer: ${what} is outside the static-filter subset — ` +
      `the IR validator (loom.context-filter-no-principal) should have rejected this filter.`,
  );
}
