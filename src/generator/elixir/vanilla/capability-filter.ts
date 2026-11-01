// ---------------------------------------------------------------------------
// Vanilla capability-filter rendering.
//
// A `filter <expr>` capability (`contextFilters` on the aggregate) restricts
// EVERY read of the aggregate.  On the relational path each restriction is
// rendered here once (`renderEctoRestriction`) and hosted on the schema module
// — `base_query/0` or a `Repo.prepare_query/3` clause (read-scope-emit.ts) — so
// no read site splices one.  The write-scope load (`vanillaWriteScopeFilter`)
// and the `shape: document` in-app path below render their own.
//
// Predicates render under the `record` Ecto binding (`!this.isDeleted` →
// `not record.is_deleted`).  A `filter <Criterion>` reference inlines its
// predicate directly.
//
// **Principal (tenancy) filters** (`this.tenantId == currentUser.tenantId`):
// `currentUser.tenantId` lowers to `current_user.tenant_id`; inside an Ecto
// `where:` the principal side must be PINNED and fail-closed, so it renders as
// `^(current_user && current_user.tenant_id)` — a pinned `nil` matches no rows
// (Ecto binds `= NULL`, never `IS NULL`).
// ---------------------------------------------------------------------------

import type { AggregateIR, ExprIR } from "../../../ir/types/loom-ir.js";
import {
  aggregateUsesPrincipalContextFilter,
  exprUsesCurrentUser,
} from "../../../ir/types/loom-ir.js";
import {
  deepScopeAnchorClaim,
  deepScopeTenantClaim,
  guidFromStringSelfScope,
  isDeepScopeFilter,
} from "../../../ir/util/tenant-stance.js";
import { desugarAuthzFilterInApp } from "../../_expr/authz-filter-inapp.js";
import {
  type RenderCtx,
  renderDeepScopeEcto,
  renderDeepScopeInApp,
  renderExpr,
  renderGuidClaimSelfScopeEcto,
} from "../render-expr.js";

export { aggregateUsesPrincipalContextFilter };

/** True when a repository `find`'s OWN (author-written) `where` predicate reads
 *  the request principal — `find mine(): WorkOrder[] where this.ownerId ==
 *  currentUser.id`.
 *
 *  Such a find needs the actor threaded exactly like one scoped by a principal
 *  CAPABILITY filter does (`aggregateUsesPrincipalContextFilter`), and nothing
 *  used to notice: the aggregate-level predicate only inspects
 *  `contextFilters`, so the find's head bound no `current_user` while its body
 *  rendered one — "undefined variable current_user" at `mix compile`. */
export function findUsesPrincipal(f: { filter?: ExprIR }): boolean {
  return !!f.filter && exprUsesCurrentUser(f.filter);
}

/** True when the aggregate's LIST read (`list/…`, fronting the `all` find)
 *  must thread the request actor: a principal capability filter scopes it, or
 *  a DECLARED `find all(): X[] where <pred>` whose own predicate reads
 *  `currentUser` (the list conjoins that predicate — eval-closure item 2).
 *  The repository head, the context defdelegate and the controller's `index`
 *  call all read this one predicate so their arities cannot drift. */
export function listUsesPrincipal(
  agg: AggregateIR,
  allFind: { filter?: ExprIR } | undefined,
): boolean {
  return aggregateUsesPrincipalContextFilter(agg) || (!!allFind && findUsesPrincipal(allFind));
}

/** One capability/write-scope predicate as an Ecto `where:` fragment, with the
 *  principal side made fail-closed.  The fail-closed pin itself
 *  (`^(current_user && current_user.<claim>)`) is now rendered by `renderExpr`
 *  for EVERY `filterArgs` context — author-written `find`/`retrieval` `where`s
 *  included, which a post-pass here could never reach — so this is a plain
 *  render plus the ONE shape the pin alone can't carry: the `"guid-from-string"`
 *  registry self-scope, where the claim is raw token text bound against a
 *  `:binary_id` field, so Ecto casts it and a MALFORMED claim raised
 *  `Ecto.Query.CastError` (a 500 for an ordinary bad token).  That one routes to
 *  `renderGuidClaimSelfScopeEcto`, which casts in Elixir and pins nil on
 *  failure.  (The deep-scope sentinel is intercepted by the callers, which own
 *  actor gating.) */
function renderPrincipalFilter(p: ExprIR, ctx: RenderCtx): string {
  const selfScope = guidFromStringSelfScope(p);
  if (selfScope) return renderGuidClaimSelfScopeEcto(ctx.thisName, selfScope.claim);
  return renderExpr(p, ctx);
}

/** One read restriction as an Ecto predicate under the `record` binding — the
 *  rendering `Repo.prepare_query/3` and `base_query/0` apply.  The deep/global
 *  subtree sentinel renders its own fail-closed pinned fragment (both claims:
 *  the anchor and the system's tenancy claim, which the NULL-`data_key` floor
 *  compares against); every other principal side is pinned by `renderExpr`. */
export function renderEctoRestriction(p: ExprIR, contextModule: string): string {
  const ctx: RenderCtx = { thisName: "record", contextModule, filterArgs: true };
  return isDeepScopeFilter(p)
    ? renderDeepScopeEcto(ctx.thisName, deepScopeAnchorClaim(p), deepScopeTenantClaim(p))
    : renderPrincipalFilter(p, ctx);
}

/** A read's capability filter-bypass spec (`ignoring <Cap>` / `ignoring *`),
 *  carried by capability NAME on `FindIR` / the repo-run stmt.
 *  Named caps match `AggregateIR.contextFilterOrigins`; a filter with an
 *  `undefined` origin (bare/hand-written) is never bypassable. */
export interface FilterBypass {
  bypassAll?: boolean;
  bypassCaps?: string[];
}

/** True when the capability filter at origin index `i` is dropped by `bypass`
 *  (`ignoring *` drops every capability-origin filter; a named `ignoring <Cap>`
 *  drops only the matching origin; an `undefined` origin is never dropped). */
function isFilterBypassed(origin: string | undefined, bypass: FilterBypass | undefined): boolean {
  if (!bypass || origin === undefined) return false;
  if (bypass.bypassAll) return true;
  return (bypass.bypassCaps ?? []).includes(origin);
}

/** The aggregate's `writeScopeFilter` (authorization — the WRITE
 *  ladder) as a single Ecto `where:` predicate, or null when the aggregate has
 *  no write-scope narrowing.  Rendered exactly like a principal capability read
 *  filter (deep sentinel → the fail-closed pinned LIKE fragment; the floor →
 *  `pinPrincipal(...)`), so the write guard needs no new render path. */
export function vanillaWriteScopeFilter(agg: AggregateIR, contextModule: string): string | null {
  if (!agg.writeScopeFilter) return null;
  // See `vanillaCapabilityFilter`: rendered into an Ecto `where:`, so money/
  // decimal/datetime must use the native-query form (`filterArgs: true`).
  const ctx: RenderCtx = {
    thisName: "record",
    contextModule,
    filterArgs: true,
  };
  const p = agg.writeScopeFilter;
  return isDeepScopeFilter(p)
    ? renderDeepScopeEcto(ctx.thisName, deepScopeAnchorClaim(p), deepScopeTenantClaim(p))
    : renderPrincipalFilter(p, ctx);
}

// ---------------------------------------------------------------------------
// IN-APP (document-shape) capability filtering.
//
// A `shape: document` aggregate persists as ONE opaque jsonb column, so there
// is no per-field Ecto `where:` to AND the capability predicate into — the same
// situation node/java/python/dotnet are in.  Those four filter document reads
// IN-APP over the rehydrated instance; the plain-Ecto path does the same over
// the `%<Agg>.Data{}` embed the row rehydrates to (`record = row.data`).
//
// Two things differ from the Ecto rendering above, and both are load-bearing:
//
//   1. The `authz-filter` SENTINELS (`deny` / `scope`) have no in-app column
//      predicate to be.  They are desugared to ordinary `ExprIR` FIRST, by the
//      shared `desugarAuthzFilterInApp` the other three in-app backends already
//      use — so `deny` becomes `false`, and `allow deep` becomes the
//      DEEP_SCOPE_SEMANTICS expression over the row's own `dataKey`/`tenantId`
//      (both of which live INSIDE the blob on a document aggregate).  Rendering
//      the sentinel unchanged would emit an Ecto `fragment(...)`, which is not
//      valid Elixir outside a query.
//   2. A principal claim can't be `^`-pinned (there is no query to pin into),
//      so fail-closed has to be spelled out in Elixir: `current_user.<claim>`
//      becomes `(current_user && current_user.<claim>)` (nil-safe access — an
//      in-process read threads no actor), and the whole conjunction is guarded
//      by `current_user != nil`, so a principal-scoped read with NO actor
//      matches nothing exactly as a pinned NULL does in SQL.  Without that
//      guard a nil claim would compare EQUAL to a nil column in Elixir (SQL's
//      `= NULL` is never true) — a fail-OPEN divergence from the Ecto path.
// ---------------------------------------------------------------------------

/** The in-app rendering of a `deny` carve-out — a call to the repository's
 *  `__denied?/1` helper ({@link DOC_DENY_HELPER}).  See `renderDocPredicate`
 *  for why this is not the literal `false`. */
export const DOC_DENY_PREDICATE = "__denied?(row)";

/** The private helper {@link DOC_DENY_PREDICATE} calls.  Emitted once per
 *  document repository whose filters contain a `deny`. */
export const DOC_DENY_HELPER = `  # \`deny\` carve-out: the visible set is EMPTY.  Spelled
  # as a runtime membership test rather than the literal \`false\` because the
  # compiler FOLDS a literal — \`… and false\` is a typing violation, and a read
  # that provably never returns \`{:ok, _}\` makes each caller's success branch
  # dead code.  Both fail \`mix compile --warnings-as-errors\`; the SQL path is
  # unaffected only because \`fragment("false")\` is opaque to the compiler.
  @spec __denied?(term()) :: boolean()
  defp __denied?(row), do: Enum.member?([], row)`;

/** The document root's `id` is NOT in the blob — `@primary_key false` on the
 *  `<Agg>.Data` embed keeps it on the ROW.  So a predicate reading `this.id`
 *  renders as `record.id` against a struct that has no such key (a runtime
 *  `KeyError`); lift those reads to the row binding every in-app read site has
 *  in scope.  Anchored on a non-member, non-word char so a value-object
 *  sub-field (`record.money.id`) and a longer field name (`record.identifier`)
 *  are left alone. */
export function liftDocRootId(rendered: string, rowVar: string): string {
  return rendered.replace(/(^|[^.\w])record\.id\b/g, `$1${rowVar}.id`);
}

/** `current_user.<claim>` made nil-safe for an IN-MEMORY predicate — the in-app
 *  twin of `pinPrincipal`'s `^(current_user && …)` Ecto pin. */
function guardPrincipalInApp(rendered: string): string {
  return rendered.replace(
    /(^|[^.\w])current_user\.([a-z0-9_]+)/g,
    "$1(current_user && current_user.$2)",
  );
}

/** One predicate rendered for the IN-APP document read path: sentinels
 *  desugared, `this.id` lifted to the row, principal claims made nil-safe. */
export function renderDocPredicate(
  p: ExprIR,
  agg: AggregateIR,
  contextModule: string,
  rowVar: string,
): string {
  // The `deep`/`global` sentinel renders its own already-fail-closed in-memory
  // fragment (Elixir's `nil <> "."` raises, so the descendant prefix has to be
  // interpolated rather than concatenated — see `renderDeepScopeInApp`).  Do
  // NOT run it through `guardPrincipalInApp`: it pins its claims itself, the
  // same split `vanillaCapabilityFilter` makes for the Ecto path.
  if (isDeepScopeFilter(p)) {
    return renderDeepScopeInApp("record", deepScopeAnchorClaim(p), deepScopeTenantClaim(p));
  }
  // The `deny` carve-out is always-false, but it must NOT render as the literal
  // `false`.  Elixir 1.18's type checker folds it: `… and false` is reported as
  // a typing violation, and a `find_by_id` that can only return
  // `{:error, :not_found}` makes every CALLER's `{:ok, _}` branch statically
  // dead — both are `--warnings-as-errors` failures.  The SQL path never hits
  // this because `fragment("false")` is opaque to the compiler; in-app the
  // equivalent opacity is a runtime membership test against the empty visible
  // set, which is also a fair reading of what `deny` means.
  if (p.kind === "authz-filter" && p.filter.kind === "deny") return DOC_DENY_PREDICATE;
  // `docStruct` (not `filterArgs`): the predicate runs in memory over the
  // rehydrated embed, so scalar intrinsics take their `String.*` / `DateTime.*`
  // forms rather than the Ecto `fragment(...)` ones.
  const ctx: RenderCtx = {
    thisName: "record",
    contextModule,
    docStruct: true,
  };
  return guardPrincipalInApp(
    liftDocRootId(renderExpr(desugarAuthzFilterInApp(p, agg.name), ctx), rowVar),
  );
}

/** The aggregate's capability filters as a single IN-MEMORY Elixir boolean
 *  expression over `record` (the rehydrated `%<Agg>.Data{}` embed) and `rowVar`
 *  (the loaded root row), or null when it has none / all are bypassed.
 *
 *  Mirrors {@link vanillaCapabilityFilter}'s actor gating and `ignoring` bypass
 *  exactly — only the RENDERING differs (see the block comment above). */
export function vanillaDocCapabilityFilter(
  agg: AggregateIR,
  contextModule: string,
  rowVar: string,
  opts?: { actor?: boolean; bypass?: FilterBypass },
): string | null {
  const preds = (agg.contextFilters ?? [])
    .filter((_, i) => !isFilterBypassed(agg.contextFilterOrigins?.[i], opts?.bypass))
    .filter((p) => opts?.actor || !exprUsesCurrentUser(p));
  if (preds.length === 0) return null;
  const rendered = preds.map((p) => renderDocPredicate(p, agg, contextModule, rowVar));
  const body = rendered.length === 1 ? rendered[0]! : rendered.map((p) => `(${p})`).join(" and ");
  return preds.some(exprUsesCurrentUser) ? `current_user != nil and (${body})` : body;
}

/** The aggregate's `writeScopeFilter` as an IN-MEMORY Elixir predicate (the
 *  document twin of {@link vanillaWriteScopeFilter}), or null when the
 *  aggregate has no write-scope narrowing. */
export function vanillaDocWriteScopeFilter(
  agg: AggregateIR,
  contextModule: string,
  rowVar: string,
): string | null {
  if (!agg.writeScopeFilter) return null;
  const body = renderDocPredicate(agg.writeScopeFilter, agg, contextModule, rowVar);
  return exprUsesCurrentUser(agg.writeScopeFilter) ? `current_user != nil and (${body})` : body;
}
