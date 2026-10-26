import type { ExprIR, TypeIR } from "../../ir/types/loom-ir.js";
import { principalTerm } from "../../ir/util/principal-term.js";
import {
  DATA_KEY_LIKE_ESCAPE,
  DATA_KEY_PATH_DELIMITER,
  deepScopeAnchorClaim,
  guidClaimAccessorName,
  TENANT_OWNED_DATA_KEY_FIELD,
  TENANT_OWNED_TENANT_ID_FIELD,
} from "../../ir/util/tenant-stance.js";
import { intrinsicFor, intrinsicKey } from "../../util/intrinsics.js";
import { snake } from "../../util/naming.js";
import { MAKE_INTERVAL_ARG, temporalInterval } from "../_expr/pg-interval.js";
import { PG_INTRINSIC_SQL } from "../_expr/pg-intrinsics.js";
import { boxedJavaType } from "./render-expr.js";
import {
  claimIsNullBindEntry,
  enumNameBindEntry,
  principalParamName,
  principalTermBindEntry,
  subtreeLikeBindEntry,
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
export function renderSqlFilterCondition(e: ExprIR, enumsPkg: string): FilterCondition {
  const params = new Map<string, FilterParam>();
  const condition = renderSql(e, { params, enumsPkg });
  return { condition, params: [...params.values()] };
}

interface PrincipalCtx {
  params: Map<string, FilterParam>;
  enumsPkg: string;
}

export function renderSqlRestriction(e: ExprIR): string {
  return renderSql(e, undefined);
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

/** The boxed Java type of an id's raw value. */
function javaIdBoxedValueType(valueType: string): string {
  switch (valueType) {
    case "int":
      return "Integer";
    case "long":
      return "Long";
    case "string":
      return "String";
    default:
      return "java.util.UUID";
  }
}

/** The principal-aware arms of a binary comparison, or null when `e` reads no
 *  principal in a shape that needs one. */
function renderPrincipalBinary(
  e: Extract<ExprIR, { kind: "binary" }>,
  p: PrincipalCtx,
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
    const param =
      idType.valueType === "guid" && claimIsString
        ? bind(p, guidClaimAccessorName(claim.member), "java.util.UUID")
        : bind(p, claim.member, javaIdBoxedValueType(idType.valueType));
    return `id ${op} ${param}`;
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
  const cmp = `${renderSql(e.left, p)} ${op} ${renderSql(e.right, p)}`;
  return `(${cmp} or (${test} and ${renderSql(colSide, p)} is ${e.op === "==" ? "" : "not "}null))`;
}

function renderSql(e: ExprIR, p: PrincipalCtx | undefined): string {
  const renderSqlRestriction = (x: ExprIR): string => renderSql(x, p);
  switch (e.kind) {
    case "authz-filter":
      // Only the DENY carve-out (authorization — deny-wins) reaches the
      // static (no-principal) restriction path: the always-false `1 = 0`
      // appended to every SELECT for a read-denied entity.  A `scope` sentinel
      // is principal-referencing and is routed to the `tenantScope` Specification
      // instead, so it never lands here — the exhaustive switch throws if it did.
      switch (e.filter.kind) {
        case "deny":
          return "1 = 0";
        case "scope": {
          if (!p) {
            throw unsupported(
              "principal-referencing `scope` filter (needs the Specification path)",
            );
          }
          // Descendant-or-self materialized-path scope with the NULL-dataKey
          // fallback to the tenant floor: the JPQL `scope` arm in SQL.  The
          // anchored `position(...) = 1` decides the row; the prefix `like`
          // in front of it is the sargable prefilter the `data_key`
          // text_pattern_ops index serves.
          const col = snake(TENANT_OWNED_DATA_KEY_FIELD);
          const tenantCol = snake(TENANT_OWNED_TENANT_ID_FIELD);
          const org = renderSqlRestriction(e.filter.anchorClaim);
          const tenant = renderSqlRestriction(e.filter.tenantClaim);
          const pattern = bind(p, subtreeLikeBindEntry(deepScopeAnchorClaim(e)), "String");
          const anchored = `position(concat(${org}, '${DATA_KEY_PATH_DELIMITER}') in ${col}) = 1`;
          const descendant = `(${col} like ${pattern} escape '${DATA_KEY_LIKE_ESCAPE}' and ${anchored})`;
          return (
            `((${col} is not null and (${col} = ${org} or ${descendant})) ` +
            `or (${col} is null and ${tenantCol} = ${tenant}))`
          );
        }
        default: {
          const _exhaustive: never = e.filter;
          throw unsupported(`authz-filter kind '${(_exhaustive as { kind: string }).kind}'`);
        }
      }
    case "paren":
      return `(${renderSqlRestriction(e.inner)})`;
    case "unary":
      if (e.op === "!") return `not (${renderSqlRestriction(e.operand)})`;
      throw unsupported(`unary '${e.op}'`);
    case "binary": {
      const principal = p ? renderPrincipalBinary(e, p) : null;
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
      // Queryable scalar intrinsic (src/util/intrinsics.ts) over a candidate
      // path — `filter this.dataKey.startsWith("root")`, `filter
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
      if (e.refKind === "this-prop" || e.refKind === "this-vo-prop")
        return sqlRestrictionIdent(columnPath(e));
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
      return sqlRestrictionIdent(columnPath(e));
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
