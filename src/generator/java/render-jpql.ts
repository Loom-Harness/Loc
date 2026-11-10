import { existsScopePredicates } from "../../ir/enrich/read-scope.js";
import type { AggregateIR, ExprIR, TypeIR } from "../../ir/types/loom-ir.js";
import { idColumnVsOperatingOrg, orgAncestorsMembershipArg } from "../../ir/util/org-context.js";
import { type PrincipalTerm, principalTerm } from "../../ir/util/principal-term.js";
import { durationCtorOperand } from "../../ir/util/temporal.js";
import { guidClaimAccessorName } from "../../ir/util/tenant-stance.js";
import { intrinsicFor, intrinsicKey } from "../../util/intrinsics.js";
import type { DurationUnit } from "../../util/temporal.js";
import { renderPrincipalTest } from "../_expr/principal-term.js";
import { refuseOutOfVocabulary } from "../_expr/target.js";
import { jid } from "./java-ident.js";

// ---------------------------------------------------------------------------
// Find-filter → JPQL renderer.  Spring Data derived method names can't
// express an arbitrary `ExprIR` filter, so IR-derived finds render as
// `@Query` JPQL (java-backend.md framework recommendation).  This is a
// deliberately small renderer over the validator's *queryable* subset
// (`firstNonQueryableNode`): comparisons, boolean connectives, bare
// booleans, VO sub-columns, enum values, null checks, and
// reference-collection membership.  Anything outside that subset throws —
// IR validation rejects it upstream, so reaching the throw is a compiler
// bug, not a user error.
//
// `this` → the query alias (`e`); `param` refs → `:name` bind parameters;
// enum values render as fully-qualified JPQL enum literals.  A
// `currentUser.<field>` access (principal/tenancy filter) renders as a Spring
// Data SpEL parameter resolving the ambient request principal through the
// generated `CurrentUserAccessor` bean — the JPA analogue of node's
// `requireCurrentUser()`: `:#{@currentUserAccessor.user()?.<field>()}`.  The
// null-safe `?.` keeps it fail-closed (no actor → null → `= NULL` → no rows),
// mirroring the .NET / Phoenix behaviour.
// ---------------------------------------------------------------------------

/** Spring bean name of the generated `CurrentUserAccessor` @Component. */
const CURRENT_USER_BEAN = "currentUserAccessor";

export interface JpqlCtx {
  /** Query alias for the aggregate root (`e`). */
  alias: string;
  /** Fully-qualified package of the generated enums (for enum literals). */
  enumsPkg: string;
  /** Declared `QueryEmissionMode` (§F2, Wave 2 packet 2.4) — which of the two
   *  JPQL sub-languages this render targets.  Both modes accept the same
   *  `ExprIR.kind` vocabulary (`QUERY_EMISSION_VOCABULARY["jpql-*"]`); they
   *  diverge ONLY in how a `currentUser.<claim>` member renders (see
   *  `renderPrincipal`), which is why this is a
   *  mode rather than a second vocabulary table.  Defaults to
   *  `"jpql-spring-data"` when omitted (every existing call site but the
   *  query-projection aggregation reads) so the default stays
   *  byte-identical. */
  mode?: "jpql-spring-data" | "jpql-entity-manager";
  /** Populated (by the renderer) with every `currentUser.<claim>` accessor
   *  (or derived principal binding) read while rendering, when
   *  `mode === "jpql-entity-manager"`.  `EntityManager.createQuery` has no
   *  SpEL layer — `:#{…}` is not a legal parameter name there — so the reads
   *  that build JPQL directly (query-time projection aggregations) bind the
   *  principal themselves, off this set.  Ignored (and need not be supplied)
   *  under `"jpql-spring-data"`. */
  principalAccessors?: Set<string>;
  /** The context's aggregates — needed only to resolve an `exists <Agg> …`
   *  quantifier to the quantified entity and its read scope. */
  aggs?: readonly AggregateIR[];
  /** Each in-scope `exists … as <row>` binding → its JPQL alias. */
  rows?: ReadonlyMap<string, string>;
}

/** True when `ctx` targets the plain `EntityManager.createQuery` sub-mode —
 *  the one JPQL rendering decision the two sub-modes disagree on.  The
 *  `principalAccessors` branch this packet was named for (§F2) is now a
 *  CONSUMER of the declared mode rather than the mode itself: presence of the
 *  accessor set used to BE the flag, so a caller in entity-manager mode that
 *  forgot to allocate one silently fell back to SpEL (illegal outside Spring
 *  Data — `:#{…}` throws at `createQuery` parse time).  Mode is now the
 *  source of truth; the set is just where bindings land. */
function isEntityManagerMode(ctx: JpqlCtx): boolean {
  return ctx.mode === "jpql-entity-manager";
}

/** JPQL parameter name for a recorded `JpqlCtx.principalAccessors` binding —
 *  a bare claim accessor, or a derived principal binding.
 *  Prefixed so it cannot collide with a find's own `:param` bindings. */
export function principalParamName(entry: string): string {
  if (entry.startsWith(PRINCIPAL_TERM_BIND)) {
    const text = entry.slice(PRINCIPAL_TERM_BIND.length);
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `__pt${h.toString(16).padStart(8, "0")}`;
  }
  if (entry.startsWith(CLAIM_IS_NULL_BIND)) {
    const accessor = entry.slice(CLAIM_IS_NULL_BIND.length);
    return `__cuIsNull${accessor.charAt(0).toUpperCase()}${accessor.slice(1)}`;
  }
  if (entry.startsWith(ENUM_NAME_BIND)) {
    const accessor = entry.slice(ENUM_NAME_BIND.length);
    return `__cuName${accessor.charAt(0).toUpperCase()}${accessor.slice(1)}`;
  }
  if (entry.startsWith(ID_LIST_CSV_BIND)) {
    const accessor = entry.slice(ID_LIST_CSV_BIND.length);
    return `__cuCsv${accessor.charAt(0).toUpperCase()}${accessor.slice(1)}`;
  }
  return `__cu${entry.charAt(0).toUpperCase()}${entry.slice(1)}`;
}

/** The Java expression a `principalAccessors` caller binds one recorded entry
 *  with, given the name of its nullable principal local.  Keeping it here —
 *  beside the renderer that recorded the entry — is what stops the two halves
 *  from drifting: a new derived binding kind adds an arm here rather than
 *  needing every call site to learn about it. */
export function principalBindExpr(entry: string, principalVar: string): string {
  if (entry.startsWith(PRINCIPAL_TERM_BIND)) {
    return entry.slice(PRINCIPAL_TERM_BIND.length).split(PRINCIPAL_VAR_HOLE).join(principalVar);
  }
  if (entry.startsWith(CLAIM_IS_NULL_BIND)) {
    const accessor = entry.slice(CLAIM_IS_NULL_BIND.length);
    return `${principalVar} != null && ${principalVar}.${accessor}() == null`;
  }
  if (entry.startsWith(ENUM_NAME_BIND)) {
    const accessor = entry.slice(ENUM_NAME_BIND.length);
    return `${principalVar} == null || ${principalVar}.${accessor}() == null ? null : ${principalVar}.${accessor}().name()`;
  }
  if (entry.startsWith(ID_LIST_CSV_BIND)) {
    const accessor = entry.slice(ID_LIST_CSV_BIND.length);
    return (
      `${principalVar} == null ? null : ${principalVar}.${accessor}().stream()` +
      `.map(__id -> __id.value().toString())` +
      `.collect(java.util.stream.Collectors.joining(","))`
    );
  }
  return `${principalVar} == null ? null : ${principalVar}.${entry}()`;
}

/** Render a `currentUser.<accessor>` reference for `ctx`: a bound named
 *  parameter when the caller opted into `principalAccessors`, else the Spring
 *  Data SpEL bean read. */
function renderPrincipal(accessor: string, ctx: JpqlCtx): string {
  if (isEntityManagerMode(ctx)) {
    ctx.principalAccessors?.add(accessor);
    return `:${principalParamName(accessor)}`;
  }
  return `:#{@${CURRENT_USER_BEAN}.user()?.${accessor}()}`;
}

// JPQL-side scalar-intrinsic snippets (src/util/intrinsics.ts) — how a
// `queryable` intrinsic renders inside a `@Query` where-string.  The
// snippet receives the already-rendered receiver (and rendered args) and
// yields the JPQL function application.  JPQL functions apply to
// parameters as well as paths, so the same snippet serves BOTH the
// column side (`this.name.trim()` → `trim(e.name)`) and the value side
// (`q.trim()` → `trim(:q)`).  Exported for the intrinsic completeness
// test.
export const JPQL_INTRINSIC_SQL: Record<string, (recv: string, args: string[]) => string> = {
  "string.trim": (recv) => `trim(${recv})`,
  "string.toUpper": (recv) => `upper(${recv})`,
  "string.toLower": (recv) => `lower(${recv})`,
  // Prefix match (tenancy-authorization-final-surface decision 2).  HQL's
  // `locate(search, source)` is the portable anchored position test (→ Postgres
  // `position(search in source)`), so the argument needs no LIKE-escaping — see
  // the note in `src/util/intrinsics.ts`.
  "string.startsWith": (recv, args) => `locate(${args[0]}, ${recv}) = 1`,
  // ---- numerics (A3 math batch) — Hibernate 6+ HQL: abs/round/floor are
  // standard; `ceil` is spelled CEILING; two-value min/max are the HQL-native
  // least()/greatest() (NOT the aggregate min/max).  Postgres round(numeric, n)
  // is already half-away-from-zero, matching the catalogue contract.
  "int.abs": (recv) => `abs(${recv})`,
  "long.abs": (recv) => `abs(${recv})`,
  "decimal.abs": (recv) => `abs(${recv})`,
  "money.abs": (recv) => `abs(${recv})`,
  "int.min": (recv, args) => `least(${recv}, ${args[0]})`,
  "int.max": (recv, args) => `greatest(${recv}, ${args[0]})`,
  "long.min": (recv, args) => `least(${recv}, ${args[0]})`,
  "long.max": (recv, args) => `greatest(${recv}, ${args[0]})`,
  "decimal.min": (recv, args) => `least(${recv}, ${args[0]})`,
  "decimal.max": (recv, args) => `greatest(${recv}, ${args[0]})`,
  "money.min": (recv, args) => `least(${recv}, ${args[0]})`,
  "money.max": (recv, args) => `greatest(${recv}, ${args[0]})`,
  "decimal.round": (recv, args) =>
    args[0] !== undefined ? `round(${recv}, ${args[0]})` : `round(${recv})`,
  "money.round": (recv, args) =>
    args[0] !== undefined ? `round(${recv}, ${args[0]})` : `round(${recv})`,
  "decimal.floor": (recv) => `floor(${recv})`,
  "money.floor": (recv) => `floor(${recv})`,
  "decimal.ceil": (recv) => `ceiling(${recv})`,
  "money.ceil": (recv) => `ceiling(${recv})`,
  // ---- datetime — midnight-UTC bucket.  HQL has no portable truncation
  // function over an Instant, so this is the documented escape hatch:
  // `function('name', args…)` passes `date_trunc` straight through to
  // Postgres (the Criteria-side `cb.function` at render-criteria.ts is the
  // same discipline).  `timestamptz` is stored in UTC, so the day boundary
  // matches the in-memory `truncatedTo(DAYS)`.
  "datetime.startOfDay": (recv) => `function('date_trunc', 'day', ${recv})`,
};

export function renderJpqlWhere(e: ExprIR, ctx: JpqlCtx): string {
  return render(e, ctx);
}

function render(e: ExprIR, ctx: JpqlCtx): string {
  switch (e.kind) {
    case "literal":
      return renderLiteral(e.lit, e.value);
    case "this":
      return ctx.alias;
    case "id":
      return `${ctx.alias}.id`;
    case "ref":
      return renderRef(e, ctx);
    case "member":
      // `currentUser.<field>` → SpEL reading the ambient request principal off
      // the CurrentUserAccessor bean (null-safe → fail-closed).
      if (e.receiver.kind === "ref" && e.receiver.refKind === "current-user") {
        return renderPrincipal(e.member, ctx);
      }
      // Property navigation: `this.shipTo.city` → `e.shipTo.city`
      // (embedded path).  JPQL navigates record components by name.
      return `${render(e.receiver, ctx)}.${jid(e.member)}`;
    case "paren":
      return `(${render(e.inner, ctx)})`;
    case "unary":
      if (e.op === "!") return `not (${render(e.operand, ctx)})`;
      return `${e.op}${render(e.operand, ctx)}`;
    case "binary":
      return renderBinary(e, ctx);
    case "exists": {
      // `exists <Agg> as s where p` — a correlated JPQL subquery over the
      // quantified entity.  Its own read scope is ANDed in with `this` rebound
      // to the subquery's alias: a Hibernate `@Filter` does not reach a
      // subquery, so leaving it to the entity mapping would let an `exists`
      // see rows its caller cannot read.
      const inner = ctx.aggs?.find((a) => a.name === e.aggregate);
      if (!inner) throw unsupported(ctx, `'exists ${e.aggregate}' without its aggregate in scope`);
      const alias = `q_${e.binding}`;
      const rows = new Map(ctx.rows ?? []);
      rows.set(e.binding, alias);
      const terms = [render(e.where, { ...ctx, rows })];
      for (const pred of existsScopePredicates(inner.name, ctx.aggs ?? [])) {
        terms.push(render(pred, { ...ctx, rows, alias }));
      }
      return `exists (select 1 from ${inner.name} ${alias} where ${terms.map((t) => `(${t})`).join(" and ")})`;
    }
    case "authz-filter": {
      // The DENY carve-out (authorization — deny-wins): an always-false JPQL
      // predicate; no row satisfies `1 = 0`.  `deny` is the only filter kind;
      // the typed binding makes a new kind a `tsc` error here, not a silent
      // authorization bypass.
      const _deny: "deny" = e.filter.kind;
      return "1 = 0";
    }
    case "method-call": {
      // Reference-collection membership: `this.<refColl>.contains(x)`.  The
      // collection is an `@ElementCollection` of an embeddable id
      // (`PokemonId(UUID value)`), so `:x member of e.<refColl>` throws at
      // runtime on Hibernate 6 ("Unsupported tuple comparison" — the element is
      // a tuple, the bind param is not).  Use a correlated existence subquery
      // with an embeddable-equality predicate instead, which Hibernate
      // decomposes per attribute (`p.value = :x.value`).
      // `organizationContext.ancestors.contains(<id column>)` — the column
      // tested against the operating org's lineage.  The column is an
      // `@Embedded` id record, so the test reads its `value` against the
      // lineage projected to UUIDs; an absent principal binds the empty list,
      // which matches nothing.
      const lineageArg = orgAncestorsMembershipArg(e);
      if (lineageArg) {
        if (isEntityManagerMode(ctx)) throw unsupported(ctx, "organizationContext.ancestors");
        return `${render(lineageArg, ctx)}.value in :#{@${CURRENT_USER_BEAN}.user()?.operatingAncestors()?.![value()] ?: T(java.util.List).of()}`;
      }
      if (e.member === "contains" && e.receiverType.kind === "array" && e.args.length === 1) {
        const coll = render(e.receiver, ctx);
        const val = render(e.args[0]!, ctx);
        const alias = `${coll.split(".").pop() ?? "elem"}_m`;
        return `exists (select 1 from ${coll} ${alias} where ${alias} = ${val})`;
      }
      // Queryable scalar intrinsic (src/util/intrinsics.ts) — render the
      // receiver recursively and apply the JPQL snippet.  Serves both the
      // column side (`this.name.trim()` → `trim(e.name)`) and the value
      // side (`q.trim()` → `trim(:q)`) — JPQL functions accept bind
      // parameters too.
      if (e.receiverType.kind === "primitive") {
        const sig = intrinsicFor(e.receiverType.name, e.member);
        const snippet = JPQL_INTRINSIC_SQL[intrinsicKey(e.receiverType.name, e.member)];
        if (sig?.queryable && snippet) {
          return snippet(
            render(e.receiver, ctx),
            e.args.map((a) => render(a, ctx)),
          );
        }
      }
      throw unsupported(ctx, `method call '${e.member}'`);
    }
    default:
      throw unsupported(ctx, `expression kind '${e.kind}'`);
  }
}

function renderLiteral(lit: string, value: string): string {
  if (lit === "string") return `'${value.replace(/'/g, "''")}'`;
  if (lit === "null") return "null";
  if (lit === "bool") return value;
  // Loom `now()` — HQL's `instant` (the current instant, java.time.Instant;
  // Hibernate 6+ grammar `currentDateTimeFunction`), matching the `Instant`
  // this backend maps `datetime` to.  Renders `current_timestamp` on the
  // SQL side.  (Before A5 this fell through to the bare IR value `now`,
  // which no HQL grammar accepts — temporal where-clauses made it live.)
  if (lit === "now") return "instant";
  // ints / longs / decimals / money are numeric literals in JPQL.
  return value;
}

function renderRef(e: Extract<ExprIR, { kind: "ref" }>, ctx: JpqlCtx): string {
  switch (e.refKind) {
    case "param":
      // The bind-parameter name is a JPQL identifier too — `:case` is the CASE
      // keyword to the HQL parser — and it has to match the name the repository
      // binds with, which is the mangled java parameter (M-T6.36).
      return `:${jid(e.name)}`;
    case "this-prop":
    case "this-vo-prop":
      // A JPQL path names the JPA ATTRIBUTE, which is the (possibly mangled)
      // java field the entity emitter declared — not the `.ddd` name and not
      // the column.
      return `${ctx.alias}.${jid(e.name)}`;
    case "enum-value":
      // JPQL enum literals must be fully qualified.
      return `${ctx.enumsPkg}.${e.enumName}.${jid(e.name)}`;
    case "row": {
      // An `exists … as <row>` binding — its subquery alias.
      const alias = ctx.rows?.get(e.name);
      if (!alias) throw unsupported(ctx, `'${e.name}' outside its 'exists'`);
      return alias;
    }
    default:
      throw unsupported(ctx, `ref kind '${e.refKind}' ('${e.name}')`);
  }
}

// HQL duration-unit keyword per Loom duration unit (A5 temporal) — the
// `<magnitude> <unit>` "to duration" form of Hibernate 6+'s HQL grammar
// (`toDurationExpression: expression datetimeField`), which translates to
// native SQL interval arithmetic on Postgres.
const HQL_DURATION_UNIT: Record<DurationUnit, string> = {
  days: "day",
  hours: "hour",
  minutes: "minute",
};

/** The recorded binding entry for a whole principal term, decided in Java
 *  (`principalBindExpr` turns it back into the Boolean expression). */
export function principalTermBindEntry(pt: PrincipalTerm, enumsPkg: string): string | null {
  const test = javaPrincipalTest(
    pt,
    PRINCIPAL_VAR_HOLE,
    (enumName, value) => `${enumsPkg}.${enumName}.${value}`,
  );
  return test === null ? null : `${PRINCIPAL_TERM_BIND}${test}`;
}

/** The recorded binding entry for "an actor is present and its nullable claim
 *  `member` is null" — a Boolean. */
export function claimIsNullBindEntry(member: string): string {
  return `${CLAIM_IS_NULL_BIND}${member}`;
}

/** The recorded binding entry for an enum claim read as its name (a String):
 *  the enum column stores the `.ddd` spelling as text. */
export function enumNameBindEntry(member: string): string {
  return `${ENUM_NAME_BIND}${member}`;
}

/** Marker prefix for a recorded binding that is an enum claim's name. */
const ENUM_NAME_BIND = "enumName:";

/** The recorded binding entry for a principal list of typed ids (the operating
 *  org's lineage) read as ONE comma-joined String: a Hibernate filter
 *  parameter binds a single value, and a uuid never contains a comma, so the
 *  condition splits it back with `string_to_array`.  Null without a
 *  principal, so the membership matches no row. */
export function idListCsvBindEntry(member: string): string {
  return `${ID_LIST_CSV_BIND}${member}`;
}

/** Marker prefix for a recorded binding that is a comma-joined id list. */
const ID_LIST_CSV_BIND = "idListCsv:";

/** Marker prefix for a recorded `principalAccessors` binding that is a whole
 *  principal term, decided in Java: the rest of the entry is the boolean
 *  expression with {@link PRINCIPAL_VAR_HOLE} standing for the principal. */
const PRINCIPAL_TERM_BIND = "principalTerm:";
const PRINCIPAL_VAR_HOLE = "__loomPrincipal__";

/** A principal term (`currentUser.role == "agent"`) as a Java boolean over the
 *  nullable principal `base` — false when there is no principal, so the term
 *  fails closed.  Shared by the JPQL EntityManager binding and the Criteria
 *  `tenantScope` factory; `enumRef` spells an enum value for the call site. */
export function javaPrincipalTest(
  pt: PrincipalTerm,
  base: string,
  enumRef: (enumName: string, value: string) => string,
): string | null {
  const longClaim = [pt.left, pt.right].some((o) => {
    if (o.kind !== "claim") return false;
    const t = o.type.kind === "optional" ? o.type.inner : o.type;
    return t.kind === "primitive" && t.name === "long";
  });
  const test = renderPrincipalTest(pt, {
    claim: (field) => `${base}.${field}()`,
    value: (v) => {
      if (v.kind === "ref" && v.refKind === "enum-value" && v.enumName)
        return enumRef(v.enumName, jid(v.name));
      if (v.kind !== "literal") return null;
      if (v.lit === "string") return JSON.stringify(v.value);
      if (v.lit === "int" || v.lit === "long") return longClaim ? `${v.value}L` : v.value;
      if (v.lit === "bool") return v.value;
      return null;
    },
    isNull: (x) => `${x} == null`,
    isNotNull: (x) => `${x} != null`,
    eq: (l, r) => `java.util.Objects.equals(${l}, ${r})`,
    ne: (l, r) => `!java.util.Objects.equals(${l}, ${r})`,
  });
  return test === null ? null : `(${base} != null && ${test})`;
}

/** A principal term in JPQL.  Its truth is fixed for the request, so it is
 *  decided outside the query and bound as one Boolean compared to `true`: SpEL
 *  in a Spring Data `@Query`, Java at the `setParameter` site in EntityManager
 *  mode.  Both forms are false without a principal (fail-closed). */
function renderPrincipalTermJpql(pt: PrincipalTerm, ctx: JpqlCtx): string {
  const enumRef = (enumName: string, value: string): string =>
    `${ctx.enumsPkg}.${enumName}.${value}`;
  if (isEntityManagerMode(ctx)) {
    const test = javaPrincipalTest(pt, PRINCIPAL_VAR_HOLE, enumRef);
    if (test === null) throw unsupported(ctx, "principal term operand");
    const entry = `${PRINCIPAL_TERM_BIND}${test}`;
    ctx.principalAccessors?.add(entry);
    return `:${principalParamName(entry)} = true`;
  }
  const user = `@${CURRENT_USER_BEAN}.user()`;
  const test = renderPrincipalTest(pt, {
    claim: (field) => `${user}.${field}()`,
    value: (v) => {
      if (v.kind === "ref" && v.refKind === "enum-value" && v.enumName)
        return `T(${ctx.enumsPkg}.${v.enumName}).${jid(v.name)}`;
      if (v.kind !== "literal") return null;
      if (v.lit === "string") return `'${v.value.replace(/'/g, "''")}'`;
      if (v.lit === "int" || v.lit === "long" || v.lit === "bool") return v.value;
      return null;
    },
    isNull: (x) => `${x} == null`,
    isNotNull: (x) => `${x} != null`,
    eq: (l, r) => `${l} == ${r}`,
    ne: (l, r) => `${l} != ${r}`,
  });
  if (test === null) throw unsupported(ctx, "principal term operand");
  return `:#{${user} != null and (${test})} = true`;
}

function renderBinary(e: Extract<ExprIR, { kind: "binary" }>, ctx: JpqlCtx): string {
  const pt = principalTerm(e);
  if (pt) return renderPrincipalTermJpql(pt, ctx);
  // A5 temporal — `datetime ± days/hours/minutes(n)` renders as HQL
  // duration arithmetic: `(e.dueDate + 30 day)`.  Works on BOTH sides of a
  // comparison (a column path navigates, a `:param` datetime binds, and the
  // amount likewise binds or navigates).  Only the DIRECT constructor
  // operand form reaches here (paren-transparent) — exactly what
  // `firstNonQueryableNode` admits; the commuted `days(2) + q` normalizes
  // to `(:q + 2 day)` (addition commutes).  Loom `datetime - datetime` in
  // where-position stays rejected by the gate, so no arm is needed for it.
  if (e.op === "+" || e.op === "-") {
    const rightDur = durationCtorOperand(e.right);
    const leftDur = e.op === "+" ? durationCtorOperand(e.left) : null;
    const dur = rightDur ?? leftDur;
    const other = rightDur ? e.left : leftDur ? e.right : null;
    if (dur && other && !durationCtorOperand(other)) {
      const amount = render(dur.amount, ctx);
      return `(${render(other, ctx)} ${e.op} ${amount} ${HQL_DURATION_UNIT[dur.unit]})`;
    }
  }
  const isNull = (x: ExprIR): boolean => x.kind === "literal" && x.lit === "null";
  if ((e.op === "==" || e.op === "!=") && (isNull(e.left) || isNull(e.right))) {
    const operand = isNull(e.left) ? e.right : e.left;
    return `${render(operand, ctx)} is ${e.op === "==" ? "" : "not "}null`;
  }
  const op = jpqlOp(e.op);
  // An id column against `organizationContext.org`: the operating org is a
  // claim string that need not be a registry id, so the comparison is on the
  // column's text — a uuid parameter would fail to bind a non-uuid claim.
  const orgCmp = idColumnVsOperatingOrg(e);
  if (orgCmp) {
    return `cast(${render(orgCmp.column, ctx)}.value as String) ${orgCmp.negated ? "<>" : "="} ${render(orgCmp.org, ctx)}`;
  }
  // Self-id vs principal-claim comparison (`this.id == currentUser.<claim>` —
  // the derived tenancy registry self-scope).  The entity key is an
  // `@EmbeddedId` record (`OrganizationId(UUID value)`), so the comparison
  // navigates into its component (`e.id.value`) and the SpEL principal side
  // binds the claim AS the id's value type: a same-typed claim binds directly
  // (Hibernate 6 rejects a String parameter against a UUID path), a `string`
  // claim against a guid id converts through the principal's emitted
  // `<claim>AsUuid()` accessor (M-T3.7(c)), which yields null for BOTH a
  // missing principal and a MALFORMED claim — the fail-closed `= NULL`.
  // Converting inline in SpEL (`T(java.util.UUID).fromString`) could only
  // null-guard, so an authenticated token carrying `tenantId: "not-a-guid"`
  // threw IllegalArgumentException out of query preparation and answered an
  // ordinary bad token with a 500.
  if (e.op === "==" || e.op === "!=") {
    const idSide = selfIdTypeOf(e.left) ? e.left : selfIdTypeOf(e.right) ? e.right : null;
    const other = idSide === e.left ? e.right : e.left;
    const claim = principalClaimOf(other);
    if (idSide && claim) {
      const idPath = `${ctx.alias}.id.value`;
      const claimIsString = claim.type?.kind === "primitive" && claim.type.name === "string";
      const accessor = claimIsString ? guidClaimAccessorName(claim.member) : claim.member;
      const spel = renderPrincipal(accessor, ctx);
      return idSide === e.left ? `${idPath} ${op} ${spel}` : `${spel} ${op} ${idPath}`;
    }
  }
  const nullAware = renderNullableComparison(e, op, ctx);
  if (nullAware !== null) return nullAware;
  return `${render(e.left, ctx)} ${op} ${render(e.right, ctx)}`;
}

/** Marker prefix for a recorded `principalAccessors` binding that is the
 *  "an actor is present and its claim is null" TEST for a nullable claim —
 *  bound as a Boolean by {@link principalBindExpr}. */
const CLAIM_IS_NULL_BIND = "claimIsNull:";

/** JPQL boolean predicate that is true exactly when a NULLABLE comparison value
 *  is null — or null when `x` is not one.  A nullable value is a
 *  `currentUser.<claim>` declared `T?` or a find parameter typed `T?` (the two
 *  shapes the node twin, `isNullableValue` in `repository-find-predicate.ts`,
 *  branches on).  The claim test also requires an actor: an absent principal
 *  stays fail-closed (its `= NULL` comparison matches nothing) instead of
 *  reading the NULL-column rows.  Spring Data mode evaluates the test in SpEL
 *  so the bind is a typed Boolean (a bare `:p is null` hands Postgres an
 *  untyped parameter); the EntityManager mode, which has no SpEL layer, binds
 *  the claim test as a derived principal parameter and tests a find param
 *  with `is null`. */
function isNullableValue(x: ExprIR): boolean {
  if (x.kind === "paren") return isNullableValue(x.inner);
  if (x.kind === "member")
    return (
      x.receiver.kind === "ref" &&
      x.receiver.refKind === "current-user" &&
      x.memberType.kind === "optional"
    );
  return x.kind === "ref" && x.refKind === "param" && x.type?.kind === "optional";
}

function nullValueTest(x: ExprIR, ctx: JpqlCtx): string | null {
  if (x.kind === "paren") return nullValueTest(x.inner, ctx);
  if (
    x.kind === "member" &&
    x.receiver.kind === "ref" &&
    x.receiver.refKind === "current-user" &&
    x.memberType.kind === "optional"
  ) {
    if (isEntityManagerMode(ctx)) {
      const entry = `${CLAIM_IS_NULL_BIND}${x.member}`;
      ctx.principalAccessors?.add(entry);
      return `:${principalParamName(entry)} = true`;
    }
    const user = `@${CURRENT_USER_BEAN}.user()`;
    return `:#{${user} != null and ${user}.${x.member}() == null} = true`;
  }
  if (x.kind === "ref" && x.refKind === "param" && x.type?.kind === "optional") {
    return isEntityManagerMode(ctx)
      ? `:${jid(x.name)} is null`
      : `:#{#${jid(x.name)} == null} = true`;
  }
  return null;
}

/** Null-aware comparison of a column against a NULLABLE value (eval B-A6b).
 *  JPQL `e.col = :v` with a null `:v` is `col = NULL` — UNKNOWN, no row — where
 *  Loom (and the node twin, #3085) reads `==` against null as `IS NULL` and
 *  `!=` as `IS NOT NULL`.  An ordering against null matches no row on every
 *  backend, so only `==`/`!=` grow the null arm.  Null for any other shape. */
function renderNullableComparison(
  e: Extract<ExprIR, { kind: "binary" }>,
  op: string,
  ctx: JpqlCtx,
): string | null {
  if (e.op !== "==" && e.op !== "!=") return null;
  // Exactly one side is the nullable value; a value-vs-value comparison keeps
  // the plain rendering.
  const leftIsValue = isNullableValue(e.left);
  if (leftIsValue === isNullableValue(e.right)) return null;
  const test = nullValueTest(leftIsValue ? e.left : e.right, ctx)!;
  const col = render(leftIsValue ? e.right : e.left, ctx);
  const cmp = `${render(e.left, ctx)} ${op} ${render(e.right, ctx)}`;
  return `(${cmp} or (${test} and ${col} is ${e.op === "==" ? "" : "not "}null))`;
}

/** The id TypeIR of a `this.id` member access (the aggregate's own key), or
 *  null for any other shape. */
function selfIdTypeOf(x: ExprIR): Extract<TypeIR, { kind: "id" }> | null {
  if (x.kind === "paren") return selfIdTypeOf(x.inner);
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

/** A `currentUser.<claim>` member access — returns the claim member name and
 *  its declared type, or null. */
function principalClaimOf(x: ExprIR): { member: string; type: TypeIR | undefined } | null {
  if (x.kind === "paren") return principalClaimOf(x.inner);
  if (x.kind === "member" && x.receiver.kind === "ref" && x.receiver.refKind === "current-user") {
    return { member: x.member, type: x.memberType };
  }
  return null;
}

function jpqlOp(op: string): string {
  switch (op) {
    case "==":
      return "=";
    case "!=":
      return "<>";
    case "&&":
      return "and";
    case "||":
      return "or";
    default:
      // <, <=, >, >=, +, -, *, / are JPQL-native.
      return op;
  }
}

/** Route a JPQL out-of-vocabulary construct through the shared
 *  `QueryEmissionRefusal` (§F2, Wave 2 packet 2.4) — `ctx.mode` defaults to
 *  `"jpql-spring-data"` (both sub-modes share the same vocabulary, so the
 *  choice only affects the diagnostic's `mode` field, never whether it
 *  fires). */
function unsupported(ctx: JpqlCtx, what: string): never {
  refuseOutOfVocabulary(ctx.mode ?? "jpql-spring-data", what);
}
