// Wire-format op-param guards (M-T6.48) — the `with`-clause each guarded
// `money`/`decimal`/`int`/`long` operation param binds through.  A leaf so the
// relational op path (`context-emit.ts`) and the document op path
// (`document-emit.ts`, which `context-emit.ts` imports) share one spelling
// without an import cycle.  The `defp`s these clauses call are appended to the
// context module on demand by `context-emit.ts` (`renderNumericParamHelpers`).
import type { TypeIR } from "../../../ir/types/loom-ir.js";
import { snake } from "../../../util/naming.js";

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
export function paramGuardClause(wireName: string, type: TypeIR | undefined): string | null {
  const t = type?.kind === "optional" ? type.inner : type;
  if (t?.kind !== "primitive") return null;
  const access = `Map.get(params, ${JSON.stringify(wireName)})`;
  const field = `:${snake(wireName)}`;
  switch (t.name) {
    case "money":
    case "decimal":
      return `{:ok, ${snake(wireName)}} <- __loom_decimal_param(record, ${field}, ${access})`;
    // An `int` is an int4 COLUMN, so the guard carries its declared range as
    // well as its type: without it a contract-conforming-looking value like
    // 9543751572142 cast cleanly, reached the column and the DATABASE refused
    // it — a 500 for a client fault, the same shape as the money-range guard
    // beside it (Schemathesis F11).  `long` keeps the type-only guard: its
    // ceiling is the cross-backend `D-LONG-AVG-DEFAULTS` one, not int64, and
    // moving it is a five-backend ruling rather than this row.
    case "int":
      return `{:ok, ${snake(wireName)}} <- __loom_int32_param(record, ${field}, ${access})`;
    case "long":
      return `{:ok, ${snake(wireName)}} <- __loom_int_param(record, ${field}, ${access})`;
    default:
      return null;
  }
}
