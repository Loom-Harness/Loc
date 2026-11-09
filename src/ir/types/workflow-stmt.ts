import type { RepoOp } from "../../util/repository-contract.js";
import type { BypassReadIR, KeyLookupIR, LoadPlanIR, SortTermIR } from "./context.js";
import type { ExprIR } from "./expr.js";
import type { MessageIR } from "./members.js";
import type { OriginRef } from "./origin.js";
import type { PathIR } from "./stmt.js";
import type { TypeIR } from "./types.js";

/** What an `if let` source does: one of the optional repository reads, or
 *  `bound` — narrowing an optional binding already in scope (no read). */
export type IfLetOp =
  | Extract<RepoOp, "select-one" | "load-by-key-optional" | "load-optional">
  | "bound";

/** The local a mutating call statement binds its value to
 *  (`let r = a.withdraw(x)` / `let r = Transfer.run(…)`).
 *
 *  `errorVariants` lists the wire tags of the result union's `error` variants
 *  (empty when the result has none).  When it is non-empty the call's
 *  mutations are TENTATIVE (D-FAILURE-MODEL: an operation that answers its
 *  error leaves no trace): the body must `match` the result, and the
 *  aggregates the call mutates are saved at the end of each arm that is not an
 *  error variant — never at the body's exit, and never in an error arm.  Like
 *  a `match` arm's `isError`, error-ness is resolved where the error
 *  declarations are in scope (lowering), so it is carried here. */
export interface CallResultBindingIR {
  name: string;
  type: TypeIR;
  errorVariants: string[];
}

export type WorkflowStmtIR =
  | { kind: "precondition"; expr: ExprIR; source: string; message?: MessageIR; origin?: OriginRef }
  | {
      kind: "requires";
      expr: ExprIR;
      source: string;
      /** Set on the gate enrichment prepends to a handler that reads this
       *  aggregate (`policy { read X requires … }`, `applyHandlerReadGates`).
       *  It authorizes the READ only, so `validateDefaultDeny` does not count
       *  it as the handler's own exposure gate. */
      readGateOf?: string;
      origin?: OriginRef;
    }
  | {
      kind: "emit";
      eventName: string;
      fields: { name: string; value: ExprIR }[];
      origin?: OriginRef;
    }
  | {
      kind: "factory-let";
      name: string;
      aggName: string;
      fields: { name: string; value: ExprIR }[];
      origin?: OriginRef;
    }
  | {
      kind: "repo-let";
      name: string;
      repoName: string;
      aggName: string;
      /** What the call does (`util/repository-contract.ts`).  Emitters
       *  dispatch on it; `method` is kept for a declared find's own name and
       *  a natural-key read's method (`findBySku`). */
      op: RepoOp;
      method: string;
      args: ExprIR[];
      returnType: TypeIR;
      /** A natural-key read (`load-by-key` / `load-by-key-optional`): the
       *  tuple `args` follow and the `ignoring` stance.  Enrichment
       *  synthesises the repository method `method` names from it. */
      key?: KeyLookupIR;
      /** A criterion read (`op: "select-one"`, `let c = Repo.find(<Criterion>)`):
       *  the shared synthetic retrieval (`findAllBy<Criterion>`) it runs with
       *  limit 1, and the criterion enrichment materialises it from.  `args`
       *  carry the criterion's arguments.  Absent for every other op. */
      retrievalName?: string;
      synthCriterion?: { name: string };
      /** A widened single-row read (`let c = Repo.find(<Criterion>) ignoring …`
       *  / `let o = Repo.find(id) ignoring …`): the source and stance of the
       *  method `method` names, which enrichment synthesises
       *  (`synthesizeBypassReadFinds`).  `retrievalName` is then absent — the
       *  read runs its own method, not the shared retrieval — and a backend
       *  calls `method` the way it calls an `if let`'s `findMethod`. */
      bypassRead?: BypassReadIR;
      origin?: OriginRef;
    }
  | {
      kind: "expr-let";
      name: string;
      type: TypeIR;
      expr: ExprIR;
      origin?: OriginRef;
    }
  | {
      // `let xs = Repo.all(<Retrieval>(args), page?)` — bind the named
      // query bundle's result array (retrieval.md).  Distinct from
      // `repo-let` (which forbids array returns): a `repo-run` is always
      // an aggregate array, consumable only by a `for-each` loop.
      kind: "repo-run";
      name: string;
      repoName: string;
      aggName: string;
      /** Always `select-many`: a run binds the matching rows. */
      op: Extract<RepoOp, "select-many">;
      retrievalName: string;
      retrievalArgs: ExprIR[];
      page?: { offset?: ExprIR; limit?: ExprIR };
      /** Set when this `repo-run` was lowered from `Repo.all(<Criterion>)`
       *  (criterion.md, use site 3) rather than `Repo.all(<Retrieval>)`.  The
       *  enrich pass synthesises a `RetrievalIR` named `retrievalName` (=
       *  `findAllBy<Criterion>`) from `ctx.criteria[name]` so the call rides
       *  the existing retrieval pipeline on every backend.  `name` is the
       *  referenced criterion. */
      synthCriterion?: { name: string };
      /** `sort:` / `loads:` shaping carried from an anonymous retrieval
       *  (`Repo.run(retrieval { where: <Criterion> sort: […] loads: […] })`,
       *  criterion.md use site 3).  Only set alongside `synthCriterion`; the
       *  enrich pass attaches them to the synthesised retrieval so the existing
       *  retrieval emitters apply `.orderBy(...)` + the load shape on every
       *  backend.  `retrievalName` carries a content hash of the shaping, so
       *  distinct shapes over one criterion get distinct retrievals. */
      synthSort?: SortTermIR[];
      synthLoadPlan?: LoadPlanIR;
      /** `ignoring *` on the inline `Repo.all(...)` read —
       *  bypass EVERY capability query-filter on the aggregate (named-filter-
       *  bypass.md §11).  Mutually exclusive with `bypassCaps`.  See
       *  `FindIR.bypassAll`. */
      bypassAll?: boolean;
      /** `ignoring A, B` on the inline read — resolved capability names whose
       *  filters this read bypasses (named-filter-bypass.md §11).  See
       *  `FindIR.bypassCaps`. */
      bypassCaps?: string[];
      /** Element aggregate array type `{ kind: "array", element: entity }`. */
      returnType: TypeIR;
      origin?: OriginRef;
    }
  | {
      // `a.withdraw(x)` as a statement, or `let r = a.withdraw(x)` — a call to
      // an operation of the aggregate the local `target` holds.  Either form
      // mutates `target`; `result` is present for the `let`-bound form.
      kind: "op-call";
      target: string;
      aggName: string;
      op: string;
      args: ExprIR[];
      result?: CallResultBindingIR;
      origin?: OriginRef;
    }
  | {
      // `<Repo>.remove(o)` — a repository DELETE
      // (destroy) call inside a handler body.  `entity` is the loaded
      // aggregate reference to remove (e.g. the `o` from `let o =
      // Orders.get(id)`).  Each backend renders it to its already-emitted
      // repository delete verb, with the argument shape that backend expects
      // (aggregate value for .NET/Java/Elixir, `<entity>.id` for Hono/Python).
      // Distinct from `op-call`: a delete is not an aggregate operation, and
      // the removed entity must NOT be re-saved at handler exit (`computeSaves`
      // never registers a `repo-delete` as a mutation target).
      kind: "repo-delete";
      /** Always `remove`. */
      op: Extract<RepoOp, "remove">;
      repoName: string;
      aggName: string;
      entity: ExprIR;
      origin?: OriginRef;
    }
  | {
      // `for <var> in <iterable> { <body> }` (retrieval.md).  Iterates an
      // aggregate array, binding each element to `var`.  Mutations to
      // `var` inside the body persist via `savesPerIteration` — the same
      // dirtiness rule as workflow-exit saves, applied to the loop scope
      // and emitted INSIDE the loop (the flat workflow-level `savesAtExit`
      // can't express a per-element save).
      kind: "for-each";
      var: string;
      varAggName: string;
      iterable: ExprIR;
      body: WorkflowStmtIR[];
      savesPerIteration: { name: string; aggName: string; repoName: string }[];
      origin?: OriginRef;
    }
  | {
      // A bare (unbound) resource-op call statement — `files.put(k, v)`.
      // The `let`-bound form (`let x = files.get(k)`) rides
      // `expr-let` instead.  `call` is the lowered `resource-op` call IR.
      kind: "resource-call";
      call: ExprIR;
      origin?: OriginRef;
    }
  | {
      // A bare orchestrator call into a `domainService` operation —
      // `Transfer.run(src, dst, amount)` written as a workflow statement
      // (domain-services.md rev. 4, the `mutating` tier).  Distinct from
      // `op-call` (which targets an aggregate let-binding): a service call is
      // NOT an aggregate operation, so it carries the resolved `service`/`op`
      // and a render-ready `call` (a `callKind: "domain-service"` Call that
      // rides each backend's `render-expr`).  The orchestrator owns
      // persistence: a `mutating` service mutates the aggregate ARGS it is
      // passed (their own ops), so those args become exit-save targets —
      // derived in `computeSaves` (NOT stamped here), exactly as a `repo-let`
      // that an `op-call` targets does.  The `let`-bound form
      // (`let q = Pricing.quote(...)`) rides `expr-let` instead.
      kind: "domain-service-call";
      service: string;
      op: string;
      call: ExprIR;
      /** `let r = Transfer.run(…)` over a `mutating` operation: the local the
       *  call's value is bound to.  The bound form saves the aggregate args the
       *  service mutates exactly as the bare statement does.  (A let-bound call
       *  to a service that mutates nothing rides `expr-let`.) */
      result?: CallResultBindingIR;
      origin?: OriginRef;
    }
  | {
      // `if let <var> = Repo.find(<Criterion>) { then } else { else }`
      // (criterion.md, use site 3) — the workflow body's only option/null
      // handling construct.  Binds the lookup's first match to `var`
      // (unwrapped, non-null) in `thenBody`; `elseBody` runs on no match.
      //
      // Rides the SAME synthetic retrieval as `findAll` (`retrievalName` =
      // `findAllBy<Criterion>`): the enrich pass materialises it from
      // `ctx.criteria[name]` via `synthesizeFindAllRetrievals`, so a `find` and
      // a `findAll` over one criterion share a single internal retrieval.  The
      // if-let codegen runs it with `limit: 1` and takes the first row (or
      // null) — retrievals are internal query bundles (no route leak), unlike a
      // repository `find` which would auto-expose a query endpoint.  A plain
      // `let c = Repo.find(<Criterion>)` (a `select-one` `repo-let`) runs the
      // same retrieval the same way and binds the row or null.
      //
      // The second source form is a DECLARED optional find
      // (`if let o = Orders.byCode(c)` over `find byCode(..): Order?`):
      // `findMethod` names it, `retrievalArgs` carry its arguments, and
      // `retrievalName` / `synthCriterion.name` stay empty.  The backends call
      // the repository's own nullable find method and branch on presence —
      // no retrieval is synthesised.
      kind: "if-let";
      var: string;
      /** `select-one` for a criterion source, `load-by-key-optional` for a
       *  natural-key `Repo.findBy(…)` (`findMethod` names its method),
       *  `load-optional` for `Repo.find(id)` (`retrievalArgs` carry the
       *  id), and `bound` for an in-scope optional binding (`if let o = x`
       *  over `let x = Repo.find…`; `retrievalArgs` is the one `let` ref) —
       *  that form re-runs no read, it only narrows the binding. */
      op: IfLetOp;
      repoName: string;
      aggName: string;
      /** Name of the shared synthetic retrieval (`findAllBy<Criterion>`);
       *  empty for any other source. */
      retrievalName: string;
      /** The source call's arguments: the criterion's, or — when `findMethod`
       *  is set — the declared find's. */
      retrievalArgs: ExprIR[];
      synthCriterion: { name: string };
      /** The declared optional find the source calls, when the source is
       *  `Repo.<find>(args)` rather than `Repo.find(<Criterion>)` — or the
       *  method a natural-key `Repo.findBy(…)` source is emitted as. */
      findMethod?: string;
      /** A natural-key source's tuple + `ignoring` stance (see `repo-let`). */
      key?: KeyLookupIR;
      /** A `Repo.find(<Criterion>) ignoring …` / `Repo.find(id) ignoring …`
       *  source: the criterion (or id) and the stance of the widened read
       *  `findMethod` names.  For a criterion source `synthCriterion` still
       *  names the criterion (it is validated like any criterion read);
       *  `retrievalName` is empty, as the read does not run the shared
       *  retrieval. */
      bypassRead?: BypassReadIR;
      thenBody: WorkflowStmtIR[];
      elseBody?: WorkflowStmtIR[];
      /** Saves for aggregates created/mutated inside `thenBody` (the bound
       *  `var` if an op-call targets it, plus factory-lets) — emitted at the
       *  end of the then-branch, the same dirtiness rule as `for-each`'s
       *  `savesPerIteration`.  Conditional branches can't hoist their saves to
       *  the flat `savesAtExit`, so each branch carries its own. */
      savesInThen: { name: string; aggName: string; repoName: string }[];
      /** Saves for aggregates created in `elseBody` (e.g. a not-found →
       *  `Agg.create(...)` fallback) — emitted at the end of the else-branch. */
      savesInElse: { name: string; aggName: string; repoName: string }[];
      origin?: OriginRef;
    }
  | {
      // `notFound` / `notFound "detail"` — end the body with the standard
      // not-found ProblemDetails, the same answer a `getById` miss earns on
      // that backend (status `NotFound` resolves to, its reason-phrase title).
      // The detail sentence is `notFoundStmtDetail` (`ir/enrich/wire-policy.ts`):
      // the authored `detail`, else `<subject> not found`.  `subject` is the
      // aggregate of the `if let` whose `else` the statement sits in directly —
      // lowering knows it from the branch's source, no later pass does.
      kind: "not-found";
      detail?: string;
      subject?: string;
      origin?: OriginRef;
    }
  | {
      // `match <subject> { V b => { … } … else => { … } }` used for its
      // effects in a workflow / handler body — the statement twin of the
      // `match` ExprIR.  The subject is a value the body already holds (a
      // param, a `let`, a read's `T?` result); each arm runs a statement block
      // with `binding` narrowed to its variant.  A `T?` subject is a presence
      // check (`subjectShape: "absence"`): the `T` arm runs on present, with
      // its binding an alias of the subject, and the `none` arm (or `else`)
      // on absent.
      //
      // Like `if-let`, each branch saves what it creates or mutates at its
      // own end (`savesInArm` / `savesInElse`): a conditional branch cannot
      // hoist its saves to the flat `savesAtExit`.  Over a guarded call's
      // result (`let r = a.withdraw(x)` with an `error` variant) the non-error
      // branches also save what the call mutated, and the error branches drop
      // it (`discardsInArm` / `discardsInElse`).
      kind: "variant-match";
      subject: ExprIR;
      /** Resolved type of the subject — an `or`-union, or `T?`. */
      subjectType?: TypeIR;
      /** `"absence"` when the subject is `T?` (or carries the absence runtime
       *  shape): the backends render a presence check, not a discriminator
       *  probe. */
      subjectShape?: "absence";
      arms: {
        varType: TypeIR;
        binding?: string;
        /** True when the variant is an `error` record. */
        isError: boolean;
        body: WorkflowStmtIR[];
        savesInArm: { name: string; aggName: string; repoName: string }[];
        /** When the subject is a guarded call's result (`CallResultBindingIR`)
         *  and this arm is an error variant: the aggregates whose tentative
         *  change the arm drops.  Absent when the arm drops nothing.  A backend
         *  whose persistence tracks loaded entities (EF Core, JPA) detaches
         *  them, so no later flush writes the change; one that writes only on
         *  an explicit save renders nothing. */
        discardsInArm?: { name: string; aggName: string; repoName: string }[];
      }[];
      elseBody?: WorkflowStmtIR[];
      savesInElse: { name: string; aggName: string; repoName: string }[];
      /** `discardsInArm` for the `else` arm. */
      discardsInElse?: { name: string; aggName: string; repoName: string }[];
      origin?: OriginRef;
    }
  | {
      // `field := value` — assignment to one of the workflow's OWN state
      // fields inside a `create`/`on` body (workflow.md, "own-state
      // mutation").  The `target` PathIR resolves to a `this-prop`
      // on the workflow's persisted correlation/instance state row; the write
      // lands on that state object (NOT an aggregate `this`).  Mirrors the
      // aggregate-op `StmtIR` `assign` (loom-ir.ts) exactly.  Only `:=` lowers
      // here — `+=`/`-=` and cross-aggregate mutations stay `__bad__` and are
      // rejected at IR-validate.
      kind: "assign";
      target: PathIR;
      value: ExprIR;
      targetType: TypeIR;
      origin?: OriginRef;
    };
