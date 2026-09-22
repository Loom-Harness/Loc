// ---------------------------------------------------------------------------
// CALLABLE_SITES — the declared legality table for the callable surface
// (M-T5.21, `docs/new-plan/missions/M-T5.21-callable-unification-design.md`).
//
// Fifteen grammar rules in `ddd.langium` mean "a named body of statements runs
// here", and each one used to pick its OWN arbitrary subset of the modifier /
// clause surface.  The grammar recorded the arbitrariness in its own comments
// (`DomainServiceOperation`: *"Does NOT carry `private` / `extern` / `audited`
// / `when` — those are aggregate-operation-only"*, with no reason given,
// because there wasn't one — it is where the rule was forked).  The cost landed
// on the author: `audited` on a domain-service operation was a bare parse
// error, with nothing to say why.
//
// Phase 1 of the mission moves the difference out of the grammar and into this
// table.  The three grammar fragments (`CallableLeadModifiers` /
// `CallableSigModifiers` / `CallableGates`) accept the WHOLE surface at every
// site; what is legal WHERE is the data below, and one validator
// (`src/language/validators/callable-sites.ts`) reads it and reports the
// reason.
//
// INVARIANT — this table states TODAY's surface, exactly.  Phase 1 adds no
// capability and removes none: every combination the grammar newly accepts is
// rejected here, so emission is byte-identical across all eleven targets.
// Re-deriving the exclusions (design §Migration Phase 4 — "a difference must be
// justified in the table's comment or it is deleted") is deliberately a LATER
// phase: each row that gains a modifier is an emitter obligation on eleven
// targets, not a table edit.
//
// LAYERING.  Language-layer, next to the grammar it describes (design §Open
// question 2).  Pure data + one lookup, no Langium import, so the IR lowerers
// and `print-structural.ts` can consume it without a back-edge if a second
// consumer appears; it moves to `src/util/` at the third (CLAUDE.md, "a shared
// helper belongs at the layer its consumers live at").
// ---------------------------------------------------------------------------

/** The modifier keywords the callable fragments accept. */
export type CallableModifier = "private" | "extern" | "audited";

/** The header clauses the callable fragments accept. */
export type CallableClause = "requires" | "when";

/** Everything a site can exclude — the union the validator iterates. */
export type CallableFeature = CallableModifier | CallableClause;

/** The AST property each feature is parsed into, and the keyword an author
 *  wrote to get it there.  `requires` lands on `gate` because that property
 *  predates the fragment (`Operation` / `HandleDecl` / `WorkflowCreateDecl`
 *  already spelled it that way); renaming it would be a churn with no reader. */
export const CALLABLE_FEATURE_PROPERTY: Readonly<Record<CallableFeature, string>> = {
  private: "private",
  extern: "extern",
  audited: "audited",
  requires: "gate",
  when: "when",
};

/** The reason a site excludes what it excludes.  One slug per SITE KIND, not
 *  per modifier: the reason is a property of what the site *is* (a stateless
 *  calculator, a pure fold, a browser handler), and the catalog entry
 *  (`loom.callable-modifier-not-allowed-here#<slug>` in
 *  `src/diagnostics/messages.ts`) carries the wording. */
export type CallableDenyReason =
  | "lifecycle"
  | "applier"
  | "function"
  | "handler"
  | "domain-service"
  | "workflow"
  | "page-action";

export interface CallableSite {
  /** The keyword an author writes at this site. */
  readonly keyword: string;
  /** How the diagnostic names the site ("a domain-service operation"). */
  readonly label: string;
  /** Modifiers legal here TODAY. */
  readonly modifiers: readonly CallableModifier[];
  /** Header clauses legal here TODAY. */
  readonly clauses: readonly CallableClause[];
  /** Why everything else is excluded. */
  readonly why: CallableDenyReason;
}

/** Keyed by the grammar rule name (`AstNode.$type`) the site parses through —
 *  the one identifier that is stable across the grammar, the AST and the
 *  printers.  `Operation` only ever occurs in an aggregate/entity-part member
 *  list and `DomainServiceOperation` only in a `domainService`, so the $type
 *  alone identifies the site; no container walk is needed. */
export const CALLABLE_SITES = {
  // The reference site — every other row is a fork of this one, and it is the
  // only one that carries the full surface today.
  Operation: {
    keyword: "operation",
    label: "an aggregate operation",
    modifiers: ["private", "extern", "audited"],
    clauses: ["requires", "when"],
    why: "lifecycle",
  },
  // `create` / `destroy` carry `audited` (the lifecycle audit row) but no
  // gate: authorizing a factory is `requires` on the API/route surface today,
  // not on the member, and `when` is a canCommand gate over a LOADED instance —
  // which a factory does not have.
  Create: {
    keyword: "create",
    label: "a create",
    modifiers: ["audited"],
    clauses: [],
    why: "lifecycle",
  },
  Destroy: {
    keyword: "destroy",
    label: "a destroy",
    modifiers: ["audited"],
    clauses: [],
    why: "lifecycle",
  },
  // An applier is a pure fold replayed from the event log: it must produce the
  // same state every replay, so nothing that can refuse, branch on the caller,
  // or write a second record belongs on it.
  Apply: {
    keyword: "apply",
    label: "an applier",
    modifiers: [],
    clauses: [],
    why: "applier",
  },
  // A `function` is a pure helper over its parameters — no receiver to gate, no
  // route, no persistence.  (The ui-level `function` is a different rule,
  // `UiFunction`, which is extern-BY-CONSTRUCTION and therefore not a row
  // here; collapsing the two is design Phase 3.)
  FunctionDecl: {
    keyword: "function",
    label: "a function",
    modifiers: [],
    clauses: [],
    why: "function",
  },
  // A handler is dispatched by the API layer, not routed per instance: it
  // carries `extern` (the bodyless, user-implemented form) and nothing else.
  // NOTE both `extern` spellings parse at this site — the legacy PREFIX
  // (`extern commandHandler …`) and the uniform infix one — which is design
  // Phase 1's "every legacy spelling stays legal".  They share one AST
  // property, so this row cannot (and need not) tell them apart.
  CommandHandler: {
    keyword: "commandHandler",
    label: "a command handler",
    modifiers: ["extern"],
    clauses: [],
    why: "handler",
  },
  QueryHandler: {
    keyword: "queryHandler",
    label: "a query handler",
    modifiers: ["extern"],
    clauses: [],
    why: "handler",
  },
  // The design's worked example.  A domain service is a stateless,
  // context-internal calculator: no instance to gate, no route to authorize, no
  // persistence to audit, and an IR validator already refuses repo / extern /
  // emit / this-write inside the body.
  DomainServiceOperation: {
    keyword: "operation",
    label: "a domain-service operation",
    modifiers: [],
    clauses: [],
    why: "domain-service",
  },
  // Workflow members: `create` and `handle` are command entries and carry the
  // auth gate; `on` is an event reactor with no caller to authorize.  None of
  // the three is an aggregate method, so `when` (a canCommand gate over a
  // loaded instance) has nothing to evaluate against.
  WorkflowCreateDecl: {
    keyword: "create",
    label: "a workflow create",
    modifiers: [],
    clauses: ["requires"],
    why: "workflow",
  },
  HandleDecl: {
    keyword: "handle",
    label: "a workflow handle",
    modifiers: [],
    clauses: ["requires"],
    why: "workflow",
  },
  OnDecl: {
    keyword: "on",
    label: "a workflow event reactor",
    modifiers: [],
    clauses: [],
    why: "workflow",
  },
  // A page / component `action` runs in the browser.  Server-side modifiers
  // have no meaning there, and a page's own gate is the `requires` PAGE
  // PROPERTY, which is a different (and already existing) surface.
  ActionDecl: {
    keyword: "action",
    label: "a page action",
    modifiers: [],
    clauses: [],
    why: "page-action",
  },
} as const satisfies Record<string, CallableSite>;

/** The `$type`s this table covers. */
export type CallableSiteType = keyof typeof CALLABLE_SITES;

/** The site row for an AST `$type`, or `undefined` when the node is not a
 *  callable site. */
export function callableSiteOf(type: string): CallableSite | undefined {
  return (CALLABLE_SITES as Readonly<Record<string, CallableSite>>)[type];
}

/** Every feature the fragments can parse, in the order the diagnostic should
 *  report them (header order: modifiers, then clauses). */
export const CALLABLE_FEATURES: readonly CallableFeature[] = [
  "private",
  "extern",
  "audited",
  "requires",
  "when",
];
