// The `workflow` family of the diagnostic-message catalog: workflows, reactors, timers, lifecycle hooks and effects.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "workflow",
  "reactor",
  "timer",
  "lifecycle",
  "command",
  "effect",
  "async",
  "transactional",
  "isolation",
  "named",
  "instance",
  "missing",
  "canonical",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/builder-call.ts
  // ----------------------------------------------------------------------
  "loom.workflow-param-unused": (p: { param: unknown; label: unknown; wfName: unknown }) =>
    `Parameter '${p.param}' of '${p.wfName}.${p.label}' is never read by its body. A command ` +
    `entry's parameter list IS its request contract, so this is published as a REQUIRED field ` +
    `of the emitted request schema and then discarded — the caller is obliged to send data the ` +
    `system throws away. Read it, or drop it from the signature. (A wholly empty body is not ` +
    `flagged — this fires only where the body reads SOME of its parameters and not this one.)`,

  // ----------------------------------------------------------------------
  // src/language/validators/criterion.ts
  // ----------------------------------------------------------------------
  // What a lifecycle `requires` may READ.  Two arms rather than one message
  // with a conditional clause: the reason `create` is narrower than `destroy`
  // is a different fact in each case, and an author hitting one should not have
  // to read past the other.
  "loom.lifecycle-guard-unreadable#create": (p: { agg: unknown; refs: unknown }) =>
    `aggregate '${p.agg}': the \`create\` guard reads ${p.refs}, which the gate cannot see. A \`create\` guard may read \`currentUser\` and the parameters that name a create-input field — there is no instance until the factory runs, and the emitted POST takes the field-derived create input, not the declared parameter list, so any other parameter has no wire slot. \`requires\` answers "may this caller"; a value check belongs in a \`precondition\` on a named \`operation\`.`,
  "loom.lifecycle-guard-unreadable#destroy": (p: { agg: unknown; refs: unknown }) =>
    `aggregate '${p.agg}': the \`destroy\` guard reads ${p.refs}, which the gate cannot see. A \`destroy\` guard may read \`currentUser\` and \`this\` (the route already loads the row), but not a parameter — a DELETE carries no body. \`requires\` answers "may this caller"; a value check belongs in a \`precondition\` on a named \`operation\`.`,
  // The canonical `create` / `destroy` body no backend renders.  `reason` is
  // computed at the call site (it varies by statement kind AND by action), so
  // the catalog owns the frame and the site owns the clause.
  "loom.lifecycle-body-dropped": (p: {
    agg: unknown;
    label: unknown;
    kind: unknown;
    reason: unknown;
    plural: unknown;
  }) =>
    `aggregate '${p.agg}': the \`${p.label}\` body's \`${p.kind}\` is not emitted on a state-based aggregate, so ${p.reason}. A \`create\` body renders only its \`requires\`, \`precondition\`, \`emit\` and \`let\` statements, a \`destroy\` body only its \`requires\` (an event-sourced \`create\` runs its whole body). Move the logic to a named \`operation\`, which emits its guards and statements on every backend, or drop the clause.`,
  // The sibling of the above, one level up: the whole ACTION is dropped, not
  // just its body.  Kept separate because the remedy differs — the canonical
  // case keeps its route and loses the braces, this one has no route to keep.
  "loom.named-lifecycle-dropped": (p: { agg: unknown; label: unknown; name: unknown }) =>
    `aggregate '${p.agg}': the named \`${p.label} ${p.name}\` reaches no backend — it drives no route and no factory, so nothing in its body runs (guards included). ` +
    (p.label === "create"
      ? "Only the canonical (unnamed) `create` is emitted — on an event-sourced aggregate, its single `create`, named or not."
      : "Only the canonical (unnamed) `destroy` is emitted.") +
    ` Drop the name to make it canonical, or model it as an \`operation\`, which emits on every backend.`,

  // ----------------------------------------------------------------------
  // src/language/validators/workflow-explicit-save.ts
  // ----------------------------------------------------------------------
  "loom.workflow-explicit-save": (p: { repo: unknown; verb: unknown; owner: unknown }) =>
    `'${p.repo}.${p.verb}(…)' in ${p.owner}: a workflow or handler body persists at its exit — every aggregate it creates, or loads and changes through one of its operations, is saved once on the way out (a 'for' iteration and an 'if let' branch save at their own end). There is no persistence statement. Remove the '${p.verb}' call; to change the aggregate, call one of its operations and the exit save writes it.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.transactional-with-continuations": (p: { name: unknown }) =>
    `Workflow '${p.name}' is 'transactional' but declares a continuation handler. ` +
    `An on(...) reactor runs in its own transaction — drop 'transactional', or remove the continuation.`,
  // `create(…): T { … return <expr> }` — a command starter's result (B-03).
  "loom.workflow-return-no-caller": (p: { workflow: unknown; create: unknown }) =>
    `Workflow '${p.workflow}': '${p.create}' is event-triggered ('by …'), so nothing calls it and ` +
    `there is no one to receive a result. Drop the ': T' and the 'return' — only a command-triggered ` +
    `'create(…)' answers its caller.`,
  "loom.workflow-return-no-caller#unrouted": (p: { workflow: unknown; create: unknown }) =>
    `Workflow '${p.workflow}': 'create ${p.create}(…)' declares a result, but it is not the create ` +
    `the workflow's POST route serves (that is the unnamed command-triggered 'create(…)'), so no ` +
    `caller receives it. Move the ': T' and 'return' to the unnamed create, or drop them.`,
  "loom.workflow-return-not-last": (p: { workflow: unknown; create: unknown }) =>
    `Workflow '${p.workflow}': 'return' in '${p.create}' must be the last top-level statement of the ` +
    `body. The result is answered after every step (and the transaction) completes, so an earlier or ` +
    `nested 'return' would not stop the steps after it.`,
  "loom.workflow-return-not-last#match-arm": (p: { workflow: unknown; create: unknown }) =>
    `Workflow '${p.workflow}': 'return' in '${p.create}' sits inside a 'match' arm.  An arm may ` +
    `end in 'return' only when the 'match' is the body's last statement, every arm ends in ` +
    `'return' or 'notFound', and the result declares an expected failure ('T or E').  Otherwise ` +
    `compute the result with the value form — 'let r = match x { A a => …, B b => … }' — and end ` +
    `the body with 'return r'.`,
  "loom.workflow-return-not-last#arm-local-let": (p: {
    workflow: unknown;
    create: unknown;
    name: unknown;
  }) =>
    `Workflow '${p.workflow}': the 'return' of a 'match' arm in '${p.create}' reads '${p.name}', ` +
    `a 'let' declared inside the arm.  The result is answered once, after the 'match', where ` +
    `only the arm's binding and the lets declared before the 'match' are in scope.  Compute the ` +
    `value in the 'return' itself, or declare the 'let' before the 'match'.`,
  "loom.workflow-return-untyped": (p: { workflow: unknown; create: unknown }) =>
    `Workflow '${p.workflow}': '${p.create}' ends in 'return' but declares no result type. ` +
    `Annotate it — 'create(…): T { … return <expr> }' — so the route publishes what it answers.`,
  "loom.workflow-return-missing": (p: { workflow: unknown; create: unknown }) =>
    `Workflow '${p.workflow}': '${p.create}' declares a result type but its body does not end in ` +
    `'return <expr>'. Add the return, or drop the ': T' to keep the 204 No Content answer.`,
  "loom.workflow-return-type-mismatch": (p: {
    workflow: unknown;
    create: unknown;
    actual: unknown;
    declared: unknown;
  }) =>
    `Workflow '${p.workflow}': '${p.create}' returns '${p.actual}' but is declared to return '${p.declared}'.`,
  "loom.workflow-return-type-unsupported": (p: {
    workflow: unknown;
    create: unknown;
    declared: unknown;
  }) =>
    `Workflow '${p.workflow}': '${p.create}' declares result type '${p.declared}', which a workflow ` +
    `route cannot answer yet. Supported: an 'X id', 'string', 'int', 'long' or 'bool', a payload ` +
    `record, an aggregate (answered as its response), the workflow itself ('return this', its ` +
    `instance state), or a union of these with at least one 'error' variant.  A value-object, ` +
    `money, decimal or date/time result is not answered yet — return it inside a payload.`,
  "loom.workflow-return-type-unsupported#handler": (p: { label: unknown; declared: unknown }) =>
    `${p.label} declares result '${p.declared}', which its route cannot answer yet.  An expected-` +
    `failure result's success variants may be an 'X id', 'string', 'int', 'long' or 'bool', a ` +
    `payload record or an aggregate (answered as its response).  A value-object, money, decimal ` +
    `or date/time variant is not answered yet — return it inside a payload.`,
  "loom.workflow-return-this-uncorrelated": (p: { workflow: unknown; create: unknown }) =>
    `Workflow '${p.workflow}': '${p.create}' answers the workflow itself ('${p.workflow}', ` +
    `'return this'), but the workflow is not correlated — it declares no id-shaped state field, ` +
    `so it persists no instance for the answer to read.  Declare a correlation field ` +
    `('orderId: Order id') and assign it from a parameter, or answer another value.`,
  "loom.workflow-return-event-sourced": (p: { workflow: unknown; create: unknown }) =>
    `Workflow '${p.workflow}' is 'eventSourced', so '${p.create}' may only emit events and cannot ` +
    `declare a result. Drop the ': T' and the 'return', or read the outcome back through the ` +
    `workflow's instance endpoint.`,
  "loom.workflow-applier-on-non-event-sourced": (p: { name: unknown }) =>
    `Workflow '${p.name}' declares apply(...) but is not event-sourced. ` +
    `Add 'eventSourced' to the workflow header, or remove the applier.`,
  "loom.workflow-duplicate-applier": (p: { name: unknown; ap: unknown }) =>
    `Workflow '${p.name}' declares more than one applier for event '${p.ap}'. ` +
    `An event folds into state exactly one way — declare a single apply(${p.ap}).`,
  "loom.workflow-event-sourced-mutation": (p: { name: unknown }) =>
    `Workflow '${p.name}' is event-sourced — a handler body must not mutate 'this' directly. ` +
    `Replace the assignment with an 'emit' and fold it in an apply(...) block.`,
  "loom.workflow-emitted-event-no-applier": (p: { ev: unknown; name: unknown }) =>
    `Event '${p.ev}' is emitted in workflow '${p.name}' but no applier folds it. ` +
    `Add an apply(${p.ev}: ${p.ev}) block, or the event is recorded but never reflected in state.`,

  // ----------------------------------------------------------------------
  // src/language/validators/timer.ts
  // ----------------------------------------------------------------------
  "loom.timer-cadence#both-cron-and-every": (p: { name: unknown }) =>
    `timerSource '${p.name}' sets both 'cron:' and 'every:' — set exactly one.`,
  "loom.timer-cadence#neither-cron-nor-every": (p: { name: unknown }) =>
    `timerSource '${p.name}' sets neither 'cron:' nor 'every:' — a cadence is required.`,
  "loom.timer-cadence#cron-malformed": (p: { name: unknown; err: unknown }) =>
    `cron on timerSource '${p.name}' is invalid: ${p.err}.`,
  "loom.timer-cadence#every-malformed": (p: { name: unknown }) =>
    `'every:' on timerSource '${p.name}' is not a valid duration (e.g. 15s, 90m).`,
  "loom.timer-cadence#every-below-floor": (p: { name: unknown; minIntervalMs: unknown }) =>
    `'every:' on timerSource '${p.name}' is below the ${p.minIntervalMs}ms floor — timers may not fire more often than once per second.`,
  "loom.timer-cadence#every-cron-expressible": (p: { name: unknown; cronEquiv: unknown }) =>
    `'every:' on timerSource '${p.name}' is cleanly cron-expressible — write 'cron: "${p.cronEquiv}"'. 'every:' is only for intervals cron cannot express (sub-minute, or non-dividing like 7m/90m).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/api-checks.ts
  // ----------------------------------------------------------------------
  "loom.command-handler-multi-aggregate": (p: {
    name: unknown;
    cName: unknown;
    size: unknown;
    touched: unknown;
  }) =>
    `context '${p.name}': commandHandler '${p.cName}' touches ${p.size} aggregates ` +
    `(${p.touched}). A commandHandler orchestrates a single aggregate — ` +
    `a cross-aggregate orchestration must be a workflow.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/query-checks.ts
  // ----------------------------------------------------------------------
  "loom.workflow-gate-not-current-user": (p: { name: unknown; offending: unknown }) =>
    `workflow '${p.name}': the header \`requires\` gate guards the instance READS ` +
    "(`/workflows/<wf>/instances`) and runs before any instance is loaded, so it may only " +
    `reference \`currentUser\` (and constants) — \`${p.offending}\` is not available here. ` +
    "To gate a COMMAND on instance state, put a `requires` in that `create` / `handle` body, " +
    "where the instance is bound.",

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the Flutter action-body
  // gap (§18 sentinels: the `TODO(flutter full-parity)` arms in
  // `riverpod-emit.ts`).  It leaves the effect out of the built app with no
  // diagnostic anywhere, and names its successor mission.
  //
  // There were TWO.  The `#view-effect` arm (a `toast(…)` from a Notifier) is
  // gone with its cause: wave C2 packet 2l gave `toast` the same out-of-tree
  // bridge `navigate` already had (`lib/toast.dart`, a
  // `GlobalKey<ScaffoldMessengerState>` on `MaterialApp`), so the effect ships
  // rather than being refused.  What is left is the `match await` on a
  // STANDARD aggregate op.
  // ----------------------------------------------------------------------
  // The TARGET-AGNOSTIC subject gate (audit F66).  Every frontend renderer
  // resolves a `match await` subject to an aggregate instance operation and
  // renders nothing else — the JS walkers emitted a guaranteed unhandled
  // rejection, LiveView threw at codegen, and only Feliz / Flutter said so.
  "loom.async-effect-subject-unsupported": (p: { uiName: unknown; reason: unknown }) =>
    `\`match await …\` (an async effect) on ui '${p.uiName}' cannot be rendered by ANY ` +
    `frontend — ${p.reason}.  Every frontend resolves the awaited subject the same way, so ` +
    `this is not a per-target limit: write \`match await <api>.<Agg>.<op>(args?) { <Variant> ` +
    `b => … … else? => … }\` — an aggregate instance operation (with or without params), one ` +
    `or more named success/error arms, and an optional \`else\`.  To await a workflow or a ` +
    `collection read, drive it through a form primitive (WorkflowForm / QueryView) instead.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/sensitivity-checks.ts
  // ----------------------------------------------------------------------
  // src/ir/validate/checks/reactor-principal-checks.ts (ruling D1)
  "loom.reactor-gate-unsatisfiable": (p: {
    reactor: unknown;
    event: unknown;
    where: unknown;
    gate: unknown;
  }) =>
    `reactor '${p.reactor}' runs as the system principal (no request user: every claim is empty, ` +
    `\`currentUser.isSystem\` is true), but ${p.where} is gated by \`requires ${p.gate}\`, which reads ` +
    `\`currentUser\` and never admits the system principal — so every '${p.event}' this reactor ` +
    `handles will be refused with 403.  If the reactor is allowed to do this, say so in the gate: ` +
    `\`requires currentUser.isSystem || ${p.gate}\`; otherwise call an ungated operation, or move the ` +
    `check onto the command that emits '${p.event}'.`,
  "loom.timer-tenant-read": (p: {
    reactor: unknown;
    timer: unknown;
    agg: unknown;
    read: unknown;
  }) =>
    `reactor '${p.reactor}' runs on timer '${p.timer}', which has no tenant, but reads the ` +
    `tenant-owned aggregate '${p.agg}' through \`${p.read}\`.  The read's tenant filter would match ` +
    `nothing.  Make the cross-tenant read explicit: widen the read with \`ignoring tenantOwned\` ` +
    `(\`Repo.all(C) ignoring tenantOwned\`, \`Repo.getBy(…) ignoring tenantOwned\`).`,

  // --------------------------------------------------------------------
  // The BODY-WALKER GIVE-UP codes (M-T9.55).
  //
  // These four name the conditions under which the frontend body walker
  // declines to render a construct.  They are unusual in this catalog:
  // today they are attached at the EMISSION site (`giveUp()` in
  // `src/generator/_walker/give-up.ts` renders the code into the
  // `loom:unrendered [<code>] …` comment) rather than raised as a
  // diagnostic, because codegen has no diagnostic channel.  The wording
  // still lives here, for the one reason the catalog exists: the text a
  // user reads about a `loom.*` code must have exactly one home, whichever
  // phase puts it in front of them.  When `generate system` grows a
  // give-up-reporting pass these become ordinary reported diagnostics with
  // no change to the emitters.
  // --------------------------------------------------------------------
  "loom.instance-effect-needs-route-id": (p: { name: unknown; route: unknown }) =>
    `page '${p.name}': \`match await …\` awaits an aggregate instance operation, which acts ` +
    `on the record identified by the page's route \`:id\` — but this page (route ` +
    `"${p.route}") declares no \`:id\` param, so no record is in scope.  Host the ` +
    `effect on a detail page (\`route: "/…/:id"\`), or drive the op through a form primitive ` +
    `(OperationForm).`,
  "loom.effect-in-lambda#effect": (p: { where: unknown; arrow: unknown; token: unknown }) =>
    `inline handler \`${p.arrow}\` performs an effect (\`${p.token}\`) in the page body. ` +
    `Only a named \`action\` may carry effects — declare one and reference it by name ` +
    `(e.g. \`action doIt(…) { … }\` then \`onClick: doIt\`). Render-tree lambdas must be pure.`,
  "loom.effect-in-lambda#remote-mutation": (p: {
    where: unknown;
    arrow: unknown;
    aggName: unknown;
    op: unknown;
  }) =>
    `inline handler \`${p.arrow}\` performs a remote mutation ` +
    `(\`${p.aggName}.${p.op}(…)\`) in the page body. Only a named \`action\` may carry ` +
    `effects — declare one and await the command so its Result is handled (e.g. ` +
    `\`action doIt(…) { match await ${p.aggName}.${p.op}(…) { … } }\` then \`onClick: doIt\`). ` +
    `Render-tree lambdas must be pure.`,
  "loom.missing-effect-marker": (p: { where: unknown; aggName: unknown; op: unknown }) =>
    `action body calls \`${p.aggName}.${p.op}(…)\`, a remote mutating command on ` +
    `aggregate '${p.aggName}', with no effect marker — it has an invisible async boundary. Mark it ` +
    `\`match await ${p.aggName}.${p.op}(…) { … }\` so its Result is handled ` +
    `(async-actions-and-effects.md Stage 2b — every remote call is explicitly awaited and its ` +
    `Result matched).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/timer-checks.ts
  // ----------------------------------------------------------------------
  "loom.timer-event-shape#not-infrastructure-only": (p: {
    name: unknown;
    event: unknown;
    ctxName: unknown;
  }) =>
    `timerSource '${p.name}' fires '${p.event}', which is already emitted by domain logic in context '${p.ctxName}'. A timer's 'for:' event must be infrastructure-emitted only — declare a dedicated tick event (e.g. 'event ${p.event}Tick { at: datetime }').`,
  "loom.timer-event-shape#no-at-field": (p: { event: unknown; name: unknown }) =>
    `tick event '${p.event}' (fired by timerSource '${p.name}') has no 'at: datetime' field; the reacting workflow body cannot read the fire time.`,
  "loom.timer-needs-state#owner-binds-no-state": (p: { name: unknown; owner: unknown }) =>
    `timerSource '${p.name}' is owned by deployable '${p.owner}', whose platform binds no relational state. Single-fire delivery needs a Postgres advisory lock — host the context on a database-backed backend.`,
  "loom.timer-needs-state#context-has-no-db-owner": (p: { name: unknown; context: unknown }) =>
    `timerSource '${p.name}' fires an event in context '${p.context}', which no database-backed deployable owns. Single-fire delivery needs a Postgres advisory lock — host the context on a backend that binds a relational 'state' resource.`,
  "loom.timer-source-unbound": (p: { name: unknown; event: unknown }) =>
    `timerSource '${p.name}' fires '${p.event}', but no workflow reacts to it ('on(_: ${p.event})' / 'create(_: ${p.event}) by …'). The timer will run and emit into the void.`,
  "loom.timer-source-unbound#unreachable": (p: {
    name: unknown;
    event: unknown;
    owner: unknown;
    consumers: unknown;
  }) =>
    `timerSource '${p.name}' runs on deployable '${p.owner}', but every workflow that reacts to '${p.event}' is hosted on another deployable (${p.consumers}) and no channel carries '${p.event}'. The tick is dispatched in-process only and never reaches them — declare a channel carrying '${p.event}' and bind it with a channelSource on both deployables.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/workflow-checks.ts
  // ----------------------------------------------------------------------
  "loom.reactor-channel-ambiguous": (p: {
    name: unknown;
    label: unknown;
    event: unknown;
    length: unknown;
    carriers: unknown;
    carriers2: unknown;
  }) =>
    `workflow '${p.name}': ${p.label} subscribes to event '${p.event}', which is ` +
    `carried by ${p.length} channels (${p.carriers}). In-process dispatch ` +
    `records the first by declaration order ('${p.carriers2}') — carry '${p.event}' on a ` +
    `single channel to keep routing unambiguous.`,
  "loom.workflow-name-collision": (p: { name: unknown; wfName: unknown; clash: unknown }) =>
    `context '${p.name}': workflow '${p.wfName}' collides with the ${p.clash} of the same name.`,
  "loom.workflow-function-uses-state": (p: { ctxName: unknown; name: unknown; fnName: unknown }) =>
    `context '${p.ctxName}': workflow '${p.name}' function '${p.fnName}' reads the workflow's state (\`this\`). A workflow function is a pure helper over its parameters — pass the value in as an argument instead.`,
  "loom.canonical-create-duplicate-workflow": (p: { name: unknown; length: unknown }) =>
    `workflow '${p.name}' declares ${p.length} unnamed 'create' starters; ` +
    `at most one canonical create is allowed. Name the additional entry points (e.g. 'create byImport(...)').`,
  "loom.workflow-correlation-required": (p: { name: unknown; why?: unknown }) =>
    p.why === "stream"
      ? `event-sourced workflow '${p.name}' has no correlation field, so its event stream has ` +
        `no key and no instance can be stored or read back. Declare one id-shaped state field ` +
        `(e.g. 'orderId: Order id') to key the stream, or drop 'eventSourced' (and its ` +
        `'apply' blocks) if the workflow keeps no state.`
      : `workflow '${p.name}' has event consumers (reactors / event-triggered creates) but no ` +
        `correlation field. Declare one id-shaped state field (e.g. 'orderId: Order id') for the ` +
        `runtime to route inbound events to.`,
  "loom.workflow-create-correlation-unsupplied": (p: {
    name: unknown;
    corr: unknown;
    params: unknown;
  }) =>
    `workflow '${p.name}': the command 'create' writes workflow state but supplies no value for ` +
    `the correlation field '${p.corr}', so it addresses no instance. A create has no 'by' clause ` +
    `(a 'by' makes it event-triggered) — supply the key as a parameter named '${p.corr}', or ` +
    `assign it from one ('${p.corr} := <param>'). Parameters today: ${p.params}.`,
  "loom.workflow-create-correlation-unsupplied#payload": (p: {
    name: unknown;
    corr: unknown;
    param: unknown;
    payload: unknown;
  }) =>
    `workflow '${p.name}': the command 'create' writes workflow state and its correlation key ` +
    `'${p.corr}' is a field of '${p.payload}' (parameter '${p.param}'), not a parameter of the ` +
    `create. A create routes by parameter — by name, or by a '${p.corr} := <param>' assignment — ` +
    `and reads no nested field, so this addresses no instance. Add '${p.corr}' as a top-level ` +
    `parameter: 'create(${p.corr}: …, ${p.param}: ${p.payload})'.`,
  // An uncorrelated workflow (no id-shaped state field) whose command 'create'
  // assigns state: there is no row key, so no later step could read the write.
  "loom.workflow-uncorrelated-state-write": (p: { name: unknown; fields: unknown }) =>
    `workflow '${p.name}': the command 'create' assigns workflow state (${p.fields}), but the ` +
    `workflow has no id-shaped state field to correlate on, so no instance row is kept and no ` +
    `later step could ever read the value. Either declare one id-shaped state field (for example ` +
    `'orderId: Order id') and pass it to the create, or drop the state and the assignment.`,
  // The read twin of the rule above: the create reads state the workflow keeps
  // no row for, so there is no instance to read it from.
  "loom.workflow-uncorrelated-state-read": (p: { name: unknown; fields: unknown }) =>
    `workflow '${p.name}': the command 'create' reads workflow state (${p.fields}), but the ` +
    `workflow has no id-shaped state field to correlate on, so no instance row is kept and ` +
    `there is no instance to read the value from. Either declare one id-shaped state field (for ` +
    `example 'orderId: Order id') and pass it to the create, or drop the state and pass the ` +
    `value in as a parameter.`,
  // A body mutates an aggregate that none of its saves covers (effect IR: a
  // `mutate` with no `persist` of the same local in an enclosing scope).
  "loom.workflow-mutation-unsaved": (p: { owner: unknown; call: unknown; name: unknown }) =>
    `${p.owner}: '${p.call}' mutates '${p.name}', but no save covers '${p.name}', so the ` +
    `change would never be written. A body saves an aggregate it created, or loaded from a ` +
    `repository, and then mutated through a call statement ('${p.call}(…)') or a 'let' bound ` +
    `to the call itself ('let r = ${p.call}(…)'); a call nested inside a larger expression ` +
    `is not saved. Write the call as its own statement or 'let', and load '${p.name}' with a ` +
    `repository read if it is not one.`,
  // `let r = a.withdraw(x)` whose result can be an `error` variant: the change
  // to `a` commits only where `r` is not the error, i.e. in the non-error arms
  // of a statement `match` over `r` (D-FAILURE-MODEL).
  "loom.workflow-mutation-result-unmatched": (p: {
    owner: unknown;
    name: unknown;
    call: unknown;
    errors: unknown;
  }) =>
    `${p.owner}: 'let ${p.name} = ${p.call}(…)' binds a result that can be the error ` +
    `${p.errors}, and the call's change must not be saved when it is, so the body has to ` +
    `look at '${p.name}' before anything is saved. Match it: 'match ${p.name} { … }' saves ` +
    `the change at the end of each arm that is not an error and drops it in an error arm.`,
  "loom.workflow-mutation-result-unmatched#mixed-else": (p: {
    owner: unknown;
    name: unknown;
    call: unknown;
    successes: unknown;
    errors: unknown;
  }) =>
    `${p.owner}: the 'else' arm of 'match ${p.name}' covers the success ${p.successes} and the ` +
    `error ${p.errors} of '${p.call}', so it cannot tell whether to save the call's change. ` +
    `Give the success variants, or the error variants, arms of their own.`,
  "loom.workflow-mutation-result-unmatched#also-mutated": (p: {
    owner: unknown;
    name: unknown;
    call: unknown;
    target: unknown;
  }) =>
    `${p.owner}: '${p.call}' changes '${p.target}' only when its result '${p.name}' is not an ` +
    `error, but this body also creates or changes '${p.target}' elsewhere, which would save ` +
    `the error path's change too. Make the matched call the only change to '${p.target}' in ` +
    `this body.`,
  "loom.workflow-mutation-unsaved#unbound": (p: {
    owner: unknown;
    call: unknown;
    aggName: unknown;
  }) =>
    `${p.owner}: '${p.call}' mutates the '${p.aggName}' passed to it, but that argument is an ` +
    `expression rather than a bound local, so nothing can save the change. Bind the ` +
    `'${p.aggName}' with 'let' first and pass the local.`,
  // A workflow that declares `on(…)` reactors but no `create(…)` starter.
  // Sibling of `loom.reactor-event-uncarried` above, which performs this class
  // of check for a different cause (no channel carries the event).  Here the
  // event IS carried and IS dispatched — there is simply never an instance to
  // route it to, so the reactor loads nothing and logs `event_unrouted`
  // forever.  A create-less workflow still emits an (empty) POST route that
  // logs `workflow_started` / `workflow_completed` and inserts no row, which is
  // why nothing downstream notices.
  "loom.reactor-without-starter": (p: { name: unknown; reactors: unknown }) =>
    `workflow '${p.name}' declares reactors (${p.reactors}) but no 'create' starter, so no ` +
    `instance is ever created for them to route to: every inbound event logs 'event_unrouted' ` +
    `and returns. Add a starter — an event-triggered 'create(e: <Event>) by <expr> { … }' for ` +
    `the event that begins the saga, or a command-triggered 'create(…) { … }' that supplies ` +
    `the correlation key.`,
  "loom.workflow-unknown-name": (p: { name: unknown; kind: unknown; exprName: unknown }) =>
    `workflow '${p.name}': ${p.kind} references unknown name '${p.exprName}'.`,
  "loom.workflow-unknown-name#projection-receiver": (p: {
    name: unknown;
    where: unknown;
    kind: unknown;
    projection: unknown;
  }) =>
    `workflow '${p.name}' ${p.where}: ${p.kind} reads projection '${p.projection}', but a workflow ` +
    `can only load data through its own context's repositories — a projection is a read model ` +
    `with no repository, so every backend would emit an unbound '${p.projection}' receiver. ` +
    `Read the projection through its GET endpoint or a page instead.  To use that data inside ` +
    `the workflow, keep a local replica aggregate (fed by a correlated ` +
    `'create(e: <Event>) by …' starter) and read it with a let-bound repository call ` +
    `('let r = <Replicas>.find(<Criterion>)').`,
  "loom.workflow-inline-repository-call": (p: {
    where: unknown;
    repoName: unknown;
    call: unknown;
    binding: unknown;
  }) =>
    `${p.where} reads repository '${p.repoName}' where the read runs only on some paths — ` +
    `inside a lambda, on the right of '&&' / '||' / '??', in a '?:' branch or in a 'match' arm. ` +
    `A read inside an expression runs as a 'let' ahead of its statement, and moving this one ` +
    `there would run it where the source does not (a 'get' throws on a miss), so it is left ` +
    `unbound and every backend renders '${p.repoName}' as a bare name nothing binds. Bind the ` +
    `read before the statement and reference the binding: 'let ${p.binding} = ${p.call}'.`,
  "loom.workflow-emit-unknown-event": (p: { name: unknown; eventName: unknown }) =>
    `workflow '${p.name}': emit refers to unknown event '${p.eventName}'.`,
  "loom.workflow-emit-missing-field": (p: { name: unknown; evName: unknown; f: unknown }) =>
    `workflow '${p.name}': emit '${p.evName}' is missing field '${p.f}'.`,
  "loom.workflow-emit-unknown-field": (p: {
    name: unknown;
    evName: unknown;
    f: unknown;
    suggestion?: unknown;
  }) =>
    `workflow '${p.name}': emit '${p.evName}' has unknown field '${p.f}'.` +
    didYouMean(p.suggestion),
  "loom.workflow-create-unknown-aggregate": (p: { name: unknown; aggName: unknown }) =>
    `workflow '${p.name}': '${p.aggName}.create(...)' references unknown aggregate '${p.aggName}'.`,
  "loom.workflow-create-missing-field": (p: { name: unknown; aggName: unknown; r: unknown }) =>
    `workflow '${p.name}': '${p.aggName}.create(...)' is missing required field '${p.r}'.`,
  "loom.workflow-create-unknown-field": (p: {
    name: unknown;
    aggName: unknown;
    p: unknown;
    suggestion?: unknown;
  }) =>
    `workflow '${p.name}': '${p.aggName}.create(...)' has unknown field '${p.p}'.` +
    didYouMean(p.suggestion),
  "loom.workflow-unknown-repository": (p: { name: unknown; repoName: unknown; method: unknown }) =>
    `workflow '${p.name}': '${p.repoName}.${p.method}(...)' references unknown repository '${p.repoName}'.`,
  "loom.workflow-cross-context-repository": (p: {
    where: unknown;
    repoName: unknown;
    ownContext: unknown;
    otherContext: unknown;
  }) =>
    `${p.where}: repository '${p.repoName}' is declared in context '${p.otherContext}', not in this workflow's own context '${p.ownContext}' — a workflow orchestrates the aggregates of ONE context, so it may only load through its own repositories. No backend can emit this read: the repository is never constructed and the call is never awaited, so the generated code references a name that does not exist. Cross-context data crosses at the context's PUBLIC surface instead: fetch it through '${p.otherContext}''s api (a 'resource { kind: api }' binding gives a typed in-system call), or read a local projection folded over '${p.otherContext}''s published events (via a channel), and pass the value in as a parameter. If the two aggregates really do change together in one transaction, they belong in the SAME context — move one across, or move this workflow into '${p.otherContext}'.`,
  "loom.workflow-unknown-repository-method": (p: {
    name: unknown;
    repoName: unknown;
    method: unknown;
    suggestion?: unknown;
  }) =>
    `workflow '${p.name}': repository '${p.repoName}' has no method '${p.method}'.${didYouMean(p.suggestion)}  A repository declares no reads of its own: read with get / find(id), getBy / findBy over a declared \`unique (…)\` key, or find / all over a criterion or retrieval.`,
  "loom.workflow-load-array-unsupported": (p: {
    name: unknown;
    repoName: unknown;
    method: unknown;
  }) =>
    `workflow '${p.name}': '${p.repoName}.${p.method}(...)' returns an array; a 'let' over a repository read binds a single row (or none, as 'T?').  Iterate the rows with 'for x in ${p.repoName}.all(…) { … }', or use get.`,
  "loom.workflow-run-unknown-repository#workflow-a-criterion-query": (p: {
    name: unknown;
    repoName: unknown;
  }) =>
    `workflow '${p.name}': a criterion query on '${p.repoName}' references unknown repository '${p.repoName}'.`,
  "loom.workflow-run-unknown-repository#workflow-run-references": (p: {
    name: unknown;
    repoName: unknown;
  }) =>
    `workflow '${p.name}': '${p.repoName}.all(...)' references unknown repository '${p.repoName}'.`,
  "loom.workflow-run-unknown-retrieval": (p: {
    name: unknown;
    repoName: unknown;
    retrievalName: unknown;
  }) =>
    `workflow '${p.name}': '${p.repoName}.all(${p.retrievalName}(...))' names no criterion or retrieval '${p.retrievalName}' in this context.`,
  "loom.workflow-run-retrieval-mismatch": (p: {
    name: unknown;
    retrievalName: unknown;
    target: unknown;
    repoName: unknown;
    aggName: unknown;
  }) =>
    `workflow '${p.name}': retrieval '${p.retrievalName}' is over '${p.target}', but '${p.repoName}' is a repository for '${p.aggName}'.`,
  "loom.workflow-foreach-source": (p: { name: unknown; var: unknown }) =>
    `workflow '${p.name}': 'for ${p.var} in ...' must iterate a 'let xs = Repo.all(...)' result (the only aggregate array in v1).`,
  "loom.workflow-foreach-unknown-binding#workflow-in-for-references": (p: {
    name: unknown;
    var: unknown;
    target: unknown;
    op: unknown;
  }) =>
    `workflow '${p.name}': in 'for ${p.var}', '${p.target}.${p.op}(...)' references unknown binding '${p.target}'.`,
  "loom.workflow-foreach-unknown-binding#workflow-in-if-let-references": (p: {
    name: unknown;
    var: unknown;
    target: unknown;
    op: unknown;
  }) =>
    `workflow '${p.name}': in 'if let ${p.var}', '${p.target}.${p.op}(...)' references unknown binding '${p.target}'.`,
  "loom.workflow-foreach-unknown-binding#workflow-in-if-references": (p: {
    name: unknown;
    target: unknown;
    op: unknown;
  }) =>
    `workflow '${p.name}': in an 'if' branch, '${p.target}.${p.op}(...)' references unknown binding '${p.target}'.`,
  "loom.workflow-foreach-unknown-binding#workflow-in-match-references": (p: {
    name: unknown;
    var: unknown;
    target: unknown;
    op: unknown;
  }) =>
    `workflow '${p.name}': in the 'match' arm '${p.var}', '${p.target}.${p.op}(...)' references unknown binding '${p.target}'.`,
  "loom.workflow-unknown-binding": (p: { name: unknown; target: unknown; op: unknown }) =>
    `workflow '${p.name}': '${p.target}.${p.op}(...)' references unknown let-binding '${p.target}', or '${p.target}' isn't bound to an aggregate.`,
  "loom.workflow-unknown-operation": (p: {
    name: unknown;
    aggName: unknown;
    op: unknown;
    suggestion?: unknown;
  }) =>
    `workflow '${p.name}': aggregate '${p.aggName}' has no operation '${p.op}'.` +
    didYouMean(p.suggestion),
  "loom.workflow-private-operation": (p: { name: unknown; aggName: unknown; opName: unknown }) =>
    `workflow '${p.name}': '${p.aggName}.${p.opName}' is private.  Workflows can only call public operations.`,
  "loom.workflow-eventsourced-assign": (p: { name: unknown; segments: unknown }) =>
    `workflow '${p.name}': an event-sourced workflow can't assign its own state directly ('${p.segments}').  Change state by emitting an event with a matching 'apply' clause.`,
  "loom.workflow-unrecognised-statement": (p: { name: unknown }) =>
    `workflow '${p.name}': statement isn't a recognised workflow form.  Allowed: precondition, let (factory / repo / scalar), name.op(args), emit, own-state assignment ('field := value').`,
  "loom.transactional-no-effect": (p: { name: unknown }) =>
    `workflow '${p.name}': declared 'transactional' but does not mutate any aggregate or emit any event — the keyword has no effect.`,
  "loom.isolation-requires-transactional": (p: { name: unknown; isolation: unknown }) =>
    `workflow '${p.name}': isolation level '${p.isolation}' requires the 'transactional' keyword.`,
  "loom.workflow-load-array-unsupported#handler": (p: { repoName: unknown }) =>
    `'${p.repoName}.all()' in a handler body reads the whole table, and no repository emits an unbounded load to run it (the implicit 'all()' is paged).  Read the rows with '${p.repoName}.all(<Criterion>(…))'.`,
} satisfies Record<string, MessageEntry>;
