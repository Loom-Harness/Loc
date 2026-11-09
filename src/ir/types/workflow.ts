import type { ExprIR } from "./expr.js";
import type { ApplyIR, FieldIR, FunctionIR, ParamIR, WireField } from "./members.js";
import type { Sourced, TypeIR } from "./types.js";
import type { WorkflowStmtIR } from "./workflow-stmt.js";

/** SQL-92 isolation levels — optional on `transactional` workflows.
 *  When omitted, the connection's default level applies (Postgres
 *  defaults to `readCommitted`). */
export type IsolationLevel =
  | "readUncommitted"
  | "readCommitted"
  | "repeatableRead"
  | "serializable";

/** Context-level orchestration that loads + creates aggregates,
 *  invokes their public operations, and emits orchestration-level
 *  events.  Default save semantics: each aggregate's save commits
 *  independently.  `transactional: true` wraps everything in one DB
 *  transaction. */
export interface WorkflowIR extends Sourced {
  name: string;
  /** @deprecated Facade over the primary (unnamed, command-triggered) create —
   *  see `creates`.  Kept so the backend emitters (Hono / .NET / Phoenix /
   *  React) keep reading `params`/`statements`/`savesAtExit` unchanged after
   *  the A2-S5f reshape; they migrate to `creates` in a later slice. */
  params: ParamIR[];
  transactional: boolean;
  /** Set only when the source declared `transactional(<level>)`.
   *  Bare `transactional` leaves this undefined and the backend
   *  emits a transaction without an explicit level (connection
   *  default applies). */
  isolation?: IsolationLevel;
  /** @deprecated Facade over the primary create's body — see `creates`. */
  statements: WorkflowStmtIR[];
  /** @deprecated Facade over the primary create's saves — see `creates`.
   *  Which let-bindings need a save call at exit, in declaration order. */
  savesAtExit: { name: string; aggName: string; repoName: string }[];
  /** Workflow starters declared via `create [name](params) [by <expr>] { … }`
   *  members (workflow-and-applier.md A2-S5f).  The legacy paren-body lowers to
   *  a single unnamed command-triggered create.  This is the source of truth;
   *  `params`/`statements`/`savesAtExit` are a facade over the primary one. */
  creates: CreateIR[];
  /** Event-subscription reactors declared via `on(e: Event) [by <expr>] { … }`
   *  members (workflow-and-applier.md, surface slice).  Empty when
   *  the workflow declares none.  Consumed by the in-process dispatcher
   *  emission on node / dotnet / python (channels.md); the `by`
   *  correlation-field type-check runs in the IR validator (workflow-checks.ts).
   *  Java and elixir dispatch emission are the remaining gaps. */
  subscriptions: OnIR[];
  /** Workflow state fields declared as `Property` members — the correlation
   *  field plus saga state (workflow-and-applier.md A2-S2).  Lowered with the
   *  same `lowerField` as aggregate fields.  Empty when the workflow
   *  declares none.  Emitted as a persisted correlation-state row by the saga
   *  dispatcher (node / dotnet / elixir / python) and read back through the
   *  instance endpoints derived from `instanceWireShape`. */
  stateFields: FieldIR[];
  /** The single id-shaped state field the runtime routes inbound events to
   *  (workflow-and-applier.md §"Identity and correlation").  Set only when
   *  exactly one id-shaped state field exists; absence / ambiguity are
   *  diagnosed by the IR validator. */
  correlationField?: string;
  /** `eventSourced` workflow (workflow-and-applier.md A2-S5b): command /
   *  reactor handlers may only `emit`, and state transitions live in
   *  `apply(...)` folds — exactly the event-sourced discipline aggregates
   *  carry via `persistedAs: eventLog`. */
  eventSourced: boolean;
  /** Event-fold appliers declared via `apply(e: Event) { … }` members on an
   *  `eventSourced` workflow.  Lowered with the workflow's `this`-bound env
   *  (A2-S5a), so bodies fold events into workflow state.  Empty when the
   *  workflow declares none. */
  appliers: ApplyIR[];
  /** Private pure helpers declared via `function f(...): T = expr` or the block
   *  form `function f(...): T { let … return … }` — the aggregate-parity helper
   *  (a workflow is a state-bearing entity, so it factors shared expressions the
   *  same way).  A workflow body is not a class, so each backend emits these as
   *  per-workflow-scoped module helpers (`<wf><fn>`), and a call to one lowers to
   *  `callKind: "workflow-fn"`.  BOTH body forms are accepted — this comment used
   *  to say the block form is rejected by `loom.workflow-function-block-body`, a
   *  code that has never existed.  Empty when the workflow declares none. */
  functions: FunctionIR[];
  /** Tail-position success type of the primary `run` body, derived once in
   *  enrichment (`enrichWorkflowReturnType`).  The value the workflow returns
   *  on the happy path is the last value-binding statement's result (the same
   *  `last-bind` rule the backends use to pick the `{:ok, <bind>}` return), so
   *  this is the `T` in a `{:ok, T}` success.  Set only when that type can be
   *  computed precisely and narrowed safely (no loop/sequence tail, a
   *  renderable leaf type); left `undefined` otherwise, so a backend keeps its
   *  conservative `{:ok, term()}` arm.  Consumed today by the Phoenix `@spec`
   *  emitter to tighten Dialyzer narrowing on every workflow call site. */
  returnType?: TypeIR;
  /** The canonical wire shape of a *persisted workflow instance* — the
   *  correlation-state row this workflow's saga persists (the same row
   *  `workflowStateTableShape` derives a table for).  Set by enrichment
   *  only when `correlationField` is present (a correlation-bearing,
   *  state-table-backed workflow): the correlation field as the `id`-shaped
   *  `token` row, then the remaining `stateFields` as `property` rows, in
   *  declaration order.  This is the workflow-instance analogue of an
   *  aggregate's canonical wire shape (`wireFieldsForAggregate`) — the
   *  read-only "instance" API + scaffold pages
   *  (workflow-instance-visibility.md) consume it the way the aggregate
   *  read surface consumes that wire shape.  Carried for both
   *  state-table-backed sagas and `eventSourced` workflows (the instance shape
   *  is identical — only the read body differs: a `<wf>_state` row select vs a
   *  fold of the per-correlation `<wf>_events` stream).  Absent only for
   *  stateless workflows (no correlation field ⇒ no instance to read). */
  instanceWireShape?: WireField[];
  /** The instance-READ authorization gate — the header `workflow X requires
   *  <expr> { … }` clause.  Evaluated before `GET /workflows/<wf>/instances`
   *  and `.../instances/{id}` run; failure → 403.
   *
   *  Distinct from the command entries' own `requires`, which gate the POSTs:
   *  "who may start this workflow" and "who may read its state" are separate
   *  questions, and conflating them is why the reads had no gate at all.
   *
   *  `currentUser`-only, like the projection and find read gates — the gate
   *  runs before the query, so no instance row is bound yet
   *  (`loom.workflow-gate-not-current-user`). */
  instanceReadGate?: ExprIR;
}

/** A top-level `commandHandler name(params): T { … }` application-layer member
 *  (unfoldable-api-derivation.md, Layer 3) — a context's named command entry
 *  point.  `returnType` is optional
 *  (a `commandHandler` may omit it, `: void`-equivalent).  Body statements are
 *  `WorkflowStmtIR` (load → mutate → save → return), same as a workflow
 *  `create`.  Every backend's explicit-handlers emitter reads these. */
export interface CommandHandlerIR {
  name: string;
  params: ParamIR[];
  returnType?: TypeIR;
  /** Stamped SOURCE FACT — the user wrote `extern commandHandler … ;`.  An
   *  extern handler is BODYLESS: its implementation is a scaffold-once,
   *  user-owned impl file the generated dispatch calls (the "case-2" home).
   *  When set, `statements` / `returnValue` / `savesAtExit` are empty and only
   *  the signature (`params` + optional `returnType`) is load-bearing.  Same
   *  kind of stamped fact as `OperationIR.extern`; do NOT derive an
   *  `isBodyless` from it. */
  extern?: boolean;
  statements: WorkflowStmtIR[];
  savesAtExit: { name: string; aggName: string; repoName: string }[];
  /** The lowered `return <expr>` value, when the body ends in a return.  Held
   *  separately from `statements` (which are `WorkflowStmtIR`, and the shared
   *  workflow statement renderer has no `return` arm — workflow handles never
   *  return a value).  A backend renders the body statements, then
   *  `return <returnValue>`.  Absent for a `: void`-equivalent handler. */
  returnValue?: ExprIR;
  /** For a result that declares an expected failure (`T or E`): the declared
   *  variant each answered value produces, by tag — one entry when
   *  `returnValue` is a tail `return`, else one per arm of the value `match`
   *  `returnValue` holds (its `variantArms` in order, then `otherwise`).  A
   *  body ending in a terminal statement `match` whose arms `return` lowers
   *  to that statement `match` (arms keep their statements) plus this value
   *  `match` over the same subject — the value is answered after the body.
   *  Read through `entryResult` (src/ir/util/entry-result.ts).  Empty when
   *  the result declares no expected failure. */
  returnTags: string[];
}

/** A top-level `queryHandler name(params): T { … }` application-layer member
 *  (unfoldable-api-derivation.md, Layer 3).  Like `CommandHandlerIR` but the
 *  `returnType` is REQUIRED (a query always produces a response) and the body
 *  must not mutate/save (validator `loom.query-handler-saves`). */
export interface QueryHandlerIR {
  name: string;
  params: ParamIR[];
  returnType: TypeIR;
  /** Stamped SOURCE FACT — the user wrote `extern queryHandler … ;`.  See
   *  {@link CommandHandlerIR.extern}.  For a queryHandler the `returnType` is
   *  required and load-bearing as the user impl file's return contract (the
   *  external read-projection it produces). */
  extern?: boolean;
  statements: WorkflowStmtIR[];
  savesAtExit: { name: string; aggName: string; repoName: string }[];
  /** The lowered `return <expr>` value (see `CommandHandlerIR.returnValue`).  A
   *  query always produces a response, so this is effectively always present —
   *  optional only so a malformed (return-less) body lowers without a cast. */
  returnValue?: ExprIR;
  /** For a result that declares an expected failure (`T or E`): the declared
   *  variant each answered value produces, by tag — one entry when
   *  `returnValue` is a tail `return`, else one per arm of the value `match`
   *  `returnValue` holds (its `variantArms` in order, then `otherwise`).  A
   *  body ending in a terminal statement `match` whose arms `return` lowers
   *  to that statement `match` (arms keep their statements) plus this value
   *  `match` over the same subject — the value is answered after the body.
   *  Read through `entryResult` (src/ir/util/entry-result.ts).  Empty when
   *  the result declares no expected failure. */
  returnTags: string[];
}

/** A workflow starter declared via `create [name](params) [by <expr>] { … }`
 *  (workflow-and-applier.md A2-S5f).  `triggerKind` is discriminated at lowering
 *  from the param shape: a sole param whose type is an event reference →
 *  `"event"` (allocate-if-correlation-misses); otherwise `"command"`. */
export interface CreateIR {
  /** Declared name, or null for the canonical unnamed create (the legacy
   *  paren-body migrates to one of these). */
  name: string | null;
  triggerKind: "event" | "command";
  params: ParamIR[];
  /** The `by <expr>` routing expression (event-triggered starters), lowered in
   *  the create's scope.  Undefined for command-triggered creates. */
  correlation?: ExprIR;
  statements: WorkflowStmtIR[];
  savesAtExit: { name: string; aggName: string; repoName: string }[];
  /** Event-triggered only: the bound event-param name and its event type. */
  eventBinding?: string;
  eventRef?: string;
  /** The declared `: T` result of a command-triggered starter (`create(…): T
   *  { … return <expr> }`) — the commandHandler twin.  When set, the command
   *  route answers 200 with `returnValue` as its JSON body instead of 204.
   *  Read through `commandCreateResult` (src/ir/util/workflow-command-route.ts),
   *  which also decides that this create is the one the route serves. */
  returnType?: TypeIR;
  /** The lowered terminal `return <expr>`, held apart from `statements` (the
   *  shared workflow statement vocabulary has no `return` arm — see
   *  `CommandHandlerIR.returnValue`).  Lowered whenever the body ends in a
   *  return, annotated or not, so the validator can refuse the unannotated one. */
  returnValue?: ExprIR;
  /** For a result that declares an expected failure (`T or E`): the declared
   *  variant each answered value produces, by tag — one entry when
   *  `returnValue` is a tail `return`, else one per arm of the value `match`
   *  `returnValue` holds (its `variantArms` in order, then `otherwise`).  A
   *  body ending in a terminal statement `match` whose arms `return` lowers
   *  to that statement `match` (arms keep their statements) plus this value
   *  `match` over the same subject — the value is answered after the body.
   *  Read through `entryResult` (src/ir/util/entry-result.ts).  Empty when
   *  the result declares no expected failure. */
  returnTags: string[];
}

/** A `on(e: Event) [by <expr>] { … }` reactor on a workflow — an extrinsic
 *  event subscription / continuation handler.  Mirrors `ApplyIR`: the event
 *  instance binds as a `refKind: "param"` local in the body.  Distinct from an
 *  applier in that the body is a workflow continuation (it may load/save
 *  aggregates and emit), so its statements are `WorkflowStmtIR`. */
export interface OnIR {
  /** The event type this reactor subscribes to, by name (resolved to a
   *  context `EventDecl`). */
  event: string;
  /** The parameter name the inbound event instance binds to in the body
   *  (e.g. `paid` in `on(paid: PaymentReceived)`). */
  param: string;
  /** The `by <expr>` routing expression (workflow-and-applier.md A2-S3),
   *  lowered in the event-binding scope — e.g. `paid.orderId`.  Undefined when
   *  the source omits `by`; the runtime then routes by name-match against the
   *  workflow's correlation field (resolved at validation time). */
  correlation?: ExprIR;
  /** The reactor body — workflow statements (emit / let / op-call / …). */
  statements: WorkflowStmtIR[];
  /** Which let-bound aggregates need a save call at reactor exit, in
   *  declaration order — same `computeSaves` derivation as `HandleIR` /
   *  `CreateIR`.  A reactor is a workflow continuation, so a created /
   *  loaded-and-mutated aggregate is persisted on the way out. */
  savesAtExit: { name: string; aggName: string; repoName: string }[];
}
