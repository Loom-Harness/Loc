// ---------------------------------------------------------------------------
// A query-time projection's parameters, as the read route binds them.
//
// `projection X(p: T, …) { from … where … }` is a parameterised read.  Its
// DECLARED parameters are the route's only filter input (owner ruling 15 on the
// projection semantics plan, D-PROJECTION-PARAMS): the route reads exactly
// those names off the query string, checks each against its declared type the
// way an operation input is checked, and the `where` reads the bound, typed
// value.  No other query key reaches the query, on any emission arm — grouped,
// singleton, repository, workflow-sourced or projection-sourced.
//
// Every backend makes the same three decisions for each parameter, so they are
// answered once here:
//
//   * its WIRE NAME — the declared name, verbatim (`?minScore=`, never a
//     target-cased `min_score`);
//   * whether it is REQUIRED — every parameter is, unless declared `T?`;
//   * the CHECK its query-string text must pass — the type this app's OpenAPI
//     document publishes for it (`wireTypeInfo(…, "request")`).  A value that
//     fails, or a required parameter that is absent, is refused with the
//     422 `field-invalid` envelope at `/<name>` before any query runs.
//
// How a backend spells the check (a zod schema, a pydantic annotation, a typed
// action parameter, an explicit Elixir checker) stays idiomatic; WHICH check
// applies does not.  `test/system/projection-params-census.test.ts` holds every
// backend's query-projection emitter to reading its parameters through
// `projectionQueryParams`.
// ---------------------------------------------------------------------------

import { integerWire } from "../enrich/codec.js";
import type { BoundedContextIR, ProjectionIR, TypeIR } from "../types/loom-ir.js";
import { wireTypeInfo } from "../types/wire-types.js";
import { enumPool } from "../util/reachable-types.js";

/** What a query-string value must parse as to be admitted.  `present` is the
 *  fallback for a shape one query-string scalar cannot carry: only absence is
 *  refused. */
export type QueryParamCheck =
  | { kind: "present" }
  | { kind: "string" }
  | { kind: "uuid" }
  | { kind: "integer"; min: number; max: number }
  | { kind: "decimal" }
  | { kind: "bool" }
  | { kind: "datetime" }
  | { kind: "date" }
  | { kind: "enum"; values: readonly string[] };

/** The check kinds whose query-string text can fail to PARSE as the declared
 *  type: each answers `field.type-mismatch` with one fixed sentence.  The other
 *  kinds either cannot mismatch (`present`, `string`) or carry a ruled reason
 *  of their own (`uuid` → `malformed-id`; an integer that parses but leaves its
 *  range → `integer-range`). */
export type QueryParamMismatchKind = Extract<
  QueryParamCheck["kind"],
  "integer" | "decimal" | "bool" | "datetime" | "date"
>;

/** The `errors[].message` of a query/path value whose text does not parse as
 *  its declared type — one sentence per check kind, on every backend, so a
 *  wire golden pins it.  The `code` is `fieldCode("type-mismatch")`; a client
 *  localizes by that code, never by this English. */
export const QUERY_PARAM_MISMATCH_MESSAGES: Readonly<Record<QueryParamMismatchKind, string>> = {
  integer: "Expected an integer.",
  decimal: "Expected a number.",
  bool: "Expected true or false.",
  datetime: "Expected an ISO 8601 date-time.",
  date: "Expected an ISO 8601 date.",
};

/** One declared parameter of a query-time projection read. */
export interface ProjectionQueryParam {
  /** The wire (query-string) key — the declared name. */
  name: string;
  type: TypeIR;
  /** False only for a parameter declared `T?`. */
  required: boolean;
  check: QueryParamCheck;
}

/** The check a query/path param's text must pass: the type the app's OpenAPI
 *  document publishes for it. */
export function queryParamCheck(t: TypeIR, ctx: BoundedContextIR): QueryParamCheck {
  const info = wireTypeInfo(t, "request");
  if (info.isCollection) return { kind: "present" };
  switch (info.refKind) {
    case "primitive":
      switch (info.primitive) {
        case "int":
        case "long": {
          const { min, max } = integerWire(info.primitive);
          return { kind: "integer", min, max };
        }
        case "decimal":
        case "money":
          return { kind: "decimal" };
        case "bool":
          return { kind: "bool" };
        case "datetime":
          return { kind: "datetime" };
        case "date":
          return { kind: "date" };
        case "guid":
          return { kind: "uuid" };
        case "string":
          return { kind: "string" };
        default:
          return { kind: "present" };
      }
    case "id":
      // Every aggregate id is a guid on the wire.
      return { kind: "uuid" };
    case "enum": {
      const values = enumPool(ctx).find((e) => e.name === info.base)?.values;
      return values ? { kind: "enum", values } : { kind: "string" };
    }
    default:
      return { kind: "present" };
  }
}

/** The parameters a query-time projection's read route binds, in declared
 *  order — the one list every backend's route signature, query schema and
 *  `where` binding is built from. */
export function projectionQueryParams(
  p: ProjectionIR,
  ctx: BoundedContextIR,
): readonly ProjectionQueryParam[] {
  return p.params.map((param) => ({
    name: param.name,
    type: param.type,
    required: !wireTypeInfo(param.type, "request").isNullable,
    check: queryParamCheck(param.type, ctx),
  }));
}
