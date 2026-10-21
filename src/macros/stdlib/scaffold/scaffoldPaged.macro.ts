import { isRepository } from "../../../language/generated/ast.js";
import type { BoundedContext, TypeRef } from "../../api/index.js";
import {
  callExpr,
  cloneTypeRef,
  defineMacro,
  letStmt,
  memberAccess,
  namedType,
  nameRef,
  param,
  queryHandler,
  requiresStmt,
  returnStmt,
} from "../../api/index.js";
import { criterionAggName, type PagedReadSource, pagedHandlerName } from "./_paged-shared.js";

/** Expose a named read as a paged, filtered list read (read-path-architecture.md,
 * "The ergonomic default").  The read stays a domain declaration — a
 * `criterion`, or a `retrieval` that bundles one with a `sort:` — and the
 * exposure is this macro: one line instead of a hand-written `query` +
 * `response` + `queryHandler` + `route` quartet.  It reads its argument's kind:
 *
 *   context Sales with scaffoldPaged(of: InRegion) { … }          // a criterion
 *   context Sales with scaffoldPaged(of: TopInRegion) { … }       // a retrieval
 *   context Sales with scaffoldPaged(of: TopInRegion, requires: SalesTeam) { … }
 *
 *   ↓ Sales gains
 *
 *   queryHandler ListOrderByTopInRegion(rgn: string): Order paged {
 *     requires SalesTeam()
 *     let r = Orders.run(TopInRegion(rgn))
 *     return r
 *   }
 *
 * The handler returns the aggregate's wire shape (`Order paged`); the
 * read-rewire (M-T5.10) AUTO-PROJECTS that to `OrderResponse paged`, so no
 * `response` record is hand-rolled.  The read's own params ride as PLAIN
 * scalar handler params; `page` / `pageSize` / `sort` / `dir` are route-level
 * query params supplied by the paged infra, never handler params.  A
 * retrieval's `sort:` is the page's default order (the route's `sort` defaults
 * to `""`, so an unsorted request gets it).  `requires:` names a parameterless
 * function-form `policy`, spliced as the handler's first body statement — the
 * gate lives where the exposure lives, exactly as `crudish(requires:)` gates
 * the members it emits.  Pairs with `scaffoldPagedApi`, which emits the
 * matching `route` from the SAME read — a route can never target a handler this
 * macro didn't emit. */
export default defineMacro({
  name: "scaffoldPaged",
  target: "context",
  apiVersion: 1,
  description:
    "Exposes a criterion or retrieval as a paged queryHandler over the read-only port " +
    "(Repo.run(<read>)) — the read's params become the handler's scalar params, the " +
    "aggregate's wire shape (auto-projected) its paged return; `requires: <Policy>` gates it.",
  params: {
    of: { kind: "ref", of: ["Criterion", "Retrieval"] },
    requires: { kind: "ref", of: "Policy", optional: true },
  },
  expand({ target, args }) {
    const ctx = target as BoundedContext;
    const read = args.of as PagedReadSource;
    const aggName = criterionAggName(read);
    // The repository that runs the read — the one whose aggregate ref matches
    // the read's target.  No repo → nothing to `run` through, so the macro
    // emits nothing (mirrors `scaffoldPagedApi`, which also skips).
    const repo = (ctx.members ?? [])
      .filter(isRepository)
      .find((r) => r.aggregate?.$refText === aggName);
    if (!repo) return [];
    // `requires:` resolves to the function-form `policy` itself.  A policy with
    // parameters cannot be called from here — the macro has nothing to pass —
    // so refuse it at the call site (the `crudish(requires:)` rule).
    const policy = args.requires as { name?: string; params?: readonly unknown[] } | undefined;
    if (policy && (policy.params?.length ?? 0) > 0) {
      throw new Error(
        `requires: policy '${policy.name}' takes ${policy.params?.length} parameter(s); ` +
          "scaffoldPaged can only call a parameterless policy — wrap it in one " +
          "(`policy Gate(): bool = " +
          `${policy.name}(...)\`)`,
      );
    }

    // The read's declared params → the handler's params, each cloned through
    // the factories so a `Money` / `X id` type keeps its resolved type after
    // splicing (a hand-rolled ref never re-links, silently → `string`).
    const readParams = read.params.filter((p) => p.type != null);
    const params = readParams.map((p) => param(p.name, cloneTypeRef(p.type as TypeRef)));
    const body = [
      // `requires <Policy>()` — the handler's authorization gate, the first
      // body statement (a handler has no header gate).
      ...(policy?.name ? [requiresStmt(callExpr(policy.name, []))] : []),
      // `let r = <Repo>.run(<Read>(<params>))` — the read-only port.  No `page:`
      // arg: paging is route-level (query params), per retrieval.md's
      // page-is-call-only decision.
      letStmt(
        "r",
        memberAccess(nameRef(repo.name), "run", {
          call: true,
          args: [
            callExpr(
              read.name,
              readParams.map((p) => ({ value: nameRef(p.name) })),
            ),
          ],
        }),
      ),
      returnStmt(nameRef("r")),
    ];
    // Return `<Agg> paged` — the aggregate's wire shape; the read-rewire projects
    // it to `<Agg>Response paged` at the transport boundary.
    return [
      queryHandler(
        pagedHandlerName(aggName, read.name),
        params,
        namedType(aggName, { paged: true }),
        body,
      ),
    ];
  },
});
