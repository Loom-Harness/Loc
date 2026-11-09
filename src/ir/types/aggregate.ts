import type { ThrowKindName } from "../../util/intrinsic-matchers.js";
import type { ExprIR } from "./expr.js";
import type {
  ApplyIR,
  AssociationIR,
  ContainmentIR,
  CreateInputFieldIR,
  DerivedIR,
  EntityPartIR,
  FieldIR,
  FunctionIR,
  InvariantIR,
  OperationIR,
  UniqueKeyIR,
} from "./members.js";
import type { OriginRef } from "./origin.js";
import type { StmtIR } from "./stmt.js";
import type { Sourced } from "./types.js";

export interface AggregateIR extends Sourced {
  name: string;
  fields: FieldIR[];
  contains: ContainmentIR[];
  derived: DerivedIR[];
  invariants: InvariantIR[];
  /** Uniqueness invariants declared via `unique (...)`
   * (uniqueness-and-indexes.md).  Populated by lowering; empty when the
   * aggregate declares none.  The migrations builder derives a DB unique
   * index (partial under `softDeletable`) from each entry; backends derive
   * the constraint-name → field map for the 23505 → 409 conflict mapping. */
  uniqueKeys: UniqueKeyIR[];
  functions: FunctionIR[];
  /** Mutate-kind actions only (the legacy `operation` keyword).
   * `create` / `destroy` actions are intentionally NOT here — they live
   * in `creates` / `destroys` so the ~50 existing operation consumers
   * (route emitters, OpenAPI, page-objects, …) see only mutate-style
   * endpoints. */
  operations: OperationIR[];
  /** `kind: "create"` lifecycle factory actions.  Populated by lowering;
   * empty array when the aggregate declares none.  No backend consumes it
   * yet. */
  creates: OperationIR[];
  /** `kind: "destroy"` lifecycle terminator actions.  Populated by
   * lowering; empty array when none. */
  destroys: OperationIR[];
  parts: EntityPartIR[];
  tests: TestIR[];
  /** Reified create-input contract — the client-suppliable field set with
   * per-field required-ness.  Populated by `enrichLoomModel`
   * (`buildCreateInput`); the single source backends consume instead of
   * re-deriving the create payload.  See {@link CreateInputFieldIR}. */
  createInput?: CreateInputFieldIR[];
  /** Many-to-many associations derived from `Target id[]` fields.
   * Populated by `enrichLoomModel`; one entry per reference-collection
   * field.  Empty array when the aggregate has none. */
  associations?: AssociationIR[];
  /** Filter predicates contributed by `filter <expr>` declarations
   * (hand-written or macro-emitted) on the aggregate, plus any
   * propagated from the enclosing context.  Each entry is a lowered
   * Loom expression evaluated against a lambda-bound row in the
   * query layer.  Backends install them via their query-filter API
   * (.NET: per-capability `HasQueryFilter` loops in OnModelCreating;
   * Drizzle: query wrapper; Ecto: base query helper).
   *
   * Composes additively — N filters become N conjunctively-applied
   * predicates at the storage layer. */
  contextFilters: ExprIR[];
  /** Per-`contextFilters` entry: set when that filter expression is
   * *exactly* one named `criterion` reference — index-aligned with
   * `contextFilters`, `undefined` for composed/anonymous predicates.
   * Mirrors `FindIR.criterionRef` (the predicate itself stays inlined in
   * `contextFilters`, so non-reifying consumers are unaffected).  Backends
   * that reify capability filters consume this — the Hono repository calls
   * the module-level `<name>Criterion` predicate fn instead of re-inlining
   * the body (reified-criteria.md, the anonymous-`filter` row). */
  contextFilterRefs: ({ name: string; args: ExprIR[] } | undefined)[];
  /** Per-`contextFilters` entry: the name of the capability that contributed
   * the filter (e.g. `softDeletable`), or `undefined` for a hand-written /
   * context-level bare filter — index-aligned with `contextFilters`, set by the
   * expander on the spliced `FilterDecl` and threaded through lowering.  This is
   * the provenance the `ignoring <Cap>` bypass surface resolves against: a
   * backend maps a bypassed capability name to the predicate(s) it owns.
   * `contextFilterRefs` and this array always have exactly one slot per
   * `contextFilters` entry; every writer that appends a filter appends both. */
  contextFilterOrigins: (string | undefined)[];
  /** The WRITE-scope predicate an INSTANCE mutation's command load must satisfy
   *  (`https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/authorization-phase3.md`).  Derived in enrichment from the aggregate's `policy` read + write levels,
   *  and set **only when the write scope is strictly narrower than the read
   *  scope** — i.e. when the mutation load (which reuses the read filter on
   *  every backend) must be tightened below what a read can see.  Two shapes:
   *  the flat `tenantId ==` floor (`write local` under a widened read) or the
   *  `deep` descendant-or-self sentinel (`write deep` under a `global` read).
   *  `undefined` = the command load already matches the write scope, so the
   *  mutation seam stays byte-identical.  Uses `currentUser`, so backends
   *  render it through their existing principal-filter path. */
  writeScopeFilter?: ExprIR;
  /** Lifecycle stamping rules contributed by `stamp onCreate { ... }`
   * / `stamp onUpdate { ... }` declarations (hand-written or
   * macro-emitted) on the aggregate, plus any propagated from the
   * enclosing context.  Each rule lists field/value pairs to assign
   * at the matching lifecycle event.  Backends iterate this in their
   * per-entity stamping path (.NET: registry-driven
   * SaveChangesInterceptor; Drizzle: insert/update middleware;
   * Ecto: changeset functions).
   *
   * Composes additively — N stamping declarations yield N rule sets
   * concatenated per event. */
  contextStamps: ContextStampIR[];
  /** Typed capabilities this aggregate implements (via `with <Cap>` /
   * `implements <Cap>`, at aggregate or context scope).  Sorted + deduped at
   * lowering time; empty when the aggregate implements none.  Capability
   * application has already spliced the fields/filter/stamp by this point — this
   * is the surviving identity record, consumed by capability-aware emission
   * (marker interfaces `I<Cap>` and the stamp-interceptor dedup —
   * https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/capability-emission-dedup.md) and by tooling
   * (find-implementors). */
  capabilities: readonly string[];
  /** Pointer to the `derived display: string` field, if the
   * aggregate declared one.  Populated by `enrichLoomModel`.
   * When set, `string(aggregate)` and implicit `string + aggregate`
   * compile by lowering to a member access on this derived; when
   * unset, both are validator errors. */
  displayDerived?: DerivedIR;
  /** Pointer to the `derived inspect: string` field; always populated
   * after enrichment (auto-injected by the `defaultInspect()` macro
   * when the user didn't declare one).  Read by the host-language
   * debug-string emitters (TS `toString()`/`util.inspect.custom`,
   * C# `ToString()` override, Elixir `defimpl Inspect`). */
  inspectDerived?: DerivedIR;
  /** Primary truth kind declared on the aggregate's header via the
   * `persistedAs: …` modifier (D-DOCUMENT-AXIS; replaces the former
   * body `persistenceStrategy:` clause).  Values align to the
   * `dataSource` `kind` set — `state` → `kind: state`, `eventLog` →
   * `kind: eventLog` — so `resolve-datasource.ts` is an identity.
   * Omitted in the IR when not declared in source (default `state`);
   * the IR preserves source fidelity for the AST → IR → printer
   * round-trip. */
  persistedAs?: PersistenceStrategy;
  /** Saving shape of the materialised read model / snapshot
   * (D-DOCUMENT-AXIS, `shape: relational|embedded|document` header
   * modifier).  One of three points on the relational↔document
   * spectrum (see {@link SavingShape}).  Omitted when not declared
   * (default `relational`); a per-projection `dataSource shape:` knob
   * can override it (see {@link effectiveSavingShape}). */
  savingShape?: SavingShape;
  /** Event-fold appliers declared via `apply(e: Event) { … }` members.
   * One per event type the aggregate folds.  Only meaningful on
   * event-sourced aggregates (`persistedAs: eventLog`); the discipline
   * validator (phase ⑦) rejects appliers on state-sourced aggregates and
   * requires a matching applier for every emitted event.  Empty when
   * the aggregate declares none. */
  appliers: ApplyIR[];
  /** Aggregate-inheritance (aggregate-inheritance.md, I1).  `true` for an
   * `abstract aggregate` base — never instantiated, no repository, emits no
   * table of its own.  `false` for ordinary/concrete aggregates. */
  isAbstract: boolean;
  /** Tenancy header flag (tenancy.md).  `true` for an
   * `crossTenant aggregate X { … }` — shared reference data that opts out
   * of the tenant filter under a `tenancy by` system.  `false`
   * when not declared.  The aggregate's tenancy *stance* (owned / cross /
   * unmarked / registry) is classified on demand by the phase-⑦ tenancy
   * checks from this flag + capabilities + `SystemIR.tenancy` — never
   * stamped here (derive-don't-stamp). */
  crossTenant: boolean;
  /** Name of the `abstract` base this aggregate `extends`, if any.  Always
   * resolves to an abstract aggregate (enforced by the validator).  Field
   * inheritance into the concrete's `wireShape` is an I2 concern; in I1 this
   * only records the declared relationship. */
  extendsAggregate?: string;
  /** Inheritance table layout declared via the `inheritanceUsing: …` header
   * modifier (D-RENAME).  `sharedTable` = TPH (one table + `kind`
   * discriminator); `ownTable` = TPC (table per concrete).  Omitted when not
   * declared; only meaningful on an `abstract` base or an `extends` subtype.
   * A `persistedAs: eventLog` / `shape: document` concrete of a `sharedTable`
   * base is forced to `ownTable` (D-ES-TPH; enforced by the validator). */
  inheritanceUsing?: InheritanceLayout;
}

/** Inheritance table layout — the aggregate-inheritance layout axis
 *  (D-RENAME, amended by D-DOCUMENT-AXIS §4).  Spelled in source as the
 *  `inheritanceUsing: sharedTable|ownTable` header paren modifier.
 *    - `sharedTable` — TPH: the whole hierarchy shares one table with a
 *      `kind` discriminator column; `Party id` refs target that base table.
 *    - `ownTable` — TPC: one table per concrete, no base table; bare
 *      `Party id` refs to the base are forbidden (FK target ambiguous). */
export type InheritanceLayout = "sharedTable" | "ownTable";

/** How an aggregate's hierarchy is physically laid out — the saving-shape
 *  axis of D-DOCUMENT-AXIS (orthogonal to {@link PersistenceStrategy},
 *  the truth-kind axis).  Three points on the relational↔document
 *  spectrum:
 *    - `relational` — table-per-entity: root columns + child tables +
 *      join tables.  The default.  Queryable everywhere.
 *    - `embedded` — queryable root row (its scalar / `X id` fields stay
 *      columns) with contained parts folded into JSONB columns; no child
 *      tables.  EF owned-types `.ToJson()`, Drizzle jsonb column, Phoenix
 *      embedded schemas.
 *    - `document` — the whole aggregate (root included) serialised as one
 *      opaque JSONB blob (`id, data, version`); schema-flexible,
 *      load-by-id (Marten-style).  Not every backend supports it (see
 *      `PLATFORM_SAVING_SHAPES` in `util/platform-axes.ts`). */
export type SavingShape = "relational" | "embedded" | "document";

/** The aggregate's primary truth kind.  Named to match the
 *  `dataSource` `kind` vocabulary (`state` / `eventLog`); surfaced in
 *  source as `persistedAs: state|eventLog`. */
export type PersistenceStrategy = "state" | "eventLog";

/** A single stamping rule attached to an aggregate.  Backends
 * dispatch on `event` and emit assignments for the matching
 * lifecycle moment.  Values are arbitrary lowered Loom
 * expressions — `currentUser`, `now()`, constants, derived
 * expressions, etc. — translated by the backend's normal
 * expression renderer. */
export interface ContextStampIR {
  event: "create" | "update";
  assignments: ContextStampAssignmentIR[];
}

export interface ContextStampAssignmentIR {
  /** Field name on the aggregate that gets stamped.  Must match a
   * declared field (validated when the IR is consumed; an unknown
   * field is a generator-side error). */
  field: string;
  /** Lowered expression whose result is assigned to `field`. */
  value: ExprIR;
}

export interface TestIR extends Sourced {
  name: string;
  statements: TestStmtIR[];
  /** Traceability back-link: the `verifies <TC-id>` clause
   *  naming the TestCase this executable test realises.  Undefined when
   *  the test declares no link.  Enrichment uses it to mark a TestCase
   *  as backed by an executable test. */
  verifiesTestCase?: string;
  /** The `as { … }` principal the test runs as — the claims it overrides on
   *  the dev-stub principal.  Undefined when the test declares no clause (it
   *  then runs as the dev-stub principal unchanged).  Only a context
   *  integration test carries one (`loom.test-principal-placement`). */
  principal?: TestPrincipalIR;
}

/** A test's declared principal: an ordered claim map keyed by `user { … }`
 *  field name.  Every value is fixed data — a string, or a list of strings
 *  for a `string[]` claim — so each backend renders it as a literal of the
 *  claim's declared type, read off the system's user block. */
export interface TestPrincipalIR extends Sourced {
  claims: TestPrincipalClaimIR[];
}

export interface TestPrincipalClaimIR extends Sourced {
  /** The `user { … }` field the claim sets. */
  name: string;
  value: string | readonly string[];
}

export type TestStmtIR =
  | StmtIR
  | { kind: "expect"; expr: ExprIR; source: string }
  /** A bare `as { … }` body line: the statements after it run as this
   *  principal (the dev-stub identity with these claims spread over it),
   *  until the next such line.  Context integration and api e2e tests only
   *  (`loom.test-principal-placement` / `loom.e2e-principal-ui`). */
  | { kind: "principal"; principal: TestPrincipalIR }
  | {
      kind: "expect-throws";
      expr: ExprIR;
      source: string;
      /** `toThrow(<status>)` — the HTTP status of a live rejection, e2e only. */
      status?: number;
      /** `toThrow(<kind>)` — WHICH rung of the domain floor rejected the call,
       *  unit tier only (`loom.e2e-throw-kind-invalid` refuses it in an
       *  e2e body).  Absent for the bare form, which asserts only "it threw"
       *  and therefore cannot tell a deleted `precondition` from the
       *  `invariant` that threw in its place (audit 2026-09-13 F11).
       *  Mutually exclusive with `status` by grammar: the `ThrowKind` slot and
       *  the `CallArg` list are alternatives on the same suffix. */
      throwKind?: ThrowKindName;
      /** The `expect(...)` statement's own span, present with `throwKind` —
       *  an IR-phase diagnostic about the rung points at the assertion that
       *  wrote it rather than at the enclosing test or declaration. */
      origin?: OriginRef;
    };
