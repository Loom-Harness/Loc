// Repository `find` checks (read-path-architecture.md, migration).
//
//   - loom.repository-find-deprecated — a wire-shaped LIST `find` on a
//     repository (a bespoke list query returning `T[]` or `T paged`) is
//     deprecated in favour of a `criterion` + `retrieval` pair.  This
//     kills the "repository-with-40-finders" smell — every distinct list
//     query stops minting a `find byX` method.  A **unique-key
//     reconstitution** find (returning a single `T` / `T?` by identity) is
//     NOT a list query and stays legal (proposal Open Q4).  A WARNING, not an
//     error: existing `.ddd` keeps parsing.  The replacement is at parity: a
//     `retrieval` is served as `GET /<aggs>/<snake name>` with its own
//     `requires` gate, generated client method and scaffold filter bar.
//
//   - loom.retrieval-route-collision / loom.retrieval-unrouted — a retrieval's
//     GET route (`checkRetrievalRoute` below).
//
// This is an AST-level check over author-declared `FindDecl` nodes, so the
// compiler-SYNTHESIZED finds (the auto-`findAll`, and scaffoldPaged's paged
// `findAllBy<Criterion>` — both minted in enrich, never in source) are
// naturally exempt: they don't exist at this layer.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { retrievalReadName, retrievalRouteServed } from "../../util/retrieval-route.js";
import { retrievalTargetName } from "../../util/retrieval-route-ast.js";
import {
  type Aggregate,
  type FindDecl,
  isAggregate,
  isBoundedContext,
  isFindDecl,
  isOperation,
  isProjection,
  isRepository,
  isRetrieval,
  type Model,
  type Repository,
  type Retrieval,
} from "../generated/ast.js";
import { envForNode, typeOf, typeToString } from "../type-system.js";

/** A read-path `requires <expr>` authorization gate must type to bool, exactly
 *  like the operation / workflow `requires` clause (`statements.ts` /
 *  `structural.ts`).  Without this a non-bool gate (`requires 42`) lowered to
 *  an always-truthy no-op that silently never fired.  Now that `currentUser`
 *  types precisely (`type-system.ts`), a bare
 *  `requires currentUser.permissions.contains(permissions.x)` gate passes. */
function checkGateIsBool(
  gate: FindDecl["gate"],
  node:
    | FindDecl
    | import("../generated/ast.js").Projection
    | import("../generated/ast.js").Retrieval,
  accept: ValidationAcceptor,
): void {
  if (!gate) return;
  const gt = typeOf(gate, envForNode(gate));
  if (gt.kind !== "primitive" || gt.name !== "bool") {
    accept("error", diagMessage("loom.requires-not-bool", { actual: typeToString(gt) }), {
      node,
      property: "gate",
      code: "loom.requires-not-bool",
    });
  }
}

/** A find whose return type is a COLLECTION — an array (`T[]`) or the `paged`
 *  list carrier (`T paged`).  These are list queries; a single (`T`) or
 *  optional-single (`T?`) return is reconstitution, not a list. */
function returnsCollection(find: FindDecl): boolean {
  const rt = find.returnType;
  if (!rt) return false;
  return rt.array === true || rt.ctors.includes("paged");
}

export function checkRepositoryFinds(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    // Read-path `requires` gate bool check — the find, retrieval and
    // query-time projection (the "view" successor) gates, the read-side twins
    // of the operation gate.
    if (isProjection(node)) {
      checkGateIsBool(node.gate, node, accept);
      continue;
    }
    if (isRetrieval(node)) {
      checkGateIsBool(node.gate, node, accept);
      checkRetrievalRoute(node, accept);
      continue;
    }
    if (!isFindDecl(node)) continue;
    checkGateIsBool(node.gate, node, accept);
    if (!returnsCollection(node)) continue;
    // `find all` is NOT a bespoke list finder — it is the aggregate's own
    // compiler-synthesised list route, and DECLARING it is the one documented
    // way to put a `requires` gate on that route (auth.md: "the auto-injected
    // `find all` list route ... Declaring an explicit `find all(): T[] requires
    // <expr>` gates that route, and does so on all five backends").  Warning on
    // it told the reader that the fix for an ungated list read is deprecated —
    // two shipped rules contradicting each other, with security on the losing
    // side.  A retrieval cannot replace it: it mounts at its own sub-path, not
    // at the aggregate's list route.
    if (node.name === "all") continue;
    accept("warning", diagMessage("loom.repository-find-deprecated", { name: node.name }), {
      node,
      property: "name",
      code: "loom.repository-find-deprecated",
    });
  }
}

/** The standard reads and the lifecycle verbs an aggregate's api handle
 *  already answers to — a retrieval read name may not take one. */
/** The query keys a retrieval route adds for its row window — a retrieval
 *  param may not reuse one (it would be a second value for the same key). */
const RETRIEVAL_WINDOW_PARAMS = new Set(["offset", "limit"]);

const RESERVED_READ_NAMES = new Set([
  "all",
  "byId",
  "create",
  "update",
  "delete",
  "history",
  "prepare",
]);

/** A retrieval over a repository-backed aggregate is served as
 *  `GET /<aggs>/<snake name>` under its read name (`retrievalReadName`).
 *  Refuse the two ways that route cannot exist honestly:
 *
 *  - `loom.retrieval-route-collision` (error) — the read name is already a
 *    declared find, a public operation, or a standard read/verb on the
 *    aggregate, so one route or client method would shadow the other; or a
 *    param is named like the route's `offset` / `limit` window;
 *  - `loom.retrieval-unrouted` (warning) — the aggregate's shape is one no
 *    backend serves a retrieval route for (`retrievalRouteServed`), so the
 *    read stays in-process only. */
function checkRetrievalRoute(node: Retrieval, accept: ValidationAcceptor): void {
  const ctx = AstUtils.getContainerOfType(node, isBoundedContext);
  if (!ctx) return;
  const aggName = retrievalTargetName(node);
  const agg = ctx.members.find((m): m is Aggregate => isAggregate(m) && m.name === aggName);
  if (!agg) return;
  const repos = ctx.members.filter(
    (m): m is Repository =>
      isRepository(m) && (m.aggregate?.ref === agg || m.aggregate?.$refText === agg.name),
  );
  if (repos.length === 0) return;
  const windowParam = node.params.find((p) => RETRIEVAL_WINDOW_PARAMS.has(p.name));
  if (windowParam) {
    accept(
      "error",
      diagMessage("loom.retrieval-route-collision#window-param", {
        name: node.name,
        param: windowParam.name,
      }),
      { node: windowParam, property: "name", code: "loom.retrieval-route-collision" },
    );
    return;
  }
  const readName = retrievalReadName(node.name);
  const clash = RESERVED_READ_NAMES.has(readName)
    ? "a standard read"
    : repos.some((r) => r.finds.some((f) => f.name === readName))
      ? "a declared find"
      : agg.members.some((m) => isOperation(m) && !m.private && m.name === readName)
        ? "a public operation"
        : undefined;
  if (clash) {
    accept(
      "error",
      diagMessage("loom.retrieval-route-collision", {
        name: node.name,
        readName,
        aggName,
        clash,
      }),
      { node, property: "name", code: "loom.retrieval-route-collision" },
    );
    return;
  }
  const served = retrievalRouteServed({
    eventLog: agg.persistedAs === "eventLog",
    shape: agg.shape,
    extendsBase: agg.superType !== undefined,
    abstract: agg.isAbstract === true,
  });
  if (!served) {
    const shape =
      agg.persistedAs === "eventLog"
        ? "an event-sourced"
        : agg.superType !== undefined
          ? "an inheritance-subtype"
          : agg.isAbstract
            ? "an abstract"
            : `a '${agg.shape}'-shaped`;
    accept("warning", diagMessage("loom.retrieval-unrouted", { name: node.name, aggName, shape }), {
      node,
      property: "name",
      code: "loom.retrieval-unrouted",
    });
  }
}
