import { isProperty, isRepository, type Statement } from "../../../language/generated/ast.js";
import { FIND_ABSENT_DETAIL, repoOpVerb } from "../../../util/repository-contract.js";
import type { Aggregate, BoundedContext, Expression, TypeRef } from "../../api/index.js";
import {
  callExpr,
  cloneExpr,
  cloneTypeRef,
  defineMacro,
  ifLetStmt,
  letStmt,
  memberAccess,
  namedType,
  nameRef,
  notFoundStmt,
  param,
  queryHandler,
  requiresStmt,
  returnStmt,
  targetFields,
} from "../../api/index.js";
import { getHandlerName, getReadSource } from "./_get-shared.js";
import { policyReadGate } from "./_policy-inline.js";

/** Expose a single-row read on the wire — the twin of `scaffoldPaged` for one
 *  row.  The read is a `criterion` (its first match) or a declared `unique (…)`
 *  key of an aggregate:
 *
 *   context Shop with scaffoldGet(of: ByCode) { … }                 // a criterion
 *   context Shop with scaffoldGet(of: Order, key: "code") { … }     // a unique key
 *   context Shop with scaffoldGet(of: ByCode, requires: Clerks) { … }
 *
 *   ↓ Shop gains
 *
 *   queryHandler GetOrderByCode(code: string): Order {
 *     requires Clerks()
 *     if let x = Orders.find(ByCode(code)) {
 *       return x
 *     } else {
 *       notFound "not_found"
 *     }
 *   }
 *
 *   // the key form reads the key itself — `getBy` answers the 404 on a miss:
 *   queryHandler GetOrderByCode(code: string): Order {
 *     let x = Orders.getBy(code: code)
 *     return x
 *   }
 *
 *  The handler returns the aggregate's wire shape and a miss answers 404, which
 *  is what a declared repository `find` route answered; the context's read gate
 *  (`policy { read Order requires … }`) is spliced ahead of the read, as the
 *  find's route enforced it.  `scaffoldGetApi` mounts
 *  it on the URL that find had (`GET /orders/by_code?code=…`), so a client of
 *  the find keeps its URL.  The read's params (the key's columns) become the
 *  handler's params, each typed as declared.  `requires:` names a parameterless
 *  function-form `policy`, spliced as the first body statement — the
 *  `scaffoldPaged(requires:)` rule. */
export default defineMacro({
  name: "scaffoldGet",
  target: "context",
  apiVersion: 1,
  description:
    "Exposes a single-row read — a criterion's first match, or a unique key's row — as a " +
    "queryHandler answering the aggregate or 404; `requires: <Policy>` gates it.",
  params: {
    of: { kind: "ref", of: ["Criterion", "Aggregate"] },
    key: { kind: "string", default: "" },
    requires: { kind: "ref", of: "Policy", optional: true },
  },
  expand({ target, args }) {
    const ctx = target as BoundedContext;
    const src = getReadSource(args.of, args.key, "scaffoldGet");
    // The repository that reads the row — the one whose aggregate ref matches
    // the read's target.  No repo → nothing to read through, so the macro emits
    // nothing (mirrors `scaffoldGetApi`, whose route then names no handler).
    const repo = (ctx.members ?? [])
      .filter(isRepository)
      .find((r) => r.aggregate?.$refText === src.aggName);
    if (!repo) return [];
    // An event-log or document aggregate has no generated single-row query
    // read for a handler body on every backend; refuse it rather than emit a
    // handler that cannot run.
    const agg = (ctx.members ?? []).find(
      (m): m is Aggregate => m.$type === "Aggregate" && m.name === src.aggName,
    );
    if (agg && (agg.persistedAs === "eventLog" || agg.shape === "document")) {
      throw new Error(
        `scaffoldGet: '${src.aggName}' is ${agg.persistedAs === "eventLog" ? "persistedAs: eventLog" : "shape: document"}, ` +
          "and a handler's single-row read over it is not generated on every backend yet — keep its declared find",
      );
    }
    const policy = args.requires as { name?: string; params?: readonly unknown[] } | undefined;
    if (policy && (policy.params?.length ?? 0) > 0) {
      throw new Error(
        `requires: policy '${policy.name}' takes ${policy.params?.length} parameter(s); ` +
          "scaffoldGet can only call a parameterless policy — wrap it in one " +
          "(`policy Gate(): bool = " +
          `${policy.name}(...)\`)`,
      );
    }
    // The aggregate's read gate (`policy { read <Agg> requires … }`) first —
    // the gate a declared find's route enforced, which a handler does not
    // inherit — then the macro's own `requires:`.
    const readGate = policyReadGate(ctx, src.aggName);
    const gate = [
      ...(readGate ? [requiresStmt(cloneExpr(readGate))] : []),
      ...(policy?.name ? [requiresStmt(callExpr(policy.name, []))] : []),
    ];

    let params: ReturnType<typeof param>[];
    let read: Statement[];
    if (src.kind === "criterion") {
      // The criterion's declared params → the handler's, cloned through the
      // factories so a `Money` / `X id` type keeps its resolved type.
      const critParams = src.criterion.params.filter((p) => p.type != null);
      params = critParams.map((p) => param(p.name, cloneTypeRef(p.type as TypeRef)));
      const lookup = memberAccess(nameRef(repo.name), repoOpVerb("select-one", "criterion"), {
        call: true,
        args: [
          callExpr(
            src.criterion.name,
            critParams.map((p) => ({ value: nameRef(p.name) as Expression })),
          ),
        ],
      });
      // The miss answers the find-absence token (RS-27), the `detail` the
      // declared find's route answered — and the key form's `getBy` answers.
      read = [
        ifLetStmt("x", lookup, [returnStmt(nameRef("x"))], [notFoundStmt(FIND_ABSENT_DETAIL)]),
      ];
    } else {
      const fields = new Map(targetFields(src.aggregate).map((f) => [f.name, f]));
      params = src.columns.map((c) => {
        const f = fields.get(c);
        if (!f || !isProperty(f))
          throw new Error(
            `scaffoldGet(of: ${src.aggName}, key: …): '${c}' is not a field of '${src.aggName}'`,
          );
        return param(c, cloneTypeRef(f.type));
      });
      read = [
        letStmt(
          "x",
          memberAccess(nameRef(repo.name), repoOpVerb("load-by-key", "key"), {
            call: true,
            args: src.columns.map((c) => ({ name: c, value: nameRef(c) })),
          }),
        ),
        returnStmt(nameRef("x")),
      ];
    }
    return [queryHandler(getHandlerName(src), params, namedType(src.aggName), [...gate, ...read])];
  },
});
