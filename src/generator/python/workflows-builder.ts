import { notFoundStmtDetail } from "../../ir/enrich/wire-policy.js";
import {
  isWorkflowSelfType,
  lookupOp,
  namesUsed,
  observableWorkflows,
  refsRead,
  reposNeeded,
  serviceOpReadPorts,
  serviceReadPorts,
  withReadPortRepos,
  workflowIsolation,
  workflowNeedsCurrentUser,
} from "../../ir/plan/index.js";
import { isScalarVariant, variantTag } from "../../ir/stdlib/unions.js";
import {
  type EnrichedBoundedContextIR,
  type ExprIR,
  exprUsesCurrentUser,
  type SystemIR,
  type WireField,
  type WorkflowIR,
  type WorkflowStmtIR,
  workflowCanAnswerNotFound,
  workflowIsGuarded,
} from "../../ir/types/loom-ir.js";
import { operationBodyUsesCurrentUser, operationGates } from "../../ir/util/op-gates.js";
import {
  camelId,
  opWorkflow,
  opWorkflowInstanceById,
  opWorkflowInstances,
} from "../../ir/util/openapi-ids.js";
import { walkWorkflowStmtsDeep, workflowEmits } from "../../ir/util/walk.js";
import {
  commandCreateEntryResult,
  commandCreateResult,
  commandWorkflowsOf,
} from "../../ir/util/workflow-command-route.js";
import { workflowBodyUsesOwnState } from "../../ir/util/workflow-own-state.js";
import { type WriteScopeContext, writeScopeContext } from "../../ir/util/write-scope-guards.js";
import { type LinesPart, lines } from "../../util/code-builder.js";
import {
  plural,
  pythonIdent,
  pythonWireIdent,
  snake,
  upperFirst,
  workflowFnSnake,
} from "../../util/naming.js";
import { workflowPreconditionThrowArgs } from "../_i18n/domain-floor.js";
import { PY_IMPORTS, pyRef } from "../_imports/python.js";
import { spellMarkers } from "../_imports/symbol.js";
import { numericEncode } from "../_numeric/target.js";
import { LogEvents } from "../_obs/log-events.js";
import { workflowParamPayloads } from "../_payload/workflow-param-payloads.js";
import { DOMAIN_NAMES } from "../_symbols/plan.js";
import { statementSubRegions } from "../_trace/sourcemap.js";
import { commandCreateCorrelationParam } from "../_workflow/create-state.js";
import {
  type PresenceSide,
  presenceSides,
  renderWorkflowStmtChunks,
  type WorkflowStmtTarget,
} from "../_workflow/stmt-target.js";
import { pyCalendarDateWire } from "./codec-spelling.js";
import { pyCommandBodyParam } from "./command-body.js";
import { allocateKwargs, zeroFor } from "./dispatch-builder.js";
import type { OpFragment } from "./emit/aggregate.js";
import { responsePyType } from "./emit/http-models.js";
import { withFieldConstraint } from "./emit/wire-constraints.js";
import {
  entryErrorPyLines,
  entryErrorStatusesPy,
  entryResultPyLines,
} from "./entry-result-emit.js";
import { PY_NUMERIC } from "./numeric-codec.js";
import { PY } from "./py-symbols.js";
import {
  type PyRenderContext,
  renderPyExpr,
  renderPyNegatedGuard,
  renderPyType,
} from "./render-expr.js";
import { renderPyStatements } from "./render-stmt.js";
import { resourceImportLines } from "./resource-clients.js";
import {
  aggClassRef,
  conflictResolver,
  errorResponsesKwarg,
  PY_HTTP as H,
  ID_PARAM,
  PY_REQUEST_PARAM,
  PY_SESSION_DEP,
  PY_USER_BIND,
  pyWireToDomain,
  repoClassRef,
  requestFieldDecl,
} from "./routes-builder.js";
import { type PySaveLines, pySaveRenderer } from "./stamp-call.js";
import { pyNotFoundRaise, pyRuleParams, wireStatusResolver } from "./wire-policy-py.js";
import { esFns } from "./workflow-eventsourced-emit.js";

// ---------------------------------------------------------------------------
// Workflow routes — `app/http/workflows_routes.py`, mounted at
// `/workflows`.  One `POST /workflows/<snake(wf)>` per command-surfaced
// workflow (parity with the Hono workflow builder): params coerce to
// domain locals, the body's WorkflowStmtIR sequence executes over the
// request session, let-bound aggregates save at exit, collected emits
// dispatch at the end, 204 on success.
//
// One DB transaction per request: repositories flush, the session
// dependency commits once after the handler returns — so a
// `transactional` workflow's saves are atomic by construction.
//
// Event-triggered starters / `on(...)` reactors (the saga dispatcher +
// correlation state tables) live in `dispatch-builder.ts` / `schema.ts`;
// `emitsCommandRoute` mirrors the Hono facade rule, so a reactor-only
// workflow emits no POST route here.
//
// Read-only instance endpoints (workflow-instance-visibility.md) — GET
// `/<snake>/instances` (list) + `/<snake>/instances/{id}` (one by correlation
// id, 404 if absent) — are emitted for every observable workflow (one with an
// enriched `instanceWireShape`), reading the persisted saga-state row the
// dispatcher upserts.  Driven off `instanceWireShape` independently of the
// command route, so an event-triggered-only saga is still observable — parity
// with the Hono / .NET / Elixir-vanilla instance reads.
// ---------------------------------------------------------------------------

// `commandWorkflowsOf` / `emitsCommandRoute` now live in
// `ir/util/workflow-command-route`; re-exported here so `python/index.ts`'s
// import point is unchanged.
export { commandWorkflowsOf };

// Workflow-route symbols beyond the shared HTTP set, as `ref()` markers — the
// module's import block derives from use (M-T9.84).
const SELECT = pyRef("sqlalchemy", "select");
const SIMPLE_NAMESPACE = pyRef("types", "SimpleNamespace");
const IN_CHILD_CONTEXT = pyRef("app.obs.log", "in_child_context");
const DOMAIN_EVENT = pyRef("app.domain.events", "DomainEvent");
/** A workflow's persisted correlation row class (`app.db.schema`). */
const rowRef = (wf: WorkflowIR): string => pyRef("app.db.schema", `${wf.name}Row`);
/** An `app.dispatch` fold helper (event-sourced saga reads). */
const dispatchFn = (name: string): string => pyRef("app.dispatch", name);
/** A domain event class. */
const eventRef = (name: string): string => pyRef("app.domain.events", name);

/** Observable workflows — correlation-bearing, state-table-backed sagas the
 *  enricher gave an `instanceWireShape` (workflow-instance-visibility.md).
 *  Each gets the read-only instance endpoints over its persisted saga row. */

export function buildPyWorkflowsFile(
  ctx: EnrichedBoundedContextIR,
  hasDispatch = false,
  sys?: SystemIR,
  /** Source-map (workflow-body statement regions) — allocated by
   *  the caller (`src/generator/python/index.ts`) ONLY when a recorder is
   *  present.  `app/http/workflows_routes.py` pools every command workflow,
   *  so it never gets a `sourcemap.file(...)` whole-file region (mirrors the
   *  Elixir pooled-file precedent) — these fragment-only statement regions
   *  are the only mapping this file gets.  Reactor / event-`create` starter
   *  bodies live in `dispatch-builder.ts` (`app/dispatch.py`), out of
   *  scope. */
  opFragments?: OpFragment[],
): string | null {
  const wfs = commandWorkflowsOf(ctx);
  const obsWfs = observableWorkflows(ctx.workflows);
  if (wfs.length === 0 && obsWfs.length === 0) return null;
  // Resource verb-helper imports for any `<resource>.<verb>(...)` the
  // workflows call (resources.md).
  const resourceImports = sys
    ? resourceImportLines(
        sys,
        wfs.flatMap((wf) => wf.statements),
      )
    : [];
  const dispatcherExpr = hasDispatch
    ? `${H.make_dispatcher}(session)`
    : `${H.NoopDomainEventDispatcher}()`;

  // The declared record payloads this context's command-workflow params name
  // (`create(c: FileClaim)`).  Nothing else emits a model for one — a payload
  // has no owning aggregate — so both halves are emitted here, ahead of the
  // request models that reference them (#2864 D7/T2):
  //
  //   * the WIRE model `<P>Response`, the name `requestFieldDecl` already
  //     produces for a payload param (`requestPyType`'s `entity` arm), and
  //   * the DOMAIN dataclass `<P>`, which `pyWireToDomain`'s payload arm
  //     builds and the body's `c.<field>` reads are typed against.
  const payloads = workflowParamPayloads(ctx);
  const payloadModels = payloads
    .map((pl) =>
      lines(
        `class ${pl.name}Response(${H.BaseModel}):`,
        pl.fields.length > 0
          ? pl.fields.map((f) =>
              withFieldConstraint(f.name, requestFieldDecl(f.type, f.optional, ctx), undefined),
            )
          : ["    pass"],
        "",
        "",
        `@${PY.dataclass}(frozen=True)`,
        `class ${pl.name}:`,
        pl.fields.length > 0
          ? pl.fields.map(
              (f) =>
                `    ${pythonWireIdent(f.name)}: ${renderPyType(f.type)}${f.optional && f.type.kind !== "optional" ? " | None" : ""}`,
            )
          : ["    pass"],
        "",
        "",
      ),
    )
    .join("");

  const models = wfs
    .map((wf) =>
      lines(
        `class ${upperFirst(wf.name)}Request(${H.BaseModel}):`,
        wf.params.length > 0
          ? wf.params.map((p) =>
              withFieldConstraint(p.name, requestFieldDecl(p.type, false, ctx), undefined),
            )
          : ["    pass"],
        "",
        "",
      ),
    )
    .join("");

  // Read-only instance response DTOs (+ list carrier) for observable sagas.
  const instanceModels = obsWfs.map((wf) => instanceResponseModels(wf, ctx)).join("");

  const routeBlocks = [
    ...wfs.map((wf) => workflowRoute(wf, ctx, dispatcherExpr, sys, opFragments)),
    ...obsWfs.map((wf) => instanceRoutes(wf, ctx)),
  ];
  const routes = routeBlocks.join("\n\n\n");
  // Workflow `function` helpers — module-scoped `def`s, namespaced by workflow
  // (workflows share this file), emitted before the routes so the create/on
  // bodies can call them.  Expression-bodied + pure over params (validator-guaranteed).
  const helperDefs = wfs.flatMap((wf) => workflowFnHelpers(wf)).join("\n\n");
  const helpersBlock = helperDefs ? `${helperDefs}\n\n\n` : "";
  // F58 — the saga-row loader for every command route that load-or-allocates
  // its correlation row.  Structurally identical to `dispatch-builder.ts`'s
  // `stateHelpers`, emitted locally so `workflows_routes.py` stays
  // self-contained (a channel-less project has no `app/dispatch.py` loaders at
  // all).  Empty for stateless / event-sourced / key-less workflows.
  const sagaLoaders = wfs
    .filter((wf) => !!commandCreateCorrelationParam(wf))
    .map((wf) => stateLoader(wf))
    .join("\n\n");
  const loadersBlock = sagaLoaders ? `${sagaLoaders}\n\n\n` : "";
  // `payloadModels` leads: the `<Wf>Request` models in `models` reference the
  // `<Payload>Response` classes it declares, and Python resolves an annotation
  // at class-definition time.
  const body = `${payloadModels}${models}${instanceModels}${loadersBlock}${helpersBlock}router = ${H.APIRouter}(prefix="/workflows", tags=["workflows"])\n\n\n${routes}`;

  return lines(
    `"""Workflow routes.  Auto-generated."""`,
    "",
    PY_IMPORTS,
    ...resourceImports,
    "",
    PY_SESSION_DEP,
    "",
    "",
    body,
    "",
  );
}

interface RepoNeed {
  repoName: string;
  aggName: string;
}

// INSERTION ORDER is load-bearing (the repo-construction lines this feeds
// emit in iteration order), so `reposFor` rides `walkWorkflowStmtChildren`
// (wave-2 packet 2.3) for the RECURSION step only — the exhaustive,
// `never`-checked "which kinds nest further bodies" fact `walk.ts` owns —
// while keeping its own per-kind ordering around it, exactly as it was.
function reposFor(wf: WorkflowIR): RepoNeed[] {
  return reposNeeded([wf.statements], wf.savesAtExit);
}

// --- read-port wiring (domain-services.md rev. 4) -----------------
//
// A `reading`-tier domain-service operation declares one read-port repository
// parameter per repo it reads; the orchestrating caller constructs each repo
// handle and passes it ahead of the user args.  Both the call-site prepend
// (`pyReadPortResolver`) and the repo construction (`mergeReadPortRepos`, over
// `serviceReadPorts`) consume the SAME shared `readPortsForOperation`
// derivation, so they stay in lockstep.  A PURE service call has zero ports →
// no handle, no `await` → byte-identical.
//
// A `workflow` is not the only orchestrator that can call a reading service —
// an explicit `commandHandler`/`queryHandler` can too, and
// `explicit-handlers-emit.ts` reads the same resolver and `serviceReadPorts`
// rather than growing a second derivation.

/** Build the read-port resolver for a `reading`-tier domain-service call.
 *  Given a `<service>.<op>` call, returns the repository handle var names
 *  (`snake(repo)` — the var the caller constructs) to prepend, in first-read
 *  order.  A pure service op has no ports → `[]` → byte-identical.
 *
 *  Exported because the EXPLICIT-HANDLER emitter (`explicit-handlers-emit.ts`)
 *  is the second orchestrator that can call a reading service and must supply
 *  the same handles — it was the only caller shape that did not, which is
 *  M-T5.14's python arm (`free = is_holder_free(holder)` against an
 *  `is_holder_free(accounts, holder)` declaration: ruff F821 on the missing
 *  import, and arity-short even with one). */
export function pyReadPortResolver(
  ctx: EnrichedBoundedContextIR,
): (service: string, op: string) => string[] {
  return (service, op) => serviceOpReadPorts(ctx, service, op).map((p) => pythonIdent(p.repo));
}

/** Merge a workflow's directly-used repos with the read-port repos its
 *  `reading`-tier domain-service calls require, de-duplicated by repository
 *  name (a repo the workflow already constructs is not added twice).  Service
 *  ports append after the workflow's own repos so a port-only project stays a
 *  pure extension. */
function mergeReadPortRepos(
  own: RepoNeed[],
  wf: WorkflowIR,
  ctx: EnrichedBoundedContextIR,
): RepoNeed[] {
  return withReadPortRepos(own, serviceReadPorts(wf.statements, [], ctx));
}

/** Names of `let` bindings the emitted body still needs — every `let`
 *  read in an expression (`refsRead`), PLUS the bindings a
 *  statement names structurally rather than through an `ExprIR`: an `op-call`
 *  receiver (`j.mark(…)` carries `target: "j"`, not a `ref`) and every
 *  exit / per-iteration / branch save (`await jobs.save(j)`).  A `repo-let`
 *  absent from this set is a pure existence check (`let t = Techs.getById(tech)`
 *  then never touched) — the emitter keeps the awaited `get_by_id` (it still
 *  404s on a missing id) but drops the dead assignment, or ruff F841 rejects
 *  the route. */
export function collectLiveLetNames(
  sts: readonly WorkflowStmtIR[],
  savesAtExit: readonly { name: string }[],
): Set<string> {
  const live = refsRead(sts, [], "let");
  for (const s of savesAtExit) live.add(s.name);
  // Closed, never-checked: a new statement kind that names a binding
  // outside an `ExprIR` must decide here whether it keeps a `let` alive.
  for (const st of sts)
    walkWorkflowStmtsDeep(st, (n) => {
      switch (n.kind) {
        case "op-call":
          live.add(n.target);
          return;
        case "for-each":
          for (const s of n.savesPerIteration) live.add(s.name);
          return;
        case "if-let":
          for (const s of [...n.savesInThen, ...n.savesInElse]) live.add(s.name);
          return;
        case "variant-match":
          for (const s of [...n.arms.flatMap((a) => a.savesInArm), ...n.savesInElse]) {
            live.add(s.name);
          }
          return;
        case "precondition":
        case "requires":
        case "emit":
        case "factory-let":
        case "repo-let":
        case "expr-let":
        case "repo-run":
        case "repo-delete":
        case "resource-call":
        case "domain-service-call":
        case "assign":
        case "not-found":
          return;
        default: {
          const _exhaustive: never = n;
          return _exhaustive;
        }
      }
    });
  return live;
}

/** Whether a `match` arm (or any arm of `st` — a binding name is scoped to
 *  its arm, and arms that share one read it the same way) names `binding`:
 *  an expression read, an operation called on it, or a save of it. */
function armReads(
  st: Extract<WorkflowStmtIR, { kind: "variant-match" }>,
  binding: string,
): boolean {
  return st.arms.some(
    (arm) =>
      arm.binding === binding &&
      (arm.savesInArm.some((s) => s.name === binding) || namesUsed(arm.body).has(binding)),
  );
}

/** Postgres `isolation_level` execution-option string for a DSL level. */
function pyIsolationLevel(level: import("../../ir/types/loom-ir.js").IsolationLevel): string {
  switch (level) {
    case "readUncommitted":
      return "READ UNCOMMITTED";
    case "readCommitted":
      return "READ COMMITTED";
    case "repeatableRead":
      return "REPEATABLE READ";
    case "serializable":
      return "SERIALIZABLE";
  }
}

// Workflow `function` helpers — module-scoped `def`s, namespaced by workflow.
// Pure over params (validator-guaranteed, no `self`), so a plain `renderPyExpr` /
// `renderPyStatements` renders the body safely.  Both the expression form and
// the pure block form (domain-services.md rev. 4) are supported.
function workflowFnHelpers(wf: WorkflowIR): string[] {
  const out: string[] = [];
  for (const fn of wf.functions ?? []) {
    const params = fn.params
      .map((p) => `${pythonIdent(p.name)}: ${renderPyType(p.type)}`)
      .join(", ");
    const name = workflowFnSnake(wf.name, fn.name);
    const head = `def ${name}(${params}) -> ${renderPyType(fn.returnType)}:`;
    // Module-level def → 4-space body indent (methods use 8).
    const body =
      "expr" in fn.body
        ? `    return ${renderPyExpr(fn.body.expr)}`
        : renderPyStatements(fn.body.stmts, "    ");
    out.push(`${head}\n${body}`);
  }
  return out;
}

/** `_load_<wf>(session, key)` — the persisted correlation row by its key.
 *  Mirrors `stateHelpers` in `dispatch-builder.ts` (same name, same shape), so
 *  a workflow that is both command-routed and subscribed reads its row the
 *  same way on both paths. */
function stateLoader(wf: WorkflowIR): string {
  const row = rowRef(wf);
  const corr = snake(wf.correlationField as string);
  return lines(
    `async def _load_${snake(wf.name)}(session: ${H.AsyncSession}, key: str) -> ${row} | None:`,
    `    return (`,
    `        await session.execute(${SELECT}(${row}).where(${row}.${corr} == key).limit(1))`,
    "    ).scalars().first()",
  );
}

function workflowRoute(
  wf: WorkflowIR,
  ctx: EnrichedBoundedContextIR,
  dispatcherExpr: string,
  sys?: SystemIR,
  /** Source-map — see `buildPyWorkflowsFile`'s `opFragments`. */
  opFragments?: OpFragment[],
): string {
  // A `requires`-guarded workflow declares its 403 outcome; a
  // currentUser-referencing one binds the actor off the request scope
  // before any rendered statement mentions the bare `current_user`.
  const usesUser = workflowNeedsCurrentUser(wf, ctx);
  const needsRequest = usesUser || commandCreateEntryResult(wf) !== undefined;
  const sig = [
    pyCommandBodyParam(`${upperFirst(wf.name)}Request`, wf.params),
    ...(needsRequest ? [PY_REQUEST_PARAM] : []),
    "session: SessionDep",
  ].join(", ");
  // `create(…): T { … return <expr> }` — 200 with the value; FastAPI publishes
  // the 200 schema from the return annotation (the response-direction wire type
  // the aggregate DTOs use: an id is its `str`).  No result keeps the 204.
  const result = commandCreateResult(wf);
  // An expected-failure result (`T or E`): the tagged dict at 200 (its schema
  // is injected by `install_openapi`), each error arm at its mapped status.
  const er = commandCreateEntryResult(wf);
  const selfResult = isWorkflowSelfType(wf, result?.type);
  const returnAnnotation = er
    ? `dict[str, object] | ${H.JSONResponse}`
    : selfResult
      ? "dict[str, object]"
      : result
        ? responsePyType(result.type, ctx)
        : H.Response;
  const out: string[] = [
    `@router.post("/${snake(wf.name)}", ${er ? "response_model=None, " : selfResult ? `response_model=${upperFirst(wf.name)}InstanceResponse, ` : ""}status_code=${result ? 200 : 204}, operation_id="${camelId(opWorkflow(wf.name))}"${errorResponsesKwarg(
      "workflow",
      workflowIsGuarded(wf),
      er ? entryErrorStatusesPy(er, ctx) : [],
      conflictResolver(ctx),
      {
        readsAggregate: workflowCanAnswerNotFound(wf, ctx),
      },
    )})`,
    // A route-invoked workflow runs in a child frame under the request root, so
    // its audit / provenance rows are distinguishable from a direct operation's.
    `@${IN_CHILD_CONTEXT}`,
    `async def ${snake(wf.name)}_workflow(${sig}) -> ${returnAnnotation}:`,
    ...(usesUser ? [PY_USER_BIND] : []),
    // Workflow narrative — `workflow_started` at the route entry; shared catalog
    // identity (field `workflow`) across every backend.
    `    ${PY.log}("${LogEvents.workflowStarted.level}", "${LogEvents.workflowStarted.event}", workflow=${JSON.stringify(wf.name)})`,
    // Everything from here to the 204 runs inside a `try`, so a run that
    // raises can log its TERMINAL event (`workflow_failed`) before the
    // exception continues to FastAPI's handler untouched.  Without it a failed
    // workflow logged `workflow_started` and then nothing at all — "started but
    // never finished" read exactly like "still running", and every
    // started/completed pairing in a dashboard leaked one row per failure.
    // The body is rendered AT the deeper indent (the chunk renderer takes its
    // pad as an argument) rather than re-indented afterwards, so the chunk
    // texts the source-map anchors on stay exactly the text in the file.
    "    try:",
  ];
  // A `transactional(<level>)` workflow (or its state dataSource's
  // `isolationLevel:`) pins the request transaction's isolation before any
  // query runs — parity with the .NET BeginTransactionAsync(IsolationLevel.X)
  // and Java @Transactional(isolation = …) paths.
  const isolation = workflowIsolation(wf, ctx, sys);
  if (isolation) {
    out.push(
      `        await session.connection(execution_options={"isolation_level": "${pyIsolationLevel(isolation)}"})`,
    );
  }
  // Wire params → domain locals (brand ids, build VOs) once up front — but
  // only the params the body (or the F58 correlation row loader) actually
  // READS.  A param bound and never read is ruff F841 in the generated route
  // (the corpus python leg runs `ruff check` as a gate), and a create that
  // takes a param it does not use is valid `.ddd` (`workflow-primitive-params`
  // exercises exactly that shape to pin the wire types).
  const readParams = refsRead(wf.statements, [result?.value], "param");
  const readCorrParam = commandCreateCorrelationParam(wf);
  if (readCorrParam) readParams.add(readCorrParam.name);
  for (const p of wf.params) {
    if (!readParams.has(p.name)) continue;
    out.push(
      `        ${pythonIdent(p.name)} = ${pyWireToDomain(`body.${pythonWireIdent(p.name)}`, p.type, ctx)}`,
    );
  }
  // F58 — a CORRELATED command workflow addresses a real persisted saga row:
  // load-or-allocate it exactly as the event-triggered starter in
  // `dispatch-builder.ts` does, and render the body against it
  // (`thisName: "state"` → `state.<snake(field)>`).  Before this the route fell
  // through to the `self` scratch branch below — which M-T6.50 skipped for a
  // correlated workflow, on the belief that "its own-state path (the
  // dispatch-file reactor) already maps correctly onto the persisted row".
  // That is exactly what F58 disproved: the REACTOR maps, the COMMAND ROUTE did
  // not, so `self._status = …` reached a module-level `async def` with no
  // `self` (a NameError) and the correlation row was never created — a later
  // `on` reactor for the same key logged `event_unrouted` forever.
  const corrParam = commandCreateCorrelationParam(wf);
  if (corrParam) {
    out.push(`        __key = str(${snake(corrParam.name)})`);
    out.push(`        state = await _load_${snake(wf.name)}(session, __key)`);
    out.push("        if state is None:");
    out.push(`            state = ${rowRef(wf)}(${allocateKwargs(wf, ctx)})`);
    out.push("            session.add(state)");
  } else if (workflowBodyUsesOwnState(wf.statements)) {
    // Own-state (`field := value`) on an UNCORRELATED command workflow
    // (M-T6.50): there is no persisted saga row to write through, and this
    // route is a module-level `async def`, not a method — so the render
    // context's default `self._x` mapping (`pyWorkflowStmtTarget`'s `assign`
    // arm) has no `self` to land on.  Seed a genuine local namespace instead:
    // scratch state that lives only for this one request, typed-zeroed exactly
    // like a fresh saga row allocates (`allocateKwargs`/`zeroFor` in
    // dispatch-builder.ts).  Skipped when the body never touches own state (a
    // dead `self = SimpleNamespace()` would trip ruff F841).
    //
    // Attribute names carry the leading underscore: every own-state read/write
    // renders `self._<field>` (the same `self._foo` private-backing-field
    // convention an aggregate operation's own fields use — `render-expr.ts`'s
    // `this-prop` case, unchanged here), so the namespace's attrs must match.
    //
    // Emitted at the body's own 8-space base: M-T6.50 wrote it at 4, which is
    // an `IndentationError` inside the route's `try:` — the scratch never
    // parsed (F58 bycatch).
    const initKwargs = (wf.stateFields ?? [])
      .map((f) => `_${snake(f.name)}=${f.optional ? "None" : zeroFor(f, ctx)}`)
      .join(", ");
    out.push(`        self = ${SIMPLE_NAMESPACE}(${initKwargs})`);
  }
  // Read-port repos (domain-services.md rev. 4): a `reading`-tier
  // domain-service call the workflow makes needs a live repository handle, so
  // the workflow constructs `<Agg>Repository(session, …)` for those repos even
  // when its own body never reads them — `mergeReadPortRepos` folds the service
  // ports into the workflow's repo set, de-duplicated by repo name.  A pure
  // service call adds no ports → byte-identical.
  const repos = mergeReadPortRepos(reposFor(wf), wf, ctx);
  for (const r of repos) {
    out.push(
      `        ${pythonIdent(r.repoName)} = ${repoClassRef(r.aggName)}(session, ${dispatcherExpr})`,
    );
  }
  const hasEmit = workflowEmits(wf.statements).length > 0;
  if (hasEmit) out.push(`        workflow_events: list[${DOMAIN_EVENT}] = []`);
  const saveLines = pySaveRenderer(wf.statements, ctx.aggregates);
  // Chunked (one lines-array per top-level statement) rather than the
  // pre-flattened `renderWorkflowStmts` — byte-identical either way
  // (`renderWorkflowStmts` IS `chunks.flat()` by construction), but the
  // per-chunk list lets us surface per-statement sub-regions to the caller
  // that owns the recorder + this file's final content (source-map).
  // No re-indent transform sits between here and the final
  // file (unlike the .NET transactional path), so the chunk texts collected
  // here are already the exact text that lands in `workflows_routes.py` —
  // which is why the `try:` above passes its deeper pad IN rather than
  // re-indenting the rendered lines afterwards.
  const stmtChunks = renderWorkflowStmtChunks(
    wf.statements,
    // Thread the read-port resolver so a `reading`-tier domain-service call in
    // the body is supplied its repository handle(s) ahead of the user args
    // (domain-services.md rev. 4).  PURE service calls resolve to
    // `[]` → byte-identical.
    pyWorkflowStmtTarget(
      {
        thisName: corrParam ? "state" : "self",
        readPortArgs: pyReadPortResolver(ctx),
      },
      ctx,
      collectLiveLetNames(wf.statements, wf.savesAtExit),
      saveLines,
      writeScopeContext(wf.statements, ctx),
    ),
    "        ",
  );
  out.push(...stmtChunks.flat());
  if (opFragments) {
    const chunkTexts = stmtChunks.map((ls) => ls.join("\n"));
    if (chunkTexts.length > 0) {
      opFragments.push({
        // Spelled: the recorder locates the fragment in the FINALIZED file.
        fragmentText: spellMarkers(chunkTexts.join("\n")),
        subRegions: statementSubRegions(wf.statements, chunkTexts, `${ctx.name}.${wf.name}`),
      });
    }
  }
  for (const save of wf.savesAtExit) out.push(...saveLines(save, "        "));
  // Persist the saga row (a fresh allocation, or a `this.<stateField>` write) so
  // a later `on` reactor for the same key routes instead of dropping the event.
  if (corrParam) out.push("        await session.flush()");
  const resultCtx = {
    thisName: corrParam ? "state" : "self",
    readPortArgs: pyReadPortResolver(ctx),
  };
  if (er && result?.type.kind === "union") {
    out.push(
      ...entryResultPyLines(
        er,
        result.type,
        (e) => renderPyExpr(e, resultCtx),
        ctx,
        "        ",
        "workflow_result",
        (agg) => snake(repos.find((r) => r.aggName === agg)?.repoName ?? plural(agg)),
        (f) => instanceFieldValue("state", f),
        wf.instanceWireShape ?? [],
      ),
      // The 4xx answer is what rolls the request's transaction back.
      ...entryErrorPyLines(er, ctx, "workflow_result", H.JSONResponse, "        "),
    );
  } else if (selfResult) {
    out.push(
      `        workflow_result: dict[str, object] = {${(wf.instanceWireShape ?? [])
        .map((f) => `"${f.name}": ${instanceFieldValue("state", f)}`)
        .join(", ")}}`,
    );
  } else if (result) {
    out.push(`        workflow_result = ${renderPyExpr(result.value, resultCtx)}`);
  }
  if (hasEmit) {
    out.push(`        dispatcher = ${dispatcherExpr}`);
    out.push("        for ev in workflow_events:");
    out.push("            await dispatcher.dispatch(ev)");
  }
  // `workflow_completed` on the success tail — a raised guard / domain error
  // short-circuits before reaching here.
  out.push(
    `        ${PY.log}("${LogEvents.workflowCompleted.level}", "${LogEvents.workflowCompleted.event}", workflow=${JSON.stringify(wf.name)})`,
  );
  out.push(
    result ? "        return workflow_result" : `        return ${H.Response}(status_code=204)`,
  );
  // `raise` re-raises the ORIGINAL exception with its traceback intact, so the
  // status FastAPI's handler picks is exactly what it was before.
  out.push("    except Exception as exc:");
  out.push(
    `        ${PY.log}("${LogEvents.workflowFailed.level}", "${LogEvents.workflowFailed.event}", workflow=${JSON.stringify(wf.name)}, error=str(exc))`,
  );
  out.push("        raise");
  return out.join("\n");
}

// --- instance read endpoints (workflow-instance-visibility.md) ------------------

/** The instance Response DTO + its list carrier for an observable workflow —
 *  walks `instanceWireShape` the same way `routes-builder.responseModel` walks
 *  an aggregate's wire shape (id-source rows are `str`, the rest go through the
 *  shared `responsePyType`).  `<Wf>InstanceListResponse` is a `RootModel` so
 *  FastAPI emits a `$ref` to a named array component (parity with the aggregate
 *  `<Agg>ListResponse`). */
function instanceResponseModels(wf: WorkflowIR, ctx: EnrichedBoundedContextIR): string {
  const T = upperFirst(wf.name);
  const shape = wf.instanceWireShape ?? [];
  const fieldLines = shape.map((f) => {
    const t = f.source === "id" ? "str" : responsePyType(f.type, ctx);
    const optional = f.optional || f.type.kind === "optional";
    const suffix = optional && !t.endsWith("| None") ? " | None = None" : optional ? " = None" : "";
    return withFieldConstraint(f.name, `${t}${suffix}`, undefined);
  });
  return lines(
    `class ${T}InstanceResponse(${H.BaseModel}):`,
    fieldLines.length > 0 ? fieldLines : ["    pass"],
    "",
    "",
    `class ${T}InstanceListResponse(${H.RootModel}[list[${T}InstanceResponse]]):`,
    "    pass",
    "",
    "",
  );
}

/** GET `/<snake>/instances` (list) + `/<snake>/instances/{id}` (by correlation
 *  id, 404 if absent) over the persisted saga-state row the dispatcher upserts.
 *  Reads the `<Wf>Row` SQLAlchemy model directly (the same row
 *  `dispatch-builder` loads-or-allocates); each row projects through
 *  `instanceWireShape` (camelCase wire key ← snake column), datetimes ISO-coded
 *  exactly as the aggregate `to_wire`.  `session.get` keys on the PK (the
 *  correlation field). */
function instanceRoutes(wf: WorkflowIR, ctx: EnrichedBoundedContextIR): string {
  const T = upperFirst(wf.name);
  // The instance-READ gate (`workflow X requires <expr>`) — 403 before the
  // store is touched, on BOTH routes.  Declared through the shared status
  // table so a remapped `Forbidden` rung moves the handler and the published
  // response set together.
  const gate = wf.instanceReadGate;
  const gateUsesUser = !!gate && exprUsesCurrentUser(gate);
  const userParam = gateUsesUser ? `${PY_REQUEST_PARAM}, ` : "";
  const gateLines: LinesPart = gate
    ? [
        gateUsesUser ? PY_USER_BIND : null,
        `    if ${renderPyNegatedGuard(gate)}:`,
        `        raise ${PY.ForbiddenError}(${JSON.stringify(`Forbidden: workflow ${wf.name} instances`)})`,
      ]
    : null;
  const resolve = wireStatusResolver(ctx.structuralErrorStatuses);
  const listKwarg = errorResponsesKwarg("findList", !!gate, [], resolve);
  const byIdKwarg = gate
    ? errorResponsesKwarg("findOptional", true, [], resolve)
    : errorResponsesKwarg("getById", false, [], resolve);
  const slug = snake(wf.name);
  const row = rowRef(wf);
  const shape = wf.instanceWireShape ?? [];
  const proj = (rowVar: string): string =>
    shape.map((f) => `"${f.name}": ${instanceFieldValue(rowVar, f)}`).join(", ");
  // The read body diverges on `wf.eventSourced`: a state-based saga selects the
  // `<Wf>Row` correlation row directly, while an event-sourced workflow folds
  // the per-correlation `<wf>_events` stream via the dispatch fold helpers —
  // LIST through `_load_all_<wf>` (group-fold, mirroring the ES-aggregate
  // repository list), byId through `_load_<wf>_events` + `_fold_<wf>` (404 on an
  // empty stream).  The folded `<Wf>State` instance exposes the same public
  // snake-cased attrs `instance_field_value` projects, so the projection,
  // operationIds, and route paths stay identical to the state path.
  const fns = esFns(wf);
  // The correlation id is a guid, so the `{id}` param is the uuid-format str
  // `ID_PARAM` — parity with Hono / .NET / Java / Phoenix.
  const idParam = ID_PARAM;
  const list = wf.eventSourced
    ? lines(
        `@router.get("/${slug}/instances", response_model=${T}InstanceListResponse, operation_id="${camelId(opWorkflowInstances(wf.name))}"${listKwarg})`,
        `async def ${slug}_instances(${userParam}session: SessionDep) -> list[dict[str, object]]:`,
        gateLines,
        `    rows = await ${dispatchFn(fns.loadAll)}(session)`,
        `    return [{${proj("row")}} for row in rows]`,
      )
    : lines(
        `@router.get("/${slug}/instances", response_model=${T}InstanceListResponse, operation_id="${camelId(opWorkflowInstances(wf.name))}"${listKwarg})`,
        `async def ${slug}_instances(${userParam}session: SessionDep) -> list[dict[str, object]]:`,
        gateLines,
        `    rows = (await session.execute(${SELECT}(${row}))).scalars().all()`,
        `    return [{${proj("row")}} for row in rows]`,
      );
  const byId = wf.eventSourced
    ? lines(
        `@router.get("/${slug}/instances/{id}", response_model=${T}InstanceResponse, operation_id="${camelId(opWorkflowInstanceById(wf.name))}"${byIdKwarg})`,
        `async def ${slug}_instance(${idParam}, ${userParam}session: SessionDep) -> dict[str, object]:`,
        gateLines,
        `    __stream = await ${dispatchFn(fns.load)}(session, id)`,
        "    if not __stream:",
        `        ${pyNotFoundRaise(H.AggregateNotFoundError, T, "id")}`,
        `    row = ${dispatchFn(fns.fold)}(id, __stream)`,
        `    return {${proj("row")}}`,
      )
    : lines(
        `@router.get("/${slug}/instances/{id}", response_model=${T}InstanceResponse, operation_id="${camelId(opWorkflowInstanceById(wf.name))}"${byIdKwarg})`,
        `async def ${slug}_instance(${idParam}, ${userParam}session: SessionDep) -> dict[str, object]:`,
        gateLines,
        `    row = await session.get(${row}, id)`,
        "    if row is None:",
        `        ${pyNotFoundRaise(H.AggregateNotFoundError, T, "id")}`,
        `    return {${proj("row")}}`,
      );
  return [list, byId].join("\n\n\n");
}

/** One saga-row field projected to its wire value.  Mirrors the aggregate
 *  `wireValue`: datetimes ISO-encode, everything else (id / enum stored as its
 *  value text / scalar) passes through the column verbatim.  Shared with the
 *  workflow-instance read-model emitter. */
export function instanceFieldValue(rowVar: string, f: WireField): string {
  const attr = `${rowVar}.${pythonIdent(f.name)}`;
  const t = f.type.kind === "optional" ? f.type.inner : f.type;
  if (t.kind === "primitive" && t.name === "datetime") {
    return f.optional || f.type.kind === "optional"
      ? `(None if ${attr} is None else ${H.iso}(${attr}))`
      : `${H.iso}(${attr})`;
  }
  if (t.kind === "primitive" && t.name === "date") {
    return f.optional || f.type.kind === "optional"
      ? `(None if ${attr} is None else ${pyCalendarDateWire(attr)})`
      : pyCalendarDateWire(attr);
  }
  if (t.kind === "primitive" && t.name === "money") {
    // Precise-decimal string on the wire (parity with the other backends).
    const wire = numericEncode(PY_NUMERIC, "money", "dto-map", attr);
    return f.optional || f.type.kind === "optional"
      ? `(None if ${attr} is None else ${wire})`
      : wire;
  }
  return attr;
}

// The Python leaf table for the shared workflow statement spine
// (`_workflow/stmt-target.ts`). One method per `WorkflowStmtIR` kind; the
// dispatch + `for-each` recursion live in the spine.  The table closes
// over the render context (saga handlers render `this.<state>` against
// the tracked row via `thisName: "state"`) and, when a context is
// given, threads the actor into currentUser-gated op-calls.  `saveLines`
// renders every nested (per-iteration / per-branch) save, so a loop- or
// branch-scoped persist takes the aggregate's lifecycle stamp exactly like an
// exit save does.
/** A named workflow precondition also hands up the values it read (the wire
 *  `params`); empty for an unnamed one. */
function precondParams(st: { expr: ExprIR; message?: unknown }, rctx: PyRenderContext): string {
  const params = st.message
    ? pyRuleParams({ expr: st.expr }, (e) => renderPyExpr(e, rctx))
    : undefined;
  return params ? `, ${params}` : "";
}

export function pyWorkflowStmtTarget(
  rctx: PyRenderContext,
  ctx: EnrichedBoundedContextIR | undefined,
  usedLets: ReadonlySet<string> | undefined,
  saveLines: PySaveLines,
  /** The body's write-scope requirement — present on a command body (a
   *  workflow's command route, an explicit command handler); a reactor
   *  passes none. */
  writeScope?: WriteScopeContext,
): WorkflowStmtTarget {
  /** The awaited criterion retrieval run capped at one row — the
   *  single-result read behind `Repo.find(<Criterion>)` in a `let` and an
   *  `if let`. */
  const runFirstRow = (repoName: string, retrievalName: string, args: readonly ExprIR[]): string =>
    `await ${pythonIdent(repoName)}.run_${snake(retrievalName)}(${[...args.map((a) => renderPyExpr(a, rctx)), "limit=1"].join(", ")})`;
  return {
    indentUnit: "    ",
    precondition: (st, i) => [
      `${i}if ${renderPyNegatedGuard(st.expr, rctx)}:`,
      `${i}    raise ${PY.DomainError}(${workflowPreconditionThrowArgs(st, JSON.stringify("precondition"))}${precondParams(st, rctx)})`,
    ],
    requires: (st, i) => [
      `${i}if ${renderPyNegatedGuard(st.expr, rctx)}:`,
      `${i}    raise ${PY.ForbiddenError}(${JSON.stringify(`Forbidden: ${st.source}`)})`,
    ],
    emit: (st, i) => {
      const kwargs = st.fields
        .map((f) => `${pythonIdent(f.name)}=${renderPyExpr(f.value, rctx)}`)
        .join(", ");
      return [`${i}workflow_events.append(${eventRef(st.eventName)}(${kwargs}))`];
    },
    factoryLet: (st, i) => {
      const kwargs = st.fields
        .map((f) => `${pythonIdent(f.name)}=${renderPyExpr(f.value, rctx)}`)
        .join(", ");
      return [`${i}${snake(st.name)} = ${aggClassRef(st.aggName)}.create(${kwargs})`];
    },
    repoLet: (st, i) => {
      // A criterion read (`let c = Repo.find(<Criterion>)`) runs the shared
      // retrieval for one row and binds it or `None` — the `if let` lookup.
      if (st.op === "select-one" && st.retrievalName) {
        const run = runFirstRow(st.repoName, st.retrievalName, st.args);
        if (usedLets && !usedLets.has(st.name)) return [`${i}${run}`];
        const v = snake(st.name);
        const hits = `__${v}_hits`;
        return [`${i}${hits} = ${run}`, `${i}${v} = ${hits}[0] if ${hits} else None`];
      }
      const args = st.args.map((a) => renderPyExpr(a, rctx)).join(", ");
      const call = `await ${pythonIdent(st.repoName)}.${snake(st.method)}(${args})`;
      // A load nothing reads, mutates or saves is an existence check: keep the
      // awaited call (a missing id still raises → 404) but drop the dead
      // binding, or ruff rejects the unused local (F841).  `usedLets` here is
      // `collectLiveLetNames` — op-call receivers and saves count as reads.
      if (usedLets && !usedLets.has(st.name)) return [`${i}${call}`];
      return [`${i}${snake(st.name)} = ${call}`];
    },
    repoRun: (st, i) => {
      const args = [
        ...st.retrievalArgs.map((a) => renderPyExpr(a, rctx)),
        ...(st.page?.offset ? [`offset=${renderPyExpr(st.page.offset, rctx)}`] : []),
        ...(st.page?.limit ? [`limit=${renderPyExpr(st.page.limit, rctx)}`] : []),
      ].join(", ");
      const call = `await ${pythonIdent(st.repoName)}.run_${snake(st.retrievalName)}(${args})`;
      // A `run` retrieval is a read (no exit-save), so a binding never read is
      // dead — keep the (still-awaited) call but drop the assignment, or ruff
      // rejects the unused local (F841).  Mirrors the `exprLet` arm.
      if (usedLets && !usedLets.has(st.name)) return [`${i}${call}`];
      return [`${i}${snake(st.name)} = ${call}`];
    },
    exprLet: (st, i) => {
      const rendered = renderPyExpr(st.expr, rctx);
      // A dead `let` (binding never read) would trip ruff F841 — drop the
      // assignment but keep the RHS, which is still side-effecting (a resource
      // get/fetch).  A bare resource-op renders as `(await …)`; strip the parens
      // so it's a statement, mirroring the `resourceCall` arm.
      if (usedLets && !usedLets.has(st.name)) {
        const bare = rendered.startsWith("(await ") ? rendered.slice(1, -1) : rendered;
        return [`${i}${bare}`];
      }
      return [`${i}${snake(st.name)} = ${rendered}`];
    },
    // `field := value` — own-state mutation.  Render the LHS as a synthetic
    // `this-prop` ref so it reuses the `state.<snake>` mapping (persisted
    // correlation row, `thisName = "state"`); the handler saves the row at exit.
    assign: (st, i) => {
      const lhs = renderPyExpr(
        { kind: "ref", name: st.target.segments[0]!, refKind: "this-prop", type: st.targetType },
        rctx,
      );
      return [`${i}${lhs} = ${renderPyExpr(st.value, rctx)}`];
    },
    opCall: (st, i) => {
      // A currentUser-gated op takes the actor as its trailing argument
      // (in scope: the route bound `current_user` for this workflow).
      const op = ctx ? lookupOp(ctx, st.aggName, st.op) : undefined;
      const renderedArgs = st.args.map((a) => renderPyExpr(a, rctx));
      const args = [
        ...renderedArgs,
        ...(op && operationBodyUsesCurrentUser(op) ? ["current_user"] : []),
      ].join(", ");
      // The op's authorization gate is hoisted out of the entity
      // (op-gates.ts), so EVERY caller owns it — this inline op-call included.
      // Emitting it here is what keeps the hoist enforcement-neutral instead
      // of silently dropping the check on the non-HTTP path.
      const gateLines = (op ? operationGates(op) : []).flatMap((g) => {
        const guard = renderPyNegatedGuard(g.expr, {
          ...rctx,
          thisName: snake(st.target),
          paramExpr: (name) => {
            const idx = op!.params.findIndex((q) => q.name === name);
            return idx >= 0 ? renderedArgs[idx] : undefined;
          },
        });
        return [
          `${i}if ${guard}:`,
          `${i}    raise ${PY.ForbiddenError}(${JSON.stringify(`Forbidden: ${g.source}`)})`,
        ];
      });
      // `let r = a.op(…)` binds the call's value (unless nothing reads it —
      // ruff F841); the bare statement discards it.
      const bind =
        st.result && (!usedLets || usedLets.has(st.result.name))
          ? `${snake(st.result.name)} = `
          : "";
      return [
        ...gateLines,
        `${i}${bind}${snake(st.target)}.${DOMAIN_NAMES.python.method(st.op)}(${args})`,
      ];
    },
    repoDelete: (st, i) => {
      // `<Repo>.delete(o)` → `await <repo>.delete(<entity>.id)`.  The generated
      // repository's `delete(id)` takes the aggregate's id token, so append
      // `.id`.  Repo var mirrors the repo-let arm (`pythonIdent(repoName)`).
      return [`${i}await ${pythonIdent(st.repoName)}.delete(${renderPyExpr(st.entity, rctx)}.id)`];
    },
    forEach: (st, i, body) => {
      const saves = st.savesPerIteration.flatMap((s) => saveLines(s, `${i}    `));
      return [
        `${i}for ${snake(st.var)} in ${renderPyExpr(st.iterable, rctx)}:`,
        ...(body.length + saves.length > 0 ? [...body, ...saves] : [`${i}    pass`]),
      ];
    },
    ifLet: (st, i, thenLines, elseLines) => {
      // `if let o = Repo.find(<Criterion>) { … } else { … }` → run the shared
      // `find_all_by_<criterion>` retrieval with `limit=1`, take the first row
      // (or `None`), and branch.  Each branch's dirty bindings save inside it.
      const v = snake(st.var);
      const hits = `__${v}_hits`;
      const inner = `${i}    `;
      const thenSaves = st.savesInThen.flatMap((s) => saveLines(s, inner));
      const elseSaves = st.savesInElse.flatMap((s) => saveLines(s, inner));
      const thenAll = [...thenLines, ...thenSaves];
      const elseAll = [...elseLines, ...elseSaves];
      // A declared optional find (`findMethod`) and `find_by_id` already
      // answer the row or `None`, so they bind directly; a `bound` source
      // narrows an optional binding already in scope.
      const byName = (method: string): string[] => [
        `${i}${v} = await ${pythonIdent(st.repoName)}.${snake(method)}(${st.retrievalArgs.map((a) => renderPyExpr(a, rctx)).join(", ")})`,
      ];
      const lookup =
        st.op === "bound"
          ? [`${i}${v} = ${st.retrievalArgs.map((a) => renderPyExpr(a, rctx)).join(", ")}`]
          : st.findMethod
            ? byName(st.findMethod)
            : st.op === "load-optional"
              ? byName("findById")
              : [
                  `${i}${hits} = ${runFirstRow(st.repoName, st.retrievalName, st.retrievalArgs)}`,
                  `${i}${v} = ${hits}[0] if ${hits} else None`,
                ];
      const out = [
        ...lookup,
        `${i}if ${v} is not None:`,
        ...(thenAll.length > 0 ? thenAll : [`${inner}pass`]),
      ];
      if (elseAll.length > 0) out.push(`${i}else:`, ...elseAll);
      return out;
    },
    variantMatch: (st, i, armLines, elseLines) => {
      // A `T?` subject: `if x is not None:` / `else:`.  A tagged union value is
      // the tagged dict, so each arm probes its `type`: `if x["type"] ==
      // "<Tag>":` / `elif …` / `else:`.  An arm binds the subject (a scalar
      // variant its `"value"`) only when its body reads the binding (ruff
      // F841), and saves what it dirtied at its own end.  An empty suite gets
      // a `pass`.
      const subject = renderPyExpr(st.subject, rctx);
      const inner = `${i}    `;
      const suite = (ls: readonly string[]) => (ls.length > 0 ? [...ls] : [`${inner}pass`]);
      const saves = (ss: readonly { name: string; aggName: string; repoName: string }[]) =>
        ss.flatMap((s) => saveLines(s, inner));
      if (st.subjectShape === "absence") {
        const { present, absent } = presenceSides(st, armLines, elseLines);
        const lines = (side: PresenceSide | undefined) =>
          side
            ? [
                ...(side.binding && armReads(st, side.binding)
                  ? [`${inner}${snake(side.binding)} = ${subject}`]
                  : []),
                ...side.lines,
                ...saves(side.saves),
              ]
            : [];
        const out = [`${i}if ${subject} is not None:`, ...suite(lines(present))];
        if (absent) out.push(`${i}else:`, ...suite(lines(absent)));
        return out;
      }
      const out: string[] = [];
      st.arms.forEach((arm, n) => {
        // The tagged dict is `dict[str, object]`, so a scalar's `"value"` is
        // cast to the variant's type for mypy.
        const value = isScalarVariant(arm.varType)
          ? `${PY.cast}(${renderPyType(arm.varType)}, ${subject}["value"])`
          : subject;
        out.push(
          `${i}${n === 0 ? "if" : "elif"} ${subject}["type"] == ${JSON.stringify(variantTag(arm.varType))}:`,
          ...suite([
            ...(arm.binding && armReads(st, arm.binding)
              ? [`${inner}${pythonIdent(arm.binding)} = ${value}`]
              : []),
            ...armLines[n]!,
            ...saves(arm.savesInArm),
          ]),
        );
      });
      if (st.elseBody) {
        const elseAll = [...elseLines, ...saves(st.savesInElse)];
        if (out.length === 0) return elseAll.map((l) => l.replace(/^ {4}/, ""));
        out.push(`${i}else:`, ...suite(elseAll));
      }
      return out;
    },
    // Bare `<resource>.<verb>(...)` statement — render-expr wraps the
    // resource-op in `(await …)`; a bare statement drops the parens.
    resourceCall: (st, i) => {
      const rendered = renderPyExpr(st.call, rctx);
      const bare = rendered.startsWith("(await ") ? rendered.slice(1, -1) : rendered;
      return [`${i}${bare}`];
    },
    // Bare `Transfer.run(src, dst, amount)` domain-service call
    // (domain-services.md rev. 4, the `mutating` tier).  Renders the bare module
    // function (`run(src, dst, amount)`); a reading service is `(await …)` —
    // strip the wrapping parens so it's a statement, like `resourceCall`.  The
    // mutated args persist via the workflow's exit-saves (`session` unit-of-work
    // `commit()` at the route boundary).
    domainServiceCall: (st, i) => {
      const rendered = renderPyExpr(st.call, rctx);
      const bare = rendered.startsWith("(await ") ? rendered.slice(1, -1) : rendered;
      const bind =
        st.result && (!usedLets || usedLets.has(st.result.name))
          ? `${snake(st.result.name)} = `
          : "";
      return [`${i}${bind}${bare}`];
    },
    // The error a by-id miss raises, so the app's not-found handler renders
    // the identical ProblemDetails.
    notFound: (st, i) => [
      `${i}raise ${PY.AggregateNotFoundError}(${JSON.stringify(notFoundStmtDetail(st))})`,
    ],
    // A held row is re-loaded through `get_by_id_for_write` — the load every
    // mutation route uses — before the statement mutates or deletes it; a row
    // outside the caller's write scope raises the same not-found (→ 404), and
    // the request's transaction rolls back on the error answer.
    ...(writeScope
      ? {
          writeScope: {
            cx: writeScope,
            guard: (g, i) => [
              `${i}await ${pythonIdent(g.repoName)}.get_by_id_for_write(${snake(g.name)}.id)`,
            ],
          },
        }
      : {}),
  };
}
