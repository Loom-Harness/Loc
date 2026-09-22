// -------------------------------------------------------------------------
// Two page-body gates over what an expression in a RENDERED SLOT may be
// (audit D3 / D4).  Both close the same failure mode: a `.ddd` that reports
// `0 error(s), 0 warning(s)`, generates a full tree, and then fails to
// TYPECHECK — the frontend build is where the author finds out, in generated
// code they did not write.
//
//   D3  `loom.markup-primitive-in-collection-lambda`
//       `rows.map(i => Card { Text { i.name } })` emits
//       `{(…).map((i) => Card(Text(i.name)))}` — the primitives become plain
//       FUNCTION CALLS, which nothing imports (`Cannot find name 'Card'`).
//       `.map` is a perfectly legal collection op in expression position and
//       `docs/page-metamodel.md` encourages it, so nothing signalled that the
//       MARKUP case is different.  `For { each: rows, i => Card { … } }` is
//       the spelling that emits real keyed JSX.
//
//   D4  `loom.money-in-text-slot`
//       `Text { p.price }` on a `money` field emits `<Text>{p.price}</Text>`,
//       and `money` deserialises client-side to a decimal.js `Decimal` —
//       `TS2322: Type 'Decimal' is not assignable to type 'ReactNode'`.  The
//       scaffolded table renders money through the `Money` primitive; a
//       hand-written page has to know to reach for it, and that one token is
//       the whole difference between a frontend that compiles and one that
//       does not.  (`emitStat` already carries this reasoning in a comment —
//       it special-cases a nested `Money { … }` in its value slot precisely
//       because the bare value cannot be a React child.)
//
// Both are IR-level, so they cover every frontend at once rather than the one
// whose emitter happened to be read.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { isCollectionOp as isCollectionOpName } from "../../../util/collection-ops.js";
import { isWalkerPrimitive } from "../../../util/walker-primitive-names.js";
import { wireFieldsForAggregate } from "../../enrich/wire-projection.js";
import type {
  AggregateIR,
  ComponentIR,
  ExprIR,
  PageIR,
  StmtIR,
  StoreIR,
} from "../../types/loom-ir.js";
import { walkExprChildren, walkExprDeep, walkStmtChildren } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { positionalArgsOf } from "./ui-collection-display-checks.js";

// =========================================================================
// D3 — a markup primitive constructed inside a collection-op lambda
// =========================================================================

/** Every free call the walker would dispatch as a PRIMITIVE, reachable from
 *  `e`.  Used to answer "does this lambda body build markup?". */
function markupInside(e: ExprIR): string | undefined {
  let found: string | undefined;
  walkExprDeep(e, (n) => {
    if (found !== undefined) return;
    if (n.kind === "call" && n.callKind === "free" && isWalkerPrimitive(n.name)) found = n.name;
  });
  return found;
}

/** `loom.markup-primitive-in-collection-lambda` — a walker primitive built
 *  inside a collection-op lambda.
 *
 *  The op's lambda is lowered as an ORDINARY expression lambda: every frontend
 *  renders its body through the expression renderer, not the body walker, so a
 *  primitive there comes out as a bare function call against a name no import
 *  provides.  `For { each: …, x => … }` is the primitive whose lambda IS a
 *  render slot. */
export function checkMarkupInCollectionLambda(
  host: PageIR | ComponentIR | StoreIR,
  where: string,
  diags: LoomDiagnostic[],
): void {
  // One diagnostic per (op, primitive) pair — a `.map` building a card with
  // four nested primitives is ONE mistake, not four.
  const flagged = new Set<string>();
  const visit = (e: ExprIR): void => {
    // BOTH spellings of "this is a collection op": the `isCollectionOp` flag
    // lowering sets when the receiver types as a collection, and the catalogue
    // NAME.  A page-body binding is often type-erased (`rows` lowers with a
    // placeholder `string` type), so `rows.where(λ)` carries the flag OFF while
    // `rows.map(λ)` carries it on — keying on the flag alone would have caught
    // the audit's `.map` and missed its siblings.  The lambda-plus-markup
    // requirement below is what keeps this free of false positives: a lambda
    // ARGUMENT carrying a walker primitive has no legitimate reading, while a
    // primitive's own lambda SLOT (`Column("Name", i => Text { i.name })`) is a
    // `call`, never a `method-call`, so it never reaches here.
    if (e.kind === "method-call" && (e.isCollectionOp || isCollectionOpName(e.member))) {
      for (const arg of e.args) {
        if (arg.kind !== "lambda") continue;
        const primitive = arg.body ? markupInside(arg.body) : undefined;
        if (primitive === undefined) continue;
        const key = `${e.member}:${primitive}`;
        if (flagged.has(key)) continue;
        flagged.add(key);
        diags.push({
          severity: "error",
          code: "loom.markup-primitive-in-collection-lambda",
          message: diagMessage("loom.markup-primitive-in-collection-lambda", {
            op: e.member,
            primitive,
            param: arg.param,
          }),
          source: where,
        });
      }
    }
    walkExprChildren(e, { expr: visit, stmt: visitStmt });
  };
  const visitStmt = (s: StmtIR): void => walkStmtChildren(s, visit, visitStmt);
  for (const e of renderedExprs(host)) visit(e);
  for (const action of host.actions) for (const s of action.body) visitStmt(s);
}

// =========================================================================
// D4 — a `money` value in a slot that renders it as text
// =========================================================================

/** Primitive → the positional that renders a raw VALUE as text, and whether
 *  that slot WALKS a nested primitive.  Read off `WALKER_PRIMITIVE_SLOTS`'
 *  contracts: a one-slot text shape renders positional 0, the two-slot
 *  label/value shapes render positional 1.  Container primitives (`Stack`,
 *  `Card`, …) are absent — their positionals are children, walked as markup,
 *  never coerced to text.
 *
 *  `nested` decides which fix the diagnostic prints, and the two really do
 *  differ: `emitStat` / `emitKeyValueRow` walk a nested primitive in the value
 *  slot on purpose (`Stat { "Revenue", Money { t.revenue } }`), while
 *  `emitText` & friends route the slot through `localizedText`, which coerces
 *  it to a string — so `Text { Money { … } }` renders EMPTY. */
const TEXT_VALUE_SLOTS: ReadonlyMap<string, { readonly at: number; readonly nested: boolean }> =
  new Map([
    ["Text", { at: 0, nested: false }],
    ["Bold", { at: 0, nested: false }],
    ["Italic", { at: 0, nested: false }],
    ["InlineCode", { at: 0, nested: false }],
    ["Heading", { at: 0, nested: false }],
    ["Badge", { at: 0, nested: false }],
    ["Anchor", { at: 0, nested: false }],
    ["Alert", { at: 0, nested: false }],
    ["Empty", { at: 0, nested: false }],
    ["Button", { at: 0, nested: false }],
    ["CodeBlock", { at: 0, nested: false }],
    // Label / value pairs — the VALUE half is the text slot, and it walks.
    ["Stat", { at: 1, nested: true }],
    ["KeyValueRow", { at: 1, nested: true }],
  ]);

/** Row bindings in scope: lambda param → the aggregate whose wire shape its
 *  fields come from. */
type RowScope = ReadonlyMap<string, AggregateIR>;

export interface MoneySlotCtx {
  /** Every declared aggregate, by name — the `of:` receiver resolves into it. */
  aggByName: ReadonlyMap<string, AggregateIR>;
  /** The ui's `api X: Y` handle names, so `Catalog.Item.all` resolves like
   *  `Item.all` does (the walker's api-hook patterns A and D). */
  apiParamNames: ReadonlySet<string>;
}

/** `loom.money-in-text-slot` — a `money`-typed field read into a slot that
 *  renders it as text. */
export function checkMoneyInTextSlot(
  host: PageIR | ComponentIR,
  where: string,
  ctx: MoneySlotCtx,
  diags: LoomDiagnostic[],
): void {
  const flagged = new Set<string>();
  const visit = (e: ExprIR, scope: RowScope): void => {
    if (e.kind === "call" && e.callKind === "free") {
      const slot = TEXT_VALUE_SLOTS.get(e.name);
      const arg = slot === undefined ? undefined : positionalArgsOf(e)[slot.at];
      // A nested primitive already IS the fix where the slot walks one
      // (`Stat { "Revenue", Money { r.total } }`); where it does not, a nested
      // primitive is a different defect and not this gate's business.  Either
      // way, skipping it is what keeps this check free of false positives.
      const nestedPrimitive = arg?.kind === "call" && isWalkerPrimitive(arg.name);
      const field = arg && !nestedPrimitive ? moneyFieldRead(arg, scope) : undefined;
      if (slot !== undefined && field !== undefined) {
        const key = `${e.name}:${field.path}`;
        if (!flagged.has(key)) {
          flagged.add(key);
          // The two catalog keys are spelled out at their own call sites
          // rather than picked by a ternary: `diagnostic-catalog.test.ts`
          // reads the key STATICALLY, and a computed one reads as inline
          // wording (invariant 1) and leaves both entries orphaned
          // (invariant 3).  The param object is likewise spelled out TWICE
          // rather than hoisted into a shared `const`: a `diagMessage(key,
          // <variable>)` site is invisible to `diagnostic-message-hygiene`'s
          // param-agreement check and would need a waiver entry instead.
          diags.push({
            severity: "error",
            code: "loom.money-in-text-slot",
            message: slot.nested
              ? diagMessage("loom.money-in-text-slot#wrap", {
                  primitive: e.name,
                  path: field.path,
                  aggregate: field.aggregate,
                })
              : diagMessage("loom.money-in-text-slot#replace", {
                  primitive: e.name,
                  path: field.path,
                  aggregate: field.aggregate,
                }),
            source: where,
          });
        }
      }
    }
    const inner = extendScope(e, scope, ctx);
    walkExprChildren(e, {
      expr: (c) => visit(c, inner),
      stmt: (s) => visitStmt(s, inner),
    });
  };
  const visitStmt = (s: StmtIR, scope: RowScope): void =>
    walkStmtChildren(
      s,
      (c) => visit(c, scope),
      (n) => visitStmt(n, scope),
    );
  // A component's aggregate-typed PARAMS are already row bindings — the one
  // place a page body gets a typed row without a query.
  const seed = new Map<string, AggregateIR>();
  for (const p of host.params) {
    // An aggregate-typed param lowers to the `entity` marker (`lower-types.ts`).
    if (p.type.kind !== "entity") continue;
    const agg = ctx.aggByName.get(p.type.name);
    if (agg) seed.set(p.name, agg);
  }
  for (const e of renderedExprs(host)) visit(e, seed);
}

/** The row bindings `e` introduces for its own children.
 *
 *  Deliberately narrow — only the two shapes that bind a WHOLE aggregate row:
 *  a `QueryView`'s `data:` lambda over a resolvable `of:`, and a `For`'s item
 *  lambda over a collection that is already a bound row set.  Anything else
 *  leaves the scope untouched, so an unresolvable binding produces NO
 *  diagnostic rather than a guessed one. */
function extendScope(e: ExprIR, scope: RowScope, ctx: MoneySlotCtx): RowScope {
  if (e.kind !== "call" || e.callKind !== "free") return scope;
  const bind = (param: string, agg: AggregateIR): RowScope => {
    const next = new Map(scope);
    next.set(param, agg);
    return next;
  };
  if (e.name === "QueryView") {
    const data = namedOf(e, "data");
    const of = namedOf(e, "of");
    if (data?.kind === "lambda" && of) {
      const agg = aggregateOfRead(of, ctx);
      if (agg) return bind(data.param, agg);
    }
    return scope;
  }
  if (e.name === "For") {
    // `For` takes the collection and the lambda positionally in either order,
    // and also accepts `each:` for the collection.
    const positionals = positionalArgsOf(e);
    const lam = positionals.find((a) => a.kind === "lambda");
    const each =
      namedOf(e, "each") ?? positionals.find((a) => a.kind !== "lambda") ?? namedOf(e, "of");
    if (lam?.kind !== "lambda" || !each) return scope;
    // The collection is a bound row set (`For { each: rows, … }`) or a direct
    // read (`For { each: Item.all, … }`).
    const agg =
      (each.kind === "ref" ? scope.get(each.name) : undefined) ?? aggregateOfRead(each, ctx);
    if (agg) return bind(lam.param, agg);
  }
  return scope;
}

/** The aggregate a read expression returns rows of — the api-hook shapes the
 *  walker resolves (`Item.all`, `Catalog.Item.all`, and their call forms).
 *  `api-hook-detector.ts` owns the full pattern set, but it lives in the
 *  generator layer and `src/ir/` may not import it, so this mirrors only the
 *  two AGGREGATE patterns (A and D) — the ones that carry a row type. */
function aggregateOfRead(e: ExprIR, ctx: MoneySlotCtx): AggregateIR | undefined {
  const recv = e.kind === "member" || e.kind === "method-call" ? e.receiver : undefined;
  if (recv === undefined) return undefined;
  // Pattern D — `Item.all` / `Item.all(…)`.
  if (recv.kind === "ref") return ctx.aggByName.get(recv.name);
  // Pattern A — `<apiHandle>.Item.all`.
  if (recv.kind === "member" && recv.receiver.kind === "ref") {
    if (!ctx.apiParamNames.has(recv.receiver.name)) return undefined;
    return ctx.aggByName.get(recv.member);
  }
  return undefined;
}

/** `<boundRow>.<field>` where `<field>` is `money` on that row's aggregate. */
function moneyFieldRead(
  e: ExprIR,
  scope: RowScope,
): { path: string; aggregate: string } | undefined {
  if (e.kind !== "member" || e.receiver.kind !== "ref") return undefined;
  const agg = scope.get(e.receiver.name);
  if (!agg) return undefined;
  // Derived on demand (`wireFieldsForAggregate`) rather than read off a
  // stamped field: an aggregate carries no `wireShape` property.
  const f = wireFieldsForAggregate(agg).find((w) => w.name === e.member);
  if (f?.type.kind !== "primitive" || f.type.name !== "money") return undefined;
  return { path: `${e.receiver.name}.${e.member}`, aggregate: agg.name };
}

function namedOf(e: Extract<ExprIR, { kind: "call" }>, name: string): ExprIR | undefined {
  const i = e.argNames?.indexOf(name) ?? -1;
  return i >= 0 ? e.args[i] : undefined;
}

// =========================================================================

/** The expressions a frontend RENDERS for this host.  Mirrors
 *  `walkerRenderedExprs`, plus the store shape (whose body-less form carries
 *  only state initialisers). */
function renderedExprs(host: PageIR | ComponentIR | StoreIR): ExprIR[] {
  const out: ExprIR[] = [];
  const push = (e?: ExprIR) => {
    if (e) out.push(e);
  };
  if ("body" in host) push(host.body);
  if ("title" in host) push(host.title);
  if ("derived" in host) for (const d of host.derived) push(d.expr);
  for (const s of host.state) push(s.init);
  return out;
}
