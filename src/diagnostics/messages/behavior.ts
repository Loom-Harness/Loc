// The `behavior` family of the diagnostic-message catalog: behavior bodies and statements: `match`, functions, callable modifiers, handlers, domain services, externs, `throw`, loops and statement placement.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "match",
  "function",
  "callable",
  "handler",
  "domain",
  "extern",
  "throw",
  "loop",
  "if",
  "iflet",
  "for",
  "bare",
  "unhandled",
  "method",
  "operation",
  "ignoring",
  "when",
  "unmapped",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/bypass-placement.ts
  // ----------------------------------------------------------------------
  "loom.ignoring-clause-placement": (p: { clause: unknown }) =>
    `'${p.clause}' sits in a position that DROPS it. A capability-filter bypass has four homes: ` +
    "a query-time projection's 'where' slot (before 'join' / 'group by' / 'select'), an inline " +
    "read bound by a 'let' ('let xs = Repo.all(C) ignoring …' / 'let o = Repo.find(C) ignoring …'), " +
    "an 'if let' source ('if let o = Repo.find(C) ignoring …' / 'Repo.findBy(…) ignoring …'), or a " +
    "single-row read in a domainService operation ('Repo.find(id) ignoring … == null'); in a " +
    "context 'test' body, 'let o = Agg.find(id) ignoring …'. Written on any other expression it " +
    "parses, binds to that expression, and is " +
    "never read back — the read still applies every filter you asked it to skip. Move the clause " +
    "to the read it is meant to widen.",

  // ----------------------------------------------------------------------
  // src/language/validators/callable-sites.ts
  // ----------------------------------------------------------------------
  // ONE code, one `#<slug>` arm per SITE KIND — because the reason a modifier
  // is refused is a property of what the site IS, not of the modifier.  The
  // legality itself is declared data (`CALLABLE_SITES`,
  // `src/language/callable-sites.ts`); this is only its wording.  Before
  // M-T5.21 these were bare parse errors with nothing to say why.
  "loom.callable-modifier-not-allowed-here#lifecycle": (p: { feature: unknown; label: unknown }) =>
    `'${p.feature}' is not allowed on ${p.label}. A lifecycle action has no LOADED instance to gate: the framework allocates (create) or removes (destroy) around the body, so a 'when' canCommand predicate has nothing to evaluate and a 'requires' gate belongs on the route that reaches it. 'audited' is the one modifier a lifecycle action carries. Drop the modifier, or move the rule to the operation that owns the state.`,
  "loom.callable-modifier-not-allowed-here#applier": (p: { feature: unknown; label: unknown }) =>
    `'${p.feature}' is not allowed on ${p.label}. An applier is a PURE FOLD replayed from the event log — it must produce the same state on every replay — so nothing that can refuse the fold ('requires' / 'when'), hand it to a hand-written module ('extern') or write a second record ('audited') belongs on it. The command that emitted the event is where those rules go.`,
  "loom.callable-modifier-not-allowed-here#function": (p: { feature: unknown; label: unknown }) =>
    `'${p.feature}' is not allowed on ${p.label}. A 'function' is a pure helper over its parameters: no receiver to gate, no route to authorize, no persistence to audit. Put the rule on the operation that calls it.`,
  "loom.callable-modifier-not-allowed-here#handler": (p: { feature: unknown; label: unknown }) =>
    `'${p.feature}' is not allowed on ${p.label}. A handler is dispatched by the API layer, not routed per instance, so it carries only 'extern' (the bodyless, user-implemented form). Gate the aggregate operation the handler calls instead.`,
  "loom.callable-modifier-not-allowed-here#domain-service": (p: {
    feature: unknown;
    label: unknown;
  }) =>
    `'${p.feature}' is not allowed on ${p.label}. A domain service is a stateless, context-internal calculator: no instance to gate, no route to authorize, no persistence to audit — and its body already refuses repository / extern / emit / this-write. Move the rule to the aggregate operation that owns the state.`,
  "loom.callable-modifier-not-allowed-here#workflow": (p: { feature: unknown; label: unknown }) =>
    `'${p.feature}' is not allowed on ${p.label}. A workflow member is orchestration, not an aggregate method: there is no 'this' for a 'when' canCommand gate to read, and the aggregate-only modifiers ('private' / 'extern' / 'audited') have no member to attach to. A workflow's command entry ('create') takes 'requires'; the workflow header takes its own 'requires' for the instance READ.`,
  "loom.callable-modifier-not-allowed-here#page-action": (p: {
    feature: unknown;
    label: unknown;
  }) =>
    `'${p.feature}' is not allowed on ${p.label}. A page or component 'action' runs in the browser, where the server-side modifiers mean nothing and nothing is enforceable. A page's own gate is the 'requires' page property; authorize the operation the action calls.`,

  // ----------------------------------------------------------------------
  // src/language/validators/handlers.ts
  // ----------------------------------------------------------------------
  "loom.extern-handler-has-body": (p: { kind: unknown; name: unknown }) =>
    `extern ${p.kind} '${p.name}' must be bodyless — its implementation is a ` +
    `scaffold-once, user-owned file the generated dispatch calls, not a DSL body. ` +
    `End the declaration with ';', or drop 'extern' to make it a normal handler.`,
  "loom.handler-missing-body": (p: { kind: unknown; name: unknown }) =>
    `${p.kind} '${p.name}' requires a '{ … }' body. Mark it 'extern' (and end with ';') ` +
    `to hand the implementation to a scaffold-once user-owned file.`,

  // ----------------------------------------------------------------------
  // src/language/validators/match.ts
  // ----------------------------------------------------------------------
  "loom.match-subject-not-simple":
    `A variant 'match' subject must be a simple reference or let-bound name — not a call. ` +
    `Bind the result to a 'let' first, then match on that name (avoids double-evaluation).`,

  // ----------------------------------------------------------------------
  // src/language/validators/seed.ts
  // ----------------------------------------------------------------------
  // The `ThrowKind` grammar slot is reachable on any member call — it had to be,
  // because `precondition` / `invariant` are hard keywords no `CallArg` can
  // carry.  The word would otherwise be silently dropped in lowering (it is a
  // sibling of `args`, not a member of it): validates clean, means something
  // else.
  "loom.throw-kind-outside-tothrow": (p: { kind: unknown; member: unknown }) =>
    `'${p.kind}' is a throw-KIND word, not a value — it is only meaningful as the argument ` +
    `of the throw assertion, \`expect(<call>).toThrow(${p.kind})\`. Here it sits in ` +
    `\`.${p.member}(...)\`, which would drop it. If you meant the domain rule, a ` +
    "`precondition` is a statement in an operation body and an `invariant` is an aggregate " +
    "member — neither is an expression.",
  // `toThrow(<kind>)` in a CONTEXT-INTEGRATION test.  Third tier, third reason:
  // not the wire flattening the rung (that is the e2e message above) — simply
  // that this tier renders through a different emitter which does not carry
  // the rung, and would drop the word.
  "loom.throw-kind-integration-unsupported": (p: {
    kind: unknown;
    name: unknown;
    testName: unknown;
  }) =>
    `context '${p.name}' integration test '${p.testName}': 'toThrow(${p.kind})' pins WHICH ` +
    "domain rung rejected the call, and that is a UNIT-tier assertion. The context-integration " +
    "rung renders through a separate emitter that carries no rung, so the argument would be " +
    "dropped and the test would quietly assert only that something threw. Use a bare " +
    `\`toThrow()\` here, and assert the rung in a unit \`test\` nested in the aggregate, ` +
    `where \`toThrow(${p.kind})\` reads the real domain error.`,

  // ----------------------------------------------------------------------
  // src/language/validators/statements.ts
  // ----------------------------------------------------------------------
  "loom.when-references-op-param": (p: { name: unknown; param: unknown }) =>
    `'when' on operation '${p.name}' references parameter '${p.param}' — a 'when' gate ` +
    `is a predicate over the aggregate's state only (its can-${p.name} query has no ` +
    `arguments). Move argument-aware checks into a 'precondition' in the body, or ` +
    `express them as 'from <Criterion>(args)'.`,

  // --- the M-T9.56 drain of `statements.ts` -------------------------------
  "loom.when-private-operation": (p: { name: unknown }) =>
    `'when' on private operation '${p.name}' gates the domain method but exposes nothing — a private operation has no HTTP entry point, so no can-${p.name} query is emitted for a UI to read the gate.`,
  "loom.when-not-bool": (p: { actual: unknown }) =>
    `'when' must be of type 'bool', got '${p.actual}'.`,
  "loom.operation-self-call": (p: { name: unknown }) => `Operation '${p.name}' calls itself.`,
  "loom.bare-statement-invalid":
    "Bare statement must be an assignment, collection mutation, or function/operation call.",

  // ----------------------------------------------------------------------
  // src/language/validators/stmt-placement.ts
  // ----------------------------------------------------------------------
  "loom.if-let-placement": (p: { owner: unknown }) =>
    `'if let' binds the optional result of a repository read and branches on its presence; only a workflow body ('create' / 'on') or a top-level 'commandHandler' / 'queryHandler' lowers it. This one is in ${p.owner}, which has no such lowering — do the optional read in a workflow or handler and pass the resolved value in. This is a permanent placement rule, not a missing feature.`,
  "loom.for-placement": (p: { owner: unknown }) =>
    `'for … in …' is lowered only inside a workflow body ('create' / 'on') or a top-level 'commandHandler' / 'queryHandler' — that lowering owns the per-iteration save the loop needs. This one is in ${p.owner}, where the loop would be dropped silently. Put it in a workflow or handler for now; this is a GAP, not a design rule — mission M-T5.30 tracks lowering 'for' into domain bodies.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.bare-aggregate-in-type": (p: { aggName: unknown }) =>
    `References across aggregate boundaries need an id link — write '${p.aggName} id' (or '${p.aggName} id[]' for many-to-many).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/structural-checks.ts
  // ----------------------------------------------------------------------
  // A block-bodied `function` is a PURE helper over its parameters.  The five
  // variants below are the five ways a body reaches past that.  None leads with
  // a location: the site's `source` is already `Ctx/Owner.function[name]`, which
  // says the kind and the name both.
  "loom.function-block-impure#mutation": (p: { target: unknown }) =>
    `'${p.target}' is mutated, but a 'function' is a PURE helper over its parameters — ` +
    `it may not write aggregate state.  Move the mutation into an 'operation' (which ` +
    `owns 'this'), or return a value instead.`,
  "loom.function-block-impure#emit": (p: { eventName: unknown }) =>
    `'emit ${p.eventName}' is not allowed — a 'function' is pure (no side effects).  ` +
    `Emit the event from the 'operation' that decides it.`,
  "loom.function-block-impure#call-stmt": (p: { name: unknown; target: unknown }) =>
    `call to '${p.name}' (${p.target}) is not allowed in a pure block-body 'function' — ` +
    `it invokes a mutating operation/action.  Call a pure 'function', or move the logic ` +
    `into an 'operation'.`,
  "loom.function-block-impure#call-expr": (p: { name: unknown; callKind: unknown }) =>
    `call to '${p.name}' (${p.callKind}) reaches beyond the pure subset — a block-body ` +
    `'function' may only call other pure 'function's (no operations, repository reads, ` +
    `domain services, externs, or workflow starts).  Move the side-effecting logic into ` +
    `an 'operation' or a 'domainService'.`,
  "loom.function-block-impure#method-call": (p: { member: unknown }) =>
    `method call '${p.member}(…)' on a receiver is not allowed in a pure block-body ` +
    `'function' — call a pure 'function' instead, or move the logic into an 'operation'.`,

  // --- M-T5.34 / #2864 D6, decision D-2 -----------------------------------
  "loom.unmapped-error-status": (p: { name: unknown; aggName: unknown; opName: unknown }) =>
    `error '${p.name}' returned by '${p.aggName}.${p.opName}' has no stdlib default HTTP ` +
    `status and no api \`httpStatus ${p.name} -> <code>\` mapping, so it defaults to 500. Add ` +
    `a \`httpStatus ${p.name} -> <code>\` line to the api serving this context to set an ` +
    `explicit status.`,
  "loom.extern-on-private-operation": (p: { name: unknown; opName: unknown }) =>
    `aggregate '${p.name}' operation '${p.opName}': 'extern' isn't valid on a private operation. ` +
    `Private operations are callable only from inside the aggregate, so there's nowhere for an external handler to plug in. Make the operation public, or drop 'extern'.`,
  "loom.extern-body-not-precondition": (p: { name: unknown; opName: unknown; kind: unknown }) =>
    `aggregate '${p.name}' operation '${p.opName}': 'extern' bodies may only contain 'precondition' statements (found '${p.kind}'). ` +
    `The user-supplied handler owns mutation, emit, and any other logic — leave the .ddd body to the gates that run before it.`,
  "loom.loop-gate-not-implied": (p: {
    where: unknown;
    loopVar: unknown;
    source: unknown;
    op: unknown;
    gate: unknown;
  }) =>
    `${p.where} calls '${p.op}' on every '${p.loopVar}' in '${p.source}', but the read's predicate does not ` +
    `include the operation's gate '${p.gate}' — every row that fails it aborts the loop with 409 Disallowed. ` +
    `Add the gate's conjuncts to the criterion or retrieval the read runs (\`… && ${p.gate}\`).`,

  // --- the M-T9.56 drain of `match.ts` ------------------------------------
  // The `match { … }` shape rules and the `expect(…).<matcher>(…)` vocabulary,
  // all of which used to arrive as `loom.unknown`.
  "loom.match-empty": "Empty 'match { }' — must declare at least one arm or an 'else' branch.",
  "loom.match-no-else":
    "'match' expression has no 'else' arm — when no arm matches, the expression is undefined. Add 'else => …' for exhaustive coverage.",
  "loom.match-non-union-subject": (p: { subjectType: unknown }) =>
    `variant 'match' subject is not a union — its type is ${
      p.subjectType
    }. A variant match discriminates an 'or'-union value by variant.`,
  "loom.match-unknown-variant": (p: { varType: unknown; variants: unknown }) =>
    `variant 'match' arm names '${p.varType}', which is not a variant of the subject union {${p.variants}}.`,
  "loom.match-duplicate-variant": (p: { varType: unknown }) =>
    `variant 'match' matches '${p.varType}' more than once — each variant may appear in at most one arm.`,
  "loom.match-non-exhaustive": (p: { missingTags: unknown }) =>
    `variant 'match' does not cover ${p.missingTags} and has no 'else' arm — the expression is undefined for those variants. Add the missing arm(s) or an 'else => …'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/toplevel-function.ts
  // ----------------------------------------------------------------------
  "loom.function-toplevel-block": (p: { name: unknown }) =>
    `A top-level 'function' must be expression-form ('function ${p.name}(…): T = <expr>'). ` +
    `Block-form top-level functions (a '{ … }' body) aren't supported yet — express it as a ` +
    `single expression, or make it a member of an aggregate / value object.`,
  "loom.function-recursive": (p: { name: unknown }) =>
    `Top-level 'function ${p.name}' is part of a recursion cycle. Expression-form functions ` +
    `inline at their call sites, so they must not call themselves — directly or through ` +
    `another top-level function that calls back.`,
  "loom.unhandled-result": (p: { call: unknown; type: unknown; errors: unknown }) =>
    `'${p.call}' returns '${p.type}' and its ${p.errors} case is discarded. ` +
    `Match it, return it from a caller whose declared result admits it, or bind it with 'let' and use it.`,
  "loom.unhandled-result#unread-let": (p: { name: unknown; type: unknown; errors: unknown }) =>
    `'let ${p.name}' holds a '${p.type}' that is never read, so its ${p.errors} case is discarded. ` +
    `Match it, return it, or use it.`,
  "loom.handler-return-not-last#match-arm": (p: { label: unknown }) =>
    `${p.label}: 'return' sits inside a 'match' arm.  A handler answers once, after its body has ` +
    `run, so an arm may end in 'return' only when the 'match' is the body's last statement, every ` +
    `arm ends in 'return' or 'notFound', and the result declares an expected failure ('T or E').  ` +
    `Otherwise compute the answer with the value form — 'let r = match x { A a => …, ` +
    `B b => … }' — and end the body with 'return r'.`,
  "loom.handler-return-not-last#arm-local-let": (p: { label: unknown; name: unknown }) =>
    `${p.label}: the 'return' of a 'match' arm reads '${p.name}', a 'let' declared inside the arm.  ` +
    `The handler answers once, after the 'match', where only the arm's binding and the lets ` +
    `declared before the 'match' are in scope.  Compute the value in the 'return' itself, or ` +
    `declare the 'let' before the 'match'.`,
  "loom.handler-return-not-last": (p: { label: unknown }) =>
    `${p.label}: 'return' must be the last top-level statement of the body, or the whole ` +
    `then-branch of a final 'if let … { return x } else { … notFound }'. A handler answers ` +
    `once, after its body has run, so a 'return' anywhere else would not stop the statements ` +
    `after it.`,
  "loom.function-return-type-mismatch": (p: {
    name: unknown;
    actual: unknown;
    declared: unknown;
  }) => `Function '${p.name}' returns '${p.actual}' but is declared to return '${p.declared}'.`,

  // ----------------------------------------------------------------------
  // src/language/validators/types.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `types.ts` ------------------------------------
  "loom.bare-collection-accessor": (p: { member: unknown }) =>
    `'${p.member}' over a collection needs a lambda — write '<collection>.${p.member}(x => …)'. A bare '.${p.member}' has no renderable form.`,
  "loom.function-block-no-return": (p: { name: unknown; declared: unknown }) =>
    `Block-body function '${p.name}' must 'return' a value of type '${p.declared}' on every path.  ` +
    `A 'return' inside an 'if' counts, but only when the conditional covers both paths — ` +
    `an 'if' (or an 'else if' chain) with no final 'else' leaves one path with no value.`,

  // ----------------------------------------------------------------------
  // src/language/validators/ui.ts
  // ----------------------------------------------------------------------
  "loom.extern-component-has-body": (p: { name: unknown; externPath: unknown }) =>
    `Extern component '${p.name}' must not declare a 'body:' — its rendering is owned by the hand-written module at '${p.externPath}'. Remove the body, or drop 'extern from' to make it a normal component.`,

  // --- the M-T9.56 drain of `ui.ts` ---------------------------------------
  "loom.extern-function-shadows-stdlib": (p: { name: unknown }) =>
    `extern function '${p.name}' shadows a walker-stdlib primitive.  Pick a different name.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/api-checks.ts
  // ----------------------------------------------------------------------
  "loom.handler-param-reserved-id": (p: { name: unknown; kind: unknown; hName: unknown }) =>
    `context '${p.name}': ${p.kind} '${p.hName}' has a parameter named 'id', which is ` +
    `reserved — a bare 'id' in a handler body resolves to the current entity's implicit id, ` +
    `not the parameter. Rename it (e.g. 'orderId').`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/domain-service-checks.ts
  // ----------------------------------------------------------------------
  "loom.domain-service-no-emit": (p: { where: unknown; eventName: unknown }) =>
    `${p.where}: 'emit ${p.eventName}' is not allowed — a stateless domain service has no identity to attribute an event to.  Emit from the aggregate or workflow that owns the fact.`,
  "loom.domain-service-no-mutation": (p: { where: unknown; segments: unknown; kind: unknown }) =>
    `${p.where}: '${p.segments} ${p.kind}' writes to aggregate state, but a domain service has no 'this' to mutate.  To mutate a passed-in aggregate, call its own operation (e.g. 'src.withdraw(amount)') — the mutating tier; or return a value instead.`,
  "loom.domain-service-no-repo-write": (p: {
    where: unknown;
    recvName: unknown;
    member: unknown;
  }) =>
    `${p.where}: repository WRITE '${p.recvName}.${p.member}(…)' is not allowed — a domain service may run read-only queries (the 'reading' tier), but persistence writes (remove, and the refused save/insert/update/add/commit) belong to the orchestrator (workflow / command handler).`,
  "loom.domain-service-read-unsupported": (p: {
    where: unknown;
    recvName: unknown;
    member: unknown;
  }) =>
    `${p.where}: the repository read '${p.recvName}.${p.member}(…)' is used as a MEMBER ` +
    `RECEIVER, and only a read that is the WHOLE expression is recognised — so no read port is ` +
    `threaded into the service and every backend emits the bare name '${p.recvName}' ` +
    `(TS2304 / CS0103 / "cannot find symbol" / F821, and invalid Elixir).  Bind it first ` +
    `(\`let x = ${p.recvName}.${p.member}(…)\`) and read the member off the binding.`,
  "loom.domain-service-no-workflow-start": (p: { where: unknown; recvName: unknown }) =>
    `${p.where}: starting workflow '${p.recvName}' is not allowed — a domain-layer service cannot reach into the application layer.`,
  "loom.domain-service-infra-call-from-aggregate": (p: {
    where: unknown;
    service: unknown;
    op: unknown;
  }) =>
    `${p.where}: call to domain service '${p.service}.${p.op}(…)' reaches beyond the aggregate boundary (a repository read, or mutating other passed-in aggregates), which the domain layer may not do from inside an aggregate operation.  Move the call into the orchestrating workflow / command handler, which loads the aggregates and owns the commit.`,
  "loom.domain-service-cross-context-read": (p: {
    where: unknown;
    recvName: unknown;
    ownContext: unknown;
    otherContext: unknown;
  }) =>
    `${p.where}: repository '${p.recvName}' is declared in context '${p.otherContext}', not in this service's own context '${p.ownContext}' — a domain service is an internal detail of its context and may only read its own repositories. Cross-context data crosses at the context's PUBLIC surface instead: have the orchestrating workflow fetch it — through '${p.otherContext}''s api (a 'resource { kind: api }' binding gives a typed in-system call), or from a local projection folded over '${p.otherContext}''s published events (via a channel) — and pass the value into the service as a parameter. Or move the service into '${p.otherContext}'.`,
  // The Phoenix emitter's internal floor for the same boundary.  It replaces a
  // branch that used to emit a `def` whose body was a RUNTIME `raise` — code
  // that compiles, ships, and fails on first call.  Structurally unreachable:
  // `lowerDomainService` resolves a service's repository reads against
  // `env.ctx.members` alone, so a read-port can never name a foreign
  // repository, and the shape that motivated the branch is refused at phase ⑦
  // by the code above.
  "loom.domain-service-cross-context-read#elixir-emit-invariant": (p: {
    operation: unknown;
    ports: unknown;
  }) =>
    `internal: elixir domain-service operation '${p.operation}' has read-ports outside its own context (${p.ports}). Lowering cannot produce that shape, and the IR validator's cross-context-read gate refuses the body that would want it — reaching here means a hand-built IR bypassed both.`,
  "loom.domain-service-single-aggregate": (p: { name: unknown }) =>
    `domainService '${p.name}': every operation takes a single aggregate parameter — consider declaring the behaviour as an 'operation' on that aggregate instead of a domain service.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/store-checks.ts
  // ----------------------------------------------------------------------
  "loom.if-stmt-page-body-unsupported": (p: { where: unknown; uiName: unknown }) =>
    `An \`if\` statement is used in ${p.where} on ui '${p.uiName}'.  The \`if\` ` +
    `STATEMENT is a backend-body form (aggregate / domain-service operations); no frontend ` +
    `renders it.  A page expresses a condition as a VALUE — a ternary ` +
    `(\`cond ? a : b\`) or a \`match { cond => …, else => … }\` — and discriminates a ` +
    `union result with \`match await <op>() { … }\`.`,

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
  "loom.match-await-arg-mismatch": (p: {
    where: unknown;
    aggregate: unknown;
    op: unknown;
    length: unknown;
    sig: unknown;
    paramsLength: unknown;
    length2: unknown;
  }) =>
    `\`match await ${p.aggregate}.${p.op}(…)\` passes ${p.length} ` +
    `argument(s), but operation \`${p.op}(${p.sig})\` expects ${p.paramsLength} ` +
    `(${p.length2} required).  The awaited call's ` +
    `arguments build the request payload — a mismatch ships a broken request.  Pass one argument ` +
    `per parameter, in order.`,
  "loom.match-await-arg-type": (p: {
    where: unknown;
    aggregate: unknown;
    op: unknown;
    argFam: unknown;
    value: unknown;
    name: unknown;
    type: unknown;
    paramFam: unknown;
  }) =>
    `\`match await ${p.aggregate}.${p.op}(…)\` passes a ${p.argFam} ` +
    `literal (\`${p.value}\`) for parameter \`${p.name}: ${p.type}\` ` +
    `(a ${p.paramFam} type).  The argument encodes into the request payload — pass a ${p.paramFam} value.`,
  "loom.method-call-unresolved-receiver": (p: {
    where: unknown;
    receiver: unknown;
    member: unknown;
    name: unknown;
  }) =>
    `method call \`${p.receiver}.${p.member}(…)\` has an ` +
    `unresolved receiver '${p.name}'. A method-call receiver must resolve to a page/component ` +
    `parameter, state / derived value, lambda binding, or a declared api handle ` +
    `(\`api <Handle>: <Api>\`). Declare the handle, or fix the reference.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/workflow-checks.ts
  // ----------------------------------------------------------------------
  "loom.handler-unknown-name": (p: {
    handler: unknown;
    where: unknown;
    name: unknown;
    reason: unknown;
  }) =>
    `${p.handler}: ${p.where} references '${p.name}', which binds to nothing in a handler body — ` +
    `it is ${p.reason}. Every backend would render '${p.name}' verbatim as a name the generated ` +
    `handler never binds, so the project would not compile. Use a parameter, a 'let' binding, or ` +
    `a read of this context's own repositories bound to a 'let' ('let x = <Repo>.get(…)').`,
  "loom.iflet-bad-source": (p: { name: unknown; var: unknown }) =>
    `workflow '${p.name}': 'if let ${p.var} = ...' must bind 'Repo.find(<Criterion>)', 'Repo.find(id)' or 'Repo.findBy(…)' (a read that answers 'T?').`,
  "loom.iflet-bad-source#handler": (p: { kind: unknown; name: unknown; var: unknown }) =>
    `${p.kind} '${p.name}': 'if let ${p.var} = ...' must bind 'Repo.find(<Criterion>)', 'Repo.find(id)' or 'Repo.findBy(…)' (a read that answers 'T?').`,
} satisfies Record<string, MessageEntry>;
