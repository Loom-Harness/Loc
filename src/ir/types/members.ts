import type { ExprIR } from "./expr.js";
import type { Messaged, StmtIR } from "./stmt.js";
import type { SensitivityTags, Sourced, TypeIR } from "./types.js";
import type { StateFieldIR } from "./ui.js";

/** A param's default seeds the scaffolded operation / workflow form's input
 *  (a default the target UI can't evaluate falls back to the type-zero seed);
 *  it is lowered only where the site had an env to resolve it (operation /
 *  create / destroy / workflow-start / function params) and may reference
 *  `this` (the target instance) for an operation param. */
export interface ParamIR extends Defaulted {
  name: string;
  type: TypeIR;
}

/** A lowered default-value expression (`name: T = <expr>`), fully resolved
 *  like any other `ExprIR`.  Absent where the source declared none (and on
 *  events / views, which never lower one). */
export interface Defaulted {
  default?: ExprIR;
}

/** A `mask unless <expr>` read-mask predicate (authorization.md §5) — a
 *  `currentUser`-only bool (+ constants, never the row, like a `requires`
 *  gate).  The field's wire value is REDACTED (null) UNLESS it holds; every
 *  wire consumer that redacts reads it, and it drives the wire-spec
 *  `fieldCapabilities` entry.  Absent = the field is always visible. */
export interface Masked {
  maskUnless?: ExprIR;
}

/** A declared `: T` return type (exception-less.md) — an `or`-union or a
 *  plain type.  When present the body produces the value via a `return` and
 *  the route translates an `error`-variant result to a ProblemDetails
 *  status.  Absent ⇒ no `: T` clause (a mutation operation, a `: void`-
 *  equivalent handler or create).  Shared by operations, domain-service
 *  operations and the workflow entry points. */
export interface Returns {
  returnType?: TypeIR;
}

/** Resolved access role for a stored field.  Controls the field's
 * presence in create/update inputs, the update wire envelope, and
 * API read exposure.  See `src/ir/enrich/enrichments.ts` for resolution
 * rules.
 *
 *   editable  — default; client may read and write freely
 *   immutable — client may write on create only; read otherwise
 *   managed   — server lifecycle owns the value; client read-only
 *   token     — server-managed but echoed by the client on update
 *               (identity, concurrency); always non-nullable
 *   internal  — views may read; never exposed via API; no client input
 *   secret    — client may write (create + update); never disclosed
 *               in any read */
export type FieldAccess = "editable" | "immutable" | "managed" | "token" | "internal" | "secret";

/** A field's `default` is consumed when synthesising a create for an
 *  aggregate with no explicit one. */
export interface FieldIR extends Sourced, Defaulted, Masked {
  name: string;
  type: TypeIR;
  optional: boolean;
  /** True iff the source declared this property with the `provenanced`
   * modifier.  Every assignment statement (`:=`/`+=`/`-=`) targeting such
   * a field becomes a per-site rule snapshot; see `ProvSite`.  The provenance
   * runtime is emitted on the Hono (`node`), .NET (`dotnet`) and `elixir`
   * backends — hosting a provenanced context on another surface (e.g.
   * react) is rejected at validate time
   * (`loom.provenanced-backend-unsupported`, `validateProvenancedStorage`)
   * rather than silently dropping the trail. */
  provenanced?: boolean;
  /** Sensitivity tags declared at the property site via `sensitive(<tag>,
   * ...)` — sorted, deduped; omitted when the field declared none.  The only
   * home of the tags (no `TypeIR` carries them).  Its one consequence is the
   * redacted synthesized `inspect`; the wire is redacted by `mask unless`
   * (D-SENSITIVE-INSPECT-ONLY). */
  sensitivity?: SensitivityTags;
  /** Resolved access role.  Populated by `enrichLoomModel`; lowering
   * leaves this undefined when the source declared no modifier so
   * enrichment can apply its precedence (declared > default).
   * After enrichment every `FieldIR` carries a value. */
  access?: FieldAccess;
  /** Where `access` came from.  Diagnostic-only: used by the validator
   * to phrase conflict messages and by the wire-spec diff to explain
   * the field's role.  Same nullability as `access`. */
  accessSource?: "declared" | "default" | "stamp";
}

/** One entry in an aggregate's reified **create-input contract** — the
 *  single source of truth every create surface derives from (wire DTO,
 *  domain factory, page-object fill, OpenAPI, cross-backend parity).
 *  Built once by `enrichLoomModel` (see `buildCreateInput`) so every
 *  backend reads the same field set AND the same per-field required-ness,
 *  instead of each re-deriving it — the divergence the per-backend
 *  required-set hacks papered over. */
export interface CreateInputFieldIR {
  field: FieldIR;
  /** Whether the client MUST supply this field on create.  A field is
   *  required input iff it is non-optional, carries no explicit default,
   *  and has no language-defined implicit default (a bare `bool` defaults
   *  to `false`).  A default — explicit or implicit — collapses a field
   *  onto the same "client may omit" axis as `optional`; whether the
   *  *aggregate* gets a create at all is a separate, invariant-based
   *  decision and does not consult this flag. */
  requiredInput: boolean;
}

export interface ContainmentIR {
  name: string;
  partName: string;
  collection: boolean;
  /** Singular containments only — when true, the part may be absent at
   *  runtime; backends serialise it as a nullable wire field.  Validators
   *  reject the combination `collection && optional` (an empty list already
   *  encodes absence). */
  optional: boolean;
}

/** A many-to-many association derived from an aggregate field whose
 * type is a collection of references to another aggregate
 * (`field: Target id[]`).  Populated by `enrichLoomModel`; backends
 * that persist relationally emit a join table from this rather than
 * re-deriving it.  See `src/ir/enrich/enrichments.ts`. */
export interface AssociationIR {
  /** The owning aggregate's field name (`party`). */
  fieldName: string;
  /** The aggregate that declares the field (`Trainer`). */
  ownerAgg: string;
  /** The referenced aggregate (`Pokemon`). */
  targetAgg: string;
  /** Join-table name, `snake(owner)_snake(field)` — distinct per
   * field even when several fields target the same aggregate. */
  joinTable: string;
  /** FK column pointing at the owner row, `snake(owner)_id`. */
  ownerFk: string;
  /** FK column pointing at the target row, `snake(target)_id`. */
  targetFk: string;
}

export interface DerivedIR {
  name: string;
  type: TypeIR;
  expr: ExprIR;
}

/** A named, typed page/component event handler — `action next(p: T) { … }`
 *  (named-actions-and-stores.md, Proposal A Stage 1).  The named form of
 *  today's anonymous handler lambda: a stable identity, a typed payload
 *  param list (declared by the action; the call-site primitive supplies the
 *  value), and a statement block reusing the existing `StmtIR` set — no new
 *  statement semantics.  Each JSX frontend hoists one named handler function
 *  per action at the page/component top; a bare `onSubmit: <name>` reference
 *  binds the handler instead of an inline arrow. */
export interface ActionIR {
  name: string;
  /** Declared payload params (zero or one in v1 — a Form `into:` two-way
   *  binding ⇒ nullary; a Form value / List row id ⇒ a single payload
   *  param).  The validator gates arity + assignability against what the
   *  call-site primitive supplies. */
  params: ParamIR[];
  /** Handler body — the same `StmtIR` block an anonymous handler lambda
   *  lowers to (`:=` / `+=` / `-=` / `let` / calls / `navigate` / `emit`). */
  body: StmtIR[];
}

/** A shared client-side state container — `store Cart { state {…} action …}`
 *  (named-actions-and-stores.md §3, Stage 5).  A top-level `ui` member, sibling
 *  to page/component, holding named state + named actions.  Referenced purely
 *  by DOTTED qualified name from a page/component body (`Cart.lines` read,
 *  `Cart.clear()` call) — there is no `use` binding; each consuming page's
 *  store dependency is DERIVED at emit time by walking its already-resolved
 *  refs (the `store-field` refs + `store-action` calls carry the store name).
 *  The `state`/`actions` reuse the exact `StateFieldIR`/`ActionIR` shapes a
 *  page/component carries.  v1 is `"memory"` only — the lifetime ladder has no
 *  grammar surface yet (the keywords would collide with common identifiers; see
 *  the `Store` grammar rule), so `lifetime` is always `"memory"` today.  The
 *  field + the `loom.store-lifetime-unsupported` gate stay so the persistence
 *  follow-up only adds the (soft-keyword-careful) syntax. */
export interface StoreIR {
  name: string;
  /** v1: always `"memory"`.  `"persistLocal"`/`"persistSession"`/`"url"` have
   *  no syntax yet (see `Store` grammar rule) but the IR + validator carry them
   *  so the persistence follow-up only adds the surface.  The validator gate
   *  stays as a defensive check on programmatic IR construction. */
  lifetime: "memory" | "persistLocal" | "persistSession" | "url";
  /** Shared reactive fields — the store twin of `PageIR.state`. */
  state: StateFieldIR[];
  /** Named actions that transition the store state — the store twin of
   *  `PageIR.actions`.  A store action `:=`-writes only its own store state
   *  and may call another store action (acyclic); it may NOT call a page
   *  action (scope-resolution failure) nor a view-scoped effect
   *  (`navigate`/`toast` — `loom.store-action-view-effect`). */
  actions: ActionIR[];
}

/** The user-facing text identity of a NAMED rule (`invariant nameRequired: …`).
 *  Lowering resolves it like any other name (`src/ir/lower/rule-message.ts`), so
 *  no backend re-derives the owner / context a key needs. */
export interface MessageIR {
  /** The rule's identity key `<Ctx>.<Owner>.rule.<name>` — the wire
   *  `errors[].code`, and the catalog key, on every backend. */
  key: string;
  /** The English default: the sentence form of the name ("Name required"), or
   *  the removed `message "…"` text a not-yet-migrated rule still carries.
   *  Emitters read it through `ruleText` so a `locales/en/` override applies. */
  text: string;
}

/** A NAMED invariant's `message` forces the rule onto the wire/refine carrier
 *  (never the native-chain optimisation) so its key and text reach the
 *  frontend inline error, the wire 422 `errors[]`, and the domain floor. */
export interface InvariantIR extends Messaged {
  expr: ExprIR;
  guard?: ExprIR;
  source: string;
  /** When `"server-only"`, the invariant skips wire-boundary
   *  validators (frontend Zod, Hono routes, FluentValidation) even
   *  when its expression would translate cleanly.  Domain-layer
   *  enforcement via `AssertInvariants()` always runs.  Set by
   *  the `@server-only` annotation in the DSL. */
  scope?: "server-only";
}

/** A uniqueness invariant declared via `unique (a, b)` on the aggregate
 *  (uniqueness-and-indexes.md, D-UNIQUE-DOMAIN).  A set-level natural-key
 *  rule — no two rows may share the `columns` tuple.  The compiler DERIVES
 *  its enforcement (never runs it in the per-instance invariant floor): a DB
 *  unique index (partial under `softDeletable`) named deterministically so a
 *  23505 violation can be mapped back to a field → 409.  `columns` are
 *  aggregate field names, validated to exist. */
export interface UniqueKeyIR {
  columns: string[];
  source: string;
}

/** A pure helper over its parameters (domain-services.md).  The body is a
 *  variant — NOT a replacement — so the inlinable expression path is
 *  untouched:
 *    - `{ expr }`  — expression form (`= Expression`); SQL-inlinable.
 *    - `{ stmts }` — block form (rev. 4); `let` + branch + bug-regime
 *                    `throw`/`require`, still PURE.  NOT queryable.
 *  Backends discriminate on `"expr" in body`. */
export type FunctionBodyIR = { expr: ExprIR } | { stmts: StmtIR[] };

export interface FunctionIR {
  name: string;
  params: ParamIR[];
  returnType: TypeIR;
  body: FunctionBodyIR;
}

/** Lifecycle kind of an aggregate action (lifecycle-operations.md).
 * `mutate` is today's `operation` keyword; `create` / `destroy` are the
 * factory / terminator keywords.  The kind tag — not the body syntax —
 * carries the lifecycle asymmetry; bodies are identical across kinds. */
export type OperationKind = "create" | "mutate" | "destroy";

export interface OperationIR extends Sourced, Returns {
  name: string;
  /** Lifecycle kind discriminator.  `"mutate"` for the `operation`
   * keyword.  `agg.operations` only ever holds `"mutate"` actions; `"create"` /
   * `"destroy"` actions live in `agg.creates` / `agg.destroys`. */
  kind: OperationKind;
  /** True for an unnamed canonical `create(...)` / `destroy { }`.  The
   * synthesised `name` is then the keyword itself (`"create"` /
   * `"destroy"`).  Drives the bare-collection-URL route slug derived in
   * the `urlStyle` enrichment.  Only meaningful on create/destroy. */
  canonical: boolean;
  /** HTTP path segment for this action, derived in enrichment from the
   * surfacing api's `urlStyle` (D-URLSTYLE).  `undefined` ⇒ a canonical
   * action ⇒ the bare collection / canonical-id URL.  Otherwise the
   * action `name` (`urlStyle: literal`) or its plural (`resource`).
   * Consumed by every backend's route emitter (`snake(op.routeSlug ??
   * op.name)` on Hono / .NET / elixir, plus the React API client and
   * the OpenAPI emitters). */
  routeSlug?: string;
  visibility: "public" | "private";
  params: ParamIR[];
  statements: StmtIR[];
  /** When true, the body contains preconditions only — the
   * generator emits a wrapper that loads the aggregate, runs the
   * preconditions, dispatches to a user-supplied handler
   * (registered via DI on .NET, via a typed registry on TS),
   * persists, and drains pending events.  The aggregate class
   * itself does NOT get a method body for an extern operation;
   * the user owns the business decision. */
  extern: boolean;
  /** When true, every HTTP invocation of this operation appends an
   * audit record (who/what/when + before/after wire snapshot) to the
   * generated Hono project's in-memory audit sink.  Inert on private
   * operations (no route).  Emission is implemented on the Hono (`node`)
   * backend only — hosting an `audited` operation on another backend is
   * rejected at validate time (`loom.audited-backend-unsupported`,
   * `validateAuditedOperationSupport`) rather than silently recording
   * nothing.  See `https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/audit-and-logging.md`. */
  audited: boolean;
  /** The `when Expr` canCommand state gate (criterion.md, use site 2):
   * a pure predicate over the aggregate's own state, evaluated against
   * the loaded instance before the body runs.  False → 409 Disallowed
   * ProblemDetails; an auto-exposed side-effect-free
   * `GET /{id}/can_<op>` returns `{ allowed }` for UI enablement.
   * Lowered in the aggregate env (operation params are out of scope —
   * `loom.when-references-op-param`); named criteria / aggregate
   * functions inline like any boolean position.  Emitted by every
   * backend. */
  when?: ExprIR;
  /** The `when` predicate's `.ddd` source text (whitespace-collapsed), named
   *  by compile-time diagnostics such as `loom.loop-gate-not-implied`.  Never
   *  on the wire: the 409 detail is constant.  Absent when `when` is. */
  whenSource?: string;
}

/** Event-fold applier — the lowered form of an `apply(e: Event) { … }`
 * member on an event-sourced (`persistedAs: eventLog`) aggregate.  Folds
 * one event type into aggregate state.  Under the event-log discipline
 * the command bodies (`operation`/`create`) only `emit`; the actual
 * state transition lives in the matching applier.  Bodies are pure folds
 * — assignment statements and derivations only (enforced by
 * `validateEventSourcedDiscipline` in phase ⑦); no `emit`, no
 * side-effecting calls.  Not yet consumed by backends (emission is the
 * deferred; the event-store/fold/projection layer).  See
 * https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/proposals/workflow-and-applier.md. */
export interface ApplyIR {
  /** The event type this applier folds, by name (resolved to a context
   * `EventDecl`).  One applier per event type per aggregate. */
  event: string;
  /** The lambda-style parameter name the event instance is bound to in
   * the body (e.g. `e` in `apply(e: OrderPlaced)`).  Resolves as
   * `refKind: "param"` inside the body. */
  param: string;
  /** The fold body — assignments / derivations against `this`. */
  statements: StmtIR[];
}

export interface EntityPartIR {
  name: string;
  parentName: string;
  fields: FieldIR[];
  contains: ContainmentIR[];
  derived: DerivedIR[];
  invariants: InvariantIR[];
  functions: FunctionIR[];
}

/** One field in an aggregate / part / value object's canonical
 * wire shape.  See `src/ir/enrich/enrichments.ts`. */
export type WireFieldSource = "id" | "property" | "containment" | "derived";

/** A `property` wire field carries its originating `FieldIR.maskUnless`. */
export interface WireField extends Masked {
  /** JSON key on the wire.  Stays as the user wrote it in the
   * `.ddd` source — backends that prefer PascalCase / camelCase
   * decide their own casing rule. */
  name: string;
  /** Domain-typed value the wire field carries.  For containment
   * collections, this is `array { element: entity { name } }`; for
   * single containments it's `entity { name }`. */
  type: TypeIR;
  /** True iff the source field was declared `T?`. */
  optional: boolean;
  /** Where the wire field came from in the IR. */
  source: WireFieldSource;
  /** Resolved access role.  Always set after enrichment.  For
   * `source: "id"` this is always `"token"`; for `source: "property"`
   * it mirrors the originating `FieldIR.access`; for `"containment"`
   * and `"derived"` it is `"editable"` until a real case demands
   * otherwise. */
  access: FieldAccess;
}
