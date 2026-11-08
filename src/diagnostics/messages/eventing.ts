// The `eventing` family of the diagnostic-message catalog: events, event sourcing, appliers, correlation, channels and integration relays.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.  A code with a brand-new first segment adds
// that segment to the family it belongs with.

import { didYouMean, type MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = [
  "event",
  "correlation",
  "emit",
  "applier",
  "emitted",
  "channel",
  "channelsource",
  "relay",
  "integration",
  "on",
  "shape",
] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/channel.ts
  // ----------------------------------------------------------------------
  "loom.channel-key-missing-field": (p: { name: unknown; key: unknown; evName: unknown }) =>
    `channel '${p.name}' key '${p.key}' is not a field of carried event '${p.evName}'.`,
  "loom.channelsource-transport-invalid": (p: {
    name: unknown;
    chName: unknown;
    refName: unknown;
    storageType: unknown;
    ok: unknown;
    ok2: unknown;
  }) =>
    `channelSource '${p.name}' binds channel '${p.chName}' to storage '${p.refName}' of type '${p.storageType}', which is not a channel transport. Supported transports${p.ok}: ${p.ok2}.`,
  "loom.channelsource-incompatible": (p: {
    name: unknown;
    chName: unknown;
    delivery: unknown;
    retention: unknown;
    refName: unknown;
    storageType: unknown;
    ok: unknown;
  }) =>
    `channelSource '${p.name}' binds channel '${p.chName}' (${p.delivery}/${p.retention}) to storage '${p.refName}' of type '${p.storageType}', which can't realise it. Compatible: ${p.ok}.`,
  "loom.channelsource-not-yet-shipped": (p: {
    name: unknown;
    chName: unknown;
    delivery: unknown;
    retention: unknown;
    refName: unknown;
    storageType: unknown;
    length: unknown;
    length2: unknown;
  }) =>
    `channelSource '${p.name}' binds channel '${p.chName}' (${p.delivery}/${p.retention}) to storage '${p.refName}' of type '${p.storageType}'. That combination is compatible but not yet provisioned by a shipped ${p.storageType} driver.${p.length} or pick a combo ${p.storageType} does ship (${p.length2}).`,

  // --- the M-T9.56 drain of `statements.ts` -------------------------------
  "loom.emit-field-type": (p: { name: unknown; expected: unknown; actual: unknown }) =>
    `Field '${p.name}' expects '${p.expected}' but got '${p.actual}'.`,
  "loom.emit-field-missing": (p: { name: unknown }) => `Event field '${p.name}' not provided.`,

  // ----------------------------------------------------------------------
  // src/language/validators/structural.ts
  // ----------------------------------------------------------------------
  // --- the M-T9.56 drain of `structural.ts` -------------------------------
  "loom.on-duplicate-subscription": (p: { name: unknown; o: unknown }) =>
    `Workflow '${p.name}' declares more than one on(...) reactor for event '${p.o}'. ` +
    `Each inbound event routes to one reactor; if these are intentional alternates, distinguish them by their 'by' clause.`,
  "loom.applier-on-non-event-sourced#ast": (p: { name: unknown }) =>
    `Aggregate '${p.name}' declares apply(...) but is not event-sourced. ` +
    `Appliers fold events into state; add 'persistedAs: eventLog' to the aggregate header, or remove the applier.`,
  "loom.event-sourced-multiple-creates#ast": (p: { name: unknown }) =>
    `Aggregate '${p.name}' is persistedAs: eventLog and declares multiple 'create' actions. ` +
    `An event-sourced aggregate has a single canonical creator (v1) — keep one 'create(...)'.`,
  "loom.event-sourced-command-mutation": (p: { name: unknown }) =>
    `Aggregate '${p.name}' is event-sourced — a command body must not mutate 'this' directly. ` +
    `Replace the assignment with an 'emit' and fold it in an apply(...) block.`,
  "loom.emitted-event-no-applier": (p: { ev: unknown; name: unknown }) =>
    `Event '${p.ev}' is emitted but no applier folds it. ` +
    `Add an apply(${p.ev}: ${p.ev}) block to aggregate '${p.name}', or the event is recorded but never reflected in state.`,
  "loom.applier-impure#apply-must-not-emit-an": (p: { ap: unknown }) =>
    `apply(${p.ap}) must not emit — an applier reacts to an event by folding it into state. ` +
    `Move the 'emit' to the command body that decides it.`,
  "loom.applier-impure#apply-must-not-call-out": (p: { ap: unknown }) =>
    `apply(${p.ap}) must not call out — applier bodies are deterministic, replayable folds (assignments and 'let' only).`,
  "loom.applier-impure#apply-must-not-guard-by": (p: { ap: unknown }) =>
    `apply(${p.ap}) must not guard — by the time an event is applied the decision is already made; put the guard in the command.`,
  "loom.shape-on-event-sourced": (p: { name: unknown; shape: unknown }) =>
    `\`shape: ${p.shape}\` on event-sourced aggregate '${p.name}' is ignored — every backend's ` +
    `schema emitter short-circuits on \`persistedAs: eventLog\` before it reads \`shape:\`, so ` +
    `the aggregate persists as an event stream and the knob changes nothing (the generated ` +
    `output is byte-identical without it).  Snapshot rehydration in a document/embedded shape ` +
    `is not implemented yet.  Drop the \`shape:\` clause, or drop \`persistedAs: eventLog\` if ` +
    `you meant document storage.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/structural-checks.ts
  // ----------------------------------------------------------------------
  "loom.applier-on-non-event-sourced#ir": (p: { name: unknown }) =>
    `aggregate '${p.name}' declares apply(...) but is not event-sourced. ` +
    `Appliers fold events into state; they only apply to a 'persistedAs: eventLog' aggregate. ` +
    `Add 'persistedAs: eventLog' to the aggregate header, or remove the applier.`,
  "loom.event-sourced-multiple-creates#ir": (p: { name: unknown; length: unknown }) =>
    `aggregate '${p.name}' is persistedAs: eventLog and declares ${p.length} 'create' actions. ` +
    `An event-sourced aggregate has a single canonical creator (v1) — keep one 'create(...)'.`,

  // --- M-T5.34 / #2864 D6, decision D-2 -----------------------------------
  "loom.event-sourced-direct-mutation": (p: { name: unknown; label: unknown }) =>
    `aggregate '${p.name}' ${p.label} mutates 'this' directly, but the aggregate is event-sourced. ` +
    `Command bodies on a 'persistedAs: eventLog' aggregate decide and 'emit'; the state change belongs in an apply(...) block. ` +
    `Replace the assignment with an 'emit', and fold it in an applier.`,
  "loom.emitted-event-unhandled": (p: { name: unknown; label: unknown; eventName: unknown }) =>
    `aggregate '${p.name}' ${p.label} emits '${p.eventName}' but no applier folds it. ` +
    `Every emitted event needs a matching apply(${p.eventName}: ${p.eventName}) on the aggregate, ` +
    `or the event is recorded but never reflected in state.`,
  "loom.applier-emits": (p: { owner: unknown; event: unknown }) =>
    `${p.owner} apply(${p.event}) emits an event. ` +
    `An applier reacts to an event by folding it into state — it must not emit. ` +
    `Move the 'emit' to the command body that decides it.`,
  "loom.applier-impure-call": (p: { owner: unknown; event: unknown; stmtName: unknown }) =>
    `${p.owner} apply(${p.event}) calls '${p.stmtName}'. ` +
    `Applier bodies must be deterministic, replayable folds — assignments and 'let' only, no side-effecting calls.`,
  "loom.applier-impure-call#expression": (p: { owner: unknown; event: unknown; what: unknown }) =>
    `${p.owner} apply(${p.event}) evaluates '${p.what}'. ` +
    `An applier is a replayable fold of the event into state: a repository read, an aggregate create ` +
    `or a resource call gives a different result on every replay. ` +
    `Do the read or create in the command that decides the event and carry what it needs on the event.`,
  "loom.applier-guard": (p: { owner: unknown; event: unknown; kind: unknown }) =>
    `${p.owner} apply(${p.event}) contains a '${p.kind}' statement. ` +
    `Guards belong in the command that decides the event; by the time it is applied the decision is already made.`,
  // The statement vocabulary of a body position (`body-stmt-vocabulary.ts`).
  "loom.applier-stmt-invalid": (p: {
    owner: unknown;
    event: unknown;
    kind: unknown;
    allowed: unknown;
  }) =>
    `${p.owner} apply(${p.event}) contains a ${p.kind} statement. ` +
    `An applier is a pure fold of the event into state — it yields no value and calls nothing for its effect — ` +
    `so its body holds ${p.allowed} statements only. ` +
    `Compute a value with 'let', or move the statement to the command body that decides the event.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/ui-framework-checks.ts — the two LiveView
  // component-HOISTING collisions (§18 emitter sentinels).  Both used to be a
  // bare `throw new Error` in `liveview-emit.ts`, raised mid-generate on a
  // `.ddd` that had just validated `0 error(s), 0 warning(s)`.
  // ----------------------------------------------------------------------
  "loom.channelsource-unbound": (p: { name: unknown; channelName: unknown }) =>
    `channelSource '${p.name}' (channel '${p.channelName}') is listed by no ` +
    `deployable's 'channels:' clause — the binding is declared but inert: no broker ` +
    `is provisioned and events stay on in-process dispatch. Add it to a deployable ` +
    `that produces or consumes '${p.channelName}', or remove it.`,
  "loom.channel-consumer-unwired": (p: {
    name: unknown;
    chName: unknown;
    carries: unknown;
    csNames: unknown;
  }) =>
    `Deployable '${p.name}' consumes events of channel '${p.chName}' ` +
    `(${p.carries}), which is bound to a ` +
    `broker via channelSource '${p.csNames}' on another deployable — but '${p.name}' ` +
    `doesn't list the binding. Once traffic rides the broker this consumer would ` +
    `silently receive nothing. Add \`channels: [${p.csNames}]\` to '${p.name}'.`,
  "loom.channel-consumer-unwired#unbound": (p: {
    name: unknown;
    chName: unknown;
    carries: unknown;
    ctxName: unknown;
  }) =>
    `Deployable '${p.name}' consumes events of channel '${p.chName}' ` +
    `(${p.carries}), but the channel is bound to no broker and its owning context ` +
    `'${p.ctxName}' runs on another deployable — events only travel in-process, so ` +
    `this consumer would never receive them. Declare a \`channelSource\` for ` +
    `'${p.chName}' and list it in \`channels: [...]\` on both deployables, or host ` +
    `'${p.ctxName}' on '${p.name}'.`,
  "loom.relay-target-not-subscribed": (p: {
    name: unknown;
    uiName: unknown;
    channelName: unknown;
    owner: unknown;
    pName: unknown;
    relayName: unknown;
  }) =>
    `Deployable '${p.name}': ui '${p.uiName}' subscribes to channel ` +
    `'${p.channelName}' (context '${p.owner}') via an 'on ${p.pName}.<Event>' handler, ` +
    `but its relay backend '${p.relayName}' neither hosts '${p.owner}' nor binds the ` +
    `channel — the SSE relay can't legally serve those events, so the handler receives ` +
    `nothing. Host '${p.owner}' on '${p.relayName}', or add a channelSource for ` +
    `'${p.channelName}' to its 'channels:' clause.`,
  "loom.event-sourcing-backend-unsupported": (p: { name: unknown }) =>
    `aggregate '${p.name}' is persistedAs: eventLog, but no backend deployable hosts this ` +
    `context, so there is no event-sourced storage emission target. Host the context on a ` +
    `backend deployable, or drop persistedAs: eventLog to use state persistence. ` +
    `Tracked in workflow-and-applier.md (appliers A2).`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/test-checks.ts
  // ----------------------------------------------------------------------
  "loom.integration-find-must-bind": (p: { name: unknown; testName: unknown }) =>
    `context '${p.name}' integration test '${p.testName}': a repository read inside ` +
    `'expect(...)' must be let-bound first — write \`let x = <Agg>.find(...)\` then ` +
    `assert over \`x\` (the integration renderer awaits the read at statement level).`,
  "loom.integration-repository-call": (p: {
    name: unknown;
    testName: unknown;
    repo: unknown;
    member: unknown;
    agg: unknown;
  }) =>
    `context '${p.name}' integration test '${p.testName}': \`${p.repo}.${p.member}(…)\` calls the repository by name, ` +
    `which an integration test body does not resolve. Root persistence reads at the aggregate instead — ` +
    `\`let x = ${p.agg}.find(...)\` — and let a factory \`let\` be saved for you.`,

  // ----------------------------------------------------------------------
  // src/ir/validate/checks/workflow-checks.ts
  // ----------------------------------------------------------------------
  "loom.event-create-overlap-workflow": (p: { name: unknown; count: unknown; event: unknown }) =>
    `workflow '${p.name}' declares ${p.count} event-triggered 'create' starters on event ` +
    `'${p.event}'; an event may start at most one create per workflow (the runtime can't ` +
    `choose which instance to allocate).`,
  "loom.correlation-field-ambiguous": (p: {
    name: unknown;
    length: unknown;
    idFields: unknown;
    why?: unknown;
  }) =>
    `workflow '${p.name}' has ${p.length} id-shaped state fields ` +
    `(${p.idFields}); the correlation field can't be inferred. ` +
    (p.why === "stream"
      ? `An event-sourced workflow keys its event stream by it, so it must declare exactly one id-shaped field.`
      : `A workflow with event consumers must declare exactly one id-shaped field.`),
  "loom.correlation-type-mismatch": (p: {
    name: unknown;
    label: unknown;
    byTarget: unknown;
    corrName: unknown;
    corrTarget: unknown;
  }) =>
    `workflow '${p.name}': the 'by' expression on ${p.label} yields ` +
    `${p.byTarget}, but the correlation field ` +
    `'${p.corrName}' is '${p.corrTarget} id'. A 'by' clause must route by the correlation field's type.`,
  "loom.correlation-uninferrable": (p: {
    name: unknown;
    label: unknown;
    event: unknown;
    corrName: unknown;
  }) =>
    `workflow '${p.name}': ${p.label} omits 'by' but event '${p.event}' has no ` +
    `field named '${p.corrName}' to infer routing from. Add a 'by <expr>' clause.`,
  // The AST-phase (④) twin of `loom.workflow-emit-unknown-field` below: the
  // IR check only sees `emit` inside a WORKFLOW, while `checkEmit` in
  // `src/language/validators/statements.ts` sees every `emit` — aggregate
  // operations included.  Both fire on a workflow emit, which is why the
  // firing fixture raises the pair.
  "loom.emit-unknown-field": (p: { evName: unknown; f: unknown; suggestion?: unknown }) =>
    `Event '${p.evName}' has no field '${p.f}'.` + didYouMean(p.suggestion),
} satisfies Record<string, MessageEntry>;
