// Wire-format op-param guards (M-T6.48) — the `with`-clause each guarded
// `money`/`decimal`/`int`/`long` operation param binds through.  A leaf so the
// relational op path (`context-emit.ts`) and the document op path
// (`document-emit.ts`, which `context-emit.ts` imports) share one spelling
// without an import cycle.  The `defp`s these clauses call are appended to the
// context module on demand by `context-emit.ts` (`renderNumericParamHelpers`).
import type { BoundedContextIR, TypeIR } from "../../../ir/types/loom-ir.js";
import { enumPool } from "../../../ir/util/reachable-types.js";
import { elixirLocal, snake } from "../../../util/naming.js";
import { voEctoType } from "./changeset-validators.js";

/** Op params whose WIRE form can be malformed, and which therefore have to be
 *  REFUSED rather than coerced-and-hoped.  `coerceOpParam` (`context-emit.ts`) makes the
 *  well-formed cases total; this makes the ill-formed ones a 422 instead of a
 *  500 (M-T6.48, the elixir arm).
 *
 *  Why a `with` clause and not a bind: the coercion can FAIL, and a failure has
 *  to reach the response.  Returning `{:error, changeset}` puts it on the path
 *  `ProblemDetails.validation_error_response/2` already renders — 422 with
 *  `errors: [{"pointer": "/<param>", "message": …}]` — so this reuses the
 *  envelope the backend already sends instead of inventing a second one, the
 *  same move the .NET and python arms made.
 *
 *  `null` for a param that needs no guard, so an op with none keeps the flat
 *  bind layout byte-identical. */
export function paramGuardClause(
  wireName: string,
  type: TypeIR | undefined,
  /** The op's context — a VALUE-OBJECT param is guarded only when its
   *  declaration can be looked up here. */
  ctx?: BoundedContextIR,
): string | null {
  const t = type?.kind === "optional" ? type.inner : type;
  const access = `Map.get(params, ${JSON.stringify(wireName)})`;
  const field = `:${snake(wireName)}`;
  // A value-object param arrives as the raw wire map, and the op body reads its
  // members directly, so a missing or mistyped member crashed there (a 500).
  // It is cast against the value object's declared fields instead: the 422 at
  // `/<param>/<member>`, and the body receives the declared members only.
  if (t?.kind === "valueobject" && ctx) {
    const vo = ctx.valueObjects.find((v) => v.name === t.name);
    if (!vo) return null;
    const enums = new Map(enumPool(ctx).map((e) => [e.name, e]));
    const types = vo.fields.map((f) => `${snake(f.name)}: ${voEctoType(f.type, enums)}`).join(", ");
    const required = vo.fields
      .filter((f) => f.type.kind !== "optional")
      .map((f) => `:${snake(f.name)}`)
      .join(", ");
    return `{:ok, ${elixirLocal(wireName)}} <- __loom_vo_param(record, ${field}, ${access}, %{${types}}, [${required}])`;
  }
  if (t?.kind !== "primitive") return null;
  switch (t.name) {
    case "money":
    case "decimal":
      return `{:ok, ${elixirLocal(wireName)}} <- __loom_decimal_param(record, ${field}, ${access})`;
    // An `int` is an int4 COLUMN, so the guard carries its declared range as
    // well as its type: without it a contract-conforming-looking value like
    // 9543751572142 cast cleanly, reached the column and the DATABASE refused
    // it — a 500 for a client fault, the same shape as the money-range guard
    // beside it (Schemathesis F11).  `long` keeps the type-only guard: its
    // ceiling is the cross-backend `D-LONG-AVG-DEFAULTS` one, not int64, and
    // moving it is a five-backend ruling rather than this row.
    case "int":
      return `{:ok, ${elixirLocal(wireName)}} <- __loom_int32_param(record, ${field}, ${access})`;
    case "long":
      return `{:ok, ${elixirLocal(wireName)}} <- __loom_int_param(record, ${field}, ${access})`;
    // A `date` is ISO `YYYY-MM-DD` text on the wire; the op persists through
    // `force_change` (no cast), so a non-date would reach the `:date` column
    // as a binary and raise — refused here as the 422 instead.
    case "date":
      return `{:ok, ${elixirLocal(wireName)}} <- __loom_date_param(record, ${field}, ${access})`;
    default:
      return null;
  }
}
