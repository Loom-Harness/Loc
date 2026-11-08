// ---------------------------------------------------------------------------
// A Phoenix operation body whose `if` decides, per path, what the operation
// persists, guards, emits or returns — rendered as one complete body per path.
//
// An Elixir body has no early exit and no statement that runs "later, if this
// branch was taken": an operation's guards lead the body as a `with` chain, its
// `emit`s are dispatched after the persist commits, and its result is the
// body's tail expression.  So an `if` whose branch holds a `return`, a guard,
// an `emit` or a provenanced write is first put in branch-total form for those
// statements (`toBranchTotal`, `src/ir/util/if-normal-form.ts` — the same
// rewrite lowering applies for `return` on every backend): the statements after
// it move into each branch, so the `if` is the body's last statement.  Each
// path through the resulting tree is then a straight-line body, and each leaf
// renders exactly as a linear operation would — its own guard `with`, its own
// persist, its own post-commit dispatch, its own result:
//
//     operation ship(): Order or AlreadyShipped {    if record.status == :shipped do
//       if status == Shipped {                         {:error, "AlreadyShipped", …}
//         return AlreadyShipped { … }       ==>      else
//       }                                              with :ok <- ensure(record.stock > 0, …) do
//       precondition stock > 0                           record = %{record | stock: …}
//       stock := stock - 1                               <persist, dispatch, {:ok, …}>
//       emit OrderShipped { … }                        end
//       return this                                  end
//     }
//
// A path is DERIVED from the body on demand (`opPaths`), never stored: a
// predicate that asks "does this operation persist / emit / guard" asks it of
// every path.  A body with no such `if` is its own single path, so every
// existing operation renders byte-identically.
// ---------------------------------------------------------------------------

import type { ExprIR, OperationIR, StmtIR } from "../../../ir/types/loom-ir.js";
import { branchesContain, toBranchTotal } from "../../../ir/util/if-normal-form.js";
import { stmtHasProv } from "../../../ir/util/prov-id.js";

type GuardStmt = Extract<StmtIR, { kind: "precondition" | "requires" }>;

/** A statement whose effect an Elixir body decides per path. */
function decidedPerPath(s: StmtIR): boolean {
  return (
    s.kind === "return" ||
    s.kind === "precondition" ||
    s.kind === "requires" ||
    s.kind === "emit" ||
    stmtHasProv(s)
  );
}

/** True when `s` is an `if` the tree renderer splits into paths. */
function isPathIf(s: StmtIR | undefined): s is Extract<StmtIR, { kind: "if" }> {
  return s?.kind === "if" && branchesContain(s, decidedPerPath);
}

/** `stmts` in branch-total form for the statements decided per path. */
function opTreeStmts(stmts: readonly StmtIR[]): StmtIR[] {
  return toBranchTotal(stmts, decidedPerPath);
}

/** True when `stmts` renders as a path tree rather than one linear body. */
export function isOpTree(stmts: readonly StmtIR[]): boolean {
  return isPathIf(opTreeStmts(stmts).at(-1));
}

/** The straight-line statement lists of every path through `stmts` (the path
 *  `if`s themselves dropped — their conditions are what chose the path). */
function pathStmts(stmts: readonly StmtIR[], prefix: readonly StmtIR[]): StmtIR[][] {
  const last = stmts.at(-1);
  if (!isPathIf(last)) return [[...prefix, ...stmts]];
  const own = [...prefix, ...stmts.slice(0, -1)];
  return [...pathStmts(last.thenBody, own), ...pathStmts(last.elseBody ?? [], own)];
}

/** Every path of `op` as a linear operation — `[op]` itself when its body is
 *  not a tree.  A predicate over an operation that may branch per path asks it
 *  of each of these. */
export function opPaths<T extends Pick<OperationIR, "statements">>(op: T): T[] {
  const tree = opTreeStmts(op.statements);
  if (!isPathIf(tree.at(-1))) return [op];
  return pathStmts(tree, []).map((statements) => ({ ...op, statements }));
}

/** Indent every non-blank line of `lines` by `pad`. */
function indentLines(lines: readonly string[], pad: string): string[] {
  return lines
    .join("\n")
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l));
}

export interface OpTreeRender {
  /** Render one statement of a segment that leads into a path `if` (never a
   *  guard or an `emit` — those belong to the leaves' paths).  `index` is the
   *  statement's position in its path, so per-statement temporaries stay
   *  distinct across a path. */
  readonly renderStmt: (s: StmtIR, index: number) => string;
  readonly renderCond: (e: ExprIR) => string;
  /** The `with` clauses for the guards a NON-root segment leads with.  The
   *  root segment's guards are the operation's own, rendered by the caller. */
  readonly guardClauses: (guards: readonly GuardStmt[]) => string[];
  /** Render a leaf: `path` is every statement on the way to it (the leaf's own
   *  `segment` last), and the result is the leaf's body lines followed by its
   *  tail, at the operation body's 4-space indent.  Only `segment`'s
   *  statements are rendered as body lines — the earlier ones already ran. */
  readonly renderLeaf: (path: StmtIR[], segment: readonly StmtIR[]) => string[];
  /** Lines a NON-root segment binds ahead of its guard `with` — for a body
   *  whose guards may read the segment's `let`s (an event-sourced command
   *  binds every `let` before its guards). */
  readonly leadLines?: (segment: readonly StmtIR[]) => string[];
}

/** Render a path tree: the lines of an operation body (4-space indent) that
 *  replace the linear `[...bodyLines, ...tail]`. */
export function renderOpTree(stmts: readonly StmtIR[], r: OpTreeRender): string[] {
  return renderSegment(opTreeStmts(stmts), [], r, true);
}

function renderSegment(
  segment: readonly StmtIR[],
  prefix: readonly StmtIR[],
  r: OpTreeRender,
  root: boolean,
): string[] {
  const last = segment.at(-1);
  let inner: string[];
  if (isPathIf(last)) {
    const own = segment.slice(0, -1);
    const path = [...prefix, ...own];
    const lines = own.flatMap((s) =>
      s.kind === "precondition" || s.kind === "requires" || s.kind === "emit"
        ? []
        : [r.renderStmt(s, prefix.length + own.indexOf(s))],
    );
    inner = [
      ...lines,
      `    if ${r.renderCond(last.cond)} do`,
      ...indentLines(renderSegment(last.thenBody, path, r, false), "  "),
      "    else",
      ...indentLines(renderSegment(last.elseBody ?? [], path, r, false), "  "),
      "    end",
    ];
  } else {
    inner = r.renderLeaf([...prefix, ...segment], segment);
  }
  if (root) return inner;
  const lead = r.leadLines?.(segment) ?? [];
  const guards = segment.filter(
    (s): s is GuardStmt => s.kind === "precondition" || s.kind === "requires",
  );
  if (guards.length === 0) return [...lead, ...inner];
  return [
    ...lead,
    `    with ${r.guardClauses(guards).join(",\n         ")} do`,
    ...indentLines(inner, "  "),
    "    end",
  ];
}
