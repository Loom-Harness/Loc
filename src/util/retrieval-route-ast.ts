// -------------------------------------------------------------------------
// AST-level mirror of the retrieval routes the enrich pass derives
// (`synthesizeRetrievalRouteFinds`, src/ir/enrich/enrichments.ts).
//
// Two pre-IR phases need to know which reads an aggregate's api surface will
// carry: phase ② the scaffold macro (the list page's filter bar binds to a
// parameterised retrieval's read) and phase ④ the AST validator / typer (a
// hand-written `<api>.<Agg>.<read>(…)` must resolve).  Neither may value-import
// `ir/`, so the rule lives here — the same predicate (`retrievalRouteServed`)
// and read name (`retrievalReadName`) the IR derivation uses.
//
// The AST types are imported TYPE-ONLY, so this carries no runtime edge into
// `language/`.
// -------------------------------------------------------------------------

import type { Aggregate, Retrieval } from "../language/generated/ast.js";
import { retrievalReadName, retrievalRouteServed } from "./retrieval-route.js";

/** The author-declared retrievals over `agg` that are served as GET routes —
 *  in declaration order.  Mirrors the IR derivation clause for clause: the
 *  aggregate must be a routed shape and have a repository, and a retrieval
 *  whose read name an author-declared find already takes is not routed (that
 *  collision is refused by `loom.retrieval-route-collision`). */
export function routedRetrievalsOf(agg: Aggregate): Retrieval[] {
  const ctx = agg.$container;
  if (ctx?.$type !== "BoundedContext") return [];
  if (
    !retrievalRouteServed({
      eventLog: agg.persistedAs === "eventLog",
      shape: agg.shape,
      extendsBase: agg.superType !== undefined,
      abstract: agg.isAbstract === true,
    })
  )
    return [];
  const repos = ctx.members.filter(
    (m): m is Extract<typeof m, { $type: "Repository" }> =>
      m.$type === "Repository" && (m.aggregate?.ref === agg || m.aggregate?.$refText === agg.name),
  );
  if (repos.length === 0) return [];
  const findNames = new Set(repos.flatMap((r) => r.finds.map((f) => f.name)));
  return ctx.members.filter(
    (m): m is Retrieval =>
      m.$type === "Retrieval" &&
      retrievalTargetName(m as Retrieval) === agg.name &&
      !findNames.has(retrievalReadName((m as Retrieval).name)),
  );
}

/** The aggregate a retrieval reads — the `T` in `retrieval X(...) of T`. */
export function retrievalTargetName(r: Retrieval): string {
  const base = r.target.base as { target?: { $refText?: string } };
  return base.target?.$refText ?? "";
}
