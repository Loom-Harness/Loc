import { diagMessage } from "../../../diagnostics/messages.js";
import type { AggregateIR, EnrichedLoomModel, ExprIR, TypeIR } from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import { databaseModules, databaseOf } from "../../util/databases.js";
import { sqlRenderableExpr, sqlTemporalArith } from "../../util/sql-renderable-expr.js";
import { resolveTableStepTarget } from "../../util/table-step-target.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// ---------------------------------------------------------------------------
// Migration-block data-step checks (M-T2.3) — phase ⑦, over the lowered IR.
//
// The AST-level checks (validators/migration.ts) cover the structural shapes
// (live field, per-block duplicates, empty sql).  Here, with the fully-typed
// ExprIR in hand, we gate what the phase-⑨ builder can actually render:
//
//   - `loom.migration-expr-invalid`   — backfill expression outside the
//     SQL-renderable subset (`sqlRenderableExpr`, ir/util).
//   - `loom.backfill-target-invalid`  — the target field has no single
//     scalar column: value-object / collection / entity fields, and
//     `shape: document` / `persistedAs: eventLog` aggregates (no row columns
//     to backfill — use a raw `sql` step over the document payload instead).
//   - `loom.backfill-type-mismatch`       — the expression's inferred type
//     doesn't fit the field's declared type.  Best-effort: an unknown side
//     never diagnoses (no false positives on partially-typed IR).
// ---------------------------------------------------------------------------

export function validateMigrationDataSteps(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  const aggByContext = new Map<string, Map<string, AggregateIR>>();
  for (const ctx of allContexts(loom)) {
    const m = aggByContext.get(ctx.name) ?? new Map<string, AggregateIR>();
    for (const a of ctx.aggregates) m.set(a.name, a);
    aggByContext.set(ctx.name, m);
  }

  for (const intent of loom.backfillIntents) {
    const source = `migration/${intent.migration}`;
    const agg = aggByContext.get(intent.context)?.get(intent.aggregate);
    // An unresolvable aggregate is a linking error the AST layer already
    // reported; stay quiet here.
    if (!agg) continue;

    if ((agg.savingShape ?? "relational") === "document" || agg.persistedAs === "eventLog") {
      diags.push({
        severity: "error",
        code: "loom.backfill-target-invalid",
        message: diagMessage("loom.backfill-target-invalid#backfill-a-aggregate-stores", {
          aggregate: intent.aggregate,
          field: intent.field,
          persistedAs: agg.persistedAs === "eventLog" ? "persistedAs: eventLog" : "shape: document",
        }),
        source,
      });
      continue;
    }

    const field = agg.fields.find((f) => f.name === intent.field);
    // Unknown field is the AST-level `loom.backfill-unknown-field`.
    if (!field) continue;
    if (!isScalarColumnType(field.type)) {
      // An inline value collection is one Postgres array column, and the
      // migration builder already fills it with the empty collection when it
      // is added NOT NULL to a populated table — so the step is unnecessary,
      // and the message says that rather than "cannot be backfilled".
      const inlineCollection = isInlineCollectionType(field.type);
      diags.push({
        severity: "error",
        code: "loom.backfill-target-invalid",
        message: inlineCollection
          ? diagMessage("loom.backfill-target-invalid#backfill-collection-needs-none", {
              aggregate: intent.aggregate,
              field: intent.field,
            })
          : diagMessage("loom.backfill-target-invalid#backfill-the-field-is-not", {
              aggregate: intent.aggregate,
              field: intent.field,
            }),
        source,
      });
      continue;
    }

    const renderable = sqlRenderableExpr(intent.value);
    if (renderable !== true) {
      diags.push({
        severity: "error",
        code: "loom.migration-expr-invalid",
        message: diagMessage("loom.migration-expr-invalid", {
          aggregate: intent.aggregate,
          field: intent.field,
          reason: renderable.reason,
        }),
        source,
      });
      continue;
    }

    const fit = backfillTypeFits(field.type, intent.value);
    // A required column cannot take a value that may be NULL: the UPDATE
    // writes the NULL and the `SET NOT NULL` that follows it fails on that
    // row at boot.  The family check above strips `?`, so this is its own
    // test — over every optional sibling the expression can return as-is.
    const nullableFrom =
      fit === true && field.type.kind !== "optional"
        ? nullableSources(intent.value, (name) => agg.fields.find((f) => f.name === name)?.type)
        : [];
    if (nullableFrom.length > 0) {
      diags.push({
        severity: "error",
        code: "loom.backfill-type-mismatch",
        message: diagMessage("loom.backfill-type-mismatch#optional-source", {
          aggregate: intent.aggregate,
          field: intent.field,
          sources: nullableFrom.map((n) => `'${n}'`).join(", "),
          example: nullableFrom[0],
        }),
        source,
      });
    } else if (fit !== true && fit.expected === "guid" && fit.got === "string") {
      diags.push({
        severity: "error",
        code: "loom.backfill-type-mismatch",
        message: diagMessage("loom.backfill-type-mismatch#guid-literal", {
          aggregate: intent.aggregate,
          field: intent.field,
        }),
        source,
      });
    } else if (fit !== true) {
      diags.push({
        severity: "error",
        code: "loom.backfill-type-mismatch",
        message: diagMessage("loom.backfill-type-mismatch", {
          aggregate: intent.aggregate,
          field: intent.field,
          got: fit.got,
          expected: fit.expected,
        }),
        source,
      });
    }
  }
}

/** Does the field map to exactly one scalar column?  Mirrors the migration
 *  builder's column derivation: primitives, enums and `X id` refs are single
 *  columns; value objects flatten to several; arrays/entities are child
 *  tables. */
function isScalarColumnType(t: TypeIR): boolean {
  switch (t.kind) {
    case "primitive":
    case "enum":
    case "id":
      return true;
    case "optional":
      return isScalarColumnType(t.inner);
    default:
      return false;
  }
}

/** A collection of primitives or enum values — stored inline as one Postgres
 *  array column on every backend (value-object, entity and `X id` collections
 *  live in child or join tables instead). */
function isInlineCollectionType(t: TypeIR): boolean {
  if (t.kind === "optional") return isInlineCollectionType(t.inner);
  return t.kind === "array" && (t.element.kind === "primitive" || t.element.kind === "enum");
}

/** Best-effort inferred "SQL family" of a backfill expression — one of the
 *  primitive names, an `enum:<Name>`, `"null"`, or undefined (unknown). */
function sqlExprFamily(e: ExprIR): string | undefined {
  switch (e.kind) {
    case "literal":
      switch (e.lit) {
        case "string":
          return "string";
        case "int":
          return "int";
        case "long":
          return "long";
        case "decimal":
          return "decimal";
        case "money":
          return "money";
        case "bool":
          return "bool";
        case "null":
          return "null";
        case "now":
          return "datetime";
      }
      return undefined;
    case "ref":
      if (e.refKind === "enum-value") return e.enumName ? `enum:${e.enumName}` : undefined;
      return e.type ? typeFamily(e.type) : undefined;
    case "paren":
      return sqlExprFamily(e.inner);
    case "unary":
      return e.op === "!" ? "bool" : sqlExprFamily(e.operand);
    case "binary": {
      if (e.resultType) return typeFamily(e.resultType);
      if (["<", "<=", ">", ">=", "==", "!=", "&&", "||"].includes(e.op)) return "bool";
      return e.leftType ? typeFamily(e.leftType) : sqlExprFamily(e.left);
    }
    case "ternary":
      return sqlExprFamily(e.then) ?? sqlExprFamily(e.otherwise);
    case "coalesce":
      return sqlExprFamily(e.fallback) ?? sqlExprFamily(e.left);
    // No family — and that is SAFE here by construction: this classifier only
    // ever sees a backfill expression, and `sqlRenderableExpr`
    // (`src/ir/util/sql-renderable-expr.ts`) has already refused every kind
    // below with `loom.migration-expr-invalid`, so reaching one of these is
    // dead code rather than an unchecked value.  `undefined` means "type
    // unknown → skip the family comparison", never "types agree".  Named
    // rather than left to a `default:` so a new `ExprIR` kind is a decision
    // taken in both places at once.
    case "exists":
    case "action-ref":
    case "authz-filter":
    case "call":
    case "convert":
    case "duration":
    case "i18nFormat":
    case "modelText":
    case "id":
    case "lambda":
    case "list":
    case "match":
    case "member":
    case "method-call":
    case "new":
    case "object":
    case "this":
      return undefined;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return undefined;
    }
  }
}

// ---------------------------------------------------------------------------
// Table placement on the unqualified-SQL adapters.
//
// Every persistence adapter applies the phase-⑨ migration chain, which routes
// a context's tables into its binding's Postgres schema (`snake(<context>)` by
// default, or the binding's `schema:`).  Dapper and MikroORM name their tables
// UNQUALIFIED and reach them through the connection's `search_path`, which
// places a schema but cannot apply a `tablePrefix:` — a rename their SQL never
// applies, so the migrations would create prefixed tables no statement reads.
// That one request is refused, scoped to the adapter: `persistence: efcore` /
// `drizzle` on the same platform honour it.
// ---------------------------------------------------------------------------

/** The adapters whose repositories name tables unqualified and unprefixed. */
const UNQUALIFIED_SQL_ADAPTERS = new Set(["dapper", "mikroorm"]);

export function validateTablePrefixSupport(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  for (const sys of loom.systems) {
    for (const dep of sys.deployables) {
      if (!dep.persistence || !UNQUALIFIED_SQL_ADAPTERS.has(dep.persistence)) continue;
      // Bindings that put tables on disk: a `cache` / `replica` binding
      // carries no aggregate tables.
      const asking = sys.dataSources.find(
        (d) =>
          (d.kind === "state" || d.kind === "eventLog") &&
          dep.dataSourceNames.includes(d.name) &&
          dep.contextNames.includes(d.contextName) &&
          d.tablePrefix !== undefined,
      );
      if (!asking) continue;
      const params = {
        name: dep.name,
        binding: asking.name,
        asked: `tablePrefix: "${asking.tablePrefix}"`,
      };
      const source = `${sys.name}/${dep.name}`;
      if (dep.persistence === "dapper") {
        diags.push({
          severity: "error",
          code: "loom.dapper-unsupported",
          message: diagMessage("loom.dapper-unsupported#schema-ignored", params),
          source,
        });
      } else {
        diags.push({
          severity: "error",
          code: "loom.mikroorm-unsupported",
          message: diagMessage("loom.mikroorm-unsupported#schema-ignored", params),
          source,
        });
      }
    }
  }
}

/** The optional sibling fields whose NULL a backfill expression can return
 *  unchanged — empty when the expression always yields a value.  Mirrors the
 *  SQL the renderer emits: NULL propagates through every operator and
 *  comparison, a `CASE` returns whichever branch it takes, and only an
 *  `x == null` / `x != null` presence test both yields a non-NULL boolean and
 *  narrows `x` in the branch that follows it, and a `??` yields NULL only
 *  through its fallback (`label ?? "x"` is never NULL).  A `null`
 *  literal is not reported here: the family check already names it. */
function nullableSources(
  e: ExprIR,
  fieldType: (name: string) => TypeIR | undefined,
  nonNull: ReadonlySet<string> = new Set(),
): string[] {
  const rec = (x: ExprIR, nn: ReadonlySet<string> = nonNull) => nullableSources(x, fieldType, nn);
  switch (e.kind) {
    case "ref": {
      if (e.refKind !== "this-prop" || nonNull.has(e.name)) return [];
      return fieldType(e.name)?.kind === "optional" ? [e.name] : [];
    }
    case "paren":
      return rec(e.inner);
    case "unary":
      return rec(e.operand);
    case "binary": {
      if (presenceTest(e)) return [];
      const temporal = sqlTemporalArith(e);
      if (temporal) return uniq([...rec(temporal.datetime), ...rec(temporal.duration.amount)]);
      return uniq([...rec(e.left), ...rec(e.right)]);
    }
    case "ternary": {
      const test = presenceTest(e.cond);
      const narrowed = (branch: "then" | "otherwise"): ReadonlySet<string> => {
        if (!test) return nonNull;
        const isNullBranch = test.op === "==" ? "then" : "otherwise";
        return branch === isNullBranch ? nonNull : new Set([...nonNull, test.name]);
      };
      return uniq([...rec(e.then, narrowed("then")), ...rec(e.otherwise, narrowed("otherwise"))]);
    }
    // `COALESCE(left, fallback)` is NULL only when the fallback is.
    case "coalesce":
      return rec(e.fallback);
    // Literals carry their own value (`null` is the family check's case);
    // every other kind is refused by `sqlRenderableExpr` before this runs.
    case "exists":
    case "literal":
    case "action-ref":
    case "authz-filter":
    case "call":
    case "convert":
    case "duration":
    case "i18nFormat":
    case "modelText":
    case "id":
    case "lambda":
    case "list":
    case "match":
    case "member":
    case "method-call":
    case "new":
    case "object":
    case "this":
      return [];
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return [];
    }
  }
}

/** `<sibling> == null` / `<sibling> != null` (either operand order): the
 *  sibling it tests and the operator, or undefined. */
function presenceTest(e: ExprIR): { name: string; op: "==" | "!=" } | undefined {
  const inner = e.kind === "paren" ? e.inner : e;
  if (inner.kind !== "binary" || (inner.op !== "==" && inner.op !== "!=")) return undefined;
  const isNull = (x: ExprIR) => x.kind === "literal" && x.lit === "null";
  const other = isNull(inner.right) ? inner.left : isNull(inner.left) ? inner.right : undefined;
  const ref = other?.kind === "paren" ? other.inner : other;
  if (ref?.kind !== "ref" || ref.refKind !== "this-prop") return undefined;
  return { name: ref.name, op: inner.op };
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)];
}

function typeFamily(t: TypeIR): string | undefined {
  switch (t.kind) {
    case "primitive":
      return t.name;
    case "enum":
      return `enum:${t.name}`;
    case "id":
      return "id";
    case "optional":
      return typeFamily(t.inner);
    default:
      return undefined;
  }
}

const NUMERIC = new Set(["int", "long", "decimal", "money"]);

/** Does the expression's inferred family fit the field's declared type?
 *  Tolerant: unknown on either side never diagnoses; the numeric family is
 *  interchangeable (columns are wider than the literal); a string fits an
 *  enum column (enums store their text). */
function backfillTypeFits(
  fieldType: TypeIR,
  expr: ExprIR,
): true | { expected: string; got: string } {
  const got = sqlExprFamily(expr);
  if (got === undefined) return true;
  const optional = fieldType.kind === "optional";
  const expected = typeFamily(fieldType);
  if (expected === undefined) return true;
  if (got === "null") return optional ? true : { expected, got: "null" };
  if (got === expected) return true;
  if (NUMERIC.has(got) && NUMERIC.has(expected)) return true;
  if (expected.startsWith("enum:") && got === "string") return true;
  if (expected === "id" && got === "string") return true;
  // A `guid` column takes a UUID written as a string literal: Postgres reads
  // the quoted constant straight into the uuid column.  Any other string —
  // a malformed literal, or a text column's value — is refused, since
  // Postgres would reject it at apply time.
  if (expected === "guid" && got === "string" && isUuidLiteral(expr)) return true;
  return { expected, got };
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLiteral(e: ExprIR): boolean {
  if (e.kind === "paren") return isUuidLiteral(e.inner);
  return e.kind === "literal" && e.lit === "string" && UUID_TEXT.test(e.value);
}

// ---------------------------------------------------------------------------
// Migration table steps (`Old -> New`, `A.Old -> B.New`) — phase ⑦.
//
// The step's new side is a bare name (an aggregate, workflow or projection,
// possibly declared in another file), so it is resolved here on the merged
// model, by the same `resolveTableStepTarget` the phase-⑨ builder uses:
//
//   - `loom.migration-step-unknown-context` — the move names a context the
//     model does not declare.
//   - `loom.migration-step-target-missing`  — no aggregate, workflow or
//     projection of that name (in that context).
//   - `loom.migration-step-ambiguous`       — several declarations answer to
//     the unqualified name; qualify the step.
//   - `loom.migration-move-across-databases` — a move between two modules
//     where some database that receives the target module's migrations never
//     held the source module's tables (a database holds the modules every
//     deployable on it hosts — `src/ir/util/databases.ts`).
// ---------------------------------------------------------------------------

export function validateTableSteps(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  if (loom.tableRenameIntents.length === 0) return;
  const contexts = allContexts(loom);
  for (const step of loom.tableRenameIntents) {
    const source = `migration/${step.migration}`;
    const shown =
      step.toContext !== undefined
        ? `${step.fromContext}.${step.from} -> ${step.toContext}.${step.to}`
        : `${step.from} -> ${step.to}`;
    const r = resolveTableStepTarget(contexts, step);
    if (!r.ok) {
      if (r.reason === "unknown-context") {
        diags.push({
          severity: "error",
          code: "loom.migration-step-unknown-context",
          message: diagMessage("loom.migration-step-unknown-context", {
            step: shown,
            context: r.context,
          }),
          source,
          origin: step.origin,
        });
      } else if (r.reason === "missing") {
        diags.push({
          severity: "error",
          code: "loom.migration-step-target-missing",
          message: diagMessage("loom.migration-step-target-missing", {
            step: shown,
            name: step.toContext !== undefined ? `${step.toContext}.${step.to}` : step.to,
          }),
          source,
          origin: step.origin,
        });
      } else {
        diags.push({
          severity: "error",
          code: "loom.migration-step-ambiguous",
          message: diagMessage("loom.migration-step-ambiguous", {
            step: shown,
            name: step.to,
            candidates: r.candidates.join(", "),
          }),
          source,
          origin: step.origin,
        });
      }
      continue;
    }
    if (step.fromContext === undefined) continue;
    for (const sys of loom.systems) {
      const moduleOf = (ctx: string) =>
        sys.subdomains.find((m) => m.contexts.some((c) => c.name === ctx));
      const toModule = moduleOf(r.target.ctx.name);
      const fromModule = moduleOf(step.fromContext);
      // A source context the model no longer declares leaves nothing to
      // compare: the builder finds its tables in whichever module's chain
      // still records them.
      if (!toModule || !fromModule || toModule === fromModule) continue;
      // A database holds the tables of every module its deployables host; a
      // move needs the source tables in every database that receives the
      // target module.
      const stranded = sys.deployables.filter((d) => {
        const db = databaseOf(sys, d);
        if (!db) return false;
        const modules = databaseModules(sys, db.name);
        return modules.has(toModule.name) && !modules.has(fromModule.name);
      });
      if (stranded.length === 0) continue;
      diags.push({
        severity: "error",
        code: "loom.migration-move-across-databases",
        message: diagMessage("loom.migration-move-across-databases", {
          step: shown,
          from: fromModule.name,
          to: toModule.name,
          deployables: stranded.map((d) => d.name).join(", "),
        }),
        source,
        origin: step.origin,
      });
    }
  }
}
