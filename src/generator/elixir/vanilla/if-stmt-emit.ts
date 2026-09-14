// ---------------------------------------------------------------------------
// The `if` STATEMENT on the vanilla Phoenix backend (M-T6.59).
//
// Elixir is immutable, so every Phoenix body renderer threads its result
// through a REBOUND variable (`record` in an aggregate body, the bare value in
// a pure `function` / `domainService` body).  A binding made inside an `if`
// block does NOT escape that block, so the naive rendering
//
//     if cond do
//       record = %{record | tier: "gold"}
//     end
//
// compiles clean under `--warnings-as-errors` and then silently does nothing —
// the exact silent-drop class the repo's gates exist to prevent, which is why
// `loom.elixir-if-stmt-unsupported` refused the statement outright.
//
// The shape that WORKS is a value-producing branch: the `if` is an expression
// whose every arm ends in the threaded variable, and the whole expression
// rebinds it.
//
//     record =
//       if cond do
//         record = %{record | tier: "gold"}
//         record
//       else
//         record = %{record | tier: "bronze"}
//         record
//       end
//
// An `else` arm is ALWAYS emitted (an `if` with no `else` answers `nil` in
// Elixir, which would null the threaded variable) — the synthesised arm is
// just the variable itself.
//
// WHAT STAYS GATED.  Three sub-shapes do not fit this rendering and keep an
// (each strictly narrower) arm in `if-stmt-checks.ts`:
//
//   * `#return-in-branch` — a `return` inside a branch is an EARLY EXIT.  The
//     returning-op path emits `{:ok, …}` / `{:error, …}` tuples as the body's
//     TAIL expression and appends a persist tail after the body, so an early
//     return has to restructure the statements that FOLLOW the `if` into a
//     `case` arm — a list-level transform, not a statement-level one, and one
//     that would break the same-length/same-order `statementSubRegions`
//     zip the sourcemap collector depends on.
//   * `#guard-in-branch` — a `precondition`/`requires` nested in a branch.
//     The op path HOISTS top-level guards into a leading `with :ok <- ensure(…)`
//     chain so a failed guard answers 403/422; a nested one would fall through
//     to the inline `raise` arm and answer 500 instead — a wire divergence from
//     the other four backends, which is worse than the honest refusal.
//   * `#event-sourced` — an event-sourced command body is not a statement list
//     at all: `eventsourced-emit.ts` sorts its statements into `with`-chain
//     guard clauses, `let` preambles and an `events = [...]` list, so a
//     conditional `emit` has no place to render.
// ---------------------------------------------------------------------------

import type { StmtIR } from "../../../ir/types/loom-ir.js";

/** Every line of `text` shifted right by `pad`.  Blank lines are left blank so
 *  no trailing whitespace reaches the emitted file (`mix compile
 *  --warnings-as-errors` and Biome both flag it). */
function indentBlock(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l))
    .join("\n");
}

export interface ElixirIfOpts {
  /** Indent of the `if` / `else` / `end` keywords themselves, e.g. `"    "`. */
  readonly indent: string;
  /** The rebound thread variable each arm must produce (`"record"`,
   *  `"state"`, …).  Omit in a pure/value body, where the `if` expression IS
   *  the body's value and nothing needs rebinding. */
  readonly threadVar?: string;
  /** The already-rendered condition. */
  readonly cond: string;
  /** Render a nested statement list.  Returns one entry per statement, each
   *  possibly multi-line, indented however the caller's own renderer indents —
   *  this helper re-indents the whole block, so relative structure is all that
   *  matters. */
  readonly renderInner: (stmts: readonly StmtIR[]) => string[];
}

/** Render an `if` STATEMENT as a value-producing Elixir `if` expression. */
export function renderElixirIfStmt(s: Extract<StmtIR, { kind: "if" }>, opts: ElixirIfOpts): string {
  const { indent, threadVar, cond, renderInner } = opts;
  const inner = indent + "  ";
  const arm = (stmts: readonly StmtIR[] | undefined): string[] => {
    const rendered = (stmts ?? []).map((st) => indentBlock(renderInner([st]).join("\n"), "  "));
    // The arm's VALUE.  With a thread variable every arm answers it (so the
    // rebind is a no-op on the untaken branch); without one, the last
    // statement's own value is the arm's value, and an EMPTY arm answers `nil`.
    if (threadVar) return [...rendered, `${inner}${threadVar}`];
    return rendered.length > 0 ? rendered : [`${inner}nil`];
  };
  const head = threadVar ? `${indent}${threadVar} = if ${cond} do` : `${indent}if ${cond} do`;
  return [head, ...arm(s.thenBody), `${indent}else`, ...arm(s.elseBody), `${indent}end`].join("\n");
}
