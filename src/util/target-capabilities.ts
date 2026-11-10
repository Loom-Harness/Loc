// ---------------------------------------------------------------------------
// The per-target CAPABILITY TABLE — what each target renders, as data.
//
// A model that passes validation must never be degraded, misgenerated or crash
// a generator.  That only holds if the validator knows, before emission, what
// every target can render — so the knowledge lives HERE, once, rather than in
// each emitter's `default:` arm, a `loom:unrendered` give-up, or a membership
// Set private to one validator check.
//
// SHAPE.  Every target (a `Platform`) carries a `TargetCapabilityTable`: for
// each construct × position it lists, a verdict.  There is no third state:
//
//   supported — the target renders it.  `test/system/target-capability-table
//               .test.ts` proves it on a witness model: it validates clean and
//               generates with no give-up marker and no throw.
//   refused   — the target cannot render it.  The ONE phase-⑦ check
//               (`src/ir/validate/checks/target-capability-checks.ts`) raises
//               `loom.target-unsupported` with the message
//               `loom.target-unsupported#<slug>` wherever the model uses it.
//   owned     — refused, but by an older check that still carries its own code
//               (named here so the table test can prove it fires).  A
//               migration in flight: the row moves to `refused` when that
//               check is folded into the one above.
//
// The construct keys are closed unions, and each table is a `Record` over
// them, so adding a construct is a type error on every target until each one
// states its verdict.
//
// UI constructs are keyed by the ui FRAMEWORK that renders them, not by the
// deployable's platform: a `platform: dotnet` host serving a `framework: vue`
// bundle renders it with the Vue generator.  `ui.frameworks` names the
// frameworks a target's generator renders; the four static-bundle backends
// (node, dotnet, python, java) render none, so they carry no `ui` section.
//
// Lives in `src/util/` because both halves read it: the validator (phase ⑦)
// refuses what a target can't render, and an emitter that must still choose a
// path (`_walker/history-read.ts`) derives its membership set from the same
// row — so the two cannot disagree.  Each `PlatformSurface` re-exports its
// table as `capabilities` (`descriptor-consistency.test.ts` pins it).
// ---------------------------------------------------------------------------

import type { Platform } from "../ir/types/loom-ir.js";

/** The stable refusal reasons.  Each one is a message
 *  `loom.target-unsupported#<slug>` in `src/diagnostics/messages.ts`. */
export type TargetRefusalSlug =
  | "datagrid"
  | "chart"
  | "money-locale-format"
  | "entity-history-read"
  | "match-await-standard-op"
  | "lifecycle-guard-event-sourced"
  | "tenant-owned-event-sourced"
  | "resource-kind-unrealized"
  | "storage-type-unrealized"
  | "resource-knob-unrealized"
  | "storage-type-unbound"
  | "feature-composition-broken"
  | "feature-composition-unwitnessed";

/** A target's verdict on one construct × position. */
export type CapabilityVerdict =
  | { readonly verdict: "supported" }
  | { readonly verdict: "refused"; readonly slug: TargetRefusalSlug }
  | { readonly verdict: "owned"; readonly code: string };

/** UI constructs the phase-⑦ check refuses itself (a `refused` verdict is
 *  possible), each at its position.  A page or component body is the position
 *  every row here names: components render into pages, so a construct moved
 *  into one is exactly as (un)renderable. */
export type RefusableUiConstruct =
  /** `DataGrid { … }` in a page or component body. */
  | "primitive:DataGrid@body"
  /** `Chart { … }` in a page or component body. */
  | "primitive:Chart@body"
  /** `Money { …, format: "locale" }` — the opt-in locale-formatted display. */
  | "primitive:Money-locale-format@body"
  /** `QueryView { of: <api>.<Agg>.history(id) }` — the derived entity-history
   *  read — in a page or component body. */
  | "read:entity-history@body"
  /** `match await <Agg>.<standard op>()` in a page or component action body — an
   *  awaited `all`/`byId`/`create`/`update`/`delete` rather than a declared
   *  operation. */
  | "stmt:match-await-standard-op@action"
  /** An operation of a served aggregate answering `<payload> or <error>`
   *  whose success arm is a declared payload rather than the aggregate — in
   *  the ui's generated api client. */
  | "return:payload-or-error@api-client";

/** UI constructs whose unsupported cells are refused by an OLDER check that
 *  keeps its own code, so a cell here is `supported` or `owned`, never
 *  `refused`.  The owning check derives its framework membership from the row
 *  (`frameworksSupporting` / `frameworksOwned`) rather than a private Set, so
 *  the table and the check cannot disagree. */
export type OwnedUiConstruct =
  /** A query-time projection read through an api handle. */
  | "read:projection@body"
  /** `Table { filter: <state> }`. */
  | "primitive:Table-filter@body"
  /** `Modal { open: <state>, OperationForm { … } }`. */
  | "primitive:Modal-open-op-form@body"
  /** A component declared `extern from "…"` (the hand-written-shim hatch). */
  | "decl:extern-component@ui"
  /** A page `requires <expr>` gate beyond the closed `currentUser`/constant
   *  subset. */
  | "gate:page-requires-full-expr@page"
  /** `return` / `precondition` / `requires` statements in a ui action or body. */
  | "stmt:backend-body@ui-body"
  /** `on <channel>.<Event>` live-event handlers on a ui. */
  | "handler:live-event@ui"
  /** `auth: ui` — the generated session guard around the ui. */
  | "auth:ui-guard@deployable"
  /** `match await <op>()` in a component (not page) action body. */
  | "stmt:match-await@component-action";

/** Every UI construct. */
export type UiConstruct = RefusableUiConstruct | OwnedUiConstruct;

/** Backend constructs, each at its position. */
export type BackendConstruct =
  /** A `requires` gate inside an event-sourced aggregate's `create` body. */
  | "stmt:requires@event-sourced-create"
  /** A workflow command or command handler that mutates or deletes a row it
   *  holds (from `Repo.all(…)`, a find, a loop) of an aggregate whose write
   *  scope is narrowed (`deny write`): the
   *  body re-checks the row's write scope before the write and rolls back on
   *  a miss (`ir/util/write-scope-guards.ts`). */
  | "effect:mutate-held-row@command-body"
  /** `with tenantOwned` on a `persistedAs: eventLog` aggregate — a stream
   *  that carries its tenant as stored-event metadata (`stream-tenancy.ts`). */
  | "capability:tenantOwned@event-sourced"
  /** `with shareable` on a state aggregate — the share aggregate it unfolds to
   *  and the row rules that open the row to its grantees (D-SHARING). */
  | "capability:shareable@aggregate"
  /** `resource r { kind: replica, … }` — a read-replica binding. */
  | "resource:replica@resource"
  /** `resource r { kind: cache, … }` — a read-through cache binding. */
  | "resource:cache@resource"
  /** `resource r { kind: snapshot, … }` — an event-sourced snapshot store. */
  | "resource:snapshot@resource"
  /** `resource r { …, ttl: … }` — a cache expiry. */
  | "knob:ttl@resource"
  /** `resource r { …, keyPrefix: … }` — a cache key namespace. */
  | "knob:keyPrefix@resource"
  /** `resource r { …, every: … }` — a snapshot cadence. */
  | "knob:every@resource"
  /** `resource r { …, retain: … }` — a snapshot retention count. */
  | "knob:retain@resource"
  /** `resource r { …, readonly: … }` — a replica-aware connection. */
  | "knob:readonly@resource"
  /** `resource r { kind: eventLog, use: <kafka storage> }` — an event stream
   *  held in Kafka rather than the relational event table. */
  | "resource:eventLog-on-kafka@resource"
  /** A `state` / `snapshot` / `eventLog` resource bound to a `type: mysql`
   *  storage. */
  | "storage:mysql@resource"
  /** The same, bound to a `type: sqlite` storage. */
  | "storage:sqlite@resource"
  /** The same, bound to a `type: inMemory` storage. */
  | "storage:inMemory@resource"
  /** A `storage` declared with a type that binds to no kind: nothing can use
   *  it and no backend emits anything for it. */
  | "storage:elastic@declaration"
  | "storage:meilisearch@declaration"
  | "storage:clickhouse@declaration"
  | "storage:bigquery@declaration"
  | "storage:nats@declaration"
  /** An event-sourced aggregate emitting an event that a broker-bound channel
   *  carries: the event append and the outbox row must commit together. */
  | "publish:event-sourced@broker-channel"
  /** A context reading `organizationContext.ancestors` hosted on a deployable
   *  that does not host the tenancy registry: the walk reads its table. */
  | "tenancy:remote-registry@deployable"
  /** A query-time projection reading a `shareable` aggregate, served by a
   *  deployable that does not host the aggregate's context: it would read the
   *  table past the share rules. */
  | "read:shareable-off-host@deployable"
  /** A typed `kind: api` resource whose api is served by an `auth: required`
   *  deployable: the call must forward the caller's credentials. */
  | "call:auth-required-api@resource"
  /** A `timerSource` whose event a broker-bound channel carries to another
   *  deployable: the tick must be published, not dispatched in-process. */
  | "timer:broker-channel@deployable"
  /** A `derived` that reads a `mask unless` field of its aggregate. */
  | "derived:reads-masked-field@aggregate"
  /** A `criterion` whose predicate reads a `mask unless` field. */
  | "criterion:reads-masked-field@context"
  /** A value-object collection (`Tag[]`) on a contained entity part. */
  | "field:valueobject-collection@entity-part"
  /** A value object with a field of a value-object type that declares an
   *  invariant. */
  | "invariant:nested-valueobject@valueobject"
  /** An event carrying a value read from a `mask unless` field, on a channel. */
  | "emit:masked-value@channel-event"
  /** A unique key over a `mask unless` field. */
  | "unique:masked-field@aggregate"
  /** `let r = <agg>.<op>(…)` / `let r = <Service>.<op>(…)` — a mutating call
   *  whose result is bound — in a workflow or handler body. */
  | "call:bound-mutating@entry-body"
  /** A routed workflow `create` or handler answering an expected failure
   *  (`T or E`), or a workflow `create` answering the workflow itself. */
  | "return:expected-failure@entry-point"
  /** A statement `match` whose arm shape the body cannot carry: a guard or a
   *  non-tail `return` in an arm, an arm statement outside the arm
   *  vocabulary, a union of several success variants, or any match in an
   *  event-sourced body. */
  | "stmt:match-arm-shape@body"
  /** An invariant the persistence layer's write validation cannot evaluate
   *  against the record it validates (a reference collection, a call out). */
  | "invariant:unvalidated-shape@aggregate"
  /** An operation self-call anywhere but the whole value of a `return`. */
  | "call:op-self-non-tail@operation"
  /** A bare call to a private operation whose body reads `currentUser`. */
  | "call:private-op-reads-principal@operation"
  /** A named operation or custom find over a `shape: document` aggregate that
   *  reads a shape the document path does not render. */
  | "op:document-residue@aggregate"
  /** A lifecycle `stamp` value reading the aggregate, on a `shape: document`
   *  aggregate. */
  | "stamp:reads-aggregate@document";

/** Every refusable UI construct, in a stable order (the table test iterates it). */
export const UI_CONSTRUCTS: readonly RefusableUiConstruct[] = [
  "primitive:DataGrid@body",
  "primitive:Chart@body",
  "primitive:Money-locale-format@body",
  "read:entity-history@body",
  "stmt:match-await-standard-op@action",
  "return:payload-or-error@api-client",
];

/** Every owned-only UI construct, in a stable order. */
export const OWNED_UI_CONSTRUCTS: readonly OwnedUiConstruct[] = [
  "read:projection@body",
  "primitive:Table-filter@body",
  "primitive:Modal-open-op-form@body",
  "decl:extern-component@ui",
  "gate:page-requires-full-expr@page",
  "stmt:backend-body@ui-body",
  "handler:live-event@ui",
  "auth:ui-guard@deployable",
  "stmt:match-await@component-action",
];

/** Every UI construct, refusable then owned. */
export const ALL_UI_CONSTRUCTS: readonly UiConstruct[] = [...UI_CONSTRUCTS, ...OWNED_UI_CONSTRUCTS];

/** Every backend construct, in a stable order. */
export const BACKEND_CONSTRUCTS: readonly BackendConstruct[] = [
  "stmt:requires@event-sourced-create",
  "effect:mutate-held-row@command-body",
  "capability:tenantOwned@event-sourced",
  "capability:shareable@aggregate",
  "resource:replica@resource",
  "resource:cache@resource",
  "resource:snapshot@resource",
  "knob:ttl@resource",
  "knob:keyPrefix@resource",
  "knob:every@resource",
  "knob:retain@resource",
  "knob:readonly@resource",
  "resource:eventLog-on-kafka@resource",
  "storage:mysql@resource",
  "storage:sqlite@resource",
  "storage:inMemory@resource",
  "storage:elastic@declaration",
  "storage:meilisearch@declaration",
  "storage:clickhouse@declaration",
  "storage:bigquery@declaration",
  "storage:nats@declaration",
  "publish:event-sourced@broker-channel",
  "tenancy:remote-registry@deployable",
  "read:shareable-off-host@deployable",
  "call:auth-required-api@resource",
  "timer:broker-channel@deployable",
  "derived:reads-masked-field@aggregate",
  "criterion:reads-masked-field@context",
  "field:valueobject-collection@entity-part",
  "invariant:nested-valueobject@valueobject",
  "emit:masked-value@channel-event",
  "unique:masked-field@aggregate",
  "call:bound-mutating@entry-body",
  "return:expected-failure@entry-point",
  "stmt:match-arm-shape@body",
  "invariant:unvalidated-shape@aggregate",
  "call:op-self-non-tail@operation",
  "call:private-op-reads-principal@operation",
  "op:document-residue@aggregate",
  "stamp:reads-aggregate@document",
];

/** The refusal a UI construct gets on a framework NO target renders (an
 *  unresolved or unknown `framework:`) — fail-closed, so an unrecognised
 *  framework never reaches an emitter with a construct nobody rendered. */
export const UI_CONSTRUCT_REFUSAL: Readonly<Record<RefusableUiConstruct, TargetRefusalSlug>> = {
  "primitive:DataGrid@body": "datagrid",
  "primitive:Chart@body": "chart",
  "primitive:Money-locale-format@body": "money-locale-format",
  "read:entity-history@body": "entity-history-read",
  "stmt:match-await-standard-op@action": "match-await-standard-op",
  "return:payload-or-error@api-client": "feature-composition-broken",
};

/** The verdict an owned-only construct gets on a framework NO target renders.
 *  Fail-closed where the owning check refuses an unrecognised framework; the
 *  two rows whose check is scoped to the frameworks it knows stay `supported`
 *  there (no check ran before, none runs now). */
const OWNED_FALLBACK: Readonly<Record<OwnedUiConstruct, CapabilityVerdict>> = {
  "read:projection@body": { verdict: "owned", code: "loom.ui-projection-read-unsupported" },
  "primitive:Table-filter@body": { verdict: "owned", code: "loom.table-filter-unsupported" },
  "primitive:Modal-open-op-form@body": {
    verdict: "owned",
    code: "loom.modal-controlled-op-form-unsupported",
  },
  "decl:extern-component@ui": { verdict: "owned", code: "loom.user-component-deferred-target" },
  "gate:page-requires-full-expr@page": { verdict: "supported" },
  "stmt:backend-body@ui-body": { verdict: "owned", code: "loom.ui-body-statement-kind" },
  "handler:live-event@ui": { verdict: "owned", code: "loom.ui-realtime-unsupported" },
  "auth:ui-guard@deployable": { verdict: "owned", code: "loom.auth-ui-unsupported-framework" },
  "stmt:match-await@component-action": { verdict: "supported" },
};

/** Applicability facts about a framework's generator that are not a
 *  support/refuse choice: a rule scoped to the frameworks it describes.  The
 *  non-members are not "refused" — the rule is simply about something they do
 *  not do. */
export type UiScope =
  /** Component props / extern-function signatures are emitted as TypeScript
   *  through the shared `_frontend/` mapping (Feliz and Flutter spell their
   *  own; HEEx has no props file). */
  | "props:typescript"
  /** Page forms share one local-name scope per page (react/vue/svelte), so two
   *  forms can collide. */
  | "forms:shared-local-scope"
  /** The component emitter FILTERS its emitted set (feliz/angular/flutter), so
   *  a component shape it defers must be reported. */
  | "components:deferral-filtered"
  /** Component props are F# anonymous records: exact, so an optional param has
   *  no spelling, and neither has a `slot` or an `action` param. */
  | "props:fsharp-records"
  /** A component's `state` and named actions are hoisted into the host view
   *  (LiveView assigns and `handle_event` clauses). */
  | "components:hoisted-into-host"
  /** An extern component's children are dropped at the call site (the
   *  component is invoked through an outlet that cannot project content). */
  | "components:extern-children-dropped"
  /** Duplicate page-form local declarations are deduped rather than failing
   *  the build, so a colliding form silently reuses the first one. */
  | "forms:duplicate-locals-deduped"
  /** A ui body binds `this` (the server-side view process owns the record). */
  | "ui-body:binds-this"
  /** A store is a server-side, per-process struct rather than browser state. */
  | "stores:server-process"
  /** Persisted store state round-trips through the F# codec. */
  | "stores:persist-fsharp-codec"
  /** Persisted store state round-trips through the Dart codec. */
  | "stores:persist-dart-codec"
  /** A page read is an in-process call: no api route is needed. */
  | "reads:in-process"
  /** A page read builds its URL from the derived find path rather than a
   *  synthesized find route. */
  | "reads:derived-find-path";

/** Applicability facts about a backend's generated code that are not a
 *  support/refuse choice: a rule scoped to the backends it describes. */
export type BackendScope =
  /** Generated members and types are C#, so two names that differ only in a
   *  way C# folds (or that clash with a namespace) collide. */
  | "names:csharp-members"
  /** A relational entity part's schema carries implicit `inserted_at` /
   *  `updated_at` timestamp columns. */
  | "fields:part-implicit-timestamps";

// --- the feature-tuple axis ---------------------------------------------------
//
// A construct above is ONE feature at one position.  Most defects that validate
// clean and then miscompile, 500 or leak live where TWO features meet on one
// declaration — `versioned` on an event-sourced aggregate, `tenantOwned` on a
// TPH base.  So the table has a second key besides the construct: a FEATURE
// TUPLE, a pair of feature values drawn from two axes that compose.  Every
// backend target states a verdict for every tuple, exactly like a construct:
//
//   supported — names the behavioural corpus fixture (`test/fixtures/corpus/
//               <id>.ddd`) that reaches the pair on that backend and runs it.
//   refused   — `loom.target-unsupported#<slug>` at every aggregate carrying
//               both features, on that target only.
//   owned     — refused by another check under its own code.
//
// `FEATURE_TUPLES` is the product of each composing axis pair, so adding a value
// to an axis (or an axis pair) is a type error on every target, and a failing
// `test/system/feature-composition-table.test.ts`, until each one decides it.

/** The feature axes and their values. */
export const FEATURE_AXES = {
  /** How an aggregate persists: a state row, an event stream, a JSON document. */
  persistence: ["state", "eventLog", "document"],
  /** A prelude capability applied with `with <cap>`; `provenanced` is a field
   *  modifier, counted when any field of the aggregate carries it. */
  capability: [
    "versioned",
    "softDeletable",
    "auditable",
    "tenantOwned",
    "provenanced",
    "shareable",
  ],
  /** Where an aggregate sits in an inheritance hierarchy, per table layout
   *  (TPH = `sharedTable`, TPC = `ownTable`). */
  inheritance: ["tph-base", "tph-subtype", "tpc-base", "tpc-subtype"],
} as const;

export type FeatureAxis = keyof typeof FEATURE_AXES;
export type FeatureOf<A extends FeatureAxis> = `${A}:${(typeof FEATURE_AXES)[A][number]}`;
/** One feature value, spelled `<axis>:<value>`. */
export type Feature = { [A in FeatureAxis]: FeatureOf<A> }[FeatureAxis];

/** The axis pairs whose values compose on one aggregate.  Every value × value
 *  tuple of each pair is a row. */
export const COMPOSING_AXES = [
  ["persistence", "capability"],
  ["capability", "inheritance"],
] as const satisfies readonly (readonly [FeatureAxis, FeatureAxis])[];

type TupleOf<P> = P extends readonly [infer A extends FeatureAxis, infer B extends FeatureAxis]
  ? `${FeatureOf<A>}+${FeatureOf<B>}`
  : never;
/** A feature pair, spelled `<feature>+<feature>` in `COMPOSING_AXES` order. */
export type FeatureTuple = TupleOf<(typeof COMPOSING_AXES)[number]>;

/** Every feature tuple, in a stable order (the table test iterates it). */
export const FEATURE_TUPLES: readonly FeatureTuple[] = COMPOSING_AXES.flatMap(([a, b]) =>
  FEATURE_AXES[a].flatMap((x) => FEATURE_AXES[b].map((y) => `${a}:${x}+${b}:${y}` as FeatureTuple)),
);

/** The two features a tuple names. */
export function tupleFeatures(t: FeatureTuple): readonly [Feature, Feature] {
  const [a, b] = t.split("+") as [Feature, Feature];
  return [a, b];
}

/** A target's verdict on one feature tuple.  A supported cell names its
 *  witness, so "supported" cannot be claimed without a fixture that runs it. */
export type CompositionVerdict =
  | { readonly verdict: "supported"; readonly fixture: string }
  /** Supported because a construct row names the same pair and is supported
   *  on this target, proven by that row's own witness. */
  | { readonly verdict: "supported"; readonly construct: BackendConstruct }
  | { readonly verdict: "refused"; readonly slug: TargetRefusalSlug }
  | { readonly verdict: "owned"; readonly code: string };

/** One target's table. */
export interface TargetCapabilityTable {
  /** The ui frameworks this target's generator renders, and its verdict per
   *  UI construct.  Absent on a target that renders no ui framework itself. */
  readonly ui?: {
    readonly frameworks: readonly string[];
    readonly constructs: Readonly<Record<UiConstruct, CapabilityVerdict>>;
    /** Applicability facts (see {@link UiScope}). */
    readonly scopes?: readonly UiScope[];
    /** Pack primitive-template ids with no renderer on this framework —
     *  validator-gated, so a page using one is refused rather than dropped. */
    readonly unrenderedPrimitives?: readonly string[];
    /** Page-body primitives whose rendering needs the host view to supply an
     *  assign / upload / handler, so a component using one is inlined. */
    readonly hostStatePrimitives?: readonly string[];
  };
  /** Its verdict per backend construct.  Absent on a frontend. */
  readonly backend?: Readonly<Record<BackendConstruct, CapabilityVerdict>>;
  /** Applicability facts (see {@link BackendScope}). */
  readonly backendScopes?: readonly BackendScope[];
  /** Its verdict per feature tuple.  Present exactly when `backend` is. */
  readonly compositions?: Readonly<Record<FeatureTuple, CompositionVerdict>>;
}

const SUPPORTED: CapabilityVerdict = { verdict: "supported" };
const refused = (slug: TargetRefusalSlug): CapabilityVerdict => ({ verdict: "refused", slug });

const owned = (code: string): CapabilityVerdict => ({ verdict: "owned", code });

/** The owned-only rows a framework shares unless it says otherwise.  Every
 *  frontend renders these; the per-framework overrides below name the
 *  exceptions, each with the older check that refuses them. */
const COMMON_OWNED: Readonly<Record<OwnedUiConstruct, CapabilityVerdict>> = {
  "read:projection@body": SUPPORTED,
  "primitive:Table-filter@body": SUPPORTED,
  // react/vue/svelte/flutter collapse the whole modal to a comment.
  "primitive:Modal-open-op-form@body": owned("loom.modal-controlled-op-form-unsupported"),
  "decl:extern-component@ui": SUPPORTED,
  // The page-gate renderer is a closed `currentUser`/constant table.
  "gate:page-requires-full-expr@page": owned("loom.ui-gate-expr-unsupported"),
  // An action-body renderer with no arm for `return`/`precondition`/`requires`.
  "stmt:backend-body@ui-body": owned("loom.ui-body-statement-kind"),
  "handler:live-event@ui": SUPPORTED,
  "auth:ui-guard@deployable": SUPPORTED,
  "stmt:match-await@component-action": SUPPORTED,
};

/** The UI row every JS frontend shares: TanStack runs, so `DataGrid` ships. */
const JS_FRONTEND_UI: Readonly<Record<UiConstruct, CapabilityVerdict>> = {
  "primitive:DataGrid@body": SUPPORTED,
  "primitive:Chart@body": SUPPORTED,
  // `moneyText` hands the digit string to `Intl.NumberFormat`.
  "primitive:Money-locale-format@body": SUPPORTED,
  "read:entity-history@body": SUPPORTED,
  "stmt:match-await-standard-op@action": SUPPORTED,
  // The api module names the success payload's response type and never
  // declares it, so the client does not compile.
  "return:payload-or-error@api-client": refused("feature-composition-broken"),
  ...COMMON_OWNED,
};

/** An event-sourced create renders into the domain `_init`, which has no
 *  principal in scope on these four — `currentUser` there does not deny, it
 *  does not compile.  Phoenix hoists the gate to the context function, which
 *  binds one. */
const ES_CREATE_REQUIRES_REFUSED: CapabilityVerdict = {
  verdict: "refused",
  slug: "lifecycle-guard-event-sourced",
};

/** The persistence cells no backend realizes.  A relational `state` /
 *  `snapshot` / `eventLog` resource is emitted as Postgres (the migrations, the
 *  ORM mapping and the compose `db` service are all Postgres), so a model that
 *  names another database would silently run on Postgres; `replica` and a
 *  Kafka-held event log have no emitter at all.  Every backend shares the
 *  verdicts, so the part of the table that moves when one gains support is
 *  this one object. */
const UNREALIZED_RESOURCES: Pick<
  Record<BackendConstruct, CapabilityVerdict>,
  | "resource:replica@resource"
  | "resource:cache@resource"
  | "resource:snapshot@resource"
  | "knob:ttl@resource"
  | "knob:keyPrefix@resource"
  | "knob:every@resource"
  | "knob:retain@resource"
  | "knob:readonly@resource"
  | "resource:eventLog-on-kafka@resource"
  | "storage:mysql@resource"
  | "storage:sqlite@resource"
  | "storage:inMemory@resource"
  | "storage:elastic@declaration"
  | "storage:meilisearch@declaration"
  | "storage:clickhouse@declaration"
  | "storage:bigquery@declaration"
  | "storage:nats@declaration"
> = {
  "resource:replica@resource": refused("resource-kind-unrealized"),
  "resource:cache@resource": refused("resource-kind-unrealized"),
  "resource:snapshot@resource": refused("resource-kind-unrealized"),
  "knob:ttl@resource": refused("resource-knob-unrealized"),
  "knob:keyPrefix@resource": refused("resource-knob-unrealized"),
  "knob:every@resource": refused("resource-knob-unrealized"),
  "knob:retain@resource": refused("resource-knob-unrealized"),
  "knob:readonly@resource": refused("resource-knob-unrealized"),
  "storage:elastic@declaration": refused("storage-type-unbound"),
  "storage:meilisearch@declaration": refused("storage-type-unbound"),
  "storage:clickhouse@declaration": refused("storage-type-unbound"),
  "storage:bigquery@declaration": refused("storage-type-unbound"),
  "storage:nats@declaration": refused("storage-type-unbound"),
  "resource:eventLog-on-kafka@resource": refused("resource-kind-unrealized"),
  "storage:mysql@resource": refused("storage-type-unrealized"),
  "storage:sqlite@resource": refused("storage-type-unrealized"),
  "storage:inMemory@resource": refused("storage-type-unrealized"),
};

const witnessed = (fixture: string): CompositionVerdict => ({ verdict: "supported", fixture });
const BROKEN: CompositionVerdict = { verdict: "refused", slug: "feature-composition-broken" };
const UNWITNESSED: CompositionVerdict = {
  verdict: "refused",
  slug: "feature-composition-unwitnessed",
};
/** Refused by the stamp check: an event-sourced aggregate has no state row to
 *  carry a stamped column. */
const STAMP_ON_EVENT_SOURCED: CompositionVerdict = {
  verdict: "owned",
  code: "loom.stamp-on-event-sourced-invalid",
};

/** Owned by the `exists` check: the share rules quantify over the shared row. */
const SHARE_RULES_UNRENDERED: CompositionVerdict = {
  verdict: "owned",
  code: "loom.exists-unsupported",
};
/** Owned by the row-rule hierarchy check. */
const SHARE_RULES_ON_HIERARCHY: CompositionVerdict = {
  verdict: "owned",
  code: "loom.policy-scope-inheritance-unsupported",
};

/** The feature-tuple verdicts every backend shares unless it says otherwise.
 *
 *  `feature-composition-broken` marks a pair whose generated code is known
 *  wrong; `feature-composition-unwitnessed` a pair no behavioural fixture runs,
 *  so nothing proves the generated code right.  Either moves to `witnessed`
 *  when a corpus fixture that reaches the pair passes on that backend. */
const COMMON_COMPOSITIONS: Readonly<Record<FeatureTuple, CompositionVerdict>> = {
  "persistence:state+capability:versioned": witnessed("core-domain"),
  "persistence:state+capability:softDeletable": witnessed("tph-crossings"),
  "persistence:state+capability:auditable": witnessed("stamps"),
  "persistence:state+capability:tenantOwned": witnessed("inheritance-read-restrictions"),
  "persistence:state+capability:provenanced": witnessed("if-branch-shapes"),
  // The stream is the concurrency control: no backend folds or bumps the
  // spliced `version` field, so the ETag / If-Match protocol answers a value
  // that never moves.
  "persistence:eventLog+capability:versioned": BROKEN,
  // No event-sourced repository reads `isDeleted`: a deleted stream stays
  // readable by id, in the list and through every find.
  "persistence:eventLog+capability:softDeletable": BROKEN,
  "persistence:eventLog+capability:auditable": STAMP_ON_EVENT_SOURCED,
  // The stream carries its tenant as event metadata.
  "persistence:eventLog+capability:tenantOwned": {
    verdict: "supported",
    construct: "capability:tenantOwned@event-sourced",
  },
  "persistence:eventLog+capability:provenanced": UNWITNESSED,
  // The share rules quantify over the shared row with `exists`, which no
  // event-sourced or document read renders.
  "persistence:state+capability:shareable": {
    verdict: "supported",
    construct: "capability:shareable@aggregate",
  },
  "persistence:eventLog+capability:shareable": SHARE_RULES_UNRENDERED,
  "persistence:document+capability:shareable": SHARE_RULES_UNRENDERED,
  "persistence:document+capability:versioned": witnessed("paged-nonrelational"),
  "persistence:document+capability:softDeletable": witnessed("find-bypass"),
  "persistence:document+capability:auditable": UNWITNESSED,
  "persistence:document+capability:tenantOwned": witnessed("policy-document"),
  "persistence:document+capability:provenanced": UNWITNESSED,
  "capability:versioned+inheritance:tph-base": witnessed("inheritance"),
  "capability:versioned+inheritance:tph-subtype": witnessed("inheritance"),
  "capability:versioned+inheritance:tpc-base": witnessed("inheritance"),
  "capability:versioned+inheritance:tpc-subtype": witnessed("inheritance"),
  "capability:softDeletable+inheritance:tph-base": UNWITNESSED,
  "capability:softDeletable+inheritance:tph-subtype": witnessed("tph-crossings"),
  "capability:softDeletable+inheritance:tpc-base": UNWITNESSED,
  "capability:softDeletable+inheritance:tpc-subtype": witnessed("inheritance-read-restrictions"),
  "capability:auditable+inheritance:tph-base": UNWITNESSED,
  "capability:auditable+inheritance:tph-subtype": UNWITNESSED,
  "capability:auditable+inheritance:tpc-base": UNWITNESSED,
  "capability:auditable+inheritance:tpc-subtype": UNWITNESSED,
  "capability:tenantOwned+inheritance:tph-base": witnessed("inheritance-read-restrictions"),
  "capability:tenantOwned+inheritance:tph-subtype": witnessed("inheritance-read-restrictions"),
  "capability:tenantOwned+inheritance:tpc-base": witnessed("inheritance-read-restrictions"),
  "capability:tenantOwned+inheritance:tpc-subtype": witnessed("inheritance-read-restrictions"),
  "capability:provenanced+inheritance:tph-base": UNWITNESSED,
  "capability:provenanced+inheritance:tph-subtype": UNWITNESSED,
  "capability:provenanced+inheritance:tpc-base": UNWITNESSED,
  "capability:provenanced+inheritance:tpc-subtype": UNWITNESSED,
  // Row rules on an inheritance hierarchy are refused (the share rules among them).
  "capability:shareable+inheritance:tph-base": SHARE_RULES_ON_HIERARCHY,
  "capability:shareable+inheritance:tph-subtype": SHARE_RULES_ON_HIERARCHY,
  "capability:shareable+inheritance:tpc-base": SHARE_RULES_ON_HIERARCHY,
  "capability:shareable+inheritance:tpc-subtype": SHARE_RULES_ON_HIERARCHY,
};

/** The feature-pair constructs every backend shares unless it says otherwise.
 *  Each names two features meeting at one site; see `BackendConstruct`. */
const COMMON_PAIRS: Pick<
  Record<BackendConstruct, CapabilityVerdict>,
  | "publish:event-sourced@broker-channel"
  | "tenancy:remote-registry@deployable"
  | "read:shareable-off-host@deployable"
  | "call:auth-required-api@resource"
  | "timer:broker-channel@deployable"
  | "derived:reads-masked-field@aggregate"
  | "criterion:reads-masked-field@context"
  | "field:valueobject-collection@entity-part"
  | "invariant:nested-valueobject@valueobject"
  | "emit:masked-value@channel-event"
  | "unique:masked-field@aggregate"
> = {
  // No fixture runs an event-sourced save through a durable channel.
  "publish:event-sourced@broker-channel": refused("feature-composition-unwitnessed"),
  // Phase ⑦ refuses an `organizationContext.ancestors` reader on a deployable
  // that does not host the registry: its database holds no registry table.
  "tenancy:remote-registry@deployable": owned("loom.tenancy-registry-remote-unsupported"),
  "read:shareable-off-host@deployable": owned("loom.share-host-bypass"),
  // A request-originated call forwards the caller's own credential
  // (`api-call-e2e` runs it on every caller); a call with no request principal
  // is refused by `loom.api-call-principal-unsupported`.
  "call:auth-required-api@resource": SUPPORTED,
  // The scheduler publishes a broker-carried tick through the channel tee;
  // `channels-e2e` runs one to a consumer on another deployable.
  "timer:broker-channel@deployable": SUPPORTED,
  // A derived that reads a masked field inherits the mask, and a criterion
  // over one is evaluated as the caller sees it; the `field-mask` corpus
  // fixture runs both on every backend.
  "derived:reads-masked-field@aggregate": SUPPORTED,
  "criterion:reads-masked-field@context": SUPPORTED,
  // The `part-value-collection` corpus fixtures run it, relational and document,
  // on every backend.  A Dapper or MikroORM host beside another adapter in one
  // context is refused by `loom.collection-field-unpersisted`.
  "field:valueobject-collection@entity-part": SUPPORTED,
  "invariant:nested-valueobject@valueobject": SUPPORTED,
  // A channel subscriber holds no principal to evaluate the mask against.
  "emit:masked-value@channel-event": owned("loom.field-mask-event-channel"),
  // A duplicate-key rejection tells an unprivileged writer the value exists;
  // the check passes a create gated on the mask's own predicate.
  "unique:masked-field@aggregate": owned("loom.field-mask-unique-oracle"),
};

/** The body and entry-point shapes a backend that models an operation as a
 *  value-returning method, and an entry point as one transaction, renders. */
const METHOD_BODY_ROWS: Pick<
  Record<BackendConstruct, CapabilityVerdict>,
  | "call:bound-mutating@entry-body"
  | "return:expected-failure@entry-point"
  | "stmt:match-arm-shape@body"
  | "invariant:unvalidated-shape@aggregate"
  | "call:op-self-non-tail@operation"
  | "call:private-op-reads-principal@operation"
  | "op:document-residue@aggregate"
  | "stamp:reads-aggregate@document"
> = {
  "call:bound-mutating@entry-body": SUPPORTED,
  "return:expected-failure@entry-point": SUPPORTED,
  "stmt:match-arm-shape@body": SUPPORTED,
  "invariant:unvalidated-shape@aggregate": SUPPORTED,
  "call:op-self-non-tail@operation": SUPPORTED,
  "call:private-op-reads-principal@operation": SUPPORTED,
  "op:document-residue@aggregate": SUPPORTED,
  "stamp:reads-aggregate@document": SUPPORTED,
};

/** The table for a static-bundle backend: it renders no ui framework. */
const STATIC_HOST_BACKEND_ROWS: Readonly<Record<BackendConstruct, CapabilityVerdict>> = {
  "stmt:requires@event-sourced-create": ES_CREATE_REQUIRES_REFUSED,
  "effect:mutate-held-row@command-body": SUPPORTED,
  // A tenant-scoped event stream is stamped, scoped and carried as event
  // metadata (the node MikroORM event store is refused in `ADAPTER_REFUSALS`).
  "capability:tenantOwned@event-sourced": SUPPORTED,
  "capability:shareable@aggregate": SUPPORTED,
  ...UNREALIZED_RESOURCES,
  ...COMMON_PAIRS,
  ...METHOD_BODY_ROWS,
};

const NODE_BACKEND: TargetCapabilityTable = {
  backend: {
    ...STATIC_HOST_BACKEND_ROWS,
    // The save inserts the events and then dispatches outside the transaction.
    "publish:event-sourced@broker-channel": refused("feature-composition-broken"),
  },
  compositions: COMMON_COMPOSITIONS,
};

const DOTNET_BACKEND: TargetCapabilityTable = {
  backendScopes: ["names:csharp-members"],
  backend: {
    ...STATIC_HOST_BACKEND_ROWS,
    // The event save and the dispatcher's outbox write are two `SaveChangesAsync`.
    "publish:event-sourced@broker-channel": refused("feature-composition-broken"),
  },
  compositions: COMMON_COMPOSITIONS,
};

const PYTHON_BACKEND: TargetCapabilityTable = {
  backend: STATIC_HOST_BACKEND_ROWS,
  compositions: COMMON_COMPOSITIONS,
};

const JAVA_BACKEND: TargetCapabilityTable = {
  backend: STATIC_HOST_BACKEND_ROWS,
  compositions: COMMON_COMPOSITIONS,
};

const REACT_CAPABILITIES: TargetCapabilityTable = {
  ui: {
    frameworks: ["react"],
    constructs: JS_FRONTEND_UI,
    scopes: ["props:typescript", "forms:shared-local-scope"],
  },
};

/** A backend construct one persistence ADAPTER cannot realize yet, although the
 *  backend's default adapter (the row in `TARGET_CAPABILITIES`) does — the
 *  adapter axis of the same table.  `loom.target-unsupported` reads these per
 *  deployable, matched on its platform family and `persistence:` knob. */
export interface AdapterRefusal {
  family: "node" | "dotnet" | "elixir" | "python" | "java";
  persistence: string;
  construct: BackendConstruct;
  verdict: CapabilityVerdict & { verdict: "refused" };
}

export const ADAPTER_REFUSALS: readonly AdapterRefusal[] = [
  // The MikroORM event store does not carry a stream's tenant yet (#4686).
  {
    family: "node",
    persistence: "mikroorm",
    construct: "capability:tenantOwned@event-sourced",
    verdict: { verdict: "refused", slug: "tenant-owned-event-sourced" },
  },
];

/** Every target's table.  The `static` PLATFORM is React's UI-only alias and
 *  shares its table; a ui whose resolved FRAMEWORK is spelled `static` is not
 *  in any `frameworks` list, so its UI constructs are refused fail-closed. */
export const TARGET_CAPABILITIES: Readonly<Record<Platform, TargetCapabilityTable>> = {
  node: NODE_BACKEND,
  dotnet: DOTNET_BACKEND,
  python: PYTHON_BACKEND,
  java: JAVA_BACKEND,
  elixir: {
    ui: {
      frameworks: ["phoenixLiveView"],
      constructs: {
        // A TanStack row model; LiveView could only fork it (D-DATAGRID-TARGETS).
        "primitive:DataGrid@body": refused("datagrid"),
        // Inline SVG over rows already in a server assign.
        "primitive:Chart@body": SUPPORTED,
        // The HEEx `Money` renders the value's own text and reads neither
        // `decimals:` nor `format:`.
        "primitive:Money-locale-format@body": refused("money-locale-format"),
        // An in-process `load_<agg>_history/2` in the same OTP app.
        "read:entity-history@body": SUPPORTED,
        "stmt:match-await-standard-op@action": SUPPORTED,
        "return:payload-or-error@api-client": SUPPORTED,
        ...COMMON_OWNED,
        // `renderModal` handles the controlled op-form shape.
        "primitive:Modal-open-op-form@body": SUPPORTED,
        // The page gate renders through the general HEEx expression renderer.
        "gate:page-requires-full-expr@page": SUPPORTED,
        // `heex-walker-core.ts` `renderStmt` has arms for all three kinds.
        "stmt:backend-body@ui-body": SUPPORTED,
        // A LiveView deployable is fullstack: its session guard is `LiveAuth`,
        // not a generated `auth: ui` wrapper.
        "auth:ui-guard@deployable": owned("loom.auth-ui-unsupported-framework"),
      },
      scopes: [
        "components:hoisted-into-host",
        "ui-body:binds-this",
        "stores:server-process",
        "reads:in-process",
      ],
      // Page-body primitives whose HEEx rendering needs the host LiveView to
      // supply an assign, an upload or a `handle_event` clause.  A name scan
      // (`src/ir/` cannot import the generator); pinned by
      // `heex-component-host-state.test.ts`, which generates each member.
      hostStatePrimitives: [
        "CreateForm",
        "OperationForm",
        "WorkflowForm",
        "DestroyForm",
        "QueryView",
        "Table",
        "FileUpload",
        "Chart",
      ],
    },
    backend: {
      "stmt:requires@event-sourced-create": SUPPORTED,
      "effect:mutate-held-row@command-body": SUPPORTED,
      "capability:tenantOwned@event-sourced": SUPPORTED,
      "capability:shareable@aggregate": SUPPORTED,
      ...UNREALIZED_RESOURCES,
      ...COMMON_PAIRS,
      // The changeset casts the nested value object inline and never runs its
      // invariant.
      "invariant:nested-valueobject@valueobject": refused("feature-composition-broken"),
      // A context operation persists inside its own function, and every
      // with-chain site matches its `{:ok, _}` away, so a bound result has no
      // tentative save to drop on the error arm.
      "call:bound-mutating@entry-body": owned("loom.elixir-bound-mutating-call-unsupported"),
      // The workflow and handler emitters have no tagged result and no
      // rollback seam for an error answer.
      "return:expected-failure@entry-point": owned("loom.elixir-entry-result-unsupported"),
      // An Elixir body has no early exit, guards hoist into a leading
      // `with` chain, and the success value travels bare in `{:ok, value}`.
      "stmt:match-arm-shape@body": owned("loom.elixir-match-stmt-unsupported"),
      // The Ecto changeset validates the applied struct, which holds a
      // reference collection as `[]` and cannot call out.
      "invariant:unvalidated-shape@aggregate": owned("loom.elixir-invariant-unenforced"),
      // An operation is a context function answering a tagged tuple, which
      // has no implicit unwrap.
      "call:op-self-non-tail@operation": owned("loom.vanilla-op-call-position"),
      // A private operation is a `defp` struct transform that takes no actor.
      "call:private-op-reads-principal@operation": owned("loom.vanilla-op-call-actor"),
      "op:document-residue@aggregate": owned("loom.vanilla-document-unsupported"),
      // The document write seam merges stamps into the request attrs before
      // any struct exists.
      "stamp:reads-aggregate@document": owned("loom.stamp-reads-aggregate-unsupported"),
    },
    backendScopes: ["fields:part-implicit-timestamps"],
    compositions: {
      ...COMMON_COMPOSITIONS,
      // A declared create on a document aggregate demands the defaulted
      // `isDeleted` in its payload, so the create answers 422.
      "persistence:document+capability:softDeletable": BROKEN,
    },
  },
  react: REACT_CAPABILITIES,
  static: REACT_CAPABILITIES,
  vue: {
    ui: {
      frameworks: ["vue"],
      constructs: JS_FRONTEND_UI,
      scopes: ["props:typescript", "forms:shared-local-scope", "forms:duplicate-locals-deduped"],
    },
  },
  svelte: {
    ui: {
      frameworks: ["svelte"],
      constructs: JS_FRONTEND_UI,
      scopes: ["props:typescript", "forms:shared-local-scope"],
    },
  },
  angular: {
    ui: {
      frameworks: ["angular"],
      // Angular forks the modal primitive and renders the form beside `open:`.
      constructs: {
        ...JS_FRONTEND_UI,
        "primitive:Modal-open-op-form@body": SUPPORTED,
      },
      scopes: [
        "props:typescript",
        "components:deferral-filtered",
        "components:extern-children-dropped",
      ],
    },
  },
  // Fable compiles F# to JavaScript, so Feliz binds `@tanstack/table-core`.
  feliz: {
    ui: {
      frameworks: ["feliz"],
      constructs: {
        ...JS_FRONTEND_UI,
        // Feliz forks the modal primitive and renders the operation form.
        "primitive:Modal-open-op-form@body": SUPPORTED,
        // The Elmish update renderer projects a `match await` only for a
        // DECLARED instance operation; a standard op reaches its per-statement
        // arm, which throws.
        "stmt:match-await-standard-op@action": refused("match-await-standard-op"),
        "return:payload-or-error@api-client": SUPPORTED,
        // The Feliz generator projects async effects on pages only.
        "stmt:match-await@component-action": owned("loom.feliz-async-effect-unsupported"),
      },
      scopes: [
        "components:deferral-filtered",
        "props:fsharp-records",
        "stores:persist-fsharp-codec",
        "reads:derived-find-path",
      ],
    },
  },
  flutter: {
    ui: {
      frameworks: ["flutter"],
      constructs: {
        // The shipping target is a native build with no JS runtime, so no
        // TanStack (D-DATAGRID-TARGETS).
        "primitive:DataGrid@body": refused("datagrid"),
        // A `CustomPainter` over rows the client has already decoded.
        "primitive:Chart@body": SUPPORTED,
        // `LoomMoney.display` splices the digit string into `intl`'s pattern.
        "primitive:Money-locale-format@body": SUPPORTED,
        "read:entity-history@body": SUPPORTED,
        // `models.dart` declares every payload.
        "return:payload-or-error@api-client": SUPPORTED,
        ...COMMON_OWNED,
        // Flutter has no extern-component hatch.
        "decl:extern-component@ui": owned("loom.user-component-deferred-target"),
        // A Riverpod `Notifier` resolves an awaited op through declared
        // operations only.
        "stmt:match-await-standard-op@action": owned("loom.flutter-action-body-unsupported"),
        // An async effect needs the page shell's notifier and route id, so the
        // component emitter filters out a component that carries one.
        "stmt:match-await@component-action": owned("loom.flutter-async-effect-unsupported"),
      },
      scopes: [
        "components:deferral-filtered",
        "stores:persist-dart-codec",
        "reads:derived-find-path",
      ],
      // Every page primitive renders; the gate stays armed for the day one is
      // added back.
      unrenderedPrimitives: [],
    },
  },
};

/** The verdict for a UI construct on a framework.  A framework no target
 *  renders is REFUSED (fail-closed) with the construct's own reason, or takes
 *  the owned row's fallback. */
export function uiCapability(framework: string, construct: UiConstruct): CapabilityVerdict {
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    if (table.ui?.frameworks.includes(framework)) return table.ui.constructs[construct];
  }
  if (construct in UI_CONSTRUCT_REFUSAL) {
    return refused(UI_CONSTRUCT_REFUSAL[construct as RefusableUiConstruct]);
  }
  return OWNED_FALLBACK[construct as OwnedUiConstruct];
}

/** Like {@link uiCapability}, but a name that is a PLATFORM (`static`,
 *  `elixir`) rather than a framework resolves through that platform's table —
 *  for the callers that fall back to `d.platform` when a ui states no
 *  framework. */
export function uiCapabilityOfFrameworkOrPlatform(
  frameworkOrPlatform: string,
  construct: UiConstruct,
): CapabilityVerdict {
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    if (table.ui?.frameworks.includes(frameworkOrPlatform)) return table.ui.constructs[construct];
  }
  const viaPlatform = (TARGET_CAPABILITIES as Record<string, TargetCapabilityTable | undefined>)[
    frameworkOrPlatform
  ]?.ui;
  if (viaPlatform) return viaPlatform.constructs[construct];
  return uiCapability(frameworkOrPlatform, construct);
}

/** The ui frameworks whose verdict on `construct` is `owned`. */
export function frameworksOwned(construct: UiConstruct): ReadonlySet<string> {
  const out = new Set<string>();
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    const ui = table.ui;
    if (ui?.constructs[construct].verdict !== "owned") continue;
    for (const fw of ui.frameworks) out.add(fw);
  }
  return out;
}

/** The ui frameworks that carry applicability fact `scope`. */
export function frameworksWithScope(scope: UiScope): ReadonlySet<string> {
  const out = new Set<string>();
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    const ui = table.ui;
    if (!ui?.scopes?.includes(scope)) continue;
    for (const fw of ui.frameworks) out.add(fw);
  }
  return out;
}

/** The ui section of a PLATFORM's own table — what a deployable on that
 *  platform renders itself — or `undefined` for a platform that renders no ui
 *  framework of its own (or an unknown name). */
export function platformUi(platform: string): TargetCapabilityTable["ui"] {
  if (!Object.hasOwn(TARGET_CAPABILITIES, platform)) return undefined;
  return TARGET_CAPABILITIES[platform as Platform].ui;
}

/** True when a platform's own ui table carries applicability fact `scope`. */
export function platformHasUiScope(platform: string, scope: UiScope): boolean {
  return platformUi(platform)?.scopes?.includes(scope) ?? false;
}

/** True when a platform's own ui table hands `construct` to the check that
 *  raises `code` — the check uses it to decide which deployables it gates. */
export function platformUiOwnedBy(platform: string, construct: UiConstruct, code: string): boolean {
  const v = platformUi(platform)?.constructs[construct];
  return v?.verdict === "owned" && v.code === code;
}

/** True when a platform's own table carries backend applicability fact
 *  `scope`. */
export function platformHasBackendScope(platform: string, scope: BackendScope): boolean {
  if (!Object.hasOwn(TARGET_CAPABILITIES, platform)) return false;
  return TARGET_CAPABILITIES[platform as Platform].backendScopes?.includes(scope) ?? false;
}

/** True when a platform's own table hands backend `construct` to the check
 *  that raises `code` — the check uses it to decide which deployables it
 *  gates. */
export function platformBackendOwnedBy(
  platform: string,
  construct: BackendConstruct,
  code: string,
): boolean {
  if (!Object.hasOwn(TARGET_CAPABILITIES, platform)) return false;
  const v = TARGET_CAPABILITIES[platform as Platform].backend?.[construct];
  return v?.verdict === "owned" && v.code === code;
}

/** The verdict for a backend construct on a backend platform, or `undefined`
 *  for a platform that hosts no backend. */
export function backendCapability(
  platform: Platform,
  construct: BackendConstruct,
): CapabilityVerdict | undefined {
  return TARGET_CAPABILITIES[platform]?.backend?.[construct];
}

/** The ui frameworks that render `construct` — for an emitter that must pick a
 *  path per framework (and keep it in step with the validator). */
export function frameworksSupporting(construct: UiConstruct): ReadonlySet<string> {
  const out = new Set<string>();
  for (const table of Object.values(TARGET_CAPABILITIES)) {
    const ui = table.ui;
    if (ui?.constructs[construct].verdict !== "supported") continue;
    for (const fw of ui.frameworks) out.add(fw);
  }
  return out;
}

/** The backend platforms that render `construct`. */
export function backendsSupporting(construct: BackendConstruct): ReadonlySet<string> {
  const out = new Set<string>();
  for (const [platform, table] of Object.entries(TARGET_CAPABILITIES)) {
    if (table.backend?.[construct].verdict === "supported") out.add(platform);
  }
  return out;
}

/** The verdict for a feature tuple on a backend platform, or `undefined` for a
 *  platform that hosts no backend. */
export function compositionCapability(
  platform: Platform,
  tuple: FeatureTuple,
): CompositionVerdict | undefined {
  return TARGET_CAPABILITIES[platform]?.compositions?.[tuple];
}
