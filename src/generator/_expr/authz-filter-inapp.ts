// ---------------------------------------------------------------------------
// The `authz-filter` sentinel, desugared for the IN-APP filter path.
//
// An `authz-filter` node is a SENTINEL, not an expression: each
// backend's QUERY-FILTER translator intercepts it and renders its native
// column predicate (Drizzle operator tree / EF `false` / JPQL `1 = 0` /
// SQLAlchemy contradiction / Ecto fragment).  The shared expression dispatcher
// (`renderExprWith`) deliberately throws on it, so a backend that forgets to
// intercept fails loudly instead of silently dropping an authorization term.
//
// A `shape: document` aggregate has no query-filter translator to intercept
// with.  The whole tree is ONE opaque jsonb column, so node/java/python filter
// document reads IN-APP over the REHYDRATED domain instance — the tenant floor
// `this.tenantId == currentUser.tenantId` already renders through the ordinary
// expression path there.  The sentinel arrived at that same ordinary path and
// blew the invariant (pairwise finding F1: `shape: document` × `policy { allow
// … }` crashed codegen on node, java and python; .NET's EF `HasQueryFilter`
// intercepts it, and Elixir has no `document` shape at all).
//
// The fix is not another per-backend translator.  The sentinel's decision
// (`deny`) is expressible as ORDINARY `ExprIR` over the rehydrated row — the
// `false` literal — so this module lowers the sentinel to plain IR ONCE, and
// the in-app render sites feed the result to their existing expression
// renderer.
//
// Only the IN-APP (document) path desugars.  The relational and embedded paths
// keep their native column translators: a SQL `where` is strictly better than
// rehydrating every row to test a predicate, and `false` is not a legal
// standalone Drizzle/Ecto/SQLAlchemy predicate — which is why the sentinel
// exists in the first place.
// ---------------------------------------------------------------------------

import type { ExprIR } from "../../ir/types/loom-ir.js";

/**
 * Rewrite every `authz-filter` sentinel in `e` into ordinary `ExprIR` that the
 * backends' existing expression renderers handle, for the IN-APP (document)
 * filter path.  Non-sentinel nodes are returned unchanged (identity, so a
 * filter without a sentinel keeps its exact node objects and emission stays
 * byte-identical).
 *
 * `deny`, the only decision, becomes the plain `false` literal.  It is a sentinel on the SQL side
 * only because a bare boolean is not a legal standalone Drizzle/Ecto/SQLAlchemy
 * predicate; in-app it is exactly a `false` conjunct, and the always-false
 * result — the aggregate reads as invisible — is the same one the column
 * translators produce.
 *
 * The walk recurses through the only positions a validated capability
 * predicate can nest one (`paren`, `unary`, `binary`); in practice enrichment
 * appends a sentinel as a whole `contextFilters` entry.
 */
export function desugarAuthzFilterInApp(e: ExprIR, aggName: string): ExprIR {
  switch (e.kind) {
    case "authz-filter":
      return { kind: "literal", lit: "bool", value: "false" };
    case "paren":
      return { ...e, inner: desugarAuthzFilterInApp(e.inner, aggName) };
    case "unary":
      return { ...e, operand: desugarAuthzFilterInApp(e.operand, aggName) };
    case "binary":
      return {
        ...e,
        left: desugarAuthzFilterInApp(e.left, aggName),
        right: desugarAuthzFilterInApp(e.right, aggName),
      };
    // Identity for every other kind — and NOT merely "safe by default": a
    // sentinel cannot be nested under one.  `authz-filter` nodes have exactly
    // one construction site (`buildDenyFilter` in
    // `src/ir/util/tenant-stance.ts`), and enrichment installs it as a WHOLE
    // `contextFilters[i]` entry or a whole `writeScopeFilter` — never as a
    // sub-expression of a user predicate.  The three recursive arms above are
    // the defensive envelope around a hand-composed conjunction.  Named rather
    // than left to a `default:` so a new `ExprIR` kind that could CARRY a
    // predicate (a future `match`-shaped filter, say) is a `tsc` error here.
    case "exists":
    case "action-ref":
    case "call":
    case "convert":
    case "duration":
    case "i18nFormat":
    case "modelText":
    case "id":
    case "lambda":
    case "list":
    case "literal":
    case "match":
    case "member":
    case "method-call":
    case "new":
    case "object":
    case "ref":
    case "ternary":
    case "this":
      return e;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return e;
    }
  }
}

/** True when `e` carries an `authz-filter` sentinel anywhere the in-app
 *  desugar reaches — i.e. when {@link desugarAuthzFilterInApp} would change it.
 *  Lets a caller keep its pre-existing emission path untouched for the ordinary
 *  case. */
export function hasAuthzFilter(e: ExprIR): boolean {
  switch (e.kind) {
    case "authz-filter":
      return true;
    case "paren":
      return hasAuthzFilter(e.inner);
    case "unary":
      return hasAuthzFilter(e.operand);
    case "binary":
      return hasAuthzFilter(e.left) || hasAuthzFilter(e.right);
    // Cannot contain a sentinel — same construction argument as
    // {@link desugarAuthzFilterInApp}; the two switches must stay arm-for-arm
    // identical, which is what the `never` below enforces.
    case "exists":
    case "action-ref":
    case "call":
    case "convert":
    case "duration":
    case "i18nFormat":
    case "modelText":
    case "id":
    case "lambda":
    case "list":
    case "literal":
    case "match":
    case "member":
    case "method-call":
    case "new":
    case "object":
    case "ref":
    case "ternary":
    case "this":
      return false;
    default: {
      const _exhaustive: never = e;
      void _exhaustive;
      return false;
    }
  }
}
