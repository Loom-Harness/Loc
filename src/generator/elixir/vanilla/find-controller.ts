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
import type { ApiOperationIR } from "../../../ir/util/api-surface.js";
import { snake, upperFirst } from "../../../util/naming.js";
import { routeSegmentFor } from "../../../util/storage-names.js";
import type { ApiRoute } from "../api-emit.js";
import { elixirFindFacadeFn } from "../find-facade-name.js";
import { renderExpr } from "../render-expr.js";
import { exErrorVariant } from "../wire-policy-ex.js";
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
import { findParamRead, queryParamSpecs, renderQueryParamHelpers } from "./query-param.js";
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
  const resp = exErrorVariant(tag, ctx.errorStatusOverrides);
  return {
    kind: "error",
    status: resp.status,
    type: resp.type,
    title: resp.title,
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
  const aggsPath = routeSegmentFor(agg.name);
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
    const call = `${ctxModule}.${elixirFindFacadeFn(f.name, agg.name)}(${argReads})`;

    // Assemble the action from its inner body — wrapping it in an `if not (gate)
    // do <403> else … end` guard when the find carries a read gate (the
    // aggregate's `policy { read X requires … }`).
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
        : `    case __check_find_params(params, ${queryParamSpecs(f.params, ctx)}) do
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
  const findParamHelpers = renderQueryParamHelpers(
    httpFindsOf(ctx, agg).flatMap((f) => f.params.map((param) => ({ param, ctx }))),
  );

  return actions.join("\n") + pageParamHelper + findParamHelpers;
}
