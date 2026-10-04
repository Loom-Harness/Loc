// The aggregate's canonical LIST read and the `requires` gate on it.
//
// Every aggregate serves one list endpoint (`GET /<aggs>`), backed by the
// repository find named `all`.  That find is USUALLY the one enrichment injects
// (`ensureFindAll`), but an author may declare their own — and theirs wins,
// gate included:
//
//     repository Orders for Order {
//       find all(): Order[] requires currentUser.role == "admin"
//     }
//
// Node and .NET picked the gate up for free because they emit a route per
// repository find and `all` is just another entry in that list.  Java, Python
// and Elixir each special-case `all` OUT of their declared-find loop — it has a
// bespoke route shape (paging controls, the `<Agg>Paged` envelope, `index`) —
// and each then emitted that bespoke route without ever consulting the find's
// `requires`.  The gate parsed, validated, lowered, and reached three emitters
// that read every other field on the find except that one.  Result: the same
// `.ddd` served the list 403-gated on two backends and wide open on three.
//
// The failure is structural, not a typo repeated three times: "the list read"
// was a concept each backend re-derived inline with its own predicate.  So it
// gets ONE derivation here that every backend consults, and a backend that
// forgets to call it is visibly missing a call rather than invisibly missing a
// field read.
//
// Derive, don't stamp (CLAUDE.md): a pure function of the repository's finds,
// computed at each emission site.

import type { ExprIR, FindIR, RepositoryIR } from "../types/loom-ir.js";

/** The repository find backing the aggregate's list endpoint — the
 *  enrichment-injected `all`, or the author's own `find all(...)` when they
 *  declared one (theirs wins, per `ensureFindAll`). */
export function listReadFind(repo: RepositoryIR | undefined): FindIR | undefined {
  return repo?.finds.find((f) => f.name === "all");
}

/** The authorization gate on the list endpoint, when the author declared one.
 *
 *  `undefined` for the enrichment-injected `all` (which carries no gate — it is
 *  compiler-synthesized and has no author source line — which is why, under
 *  `enforcement: denyByDefault`, `loom.default-deny-list-ungated` refuses the
 *  build until the author declares one).  The emitted route must evaluate
 *  this BEFORE the query and answer 403 on failure, exactly as a named find's
 *  gate does. */
export function listReadGate(repo: RepositoryIR | undefined): ExprIR | undefined {
  return listReadFind(repo)?.requires;
}

// ── The by-id read (M-T3.19) ────────────────────────────────────────────────
//
// Every non-abstract aggregate also serves `GET /<aggs>/{id}`, and until
// M-T3.19 nothing could gate it: the route is compiler-derived, so there was
// no declaration to hang a `requires` on.  The surface is the one the list
// read already uses — a repository `find` — spelled with the by-id SHAPE:
//
//     repository Secrets for Secret {
//       find byId(id: Secret id): Secret? requires currentUser.role == "admin"
//     }
//
// The gate is NAMED AT THE DECLARATION (the #2877 ruling: no inherited
// aggregate-level default read gate).  Recognition is by name AND shape, so a
// `find byId(oid: Order id): Order[] where …` (a different read that merely
// shares the name) stays an ordinary find.  When the author writes no
// `where`, lowering supplies the only filter the shape can mean
// (`where this == <param>`), so the find's own `GET /<aggs>/by_id` route and
// repository method return THE row — not the table's first one.

/** True when `find` has the by-id read shape for aggregate `aggName`:
 *  named `byId`, exactly one parameter of type `<Agg> id`, returning `<Agg>?`. */
export function isByIdReadShape(find: FindIR, aggName: string): boolean {
  if (find.name !== "byId" || find.params.length !== 1) return false;
  const p = find.params[0]!.type;
  const r = find.returnType;
  return (
    p.kind === "id" &&
    p.targetName === aggName &&
    r.kind === "optional" &&
    r.inner.kind === "entity" &&
    r.inner.name === aggName
  );
}

/** The repository find the author declared as the aggregate's by-id read, if
 *  any (`find byId(id: T id): T? …`). */
export function byIdReadFind(repo: RepositoryIR | undefined): FindIR | undefined {
  if (!repo) return undefined;
  return repo.finds.find((f) => !f.synthesized && isByIdReadShape(f, repo.aggregateName));
}

/** The authorization gate on `GET /<aggs>/{id}`, when the author declared one.
 *  Every backend's by-id route evaluates it BEFORE the load and answers 403 on
 *  failure — the same place and the same carrier as a named find's gate. */
export function byIdReadGate(repo: RepositoryIR | undefined): ExprIR | undefined {
  return byIdReadFind(repo)?.requires;
}
