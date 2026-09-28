// ---------------------------------------------------------------------------
// An `or`-union value must be discriminated before it is read (M-T5.1 A4).
//
// A repository find declared `: X or NotFound` / `: X option` (and an
// exception-less operation's `X or E` return) binds a value that is ONE OF its
// variants.  The consumer vocabulary is the variant `match`
// (`match r { Order o => o.code, NotFound => "–" }`), which every backend
// lowers to a presence check (absence unions) or a tag probe (tagged unions).
//
// Nothing refused the other spelling — reading straight through the union:
//
//     let r = Orders.byCode(code)          // Order or NotFound
//     let n = Note.create({ text: r.code })  // 0 error(s), 0 warning(s)
//
// `memberType` has no `union` arm, so `r.code` fell to its catch-all `string`
// — right here by coincidence, a lie for any non-string member — and each
// backend then emitted an unguarded dereference of a value its own port types
// as nullable:
//
//     node    r.code on `Order | null`                   TS18047 (tsc strict)
//     .NET    r.Code on `Order?`                         CS8602 (/warnaserror)
//     java    r.code() on a null `Order`                 NullPointerException → 500
//     python  r.code on `None`                           AttributeError → 500
//     elixir  r.code on `nil`                            KeyError → 500
//
// The statement twin is worse: `r.touch()` on the same binding lowered to an
// `op-call` whose `aggName` is `"Unknown"` — the save that follows targets a
// repository nothing resolves.
//
// Both are refused here, in phase ⑦, where the receiver's resolved union type
// is on the IR node.  Reads of the subject INSIDE a variant arm (`Order => r.code`,
// the binding-less arm form) are the discriminated read and stay legal — every
// backend narrows the subject there.  UI bodies are out of scope: the frontend
// `match await` has its own gates (`variant-match-shape.ts`).
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { variantTag } from "../../stdlib/unions.js";
import type {
  BoundedContextIR,
  EnrichedLoomModel,
  ExprIR,
  TypeIR,
  WorkflowStmtIR,
} from "../../types/loom-ir.js";
import { forEachModelExpr } from "../../util/model-exprs.js";
import { walkExprDeep, walkWorkflowStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

function variantsOf(t: TypeIR): string {
  return t.kind === "union" ? t.variants.map(variantTag).join(" | ") : "";
}

/** The first success-shaped variant — the one an author most likely meant to
 *  read through — for the remedy text. */
function firstVariant(t: TypeIR): string {
  return t.kind === "union" && t.variants[0] ? variantTag(t.variants[0]) : "X";
}

function receiverLabel(e: ExprIR): string {
  return e.kind === "ref" ? e.name : "the value";
}

export function validateUnionReads(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  // Member reads of a variant-`match` SUBJECT inside one of its arms are the
  // discriminated read.  `forEachModelExpr` visits a parent before its
  // children, so the arms are marked before their reads are reached.
  const guarded = new WeakSet<ExprIR>();
  const reported = new WeakSet<ExprIR>();
  forEachModelExpr(loom, ({ expr, source, ui }) => {
    if (ui) return;
    if (expr.kind === "match" && expr.subject?.kind === "ref") {
      const subjectName = expr.subject.name;
      for (const arm of expr.variantArms) {
        walkExprDeep(arm.value, (inner) => {
          if (
            (inner.kind === "member" || inner.kind === "method-call") &&
            inner.receiver.kind === "ref" &&
            inner.receiver.name === subjectName
          ) {
            guarded.add(inner);
          }
        });
      }
      return;
    }
    if (expr.kind !== "member" && expr.kind !== "method-call") return;
    if (expr.receiverType?.kind !== "union") return;
    if (guarded.has(expr) || reported.has(expr)) return;
    reported.add(expr);
    diags.push({
      severity: "error",
      code: "loom.union-read-undiscriminated",
      message: diagMessage("loom.union-read-undiscriminated", {
        receiver: receiverLabel(expr.receiver),
        member: expr.member,
        variants: variantsOf(expr.receiverType),
        first: firstVariant(expr.receiverType),
      }),
      source,
    });
  });

  // The statement form: an operation invoked on a union-bound workflow local.
  const visitContext = (ctx: BoundedContextIR) => {
    const lists: { source: string; stmts: readonly WorkflowStmtIR[] }[] = [];
    for (const w of ctx.workflows) {
      const s = `${ctx.name}/${w.name}`;
      lists.push({ source: s, stmts: w.statements });
      for (const c of w.creates)
        lists.push({ source: `${s}/create(${c.name ?? ""})`, stmts: c.statements });
      for (const o of w.subscriptions ?? [])
        lists.push({ source: `${s}/on(${o.event})`, stmts: o.statements });
      for (const h of w.handlers ?? [])
        lists.push({ source: `${s}/${h.name}`, stmts: h.statements });
    }
    for (const h of ctx.commandHandlers ?? []) {
      lists.push({ source: `${ctx.name}/${h.name}`, stmts: h.statements });
    }
    const seen = new WeakSet<WorkflowStmtIR>();
    for (const { source, stmts } of lists) {
      const unionLocals = new Map<string, TypeIR>();
      for (const top of stmts) {
        walkWorkflowStmtsDeep(top, (st) => {
          if (st.kind === "repo-let" && st.returnType.kind === "union") {
            unionLocals.set(st.name, st.returnType);
          } else if (st.kind === "expr-let" && st.type.kind === "union") {
            unionLocals.set(st.name, st.type);
          } else if (st.kind === "op-call") {
            const t = unionLocals.get(st.target);
            if (!t || seen.has(st)) return;
            seen.add(st);
            diags.push({
              severity: "error",
              code: "loom.union-read-undiscriminated",
              message: diagMessage("loom.union-read-undiscriminated#op-call", {
                receiver: st.target,
                op: st.op,
                variants: variantsOf(t),
                first: firstVariant(t),
              }),
              source,
            });
          }
        });
      }
    }
  };
  for (const sys of loom.systems)
    for (const sd of sys.subdomains) for (const c of sd.contexts) visitContext(c);
  for (const c of loom.contexts) visitContext(c);
}
