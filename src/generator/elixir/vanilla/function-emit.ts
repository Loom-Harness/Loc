import type {
  AggregateIR,
  ExprIR,
  FunctionBodyIR,
  FunctionIR,
  StmtIR,
} from "../../../ir/types/loom-ir.js";
import { walkStmtExprsDeep } from "../../../ir/util/walk.js";
import { elixirIfRefusal } from "../../../ir/validate/checks/if-stmt-checks.js";
import { escapeElixirIdent, snake, upperFirst } from "../../../util/naming.js";
import { exprUsesParam, exprUsesReceiver } from "../domain/predicates.js";
import { type RenderCtx, renderExpr, renderTypespec } from "../render-expr.js";
import { appModuleOf, guardRaiseLine } from "./denial.js";
import { renderElixirIfStmt } from "./if-stmt-emit.js";

// ---------------------------------------------------------------------------
// Body-variant helpers (domain-services.md rev. 4 — `function` block body).
//
// The expression form (`= Expression`) renders byte-identically to before;
// the block form (`{ Statement* }`) is a PURE Elixir function — `let x = …`
// becomes a binding, `precondition`/`requires` become bug-/auth-regime raises,
// and the final `return`/expression supplies the bare value the function
// yields.  No `{:ok, …}` tuple wrapping: a `function` returns its value
// directly (unlike a returning `operation`).
// ---------------------------------------------------------------------------

/** Every expression a function body reaches into — the single body expr, or
 *  every statement's expressions in the block form.  Lets the
 *  param-/receiver-/money-usage predicates treat both variants uniformly. */
function bodyExprs(body: FunctionBodyIR): ExprIR[] {
  if ("expr" in body) return [body.expr];
  const out: ExprIR[] = [];
  // Rides `walkStmtExprsDeep` rather than a hand-rolled `switch (s.kind)`: the
  // hand-rolled version listed five kinds and had no `if` arm, so once
  // M-T6.59 let an `if` into a `function` body, a parameter read ONLY inside a
  // branch was invisible to `bodyUsesParam` — the emitter then underscored the
  // parameter and the branch referenced an undefined variable.  The
  // `ir-walk-census` rule exists for exactly this drift.
  for (const s of body.stmts) walkStmtExprsDeep(s, (e) => out.push(e));
  return out;
}

export function bodyUsesParam(body: FunctionBodyIR, name: string): boolean {
  return bodyExprs(body).some((e) => exprUsesParam(e, name));
}

export function bodyUsesReceiver(body: FunctionBodyIR): boolean {
  return bodyExprs(body).some((e) => exprUsesReceiver(e));
}

/** The body lines for a function — the single trailing-value line for the
 *  expression form, or the rendered pure block for the block form. */
export function renderFunctionBodyLines(body: FunctionBodyIR, rc: RenderCtx): string[] {
  if ("expr" in body) return [`    ${renderExpr(body.expr, rc)}`];
  // M-T6.59 — assert the `if` sub-shapes a tail-value body cannot express with
  // the SAME predicate the phase-⑦ gate uses, so a bypassed validator fails
  // loudly instead of emitting a body that drops an early exit.
  const ifRefusal = elixirIfRefusal(body.stmts, "value");
  if (ifRefusal) {
    throw new Error(
      `platform: elixir — an 'if' statement with a ${ifRefusal} reached the vanilla ` +
        "aggregate-function emitter; it is refused at validation " +
        `(loom.elixir-if-stmt-unsupported#${ifRefusal}).`,
    );
  }
  return renderPureBlock(body.stmts, rc);
}

/** Render a pure block-body function as Elixir: binding/guard lines followed
 *  by a trailing bare value (the last `return`'s value, or the final
 *  expression).  Each line is two-space indented under the `def … do`. */
function renderPureBlock(stmts: StmtIR[], rc: RenderCtx): string[] {
  const lines: string[] = [];
  for (const s of stmts) {
    switch (s.kind) {
      case "let":
        lines.push(`    ${escapeElixirIdent(snake(s.name))} = ${renderExpr(s.expr, rc)}`);
        break;
      case "precondition":
      case "requires":
        // The typed `<App>.GuardError` — its `:kind` field is what the
        // controller rescue routes on, so `:message` carries the author's
        // `message "…"` when there is one (M-T6.20).
        lines.push(guardRaiseLine(s, renderExpr(s.expr, rc), appModuleOf(rc.contextModule)));
        break;
      case "return":
        // A `function` yields its value directly (no `{:ok, …}` wrap).  The
        // last statement's value is the function's result; an earlier `return`
        // simply binds the value as the trailing expression of that point —
        // pure bodies don't branch, so the final return wins.
        lines.push(`    ${renderExpr(s.value, rc)}`);
        break;
      case "expression":
        lines.push(`    ${renderExpr(s.expr, rc)}`);
        break;
      case "if":
        // M-T6.59 — a pure `function` body is a TAIL-VALUE body: its value is
        // its last expression, so a tail `if` whose branches `return` renders
        // exactly as the function's result.  The sub-shapes that cannot render
        // (a non-tail `return`, a nested guard) are refused at phase ⑦ by
        // `loom.elixir-if-stmt-unsupported` and re-asserted by the caller.
        lines.push(
          renderElixirIfStmt(s, {
            indent: "    ",
            cond: renderExpr(s.cond, rc),
            renderInner: (inner) => renderPureBlock([...inner], rc),
          }),
        );
        break;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Aggregate `function` members (vanilla Ecto/Phoenix backend) — gap §11b.
//
// An aggregate `function passed(): bool = total > 100` is a PURE domain helper
// usable from op / precondition / derived bodies (`precondition passed()`).  The
// other backends carry it as a method on the rich-domain object, so the call
// site renders `this.passed()` (TS) / `record.Passed()` (.NET).  Vanilla has no
// class, so the call lowers (render-expr `callKind: "function"`) to
// `passed(record, <args>)` — a module-level function taking the aggregate
// struct as its first argument.  This module emits that function, without which
// `mix compile` fails on the undefined reference.
//
// It is emitted into the SAME module the referencing op bodies render into — the
// context-facade module (`<App>.<Ctx>`), where `<op>_<agg>(record, params)`
// lives.  A struct-guarded clause head (`def passed(%Agg{} = record, …)`) lets
// two aggregates in one context that both declare a same-named function coexist
// (Elixir dispatches by the struct guard) without redefining each other.  The
// body renders through `ELIXIR_TARGET` with `thisName: "record"` — exactly the
// receiver the call site binds.
// ---------------------------------------------------------------------------

/** True when the aggregate declares at least one `function` member. */
export function aggHasFunctions(agg: AggregateIR): boolean {
  return (agg.functions?.length ?? 0) > 0;
}

/** Render every `function` member of an aggregate as a module-level Elixir
 *  function (struct-guarded on the aggregate type), two-space indented for the
 *  context-facade module body.  Returns `[]` for a function-less aggregate, so
 *  such an aggregate emits byte-identical output.
 *
 *  `doc` (Route A): a `shape: document` aggregate rehydrates its blob into
 *  a `%<Agg>.Data{}` embedded struct, so its functions take THAT struct (guarded
 *  `%<Agg>.Data{} = record`) and read fields off it (`record.<field>`) in struct
 *  mode — same relational renderer, no `docMap` fork.  The op bodies call them as
 *  `<fn>(record, …)` where `record` is the embed. */
export function renderAggregateFunctions(
  facadeMod: string,
  agg: AggregateIR,
  doc = false,
  /** Function keys (see {@link contextFunctionKey}) this aggregate must NOT
   *  emit here — the ones another aggregate in the same context also declares,
   *  which {@link renderSharedFunctionClauses} emits grouped instead. */
  hoisted: ReadonlySet<string> = new Set(),
): string[] {
  if (!aggHasFunctions(agg)) return [];
  const aggModule = `${facadeMod}.${upperFirst(agg.name)}`;
  const rc: RenderCtx = {
    thisName: "record",
    contextModule: facadeMod,
    ...(doc ? { docStruct: true } : {}),
  };
  const out: string[] = [];
  for (const fn of agg.functions) {
    if (hoisted.has(contextFunctionKey(fn))) continue;
    out.push("", ...renderFunction(facadeMod, aggModule, fn, rc, doc));
  }
  return out;
}

/** The identity a pure aggregate `function` takes IN THE CONTEXT MODULE: its
 *  snake name and its arity, receiver included.  Two aggregates declaring
 *  `function isDraft()` collapse onto the same `is_draft/1`. */
export function contextFunctionKey(fn: FunctionIR): string {
  return `${snake(fn.name)}/${fn.params.length + 1}`;
}

/** Function keys declared by MORE THAN ONE aggregate in a context.
 *
 *  Elixir requires clauses of one name/arity to be ADJACENT, and every
 *  aggregate's functions are emitted inside its own section of the flat
 *  context module — so two aggregates declaring `function isDraft()` produced
 *  two `def is_draft/1` clauses hundreds of lines apart, plus a second `@doc`
 *  for the same function.  `mix compile --warnings-as-errors` — the repo's own
 *  `test:phoenix` tier — fails on both ("clauses with the same name and arity
 *  should be grouped together", "redefining @doc attribute previously set at
 *  line N"), and the duplicate `@doc` silently DISCARDS the first aggregate's
 *  documentation even when warnings are tolerated.  From a model that
 *  validated `0 error(s), 0 warning(s)`. */
export function sharedFunctionKeys(aggregates: readonly AggregateIR[]): Set<string> {
  const seen = new Map<string, number>();
  for (const agg of aggregates) {
    for (const fn of agg.functions ?? []) {
      const k = contextFunctionKey(fn);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

/** The GROUPED block for every shared key: one `@doc` naming each owner, then
 *  every clause's `@spec` (Elixir accumulates them for the next definition),
 *  then the `def` clauses back to back.
 *
 *  Only shared keys move.  A context whose function names are all distinct
 *  emits nothing here and keeps its per-aggregate sections byte-identical. */
export function renderSharedFunctionClauses(
  facadeMod: string,
  aggregates: readonly AggregateIR[],
  shared: ReadonlySet<string>,
  /** Per-aggregate document-layout predicate — the same `isDoc` the caller's
   *  own loop computes, since the receiver struct differs (`<Agg>.Data` vs
   *  `<Agg>`) and two owners of one function name need not share a layout. */
  isDoc: (agg: AggregateIR) => boolean = () => false,
): string[] {
  if (shared.size === 0) return [];
  // Deterministic: keys in declaration order of first appearance, owners in
  // the context's own aggregate order.
  const byKey = new Map<string, { agg: AggregateIR; fn: FunctionIR }[]>();
  for (const agg of aggregates) {
    for (const fn of agg.functions ?? []) {
      const k = contextFunctionKey(fn);
      if (!shared.has(k)) continue;
      const list = byKey.get(k) ?? [];
      list.push({ agg, fn });
      byKey.set(k, list);
    }
  }
  const out: string[] = [];
  for (const [, owners] of byKey) {
    const first = owners[0] as { agg: AggregateIR; fn: FunctionIR };
    const fnSnake = snake(first.fn.name);
    const names = owners.map((o) => upperFirst(o.agg.name)).join("`, `");
    out.push(
      "",
      `  @doc "Pure domain function \`${first.fn.name}\` on \`${names}\`."`,
      ...owners.map(({ agg, fn }) =>
        functionSpecLine(facadeMod, `${facadeMod}.${upperFirst(agg.name)}`, fn, isDoc(agg)),
      ),
      ...owners.flatMap(({ agg, fn }) =>
        functionClauseLines(
          `${facadeMod}.${upperFirst(agg.name)}`,
          fn,
          {
            thisName: "record",
            contextModule: facadeMod,
            ...(isDoc(agg) ? { docStruct: true } : {}),
          },
          isDoc(agg),
        ),
      ),
    );
  }
  return out;
}

function renderFunction(
  facadeMod: string,
  aggModule: string,
  fn: FunctionIR,
  rc: RenderCtx,
  doc = false,
): string[] {
  const aggLeaf = aggModule.split(".").pop() ?? aggModule;
  // The attributes and the clause are rendered by the same two helpers the
  // GROUPED path uses, so a hoisted shared function and a solitary one cannot
  // diverge in signature, receiver-underscoring or typespec.
  return [
    `  @doc "Pure domain function \`${fn.name}\` on \`${aggLeaf}\`."`,
    functionSpecLine(facadeMod, aggModule, fn, doc),
    ...functionClauseLines(aggModule, fn, rc, doc),
  ];
}

/** The `@spec` line for one clause — split out so the grouped renderer can
 *  stack one per owner ahead of the shared `def`s. */
function functionSpecLine(
  facadeMod: string,
  aggModule: string,
  fn: FunctionIR,
  doc: boolean,
): string {
  const structMod = doc ? `${aggModule}.Data` : aggModule;
  const specArgs = [
    `${structMod}.t()`,
    ...fn.params.map((p) => renderTypespec(p.type, facadeMod)),
  ].join(", ");
  return `  @spec ${snake(fn.name)}(${specArgs}) :: ${renderTypespec(fn.returnType, facadeMod)}`;
}

/** The `def … do … end` clause for one owner, with no attributes attached. */
function functionClauseLines(
  aggModule: string,
  fn: FunctionIR,
  rc: RenderCtx,
  doc: boolean,
): string[] {
  const params = fn.params.map((p) =>
    bodyUsesParam(fn.body, p.name) ? snake(p.name) : `_${snake(p.name)}`,
  );
  const recv = bodyUsesReceiver(fn.body) ? "record" : "_record";
  const structMod = doc ? `${aggModule}.Data` : aggModule;
  const recvHead = `%${structMod}{} = ${recv}`;
  const sig = params.length > 0 ? `${recvHead}, ${params.join(", ")}` : recvHead;
  return [`  def ${snake(fn.name)}(${sig}) do`, ...renderFunctionBodyLines(fn.body, rc), "  end"];
}
