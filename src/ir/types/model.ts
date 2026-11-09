import type { AggregateIR } from "./aggregate.js";
import type { BoundedContextIR, EnumIR, PayloadIR, ValueObjectIR } from "./context.js";
import type { LoomInterface, NeedIR, SubdomainIR } from "./deployment.js";
import type { ExprIR } from "./expr.js";
import type { AssociationIR, CreateInputFieldIR, EntityPartIR } from "./members.js";
import type { SystemIR } from "./system.js";
import type { RequirementIR, SolutionIR, TestCaseIR, TraceabilityIR } from "./traceability.js";
import type { Sourced } from "./types.js";
import type { ComponentIR } from "./ui.js";

export interface LoomModel {
  /**
   * Explicit `system` declarations.  Each one is a complete deployment
   * plan with modules + deployables.
   */
  systems: SystemIR[];
  /**
   * Bounded contexts declared at the top level of the source file
   * (legacy single-deployable mode).  Empty when the source uses the
   * `system` vocabulary.  When non-empty, the CLI treats these as an
   * implicit anonymous system with one deployable of the platform
   * picked by the user.
   */
  contexts: BoundedContextIR[];
  /** Root-level value objects, declared at the top of any `.ddd` file
   *  outside any context.  Form the implicit shared kernel: visible
   *  as a type from every context in the workspace.  Backends emit
   *  them once into a shared module/namespace each deployable can
   *  reach.  See `docs/multi-file-source.md`. */
  rootValueObjects: ValueObjectIR[];
  /** Root-level enums.  Same visibility / emission rules as
   *  `rootValueObjects`. */
  rootEnums: EnumIR[];
  /** Root-level payloads — `payload`/`command`/`query`/`response`/`error`
   *  declared at the top of any `.ddd` file outside any context (the ambient
   *  shared kernel for transport types, exception-less.md A1).  Folded into
   *  every context's `payloads` during enrichment (mirroring `rootValueObjects`)
   *  so a `find`/operation `or`-union can name `NotFound` without a per-context
   *  re-declaration.  A context-local payload of the same name shadows. */
  rootPayloads: PayloadIR[];
  /** Root-level components — declared at the top of any `.ddd` file
   *  outside any `ui { … }`.  Pure render functions visible to every
   *  page in every ui workspace-wide; the import-graph walk merges
   *  them into the same global symbol space as `rootValueObjects` /
   *  `rootEnums`.  A `ui`-scope component with the same name wins on
   *  resolution (override semantics).  Backends emit one
   *  `src/components/<Name>.tsx` per ui that references the
   *  component. */
  components: ComponentIR[];
  /** Traceability artifacts — model-wide, since a Solution
   *  or TestCase may reference code across modules and systems. */
  requirements: RequirementIR[];
  solutions: SolutionIR[];
  testCases: TestCaseIR[];
  /** Derived traceability index, populated by `enrichLoomModel`.  Left
   *  undefined by lowering so an unenriched model is a type error to
   *  consume from a report generator. */
  traceability?: TraceabilityIR;
  /** Schema-evolution rename intents (M-T2.1) — lowered from top-level
   *  `migration "<name>" { Agg.old -> new }` blocks.  Consumed only by
   *  the phase-⑨ migration builder (`src/system/migrations-builder.ts`) to
   *  disambiguate the snapshot→model diff into explicit `renameColumn` steps;
   *  no backend reads them for domain-code emission.  Ledger-style: a block
   *  stays in source permanently and is naturally inert once its rename is
   *  baked into the baseline snapshot.  Empty when the source declares no
   *  migration block. */
  renameIntents: RenameIntentIR[];
  /** Table step intents — lowered from `OldName -> NewName` (rename) and
   *  `A.Name -> B.Name` (cross-context move) steps in a `migration` block.
   *  Sibling of `renameIntents` (column renames); consumed only by the
   *  migration builder, which turns each into `renameTable` steps (moving the
   *  schema on the qualified form) for the target's tables plus the
   *  owned-child cascade.  Empty when no table step is declared. */
  tableRenameIntents: TableRenameIntentIR[];
  /** Backfill intents (M-T2.3) — lowered from `Agg.field = <expr>` steps in
   *  a `migration` block.  Consumed only by the migration builder: a NOT-NULL
   *  `addColumn` (or NULL→NOT-NULL flip) with a matching backfill rewrites to
   *  the safe add-nullable → UPDATE → SET NOT NULL sequence WITHOUT the
   *  destructive gate.  Naturally ledger-inert: fires only when the diff
   *  contains the matching structural step.  Empty when none are declared. */
  backfillIntents: BackfillIntentIR[];
  /** Raw `sql "…"` migration steps (M-T2.3), in declaration order.  Consumed
   *  only by the migration builder, which emits each exactly once (recording
   *  `"<migration>#<index>"` in the snapshot's `appliedDataMigrations`
   *  ledger) after the generation's structural steps.  Empty when none are
   *  declared. */
  sqlMigrationSteps: SqlStepIR[];
}

/** One `rename Agg.old -> new` step lowered from a `migration` block.  Field
 *  names are the RAW source names (the migration builder snake-cases them to
 *  column names, exactly as it does for aggregate fields).  `context` scopes
 *  the aggregate to a bounded context so the builder can resolve the owning
 *  module + Postgres schema, disambiguating same-named aggregates. */
export interface RenameIntentIR extends Sourced {
  /** Block label — the `"<name>"` on the owning `migration` block.  Carried
   *  for diagnostics and duplicate-name validation. */
  migration: string;
  /** Target aggregate name (resolves to table `plural(snake(aggregate))`). */
  aggregate: string;
  /** Owning bounded-context name — for module/schema resolution. */
  context: string;
  /** Old (pre-rename) field name — absent from the current model. */
  from: string;
  /** New (post-rename) field name — a live field of `aggregate`. */
  to: string;
}

/** One table step lowered from a `migration` block: `OldName -> NewName`
 *  (rename in place) or `OldCtx.OldName -> NewCtx.NewName` (a move to another
 *  bounded context, renaming too when the names differ).  The new side names
 *  a live aggregate, workflow or projection; the old side names what the
 *  model no longer declares.  All four names are RAW source names: the target
 *  is resolved on demand against the model's contexts
 *  (`resolveTableStepTarget`, `src/ir/util/table-step-target.ts`), never
 *  stamped here, because it may live in another file of the project than the
 *  block that names it. */
export interface TableRenameIntentIR extends Sourced {
  /** Block label — the `"<name>"` on the owning `migration` block. */
  migration: string;
  /** Old (pre-step) declaration name — its old table is derived from it. */
  from: string;
  /** New (post-step) declaration name — an aggregate, workflow or projection. */
  to: string;
  /** Old bounded context, on the qualified (move) form only. */
  fromContext?: string;
  /** New bounded context, on the qualified (move) form only. */
  toContext?: string;
}

/** One `Agg.field = <expr>` backfill step (M-T2.3) lowered from a `migration`
 *  block.  Unlike a rename's dead-side names, `field` names a LIVE field of
 *  `aggregate` (the newly-added / newly-required column); `value` is lowered
 *  in the aggregate's scope, so sibling fields appear as `this-prop` refs the
 *  SQL renderer turns into column references.  The builder snake-cases names
 *  exactly as it does for table/column derivation. */
export interface BackfillIntentIR extends Sourced {
  /** Block label — the `"<name>"` on the owning `migration` block. */
  migration: string;
  /** Target aggregate name (table `plural(snake(aggregate))`). */
  aggregate: string;
  /** Owning bounded-context name — for module/schema resolution. */
  context: string;
  /** The LIVE field being backfilled (column `snake(field)`). */
  field: string;
  /** The backfill expression, restricted to the SQL-renderable subset
   *  (`sqlRenderableExpr` — validated at phase ⑦, rendered at phase ⑨). */
  value: ExprIR;
}

/** One raw `sql "…"` step (M-T2.3) lowered from a `migration` block.
 *  `index` is the step's position among the block's steps — the ledger key
 *  is `"<migration>#<index>"`, recorded in the snapshot's
 *  `appliedDataMigrations` so the statement runs exactly once. */
export interface SqlStepIR extends Sourced {
  /** Block label — the `"<name>"` on the owning `migration` block. */
  migration: string;
  /** Position among the owning block's steps (ledger key component). */
  index: number;
  /** The raw Postgres statement, verbatim. */
  sql: string;
  /** `sql before "…"` — emitted AHEAD of the generation's structural steps
   *  (a dedupe that must precede a new `unique (…)` index) instead of after
   *  them.  `false` = the default trailing position. */
  before: boolean;
}

// ---------------------------------------------------------------------------
// Branded phase types — distinguish the IR shape at two pipeline points.
//
//   `RawLoomModel`      — the structural output of `lowerModel`.  Optional
//                         derivation fields (`associations`, `createInput`,
//                         `traceability`, …) are absent.
//   `EnrichedLoomModel` — the output of `enrichLoomModel`.  Every derived
//                         field is populated; downstream consumers can
//                         dereference them without nullability defense.
//
// The brand is a phantom property — purely a TypeScript-level
// discriminator.  Carries zero runtime cost (the value never carries
// `__phase`).  Mostly catches the "forgot to enrich" mistake at the
// generator entry point.  See PR #517 for the canary failure mode this
// shape prevents.
//
// `EnrichedAggregateIR` is a required-field overlay that mirrors the
// structural type — its enrich-derived members (`associations`,
// `createInput`, enriched `parts`) are non-optional, so a generator that
// takes an `EnrichedLoomModel` dereferences them without nullability
// defense.  (`EnrichedEntityPartIR` / `EnrichedValueObjectIR` carry no
// enrich-time members of their own — the canonical wire shape is
// recomputed on demand via `wireFieldsForPart` / `wireFieldsForValueObject`
// — so they alias their base types.)
// ---------------------------------------------------------------------------

export type RawLoomModel = LoomModel & { readonly __phase?: "raw" };

export type EnrichedLoomModel = Omit<LoomModel, "systems" | "contexts" | "rootValueObjects"> & {
  readonly __phase: "enriched";
  systems: EnrichedSystemIR[];
  contexts: EnrichedBoundedContextIR[];
  rootValueObjects: EnrichedValueObjectIR[];
  /** Always populated post-enrichment. */
  traceability: TraceabilityIR;
};

export type EnrichedAggregateIR = AggregateIR & {
  /** Always populated by `enrichLoomModel` (empty when none derived). */
  associations: AssociationIR[];
  /** Always populated by `enrichLoomModel` (empty when the aggregate has
   * no client-suppliable create fields). */
  createInput: CreateInputFieldIR[];
  parts: EnrichedEntityPartIR[];
};

// Parts / value objects carry no enrich-time derivation of their own (the
// canonical wire shape is recomputed on demand via `wireFieldsForPart` /
// `wireFieldsForValueObject`), so the enriched brand is their base type — kept
// as a named alias so consumers keep expressing "post-enrichment" intent.
export type EnrichedEntityPartIR = EntityPartIR;

export type EnrichedValueObjectIR = ValueObjectIR;

/** A channel-routed event subscription — the enrich-time join of a workflow
 *  consumer (`on(e: Event)` reactor or event-triggered `create(e: Event) by`)
 *  against the channels that `carries:` that event (channels.md; the
 *  in-process dispatch slice).  Computed per context by `enrichContext`; the
 *  Hono backend reads it to wire the in-process `DomainEventDispatcher` to the
 *  reactor/starter handlers.
 *
 *  EVERY in-process consumer appears, carried or not (**D-PROJECTION-IMPLICIT-SUB**):
 *  `on(e: E)` IS the subscription, and a `channel` is what makes delivery
 *  cross-deployable or durable — not what makes a handler run.  The derivation
 *  used to drop an uncarried consumer on the floor, which left a fold that no
 *  backend ever ran. */
export interface EventSubscriptionIR {
  /** The carried event type the consumer subscribes to. */
  event: string;
  /** The channel (in this context) that carries `event` and routes it, or
   *  `undefined` when no declared channel does — an IMPLICIT in-process
   *  subscription (D-PROJECTION-IMPLICIT-SUB), which dispatches all the same.
   *  When more than one channel carries it, the first by declaration order —
   *  disambiguation is a deferred validation rule (`reactor-channel-ambiguous`). */
  channel?: string;
  /** Owning workflow name. */
  workflow: string;
  /** `"on"` reactor or event-triggered `"create"` starter. */
  trigger: "on" | "create";
  /** The event-instance binding name in the handler body (`paid` in
   *  `on(paid: E)` / `create(paid: E) by …`). */
  param: string;
  /** For `trigger: "create"`, the create's declared name (null for the
   *  canonical unnamed create).  Undefined for `on` reactors. */
  createName?: string | null;
  /** Set when the consumer is a projection fold (projection.md) rather than a
   *  workflow saga — carries the projection name (also mirrored into
   *  `workflow`).  The dispatcher branches on this to emit an upsert fold
   *  (load-or-allocate on every event) instead of a saga's create/route split.
   *  Undefined for workflow subscriptions (they stay byte-identical). */
  projection?: string;
}

export type EnrichedBoundedContextIR = Omit<
  BoundedContextIR,
  "aggregates" | "valueObjects" | "siblingValueObjects"
> & {
  aggregates: EnrichedAggregateIR[];
  valueObjects: EnrichedValueObjectIR[];
  /** Sibling-context value objects, enriched — see
   *  `BoundedContextIR.siblingValueObjects`. */
  siblingValueObjects?: EnrichedValueObjectIR[];
  /** Channel-routed event subscriptions in this context (in-process dispatch
   *  slice).  Derived by `enrichContext`; empty when the context declares no
   *  channel that carries a subscribed event. */
  eventSubscriptions: EventSubscriptionIR[];
};

export type EnrichedSubdomainIR = Omit<SubdomainIR, "contexts"> & {
  contexts: EnrichedBoundedContextIR[];
};

export type EnrichedSystemIR = Omit<SystemIR, "subdomains"> & {
  subdomains: EnrichedSubdomainIR[];
  /** Derived logical needs, one per `(context, required kind)` — the
   *  implicit "need" layer (RFC §3.3).  Populated by `enrichLoomModel`. */
  needs: NeedIR[];
  /** Resolved default access interface per resource name (RFC §3.5),
   *  derived from the resource's sourceType + kind.  A consuming
   *  operation may override it once the consumption surface exists; until
   *  then this is the per-resource default. */
  resourceInterfaces: Record<string, LoomInterface>;
  /** App-wide resolved HTTP status for each structural-conflict built-in —
   *  see `BoundedContextIR.structuralErrorStatuses`. Threaded to the app-global
   *  exception handlers (.NET `DomainExceptionFilter`, Python handlers, Java
   *  `ApiExceptionAdvice`, Elixir `ProblemDetails`) which have no per-context
   *  tag. Folded across every api, each defaulting to 409. */
  structuralErrorStatuses: Record<string, number>;
};
