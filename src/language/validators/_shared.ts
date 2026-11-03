// Helpers shared by two or more themed validator modules.  Anything
// used by only one module lives there directly.
//
// Categories:
//   * Env builders (`envForAggregate` / `envForPart` / `envForValueObject`) —
//     shared by `structural.ts` (aggregate / part / value-object walks),
//     `statements.ts` (operation body walk), and `types.ts`.
//   * `warnSensitivityDrop` — shared by `types.ts` (derived / function)
//     and `statements.ts` (assign / emit).
//   * Literal-promotion gates (`canPromoteLiteralTo` / `canPromoteAstLitTo`
//     / `literalPromotionAnchor`) — shared by `types.ts`
//     (`checkDerived`, `checkSingleBinaryOperands`) and `statements.ts`
//     (`checkAssignOrCall`).
//   * `isInfallibleConversion` — used by `types.ts` only today, but
//     conceptually a type-system helper so kept here for visibility.
//   * `pathString` — used by `statements.ts` only; kept here because it
//     reads LValue and is a generic AST-formatting concern.
//   * Page / api walking helpers used by `ui.ts`.

import type { AstNode } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { aggregateServesHistory } from "../../util/audit-ast.js";
import { AUDIT_HISTORY_FIND } from "../../util/audit-names.js";
import { SYSTEM_TEXT_NS } from "../../util/model-text-key.js";
import { dedupeRuleName, deriveRuleName } from "../../util/rule-name.js";
import {
  type Aggregate,
  type DerivedProp,
  type EntityPart,
  type FunctionDecl,
  type Invariant,
  isBoundedContext,
  isContainment,
  isCriterion,
  isDecLit,
  isDerivedProp,
  isIntLit,
  isInvariant,
  isNamedType,
  isProperty,
  isRetrieval,
  type LValue,
  type Subdomain,
  type ValueObject,
} from "../generated/ast.js";
import { declaredRuleName, type RuleNode, ruleContext, ruleOwner, rulesOf } from "../rule-names.js";
import {
  type Env,
  makeEnv,
  paramType,
  propertySensitivity,
  resolveTypeRef,
  sensitivityNarrows,
  T,
  type Ty,
  typeToString,
  withTags,
} from "../type-system.js";

// ---------------------------------------------------------------------------
// Env builders
// ---------------------------------------------------------------------------

export function envForAggregate(agg: Aggregate, fn?: FunctionDecl): Env {
  const bindings = new Map<string, { type: Ty; origin: AstNode }>();
  // Aggregate properties / derived / contains are in scope as bare
  // identifiers — same as if we accessed them via `this`.  Property
  // bindings attach the declared sensitivity tags so propagation
  // inside operation bodies sees them.
  for (const m of agg.members) {
    if (isProperty(m))
      bindings.set(m.name, {
        type: withTags(resolveTypeRef(m.type), propertySensitivity(m)),
        origin: m,
      });
    else if (isDerivedProp(m)) bindings.set(m.name, { type: resolveTypeRef(m.type), origin: m });
    else if (isContainment(m)) {
      const part = m.partType?.ref;
      if (part) {
        const t = T.record(part);
        bindings.set(m.name, { type: m.collection ? T.array(t) : t, origin: m });
      }
    }
  }
  if (fn) for (const p of fn.params) bindings.set(p.name, { type: paramType(p), origin: p });
  return makeEnv(undefined, bindings, { aggregate: agg });
}

export function envForPart(agg: Aggregate, part: EntityPart, fn?: FunctionDecl): Env {
  const bindings = new Map<string, { type: Ty; origin: AstNode }>();
  for (const m of part.members) {
    if (isProperty(m))
      bindings.set(m.name, {
        type: withTags(resolveTypeRef(m.type), propertySensitivity(m)),
        origin: m,
      });
    else if (isDerivedProp(m)) bindings.set(m.name, { type: resolveTypeRef(m.type), origin: m });
    else if (isContainment(m)) {
      const partType = m.partType?.ref;
      if (partType) {
        const t = T.record(partType);
        bindings.set(m.name, { type: m.collection ? T.array(t) : t, origin: m });
      }
    }
  }
  if (fn) for (const p of fn.params) bindings.set(p.name, { type: paramType(p), origin: p });
  return makeEnv(undefined, bindings, { aggregate: agg, part });
}

export function envForValueObject(vo: ValueObject): Env {
  const bindings = new Map<string, { type: Ty; origin: AstNode }>();
  for (const m of vo.members) {
    if (isProperty(m)) bindings.set(m.name, { type: resolveTypeRef(m.type), origin: m });
    else if (isDerivedProp(m)) bindings.set(m.name, { type: resolveTypeRef(m.type), origin: m });
  }
  return makeEnv(undefined, bindings, { valueObject: vo });
}

// ---------------------------------------------------------------------------
// Sensitivity-narrowing warning
// ---------------------------------------------------------------------------

/** Emit a warning when a value's sensitivity tags would be silently
 *  dropped flowing into a less-sensitive target.  Implicit conversion
 *  is permitted by `isAssignable`; this surfaces it. */
export function warnSensitivityDrop(
  actual: Ty,
  expected: Ty,
  accept: import("langium").ValidationAcceptor,
  info: { node: AstNode; property?: string },
): void {
  if (actual.kind === "unknown" || expected.kind === "unknown") return;
  const dropped = sensitivityNarrows(actual, expected);
  if (!dropped) return;
  accept(
    "warning",
    diagMessage("loom.sensitivity-drop", {
      dropped: dropped.join(", "),
      actual: typeToString(actual),
      expected: typeToString(expected),
    }),
    { ...info, code: "loom.sensitivity-drop" },
  );
}

// ---------------------------------------------------------------------------
// Literal-promotion gates
// ---------------------------------------------------------------------------

/**
 * Literal-promotion gate.  A bare numeric literal (IntLit or DecLit)
 * may flow into a typed numeric / money target context — the
 * lowering layer elaborates the literal to the matching IR literal
 * kind so backends emit the right form (`new Decimal("373.34")` for
 * money, `5L` for large long literals in C#, `5m` for decimal
 * literals in C#).  Mirrors `lowerExprInContext` in
 * `lower-expr.ts`; the validator MUST stay in lockstep so the
 * strict gates (`isAssignable`, `comparable`, the pass's arithmetic) don't
 * reject what the lowering happily elaborates.
 *
 * The promotion is one-sided.  A typed VALUE (e.g. a `taxRate:
 * decimal` field used opposite money, or a `count: int` field used
 * opposite long) still rejects — the rule fires only on AST forms
 * that are bare numeric literals, not on typed expressions that
 * happen to resolve to a numeric type.  Keeps strict-mode
 * guarantees intact while letting ergonomic source forms typecheck.
 *
 * Promotions admitted:
 *   IntLit / DecLit → money   (the original #508 case)
 *   IntLit          → long    (C# `L` suffix — without elaboration,
 *                              long literals > Int32.MaxValue
 *                              silently overflow at .NET compile time)
 *   IntLit          → decimal (C# `m` suffix; IR type-honesty)
 * DecLit → long / int is intentionally NOT admitted — a fractional
 * literal in an integer context is almost certainly a typo and the
 * strict gate should surface it.
 */
export function canPromoteLiteralTo(
  expr: import("../generated/ast.js").Expression | undefined,
  target: Ty,
): boolean {
  if (!expr) return false;
  if (target.kind !== "primitive") return false;
  return canPromoteAstLitTo(expr, target.name);
}

/** Inner gate used by both `canPromoteLiteralTo` (top-level checks)
 *  and `checkSingleBinaryOperands` (per-operand checks).  Takes a
 *  bare target name (not a wrapped `Ty`) so the caller doesn't
 *  have to box the type they already have in hand. */
function canPromoteAstLitTo(
  expr: import("../generated/ast.js").Expression | undefined,
  target: string,
): boolean {
  if (!expr) return false;
  if (target === "money") return isIntLit(expr) || isDecLit(expr);
  if (target === "long" || target === "decimal") return isIntLit(expr);
  return false;
}

/** Mirror of `lower-expr.ts`'s `literalPromotionAnchor`: when one
 *  side of a binary expression is typed as long / decimal / money,
 *  that type is the "anchor" a bare numeric literal on the other
 *  side promotes against.  int isn't an anchor — every IntLit
 *  already types as int.
 *
 *  `money` anchors only the operators money is CLOSED under — `+`, `-`
 *  and the comparisons.  Scaling (`*`, `/`) is money × SCALAR by
 *  definition (the typing pass's `arithmetic`: money × money and
 *  money ÷ money are both rejected), so promoting the scalar literal to
 *  money there manufactures the very `money × money` the type-system
 *  refuses — and the refusal then printed the hint that says the form is
 *  allowed.  `derived half: money = price / 2` is legal source; it must
 *  reach the pass's arithmetic as `money ÷ int`, not `money ÷ money`. */
export function literalPromotionAnchor(t: Ty, op: string): "long" | "decimal" | "money" | null {
  if (t.kind !== "primitive") return null;
  if (t.name === "money") return op === "*" || op === "/" ? null : "money";
  if (t.name === "long" || t.name === "decimal") return t.name;
  return null;
}

// ---------------------------------------------------------------------------
// Primitive-conversion admissibility table
// ---------------------------------------------------------------------------

/**
 * Allowed (source, target) primitive-conversion pairs.  Each pair is
 * infallible at runtime — no parse failures, no precision overflow.
 * Identity (source === target) is admitted separately by the caller
 * as a no-op.
 *
 * Pairs:
 *   string ← int | long | decimal | money | bool
 *   long   ← int                              (widening)
 *   decimal ← int | long                      (widening)
 *   decimal ← money                           (lossy projection)
 *   money  ← int | long | decimal             (widening)
 *
 * Notably absent:
 *   - string → anything else (parse-fallible; needs `T?`/throw design)
 *   - narrowing (long→int, decimal→long, money→{int,long})
 *   - datetime / guid / enum conversions (separate design — backend-
 *     specific format choices)
 */
export function isInfallibleConversion(source: string, target: string): boolean {
  if (target === "string") {
    return (
      source === "int" ||
      source === "long" ||
      source === "decimal" ||
      source === "money" ||
      source === "bool" ||
      // Both have ONE canonical text form, so the conversion is infallible and
      // backend-agnostic: a guid renders as its UUID text, a datetime as
      // ISO-8601.  Three backends already carried the `from === "datetime"`
      // arm (.NET's round-trip "O", java's `java.time` ISO `toString`,
      // python's `.isoformat()`) while this gate refused every call that
      // could reach them; TS and elixir gained the matching arm alongside
      // this change.  `json` / `File` stay refused — neither has a canonical
      // scalar form, which is the actual reason the old "any primitive"
      // wording was wrong.
      // A calendar `date` renders as its ISO-8601 `YYYY-MM-DD` text.
      source === "guid" ||
      source === "date" ||
      source === "datetime"
    );
  }
  if (target === "long") return source === "int";
  if (target === "decimal") {
    return source === "int" || source === "long" || source === "money";
  }
  if (target === "money") {
    return source === "int" || source === "long" || source === "decimal";
  }
  return false;
}

// ---------------------------------------------------------------------------
// LValue formatter
// ---------------------------------------------------------------------------

export function pathString(lv: LValue): string {
  // Keep the `this.` the user wrote — a diagnostic that quotes the path back
  // has to quote the spelling that produced it.
  return [...(lv.thisRef ? ["this"] : []), lv.head, ...lv.tail].join(".");
}

// ---------------------------------------------------------------------------
// Page / api helpers used by ui.ts
// ---------------------------------------------------------------------------

/** Find an Aggregate by name across the contexts of a Subdomain. */
export function findAggregateInModule(mod: Subdomain, name: string): Aggregate | undefined {
  for (const ctx of mod.contexts ?? []) {
    for (const am of ctx.members ?? []) {
      if (am.$type === "Aggregate" && am.name === name) return am;
    }
  }
  return undefined;
}

/** Standard CRUD operation names that the api auto-derives for
 *  every aggregate, plus the aggregate's repository finds.
 *  Repositories live at the BoundedContext level (peer to
 *  aggregates), declared as `repository <Name> for <Aggregate>`,
 *  so we walk the aggregate's container context to find ones
 *  pointing at this aggregate.
 *
 *  DERIVED reads count too.  This list runs at phase ④, over the AST, but the
 *  api surface it describes is finalised at phase ⑥ — so a read the enrichment
 *  synthesizes is real even though no `find` declares it.  The entity-history
 *  read (`history(id)` on an `audited` aggregate) is the case that bit: the
 *  scaffolded Detail page calls it through the bare aggregate path, which does
 *  not come through here, so the HAND-WRITTEN spelling of the very same call
 *  (`api.Product.history(id)`) was the only one rejected.  `audited` is an AST
 *  flag, so membership is derived from it here rather than by deferring the
 *  check to a later phase. */
export function listValidApiOperations(agg: Aggregate): string[] {
  const ops = new Set<string>(["all", "byId", "create", "update", "delete"]);
  if (aggregateServesHistory(agg)) ops.add(AUDIT_HISTORY_FIND);
  // The paged reads a `queryHandler` over a criterion / retrieval of this
  // aggregate runs (`findAllBy<Criterion>` / `page<Retrieval>` — the names the
  // enrichment synthesizes, `ir/util/paged-run.ts`).  Whether a handler really
  // runs one is the IR gate's question (`loom.ui-read-unresolved`); here the
  // spelling is only recognised, so the api-handle-qualified read
  // (`Support.Ticket.findAllByOpen(…)`) is not refused where the bare one works.
  const ctx = agg.$container;
  if (isBoundedContext(ctx)) {
    for (const m of ctx.members ?? []) {
      if (!isCriterion(m) && !isRetrieval(m)) continue;
      const base = m.target?.base;
      if (!base || !isNamedType(base) || base.target.$refText !== agg.name) continue;
      ops.add(isCriterion(m) ? `findAllBy${m.name}` : `page${m.name}`);
    }
  }
  // Public `operation`s declared on the aggregate are exposed as api routes
  // (each gets a `use<Op><Agg>` frontend hook) — so a UI body may call them
  // off the api handle (`Sales.Order.placeOrder()`), including as the awaited
  // subject of a variant-`match` (async-actions-and-effects.md Stage 2).
  for (const m of agg.members ?? []) {
    if (m.$type === "Operation" && !m.private) ops.add(m.name);
  }
  return [...ops].sort();
}

export function isValidApiOperation(agg: Aggregate, op: string): boolean {
  return listValidApiOperations(agg).includes(op);
}

/** Map of PageProp $type names back to the source-side property
 *  name for diagnostics.  Used by `checkPage`'s duplicate-property
 *  message. */
export function pagePropDisplayName(typeName: string): string {
  switch (typeName) {
    case "RouteProp":
      return "route";
    case "TitleProp":
      return "title";
    case "RequiresProp":
      return "requires";
    case "BodyProp":
      return "body";
    case "PageMenuMeta":
      return "menu";
    case "LayoutProp":
      return "layout";
    case "DescriptionProp":
      return "description";
    case "OgImageProp":
      return "ogImage";
    case "CanonicalProp":
      return "canonical";
    default:
      return typeName;
  }
}

/** The name `scripts/codemod-rule-names.mjs` gives the unnamed rule `node`
 *  carrying `message "…"`: the derived name, deduplicated against every declared
 *  name in the owner and the names it hands the owner's earlier named rules.
 *  Only the diagnostic's hint reads it — a message never names a rule. */
function suggestedRuleName(node: RuleNode, message: string): string {
  const owner = ruleOwner(node);
  if (!owner) return deriveRuleName(message);
  const rules = rulesOf(owner);
  const taken = new Set<string>();
  for (const r of rules) {
    const d = declaredRuleName(r);
    if (d !== undefined) taken.add(d);
  }
  for (const r of rules) {
    if (declaredRuleName(r) !== undefined || !r.message || r.message.trim() === "") continue;
    const name = dedupeRuleName(deriveRuleName(r.message), taken);
    if (r === node) return name;
  }
  return deriveRuleName(message);
}

/** The rule-naming checks every `invariant` / field `check` / `precondition`
 *  runs (`src/language/rule-names.ts`):
 *
 *   - `loom.rule-message-removed` — the removed `message "…"` clause, with the
 *     name the codemod would give the rule and the `locales/en/<Ctx>.json` line
 *     its text moves to.
 *   - `loom.rule-name-duplicate` — a declared name another rule of the same
 *     owner declared first (invariants, checks and preconditions share one
 *     namespace per owner: the name is the i18n key). */
export function checkRuleNaming(
  node: RuleNode,
  accept: import("langium").ValidationAcceptor,
): void {
  const message = node.message;
  if (message !== undefined) {
    const owner = ruleOwner(node);
    const ctx = ruleContext(node);
    const name = suggestedRuleName(node, message);
    accept(
      "error",
      diagMessage("loom.rule-message-removed", {
        rule: isProperty(node) ? "check" : isInvariant(node) ? "invariant" : "precondition",
        name,
        file: `locales/en/${ctx ?? SYSTEM_TEXT_NS}.json`,
        key: `${owner?.name ?? "Owner"}.rule.${name}`,
        text: message,
      }),
      { node, property: "message", code: "loom.rule-message-removed" },
    );
  }
  const declared = declaredRuleName(node);
  const owner = ruleOwner(node);
  if (declared === undefined || !owner) return;
  const first = rulesOf(owner).find((r) => declaredRuleName(r) === declared);
  if (first !== undefined && first !== node) {
    // The name is on `checkName` for a field check, `name` otherwise.
    const at = (
      isProperty(node) ? { node, property: "checkName" } : { node, property: "name" }
    ) as {
      node: Invariant;
      property: "name";
    };
    accept(
      "error",
      diagMessage("loom.rule-name-duplicate", { name: declared, owner: owner.name }),
      { ...at, code: "loom.rule-name-duplicate" },
    );
  }
}

// Used by derived-prop check on aggregates / value objects to test
// the lvalue path's final segment.
export type { DerivedProp };
