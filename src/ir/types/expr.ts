import type { ThrowKindName } from "../../util/intrinsic-matchers.js";
import type { RepoOp } from "../../util/repository-contract.js";
import type { DurationUnit } from "../../util/temporal.js";
import type { Bypassing, BypassReadIR, KeyLookupIR } from "./context.js";
import type { DataSourceKind, LoomInterface } from "./deployment.js";
import type { StmtIR } from "./stmt.js";
import type { PrimitiveName, Sourced, TypeIR } from "./types.js";

// ---------------------------------------------------------------------------
// Expressions — fully resolved, every name has a kind tag.
// ---------------------------------------------------------------------------

export type LiteralKind = "string" | "int" | "long" | "decimal" | "money" | "bool" | "null" | "now";

/**
 * Per-primitive style escape hatch — pack-neutral CSS entries.
 * Lowered from `style: { background: "...", padding: "..." }` named args
 * on walker-primitive calls.  Entries use an ordered list (not a
 * Record<string, ExprIR>) so source order survives the IR pipeline and
 * downstream emitters can produce deterministic output.  Keys are CSS
 * property names (kebab- or camel-cased as in source); values are any
 * `ExprIR` so refs/interpolation compose naturally.
 */
export type StyleIR = { entries: Array<{ key: string; value: ExprIR }> };

export type RefKind =
  | "param"
  | "let"
  | "lambda"
  | "this-prop" // entity field (private _name with public getter)
  | "this-vo-prop" // value-object public readonly field
  | "this-derived"
  | "helper-fn"
  | "workflow-fn" // a bare reference to a workflow's own `function` helper (rendered as the scoped name)
  | "enum-value"
  | "current-user" // magic identifier — system's `user` block shape
  | "resource" // ambient resource handle — `files`, `jobs`, …
  | "store-field" // a `<Store>.<field>` read from a page/component/store body (Stage 5)
  | "match-binding" // the narrowed variant binding of a variant-`match` arm (variant-match.md)
  | "unknown";

export type CallKind =
  | "function" // calls a `function` declared in scope
  | "workflow-fn" // calls a workflow's own `function` helper — emitted as a per-workflow-scoped module helper
  | "value-object-ctor" // calls a value-object constructor
  | "private-operation" // calls a private operation
  | "resource-op" // a verb call on an ambient resource handle
  | "remote-api-op" // a TYPED call on an in-system api-bound resource (M-T4.8)
  | "repo-read" // a read-only repository query in a `reading` domain-service body (domain-services.md rev. 4)
  | "domain-service" // a member call on a `domainService` (domain-services.md)
  | "action" // a bare call to a SIBLING page/component `action` (Proposal A Stage 1)
  | "store-action" // a `<Store>.<action>(…)` call from a page/component/store body (Stage 5)
  | "free"; // unresolved free call

export type BinOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||";

/**
 * The discriminated policy decision carried by an `authz-filter` `ExprIR`
 * node.  Each backend's filter translator switches over `kind` with
 * TypeScript exhaustiveness, so adding a variant is a `tsc` error at every
 * render site rather than a silent authorization bypass.
 *
 *  - `deny` — the always-false carve-out (`deny [write] on <Agg>`,
 *    deny-wins).  Principal-FREE: it routes to each
 *    backend's STATIC filter path (no ambient-principal parameter), which is
 *    what keeps a denied aggregate's read/write seam free of the unused-param
 *    trap.  Every backend renders it to its native always-false fragment
 *    (Drizzle `and(isNull, isNotNull)` / EF `false` / JPQL `1 = 0` /
 *    `cb.disjunction()` / SQLAlchemy contradiction / Ecto `fragment("false")`).
 */
export type AuthzFilterKind = { kind: "deny" };

export type ExprIR = (
  | { kind: "literal"; lit: LiteralKind; value: string }
  | { kind: "this" }
  | { kind: "id" }
  | {
      kind: "ref";
      name: string;
      refKind: RefKind;
      enumName?: string;
      /** Populated when `refKind === "enum-value"` and MORE THAN ONE enum in
       *  scope declares this value name (`enum OrderStatus { Draft, ... }` +
       *  `enum InvoiceStatus { Draft, ... }`).  Holds every candidate enum
       *  name in resolution order; `enumName` carries the provisional
       *  first-wins pick so nothing downstream sees an unqualified value.
       *
       *  Lowering resolves the ambiguity CONTEXTUALLY -- `lowerExprInContext`
       *  (field / param default, `:=` RHS, `emit` field) and the binary-chain
       *  cross-typing in `lower-expr.ts` retarget the ref to the enum the SITE
       *  expects and clear this field.  A ref that still carries candidates
       *  when it reaches phase (7) had no contextual type at all, and
       *  `loom.ambiguous-enum-value` reports it rather than letting the
       *  first-declared enum win silently (F-022).  Backends never see it: the
       *  IR is resolved, or the build failed. */
      enumCandidates?: readonly string[];
      type?: TypeIR;
      /** Populated when `refKind === "resource"` — the resource's
       *  declared name and infra kind, so a `.verb(...)` call on it can
       *  lower to a `resource-op` without re-resolving. */
      resourceName?: string;
      resourceKind?: DataSourceKind;
      /** Populated when the resource binds an in-system `api` (M-T4.8) — a
       *  `.op(...)` call on it resolves against that api's derived operation
       *  set, not the closed per-kind verb registry. */
      resourceApiName?: string;
      /** Populated when `refKind === "store-field"` — the declaring store's
       *  name, so a `<Store>.<field>` read renders against the right store
       *  module without re-resolving the receiver (Stage 5).  `name` is the
       *  field; `type` its declared type. */
      storeName?: string;
      /** Populated when `refKind === "workflow-fn"` — the enclosing workflow's
       *  name, so a bare reference renders the scoped helper name `<wf><fn>`
       *  (workflows share a file, so helpers are namespaced by workflow). */
      wfScope?: string;
    }
  | {
      kind: "member";
      receiver: ExprIR;
      member: string;
      receiverType: TypeIR;
      memberType: TypeIR;
    }
  | {
      kind: "method-call";
      receiver: ExprIR;
      member: string;
      args: ExprIR[];
      receiverType: TypeIR;
      isCollectionOp: boolean;
      /** Set when `member` is a recognised test-assertion matcher
       *  (`toBe`/`toHaveText`/`toBeVisible`/…) — a built-in "intrinsic"
       *  the type system knows and each backend lowers to its native test
       *  library (Playwright/vitest/xUnit/ExUnit).  Resolved here so
       *  backends switch on the flag rather than re-recognising names. */
      isIntrinsicMatcher?: boolean;
      /** `toThrow(precondition)` / `toThrow(invariant)` — the failure RUNG the
       *  matcher pins, carried from the grammar's `ThrowKind` slot.  It is not
       *  an `args[0]`: both words are hard keywords and never lower to an
       *  expression.  `expectStmtIR` reads it off here and moves it onto the
       *  `expect-throws` node, so no other consumer sees it on a method-call. */
      throwKind?: ThrowKindName;
      /** Optional parallel array: `argNames[i]` is the
       *  source-side `name:` prefix for `args[i]`, or `undefined` for
       *  positional arguments.  Present iff at least one arg was
       *  written with a name; absent for fully-positional calls (the
       *  vast majority — keeps IR compact for v22-shaped code). */
      argNames?: (string | undefined)[];
      /** `await`-marked (async-actions-and-effects.md Stage 2) — set when this
       *  method-call was written as a `match await <call>()` subject.  The
       *  frontend walker emits the async envelope (await the mutation, reify
       *  the thrown error into the union) around a variant-match on the
       *  result; every other consumer ignores it. */
      awaited?: boolean;
      /** A context integration test's widened by-id read
       *  (`let o = Order.find(id) ignoring …`): `member` names the read's own
       *  method (`bypassReadMethodName`), which enrichment synthesises on the
       *  aggregate's repository from this source and stance. */
      bypassRead?: BypassReadIR;
    }
  | {
      kind: "call";
      callKind: CallKind;
      name: string;
      args: ExprIR[];
      /** Same shape as `method-call.argNames` — see above. */
      argNames?: (string | undefined)[];
      /** `await`-marked (async-actions-and-effects.md Stage 2) — see the
       *  `method-call` node's `awaited`.  Set when the call was the subject of a
       *  `match await <call>()`; drives the frontend async-await envelope. */
      awaited?: boolean;
      /** Populated when `callKind === "workflow-fn"` — the enclosing workflow's
       *  name.  A workflow `function` is emitted as a per-workflow-scoped module
       *  helper (a workflow body is not a class), so backends render the call as
       *  the scoped, per-backend-cased name `<wf><fn>(args)`. */
      wfScope?: string;
      /** Populated when `callKind === "resource-op"` — the
       *  resolved resource binding, verb, the capability it requires,
       *  and the access interface (default from
       *  `EnrichedSystemIR.resourceInterfaces`, with per-verb override).
       *  The bound `ResourceAdapter.emitOperation` renders the call. */
      resourceOp?: {
        resourceName: string;
        resourceKind: DataSourceKind;
        verb: string;
        capability: string;
        interface?: LoomInterface;
        /** Set when the resource is an `api` bound to an IN-SYSTEM api (M-T4.8).
         *  Such a resource has no raw-verb vocabulary — its calls lower to
         *  `remote-api-op` — so a resource-op carrying this is always refused
         *  (`loom.resource-verb-invalid#api-bound`); no renderer reads it. */
        boundApi?: string;
      };
      /** Populated when `callKind === "remote-api-op"` (M-T4.8) — a typed call
       *  on a resource that binds an in-system `api`.  Fully resolved at
       *  lowering: the caller's emitter needs no knowledge of how the CALLEE
       *  mounts its routers, because `path` is already absolute and the
       *  parameter locations are decided.  `errorStatuses` is what lets a
       *  client type its failure union instead of collapsing every non-2xx
       *  into a throw. */
      remoteApiOp?: {
        /** The binding resource — names the `<RESOURCE>_URL` env seam. */
        resourceName: string;
        apiName: string;
        /** `ApiOperationIR.id` — the cross-backend operation identity. */
        operationId: string;
        method: string;
        /** Absolute wire path, `API_BASE_PATH` included (`/api/orders/{id}`). */
        path: string;
        /** The callee's declared parameters, in call-argument order.  `type` is
         *  carried, not just the name/location, because a backend whose id
         *  representation is not a string (.NET's `readonly record struct`)
         *  has to coerce an id argument at the CALL SITE, and it must decide
         *  that from the same source the client's parameter type is derived
         *  from — otherwise the two can disagree silently. */
        params: readonly {
          name: string;
          location: "path" | "query" | "body";
          type: TypeIR;
        }[];
        errorStatuses: readonly number[];
      };
      /** Populated when `callKind === "domain-service"` (domain-services.md)
       *  — the resolved `domainService` name and the operation invoked.
       *  Structured (not overloaded onto flat `name`) so backends render
       *  the call without re-resolving the receiver. */
      serviceRef?: { service: string; op: string };
      /** Populated when `callKind === "repo-read"` (domain-services.md rev. 4,
       *  the `reading` tier) — a read-only repository query in a domain-service
       *  operation body (`Accounts.byHolder(h)` / `Repo.find/findAll/run`).
       *  Fully resolved at lowering time: `repo` is the repository name,
       *  `aggregate` its target aggregate, `method` the find / retrieval method
       *  to render against the generated repository, and `op` what the read
       *  does.  Backends render a real call into the generated repository
       *  without re-recognising the AST.  Its `ignoring` stance is set on a
       *  widened list read (`all(<Ref>) ignoring …`): `retrievalName` then
       *  names the read's own retrieval (`widenedRetrievalName`), which
       *  enrichment derives with this stance on it. */
      repoRead?: {
        repo: string;
        aggregate: string;
        method: string;
        /** What the read does (`util/repository-contract.ts`): `load` /
         *  `load-optional` by id, `select-one` / `select-many` over a criterion
         *  or retrieval (or the whole collection), or an `unknown-read`
         *  (a name no verb spells — refused).
         *  Backends dispatch on it, never on `method`. */
        op: Exclude<RepoOp, "remove">;
        /** The retrieval a criterion / retrieval read runs against — mirrors the
         *  workflow `repo-run` path.  For `find`/`findAll` it is the synthesized
         *  `findAllBy<Criterion>` (materialised by `synthesizeFindAllRetrievals`
         *  from the criterion); for `run` it is the referenced retrieval name.
         *  Absent for a read called by name (a declared find, a by-id load,
         *  the whole collection).  Backends
         *  render their retrieval-method name (`run<Name>`) from it so the
         *  emitted call hits a real method that APPLIES the criterion, rather
         *  than dropping it and calling the whole-table `findAll`/`all`. */
        retrievalName?: string;
        /** The criterion a `find`/`findAll` read filters by — drives the enrich
         *  pass's synthesis of the `retrievalName` retrieval (same criterion the
         *  workflow `synthCriterion` names).  Absent for a retrieval run and a
         *  read called by name. */
        synthCriterion?: { name: string };
        /** A natural-key read's tuple + `ignoring` stance (see `repo-let`). */
        key?: KeyLookupIR;
        /** A `find(<Criterion>)` / `findById` read that widens its capability
         *  filters (`ignoring …`): `method` names the read's own method and
         *  there is no `retrievalName`. */
        bypassRead?: BypassReadIR;
      } & Bypassing;
      /** Populated when `callKind === "store-action"` (Stage 5) — the resolved
       *  store + action a `<Store>.<action>(…)` call dispatches to.  Structured
       *  (not overloaded onto flat `name`) so backends bind the store action
       *  without re-resolving the receiver.  `name` mirrors `storeAction.action`. */
      storeAction?: { store: string; action: string };
      /** Per-primitive `style:` escape hatch.  Populated by lowering
       *  when the source supplied a `style: { … }` named arg on a
       *  walker-primitive call (`Container { style: { background: "red" }, ... }`).
       *  The named arg is hoisted out of `args`/`argNames` into this
       *  field.  React emits `style={{...}}`; Phoenix emits `style="..."`.
       *  Use the ordered `entries` shape (not a `Record`) so entry order
       *  survives the IR pipeline. */
      style?: StyleIR;
      /** Populated when `callKind === "private-operation"` — the resolved
       *  privacy of the target sibling operation.  An operation self-call
       *  lowers to `private-operation` regardless of the operation's actual
       *  `private` modifier, so backends that name public vs private
       *  operations differently (Python: `def reserve` vs `def _reserve`)
       *  must know which one the def-site emitted.  Absent (⇒ public) for
       *  `function` calls (functions are always private) and every other
       *  `callKind`. */
      targetPrivate?: boolean;
    }
  | {
      /** A bare reference to a named page/component `action` in
       *  handler-arg position (`onSubmit: next`, `rowAction: add`) — the
       *  named-action analogue of an inline handler lambda (Proposal A
       *  Stage 1).  Fully resolved at lowering time: `actionName` is the
       *  declared action; `paramType` is its single declared payload param
       *  type (undefined ⇒ nullary action).  Backends and the validator
       *  read these directly — they never re-resolve the name.  The walker
       *  binds the hoisted handler (whose name derives from `actionName`)
       *  instead of emitting an inline arrow. */
      kind: "action-ref";
      actionName: string;
      paramType?: TypeIR;
      /** Set when the handler reference is a bare STORE action (`onClick:
       *  Cart.clear`) rather than a sibling page/component action — the store
       *  analogue of a page `action-ref`.  Backends bind it through the store
       *  seam (record the use, reference the shell-bound store-action local)
       *  instead of the page-action handler.  Absent for a page action. */
      storeName?: string;
    }
  | {
      kind: "lambda";
      param: string;
      /** Single-expression form: `x => expr`.  Mutually exclusive with
       *  `block`.  Existing v22 lambdas always populate this. */
      body?: ExprIR;
      /** Block-body form: `x => { stmt; stmt; … }`.
       *  Reuses the existing `StmtIR` rule so `let`, `:=`, calls,
       *  emits, etc. are admissible.  React emitter lowers
       *  state mutations against `state {}` fields to `setX(...)`. */
      block?: StmtIR[];
    }
  | {
      kind: "new";
      partName: string;
      fields: { name: string; value: ExprIR }[];
      /** True when the constructed part is NESTED — contained by a sibling part,
       *  not the aggregate root (`Order → Shipment → Label`, a `new Label`).
       *  Its parent (the enclosing part) has no id at construction time, so
       *  backends OMIT the construction-time `parentId`: the FK is stamped from
       *  tree position on save and set from the DB row on hydrate.  Absent /
       *  false for a root-level part (`new Shipment`), which keeps passing the
       *  ambient `this` id — byte-identical. */
      nested?: boolean;
    }
  | {
      kind: "object";
      fields: { name: string; value: ExprIR }[];
    }
  | {
      /** Bracketed list literal — `[expr, expr, ...]`.  Produced by
       *  `ListLit` AST nodes; consumers that admit a list shape
       *  (e.g. `Grid { cols: [3, 2, 1] }`) inspect `elements` directly.
       *  No element-type unification happens at lowering — heterogeneous
       *  element types are admissible at the IR level; per-use-site
       *  validators decide whether to flag them. */
      kind: "list";
      elements: ExprIR[];
    }
  /**
   * Authorization / tenancy filter sentinel (M-T9.9).  A synthesized,
   * never-parsed predicate that carries a DISCRIMINATED policy decision
   * (`filter.kind`) instead of riding the IR as an ordinary `method-call`
   * marker (the pre-M-T9.9 `__loomDeny__` / `__loomDeepScope__` encoding).
   *
   * The decision is made ONCE in enrichment (deep/global/deny — see
   * `src/ir/enrich/enrichments.ts`) and every backend's query-filter
   * translator only RENDERS the pre-built node to its native fragment
   * (Drizzle contradiction, EF `false`, JPQL `1 = 0`, Ecto `fragment("false")`,
   * …).  Making it a first-class `ExprIR.kind` — rather than a `method-call`
   * every backend already handles — is the safety payoff: a backend that
   * omits a filter arm cannot fall through to the generic expression
   * dispatcher and emit a silent authorization bypass.  Instead the shared
   * dispatcher THROWS on it (like `action-ref`), the queryable-subset gate
   * and child-walker force an explicit arm, and each backend switches on
   * `filter.kind` with TypeScript exhaustiveness so a future `AuthzFilterKind`
   * becomes a `tsc` error at every render site.
   *
   * Never reaches a domain-logic expression position — it lives ONLY in an
   * aggregate's `contextFilters` / `writeScopeFilter`, special-cased by the
   * filter translators BEFORE the generic dispatch.  Build/inspect it through
   * `src/ir/util/tenant-stance.ts` (`buildDenyFilter` / `isDenyFilter`).
   */
  | {
      kind: "authz-filter";
      /** The discriminated policy decision this sentinel encodes. */
      filter: AuthzFilterKind;
      /** Name of the aggregate the filter guards.  Backends key the row's
       *  table/alias off their render context, not this — it is carried for
       *  provenance / debugging. */
      aggregate: string;
    }
  | { kind: "paren"; inner: ExprIR }
  | { kind: "unary"; op: "-" | "!"; operand: ExprIR }
  | {
      kind: "binary";
      op: BinOp;
      left: ExprIR;
      right: ExprIR;
      /** Type of the left operand, populated during lowering when
       *  available.  Backends use this to dispatch operator rendering —
       *  e.g. Phoenix emits `Decimal.add(l, r)` for money operands,
       *  TS emits `l.plus(r)` against a decimal.js Decimal — without
       *  re-running expression-type inference.  Synthetic binary nodes
       *  (built by walker-primitive-expander, etc.) may leave this
       *  undefined; those paths only need operand-blind operator
       *  rendering. */
      leftType?: TypeIR;
      /** Type of the RIGHT operand — same population policy as `leftType`.
       *  Needed alongside `leftType` to distinguish an integer division that
       *  widened to `decimal` (`int / int` — both operands integral, cast both)
       *  from an already-fractional mixed division (`int / decimal` — the
       *  decimal operand must NOT be re-wrapped). */
      rightType?: TypeIR;
      /** Type of the binary expression as a whole — comparison/logical
       *  ops are `bool`; arithmetic ops follow the type-system's
       *  closed-money and numeric-widening rules.  Same population
       *  policy as `leftType`. */
      resultType?: TypeIR;
    }
  | { kind: "ternary"; cond: ExprIR; then: ExprIR; otherwise: ExprIR }
  /**
   * Explicit primitive conversion — `<target>(<value>)`.  Source-
   * level form: `string(age)`, `money(decimalField)`,
   * `decimal(moneyValue)`.  Distinct from the `money("…")` LITERAL
   * form, which shares the `PrimitiveConversion` AST node but lowers
   * to `lit("money", …)` (see `src/language/money-literal.ts`); this
   * is for converting a TYPED VALUE between primitives.
   *
   * `from` carries the source operand's inferred primitive type so
   * backends can dispatch the right emit form per (from, target)
   * pair (TS `String(x)` vs `x.toString()`, .NET `(decimal)x` vs
   * `x` no-op, Phoenix `to_string(x)` vs `Decimal.to_string(x)`).
   * Populated by lowering — may be `undefined` if the source's type
   * couldn't be inferred (broken upstream; validator will already be
   * reporting it).
   */
  | {
      kind: "convert";
      target: PrimitiveName;
      from: PrimitiveName | undefined;
      value: ExprIR;
    }
  /**
   * Duration constructor (A5 temporal, https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/old/plans/stdlib.md) —
   * `days(n)` / `hours(n)` / `minutes(n)`.  Parsed as an ordinary free
   * call; lowered to this node ONLY when the name did not resolve to any
   * user declaration (a user `function days(...)` shadows the builtin and
   * lowers to a plain `call`).  `amount` is int-typed (validated by
   * `loom.duration-arity` / `loom.duration-arg-type`); the node's type is
   * `{ kind: "primitive", name: "duration" }`.  Every unit is ABSOLUTE
   * (fixed millisecond width), which is what lets every backend render the
   * absolute-milliseconds path uniformly; calendar-relative offsets
   * (`months`, `years`) are deliberately not part of `duration`.
   */
  | {
      kind: "duration";
      unit: DurationUnit;
      amount: ExprIR;
    }
  /**
   * i18n ICU format suffix on an interpolation hole (M-T1.11, i18n.md) — a
   * TRANSPARENT wrapper around a template hole's expression that carries the
   * raw ICU format text (`", number, ::currency/USD"`, leading comma + spaces
   * preserved).  Created by `lowerTemplateString` ONLY when the source hole
   * spelled a `, format` suffix (`` `Total: {order.total, number,
   * ::currency/USD}` ``); a format-less hole gets NO wrapper.
   *
   * INERT on the raw path: every backend + Feliz/Flutter/HEEx renders it as
   * exactly `inner` (the string-converted concat operand) — the format is
   * DROPPED, so a formatted template emits byte-identical to a format-less one.
   * The format only comes alive on the four JS/TS frontends' i18n runtime,
   * where `icuFromConcat` (src/generator/_walker/i18n-extract.ts) splices the
   * suffix into the emitted ICU message and `intl-messageformat`
   * locale-formats the value at runtime.  `inner` is the concat operand (the
   * `convert`/`.display` string-coercion), which the extractor peels back to
   * the raw value for the runtime `values` object.
   */
  | {
      kind: "i18nFormat";
      inner: ExprIR;
      /** Raw ICU suffix incl. the leading comma, e.g. `", number, ::currency/USD"`. */
      format: string;
    }
  /**
   * The translated text a user sees for a model element — the lowered
   * `label(Task)` / `plural(Task)` / `label(Task.title)` / `label(Status.Draft)`
   * intrinsic (i18n identity keys).  `key` is the context-qualified identity key
   * (`Projects.Task.name.other`) and `defaultText` its English default
   * (`"Tasks"`), both built by `src/util/model-text-key.ts`.
   *
   * UI-only: the validator (`loom.model-text-outside-ui`) keeps it out of every
   * domain-logic position, so the backend `ExprTarget`s never see one.  A
   * frontend renders it as a call into its translation runtime
   * (`t(key, defaultText)`), or as the bare default when the UI has no runtime.
   */
  | {
      kind: "modelText";
      key: string;
      defaultText: string;
    }
  /**
   * Predicate-arms expression — first arm whose
   * `cond` evaluates to `true` returns its `value`; if no arm
   * matches, `otherwise` (when present) is the fallthrough.  Lives
   * in the expression engine so it can appear anywhere an expression
   * is allowed (page bodies, `derived` properties,
   * filter lambdas, function bodies).  Validator may warn
   * on non-exhaustive matches that lack `otherwise`.
   */
  | {
      kind: "match";
      /**
       * Boolean-form arms (`match { cond => value }`).  Present for the
       * predicate-arms form; empty for the variant form.
       */
      arms: { cond: ExprIR; value: ExprIR }[];
      otherwise?: ExprIR;
      /**
       * Variant-match scrutinee (variant-match.md) — the `or`-union value
       * being discriminated.  `undefined` for the boolean form.  Lowered
       * to a `ref` ExprIR (the v1 constraint restricts it to a simple
       * ref / let-bound name, so it is side-effect-free and may be read
       * once by every arm).  `subjectType` is its resolved union TypeIR,
       * carried so backends never re-resolve the variant set.
       */
      subject?: ExprIR;
      subjectType?: TypeIR;
      /**
       * Runtime carrier shape of the variant subject.  `"absence"` when the
       * subject is the result of a repository **union find** — those are
       * validator-constrained to the absence shape (`Agg or <error>` /
       * `Agg option`, payloads.md §Union finds) and their runtime value is
       * the bare aggregate-or-absent (`Project | null` / `Project?` /
       * `record | nil`), never the tagged wire carrier.  Backends must
       * render the match as a presence check (success arm on present,
       * error/`none` arm on absent), not a discriminator probe.  Stamped at
       * lowering (the only layer that knows the subject's find origin);
       * `undefined` means the subject is a genuinely tagged union value
       * (operation returns, payload values).
       */
      subjectShape?: "absence";
      /**
       * Variant-form arms.  Each names a union variant by its resolved
       * `varType` TypeIR (the wire tag is `variantTag(varType)` — derived,
       * not stored), optionally binds the narrowed variant value to
       * `binding`, and returns `value`.  Inside `value`, a reference to
       * `binding` lowers to a `ref` with `refKind: "match-binding"` typed
       * at `varType` (the if-let / lambda-param narrowing analog), so
       * member reads on it resolve with full receiver/member types.
       * Empty for the boolean form.
       */
      variantArms: {
        varType: TypeIR;
        binding?: string;
        value: ExprIR;
        /** True when this variant is an `error` payload.  Most backends tag
         *  every variant uniformly by `type` and ignore this, but the Elixir
         *  vanilla backend represents a union result as an asymmetric tagged
         *  tuple — `{:ok, value}` for the success variant vs `{:error, tag,
         *  fields}` for an error — so its `case` clause shape depends on it.
         *  Derived at lowering from the enclosing context's payload kinds
         *  (the generators have no context to re-derive it). */
        isError?: boolean;
      }[];
    }
) &
  Sourced;

// Convenience constructors used by the lowering layer.
export const lit = (kind: LiteralKind, value: string): ExprIR => ({
  kind: "literal",
  lit: kind,
  value,
});
