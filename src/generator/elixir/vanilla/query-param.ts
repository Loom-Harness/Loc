// ---------------------------------------------------------------------------
// Typed query/path params on a Phoenix controller.
//
// Phoenix delivers every query-string and path value as a BINARY, and there is
// no framework layer that checks it against the type the app's own OpenAPI
// document publishes (hono declares a zod schema, FastAPI reads the
// annotation, Spring and ASP.NET bind typed action params).  So a controller
// action that reads declared params does both steps itself, before anything
// else runs:
//
//   1. `__check_find_params(params, specs)` — every param is present when
//      required and parses as its published type; otherwise the action answers
//      the `field-invalid` 422 (§3.2 `errors[]`, one pointer per param), the
//      same refusal the other backends' request validation gives.
//   2. each read goes through a `__find_<kind>/1` coercion, so the value that
//      reaches the query or the in-memory filter is the declared type.
// ---------------------------------------------------------------------------

import type { BoundedContextIR, TypeIR } from "../../../ir/types/loom-ir.js";
import { wireTypeInfo } from "../../../ir/types/wire-types.js";
import { enumPool } from "../../../ir/util/reachable-types.js";
import { integralWireRange } from "../../../util/numeric-range.js";
import { exFieldMessage, exLit, exMissingSuffix } from "../wire-policy-ex.js";

/** One query/path param an action reads: its wire name and declared type. */
export interface QueryParam {
  name: string;
  type: TypeIR;
}

/** A {@link QueryParam} with the context its type resolves in (an `enum`
 *  param's published values come from that context's pool). */
export interface ScopedQueryParam {
  param: QueryParam;
  ctx: BoundedContextIR;
}

/** The scalar KIND a find param must be coerced to, or `undefined` when the
 *  query-string form is already right (string / guid / enum / id). */
export function findParamCoercion(
  t: TypeIR | undefined,
): "int" | "decimal" | "bool" | "datetime" | "date" | undefined {
  const inner = t?.kind === "optional" ? t.inner : t;
  if (inner?.kind !== "primitive") return undefined;
  switch (inner.name) {
    case "int":
    case "long":
      return "int";
    case "decimal":
    case "money":
      return "decimal";
    case "bool":
      return "bool";
    case "datetime":
      return "datetime";
    case "date":
      return "date";
    default:
      return undefined;
  }
}

/**
 * Read one declared param off `params`, COERCED to its declared type.
 *
 * On a relational read the value lands in an Ecto query (`^min`), where Ecto
 * would cast a string anyway.  An IN-MEMORY filter (a `shape: document` or
 * embedded aggregate) has no Ecto to cast:
 *
 *     Enum.filter(fn row -> row.data.view_count >= min end)
 *
 * …and under Erlang's term ordering a number is ALWAYS less than a binary, so
 * `6 >= "6"` is silently `false` and the read answers `[]`.  Coercing at the
 * controller makes both paths see the declared type.  A string / guid / enum /
 * id param is read unchanged.
 */
export function findParamRead(p: { name: string; type?: TypeIR }): string {
  const raw = `params[${JSON.stringify(p.name)}]`;
  switch (findParamCoercion(p.type)) {
    case "int":
      return `__find_int(${raw})`;
    case "decimal":
      return `__find_decimal(${raw})`;
    case "bool":
      return `__find_bool(${raw})`;
    case "datetime":
      return `__find_datetime(${raw})`;
    case "date":
      return `__find_date(${raw})`;
    default:
      return raw;
  }
}

/** What one declared query/path param is checked against before the action
 *  runs: the type this app's own OpenAPI document publishes for it
 *  (`openapi-emit.ts` derives the parameter schema from the same
 *  `wireTypeInfo(…, "request")`).  `present` is the fallback for a shape a
 *  query string cannot carry as one scalar — only absence is refused. */
type FindParamCheck =
  | { kind: "present" }
  | { kind: "string" }
  | { kind: "uuid" }
  | { kind: "integer"; min: number; max: number }
  | { kind: "decimal" }
  | { kind: "bool" }
  | { kind: "datetime" }
  | { kind: "date" }
  | { kind: "enum"; values: readonly string[] };

function findParamCheck(t: TypeIR, ctx: BoundedContextIR): FindParamCheck {
  const info = wireTypeInfo(t, "request");
  if (info.isCollection) return { kind: "present" };
  switch (info.refKind) {
    case "primitive":
      switch (info.primitive) {
        case "int":
        case "long":
          return { kind: "integer", ...integralWireRange(info.primitive) };
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
      switch (info.idValueType) {
        case "guid":
          return { kind: "uuid" };
        case "int":
        case "long":
          return { kind: "integer", ...integralWireRange(info.idValueType) };
        default:
          return { kind: "string" };
      }
    case "enum": {
      const values = enumPool(ctx).find((e) => e.name === info.base)?.values;
      return values ? { kind: "enum", values } : { kind: "string" };
    }
    default:
      return { kind: "present" };
  }
}

/** The Elixir term naming a check in the `__check_find_params/2` spec list. */
function checkTerm(c: FindParamCheck): string {
  switch (c.kind) {
    case "integer":
      return `{:integer, ${c.min}, ${c.max}}`;
    case "enum":
      return `{:enum, [${c.values.map((v) => JSON.stringify(v)).join(", ")}]}`;
    default:
      return `:${c.kind}`;
  }
}

/** The `__check_find_params/2` spec list for a set of query/path params:
 *  `{name, check, required}` per param.  Required mirrors the published
 *  parameter: a nullable param is optional, everything else required. */
export function queryParamSpecs(params: readonly QueryParam[], ctx: BoundedContextIR): string {
  const specs = params.map(
    (p) =>
      `{${JSON.stringify(p.name)}, ${checkTerm(findParamCheck(p.type, ctx))}, ${
        wireTypeInfo(p.type, "request").isNullable ? "false" : "true"
      }}`,
  );
  return `[${specs.join(", ")}]`;
}

/** The `__check_find_params/2` helper, with one `__find_param_error/3` clause
 *  per check kind this controller's finds use — an unreachable clause is dead
 *  code the compiler is entitled to warn on. */
function renderFindParamCheck(kinds: ReadonlySet<FindParamCheck["kind"]>): string {
  const clauses: string[] = [
    `  defp __find_param_error(nil, _check, required), do: if(required, do: :missing, else: nil)`,
  ];
  if (kinds.has("present")) {
    clauses.push(`  defp __find_param_error(_value, :present, _required), do: nil`);
  }
  if ([...kinds].some((k) => k !== "present")) {
    // `?x[]=1` / `?x[a]=1` arrive as a list / map, not the scalar published.
    clauses.push(
      `  defp __find_param_error(value, _check, _required) when not is_binary(value),\n    do: "Expected a single value."`,
    );
  }
  if (kinds.has("string")) {
    clauses.push(`  defp __find_param_error(_value, :string, _required), do: nil`);
  }
  if (kinds.has("uuid")) {
    clauses.push(`  defp __find_param_error(value, :uuid, _required) do
    if byte_size(value) == 36 and match?({:ok, _}, Ecto.UUID.cast(value)),
      do: nil,
      else: ${exFieldMessage("malformed-id")}
  end`);
  }
  if (kinds.has("integer")) {
    clauses.push(`  defp __find_param_error(value, {:integer, min, max}, _required) do
    case Integer.parse(value) do
      {n, ""} when n >= min and n <= max -> nil
      _ -> "Expected an integer between #{min} and #{max}."
    end
  end`);
  }
  if (kinds.has("decimal")) {
    clauses.push(`  defp __find_param_error(value, :decimal, _required) do
    case Decimal.parse(value) do
      {d, ""} -> if Decimal.inf?(d) or Decimal.nan?(d), do: "Expected a number.", else: nil
      _ -> "Expected a number."
    end
  end`);
  }
  if (kinds.has("bool")) {
    clauses.push(
      `  defp __find_param_error(value, :bool, _required),\n    do: if(value in ["true", "false"], do: nil, else: "Expected true or false.")`,
    );
  }
  if (kinds.has("datetime")) {
    clauses.push(`  defp __find_param_error(value, :datetime, _required) do
    case DateTime.from_iso8601(value) do
      {:ok, _, _} -> nil
      _ -> "Expected an ISO 8601 date-time with an offset."
    end
  end`);
  }
  if (kinds.has("date")) {
    clauses.push(`  defp __find_param_error(value, :date, _required) do
    case Date.from_iso8601(value) do
      {:ok, _} -> nil
      _ -> "Expected an ISO 8601 date."
    end
  end`);
  }
  if (kinds.has("enum")) {
    clauses.push(`  defp __find_param_error(value, {:enum, values}, _required) do
    if value in values, do: nil, else: "Expected one of: " <> Enum.join(values, ", ") <> "."
  end`);
  }
  return `

  # Each declared query/path param, checked against the type this app's OpenAPI
  # document publishes for it before the action runs.  A failure answers the
  # declared 422 with the §3.2 \`errors[]\` envelope at the param's pointer —
  # the rung the per-operation error matrix publishes for a query parameter
  # that does not parse against its declared type.
  defp __check_find_params(params, specs) do
    errors =
      Enum.flat_map(specs, fn {name, check, required} ->
        case __find_param_error(Map.get(params, name), check, required) do
          nil -> []
          :missing -> [%{pointer: "/" <> name, message: name <> ${exLit(` ${exMissingSuffix()}`)}, code: nil}]
          message -> [%{pointer: "/" <> name, message: message, code: nil}]
        end
      end)

    if errors == [], do: :ok, else: {:error, errors}
  end

${clauses.join("\n\n")}`;
}

/** The private helpers a controller's query/path param reads go through: the
 *  `__check_find_params/2` checker (with one `__find_param_error/3` clause per
 *  check kind used) and one `__find_<kind>/1` coercion per coerced kind.  Each
 *  is emitted only when some param on this controller needs it, so a
 *  param-less or string-only controller gets none and no unused private fn
 *  trips `--warnings-as-errors`. */
export function renderQueryParamHelpers(params: readonly ScopedQueryParam[]): string {
  const neededCoercions = new Set(
    params
      .map(({ param }) => findParamCoercion(param.type))
      .filter((k): k is "int" | "decimal" | "bool" | "datetime" | "date" => k !== undefined),
  );
  const checks = params.map(({ param, ctx }) => findParamCheck(param.type, ctx));
  const checkKinds = new Set(checks.map((c) => c.kind));
  return [
    checks.length > 0 ? renderFindParamCheck(checkKinds) : "",
    neededCoercions.has("int")
      ? `
  # A declared \`int\` param — Phoenix delivers it as a string, and
  # an in-memory filter (document/embedded shape) compares it directly, where
  # Erlang's term order makes \`6 >= "6"\` false.
  defp __find_int(v) when is_integer(v), do: v

  defp __find_int(v) when is_binary(v) do
    case Integer.parse(v) do
      {n, ""} -> n
      _ -> v
    end
  end

  defp __find_int(v), do: v`
      : "",
    neededCoercions.has("decimal")
      ? `
  # A declared \`decimal\`/\`money\` param.
  defp __find_decimal(v) when is_binary(v) do
    case Decimal.parse(v) do
      {d, ""} -> d
      _ -> v
    end
  end

  defp __find_decimal(v), do: v`
      : "",
    neededCoercions.has("bool")
      ? `
  # A declared \`bool\` param.
  defp __find_bool("true"), do: true
  defp __find_bool("false"), do: false
  defp __find_bool(v), do: v`
      : "",
    neededCoercions.has("datetime")
      ? `
  # A declared \`datetime\`/\`date\` param.  Unlike the int and
  # decimal cases, leaving this one a STRING is not a silent wrong answer but a
  # hard 500: the value is pinned straight into the Ecto query, and Postgrex
  # refuses to encode a binary where the parameter is a timestamp
  # (\`DBConnection.EncodeError: expected %DateTime{} or %NaiveDateTime{}\`).
  # A value that does not parse is passed through unchanged so the existing
  # 422 path still reports it, rather than being swallowed here.
  defp __find_datetime(%DateTime{} = v), do: v
  defp __find_datetime(%NaiveDateTime{} = v), do: v

  defp __find_datetime(v) when is_binary(v) do
    case DateTime.from_iso8601(v) do
      {:ok, dt, _offset} -> dt
      _ -> v
    end
  end

  defp __find_datetime(v), do: v`
      : "",
    neededCoercions.has("date")
      ? `
  # A declared \`date\` param — Postgrex encodes a \`date\`
  # parameter only from a \`%Date{}\`, so the ISO text is parsed here.
  defp __find_date(%Date{} = v), do: v

  defp __find_date(v) when is_binary(v) do
    case Date.from_iso8601(v) do
      {:ok, d} -> d
      _ -> v
    end
  end

  defp __find_date(v), do: v`
      : "",
  ].join("");
}
