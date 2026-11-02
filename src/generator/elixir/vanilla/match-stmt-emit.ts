// ---------------------------------------------------------------------------
// The statement `match` in an operation / domain-service body on the vanilla
// Phoenix backend.
//
// The `if` statement's reasoning holds (`if-stmt-emit.ts`): Elixir is
// immutable and a binding made inside a `case` clause does not escape it, so
// the `match` is a value-producing expression whose every clause ends in the
// threaded variable, and the whole expression rebinds it:
//
//     record =
//       case Function.identity(q) do
//         {:ok, rc} ->
//           record = %{record | code: rc.code}
//           record
//         {:error, "Rejected", e} ->
//           record = %{record | code: e.reason}
//           record
//       end
//
// A union subject's runtime value is the tagged tuple an `or`-returning call
// answers (the expression `match`'s `matchVariant` leaf reads the same shape):
// the success variant arrives bare in `{:ok, value}` — a scalar variant
// included, so its binding is the value itself — and an `error` variant as
// `{:error, "Tag", fields}`.  An arm whose body never reads its binding binds
// `_`, so `mix compile --warnings-as-errors` stays clean.  A `_` clause runs
// the `else` body, and is emitted whenever the arms do not name every variant,
// so an uncovered value takes the no-op path instead of raising
// `CaseClauseError`.
//
// A `T?` subject is a presence check — its arm bindings are aliased to the
// subject at lowering — so it renders as the `if` statement does:
// `record = if n != nil do … record else … record end`.
//
// Without a thread variable (a domain-service body, whose value is its tail
// expression) a clause answers its last statement's value, so a tail `match`
// whose every arm `return`s IS the function's value.
//
// The sub-shapes this rendering cannot express are refused at phase ⑦ by
// `loom.elixir-match-stmt-unsupported` (`elixir-match-stmt-checks.ts`).
// ---------------------------------------------------------------------------

import { typeKey, variantTag } from "../../../ir/stdlib/unions.js";
import type { StmtIR, TypeIR } from "../../../ir/types/loom-ir.js";
import { walkStmtExprsDeep } from "../../../ir/util/walk.js";
import { escapeElixirIdent, snake } from "../../../util/naming.js";
import { renderElixirIfStmt } from "./if-stmt-emit.js";

type MatchStmt = Extract<StmtIR, { kind: "variant-match" }>;

/** Every line of `text` shifted right by `pad`; blank lines stay blank. */
function indentBlock(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l))
    .join("\n");
}

export interface ElixirMatchOpts {
  /** Indent of the `case` / `end` keywords themselves, e.g. `"    "`. */
  readonly indent: string;
  /** The rebound thread variable each clause must produce (`"record"`).  Omit
   *  in a tail-value body, where the `case` IS the body's value. */
  readonly threadVar?: string;
  /** The already-rendered subject (a name — `loom.match-subject-not-simple`). */
  readonly subject: string;
  /** Render a nested statement list, one entry per statement (possibly
   *  multi-line), at the caller's own base indent — this helper re-indents. */
  readonly renderInner: (stmts: readonly StmtIR[]) => string[];
}

/** Whether any statement in `body` reads the arm binding `name`. */
function armReadsBinding(body: readonly StmtIR[], name: string): boolean {
  let found = false;
  for (const st of body) {
    walkStmtExprsDeep(st, (e) => {
      if (e.kind === "ref" && e.refKind === "match-binding" && e.name === name) found = true;
    });
  }
  return found;
}

/** The `case` pattern for one arm of a union `match`: `{:ok, b}` for the
 *  success variant, `{:error, "Tag", b}` for an `error` one.  `binder` is the
 *  arm's bound name, or `_` when the arm never reads it.  Shared by the
 *  operation, workflow and reactor renderers. */
export function elixirVariantPattern(
  arm: { readonly varType: TypeIR; readonly isError?: boolean },
  binder: string,
): string {
  return arm.isError
    ? `{:error, ${JSON.stringify(variantTag(arm.varType))}, ${binder}}`
    : `{:ok, ${binder}}`;
}

/** The `case` scrutinee for a union subject.  The compiler infers the
 *  producer's return type across modules, so an arm for a variant the producer
 *  happens never to answer (a domain service that only ever succeeds) is a
 *  "clause will never match" warning, which `--warnings-as-errors` fails on.
 *  The arm is still the author's declared contract, so the subject goes
 *  through `Function.identity/1`, which the checker types as dynamic. */
export function elixirUnionScrutinee(subject: string): string {
  return `Function.identity(${subject})`;
}

/** True when the arms name every variant of the union subject, so the `case`
 *  needs no `_` clause of its own. */
export function armsCoverUnion(
  subjectType: TypeIR | undefined,
  arms: readonly { readonly varType: TypeIR }[],
): boolean {
  if (subjectType?.kind !== "union") return false;
  const named = new Set(arms.map((a) => typeKey(a.varType)));
  return subjectType.variants.every((v) => named.has(typeKey(v)));
}

/** The two sides of a `T?` subject's presence check: the body that runs on
 *  present (the `T` arm, else the `else` body) and on absent (the `none` arm,
 *  else the `else` body). */
function presenceSides(s: MatchStmt): { present: StmtIR[]; absent: StmtIR[] } {
  const isAbsentArm = (a: MatchStmt["arms"][number]) => a.varType.kind === "none" || a.isError;
  const presentArm = s.arms.find((a) => !isAbsentArm(a));
  const absentArm = s.arms.find(isAbsentArm);
  return {
    present: presentArm?.body ?? s.elseBody ?? [],
    absent: absentArm?.body ?? s.elseBody ?? [],
  };
}

/** Render a statement `match` as a value-producing Elixir `case` (a union
 *  subject) or `if` (a `T?` subject). */
export function renderElixirMatchStmt(s: MatchStmt, opts: ElixirMatchOpts): string {
  const { indent, threadVar, subject, renderInner } = opts;
  if (s.subjectShape === "absence") {
    const { present, absent } = presenceSides(s);
    return renderElixirIfStmt(
      { kind: "if", cond: s.subject, thenBody: present, elseBody: absent },
      { indent, ...(threadVar ? { threadVar } : {}), cond: `${subject} != nil`, renderInner },
    );
  }
  const clauseIndent = `${indent}  `;
  const bodyIndent = `${indent}    `;
  const clause = (pattern: string, stmts: readonly StmtIR[]): string[] => {
    const rendered = stmts.map((st) => indentBlock(renderInner([st]).join("\n"), "    "));
    const value = threadVar
      ? [...rendered, `${bodyIndent}${threadVar}`]
      : rendered.length > 0
        ? rendered
        : [`${bodyIndent}nil`];
    return [`${clauseIndent}${pattern} ->`, ...value];
  };
  const lines = s.arms.flatMap((a) => {
    const binder =
      a.binding && armReadsBinding(a.body, a.binding) ? escapeElixirIdent(snake(a.binding)) : "_";
    return clause(elixirVariantPattern(a, binder), a.body);
  });
  if (s.elseBody || !armsCoverUnion(s.subjectType, s.arms)) {
    lines.push(...clause("_", s.elseBody ?? []));
  }
  const scrutinee = elixirUnionScrutinee(subject);
  const head = threadVar
    ? `${indent}${threadVar} = case ${scrutinee} do`
    : `${indent}case ${scrutinee} do`;
  return [head, ...lines, `${indent}end`].join("\n");
}
