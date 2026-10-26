import { diagMessage } from "../../../diagnostics/messages.js";
import type { AggregateIR, EnrichedLoomModel, ExprIR, TypeIR } from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import { sqlRenderableExpr, sqlTemporalArith } from "../../util/sql-renderable-expr.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// ---------------------------------------------------------------------------
// Migration-block data-step checks (M-T2.3) — phase ⑦, over the lowered IR.
//
// The AST-level checks (validators/migration.ts) cover the structural shapes
// (live field, per-block duplicates, empty sql).  Here, with the fully-typed
// ExprIR in hand, we gate what the phase-⑨ builder can actually render:
//
//   - `loom.migration-expr-unsupported`   — backfill expression outside the
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
        code: "loom.migration-expr-unsupported",
        message: diagMessage("loom.migration-expr-unsupported", {
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
    // No family — and that is SAFE here by construction: this classifier only
    // ever sees a backfill expression, and `sqlRenderableExpr`
    // (`src/ir/util/sql-renderable-expr.ts`) has already refused every kind
    // below with `loom.migration-expr-unsupported`, so reaching one of these is
    // dead code rather than an unchecked value.  `undefined` means "type
    // unknown → skip the family comparison", never "types agree".  Named
    // rather than left to a `default:` so a new `ExprIR` kind is a decision
    // taken in both places at once.
    case "action-ref":
    case "authz-filter":
    case "call":
    case "convert":
    case "duration":
    case "i18nFormat":
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
// Migration chain vs. persistence adapter (the SELF-PROVISIONING adapter).
//
// One adapter opts OUT of the phase-⑨ `MigrationsIR` chain and provisions its
// schema itself at boot:
//
//   - `persistence: mikroorm` — `hasMigrations = !usingMikro`
//     (`src/platform/hono/v4/emit.ts`, shared by v5); schema comes from
//     `orm.schema.updateSchema()`.
//
// (`persistence: dapper` was the other one until D-DAPPER-ALTER / M-T2.17: it
// now applies the same versioned chain as EF — `dapper-migrations.ts` — so a
// declared `migration` block reaches it like any other step.)
//
// That is fine for a FIRST boot.  It cannot carry a declared `migration`
// block, and the failure is SILENT in the worst way: `updateSchema()` has no
// rename intent to consult, so it sees a dropped column and an added one — it
// DROPS the old column and ADDS the new one, i.e. it deletes the very data the
// rename existed to keep.
//
// The declared intents are exactly the migration surface that lives on the IR
// at phase ⑦ (`renameIntents` / `tableRenameIntents` / `backfillIntents` /
// `sqlMigrationSteps`) — the derived `MigrationsIR` itself only exists in
// phase ⑨.  So the gate is here, and it makes the gap HONEST: a declared
// migration on the self-provisioning adapter is a compile error naming the
// adapter to switch to, instead of silent data loss.
// ---------------------------------------------------------------------------

/** The adapters whose tables are NOT placed by the migration chain alone.
 *  mikroorm self-provisions at boot (no chain, unqualified tables); dapper
 *  applies the chain but its repositories name every table UNQUALIFIED and rely
 *  on the connection `search_path` — which places a SCHEMA but cannot apply a
 *  `tablePrefix:` (`validateSelfProvisioningSchemaSupport`, further down).
 *  Only mikroorm is refused declared migration steps (`MIGRATION_LESS_ADAPTERS`).
 *
 *  The message KEYS stay as string literals at the `diagMessage(...)` call
 *  sites — `diagnostic-catalog.test.ts` reads them syntactically, so a key
 *  routed through a lookup table reads as an orphan entry. */
const SELF_PROVISIONING_ADAPTERS = new Set(["dapper", "mikroorm"]);

/** The adapters with no migration chain at all — a declared `migration` step
 *  can never run on them. */
const MIGRATION_LESS_ADAPTERS = new Set(["mikroorm"]);

export function validateMigrationAdapterSupport(
  loom: EnrichedLoomModel,
  diags: LoomDiagnostic[],
): void {
  // Declared migration steps, indexed by the context they name.  A raw
  // `sql "…"` step names no context (it is a system-wide statement), so it is
  // collected separately and charged to every self-provisioning deployable.
  const byContext = new Map<string, { migration: string; step: string }[]>();
  const add = (context: string, migration: string, step: string): void => {
    const list = byContext.get(context) ?? [];
    list.push({ migration, step });
    byContext.set(context, list);
  };
  for (const r of loom.renameIntents)
    add(r.context, r.migration, `rename ${r.aggregate}.${r.from}`);
  for (const t of loom.tableRenameIntents)
    add(t.context, t.migration, `rename ${t.fromAggregate} -> ${t.toAggregate}`);
  for (const b of loom.backfillIntents)
    add(b.context, b.migration, `backfill ${b.aggregate}.${b.field}`);
  const sqlSteps = loom.sqlMigrationSteps.map((s) => ({
    migration: s.migration,
    step: `sql step #${s.index}`,
  }));
  if (byContext.size === 0 && sqlSteps.length === 0) return;

  for (const sys of loom.systems) {
    for (const dep of sys.deployables) {
      if (!dep.persistence || !MIGRATION_LESS_ADAPTERS.has(dep.persistence)) continue;
      const hits = [...dep.contextNames.flatMap((c) => byContext.get(c) ?? []), ...sqlSteps];
      if (hits.length === 0) continue;
      // One diagnostic per deployable, naming the first offending step — the
      // fix (switch the adapter, or move the migration off this deployable) is
      // the same for every step, so N of them would be noise.
      const first = hits[0]!;
      const params = {
        name: dep.name,
        migration: first.migration,
        step: first.step,
        count: hits.length,
      };
      const source = `${sys.name}/${dep.name}`;
      diags.push({
        severity: "error",
        code: "loom.mikroorm-unsupported",
        message: diagMessage("loom.mikroorm-unsupported#migrations", params),
        source,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// The OTHER consequence of self-provisioning: no schema concept (F2-ADP-3).
//
// The self-provisioning adapter syncs its schema at boot and names every table
// UNQUALIFIED — mikroorm's `@Entity({ tableName: "as" })`.  (Dapper did too,
// with `CREATE TABLE IF NOT EXISTS "as"`, until it applied the migration chain
// — M-T2.17.  Its tables now land in the binding's schema like EF's; its SQL
// stays unqualified and reaches them through the connection's `search_path`,
// so it only refuses a `tablePrefix:`, which a search path cannot apply.)
// Every migration-chain adapter instead routes the table into the binding's
// Postgres schema, which `resolveDataSourceConfig` DEFAULTS to
// `snake(<context>)` when the DSL omits `schema:` — so EF Core emits
// `builder.ToTable("as", "alpha")` and Drizzle `pgSchema("alpha").table("as")`
// for a context named `Alpha` that declares nothing at all.
//
// Two silent failures follow, and neither needs an explicit `schema:` to
// appear:
//
//   SPLIT-BRAIN — one context served by BOTH kinds of adapter provisions TWO
//   physical tables (`public.as` and `alpha.as`).  Both deployables start, both
//   answer, and each sees an empty database the other is writing to.  This is
//   the shape #2668 deferred: the fix cannot live in the dotnet emitter,
//   because the disagreement is between two deployables.
//
//   DROPPED REQUEST — an EXPLICIT `schema:` / `tablePrefix:` on the binding is
//   simply ignored by the self-provisioning adapter, so a model that asks for
//   `schema: "legacy"` silently gets `public`.
//
// ONE EXEMPTION, and it is the case both messages above describe as impossible:
// `schema: "public"` with no `tablePrefix:`.  There the two namings CONVERGE —
// the migration chain emits `CREATE TABLE "public"."as"` / `ToTable("as",
// "public")`, and the self-provisioning adapter's UNQUALIFIED `CREATE TABLE
// "as"` resolves through Postgres's default `search_path` (`"$user", public`;
// no emitted connection string overrides it) to that same `public.as`.  So the
// split-brain arm's "would start against DIFFERENT physical tables" is untrue,
// and the dropped-request arm's own words give the game away: it says the
// tables "land in 'public'", which is exactly what was asked for.  A request an
// adapter happens to satisfy is not a request it dropped.
//
// `tablePrefix:` is NOT exempt even alongside `schema: "public"` — that one is
// genuinely dropped, and it renames the table rather than placing it.
//
// Both are gated here rather than in an emitter for the same reason the
// migration gate above is: the offending fact is a property of the SYSTEM's
// deployable/binding graph, which no single backend emitter can see.  Scoped to
// the ADAPTER, not the platform — `persistence: efcore` on the same `platform:
// dotnet` deployable is fine, and that is the fix the message names.
// ---------------------------------------------------------------------------
/** The one Postgres schema an UNQUALIFIED table name resolves to, so naming it
 *  explicitly asks for the placement a self-provisioning adapter already gives.
 *  Postgres's default `search_path` is `"$user", public` and no emitted
 *  connection string overrides it, so an unqualified `CREATE TABLE "as"` lands
 *  in `public` unless a schema named after the connecting role exists. */
const UNQUALIFIED_SCHEMA = "public";

/** Does this binding ask for a table PLACEMENT the self-provisioning adapter
 *  cannot give?  An explicit `schema: "public"` does not (see the exemption in
 *  the block comment above); a `tablePrefix:` always does, on its own or
 *  alongside one. */
function asksUnhonourablePlacement(d: { schema?: string; tablePrefix?: string }): boolean {
  if (d.tablePrefix !== undefined) return true;
  return d.schema !== undefined && d.schema !== UNQUALIFIED_SCHEMA;
}

export function validateSelfProvisioningSchemaSupport(
  loom: EnrichedLoomModel,
  diags: LoomDiagnostic[],
): void {
  for (const sys of loom.systems) {
    // Bindings that put tables on disk.  `cache` / `replica` bindings carry no
    // aggregate tables, so a schema on one is not a table-placement decision.
    const tableBindings = sys.dataSources.filter(
      (d) => d.kind === "state" || d.kind === "eventLog",
    );
    if (tableBindings.length === 0) continue;
    const boundContexts = new Set(tableBindings.map((d) => d.contextName));

    /** Deployables that actually provision tables for `ctx`: they host it AND
     *  wire at least one of its table bindings.  A deployable that hosts a
     *  context without wiring its dataSource emits no schema for it. */
    const provisioners = (ctxName: string) =>
      sys.deployables.filter(
        (dep) =>
          dep.contextNames.includes(ctxName) &&
          tableBindings.some(
            (d) => d.contextName === ctxName && dep.dataSourceNames.includes(d.name),
          ),
      );

    for (const ctxName of boundContexts) {
      const hosts = provisioners(ctxName);
      const selfProv = hosts.filter(
        (d) => d.persistence && SELF_PROVISIONING_ADAPTERS.has(d.persistence),
      );
      if (selfProv.length === 0) continue;
      // Hosts whose tables land in the binding's schema — every adapter but
      // the migration-less one (dapper included: its chain qualifies them).
      const qualifying = hosts.filter(
        (d) => !d.persistence || !MIGRATION_LESS_ADAPTERS.has(d.persistence),
      );

      for (const dep of selfProv) {
        const source = `${sys.name}/${dep.name}`;
        const isDapper = dep.persistence === "dapper";
        // The bindings this deployable actually wires for `ctxName`.  When
        // EVERY one of them places its tables where an unqualified name already
        // resolves, the two adapters name the SAME physical table and neither
        // arm below has anything to report (see the exemption in the block
        // comment above).  `.every` over a non-empty list: `selfProv`
        // membership came from `provisioners`, which required at least one.
        const wired = tableBindings.filter(
          (d) => d.contextName === ctxName && dep.dataSourceNames.includes(d.name),
        );
        const converges = wired.every(
          (d) => d.schema === UNQUALIFIED_SCHEMA && d.tablePrefix === undefined,
        );
        // (1) split-brain — a sibling adapter qualifies the same context.  Not
        // on dapper: it creates its tables through the same migration chain, in
        // the same schema, as the sibling does — the two share one table.  (A
        // `tablePrefix:` it cannot honour is refused by arm (2) whatever the
        // siblings are.)
        if (qualifying.length > 0 && !converges && !isDapper) {
          const params = {
            name: dep.name,
            adapter: dep.persistence,
            ctxName,
            other: qualifying[0]!.name,
            otherAdapter: qualifying[0]!.persistence ?? qualifying[0]!.platform,
          };
          diags.push({
            severity: "error",
            code: "loom.mikroorm-unsupported",
            message: diagMessage("loom.mikroorm-unsupported#schema-split", params),
            source,
          });
          continue;
        }
        // (2) no sibling, but the binding ASKS for a placement this adapter
        // cannot honour.  Only an EXPLICIT `schema:` / `tablePrefix:` is a
        // request — the `snake(ctx)` default is what a lone self-provisioning
        // deployable already lives with consistently.
        // Dapper places a `schema:` (its migrations create the tables there and
        // its connection's `search_path` names it), so only a `tablePrefix:` —
        // a RENAME its unqualified repository SQL never applies — is a request
        // it drops.
        const asking = tableBindings.find(
          (d) =>
            d.contextName === ctxName &&
            dep.dataSourceNames.includes(d.name) &&
            (isDapper ? d.tablePrefix !== undefined : asksUnhonourablePlacement(d)),
        );
        if (!asking) continue;
        const params = {
          name: dep.name,
          adapter: dep.persistence,
          binding: asking.name,
          // Name the clause that is actually unhonourable, not merely the
          // first one present: `schema: "public"` alongside a `tablePrefix:`
          // is satisfied (see the exemption above), so quoting it here would
          // point the author at the one clause they may keep.
          asked:
            !isDapper && asking.schema !== undefined && asking.schema !== UNQUALIFIED_SCHEMA
              ? `schema: "${asking.schema}"`
              : `tablePrefix: "${asking.tablePrefix}"`,
        };
        if (isDapper) {
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
}

/** The optional sibling fields whose NULL a backfill expression can return
 *  unchanged — empty when the expression always yields a value.  Mirrors the
 *  SQL the renderer emits: NULL propagates through every operator and
 *  comparison, a `CASE` returns whichever branch it takes, and only an
 *  `x == null` / `x != null` presence test both yields a non-NULL boolean and
 *  narrows `x` in the branch that follows it (`label ?? "x"` lowers to
 *  `label == null ? "x" : label`, so its `label` is never NULL).  A `null`
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
    // Literals carry their own value (`null` is the family check's case);
    // every other kind is refused by `sqlRenderableExpr` before this runs.
    case "literal":
    case "action-ref":
    case "authz-filter":
    case "call":
    case "convert":
    case "duration":
    case "i18nFormat":
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
  return { expected, got };
}
