import { namesBound, namesUsed } from "../../ir/plan/index.js";
import type { ExprIR, WorkflowStmtIR } from "../../ir/types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../ir/util/walk.js";
import {
  type WriteScopeContext,
  type WriteScopeGuard,
  writeScopeGuards,
} from "../../ir/util/write-scope-guards.js";

// ---------------------------------------------------------------------------
// The shared workflow statement-sequence spine — the `WorkflowStmtIR`
// analogue of the `ExprTarget` seam in `_expr/target.ts`.
//
// Every backend's workflow emitter walks the same body: the
// `WorkflowStmtIR` sequence in declaration order, recursing into `for-each`
// bodies. Only the per-kind *spelling* diverges (let syntax, block syntax,
// guard idiom, the expression renderer) plus the indent unit. Without this
// seam each backend re-implements the whole switch.
//
// Two assembly strategies share the traversal.  `sequence`
// (`renderWorkflowStmts` + a `WorkflowStmtTarget`) renders statements in order
// for the four imperative backends; `pipeline` (`lowerWorkflowPipeline` + a
// `WorkflowPipelineTarget`, below) lowers them to binding-chain steps for
// Elixir.  Each owns the dispatch + the nested-body recursion (`for-each` /
// `if-let` / `if` / `variant-match`) once; each backend supplies a leaf table.  A new
// `WorkflowStmtIR` kind is a compile error here (exhaustive switch) AND in
// every target (the interface), exactly like adding an `ExprIR.kind`.
//
// NOTE: this is the *statement* spine only. The per-workflow envelope
// (route/handler shell, transaction wrapping, repo construction, param
// binding, exit-save + event-dispatch loops) is genuinely divergent
// per-driver scaffolding and stays in each backend's emitter.
// ---------------------------------------------------------------------------

type ByKind<K extends WorkflowStmtIR["kind"]> = Extract<WorkflowStmtIR, { kind: K }>;

/** A statement kind's leaf-method name: `repo-let` → `repoLet`. */
type LeafName<K extends string> = K extends `${infer Head}-${infer Rest}`
  ? `${Head}${Capitalize<LeafName<Rest>>}`
  : K;

/** One leaf method per workflow statement kind.  Both target contracts extend
 *  it, so a new kind is a required member of every backend's leaf table: the
 *  tables fail to type-check until they render it, and nothing else does
 *  (beyond the spine's own exhaustive dispatch). */
type LeafPerKind<Rendered> = {
  [K in WorkflowStmtIR["kind"] as LeafName<K>]: (
    st: ByKind<K>,
    // biome-ignore lint/suspicious/noExplicitAny: each leaf declares its own trailing parameters
    ...rest: any[]
  ) => Rendered;
};

export interface WorkflowStmtTarget extends LeafPerKind<string[]> {
  /** Indent step the spine adds for a `for-each` body — `"  "` (Hono) /
   *  `"    "` (Python). The target reuses the same unit when rendering the
   *  loop's per-iteration saves. */
  readonly indentUnit: string;

  precondition(st: ByKind<"precondition">, indent: string): string[];
  requires(st: ByKind<"requires">, indent: string): string[];
  emit(st: ByKind<"emit">, indent: string): string[];
  factoryLet(st: ByKind<"factory-let">, indent: string): string[];
  repoLet(st: ByKind<"repo-let">, indent: string): string[];
  exprLet(st: ByKind<"expr-let">, indent: string): string[];
  /** `field := value` — write `value` to the workflow's own persisted state
   *  field named by `st.target` (a single-segment `this-prop` path).  The
   *  target writes onto the backend's correlation/instance state object. */
  assign(st: ByKind<"assign">, indent: string): string[];
  repoRun(st: ByKind<"repo-run">, indent: string): string[];
  opCall(st: ByKind<"op-call">, indent: string): string[];
  /** `<Repo>.delete(o)` — a repository DELETE (destroy).  Renders to the
   *  backend's already-emitted repository delete verb.  The argument shape
   *  diverges per backend (the aggregate value for .NET/Java, `<entity>.id`
   *  for Hono/Python), so the target renders `st.entity` itself. */
  repoDelete(st: ByKind<"repo-delete">, indent: string): string[];
  resourceCall(st: ByKind<"resource-call">, indent: string): string[];
  /** `Transfer.run(src, dst, amount)` — a bare orchestrator call into a
   *  `domainService` operation (domain-services.md rev. 4, the `mutating`
   *  tier).  Renders `st.call` (a `callKind: "domain-service"` Call) as a
   *  statement; the aggregates it mutates persist via the workflow's exit-saves
   *  (`savesAtExit`), not here. */
  domainServiceCall(st: ByKind<"domain-service-call">, indent: string): string[];
  /** `notFound` — end the body with the backend's not-found answer: raise the
   *  SAME error a `getById` miss raises, carrying `notFoundStmtDetail(st)` as
   *  its message, so the route answers the identical ProblemDetails 404. */
  notFound(st: ByKind<"not-found">, indent: string): string[];

  /** The body's write-scope requirement (`ir/util/write-scope-guards.ts`).
   *  When set, the spine renders `guard` for every row a statement mutates or
   *  deletes, ahead of that statement: a re-load through the aggregate's
   *  write-scope load, which raises the backend's not-found (→ 404) for a row
   *  outside the caller's write scope.  Absent on a body that cannot need
   *  one (a reactor, or a context with no narrowed write scope). */
  readonly writeScope?: {
    readonly cx: WriteScopeContext;
    guard(g: WriteScopeGuard, indent: string): string[];
  };

  /** `for-each`: `renderedBody` is the loop body already rendered at
   *  `indent + indentUnit` by the spine; the target wraps it in the backend's
   *  loop construct and appends the per-iteration saves. */
  forEach(st: ByKind<"for-each">, indent: string, renderedBody: string[]): string[];

  /** `if-let`: `renderedThen` / `renderedElse` are the two branch bodies
   *  already rendered at `indent + indentUnit` by the spine. The target runs
   *  the synthetic `findAllBy<Criterion>` retrieval with `limit: 1` — or, when
   *  `st.findMethod` is set, the repository's declared optional find — binds
   *  the row (or null/none) to `st.var`, and emits the present/absent
   *  branches — appending each branch's saves (`savesInThen` / `savesInElse`).
   *  `renderedElse` is empty when the source had no `else`. */
  ifLet(
    st: ByKind<"if-let">,
    indent: string,
    renderedThen: string[],
    renderedElse: string[],
  ): string[];

  /** `if`: `renderedThen` / `renderedElse` are the two branch bodies already
   *  rendered at `indent + indentUnit` by the spine.  The target renders
   *  `st.cond` through its expression renderer, branches on it, and appends
   *  each branch's saves (`savesInThen` / `savesInElse`).  `renderedElse` is
   *  empty when the source had no `else`. */
  if(st: ByKind<"if">, indent: string, renderedThen: string[], renderedElse: string[]): string[];

  /** `variant-match`: `renderedArms[i]` is `st.arms[i].body` and
   *  `renderedElse` the `else` body, each already rendered at
   *  `indent + indentUnit` by the spine.  The target dispatches on the
   *  subject — a presence check when `st.subjectShape === "absence"`, else a
   *  probe of the union's variant — declares each arm's `binding` at the head
   *  of its branch (a scalar variant binds its carrier's value, see
   *  `isScalarVariant`), and appends each branch's saves (`savesInArm` /
   *  `savesInElse`).  `renderedElse` is empty when the source had no `else`. */
  variantMatch(
    st: ByKind<"variant-match">,
    indent: string,
    renderedArms: string[][],
    renderedElse: string[],
  ): string[];
}

/** One side of a presence `match` (`subjectShape: "absence"`): the binding
 *  the side declares (the present side's arm binding, aliasing the subject),
 *  its rendered lines, and the saves it owes at its end. */
export interface PresenceSide {
  binding?: string;
  lines: string[];
  saves: readonly { name: string; aggName: string; repoName: string }[];
}

/** Split a presence `match` into the side that runs when the subject holds a
 *  value (the `T` arm) and the side that runs when it does not (the `none`
 *  arm); the `else` body fills whichever side no arm names.  A side no arm
 *  and no `else` covers is undefined. */
export function presenceSides(
  st: ByKind<"variant-match">,
  renderedArms: string[][],
  renderedElse: string[],
): { present?: PresenceSide; absent?: PresenceSide } {
  const isAbsent = (a: (typeof st.arms)[number]) => a.varType.kind === "none" || a.isError;
  const side = (absent: boolean): PresenceSide | undefined => {
    const i = st.arms.findIndex((a) => isAbsent(a) === absent);
    const arm = st.arms[i];
    if (arm) {
      return {
        ...(!absent && arm.binding ? { binding: arm.binding } : {}),
        lines: renderedArms[i]!,
        saves: arm.savesInArm,
      };
    }
    return st.elseBody ? { lines: renderedElse, saves: st.savesInElse } : undefined;
  };
  const present = side(false);
  // An absent side with nothing to run renders no `else` at all.
  const absentSide = side(true);
  const absent =
    absentSide && (absentSide.lines.length > 0 || absentSide.saves.length > 0)
      ? absentSide
      : undefined;
  return { ...(present ? { present } : {}), ...(absent ? { absent } : {}) };
}

/** Let-bound names whose RHS was a UNION-returning find (`find x(): Agg or
 *  Err`).  Per the union-find wire contract (exception-less.md §4 /
 *  docs/payloads.md) the backends' Domain repositories lower such a find to
 *  its OPTIONAL TWIN — the success aggregate, nullable on absence — and emit
 *  NO union carrier types.  A variant-`match` over one of these bindings must
 *  therefore render as a null-check, not a carrier-pattern dispatch; backends
 *  consult this set in their `exprLet` arm. */
export function collectUnionFindLets(stmts: readonly WorkflowStmtIR[]): Set<string> {
  const out = new Set<string>();
  for (const root of stmts) {
    walkWorkflowStmtsDeep(root, (st) => {
      if (st.kind === "repo-let" && st.returnType.kind === "union") out.add(st.name);
    });
  }
  return out;
}

/** Render a workflow statement sequence at `indent`, dispatching each kind to
 *  the backend `target`. Owns the only `for-each` recursion.  Byte-identical
 *  by construction: exactly the one-level flatten of
 *  `renderWorkflowStmtChunks` (`stmts.flatMap(f)` and `stmts.map(f).flat()`
 *  are the same array for every `f`). */
export function renderWorkflowStmts(
  stmts: readonly WorkflowStmtIR[],
  target: WorkflowStmtTarget,
  indent: string,
): string[] {
  return renderWorkflowStmtChunks(stmts, target, indent).flat();
}

/** Same rendering as `renderWorkflowStmts`, but one chunk (the statement's
 *  own — possibly multi-line — lines array) per TOP-LEVEL `WorkflowStmtIR`
 *  instead of the pre-flattened whole.  A `for-each` / `if-let`'s nested body
 *  lines stay INSIDE their statement's chunk (`statementSubRegions` is a flat
 *  walk keyed 1:1 against `stmts`, so nested-body granularity is out of scope
 *  for this cursor — see `src/generator/_trace/sourcemap.ts`).  Lets a caller
 *  that owns the final file content recover each top-level statement's own
 *  line span for `SourceMapRecorder.fragment`, mirroring
 *  `renderTsStatementChunks` / `renderCsStatementChunks` / the Python and Java
 *  siblings — this is the `WorkflowStmtIR` analogue for workflow bodies. */
export function renderWorkflowStmtChunks(
  stmts: readonly WorkflowStmtIR[],
  target: WorkflowStmtTarget,
  indent: string,
): string[][] {
  return stmts.map((st) => renderWorkflowStmt(st, target, indent));
}

function renderWorkflowStmt(
  st: WorkflowStmtIR,
  target: WorkflowStmtTarget,
  indent: string,
): string[] {
  const ws = target.writeScope;
  const guards = ws ? writeScopeGuards(st, ws.cx).flatMap((g) => ws.guard(g, indent)) : [];
  const own = renderWorkflowStmtOwn(st, target, indent);
  return guards.length > 0 ? [...guards, ...own] : own;
}

function renderWorkflowStmtOwn(
  st: WorkflowStmtIR,
  target: WorkflowStmtTarget,
  indent: string,
): string[] {
  switch (st.kind) {
    case "precondition":
      return target.precondition(st, indent);
    case "requires":
      return target.requires(st, indent);
    case "emit":
      return target.emit(st, indent);
    case "factory-let":
      return target.factoryLet(st, indent);
    case "repo-let":
      return target.repoLet(st, indent);
    case "expr-let":
      return target.exprLet(st, indent);
    case "assign":
      return target.assign(st, indent);
    case "repo-run":
      return target.repoRun(st, indent);
    case "op-call":
      return target.opCall(st, indent);
    case "repo-delete":
      return target.repoDelete(st, indent);
    case "for-each":
      return target.forEach(
        st,
        indent,
        renderWorkflowStmts(st.body, target, indent + target.indentUnit),
      );
    case "if-let":
      return target.ifLet(
        st,
        indent,
        renderWorkflowStmts(st.thenBody, target, indent + target.indentUnit),
        renderWorkflowStmts(st.elseBody ?? [], target, indent + target.indentUnit),
      );
    case "if":
      return target.if(
        st,
        indent,
        renderWorkflowStmts(st.thenBody, target, indent + target.indentUnit),
        renderWorkflowStmts(st.elseBody ?? [], target, indent + target.indentUnit),
      );
    case "variant-match":
      return target.variantMatch(
        st,
        indent,
        st.arms.map((arm) => renderWorkflowStmts(arm.body, target, indent + target.indentUnit)),
        renderWorkflowStmts(st.elseBody ?? [], target, indent + target.indentUnit),
      );
    case "resource-call":
      return target.resourceCall(st, indent);
    case "domain-service-call":
      return target.domainServiceCall(st, indent);
    case "not-found":
      return target.notFound(st, indent);
  }
}

// ---------------------------------------------------------------------------
// The `pipeline` assembly strategy.
//
// The four imperative backends render a body as statements in sequence
// (`renderWorkflowStmts`).  A functional backend assembles it as a binding
// chain whose first failure short-circuits the rest — Elixir's `with` chain,
// or `Enum.reduce_while` for a loop body.  That backend cannot render a
// statement in isolation: whether a binding may be discarded depends on the
// statements after it, and a nested body is assembled differently from the
// top level (a loop iteration continues or halts; a branch answers its own
// result).
//
// So the pipeline spine lowers each statement to typed STEPS, not lines, and
// hands every leaf its `PipelineScope` — the statements that follow it in the
// same body, plus the expressions the caller evaluates after the body.  It
// owns the kind dispatch and the recursion into `for-each` / `if-let` / `if` /
// `variant-match` bodies; the target owns the spelling and the assembly of a
// step list into a chain.
// ---------------------------------------------------------------------------

/** One lowered statement fragment in a binding chain. */
export type PipelineStep =
  /** A fallible link: its failure short-circuits the chain.  `bindName` is the
   *  name it binds, when the chain may answer it as its result; `rebinds` are
   *  names already in scope that it binds again (a loop threading the handles
   *  its body updated back out). */
  | { kind: "clause"; text: string; bindName?: string; rebinds?: readonly string[] }
  /** An infallible binding.  Inside a chain it is a link that always matches;
   *  in a body with no fallible link it is a plain sequential binding. */
  | { kind: "let"; pattern: string; expr: string; bindName?: string }
  /** A side effect that runs only when the whole chain succeeded. */
  | { kind: "effect"; text: string }
  /** End the body with a failure: `clause` is the link form (it never
   *  matches); `term` is the failure the body answers when it is the body's
   *  last step. */
  | { kind: "fail"; clause: string; term: string };

/** What a statement may know about the body around it. */
export interface PipelineScope {
  /** The statements after this one in the same body. */
  readonly rest: readonly WorkflowStmtIR[];
  /** Expressions the caller evaluates after the whole body (a handler's
   *  `return`, a workflow's declared result) — reads of a binding too. */
  readonly trailing: readonly ExprIR[];
  /** True when this statement's binding is not the chain's result slot, so an
   *  unread binding may be discarded. */
  readonly discardableBind: boolean;
  /** Inside a loop body or an `if` branch: the names the body reads that are
   *  bound outside it (not the loop variable, not a binding of the body).  A
   *  value such a name holds must outlive the body — a mutation of it is read
   *  again by the next iteration, or by the statements after the `if` — so a
   *  target that rebinds rather than mutates threads it out of the body.
   *  Empty in any other body. */
  readonly carried: ReadonlySet<string>;
}

/** A nested body: its statements, the steps the spine lowered them to, and
 *  the names they carry out of the body (`PipelineScope.carried`; empty for a
 *  body that is neither a loop body nor an `if` branch). */
export interface PipelineBody {
  readonly stmts: readonly WorkflowStmtIR[];
  readonly steps: PipelineStep[];
  readonly carried: ReadonlySet<string>;
}

export interface WorkflowPipelineTarget extends LeafPerKind<PipelineStep[]> {
  precondition(st: ByKind<"precondition">, scope: PipelineScope): PipelineStep[];
  requires(st: ByKind<"requires">, scope: PipelineScope): PipelineStep[];
  emit(st: ByKind<"emit">, scope: PipelineScope): PipelineStep[];
  factoryLet(st: ByKind<"factory-let">, scope: PipelineScope): PipelineStep[];
  repoLet(st: ByKind<"repo-let">, scope: PipelineScope): PipelineStep[];
  exprLet(st: ByKind<"expr-let">, scope: PipelineScope): PipelineStep[];
  assign(st: ByKind<"assign">, scope: PipelineScope): PipelineStep[];
  repoRun(st: ByKind<"repo-run">, scope: PipelineScope): PipelineStep[];
  opCall(st: ByKind<"op-call">, scope: PipelineScope): PipelineStep[];
  repoDelete(st: ByKind<"repo-delete">, scope: PipelineScope): PipelineStep[];
  resourceCall(st: ByKind<"resource-call">, scope: PipelineScope): PipelineStep[];
  domainServiceCall(st: ByKind<"domain-service-call">, scope: PipelineScope): PipelineStep[];
  notFound(st: ByKind<"not-found">, scope: PipelineScope): PipelineStep[];
  forEach(st: ByKind<"for-each">, scope: PipelineScope, body: PipelineBody): PipelineStep[];
  ifLet(
    st: ByKind<"if-let">,
    scope: PipelineScope,
    thenBody: PipelineBody,
    elseBody: PipelineBody,
  ): PipelineStep[];
  /** `if`: each branch is lowered with `carried` holding the names its
   *  statements read that are bound outside the `if`, so a target that
   *  rebinds rather than mutates can thread a handle a branch rebinds back
   *  out to the statements after it. */
  if(
    st: ByKind<"if">,
    scope: PipelineScope,
    thenBody: PipelineBody,
    elseBody: PipelineBody,
  ): PipelineStep[];
  variantMatch(
    st: ByKind<"variant-match">,
    scope: PipelineScope,
    arms: PipelineBody[],
    elseBody: PipelineBody,
  ): PipelineStep[];
}

/** How the caller closes a top-level body. */
export interface PipelineOptions {
  /** See `PipelineScope.trailing`. */
  readonly trailing?: readonly ExprIR[];
  /** The index of the statement whose binding the chain answers as its
   *  result; every other statement's unread binding is discardable.  Omitted
   *  when the caller answers its own result. */
  readonly resultSlot?: number;
}

/** Does `st` always bind a name the chain can answer as its result?  The last
 *  such statement of a body is the result slot of a chain that answers its
 *  last binding.  A `domain-service-call` is absent on purpose: whether it
 *  binds depends on how the backend inlines it. */
function bindsResult(st: WorkflowStmtIR): boolean {
  switch (st.kind) {
    case "factory-let":
    case "repo-let":
    case "repo-run":
    case "assign":
      return true;
    case "precondition":
    case "requires":
    case "emit":
    case "expr-let":
    case "op-call":
    case "repo-delete":
    case "resource-call":
    case "domain-service-call":
    case "not-found":
    case "for-each":
    case "if-let":
    case "if":
    case "variant-match":
      return false;
    default: {
      const _exhaustive: never = st;
      return _exhaustive;
    }
  }
}

/** The result slot of a chain that answers its last binding: the index of the
 *  last statement that always binds, or -1 when none does. */
export function lastBindingSlot(stmts: readonly WorkflowStmtIR[]): number {
  let slot = -1;
  for (let i = 0; i < stmts.length; i++) if (bindsResult(stmts[i]!)) slot = i;
  return slot;
}

/** Lower a top-level body to pipeline steps, one chunk per statement (so a
 *  caller can attribute each statement's own steps to its source).  A nested
 *  body answers its own result, so every unread binding in it is
 *  discardable. */
export function lowerWorkflowPipeline(
  stmts: readonly WorkflowStmtIR[],
  target: WorkflowPipelineTarget,
  opts: PipelineOptions = {},
): PipelineStep[][] {
  const trailing = opts.trailing ?? [];
  return stmts.map((st, i) =>
    lowerPipelineStmt(st, target, {
      rest: stmts.slice(i + 1),
      trailing,
      discardableBind: i !== opts.resultSlot,
      carried: NONE_CARRIED,
    }),
  );
}

const NONE_CARRIED: ReadonlySet<string> = new Set();

function lowerPipelineBody(
  stmts: readonly WorkflowStmtIR[],
  target: WorkflowPipelineTarget,
  carried: ReadonlySet<string> = NONE_CARRIED,
): PipelineBody {
  return {
    stmts,
    carried,
    steps: stmts.flatMap((st, i) =>
      lowerPipelineStmt(st, target, {
        rest: stmts.slice(i + 1),
        trailing: [],
        discardableBind: true,
        carried,
      }),
    ),
  };
}

/** The names a loop body reads that are bound outside it. */
function loopCarried(st: ByKind<"for-each">): ReadonlySet<string> {
  const local = new Set([st.var, ...namesBound([st.body])]);
  return new Set([...namesUsed(st.body)].filter((n) => !local.has(n)));
}

/** The names an `if` branch reads that are bound outside it, plus the names
 *  the enclosing body already carries (a branch inside a loop body). */
function branchCarried(body: readonly WorkflowStmtIR[], outer: PipelineScope): ReadonlySet<string> {
  const local = new Set(namesBound([body]));
  return new Set([...outer.carried, ...[...namesUsed(body)].filter((n) => !local.has(n))]);
}

function lowerPipelineStmt(
  st: WorkflowStmtIR,
  target: WorkflowPipelineTarget,
  scope: PipelineScope,
): PipelineStep[] {
  switch (st.kind) {
    case "precondition":
      return target.precondition(st, scope);
    case "requires":
      return target.requires(st, scope);
    case "emit":
      return target.emit(st, scope);
    case "factory-let":
      return target.factoryLet(st, scope);
    case "repo-let":
      return target.repoLet(st, scope);
    case "expr-let":
      return target.exprLet(st, scope);
    case "assign":
      return target.assign(st, scope);
    case "repo-run":
      return target.repoRun(st, scope);
    case "op-call":
      return target.opCall(st, scope);
    case "repo-delete":
      return target.repoDelete(st, scope);
    case "resource-call":
      return target.resourceCall(st, scope);
    case "domain-service-call":
      return target.domainServiceCall(st, scope);
    case "not-found":
      return target.notFound(st, scope);
    case "for-each":
      return target.forEach(st, scope, lowerPipelineBody(st.body, target, loopCarried(st)));
    case "if-let":
      return target.ifLet(
        st,
        scope,
        lowerPipelineBody(st.thenBody, target),
        lowerPipelineBody(st.elseBody ?? [], target),
      );
    case "if":
      return target.if(
        st,
        scope,
        lowerPipelineBody(st.thenBody, target, branchCarried(st.thenBody, scope)),
        lowerPipelineBody(st.elseBody ?? [], target, branchCarried(st.elseBody ?? [], scope)),
      );
    case "variant-match":
      return target.variantMatch(
        st,
        scope,
        st.arms.map((arm) => lowerPipelineBody(arm.body, target)),
        lowerPipelineBody(st.elseBody ?? [], target),
      );
  }
}
