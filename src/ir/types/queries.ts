// The `*UsesCurrentUser` helpers below traverse the IR via the one shared,
// exhaustive child-walker (`src/ir/util/walk.ts`).  This is a value import from
// `ir/types` → `ir/util`; the reverse edge (walk.ts → loom-ir.ts) is `import
// type` only (erased at emit), so no runtime cycle forms.
import type { RepoOp } from "../../util/repository-contract.js";
import {
  walkExprDeep,
  walkStmtExprsDeep,
  walkWorkflowStmtExprsDeep,
  walkWorkflowStmtsDeep,
} from "../util/walk.js";
import {
  bodyWriteScopeGuards,
  type WriteScopeHost,
  writeScopeContext,
} from "../util/write-scope-guards.js";
import type { AggregateIR } from "./aggregate.js";
import type { BoundedContextIR, FindIR, ValueObjectIR } from "./context.js";
import { type ExprIR, lit } from "./expr.js";
import type { EntityPartIR, FunctionBodyIR, OperationIR, ParamIR } from "./members.js";
import type { LoomModel } from "./model.js";
import type { ProjectionIR } from "./projection.js";
import type { StmtIR } from "./stmt.js";
import type { TypeIR } from "./types.js";
import type { StateFieldIR, UiIR } from "./ui.js";
import type { CommandHandlerIR, WorkflowIR } from "./workflow.js";
import type { WorkflowStmtIR } from "./workflow-stmt.js";

// ---------------------------------------------------------------------------
// Workspace traversal helpers — dedupe the systems-vs-contexts dual
// iteration that every consumer (validator, system orchestrator,
// wire-spec emitter) had to spell out.  A `LoomModel` carries
// bounded contexts in two places: under each system's modules, and
// at the top level (legacy single-deployable mode).  These helpers
// flatten both into a single iterator.
// ---------------------------------------------------------------------------

/** Every bounded context in the model — system-bundled + top-level. */
export function allContexts(loom: LoomModel): BoundedContextIR[] {
  const out: BoundedContextIR[] = [];
  for (const sys of loom.systems) {
    for (const m of sys.subdomains) out.push(...m.contexts);
  }
  out.push(...loom.contexts);
  return out;
}

/** Every aggregate in the model, regardless of which context owns it. */
export function allAggregates(loom: LoomModel): AggregateIR[] {
  return allContexts(loom).flatMap((c) => c.aggregates);
}

// ---------------------------------------------------------------------------
// `currentUser` reference detection.
//
// Every per-platform emitter needs to know "does this operation /
// workflow body actually reference the `currentUser` magic
// identifier?" so it can:
//   - thread a `User` parameter into the generated method signature,
//   - inject the request-scoped user accessor into the Mediator
//     handler / Hono route,
//   - decide whether to import the auth types at all.
// One IR-level helper avoids duplicating the walker on each backend.
// ---------------------------------------------------------------------------

/** True when the expression tree contains at least one `current-user`
 *  ref (either bare `currentUser` or a member-access rooted in it). */
export function exprUsesCurrentUser(e: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(e, (node) => {
    if (node.kind === "ref" && node.refKind === "current-user") found = true;
  });
  return found;
}

/** True when the operation's body — preconditions, assignments,
 *  emits, calls — references `currentUser` anywhere. */
export function operationUsesCurrentUser(op: OperationIR): boolean {
  return op.statements.some(stmtUsesCurrentUser);
}

/** True when the operation has at least one `requires` guard.  A guarded
 *  op denies with HTTP 403 at runtime (ForbiddenError/Exception/
 *  `:forbidden`), so every backend declares a 403 ProblemDetails response
 *  for it in the generated OpenAPI. */
export function operationIsGuarded(op: OperationIR): boolean {
  return op.statements.some((s) => s.kind === "requires");
}

/** True when the workflow has at least one `requires` guard — same 403
 *  contract as a guarded operation. */
export function workflowIsGuarded(wf: WorkflowIR): boolean {
  return wf.statements.some((s) => s.kind === "requires");
}

/** True when the workflow's command route can answer the DOMAIN NOT-FOUND rung
 *  — i.e. its body performs a repository read that THROWS when the row is
 *  absent, so the route really sends that status and must declare it.
 *
 *  WHY A PREDICATE AND NOT A KIND.  `errorStatuses` publishes the not-found
 *  rung per `OpErrorKind`, which works because for `getById` / `destroy` /
 *  `operation` the rung follows from the ROUTE SHAPE: the path carries an
 *  `{id}`, the handler loads it, an absent row is a 404 unconditionally.  A
 *  workflow command route has no path id — the rung follows from what the BODY
 *  does, and a workflow that touches no repository genuinely cannot send it.
 *  Declaring 404 on every workflow would be as wrong in the other direction
 *  (schemathesis' `status_code_conformance` reads an undeclared status and an
 *  unreachable declared one with equal suspicion), so the shape the honest
 *  contract needs is this predicate, threaded into the table.
 *
 *  WHAT THROWS.  Three producers, and only three:
 *
 *  1. A `repo-let` over a read that must find its row (`let w =
 *     Wallets.get(id)`, `getBy(…)`, a declared non-optional find
 *     `let w = Wallets.byRef(r)`): the emitted repository method has no way
 *     to report an empty result except by throwing.  A `repo-let` over an
 *     optional read (`findById`, `find(<Criterion>)`, `findBy`, a `T?` find)
 *     binds the absence instead.
 *  2. A NAMED read inside an expression — the `reading` domain-service tier
 *     (`domain-services.md`), whose read port is threaded from this very
 *     workflow.  Here optionality is NOT validator-constrained (the canonical
 *     example compares the result to `null`), so the find's declared return
 *     type decides: an optional or collection return answers with a value, a
 *     non-optional one throws.
 *
 *     This arm is a FORWARD GUARD, not a currently-reachable path, and saying
 *     so is the point: the reading tier's per-backend emission is still a later
 *     slice (`ExprIR.repoRead` carries "Per-backend EMISSION is a later slice"
 *     for the same reason), and today a `reading` service body emits a call
 *     against a read-port handle that was never threaded.  When that lands, the
 *     rung follows the read into it without anyone having to rediscover this
 *     function — which is cheaper than the arm is dead-weight.
 *
 *  3. A `notFound` statement — the body answering the rung explicitly (the
 *     `else` of an `if let` over a criterion read).
 *  4. A write-scope re-check (`ir/util/write-scope-guards.ts`): a body that
 *     mutates or deletes a row it holds, in `host`'s context where that
 *     aggregate's write scope is narrowed, re-loads it through the write-scope
 *     load, which answers 404 for a row outside the caller's scope.
 *
 *  Everything else that reads is absence-shaped and cannot throw: `repo-run` /
 *  `findAll` return arrays, `if-let` exists precisely to handle the empty case,
 *  and a criterion `find` read renders as `[0] ?? null`. */
export function workflowCanAnswerNotFound(wf: WorkflowIR, host?: WriteScopeHost): boolean {
  /** A repository read throws on an absent row when it is a must-exist read
   *  (`getById` / `getBy`).  An unknown method is not evidence that it
   *  throws — it is a phase-⑦ error (`loom.workflow-unknown-repository-method`). */
  const readThrows = (op: RepoOp): boolean => op === "load" || op === "load-by-key";

  let canNotFound = false;
  for (const top of wf.statements) {
    // Producer 1 — the statement form.  Deep, so a read inside a `for-each`
    // body or an `if-let` branch counts; a hand-rolled recursion here is the
    // drifting copy `ir/util/walk.ts` exists to prevent.
    walkWorkflowStmtsDeep(top, (s) => {
      if ((s.kind === "repo-let" && s.returnType.kind !== "optional") || s.kind === "not-found")
        canNotFound = true;
    });
    // Producer 2 — the expression form (a `reading` domain service's own
    // repository read).  `walkWorkflowStmtExprsDeep` already descends through
    // the nested bodies, so one pass per top-level statement is the whole body.
    walkWorkflowStmtExprsDeep(top, (e) => {
      if (e.kind !== "call" || e.callKind !== "repo-read") return;
      const read = e.repoRead;
      if (!read) return;
      if (readThrows(read.op)) canNotFound = true;
    });
  }
  // Producer 4 — the write-scope re-check.
  if (!canNotFound && host) {
    canNotFound =
      bodyWriteScopeGuards(wf.statements, writeScopeContext(wf.statements, host)).length > 0;
  }
  return canNotFound;
}

/** True when the workflow exposes an HTTP/UI command surface — its facade
 *  (the primary unnamed `create`, else the first create) is
 *  command-triggered.  A workflow whose only `create` is event-triggered
 *  (`create(e: Event)`) — a reactor / saga started by an event, never an
 *  inbound call — has no command surface: its bodies run via the
 *  in-process dispatcher's handlers, so emitting a Request/Command/route
 *  with an event-typed param would be bogus (and wouldn't compile).
 *  Shared by every backend's command-surface emitters (channels.md). */
export function workflowEmitsCommandRoute(wf: WorkflowIR): boolean {
  const creates = wf.creates ?? [];
  const facade = creates.find((c) => c.name === null && c.triggerKind === "command") ?? creates[0];
  return !facade || facade.triggerKind === "command";
}

/** True when any of the workflow's statements (or a sub-expression
 *  inside one) references `currentUser`.  When true, a backend's
 *  workflow handler must materialise a `currentUser` binding (from the
 *  request-scoped auth actor) before the rendered guard/expr — which
 *  emits the bare token `currentUser` — can resolve.  Shared by the
 *  Hono and .NET workflow emitters. */
export function workflowUsesCurrentUser(wf: Pick<WorkflowIR, "statements">): boolean {
  return wf.statements.some(workflowStmtUsesCurrentUser);
}

/** True when a `commandHandler` / `queryHandler` body reads `currentUser` — in
 *  a statement (a `requires` gate: `scaffoldGet` splices the aggregate's read
 *  gate in) or in its `return` expression.  Every backend's routed-handler
 *  emitter binds the principal exactly when this holds, so a handler that
 *  never reads it emits unchanged.  An extern handler has no body. */
export function handlerUsesCurrentUser(
  h: Pick<CommandHandlerIR, "statements" | "returnValue" | "extern">,
): boolean {
  return !h.extern && (workflowUsesCurrentUser(h) || exprUsesCurrentUser(h.returnValue));
}

function workflowStmtUsesCurrentUser(s: WorkflowStmtIR): boolean {
  let found = false;
  walkWorkflowStmtExprsDeep(s, (node) => {
    if (node.kind === "ref" && node.refKind === "current-user") found = true;
  });
  return found;
}

/** True when the find's `where` filter references `currentUser`.
 *  Such finds gain a `currentUser: User` parameter on the generated
 *  repository method, threaded through CQRS handler / Hono route call
 *  sites. */
export function findUsesCurrentUser(find: FindIR): boolean {
  return exprUsesCurrentUser(find.filter);
}

/** True when the find's `requires` authorization gate references
 *  `currentUser`.  The route handler must then read the request principal
 *  into scope before evaluating the gate. */
export function findGateUsesCurrentUser(find: FindIR): boolean {
  return exprUsesCurrentUser(find.requires);
}

/** True when a query-time projection's `where` filter or `select` expressions
 *  reference `currentUser`.
 *  Drives threading the request principal into the synthesised repo read. */
export function queryProjectionUsesCurrentUser(proj: ProjectionIR): boolean {
  if (exprUsesCurrentUser(proj.query?.filter)) return true;
  for (const s of proj.query?.selects ?? []) {
    if (exprUsesCurrentUser(s.expr)) return true;
  }
  return false;
}

/** True when the aggregate carries a *principal-referencing* capability
 *  `filter` — one whose predicate reads `currentUser` (e.g. a tenancy filter
 *  `filter this.tenantId == currentUser.tenantId`).  Such a filter is AND-ed
 *  into EVERY root read, so — unlike a per-find `currentUser` use — it forces
 *  the `currentUser: User` parameter onto *all* of the aggregate's repository
 *  read methods (findById / findAll / each find), threaded from the route's
 *  `c.get("currentUser")`.  (DEBT-01; the Hono/Drizzle analogue of EF Core's
 *  closure-captured `HasQueryFilter`.) */
export function aggregateUsesPrincipalContextFilter(agg: { contextFilters?: ExprIR[] }): boolean {
  return (agg.contextFilters ?? []).some(exprUsesCurrentUser);
}

export function stmtUsesCurrentUser(s: StmtIR): boolean {
  let found = false;
  walkStmtExprsDeep(s, (node) => {
    if (node.kind === "ref" && node.refKind === "current-user") found = true;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Money usage detection
//
// Backends gate runtime-dep inclusion (decimal.js / rust_decimal / etc.)
// and per-file import lines on whether the IR actually carries any
// money-typed values.  Walk every type and every literal so an
// aggregate that uses money via, say, a derived expression or an
// operation parameter is detected even if no field is typed as money.
// ---------------------------------------------------------------------------

/** True when the type tree contains a `primitive money` anywhere. */
export function typeUsesMoney(t: TypeIR | undefined): boolean {
  if (!t) return false;
  if (t.kind === "primitive") return t.name === "money";
  if (t.kind === "array") return typeUsesMoney(t.element);
  if (t.kind === "optional") return typeUsesMoney(t.inner);
  return false;
}

/** True when the expression tree contains a money literal or a binary
 *  node whose stashed type info is money.  Used to catch money
 *  appearing in derived/invariant expressions without an explicit
 *  field. */
export function exprUsesMoney(e: ExprIR | undefined): boolean {
  if (!e) return false;
  // Exhaustive and `never`-checked: this layer cannot import `ir/util/walk.ts`
  // (it imports these types), so the child enumeration lives here, slot for
  // slot with `walkExprChildren`.
  switch (e.kind) {
    case "literal":
      return e.lit === "money";
    case "this":
    case "id":
    case "ref":
    case "action-ref":
    case "modelText":
    case "authz-filter":
      return false;
    case "binary":
      if (typeUsesMoney(e.leftType) || typeUsesMoney(e.resultType)) return true;
      return exprUsesMoney(e.left) || exprUsesMoney(e.right);
    case "member":
      return exprUsesMoney(e.receiver);
    case "method-call":
      return exprUsesMoney(e.receiver) || e.args.some(exprUsesMoney);
    case "call":
      return (
        e.args.some(exprUsesMoney) || (e.style?.entries ?? []).some((s) => exprUsesMoney(s.value))
      );
    case "ternary":
      return exprUsesMoney(e.cond) || exprUsesMoney(e.then) || exprUsesMoney(e.otherwise);
    case "unary":
      return exprUsesMoney(e.operand);
    case "paren":
      return exprUsesMoney(e.inner);
    case "lambda":
      return exprUsesMoney(e.body) || (e.block ?? []).some(stmtUsesMoney);
    case "new":
    case "object":
      return e.fields.some((f) => exprUsesMoney(f.value));
    case "list":
      return e.elements.some(exprUsesMoney);
    case "convert":
      return e.target === "money" || exprUsesMoney(e.value);
    case "duration":
      return exprUsesMoney(e.amount);
    case "i18nFormat":
      return exprUsesMoney(e.inner);
    case "match":
      return (
        exprUsesMoney(e.subject) ||
        e.arms.some((a) => exprUsesMoney(a.cond) || exprUsesMoney(a.value)) ||
        e.variantArms.some((a) => exprUsesMoney(a.value)) ||
        exprUsesMoney(e.otherwise)
      );
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

function stmtUsesMoney(s: StmtIR): boolean {
  switch (s.kind) {
    case "precondition":
    case "requires":
    case "let":
    case "expression":
      return exprUsesMoney(s.expr);
    case "assign":
    case "add":
    case "remove":
    case "return":
      return exprUsesMoney(s.value);
    case "emit":
      return s.fields.some((f) => exprUsesMoney(f.value));
    case "call":
      return s.args.some(exprUsesMoney);
    case "variant-match":
      return (
        exprUsesMoney(s.subject) ||
        s.arms.some((a) => a.body.some(stmtUsesMoney)) ||
        (s.elseBody ?? []).some(stmtUsesMoney)
      );
    case "if":
      return (
        exprUsesMoney(s.cond) ||
        s.thenBody.some(stmtUsesMoney) ||
        (s.elseBody ?? []).some(stmtUsesMoney)
      );
    default: {
      // Wave 2 packet 2.3 — the switch above already lists every `StmtIR`
      // kind; this arm turns that into a compile-time guarantee (a future
      // kind fails `tsc` here, not silently under-reports money usage).
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

/** True when a function's body (expression or block form) touches money. */
export function functionBodyUsesMoney(body: FunctionBodyIR): boolean {
  return "expr" in body ? exprUsesMoney(body.expr) : body.stmts.some(stmtUsesMoney);
}

function partUsesMoney(p: EntityPartIR): boolean {
  if (p.fields.some((f) => typeUsesMoney(f.type))) return true;
  if (p.derived.some((d) => typeUsesMoney(d.type) || exprUsesMoney(d.expr))) return true;
  if (p.invariants.some((iv) => exprUsesMoney(iv.expr))) return true;
  if (p.functions.some((fn) => typeUsesMoney(fn.returnType) || functionBodyUsesMoney(fn.body)))
    return true;
  return false;
}

/** True when the aggregate touches money anywhere — fields, derived,
 *  invariants, operations, functions, or nested parts. */
export function aggregateUsesMoney(a: AggregateIR): boolean {
  if (a.fields.some((f) => typeUsesMoney(f.type))) return true;
  if (a.derived.some((d) => typeUsesMoney(d.type) || exprUsesMoney(d.expr))) return true;
  if (a.invariants.some((iv) => exprUsesMoney(iv.expr))) return true;
  if (
    a.operations.some(
      (op) => op.params.some((p) => typeUsesMoney(p.type)) || op.statements.some(stmtUsesMoney),
    )
  )
    return true;
  if (a.functions.some((fn) => typeUsesMoney(fn.returnType) || functionBodyUsesMoney(fn.body)))
    return true;
  if (a.parts.some(partUsesMoney)) return true;
  return false;
}

/** The value-object name a field type resolves to, unwrapping
 *  array/optional envelopes — undefined for non-VO types. */
function typeVoName(t: TypeIR): string | undefined {
  if (t.kind === "valueobject") return t.name;
  if (t.kind === "array") return typeVoName(t.element);
  if (t.kind === "optional") return typeVoName(t.inner);
  return undefined;
}

/** {@link aggregateUsesMoney}, additionally resolving VO-TYPED FIELDS
 *  through the context's value-object registry: `typeUsesMoney` sees only
 *  the name ref on a `listing: Listing` field, so money nested inside the
 *  VO (`Listing { price: money }`) is invisible to the shallow check —
 *  which left every emitter keying its `Decimal`/`moneySchema` import on
 *  it with an unresolved reference (latent compile break on the
 *  money-inside-VO shape).  Recurses through VO-in-VO nesting; cycle-safe. */
export function aggregateUsesMoneyDeep(
  a: AggregateIR,
  valueObjects: readonly ValueObjectIR[],
): boolean {
  if (aggregateUsesMoney(a)) return true;
  const byName = new Map(valueObjects.map((v) => [v.name, v]));
  const seen = new Set<string>();
  const voUsesMoneyDeep = (name: string): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    const vo = byName.get(name);
    if (!vo) return false;
    if (valueObjectUsesMoney(vo)) return true;
    return vo.fields.some((f) => {
      const n = typeVoName(f.type);
      return n ? voUsesMoneyDeep(n) : false;
    });
  };
  const fieldTypes = [...a.fields, ...a.parts.flatMap((p) => p.fields)].map((f) => f.type);
  return fieldTypes.some((t) => {
    const n = typeVoName(t);
    return n ? voUsesMoneyDeep(n) : false;
  });
}

/** True when the value object's wire shape carries any money field. */
export function valueObjectUsesMoney(vo: ValueObjectIR): boolean {
  if (vo.fields.some((f) => typeUsesMoney(f.type))) return true;
  if (vo.derived.some((d) => typeUsesMoney(d.type) || exprUsesMoney(d.expr))) return true;
  if (vo.invariants.some((iv) => exprUsesMoney(iv.expr))) return true;
  if (vo.functions.some((fn) => typeUsesMoney(fn.returnType) || functionBodyUsesMoney(fn.body)))
    return true;
  return false;
}

/** True when the bounded context contains any money usage across
 *  aggregates / value objects.  Backends consume this when deciding
 *  whether to inject a runtime decimal-library dep at the package /
 *  project level (e.g. `decimal.js` for TS, `rust_decimal` for the
 *  future Rust backend). */
export function contextUsesMoney(ctx: BoundedContextIR): boolean {
  if (ctx.aggregates.some(aggregateUsesMoney)) return true;
  if (ctx.valueObjects.some(valueObjectUsesMoney)) return true;
  // Aggregates and value objects were the whole test, and they are not the
  // whole surface a `money` type reaches.  An EVENT field, a PROJECTION state
  // column, a WORKFLOW state field or a PAYLOAD/handler record can each be the
  // only money in a system — and each is emitted as a `Decimal` on the TS
  // backends.  With no money-bearing aggregate the flag read false, so
  // `domain/events.ts` shipped `import Decimal from "decimal.js"` while
  // `package.json` omitted the dependency: TS2307, a generated project that
  // does not install-and-compile.  (Reproduced with an event carrying
  // `amount: money` and a projection folding it, then `npm install && tsc`.)
  if (ctx.events.some((e) => e.fields.some((f) => typeUsesMoney(f.type)))) return true;
  if (ctx.projections.some((p) => p.stateFields.some((f) => typeUsesMoney(f.type)))) return true;
  if (ctx.workflows.some((w) => (w.stateFields ?? []).some((f) => typeUsesMoney(f.type))))
    return true;
  if (ctx.payloads.some((p) => p.fields.some((f) => typeUsesMoney(f.type)))) return true;
  return false;
}
/** True when the ui declares a money-typed `state {}` field on any page
 *  or component.  Such a field renders as `<Decimal>` + `new
 *  Decimal("0")` in the page shell, so the generated project needs the
 *  `decimal.js` runtime dep even when no aggregate / wire shape carries
 *  money (`contextUsesMoney` covers that case).  Frontend generators OR
 *  this into their package.json money-dep flag. */
export function uiUsesMoney(ui: UiIR): boolean {
  const stateHasMoney = (state: readonly StateFieldIR[]) =>
    state.some((f) => typeUsesMoney(f.type));
  if (ui.pages.some((p) => stateHasMoney(p.state))) return true;
  if (ui.components.some((c) => stateHasMoney(c.state))) return true;
  // A DECLARED money param is the other producer of a `Decimal` binding in a
  // generated frontend file, and it only became one in wave C2: before the
  // shared prop layer learned to spell `money`, `component PriceTag(amount:
  // money)` was refused outright by phase (7).  Now it emits `amount: Decimal`
  // — so the same detect-once conditional-dep gate has to see it, or the file
  // imports decimal.js and package.json never declares it.  Extern-function
  // signatures produce the identical binding for the identical reason.
  const paramsHaveMoney = (params: readonly ParamIR[]) => params.some((p) => typeUsesMoney(p.type));
  if (ui.components.some((c) => paramsHaveMoney(c.params))) return true;
  if (
    (ui.functions ?? []).some((fn) => paramsHaveMoney(fn.params) || typeUsesMoney(fn.returnType))
  ) {
    return true;
  }
  return false;
}
