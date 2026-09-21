// -------------------------------------------------------------------------
// Workflow checks — correlation typing, workflow-body legality, and
// resource-op expressions.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { lowerFirst } from "../../../util/naming.js";
import { createInputFields, omittableCreateInputs } from "../../enrich/wire-projection.js";
import { verbsForKind } from "../../resource-verbs.js";
import type {
  AggregateIR,
  BoundedContextIR,
  EventIR,
  ExprIR,
  RepositoryIR,
  TypeIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../../types/loom-ir.js";
import { findUsesCurrentUser } from "../../types/loom-ir.js";
import {
  walkExprDeep,
  walkStmtExprsDeep,
  walkWorkflowStmtExprsDeep,
  walkWorkflowStmtsDeep,
} from "../../util/walk.js";
import { emitsCommandRoute } from "../../util/workflow-command-route.js";
import {
  commandCreateCorrelationParam,
  facadeCreate,
  workflowBodyUsesOwnState,
} from "../../util/workflow-own-state.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { foreignRepositoryOwners } from "./shared.js";

// ---------------------------------------------------------------------------
// Workflow validation.
//
// A `workflow` is a context-level orchestration of aggregate operations.
// The grammar reuses operation-body Statement rules; this validator
// constrains the surface to what workflow lowering supports:
//
//   - factory-let (`let x = Agg.create({...})`)
//   - repo-let (`let x = Repo.method(args)`) returning a single
//     non-nullable aggregate
//   - op-call (`name.op(args)` on a let binding)
//   - precondition / emit
//
// Mutation forms (`:=`, `+=`, `-=`), bare-call statements, deep paths,
// nullable / array repo returns, and op-calls on non-aggregate
// bindings all surface as errors here.
// ---------------------------------------------------------------------------

// RETIRED HERE (**D-PROJECTION-IMPLICIT-SUB**): `loom.reactor-event-uncarried`
// and `loom.projection-event-uncarried` warned that an `on(e: E)` whose event no
// `channel` carries "never fires".  That was true only because
// `deriveEventSubscriptions` dropped the consumer on the floor; the decision
// ruled that `on(e: E)` IS the subscription and a `channel` decides
// cross-deployable delivery and durability, not whether a handler runs.  The
// derivation now yields an implicit in-process subscription for every consumer
// and all five backends dispatch it (corpus fixture
// `projection-implicit-sub.ddd`), so both warnings became false statements about
// the emitted code and are deleted rather than reworded.  The channel-AMBIGUITY
// check below is untouched: two channels carrying one event is still ambiguous.
//
// A workflow's event consumers — `on(e: Event)` reactors and event-triggered
// `create(e: Event) by` starters — as `{ event, label }` pairs.  Shared by the
// channel-AMBIGUITY check below (`reactor-channel-ambiguous`).
function eventConsumersOf(wf: WorkflowIR): { event: string; label: string }[] {
  return [
    ...(wf.subscriptions ?? []).map((s) => ({ event: s.event, label: `on(${s.event})` })),
    ...(wf.creates ?? [])
      .filter((cr) => cr.triggerKind === "event" && !!cr.eventRef)
      .map((cr) => ({
        event: cr.eventRef as string,
        label: `create(${cr.eventBinding ?? "_"}: ${cr.eventRef})`,
      })),
  ];
}

// A workflow event consumer whose event is carried by MORE THAN ONE channel in
// its context has an ambiguous channel binding: the in-process dispatch enrich
// (`deriveEventSubscriptions`) records the first channel by declaration order.
// In-process delivery routes by event *type*, so the consumer still fires
// exactly once today — but once channels bind distinct transports (via
// `channelSource`), the routing is genuinely ambiguous.  There's no `via
// <Channel>` disambiguator in the grammar yet, so warn (don't block): carry the
// event on a single channel to make routing explicit.  Counted per context,
// matching the enrich's routing scope (`deriveEventSubscriptions(ctx.channels,
// …)`).
export function validateEventChannelAmbiguous(
  contexts: BoundedContextIR[],
  diags: LoomDiagnostic[],
): void {
  for (const c of contexts) {
    for (const wf of c.workflows) {
      for (const cons of eventConsumersOf(wf)) {
        const carriers = c.channels
          .filter((ch) => ch.carries.includes(cons.event))
          .map((ch) => ch.name);
        if (carriers.length > 1) {
          diags.push({
            severity: "warning",
            code: "loom.reactor-channel-ambiguous",
            message: diagMessage("loom.reactor-channel-ambiguous", {
              name: wf.name,
              label: cons.label,
              event: cons.event,
              length: carriers.length,
              carriers: carriers.join(", "),
              carriers2: carriers[0],
            }),
            source: `${c.name}/${wf.name}`,
          });
        }
      }
    }
  }
}

export function validateWorkflows(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  allEvents: EventIR[],
  /** Every context in the model — the cross-context-repository gate's input.
   *  REQUIRED, not optional: an omitted list would silently disable that gate,
   *  which is the exact failure shape it exists to close. */
  allCtxs: readonly BoundedContextIR[],
): void {
  // Repository names this context does NOT declare but a sibling does.
  const foreignRepos = foreignRepositoryOwners(ctx, allCtxs);
  // Reserved-name guard: workflows share the context namespace with
  // aggregates, value objects, enums, events, repositories.
  const namesUsed = new Map<string, string>();
  for (const a of ctx.aggregates) namesUsed.set(a.name, "aggregate");
  for (const v of ctx.valueObjects) namesUsed.set(v.name, "value object");
  for (const e of ctx.enums) namesUsed.set(e.name, "enum");
  for (const ev of ctx.events) namesUsed.set(ev.name, "event");
  for (const r of ctx.repositories) namesUsed.set(r.name, "repository");
  const seenWorkflowNames = new Set<string>();
  for (const wf of ctx.workflows) {
    if (seenWorkflowNames.has(wf.name)) {
      diags.push({
        severity: "error",
        code: "loom.duplicate-workflow",
        message: diagMessage("loom.duplicate-workflow", { name: ctx.name, wfName: wf.name }),
        source: `${ctx.name}/${wf.name}`,
      });
    } else {
      seenWorkflowNames.add(wf.name);
    }
    const clash = namesUsed.get(wf.name);
    if (clash) {
      diags.push({
        severity: "error",
        code: "loom.workflow-name-collision",
        message: diagMessage("loom.workflow-name-collision", {
          name: ctx.name,
          wfName: wf.name,
          clash,
        }),
        source: `${ctx.name}/${wf.name}`,
      });
    }
    // Runs BEFORE the body check: it reports the boundary violation and returns
    // the let-bindings it poisoned, so the body check can stay quiet about the
    // downstream symptoms instead of adding a second, misleading diagnostic.
    const crossContextBindings = validateWorkflowCrossContextRepositories(
      ctx,
      wf,
      foreignRepos,
      diags,
    );
    validateWorkflowBody(ctx, wf, diags, crossContextBindings);
    validateWorkflowInlineRepoCalls(ctx, wf, diags);
    validateWorkflowCorrelation(ctx, wf, diags, allEvents);
    validateWorkflowOwnStateAddressable(ctx, wf, diags);
    validateWorkflowCreates(wf, diags, ctx.name);
    validateWorkflowFunctions(wf, diags, ctx.name);
    validateWorkflowHandlers(wf, diags, ctx.name);
    validateWorkflowStarter(wf, diags, ctx.name);
  }
}

// A workflow `function` is emitted as a per-workflow-scoped MODULE helper (a
// workflow body is not a class), so it has no `this` at its emission site: it
// must be pure over its PARAMETERS and may not read the workflow's own state
// fields.  A body that references `this` / a state field would render an
// undefined `this` at module scope, so reject it here
// (`loom.workflow-function-uses-state`).  Pass the value in as a parameter
// instead.  (Sibling workflow-function calls are fine — they are module helpers
// too.)
function validateWorkflowFunctions(wf: WorkflowIR, diags: LoomDiagnostic[], ctxName: string): void {
  const readsState = (node: ExprIR): boolean =>
    node.kind === "this" ||
    (node.kind === "ref" &&
      (node.refKind === "this-prop" ||
        node.refKind === "this-vo-prop" ||
        node.refKind === "this-derived"));
  for (const fn of wf.functions ?? []) {
    let usesState = false;
    const visit = (node: ExprIR): void => {
      if (readsState(node)) usesState = true;
    };
    // Both forms: the expression body, or every expression reachable from the
    // pure block body's statements (let / precondition / return).
    if ("expr" in fn.body) walkExprDeep(fn.body.expr, visit);
    else for (const s of fn.body.stmts) walkStmtExprsDeep(s, visit);
    if (usesState) {
      diags.push({
        severity: "error",
        code: "loom.workflow-function-uses-state",
        message: diagMessage("loom.workflow-function-uses-state", {
          ctxName,
          name: wf.name,
          fnName: fn.name,
        }),
        source: `${ctxName}/${wf.name}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// INLINE REPOSITORY CALLS — `loom.workflow-inline-repository-call`.
//
// Repository access from a workflow IS supported — but only in ONE spelling:
// bound to its own `let` statement.  `lowerWorkflowStatement` recognises a
// repository read exclusively in the `isLetStmt` arm (`matchRepoCall` /
// `matchFindCall` / `matchFindAllCall` / `matchRetrievalRunCall` from
// `lower/repo-read.ts`) and lowers it to a `repo-let` / `repo-run`
// `WorkflowStmtIR` that carries the repository as a STRING field (`repoName`),
// never as an expression.
//
// The identical call written INLINE inside another expression — a
// `precondition`, a `requires`, an `assign` RHS, an `emit` field, a `for-each`
// iterable — goes through `lowerExpr`, where a repository name resolves to
// nothing: it stays a `method-call` on a `ref` with `refKind: "unknown"`.
// Two silent consequences follow:
//
//   1. every backend derives the repositories to instantiate from the
//      STATEMENT KINDS it walks (`repo-let` / `repo-run` / `repo-delete` /
//      `factory-let` / the exit saves) — hono `workflow-builder.ts`, dotnet
//      `workflow-emit.ts`, java `emit/workflow.ts`, python
//      `workflows-builder.ts` — so an expression-level repository reference
//      never instantiates anything, and
//   2. each backend's expression renderer emits the unresolved receiver
//      verbatim.
//
// Verified 2026-09-13 on `precondition tech.skills.contains(
// Assets.getById(job.assetId).requiredSkill)` inside a transactional workflow
// whose two other repositories ARE let-bound: `ddd parse` and
// `generate system` both report ZERO diagnostics, and `api/http/workflows.ts`
// emits
//
//   const technicians = new TechnicianRepository(tx, events);   // let-bound ✓
//   const jobs = new JobRepository(tx, events);                 // let-bound ✓
//   if (!((tech.skills).includes(Assets.getById(job.assetId).requiredSkill)))
//                                ^^^^^^ never constructed → TS2304
//
// One MODEL-level shape that no backend supports, not five per-backend gaps —
// so this takes the same call as `loom.domain-service-cross-context-read`
// (domain-service-checks.ts): reject at the source rather than let five
// emitters fail five different silent ways.
//
// SCOPE.  The gate keys on a bare `ref` that (a) did not resolve
// (`refKind: "unknown"`, so a param / let / state field shadowing the name is
// never flagged) and (b) names a repository declared in THIS context.  A
// legitimate let-bound read is structurally invisible to the walk — its
// repository lives in `repoName`, a string, not in any child expression — so
// the correct spelling can never trip this.  A repository of ANOTHER context is
// deliberately out of scope: that is the cross-context workflow-access hole,
// a different root cause with its own slice.
// ---------------------------------------------------------------------------

/** Every workflow body that lowers to `WorkflowStmtIR`, with a label for the
 *  diagnostic.  `wf.statements` is a facade over the primary create, so the
 *  creates are read from `wf.creates` to avoid reporting the primary twice.
 *
 *  Named distinctly from the unlabeled, statements-only `workflowBodies`
 *  below (used by {@link validateWorkflowBody}'s per-body loop) — same
 *  underlying facade, different shape for a different caller. */
function workflowBodiesLabeled(wf: WorkflowIR): { label: string; statements: WorkflowStmtIR[] }[] {
  return [
    ...wf.creates.map((c) => ({
      label: c.name === null ? "create" : `create ${c.name}`,
      statements: c.statements,
    })),
    ...(wf.handlers ?? []).map((h) => ({ label: `handle ${h.name}`, statements: h.statements })),
    ...(wf.subscriptions ?? []).map((s) => ({ label: `on(${s.event})`, statements: s.statements })),
  ];
}

/** `loom.workflow-inline-repository-call` — see the header note above. */
function validateWorkflowInlineRepoCalls(
  ctx: BoundedContextIR,
  wf: WorkflowIR,
  diags: LoomDiagnostic[],
): void {
  if (ctx.repositories.length === 0) return;
  const repoAgg = new Map(ctx.repositories.map((r) => [r.name, r.aggregateName] as const));
  for (const body of workflowBodiesLabeled(wf)) {
    // One diagnostic per repository per body — a body reaching the same
    // repository inline twice states the same problem once.  The method is
    // remembered from the first mention so the suggested rewrite can echo the
    // call the author actually wrote; a bare mention (`precondition Assets`)
    // leaves it undefined.
    const flagged = new Map<string, string | undefined>();
    const note = (repoName: string, method: string | undefined): void => {
      if (!flagged.has(repoName)) flagged.set(repoName, method);
    };
    const visit = (e: ExprIR): void => {
      // `walkExprDeep` visits a node before its children, so the enclosing
      // `method-call` is seen (and records its method) ahead of the bare
      // receiver `ref` below.
      if (
        e.kind === "method-call" &&
        e.receiver.kind === "ref" &&
        e.receiver.refKind === "unknown" &&
        repoAgg.has(e.receiver.name)
      ) {
        note(e.receiver.name, e.member);
      } else if (e.kind === "ref" && e.refKind === "unknown" && repoAgg.has(e.name)) {
        note(e.name, undefined);
      }
    };
    for (const st of body.statements) walkWorkflowStmtExprsDeep(st, visit);
    for (const [repoName, method] of flagged) {
      diags.push({
        severity: "error",
        code: "loom.workflow-inline-repository-call",
        message: diagMessage("loom.workflow-inline-repository-call", {
          where: `workflow '${wf.name}' ${body.label}`,
          repoName,
          call: `${repoName}.${method ?? "getById"}(…)`,
          binding: lowerFirst(repoAgg.get(repoName) as string),
        }),
        source: `${ctx.name}/${wf.name}`,
      });
    }
  }
}

// Workflow create-declaration well-formedness (workflow-and-applier.md A2-S5f,
// validation rules 21–23).  A workflow may declare several `create` starters —
// one per entry point.  These checks keep that set unambiguous so the runtime
// can route a command (or inbound event) to exactly one starter, and so the
// deprecated `params`/`statements` facade has a single, well-defined primary
// create to project from (it picks the unnamed command-triggered create).
//
//   - rule 21 (`loom.canonical-create-duplicate-workflow`) — at most one
//     unnamed (canonical) create; extra entry points must be named.
//   - rule 22 (`loom.create-name-conflict-workflow`)       — no two creates
//     share a name.
//   - rule 23 (`loom.event-create-overlap-workflow`)       — no two
//     event-triggered creates start on the same event.
//
// Rule 24 (create-vs-on correlation agreement) is not a check of its own: an
// event-triggered create's `by` clause is validated against the single
// correlation field by `validateWorkflowCorrelation`, exactly like a reactor,
// so a `create` and an `on` for one event necessarily agree.  (Both rules 23
// and 24 are now expressible: `CreateIR.eventRef` / `correlation` are derived
// for event-triggered creates.)
// -------------------------------------------------------------------------
// M-T5.34 — the two workflow rulings (#2864 D5 and G2).
//
// The packet's third command-side ruling (#2850 case (B)) is NOT here: it
// landed independently on `main` as `loom.workflow-create-correlation-unsupplied`
// (above), with a better rule than this packet had drafted — it also accepts a
// `<corr> := <param>` assignment and only fires when the body touches own
// state.  Nothing was kept from the draft.
// -------------------------------------------------------------------------

// D5 / decision D-1(c).  `handle <name>(…)` is documented as the multi-command
// saga surface (`docs/workflow.md`) and emits NOTHING on any of the five
// backends — searching a generated tree for the handler name finds only the
// mermaid diagram.  So a saga can be started and read (`/instances`,
// `/instances/{id}`) and never advanced, silently.
//
// The ruling is to REJECT, not to emit: the silence is the bug, and whether
// Loom grows multi-command sagas is a feature decision that should not be
// taken under time pressure (tracked as its own mission).  The message names
// the two spellings that DO work today, so the author is not merely refused.
function validateWorkflowHandlers(wf: WorkflowIR, diags: LoomDiagnostic[], ctxName: string): void {
  for (const h of wf.handlers ?? []) {
    diags.push({
      severity: "error",
      code: "loom.workflow-handle-unsupported",
      message: diagMessage("loom.workflow-handle-unsupported", {
        name: wf.name,
        handler: h.name,
      }),
      source: `${ctxName}/${wf.name}`,
    });
  }
}

// G2.  A workflow with `on(…)` reactors and no `create(…)` starter compiles
// clean and is a runtime no-op forever: nothing ever inserts a correlation row,
// so every inbound event misses the load and logs `event_unrouted`.  The
// create-less workflow still emits an empty POST route that logs
// `workflow_started` / `workflow_completed` and inserts nothing, which is why
// the shape looks alive from the outside.
//
// Sibling of `loom.reactor-event-uncarried` (same class of check, different
// cause: there the event reaches no channel, here it reaches no instance).
// Kept independent of the correlation rules deliberately — this fires on the
// STRUCTURE (reactors, no starter) and needs no correlation field to be
// decidable, so it still lands on a workflow that is also missing one.
function validateWorkflowStarter(wf: WorkflowIR, diags: LoomDiagnostic[], ctxName: string): void {
  const reactors = wf.subscriptions ?? [];
  if (reactors.length === 0) return;
  if ((wf.creates ?? []).length > 0) return;
  // An `eventSourced` workflow folds its state from the stream via `apply(…)`
  // rather than from a persisted row — but it still needs a starter to bring an
  // instance into being, so the rule is the same.  (Its appliers are not
  // starters: `apply` folds an event into an instance that must already exist.)
  diags.push({
    severity: "error",
    code: "loom.reactor-without-starter",
    message: diagMessage("loom.reactor-without-starter", {
      name: wf.name,
      reactors: reactors.map((r) => `on(${r.event})`).join(", "),
    }),
    source: `${ctxName}/${wf.name}`,
  });
}

function validateWorkflowCreates(wf: WorkflowIR, diags: LoomDiagnostic[], ctxName: string): void {
  const src = `${ctxName}/${wf.name}`;
  const creates = wf.creates ?? [];

  // rule 21 — at most one canonical (unnamed) create.
  const canonical = creates.filter((c) => c.name === null);
  if (canonical.length > 1) {
    diags.push({
      severity: "error",
      code: "loom.canonical-create-duplicate-workflow",
      message: diagMessage("loom.canonical-create-duplicate-workflow", {
        name: wf.name,
        length: canonical.length,
      }),
      source: src,
    });
  }

  // rule 22 — no two creates share a name.
  const nameCounts = new Map<string, number>();
  for (const c of creates) {
    if (c.name === null) continue;
    nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      diags.push({
        severity: "error",
        code: "loom.create-name-conflict-workflow",
        message: diagMessage("loom.create-name-conflict-workflow", {
          name: wf.name,
          count,
          name2: name,
        }),
        source: src,
      });
    }
  }

  // rule 23 — no two event-triggered creates start on the same event.  The
  // runtime allocates one workflow instance per inbound event, so two starters
  // on the same event leave it unable to choose which to allocate.  (Now
  // checkable: `CreateIR.eventRef` is derived for event-triggered creates.)
  const eventCreateCounts = new Map<string, number>();
  for (const c of creates) {
    if (c.triggerKind === "event" && c.eventRef) {
      eventCreateCounts.set(c.eventRef, (eventCreateCounts.get(c.eventRef) ?? 0) + 1);
    }
  }
  for (const [event, count] of eventCreateCounts) {
    if (count > 1) {
      diags.push({
        severity: "error",
        code: "loom.event-create-overlap-workflow",
        message: diagMessage("loom.event-create-overlap-workflow", { name: wf.name, count, event }),
        source: src,
      });
    }
  }
}

/** The resolved type a `by <expr>` correlation expression yields — a member
 *  access carries `memberType`, a bare ref carries `type`. */
function correlationExprType(e: ExprIR): TypeIR | undefined {
  if (e.kind === "member") return e.memberType;
  if (e.kind === "ref") return e.type;
  return undefined;
}

const idTarget = (t: TypeIR | undefined): string | undefined =>
  t && t.kind === "id" ? t.targetName : undefined;

// Correlation-field rules (workflow-and-applier.md A2-S2 + A2-S3).  A workflow
// with event consumers — `on(e: Event)` reactors *and* event-triggered
// `create(e: Event) by` starters — routes each inbound event to exactly one
// id-shaped state field, the correlation field.
//
//   - rule 10 (`loom.workflow-correlation-required`) — no id-shaped field.
//   - rule 19 (`loom.correlation-field-ambiguous`)   — more than one.
//   - rule 12 (`loom.correlation-type-mismatch`)     — a `by <expr>` yields a
//     value of a different id type than the correlation field.
//   - (`loom.correlation-uninferrable`) — a consumer omits `by` but its event
//     has no field whose name matches the correlation field, so routing can't
//     be inferred by name-match.
//
// Applying these uniformly to reactors AND event-creates also subsumes rule 24
// (create-vs-on correlation agreement): both are checked against the same
// correlation field, so a `create` and an `on` for one event necessarily agree.
function validateWorkflowCorrelation(
  ctx: BoundedContextIR,
  wf: WorkflowIR,
  diags: LoomDiagnostic[],
  allEvents?: EventIR[],
): void {
  // Unified event-consumer list: `on` reactors + event-triggered creates.  Each
  // carries the subscribed event, its optional `by <expr>` routing, and a label
  // for diagnostics.
  const consumers: { event: string; correlation?: ExprIR; label: string }[] = [
    ...(wf.subscriptions ?? []).map((s) => ({
      event: s.event,
      correlation: s.correlation,
      label: `on(${s.event})`,
    })),
    ...(wf.creates ?? [])
      .filter((c) => c.triggerKind === "event" && !!c.eventRef)
      .map((c) => ({
        event: c.eventRef as string,
        correlation: c.correlation,
        label: `create(${c.eventBinding ?? "_"}: ${c.eventRef})`,
      })),
  ];
  if (consumers.length === 0) return;
  const src = `${ctx.name}/${wf.name}`;
  const idFields = (wf.stateFields ?? []).filter((f) => f.type.kind === "id");
  if (idFields.length === 0) {
    diags.push({
      severity: "error",
      message: diagMessage("loom.workflow-correlation-required", { name: wf.name }),
      source: src,
      code: "loom.workflow-correlation-required",
    });
    return;
  }
  if (idFields.length > 1) {
    diags.push({
      severity: "error",
      message: diagMessage("loom.correlation-field-ambiguous", {
        name: wf.name,
        length: idFields.length,
        idFields: idFields.map((f) => f.name).join(", "),
      }),
      source: src,
      code: "loom.correlation-field-ambiguous",
    });
    return;
  }
  // Exactly one correlation field — type-check each consumer's routing.
  const corr = idFields[0];
  const corrTarget = idTarget(corr.type);
  for (const sub of consumers) {
    if (sub.correlation) {
      const byTarget = idTarget(correlationExprType(sub.correlation));
      if (byTarget !== corrTarget) {
        diags.push({
          severity: "error",
          message: diagMessage("loom.correlation-type-mismatch", {
            name: wf.name,
            label: sub.label,
            byTarget: byTarget ? `'${byTarget} id'` : "a non-id value",
            corrName: corr.name,
            corrTarget,
          }),
          source: src,
          code: "loom.correlation-type-mismatch",
        });
      }
    } else {
      // Omitted `by` — route by name-match: the event must carry a field of
      // the correlation field's name.
      // Cross-context reactors (M-T4.4): a foreign event consumed through a
      // wired channel isn't in ctx.events — fall back to the model-wide list.
      const ev =
        ctx.events.find((e) => e.name === sub.event) ??
        allEvents?.find((e) => e.name === sub.event);
      const hasMatch = ev?.fields.some((f) => f.name === corr.name) ?? false;
      if (!hasMatch) {
        diags.push({
          severity: "error",
          message: diagMessage("loom.correlation-uninferrable", {
            name: wf.name,
            label: sub.label,
            event: sub.event,
            corrName: corr.name,
          }),
          source: src,
          code: "loom.correlation-uninferrable",
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Own-state addressability (F58 / M-T6.62 — the case #2850 deferred).
//
// Workflow `Property` members are SAGA STATE: they live in a persisted
// correlation row keyed by the workflow's one id-shaped state field, and every
// backend renders a body that touches them against that LOADED row
// (`thisName: "state"`).  A command create that names no key has no such row,
// so the body falls back to the default `this` receiver — unbound in a Hono
// module-scope arrow (TS2683), on a .NET/Java handler class with no such
// member, in a module-level python `async def`, and inside an Elixir
// `with`-chain.
//
// `commandCreateCorrelationParam` (ir/util/workflow-own-state.ts) is the single
// rule both halves read: the key is the param NAMED for the correlation field,
// else the param a `<corr> := <param>` statement assigns it from.  This check is
// its exact complement — everything that rule cannot address, and that would
// therefore render unbound, is refused here rather than emitted:
//
//   loom.workflow-create-correlation-unsupplied           no such param
//   loom.workflow-create-correlation-unsupplied#payload   the key is a FIELD of
//       a payload-typed param (`create(c: FileClaim)`, reported on #2850).
//       Refused rather than followed one level down, for two reasons: the
//       emitters would render `c.<corr>` against a param that has no wire
//       contract yet (it emits `z.unknown()`, so the key would be
//       `unknown`-typed and node still would not compile — that half is
//       #2886's), and the author has a spelling that works today.
//
// TWO THINGS DELIBERATELY NOT GATED, named so the silence is not read as a
// claim that they are fine:
//
//   * a workflow with `Property` members and NO id-shaped field at all.  That
//     is a SHIPPED shape, not a gap: M-T6.50 (b) made python emit a
//     request-scoped scratch (`self = SimpleNamespace(...)`) for it.  node,
//     .NET and java still emit an unbound `this` there — a cross-backend parity
//     gap on M-T6.62, not something to refuse.
//   * a command create whose body does NOT touch own state: it emits fine, but
//     still creates no row, so an `on` reactor for the same key logs
//     `event_unrouted` forever (the reactor path loads, it does not allocate).
//     A row-allocation question, not a receiver-binding one; refusing it would
//     refuse a legitimately stateless command starter.
function validateWorkflowOwnStateAddressable(
  ctx: BoundedContextIR,
  wf: WorkflowIR,
  diags: LoomDiagnostic[],
): void {
  const stateFields = wf.stateFields ?? [];
  if (stateFields.length === 0) return;
  const src = `${ctx.name}/${wf.name}`;
  const idFields = stateFields.filter((f) => f.type.kind === "id");
  if (idFields.length !== 1) return; // 0: see above.  >1: `correlation-field-ambiguous`.
  if (wf.eventSourced) return; // folded from a stream; no mutable row to key.
  if (!emitsCommandRoute(wf)) return; // event-triggered facade: routed by `by`.
  if (commandCreateCorrelationParam(wf)) return; // addressable — the emitters key on it.

  const corr = idFields[0].name;
  // The primary (facade) create is the one the command route renders.  Only a
  // body that touches own state renders against the instance at all.
  const facade = facadeCreate(wf);
  if (!facade || !workflowBodyUsesOwnState(facade.statements)) return;

  // The reported payload-typed form: a param whose own fields carry a
  // name-match.  Same code, a message that can name the field it found.
  const nested = payloadFieldMatch(ctx, wf, corr);
  diags.push({
    severity: "error",
    message: nested
      ? diagMessage("loom.workflow-create-correlation-unsupplied#payload", {
          name: wf.name,
          corr,
          param: nested.param,
          payload: nested.payload,
        })
      : diagMessage("loom.workflow-create-correlation-unsupplied", {
          name: wf.name,
          corr,
          params: wf.params.length > 0 ? wf.params.map((p) => p.name).join(", ") : "(none)",
        }),
    source: src,
    code: "loom.workflow-create-correlation-unsupplied",
  });
}

/** A create param whose PAYLOAD type declares a field named `corr` — the
 *  `create(c: FileClaim)` shape, where the key is one level down.  Returns the
 *  param and payload names so the diagnostic can point at them. */
function payloadFieldMatch(
  ctx: BoundedContextIR,
  wf: WorkflowIR,
  corr: string,
): { param: string; payload: string } | undefined {
  for (const p of wf.params) {
    const t = p.type;
    if (t.kind !== "entity" && t.kind !== "valueobject") continue;
    const payload = ctx.payloads.find((pl) => pl.name === t.name);
    if (payload?.fields.some((f) => f.name === corr)) {
      return { param: p.name, payload: payload.name };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// CROSS-CONTEXT REPOSITORY READS — `loom.workflow-cross-context-repository`.
//
// A workflow is the ONE construct that legitimately orchestrates several
// aggregates through their repositories — but only the repositories of its OWN
// context.  Nothing said so, and the boundary failed in two DIFFERENT ways for
// the same model shape.
//
// THE MECHANISM.  `lowerWorkflow` (and `ctxAggRepoMaps`, the `handle`/`on`
// twin) index `reposByName` from `ctx.members` ALONE, so `matchRepoCall`
// DECLINES a foreign repository name.  The `let` therefore never becomes a
// `repo-let` `WorkflowStmtIR` at all — it falls through to the generic
// `expr-let` arm, where `lowerExpr` leaves the unresolved receiver as a `ref`
// with `refKind: "unknown"`.  Three consequences, all of them silent:
//
//   1. the `repo-let` case's own `loom.workflow-unknown-repository` branch is
//      UNREACHABLE for this shape — no `repo-let` node ever reaches it;
//   2. no `repo-let` means no repository is instantiated by the workflow
//      emitters, and the call is not awaited; and
//   3. nothing records a binding, so `bindingAgg` never learns the let's
//      aggregate.
//
// Re-verified 2026-09-13 on a two-context system where `context Dispatch`'s
// `workflow scheduleWorkOrder` reads `context Directory`'s `Technicians`.  The
// two observed behaviours, from ONE root cause:
//
//   - the binding is later used as an op-call receiver (`part.decrement(qty)`)
//     → consequence 3 surfaces as `loom.workflow-unknown-binding`, on the
//       WRONG line (the use, not the `let`) and with wording that reads like a
//       typo'd variable name rather than a context-boundary crossing; while
//   - the binding is only READ (`precondition tech.skills.count > 0`)
//     → NOTHING fires.  `ddd parse` reports 0 errors, `ddd generate system`
//       writes the tree, and node's `api/http/workflows.ts` contains
//
//         const workOrders = new WorkOrderRepository(tx, events);
//         const tech = Technicians.getById(assignTo);        // no repo, no await
//         const wo = await workOrders.getById(workOrderId);  // the local sibling
//
//       — `Technicians` is never constructed or imported (`tsc`: "Cannot find
//       name 'Technicians'"), and `.count` renders verbatim because the
//       receiver has no type.  Every backend that runs domain logic renders
//       the same dangling receiver.
//
// So this is one MODEL-level shape no backend supports, not five per-backend
// gaps — the identical call `domain-service-checks.ts` makes for
// `loom.domain-service-cross-context-read` (whose header note this one mirrors):
// reject at the source rather than let five emitters fail five different silent
// ways.  BOTH gates key on the same `foreignRepositoryOwners` map (`shared.ts`).
//
// NOT A DEPLOYMENT QUESTION.  Both repros put both contexts on ONE deployable,
// sharing one database and one transaction, and the read is still broken — the
// name does not resolve at lowering, long before any deployable is considered.
// Supporting it would mean teaching the lowerer, every backend's repository
// wiring, and the per-context directory layouts to cross the boundary, for a
// read that DDD says should cross at the context's public surface anyway.  So
// the gate is context-boundary-shaped, not deployment-shaped.
//
// SCOPE.  A bare `ref` that (a) did not resolve (`refKind: "unknown"`, so a
// param or local shadowing the name is never flagged) and (b) names a
// repository declared in some OTHER context of the model.  Covers EVERY
// workflow body — the primary create, named `create`s, `handle`s and `on`
// reactors — not just the one `validateWorkflowBody` sees.  Defence-in-depth:
// a `repo-let` / `repo-run` / `repo-delete` node that somehow DID carry a
// foreign `repoName` is caught too, so if lowering ever learns to resolve the
// name the gate still stands until a backend can actually emit it.
// ---------------------------------------------------------------------------

/** Every workflow body, with the label naming the member it came from.  The
 *  `statements`/`params` facade on `WorkflowIR` aliases the PRIMARY create, so
 *  iterating `creates` alone covers it without double-reporting.
 *
 *  Named distinctly from {@link workflowBodiesLabeled} above (the
 *  `loom.workflow-inline-repository-call` gate's own label formatting) and
 *  {@link workflowBodies} below (main's unlabeled, statements-only twin used
 *  by {@link validateWorkflowBody}'s per-body loop) — three callers, three
 *  slightly different shapes, not worth unifying at the cost of either
 *  gate's exact wording. */
function workflowBodiesLabeledCrossContext(
  wf: WorkflowIR,
): { label: string; statements: WorkflowStmtIR[] }[] {
  const creates = wf.creates ?? [];
  return [
    ...(creates.length > 0
      ? creates.map((cr) => ({
          label: cr.name ? `create '${cr.name}'` : "create",
          statements: cr.statements,
        }))
      : // Legacy/partial IR with no `creates` — fall back to the facade so the
        // primary body is still scanned.
        [{ label: "create", statements: wf.statements }]),
    ...(wf.handlers ?? []).map((h) => ({ label: `handle '${h.name}'`, statements: h.statements })),
    ...(wf.subscriptions ?? []).map((s) => ({
      label: `on(${s.event})`,
      statements: s.statements,
    })),
  ];
}

/** `loom.workflow-cross-context-repository` — see the header note above.
 *
 *  Returns the names of the let-bindings poisoned by such a read, so
 *  {@link validateWorkflowBody} can suppress the downstream
 *  `loom.workflow-unknown-binding` cascade: the two variants of this ONE bug
 *  must produce the SAME diagnostic, not a boundary error in one shape and a
 *  misleading binding error in the other. */
function validateWorkflowCrossContextRepositories(
  ctx: BoundedContextIR,
  wf: WorkflowIR,
  foreignRepos: ReadonlyMap<string, string>,
  diags: LoomDiagnostic[],
): ReadonlySet<string> {
  const poisoned = new Set<string>();
  if (foreignRepos.size === 0) return poisoned;
  // One diagnostic per repository per workflow, not per mention — a body
  // reading the same foreign repository twice states one boundary problem.
  const flagged = new Set<string>();
  for (const { label, statements } of workflowBodiesLabeledCrossContext(wf)) {
    for (const st of statements) {
      // (a) the unresolved-receiver residue — the shape that actually occurs.
      walkWorkflowStmtsDeep(st, (inner) => {
        const names = new Set<string>();
        walkWorkflowStmtExprsDeep(inner, (e) => {
          if (e.kind === "ref" && e.refKind === "unknown" && foreignRepos.has(e.name)) {
            names.add(e.name);
          }
        });
        if (names.size === 0) return;
        // The `let` that bound the broken read — its name is now poisoned, so
        // every later use of it is a symptom, not a separate defect.
        if (inner.kind === "expr-let") poisoned.add(inner.name);
        for (const n of names) report(n, label);
      });
      // (b) defence-in-depth — a resolved repo statement naming a foreign repo.
      walkWorkflowStmtsDeep(st, (inner) => {
        const repoName =
          inner.kind === "repo-let" || inner.kind === "repo-run" || inner.kind === "repo-delete"
            ? inner.repoName
            : undefined;
        if (repoName !== undefined && foreignRepos.has(repoName)) report(repoName, label);
      });
    }
  }
  return poisoned;

  function report(repoName: string, label: string): void {
    if (flagged.has(repoName)) return;
    flagged.add(repoName);
    diags.push({
      severity: "error",
      code: "loom.workflow-cross-context-repository",
      message: diagMessage("loom.workflow-cross-context-repository", {
        where: `workflow '${wf.name}' ${label}`,
        repoName,
        ownContext: ctx.name,
        otherContext: foreignRepos.get(repoName) as string,
      }),
      source: `${ctx.name}/${wf.name}`,
    });
  }
}

/** Every executable body a workflow declares, in declaration order.
 *
 *  `wf.statements` is only a FACADE over the primary (unnamed,
 *  command-triggered) create — so validating it alone left every `on(e: Event)`
 *  reactor, every non-primary / event-triggered `create`, and every named
 *  `handle` body completely unchecked.  That blind spot is what let
 *  `for f in Follows.run(FollowersOf(e.author))` — a shape
 *  `loom.workflow-foreach-source` rejects in a `create` body — reach codegen
 *  from a reactor body: the elixir reactor emitter then THREW
 *  (`unsupported reactor statement kind 'for-each'`, aborting the whole
 *  `generate system` run), and java / hono / python / .NET each emitted a
 *  `Repo.run(<the criterion predicate inlined as a boolean>)` call that exists
 *  on no repository.  Every body now walks the same checks. */
function workflowBodies(wf: {
  statements: import("../../types/loom-ir.js").WorkflowStmtIR[];
  creates?: { statements: import("../../types/loom-ir.js").WorkflowStmtIR[] }[];
  subscriptions?: { statements: import("../../types/loom-ir.js").WorkflowStmtIR[] }[];
  handlers?: { statements: import("../../types/loom-ir.js").WorkflowStmtIR[] }[];
}): import("../../types/loom-ir.js").WorkflowStmtIR[][] {
  // `creates` is the source of truth and CONTAINS the primary, so `statements`
  // is only the fallback for a shape that lowered no creates at all.
  const creates = wf.creates ?? [];
  return [
    ...(creates.length > 0 ? creates.map((c) => c.statements) : [wf.statements]),
    ...(wf.subscriptions ?? []).map((s) => s.statements),
    ...(wf.handlers ?? []).map((h) => h.statements),
  ];
}

function validateWorkflowBody(
  ctx: BoundedContextIR,
  wf: {
    name: string;
    statements: import("../../types/loom-ir.js").WorkflowStmtIR[];
    creates?: { statements: import("../../types/loom-ir.js").WorkflowStmtIR[] }[];
    subscriptions?: { statements: import("../../types/loom-ir.js").WorkflowStmtIR[] }[];
    handlers?: { statements: import("../../types/loom-ir.js").WorkflowStmtIR[] }[];
    transactional: boolean;
    eventSourced?: boolean;
    isolation?: import("../../types/loom-ir.js").IsolationLevel;
    params: import("../../types/loom-ir.js").ParamIR[];
  },
  diags: LoomDiagnostic[],
  /** Let-bindings already reported by the cross-context gate — see its note. */
  crossContextBindings: ReadonlySet<string> = new Set(),
): void {
  const aggsByName = new Map(ctx.aggregates.map((a) => [a.name, a] as const));
  const reposByName = new Map(ctx.repositories.map((r) => [r.name, r] as const));
  const eventsByName = new Map(ctx.events.map((e) => [e.name, e] as const));
  // `mutated` accumulates across EVERY body — a `transactional` workflow whose
  // only effect lives in a reactor body still has an effect.
  let mutated = false;
  for (const body of workflowBodies(wf)) {
    // Bindings are body-scoped: a `let` in one create is not in scope in
    // another create's body, nor in a reactor's.
    const bindingAgg = new Map<string, string>(); // bindingName -> aggName
    const arrayBindingAgg = new Map<string, string>(); // repo-run binding -> element aggName
    validateWorkflowStatements(
      ctx,
      wf,
      body,
      diags,
      aggsByName,
      reposByName,
      eventsByName,
      bindingAgg,
      arrayBindingAgg,
      () => {
        mutated = true;
      },
      crossContextBindings,
    );
  }

  if (wf.transactional && !mutated) {
    diags.push({
      severity: "warning",
      code: "loom.transactional-no-effect",
      message: diagMessage("loom.transactional-no-effect", { name: wf.name }),
      source: `${ctx.name}/${wf.name}`,
    });
  }

  // Defence-in-depth: the grammar already gates the isolation level
  // behind the `transactional` keyword, but if a future grammar
  // change drops the gating we'd silently accept a meaningless
  // setting.  Surface it as an error here too.
  if (wf.isolation && !wf.transactional) {
    diags.push({
      severity: "error",
      code: "loom.isolation-requires-transactional",
      message: diagMessage("loom.isolation-requires-transactional", {
        name: wf.name,
        isolation: wf.isolation,
      }),
      source: `${ctx.name}/${wf.name}`,
    });
  }
}

/** The per-body statement walk.  Extracted verbatim from `validateWorkflowBody`
 *  so it can run once per declared body (create / reactor / handler) instead of
 *  once per workflow over the primary-create facade. */
function validateWorkflowStatements(
  ctx: BoundedContextIR,
  wf: {
    name: string;
    transactional: boolean;
    eventSourced?: boolean;
    isolation?: import("../../types/loom-ir.js").IsolationLevel;
    params: import("../../types/loom-ir.js").ParamIR[];
  },
  statements: import("../../types/loom-ir.js").WorkflowStmtIR[],
  diags: LoomDiagnostic[],
  aggsByName: Map<string, AggregateIR>,
  reposByName: Map<string, RepositoryIR>,
  eventsByName: Map<string, EventIR>,
  bindingAgg: Map<string, string>,
  arrayBindingAgg: Map<string, string>,
  markMutated: () => void,
  /** Let-bindings already reported by the cross-context gate — see its note
   *  on {@link validateWorkflowBody}. */
  crossContextBindings: ReadonlySet<string> = new Set(),
): void {
  /** The shallow op-call check for a NESTED body — a `for-each` body or an
   *  `if-let` branch.
   *
   *  A `let` declared INSIDE the nested body binds for the rest of it, so it is
   *  registered BEFORE the op-calls are checked and unregistered after.  That
   *  is what makes
   *
   *      for u in us { let p = Parts.getById(u.part)  p.consume(u.quantity) }
   *      if let o = Orders.find(C) { let cu = Customers.getById(x)  cu.touch() }
   *
   *  legal: every backend already walks into these bodies and injects the
   *  repository for exactly this shape (verified on all five — the node/python
   *  `const p = await parts.getById(...)`, the .NET `_parts.GetByIdAsync`, the
   *  Java `partsRepository.getById`, the Phoenix `Context.get_part` — each
   *  followed by the per-iteration save).  Without it the validator refuses a
   *  form every emitter supports, and blames the USE ("references unknown
   *  binding 'p'") for a binding that is bound on the line above.
   *
   *  The `if-let` arm had this; the `for-each` arm did not, which is the whole
   *  of F-004 — so the two now share ONE implementation rather than a copy that
   *  can drift apart again. */
  const checkNestedBodyOpCalls = (
    body: import("../../types/loom-ir.js").WorkflowStmtIR[],
    loopVar: string,
    messageKey:
      | "loom.workflow-foreach-unknown-binding#workflow-in-for-references"
      | "loom.workflow-foreach-unknown-binding#workflow-in-if-let-references",
  ): void => {
    const bodyLocal: string[] = [];
    for (const inner of body) {
      if (inner.kind === "op-call") {
        markMutated();
        // A binding poisoned by a cross-context repository read is already
        // reported at its `let` — see the top-level op-call arm.
        if (!bindingAgg.get(inner.target) && !crossContextBindings.has(inner.target)) {
          diags.push({
            severity: "error",
            code: "loom.workflow-foreach-unknown-binding",
            message: diagMessage(messageKey, {
              name: wf.name,
              var: loopVar,
              target: inner.target,
              op: inner.op,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
        }
      } else if (inner.kind === "emit" || inner.kind === "factory-let") {
        markMutated();
      }
      if ((inner.kind === "repo-let" || inner.kind === "factory-let") && !bindingAgg.has(inner.name)) {
        bindingAgg.set(inner.name, inner.aggName);
        bodyLocal.push(inner.name);
      }
    }
    for (const n of bodyLocal) bindingAgg.delete(n);
  };
  for (const st of statements) {
    switch (st.kind) {
      case "precondition":
      case "requires":
        // Type-check happens at lowering via `inferExprType`; we'd
        // need the AST node to re-check here.  Trust the lowered IR
        // and emit a warning if the expression looks degenerate
        // (kind === "ref" with refKind "unknown").
        if (st.expr.kind === "ref" && st.expr.refKind === "unknown") {
          diags.push({
            severity: "error",
            code: "loom.workflow-unknown-name",
            message: diagMessage("loom.workflow-unknown-name", {
              name: wf.name,
              kind: st.kind,
              exprName: st.expr.name,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
        }
        break;
      case "emit": {
        const ev = eventsByName.get(st.eventName);
        if (!ev) {
          diags.push({
            severity: "error",
            code: "loom.workflow-emit-unknown-event",
            message: diagMessage("loom.workflow-emit-unknown-event", {
              name: wf.name,
              eventName: st.eventName,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        const declared = new Set(ev.fields.map((f) => f.name));
        const provided = new Set(st.fields.map((f) => f.name));
        for (const f of declared) {
          if (!provided.has(f)) {
            diags.push({
              severity: "error",
              code: "loom.workflow-emit-missing-field",
              message: diagMessage("loom.workflow-emit-missing-field", {
                name: wf.name,
                evName: ev.name,
                f,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
          }
        }
        for (const f of provided) {
          if (!declared.has(f)) {
            diags.push({
              severity: "error",
              code: "loom.workflow-emit-unknown-field",
              message: diagMessage("loom.workflow-emit-unknown-field", {
                name: wf.name,
                evName: ev.name,
                f,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
          }
        }
        markMutated();
        break;
      }
      case "factory-let": {
        const agg = aggsByName.get(st.aggName);
        if (!agg) {
          diags.push({
            severity: "error",
            code: "loom.workflow-create-unknown-aggregate",
            message: diagMessage("loom.workflow-create-unknown-aggregate", {
              name: wf.name,
              aggName: st.aggName,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        // A workflow `Agg.create({...})` invokes the canonical create,
        // which is parameterized by the aggregate's *create-input* fields
        // — `forCreateInput` drops the server-populated roles
        // (`managed`/`token`/`internal`) and the required subset further
        // drops fields the client may omit (optional, `= default`, bare
        // `bool`).  Validate against that contract, the same set the
        // backends' create-call emitters consume, rather than the raw
        // field list: a `managed` timestamp is neither required here nor a
        // legal argument (passing one would fail the backend create-call).
        const omittable = omittableCreateInputs(agg);
        const inputFields = createInputFields(agg).map((f) => f.name);
        const required = inputFields.filter((n) => !omittable.has(n));
        const provided = new Set(st.fields.map((f) => f.name));
        for (const r of required) {
          if (!provided.has(r)) {
            diags.push({
              severity: "error",
              code: "loom.workflow-create-missing-field",
              message: diagMessage("loom.workflow-create-missing-field", {
                name: wf.name,
                aggName: st.aggName,
                r,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
          }
        }
        const allowed = new Set(inputFields);
        for (const p of provided) {
          if (!allowed.has(p)) {
            diags.push({
              severity: "error",
              code: "loom.workflow-create-unknown-field",
              message: diagMessage("loom.workflow-create-unknown-field", {
                name: wf.name,
                aggName: st.aggName,
                p,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
          }
        }
        bindingAgg.set(st.name, st.aggName);
        markMutated();
        break;
      }
      case "repo-let": {
        const repo = reposByName.get(st.repoName);
        if (!repo) {
          diags.push({
            severity: "error",
            code: "loom.workflow-unknown-repository",
            message: diagMessage("loom.workflow-unknown-repository", {
              name: wf.name,
              repoName: st.repoName,
              method: st.method,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        if (st.method !== "getById" && !repo.finds.some((f) => f.name === st.method)) {
          diags.push({
            severity: "error",
            code: "loom.workflow-unknown-repository-method",
            message: diagMessage("loom.workflow-unknown-repository-method", {
              name: wf.name,
              repoName: st.repoName,
              method: st.method,
              finds: repo.finds.map((f) => f.name).join(", ") || "(no declared finds)",
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        // A workflow can't call a find whose where clause references
        // currentUser — the workflow handler doesn't inject
        // ICurrentUserAccessor, and threading the user through saves +
        // ops would be a larger reshape.  Surface a friendly error
        // pointing at the alternative (load by id).
        const calledFind = repo.finds.find((f) => f.name === st.method);
        if (calledFind && findUsesCurrentUser(calledFind)) {
          diags.push({
            severity: "error",
            code: "loom.workflow-currentuser-find",
            message: diagMessage("loom.workflow-currentuser-find", {
              name: wf.name,
              repoName: st.repoName,
              method: st.method,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        // Reject array / nullable returns — workflow body has no
        // iteration / null-handling vocab in v1.  getById is always
        // a single non-nullable aggregate (the impl throws on miss).
        if (st.method !== "getById") {
          if (st.returnType.kind === "array") {
            diags.push({
              severity: "error",
              code: "loom.workflow-load-array-unsupported",
              message: diagMessage("loom.workflow-load-array-unsupported", {
                name: wf.name,
                repoName: st.repoName,
                method: st.method,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
            break;
          }
          if (st.returnType.kind === "optional") {
            diags.push({
              severity: "error",
              code: "loom.workflow-load-nullable-unsupported",
              message: diagMessage("loom.workflow-load-nullable-unsupported", {
                name: wf.name,
                repoName: st.repoName,
                method: st.method,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
            break;
          }
        }
        bindingAgg.set(st.name, st.aggName);
        break;
      }
      case "repo-run": {
        // `let xs = Repo.findAll(<Criterion>, page?)` (criterion.md, use
        // site 3) lowered to a `synthCriterion`-marked repo-run.  Validate the
        // criterion directly (clear errors before the enrich-synthesised
        // `findAllBy<Criterion>` retrieval would otherwise mislead the generic
        // run checks below), then record the array binding and stop.
        if (st.synthCriterion) {
          const repo = reposByName.get(st.repoName);
          if (!repo) {
            diags.push({
              severity: "error",
              code: "loom.workflow-run-unknown-repository",
              message: diagMessage(
                "loom.workflow-run-unknown-repository#workflow-a-criterion-query",
                { name: wf.name, repoName: st.repoName },
              ),
              source: `${ctx.name}/${wf.name}`,
            });
            break;
          }
          const critName = st.synthCriterion.name;
          const crit = ctx.criteria.find((c) => c.name === critName);
          if (!crit) {
            diags.push({
              severity: "error",
              code: "loom.findall-unknown-criterion",
              message: diagMessage("loom.findall-unknown-criterion", {
                name: wf.name,
                repoName: st.repoName,
                critName,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
            break;
          }
          const candidate = crit.targetType.kind === "entity" ? crit.targetType.name : "";
          if (candidate !== st.aggName) {
            diags.push({
              severity: "error",
              code: "loom.findall-criterion-mismatch",
              message: diagMessage("loom.findall-criterion-mismatch", {
                name: wf.name,
                critName,
                candidate: candidate || "bool",
                repoName: st.repoName,
                aggName: st.aggName,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
            break;
          }
          if (st.retrievalArgs.length !== crit.params.length) {
            diags.push({
              severity: "error",
              code: "loom.findall-criterion-arity",
              message: diagMessage("loom.findall-criterion-arity", {
                name: wf.name,
                critName,
                length: crit.params.length,
                repoName: st.repoName,
                retrievalArgsLength: st.retrievalArgs.length,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
            break;
          }
          if (!st.page) {
            diags.push({
              severity: "warning",
              code: "loom.findall-no-page",
              message: diagMessage("loom.findall-no-page", {
                name: wf.name,
                critName,
                repoName: st.repoName,
              }),
              source: `${ctx.name}/${wf.name}`,
            });
          }
          arrayBindingAgg.set(st.name, st.aggName);
          break;
        }
        // `let xs = Repo.run(<Retrieval>(args), page?)` — the bound
        // result is an aggregate array, consumable only by a `for-each`.
        const repo = reposByName.get(st.repoName);
        if (!repo) {
          diags.push({
            severity: "error",
            code: "loom.workflow-run-unknown-repository",
            message: diagMessage("loom.workflow-run-unknown-repository#workflow-run-references", {
              name: wf.name,
              repoName: st.repoName,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        const retrieval = ctx.retrievals.find((r) => r.name === st.retrievalName);
        if (!retrieval) {
          diags.push({
            severity: "error",
            code: "loom.workflow-run-unknown-retrieval",
            message: diagMessage("loom.workflow-run-unknown-retrieval", {
              name: wf.name,
              repoName: st.repoName,
              retrievalName: st.retrievalName,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        const target = retrieval.targetType.kind === "entity" ? retrieval.targetType.name : "";
        if (target !== st.aggName) {
          diags.push({
            severity: "error",
            code: "loom.workflow-run-retrieval-mismatch",
            message: diagMessage("loom.workflow-run-retrieval-mismatch", {
              name: wf.name,
              retrievalName: st.retrievalName,
              target,
              repoName: st.repoName,
              aggName: st.aggName,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
        }
        // Record the array binding so a `for-each` over it resolves the
        // element aggregate.
        arrayBindingAgg.set(st.name, st.aggName);
        break;
      }
      case "for-each": {
        // The iterable must be an aggregate array (today: a `repo-run`
        // result).  Bind the loop var to the element aggregate so body
        // op-calls resolve, then validate the body op-calls.
        // The iterable should be a `repo-run` array binding (the only
        // aggregate-array producer in v1).  A bare `ref` to such a
        // binding is the supported shape.
        const iterableBinding = st.iterable.kind === "ref" ? st.iterable.name : undefined;
        const isArrayBinding = iterableBinding ? arrayBindingAgg.has(iterableBinding) : false;
        if (st.varAggName === "Unknown" || !isArrayBinding) {
          diags.push({
            severity: "error",
            code: "loom.workflow-foreach-source",
            message: diagMessage("loom.workflow-foreach-source", { name: wf.name, var: st.var }),
            source: `${ctx.name}/${wf.name}`,
          });
        }
        bindingAgg.set(st.var, st.varAggName);
        checkNestedBodyOpCalls(
          st.body,
          st.var,
          "loom.workflow-foreach-unknown-binding#workflow-in-for-references",
        );
        break;
      }
      case "if-let": {
        // `if let <var> = Repo.find(<Criterion>) { … } else { … }`
        // (criterion.md, use site 3).  Validate the criterion query (the same
        // checks as the repo-run/findAll path; no page warning — a single
        // result is never paginated), then shallow-check the branch op-call
        // bindings the way `for-each` does.  `var` is in scope only in the
        // then-branch.
        if (!st.synthCriterion.name) {
          diags.push({
            severity: "error",
            code: "loom.iflet-bad-source",
            message: diagMessage("loom.iflet-bad-source", { name: wf.name, var: st.var }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        const repo = reposByName.get(st.repoName);
        if (!repo) {
          diags.push({
            severity: "error",
            code: "loom.workflow-run-unknown-repository",
            message: diagMessage(
              "loom.workflow-run-unknown-repository#workflow-a-criterion-query",
              { name: wf.name, repoName: st.repoName },
            ),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        const critName = st.synthCriterion.name;
        const crit = ctx.criteria.find((c) => c.name === critName);
        if (!crit) {
          diags.push({
            severity: "error",
            code: "loom.findall-unknown-criterion",
            message: diagMessage("loom.findall-unknown-criterion", {
              name: wf.name,
              repoName: st.repoName,
              critName,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        const candidate = crit.targetType.kind === "entity" ? crit.targetType.name : "";
        if (candidate !== st.aggName) {
          diags.push({
            severity: "error",
            code: "loom.findall-criterion-mismatch",
            message: diagMessage("loom.findall-criterion-mismatch", {
              name: wf.name,
              critName,
              candidate: candidate || "bool",
              repoName: st.repoName,
              aggName: st.aggName,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        if (st.retrievalArgs.length !== crit.params.length) {
          diags.push({
            severity: "error",
            code: "loom.findall-criterion-arity",
            message: diagMessage("loom.findall-criterion-arity", {
              name: wf.name,
              critName,
              length: crit.params.length,
              repoName: st.repoName,
              retrievalArgsLength: st.retrievalArgs.length,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        const checkBranchOpCalls = (body: WorkflowStmtIR[]): void => {
          checkNestedBodyOpCalls(
            body,
            st.var,
            "loom.workflow-foreach-unknown-binding#workflow-in-if-let-references",
          );
        };
        bindingAgg.set(st.var, st.aggName); // `var` bound only in the then-branch
        checkBranchOpCalls(st.thenBody);
        bindingAgg.delete(st.var);
        checkBranchOpCalls(st.elseBody ?? []);
        break;
      }
      case "op-call": {
        const aggName = bindingAgg.get(st.target);
        if (!aggName) {
          if (crossContextBindings.has(st.target)) {
            // The binding is missing BECAUSE its `let` read a repository of
            // another context, which `loom.workflow-cross-context-repository`
            // has already reported at the `let` itself.  Reporting
            // `workflow-unknown-binding` here too would describe the same one
            // defect twice — and describe it wrongly, pointing at the USE and
            // sounding like a typo'd variable name.  The mutation the author
            // wrote is real, so it also counts as an effect: without this the
            // rejected model additionally collects a `transactional-no-effect`
            // warning that vanishes the moment the boundary is fixed.
            markMutated();
            break;
          }
          diags.push({
            severity: "error",
            code: "loom.workflow-unknown-binding",
            message: diagMessage("loom.workflow-unknown-binding", {
              name: wf.name,
              target: st.target,
              op: st.op,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        const agg = aggsByName.get(aggName);
        if (!agg) break;
        const op = agg.operations.find((o) => o.name === st.op);
        if (!op) {
          diags.push({
            severity: "error",
            code: "loom.workflow-unknown-operation",
            message: diagMessage("loom.workflow-unknown-operation", {
              name: wf.name,
              aggName,
              op: st.op,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        if (op.visibility === "private") {
          diags.push({
            severity: "error",
            code: "loom.workflow-private-operation",
            message: diagMessage("loom.workflow-private-operation", {
              name: wf.name,
              aggName,
              opName: op.name,
            }),
            source: `${ctx.name}/${wf.name}`,
          });
          break;
        }
        // (No restriction on extern ops — workflows can call
        // parameterless and parameterized externs alike.  The
        // emission paths construct the wire-typed request from the
        // workflow's domain args via `domainToRequestExpr` (.NET) /
        // a per-VO object-literal projection (TS).)
        markMutated();
        break;
      }
      case "repo-delete":
        // `<Repo>.delete(o)` — a repository DELETE is a persistence mutation, so
        // it satisfies a `transactional` workflow's effect requirement.
        markMutated();
        break;
      case "assign":
        // `field := value` / `field += value` / `field -= value` — own-state
        // mutation onto the workflow's own `Property` state.  Recognised forms:
        // the plain `:=` and the SCALAR compound `+=`/`-=` both lower here (the
        // compound RHS is rewritten to a `binary` over the current value).
        // Cross-aggregate writes and COLLECTION compound mutations never reach
        // here — they stay `__bad__`.  The write is an effect, so a
        // `transactional` workflow with only a (compound) assign is valid.
        if (wf.eventSourced) {
          // An event-sourced workflow's state is derived only by folding its
          // own emitted events (the appliers) — a direct write (`:=`/`+=`/`-=`)
          // would bypass the event log.  Mutate state by `emit` + an `apply`
          // clause instead.
          diags.push({
            severity: "error",
            code: "loom.workflow-eventsourced-assign",
            message: diagMessage("loom.workflow-eventsourced-assign", {
              name: wf.name,
              segments: st.target.segments.join("."),
            }),
            source: `${ctx.name}/${wf.name}`,
          });
        }
        markMutated();
        break;
      case "expr-let": {
        if (st.name === "__bad__") {
          diags.push({
            severity: "error",
            code: "loom.workflow-unrecognised-statement",
            message: diagMessage("loom.workflow-unrecognised-statement", { name: wf.name }),
            source: `${ctx.name}/${wf.name}`,
          });
        }
        // `let x = files.get(k)` — the bound form of a resource-op.
        checkResourceOpExpr(st.expr, ctx, wf, diags);
        break;
      }
      case "resource-call":
        checkResourceOpExpr(st.call, ctx, wf, diags);
        break;
      case "domain-service-call":
        // Wave 2 packet 2.3 (M-T6.50 class): this switch had no arm for
        // `domain-service-call` at all, so it was silently skipped by every
        // check below — including `mutated` (correctly: a `domainService` is
        // always non-mutating, so a call alone never satisfies a
        // `transactional` workflow's effect requirement). Unlike `op-call` /
        // `repo-let`, the `Svc.op(...)` reference itself is resolved through
        // Langium's cross-reference linker at phase ③ (scope/link) — an
        // unknown service or operation never reaches a lowered
        // `domain-service-call` in the first place, so there is no
        // service/op-existence check to add here; this arm exists so the
        // switch is provably exhaustive instead of accidentally total.
        break;
      default: {
        const _exhaustive: never = st;
        void _exhaustive;
      }
    }
  }
}

// Validate a resource-op call expression in a workflow body:
//   - the verb must belong to the resource's kind vocabulary
//     (lowering leaves `capability === ""` on an unknown verb);
//   - a resource-op may not run inside a transactional span — an S3
//     `put` can't roll back with the DB transaction (use the outbox).
// The capability-gap check (need ⊆ sourceType) is handled by
// `validateNeedCapabilities`, which consumes the usage-derived needs.
function checkResourceOpExpr(
  expr: import("../../types/loom-ir.js").ExprIR,
  ctx: BoundedContextIR,
  wf: { name: string; transactional: boolean },
  diags: LoomDiagnostic[],
): void {
  if (expr.kind !== "call" || expr.callKind !== "resource-op" || !expr.resourceOp) return;
  const op = expr.resourceOp;
  if (op.capability === "") {
    diags.push({
      severity: "error",
      code: "loom.resource-verb-invalid",
      message: diagMessage("loom.resource-verb-invalid", {
        name: wf.name,
        resourceName: op.resourceName,
        verb: op.verb,
        resourceKind: op.resourceKind,
        resourceKind2: verbsForKind(op.resourceKind).join(", ") || "(none)",
      }),
      source: `${ctx.name}/${wf.name}`,
    });
  }
  if (wf.transactional) {
    diags.push({
      severity: "error",
      code: "loom.resource-op-in-transaction",
      message: diagMessage("loom.resource-op-in-transaction", {
        name: wf.name,
        resourceName: op.resourceName,
        verb: op.verb,
      }),
      source: `${ctx.name}/${wf.name}`,
    });
  }
}
