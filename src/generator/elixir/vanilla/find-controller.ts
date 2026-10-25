// ---------------------------------------------------------------------------
// Vanilla custom-find HTTP surface — `GET /<plural>/<find>` per repository
// `find`.  The context already exposes a
// `<find>_<agg>` delegate (for workflow `repo-let`); this adds the route +
// controller action that calls it and serialises the result.
//
// Union-returning finds (`Agg or NotFound`) are single-gets whose `nil` is the
// absent variant: a `none` absent → 404, an `error` payload → an RFC-7807
// ProblemDetails at its mapped status (via the shared `problem_variant/5`
// responder), and a found record → the tagged `%{type: "<Agg>", …}` wire — the
// same edge translation the exception-less operation routes emit.
// ---------------------------------------------------------------------------

import { envelopeReturn, pagedReturn } from "../../../ir/stdlib/generics.js";
import { variantTag } from "../../../ir/stdlib/unions.js";
import type { AggregateIR, BoundedContextIR, FindIR, TypeIR } from "../../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../../ir/types/loom-ir.js";
import { wireTypeInfo } from "../../../ir/types/wire-types.js";
import type { ApiOperationIR } from "../../../ir/util/api-surface.js";
import { enumPool } from "../../../ir/util/reachable-types.js";
import { defaultErrorStatus, errorTitle, errorTypeUri } from "../../../util/error-defaults.js";
import { plural, snake, upperFirst } from "../../../util/naming.js";
import { integralWireRange } from "../../../util/numeric-range.js";
import type { ApiRoute } from "../api-emit.js";
import { renderExpr } from "../render-expr.js";
import { plugRelativePath } from "./api-emit.js";
import { aggregateUsesPrincipalContextFilter, findUsesPrincipal } from "./capability-filter.js";
import { denialOverrides, denialResponse } from "./denial.js";
import { effectiveGate } from "./gate.js";
import { isAbstractBase } from "./inheritance-emit.js";
import {
  PAGE_CALL_ARGS,
  PAGE_PARAM_HELPER,
  PAGE_WITH_CLAUSES,
  pagingElseArm,
} from "./page-param.js";

/** Non-`all` custom finds an aggregate's repository declares — the ones that
 *  earn an HTTP `GET /<plural>/<find>` endpoint (`all` is the
 *  enrichment-synthesized list, served by `GET /<plural>` already).  The
 *  `all` filter is inlined rather than importing `repository-emit.customFindsOf`
 *  to avoid an import cycle. */
export function httpFindsOf(ctx: BoundedContextIR, agg: AggregateIR): FindIR[] {
  const repo = (ctx.repositories ?? []).find((r) => r.aggregateName === agg.name);
  // A synthesized find (paged-run queryHandler support) is never auto-exposed by
  // the aggregate controller — the queryHandler's own route is the exposure — so
  // it drives no HTTP find action / route / OpenAPI path.  Its context defdelegate
  // + repository method (via `customFindsOf`) still emit, so the paged queryHandler
  // route can call it.
  return (repo?.finds ?? []).filter((f) => f.name !== "all" && !f.synthesized);
}

/** True when the find returns zero-or-one record (`Customer?` / `Customer`) or
 *  a union (`Customer or NotFound`) rather than a list. */
function isSingleReturn(t: TypeIR): boolean {
  if (t.kind === "optional" && t.inner.kind === "entity") return true;
  if (t.kind === "entity") return true;
  if (t.kind === "union") return true;
  // `T envelope` — a single-row find (M-T6.57).  The controller serialises ONE
  // record and answers 404 when absent, which is what the OpenAPI it emits for
  // this same action has always declared.
  if (envelopeReturn(t)) return true;
  return false;
}

/** The absent variant of a union find, with its HTTP translation.  `none`
 *  rides the 404 path; an `error` payload becomes a ProblemDetails at its
 *  mapped status carrying `resource: "<Agg>"` when the payload declares one. */
function absentSpec(
  agg: AggregateIR,
  t: TypeIR,
  ctx: BoundedContextIR,
):
  | { kind: "none" }
  | { kind: "error"; status: number; type: string; title: string; hasResource: boolean }
  | null {
  if (t.kind !== "union") return null;
  const other = t.variants.find((v) => !(v.kind === "entity" && v.name === agg.name));
  if (!other) return null;
  if (other.kind === "none") return { kind: "none" };
  const tag = variantTag(other);
  const payload = ctx.payloads.find((p) => p.name === tag);
  return {
    kind: "error",
    status: ctx.errorStatusOverrides?.[tag] ?? defaultErrorStatus(tag),
    type: errorTypeUri(tag),
    title: errorTitle(tag),
    hasResource: (payload?.fields ?? []).some((f) => f.name === "resource"),
  };
}

/** `GET /<plural>/<find>` routes — must be registered *before* the
 *  `/<plural>/:id` show route so the literal segment wins in Phoenix's
 *  in-order match (`/orders/recent` would otherwise bind `:id = "recent"`). */
export function findRoutes(
  agg: AggregateIR,
  ctx: BoundedContextIR,
  /** The aggregate's derived operations (api-surface.ts) — declared-find
   *  routes mount at the derived path.  Empty for an abstract base, whose
   *  read-only finds (if any) fall back to the legacy spelling. */
  derivedOps: readonly ApiOperationIR[] = [],
): ApiRoute[] {
  const aggsPath = snake(plural(agg.name));
  const controller = `${upperFirst(agg.name)}Controller`;
  const derivedByFind = new Map(
    derivedOps.filter((o) => o.kind === "find" && o.find).map((o) => [o.find, o]),
  );
  // A find whose slot an explicit `route` claims is served by that route alone
  // (D-EXPLICIT-ROUTE-WINS) — its controller action stays, its router line goes.
  return httpFindsOf(ctx, agg).flatMap((f) => {
    const entry = derivedByFind.get(f);
    if (entry?.claimedByExplicitRoute) return [];
    return {
      method: "get" as const,
      path: entry ? `/${aggsPath}${plugRelativePath(entry)}` : `/${aggsPath}/${snake(f.name)}`,
      controller,
      action: `:${snake(f.name)}`,
    };
  });
}

/** The scalar KIND a find param must be coerced to, or `undefined` when the
 *  query-string form is already right (string / guid / enum / id). */
function findParamCoercion(
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
 * Read one declared find param off the query string, COERCED to its declared
 * type.
 *
 * Phoenix delivers every query param as a STRING — the emitter already knows
 * this, which is why `page`/`pageSize` go through `page_param/3`.  The find's
 * OWN params never got the same treatment, and on the relational path that was
 * invisible: the value lands in an Ecto query (`^min`), and Ecto casts it
 * against the schema's field type.
 *
 * The IN-MEMORY filter path has no Ecto to cast.  A `shape: document`
 * aggregate's find loads the rows and filters in Elixir:
 *
 *     Enum.filter(fn row -> row.data.view_count >= min end)
 *
 * …so `6 >= "6"` is evaluated under Erlang's term ordering, where a number is
 * ALWAYS less than a binary — the comparison is silently `false` and the find
 * returns `[]` for every row.  No error, no log: a find that quietly answers
 * nothing.
 *
 * Coercing at the controller fixes the in-memory path and leaves the relational
 * one equivalent (Ecto accepted the string; it accepts the integer too).  A
 * string / guid / enum / id param is returned unchanged, so only finds with a
 * numeric or boolean param change bytes at all.
 *
 * Found 2026-08-05 by the caller-census drain: `corpus/document`'s
 * `popular(min: int)` — an in-memory find over a jsonb document — was driven
 * for the first time and answered `[]` where every other backend answered 1.
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

/** What one declared find query param is checked against before the find
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

/** The `__check_find_params/2` spec list for one find: `{name, check, required}`
 *  per declared param.  Required mirrors the published parameter: a nullable
 *  param is optional, everything else required. */
function findParamSpecs(f: FindIR, ctx: BoundedContextIR): string {
  const specs = f.params.map(
    (p) =>
      `{${JSON.stringify(p.name)}, ${checkTerm(findParamCheck(p.type, ctx))}, ${
        wireTypeInfo(p.type, "request").isNullable ? "false" : "true"
      }}`,
  );
  return `[${specs.join(", ")}]`;
}

/** Does any HTTP find in these contexts declare a param?  Gates the
 *  `ProblemDetails.validation_errors_response/2` responder the param check
 *  sends through — an unused `def` fails `mix compile --warnings-as-errors`. */
export function contextsHaveCheckedFindParams(contexts: readonly BoundedContextIR[]): boolean {
  return contexts.some((ctx) =>
    ctx.aggregates.some((agg) => httpFindsOf(ctx, agg).some((f) => f.params.length > 0)),
  );
}

/** Controller actions for the aggregate's HTTP finds. */
export function renderFindActions(
  appModule: string,
  ctxModule: string,
  agg: AggregateIR,
  ctx: BoundedContextIR,
): string {
  const aggSnake = snake(agg.name);
  const aggPascal = upperFirst(agg.name);
  // A principal (tenancy) find threads the request actor; pull it off
  // `conn.assigns` and pass it as the trailing find arg.  Non-principal finds
  // stay byte-identical.
  const principal = aggregateUsesPrincipalContextFilter(agg);
  // Read-side `requires` authorization gate (default-deny): a 403 returned
  // before the query when the currentUser-only predicate fails — the read-side
  // analogue of an operation's `requires`.
  const contextModule = `${appModule}.${upperFirst(ctx.name)}`;
  const webModule = `${appModule}Web`;
  const actions = httpFindsOf(ctx, agg).map((f) => {
    const findSnake = snake(f.name);
    const paged = pagedReturn(f.returnType);
    // `requires true` is the always-public escape; on elixir it emits NO guard
    // (a dead `if not (true)` is a 1.18 typing violation) — see gate.ts.
    const requiresGate = effectiveGate(f.requires);
    // Read the EFFECTIVE gate, not the raw `f.requires`: `requires true` emits
    // no guard, so it binds no actor either.
    const gateUsesUser = !!requiresGate && exprUsesCurrentUser(requiresGate);
    // A find whose own `where` reads `currentUser` takes the actor as a repo
    // argument too (see `findUsesPrincipal`), so it binds + passes one exactly
    // like a principal-scoped find.  Orthogonal to the gate above — a find can
    // need the actor for its `where` while carrying no `requires` at all.
    const findActor = principal || findUsesPrincipal(f);
    // Bind `current_user` when the find is principal-scoped (repo arg) or its
    // gate reads the actor; `requires true` on a non-principal find binds none.
    const cuLine =
      findActor || gateUsesUser ? "    current_user = Map.get(conn.assigns, :current_user)\n" : "";
    // A find that reads NO params (param-less and non-paged) binds `_params` so
    // it doesn't trip the unused-variable check; a paged find always reads
    // `page`/`pageSize` off `params`.
    const paramArg = f.params.length > 0 || paged ? "params" : "_params";
    const argReads = [
      ...f.params.map((p) => findParamRead(p)),
      // Paged: 1-based `page`/`pageSize` query controls, defaulted + coerced to
      // integers (Phoenix delivers query params as strings).  Matches the
      // shared cross-backend defaults.
      ...(paged
        ? [
            // Bound by the `with` clauses `PAGE_WITH_CLAUSES` prepends, so an
            // out-of-range window 422s before the repository is reached
            // (page-param.ts) rather than being silently clamped.
            ...PAGE_CALL_ARGS,
            // Sort controls (M-T2.6) — strings passed through; the repo whitelists.
            `Map.get(params, "sort", "id")`,
            `Map.get(params, "dir", "asc")`,
          ]
        : []),
      ...(findActor ? ["current_user"] : []),
    ].join(", ");
    const call = `${ctxModule}.${findSnake}_${aggSnake}(${argReads})`;

    // Assemble the action from its inner body — wrapping it in an `if not (gate)
    // do <403> else … end` guard when the find declares a `requires` clause.
    // Ungated finds stay byte-identical (no gate, original shape).
    //
    // A find that declares params checks them FIRST — outermost, before the
    // gate and the query — against the type the published parameter carries,
    // and answers the declared 422 at the param's pointer.  Unchecked, a
    // missing required param reached the query as `nil` (Ecto refuses a `nil`
    // comparison → 500) and a malformed uuid raised `Ecto.Query.CastError`
    // (→ an undeclared 400).  Param-less finds stay byte-identical.
    const checkParams = (body: string): string =>
      f.params.length === 0
        ? body
        : `    case __check_find_params(params, ${findParamSpecs(f, ctx)}) do
      {:error, find_param_errors} ->
        ${webModule}.ProblemDetails.validation_errors_response(conn, find_param_errors)

      :ok ->
${body
  .split("\n")
  .map((l) => (l.length > 0 ? `    ${l}` : l))
  .join("\n")}
    end`;
    const wrap = (innerBody: string): string => {
      if (!requiresGate) {
        return `
  def ${findSnake}(conn, ${paramArg}) do
${cuLine}${checkParams(innerBody)}
  end`;
      }
      const gate = renderExpr(requiresGate, {
        thisName: "record",
        contextModule,
      });
      return `
  def ${findSnake}(conn, ${paramArg}) do
${cuLine}${checkParams(`    if not (${gate}) do
      ${denialResponse(
        "forbidden",
        JSON.stringify(`Forbidden: find ${f.name}`),
        denialOverrides(ctx),
        `${webModule}.ProblemDetails`,
      )}
    else
${innerBody}
    end`)}
  end`;
    };

    if (paged) {
      // The repository already returns the `%{items, page, pageSize, total,
      // totalPages}` envelope (atom keys) — only `items` needs per-record
      // serialisation; the scalar counters pass straight through to the
      // canonical camelCase JSON.
      const clauses = [...PAGE_WITH_CLAUSES, `{:ok, result} <- ${call}`].join(",\n         ");
      return wrap(`    with ${clauses} do
      json(conn, %{result | items: Enum.map(result.items, &serialize/1)})
${pagingElseArm(`${webModule}.ProblemDetails`, "    ")}
    end`);
    }

    const absent = absentSpec(agg, f.returnType, ctx);
    if (absent) {
      // Union find — translate the `nil` absent case; the found record is the
      // SUCCESS variant returned directly (untagged) at 200, matching the
      // emitted spec (`<Agg>Response`) and every other backend
      // (exception-less.md §4).  The error/absent variant is a status response,
      // never a tagged 200 body.
      const absentArm =
        absent.kind === "none"
          ? // RS-22/RS-27 — the `T option` miss goes through the SHARED
            // producer, with the canonical `"not_found"` token as `detail`.
            // NOT `problem_variant(…, "Not Found", %{})`, whose helper sets
            // `detail: title` — that answers `"Not Found"` where
            // node/python/java/dotnet answer `"not_found"`, and puts two
            // spellings of one 404 inside ONE controller (the `T?` arm below
            // says `"<Agg> not found"`), which is this rule's own lesson:
            // don't hand-roll a 404, reach the producer.
            `        ${denialResponse("notFound", '"not_found"', denialOverrides(ctx))}`
          : `        problem_variant(conn, ${absent.status}, ${JSON.stringify(absent.type)}, ${JSON.stringify(absent.title)}, ${absent.hasResource ? `%{resource: ${JSON.stringify(aggPascal)}}` : "%{}"})`;
      return wrap(`    case ${call} do
      {:ok, nil} ->
${absentArm}

      {:ok, record} ->
        json(conn, serialize(record))
    end`);
    }

    if (isSingleReturn(f.returnType)) {
      // An OPTIONAL find (`: X?` / `: X option`) whose row is absent returns
      // 404 — its declared OpenAPI status (`findOptional → [404]`) and every
      // other backend.  The previous `json(conn, nil)` emitted an HTTP 200 with
      // a `null` body that isn't even a valid `<Agg>Response` (the 200 schema),
      // the lone cross-backend divergence for optional-find absence.  A bare
      // `: X` single find (findOptional == false) keeps its shape — `findSingle`
      // declares no error status, and its default is the (softened) A4 question.
      //
      // The `detail` is the canonical `"not_found"` TOKEN (RS-27 scopes the
      // find miss out of the by-id sentence).  Interpolating the aggregate —
      // `"<Agg> not found"` — reads like the by-id sentence but carries no id,
      // and matches no other backend.
      //
      // A NON-optional single find takes the SAME arm, and the sentence above
      // is why: it has even less of an absent representation than the optional
      // one.  The bare `: X` case used to keep `json(conn, nil)` — a 200 whose
      // `null` body is not a valid `<Agg>Response`, i.e. the same violation of
      // its own declared 200 this comment describes fixing for `X?` — and the
      // reason recorded here was that `findSingle` declared no error status.
      // It does now: the rung is a fact about the READ, not about the route's
      // shape (F13), so the justification is gone and so is the divergence.
      return wrap(`    case ${call} do
      {:ok, nil} ->
        ${denialResponse("notFound", '"not_found"', denialOverrides(ctx))}

      {:ok, record} ->
        json(conn, serialize(record))
    end`);
    }
    return wrap(`    with {:ok, records} <- ${call} do
      json(conn, Enum.map(records, &serialize/1))
    end`);
  });
  // The `page_param/4` reader — once per controller — backs every paged find's
  // `page`/`pageSize` query reads.  ONE definition, shared with the
  // queryHandler controller (`page-param.ts`), rather than a copy in each that
  // clamps where the OpenAPI document publishes bounds.  The auto-`findAll`
  // `index` is paged by default, so the helper is required on every
  // non-abstract controller even without an explicit paged find.
  const indexAllFind = (ctx.repositories ?? [])
    .find((r) => r.aggregateName === agg.name)
    ?.finds?.find((f) => f.name === "all");
  const indexPaged =
    !isAbstractBase(agg) && !!(indexAllFind && pagedReturn(indexAllFind.returnType));
  const hasPaged = indexPaged || httpFindsOf(ctx, agg).some((f) => pagedReturn(f.returnType));
  const pageParamHelper = hasPaged ? PAGE_PARAM_HELPER : "";

  // Typed query-param coercion for the finds' OWN params — same reason
  // `page_param/3` exists (Phoenix delivers query params as strings), applied to
  // the params the find declares.  Each helper is emitted only when some find on
  // this controller actually needs it, so a string-only controller is
  // byte-identical and no unused private fn trips `--warnings-as-errors`.
  const neededCoercions = new Set(
    httpFindsOf(ctx, agg)
      .flatMap((f) => f.params)
      .map((p) => findParamCoercion(p.type))
      .filter((k): k is "int" | "decimal" | "bool" | "datetime" | "date" => k !== undefined),
  );
  const checks = httpFindsOf(ctx, agg).flatMap((f) =>
    f.params.map((p) => findParamCheck(p.type, ctx)),
  );
  const checkKinds = new Set(checks.map((c) => c.kind));
  const findParamHelpers = [
    checks.length > 0 ? renderFindParamCheck(checkKinds) : "",
    neededCoercions.has("int")
      ? `
  # A declared find's \`int\` query param — Phoenix delivers it as a string, and
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
  # A declared find's \`decimal\`/\`money\` query param.
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
  # A declared find's \`bool\` query param.
  defp __find_bool("true"), do: true
  defp __find_bool("false"), do: false
  defp __find_bool(v), do: v`
      : "",
    neededCoercions.has("datetime")
      ? `
  # A declared find's \`datetime\`/\`date\` query param.  Unlike the int and
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
  # A declared find's \`date\` query param — Postgrex encodes a \`date\`
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

  return actions.join("\n") + pageParamHelper + findParamHelpers;
}

/** The `__check_find_params/2` helper, with one `__find_param_error/3` clause
 *  per check kind this controller's finds use — an unreachable clause is dead
 *  code the compiler is entitled to warn on. */
function renderFindParamCheck(kinds: ReadonlySet<FindParamCheck["kind"]>): string {
  const clauses: string[] = [
    `  defp __find_param_error(nil, _check, required), do: if(required, do: "Required", else: nil)`,
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
      else: "Expected UUID."
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
  if (kinds.has("enum")) {
    clauses.push(`  defp __find_param_error(value, {:enum, values}, _required) do
    if value in values, do: nil, else: "Expected one of: " <> Enum.join(values, ", ") <> "."
  end`);
  }
  return `

  # Each declared find param, checked against the type this app's OpenAPI
  # document publishes for it before the find runs.  A failure answers the
  # declared 422 with the §3.2 \`errors[]\` envelope at the param's pointer —
  # the rung the per-operation error matrix publishes for a query parameter
  # that does not parse against its declared type.
  defp __check_find_params(params, specs) do
    errors =
      Enum.flat_map(specs, fn {name, check, required} ->
        case __find_param_error(Map.get(params, name), check, required) do
          nil -> []
          message -> [%{pointer: "/" <> name, message: message, code: nil}]
        end
      end)

    if errors == [], do: :ok, else: {:error, errors}
  end

${clauses.join("\n\n")}`;
}
