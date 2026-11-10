// Phase ⑥ — `exists <Agg> [for write] as <row> where …` beyond the plain read.
//
// Two derivations, both pure functions of facts enrichment already holds:
//
// 1. WRITE SCOPE.  `exists X for write as x where p` quantifies over the rows
//    the caller may write: X's read scope AND X's write scope
//    (`writeScopeFilter`), the pair every instance mutation's command load
//    applies.  The write scope is a predicate over `this`; it is rebound to the
//    quantified row and ANDed onto `where`, so every renderer — the correlated
//    SQL EXISTS of a query position and the synthesized read below — sees one
//    plain predicate over the row.  An aggregate with no write scope is
//    writable wherever it is readable, so `for write` adds nothing there.
//
// 2. IN-APP READ.  A `requires` gate or an operation `when` is evaluated in the
//    application layer before any query, so its `exists` cannot be a subquery.
//    It becomes a call to a synthesized single-row find on the quantified
//    aggregate's repository (the key-lookup-find pattern: `synthesized`, never
//    a route): the find's filter is `where` with the row as `this`, and every
//    subterm that does not read the row — an operation parameter, a field of
//    the gated row, a principal claim — is lifted into a find parameter whose
//    argument the gate passes.  The find applies the quantified aggregate's
//    read scope like any read of it, so a gate sees exactly the rows the same
//    `exists` sees in a query position.  The node records the call as `read`.
//
// The nodes are updated in place: an `exists` node is one lowered object that
// the IR may reference from more than one site (a criterion inlined twice, a
// filter carried onto a projection), and every reference must see the same
// derived facts.  `DERIVED` keeps a second enrichment of the same lowered
// model from ANDing the write scope twice.

import type {
  AggregateIR,
  EnrichedBoundedContextIR,
  EnrichedSubdomainIR,
  ExistsReadIR,
  ExprIR,
  FindIR,
  OperationIR,
  ParamIR,
  RepositoryIR,
  TypeIR,
} from "../types/loom-ir.js";
import { inAppExists } from "../util/in-app-exists.js";
import { forEachContextExpr } from "../util/model-exprs.js";
import { isDenyFilter } from "../util/tenant-stance.js";
import { mapExprChildren, walkExprDeep } from "../util/walk.js";

type ExistsIR = Extract<ExprIR, { kind: "exists" }>;

const BOOL: TypeIR = { kind: "primitive", name: "bool" };

/** Nodes whose write scope has been ANDed in. */
const DERIVED = new WeakSet<ExistsIR>();

export function applyExistsDerivations(m: EnrichedSubdomainIR): EnrichedSubdomainIR {
  return { ...m, contexts: m.contexts.map(deriveContext) };
}

function deriveContext(ctx: EnrichedBoundedContextIR): EnrichedBoundedContextIR {
  const byName = new Map(ctx.aggregates.map((a) => [a.name, a] as const));
  let any = false;
  forEachContextExpr(ctx, ({ expr }) => {
    if (expr.kind !== "exists") return;
    any = true;
    if (!expr.forWrite || DERIVED.has(expr)) return;
    DERIVED.add(expr);
    const target = byName.get(expr.aggregate);
    if (target?.writeScopeFilter) {
      expr.where = and(expr.where, rebindThis(target.writeScopeFilter, expr));
    }
  });
  if (!any) return ctx;

  const additions = new Map<string, FindIR[]>();
  for (const host of ctx.aggregates) {
    for (const op of membersOf(host)) {
      inAppExists(op).forEach((x, i) => {
        const target = byName.get(x.aggregate);
        const repo = ctx.repositories.find((r) => r.aggregateName === x.aggregate);
        if (!target || !repo) return;
        const name = `existsFor${host.name}${pascal(op.name)}${i}`;
        const derived = existsFind(name, x, target);
        if (!derived) return;
        x.read = { repository: repo.name, find: name, args: derived.args } satisfies ExistsReadIR;
        const list = additions.get(repo.name) ?? [];
        if (!list.some((f) => f.name === name)) list.push(derived.find);
        additions.set(repo.name, list);
      });
    }
  }
  if (additions.size === 0) return ctx;
  const repositories: RepositoryIR[] = ctx.repositories.map((r) => {
    const add = (additions.get(r.name) ?? []).filter(
      (f) => !r.finds.some((g) => g.name === f.name),
    );
    return add.length ? { ...r, finds: [...r.finds, ...add] } : r;
  });
  return { ...ctx, repositories };
}

/** The members whose gates the application layer evaluates. */
function membersOf(agg: AggregateIR): OperationIR[] {
  // A private operation has no handler of its own: its caller is in-app.
  return [
    ...agg.creates,
    ...agg.operations.filter((o) => o.visibility === "public"),
    ...agg.destroys,
  ];
}

/** The synthesized find behind one in-app `exists`, or undefined when a
 *  row-free subterm has no type to declare its parameter with. */
function existsFind(
  name: string,
  x: ExistsIR,
  target: AggregateIR,
): { find: FindIR; args: ExprIR[] } | undefined {
  const params: ParamIR[] = [];
  const args: ExprIR[] = [];
  let ok = true;
  const lift = (e: ExprIR, hint: TypeIR | undefined): ExprIR => {
    if (!readsRow(e, x.binding)) {
      if (isInline(e)) return e;
      const type = typeOf(e) ?? hint;
      if (!type) {
        ok = false;
        return e;
      }
      const p = `arg${params.length}`;
      params.push({ name: p, type });
      args.push(e);
      return { kind: "ref", name: p, refKind: "param", type };
    }
    if (e.kind === "ref" && e.refKind === "row" && e.name === x.binding) return { kind: "this" };
    if (e.kind === "binary") {
      return {
        ...e,
        left: lift(e.left, typeOf(e.right) ?? e.rightType),
        right: lift(e.right, typeOf(e.left) ?? e.leftType),
      };
    }
    return mapExprChildren(e, (c) => lift(c, undefined));
  };
  const filter = lift(x.where, undefined);
  if (!ok) return undefined;
  const entity: TypeIR = { kind: "entity", name: target.name };
  return {
    find: {
      name,
      params,
      returnType: { kind: "optional", inner: entity },
      filter,
      takeFirst: true,
      synthesized: true,
    },
    args,
  };
}

/** Subterms a find filter keeps as they are: constants, which read nothing
 *  from the gate's scope. */
function isInline(e: ExprIR): boolean {
  let reads = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "this" || x.kind === "id") reads = true;
    if (x.kind === "ref" && x.refKind !== "enum-value") reads = true;
  });
  return !reads;
}

function readsRow(e: ExprIR, binding: string): boolean {
  let found = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "ref" && x.refKind === "row" && x.name === binding) found = true;
  });
  return found;
}

function typeOf(e: ExprIR): TypeIR | undefined {
  switch (e.kind) {
    case "member":
      return e.memberType;
    case "ref":
      return e.type;
    case "paren":
      return typeOf(e.inner);
    case "binary":
      return e.resultType;
    case "unary":
      return e.op === "!" ? BOOL : typeOf(e.operand);
    // No type on the node itself: the lift falls back to the comparison's
    // other side, and refuses the gate when there is none.
    case "literal":
    case "this":
    case "id":
    case "action-ref":
    case "authz-filter":
    case "call":
    case "convert":
    case "duration":
    case "exists":
    case "i18nFormat":
    case "lambda":
    case "list":
    case "match":
    case "method-call":
    case "modelText":
    case "new":
    case "object":
    case "ternary":
      return undefined;
    default: {
      const _exhaustive: never = e;
      return _exhaustive;
    }
  }
}

/** `p` with its `this` (and bare fields) rebound to the quantified row. */
function rebindThis(p: ExprIR, x: ExistsIR): ExprIR {
  const rowType: TypeIR = { kind: "entity", name: x.aggregate };
  const row: ExprIR = { kind: "ref", name: x.binding, refKind: "row", type: rowType };
  const rowId: ExprIR = {
    kind: "member",
    receiver: row,
    member: "id",
    receiverType: rowType,
    memberType: { kind: "id", targetName: x.aggregate },
  };
  const go = (e: ExprIR): ExprIR => {
    // `deny write`: no row is writable.  Spelled as a test of the row (its
    // never-null key) because a query predicate must test a column — a bare
    // `false` is not one.
    if (isDenyFilter(e)) {
      return {
        kind: "binary",
        op: "==",
        left: rowId,
        right: { kind: "literal", lit: "null", value: "null" },
        leftType: { kind: "id", targetName: x.aggregate },
        resultType: BOOL,
      };
    }
    if (e.kind === "this") return row;
    if (e.kind === "id") return rowId;
    if (e.kind === "ref" && e.refKind === "this-prop") {
      return {
        kind: "member",
        receiver: row,
        member: e.name,
        receiverType: rowType,
        memberType: e.type ?? { kind: "primitive", name: "string" },
      };
    }
    // Inside a nested quantifier `this` still names the write-scoped row, so
    // the rebinding recurses into it too.
    return mapExprChildren(e, go);
  };
  return go(p);
}

function and(l: ExprIR, r: ExprIR): ExprIR {
  return {
    kind: "binary",
    op: "&&",
    left: { kind: "paren", inner: l },
    right: { kind: "paren", inner: r },
    leftType: BOOL,
    rightType: BOOL,
    resultType: BOOL,
  };
}

function pascal(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}
