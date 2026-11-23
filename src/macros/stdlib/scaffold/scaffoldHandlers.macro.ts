import { AstUtils } from "langium";
import { isPayloadDecl, type TypeAtom, type TypeRef } from "../../../language/generated/ast.js";
import { repoOpVerb } from "../../../util/repository-contract.js";
import type { BoundedContext } from "../../api/index.js";
import {
  builderCall,
  callStmt,
  canExpr,
  cloneTypeHead,
  cloneTypeRef,
  commandHandler,
  defineMacro,
  field,
  idRef,
  letStmt,
  matchStmt,
  memberAccess,
  namedType,
  nameRef,
  param,
  payload,
  primType,
  queryHandler,
  returnStmt,
} from "../../api/index.js";
import { contractRecords } from "./_contracts-shared.js";
import {
  CAN_RESULT,
  canHandlerName,
  createRequestMembers,
  type HandlerTarget,
  handlerTargets,
  ID_PARAM,
  listHandlerName,
  listReadTargets,
  permissionQueryTargets,
  targetHandlerName,
  unservedAggregateMessages,
} from "./_handlers-shared.js";

/** Emit an application-layer `commandHandler` / `queryHandler` for every
 * eligible source of every aggregate in the host context
 * (unfoldable-api-derivation.md, A3 + A3.2).
 *
 *   context Ordering with scaffoldHandlers {
 *     aggregate Order {
 *       code: string
 *       status: string
 *       create(code: string) { … }
 *       operation cancel() { … }
 *     }
 *     repository Orders for Order { find byStatus(status: string): Order[] }
 *   }
 *
 *   ↓ Ordering gains
 *
 *   queryHandler   GetOrderById(id: Order id): OrderResponse  { let o = Orders.get(id)  return o }
 *   queryHandler   ByStatusOrder(query: ByStatusOrderQuery): OrderResponse[] { let r = Orders.byStatus(query.status)  return r }
 *   commandHandler CreateOrder(cmd: CreateOrderCommand): Order id {
 *     let o = Order.create(code: cmd.code, status: cmd.status)
 *     return o.id
 *   }
 *   commandHandler CancelOrder(id: Order id) {        // cmd omitted — cancel has no params
 *     let o = Orders.get(id)
 *     o.cancel()
 *   }
 *   queryHandler   ListOrders(): Order paged { let r = Orders.all()  return r }
 *   queryHandler   canShipOrder(id: Order id): CanResult {   // `ship` has a `when`
 *     let o = Orders.get(id)
 *     return CanResult { allowed: can o.ship() }
 *   }
 *
 * A permission query answers whether an operation would run now (its gates,
 * in ladder order).  It is scaffolded for every public operation with a `when`
 * guard none of whose gates reads a parameter; `payload CanResult { allowed: bool }`
 * is spliced once per context that serves one, unless the context declares
 * its own.
 * The list handler pages every row through the aggregate's own list read (the
 * one the derived `GET /<aggs>` runs); `scaffoldApi` does not route it, since
 * that derived route still serves the list.
 *
 * Each handler now consumes the `command`/`query` contract record `_contracts-
 * shared` splices alongside it (the two derive their field sets from the same
 * source, so a handler body's `cmd.<field>` / `query.<field>` always names a
 * record field).  A single record param per handler; a path-param id stays a
 * SEPARATE handler param (a route `{id}` can't live in a body record), and
 * an empty command record (op with no params, destroy) is omitted entirely.
 * Read handlers (getById / find over the aggregate) declare a `<Agg>Response`
 * return — the wire is already that shape (transport projects the entity), so
 * the declaration only aligns with reality.
 *
 * Host-local: the handlers splice into the context's own `members[]`, so the
 * subtree-splice invariant is untouched.  Pairs with `scaffoldApi`, which emits
 * the matching `route`s from the same `handlerTargets` selection — a route can
 * never target a handler this macro didn't emit. */
export default defineMacro({
  name: "scaffoldHandlers",
  target: "context",
  late: true,
  apiVersion: 1,
  description:
    "Emits a commandHandler/queryHandler for every operation, create, find, and " +
    "get-by-id read of every aggregate in the context (load/construct via the " +
    "aggregate's repository or factory, then the op-call / find / return).",
  expand({ target, warn }) {
    const ctx = target as BoundedContext;
    for (const message of unservedAggregateMessages(ctx)) {
      warn?.("loom.scaffold-aggregate-unserved", message);
    }
    // Contract records FIRST (readable `unfold` output: the API contract, then
    // the handlers that realise it), then the handlers.  The records are
    // additive + inert in PR1 — no handler references them yet, so generation is
    // byte-identical with vs without them.
    const errors = errorNames(ctx);
    const handlers = handlerTargets(ctx).map((t) => buildHandler(t, errors));
    const lists = listReadTargets(ctx).map(({ agg, repo }) =>
      queryHandler(listHandlerName(agg), [], namedType(agg.name, { paged: true }), [
        letStmt(
          "r",
          memberAccess(nameRef(repo.name), repoOpVerb("select-many"), { call: true, args: [] }),
        ),
        returnStmt(nameRef("r")),
      ]),
    );
    const cans = permissionQueryTargets(ctx).map(({ agg, repo, op }) =>
      queryHandler(
        canHandlerName(op.name, agg.name),
        [param(ID_PARAM, idRef(agg.name))],
        namedType(CAN_RESULT),
        [
          letStmt(
            "o",
            memberAccess(nameRef(repo.name), repoOpVerb("load"), {
              call: true,
              args: [nameRef(ID_PARAM)],
            }),
          ),
          returnStmt(builderCall(CAN_RESULT, [{ name: "allowed", value: canExpr("o", op.name) }])),
        ],
      ),
    );
    const declaresCanResult = (ctx.members ?? []).some(
      (m) => isPayloadDecl(m) && m.name === CAN_RESULT,
    );
    const canRecord =
      cans.length > 0 && !declaresCanResult
        ? [payload(CAN_RESULT, [field("allowed", primType("bool"))])]
        : [];
    return [...contractRecords(ctx), ...canRecord, ...handlers, ...lists, ...cans];
  },
});

/** Build the `commandHandler` / `queryHandler` AST for one target.  Each
 * handler takes a SINGLE `command`/`query` record param (the contract record
 * `_contracts-shared` splices alongside it) and references its fields as
 * `cmd.<field>` / `query.<field>`; a path-param id rides as a separate handler
 * param, and an empty record is omitted.  The body shape otherwise mirrors the
 * hand-written handler — the same IR the equivalent explicit source lowers to. */
function buildHandler(t: HandlerTarget, errors: ReadonlySet<string>) {
  switch (t.kind) {
    case "operation": {
      const idParam = ID_PARAM;
      const opParams = t.op.params.filter((p) => p.type != null);
      // `(id: Order id[, cmd: <Op><Agg>Command])` — the id rides as a path
      // param (a route `{id}` can't live in a body record); the op's own
      // params ride in the command record.  An op with no params omits `cmd`.
      const params = [
        param(idParam, idRef(t.agg.name)),
        ...(opParams.length > 0 ? [param("cmd", namedType(`${targetHandlerName(t)}Command`))] : []),
      ];
      // `let o = <Repo>.get(<idParam>)`
      const load = letStmt(
        "o",
        memberAccess(nameRef(t.repo.name), repoOpVerb("load"), {
          call: true,
          args: [nameRef(idParam)],
        }),
      );
      const args = () => opParams.map((p) => memberAccess(nameRef("cmd"), p.name));
      const result = t.op.returnType;
      if (result && carriesError(result, errors)) {
        // An expected failure (`T or E`) is the handler's answer: the result is
        // bound and every variant returned from its own arm, so an error answers
        // its mapped status and rolls the command back, as a hand-written
        // handler of the same shape does.
        //   let r = o.<op>(cmd.<p>, …)
        //   match r { <Variant> v => { return v } … }
        const call = letStmt(
          "r",
          memberAccess(nameRef("o"), t.op.name, { call: true, args: args() }),
        );
        const arms = [result, ...result.alternatives].map((variant) => ({
          variant: cloneTypeHead(variant),
          binding: "v",
          body: [returnStmt(nameRef("v"))],
        }));
        return commandHandler(
          targetHandlerName(t),
          params,
          [load, call, matchStmt(nameRef("r"), arms)],
          { returnType: cloneTypeRef(result) },
        );
      }
      // `o.<op>(cmd.<p>, …)` — the op's args read off the command record.
      return commandHandler(targetHandlerName(t), params, [
        load,
        callStmt(["o", t.op.name], args()),
      ]);
    }
    case "create": {
      // A create handler takes the aggregate's create-INPUT fields (the same
      // shape the factory `<Agg>.create(...)` accepts and the create command
      // record exposes) as a single `cmd: <Create<Agg>>Command` body record.
      const fields = createRequestMembers(t.agg, t.create, { inherited: false }).filter(
        (f) => f.type != null,
      );
      const params =
        fields.length > 0 ? [param("cmd", namedType(`${targetHandlerName(t)}Command`))] : [];
      const body = [
        // `let o = <Agg>.create(<field>: cmd.<field>, …)` — a factory-let;
        // each argument reads off the command record.  `computeSaves`
        // persists the constructed `o` at exit.
        letStmt(
          "o",
          memberAccess(nameRef(t.agg.name), "create", {
            call: true,
            namedArgs: fields.map((f) => ({
              name: f.name,
              value: memberAccess(nameRef("cmd"), f.name),
            })),
          }),
        ),
        // `return o.id` — the new aggregate's id.
        returnStmt(memberAccess(nameRef("o"), "id")),
      ];
      // Return type `<Agg> id` (a create yields the new id, not a response).
      return commandHandler(targetHandlerName(t), params, body, { returnType: idRef(t.agg.name) });
    }
    case "getById": {
      // The canonical get-by-id read: the id rides as the `id` path param
      // (its query record is empty, so the handler omits it, as an empty
      // command record is omitted), then load + return the aggregate as
      // `<Agg>Response`.
      const params = [param(ID_PARAM, idRef(t.agg.name))];
      const body = [
        letStmt(
          "o",
          memberAccess(nameRef(t.repo.name), repoOpVerb("load"), {
            call: true,
            args: [nameRef(ID_PARAM)],
          }),
        ),
        returnStmt(nameRef("o")),
      ];
      // Return type is the aggregate's response record.
      return queryHandler(targetHandlerName(t), params, namedType(`${t.agg.name}Response`), body);
    }
    case "destroy": {
      // The canonical hard-delete: load one aggregate by id, then remove it.
      // `<Repo>.remove(o)` lowers to a first-class `repo-delete` handler
      // statement (every domain-logic backend renders it to its own repository
      // delete verb).  A void commandHandler — there is nothing meaningful to
      // return after a delete (the entity is gone; `return o.id` would read a
      // just-removed row), so the handler yields no value, exactly like a
      // fire-and-forget `operation` commandHandler.
      const idParam = ID_PARAM;
      const params = [param(idParam, idRef(t.agg.name))];
      const body = [
        // `let o = <Repo>.get(<idParam>)`
        letStmt(
          "o",
          memberAccess(nameRef(t.repo.name), repoOpVerb("load"), {
            call: true,
            args: [nameRef(idParam)],
          }),
        ),
        // `<Repo>.remove(o)` — a repo-delete statement.
        callStmt([t.repo.name, repoOpVerb("remove")], [nameRef("o")]),
      ];
      return commandHandler(targetHandlerName(t), params, body);
    }
  }
}

/** The names of the `error` records the model declares — the variants that
 * make an operation's union result an expected failure.  Read by name: a macro
 * expands before linking, so the result's references are still unresolved. */
function errorNames(ctx: BoundedContext): Set<string> {
  const out = new Set<string>();
  for (const n of AstUtils.streamAllContents(AstUtils.findRootNode(ctx))) {
    if (isPayloadDecl(n) && n.kind === "error") out.add(n.name);
  }
  return out;
}

/** Whether a union result names an `error` variant. */
function carriesError(result: TypeRef, errors: ReadonlySet<string>): boolean {
  if (result.alternatives.length === 0) return false;
  return [result, ...result.alternatives].some((v: TypeRef | TypeAtom) => {
    const b = v.base as { $type: string; target?: { $refText: string } };
    return b.$type === "NamedType" && !!b.target && errors.has(b.target.$refText);
  });
}
