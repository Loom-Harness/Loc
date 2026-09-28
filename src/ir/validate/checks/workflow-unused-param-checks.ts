// -------------------------------------------------------------------------
// `loom.workflow-param-unused` — a command entry's parameter that its body
// never reads.
//
// A workflow `create` / `handle` parameter list IS the request contract: each
// param becomes a REQUIRED field of the emitted request schema
// (`ignoredNote: z.string()`), is destructured into a local, and is then
// dropped on the floor if the body never mentions it.  The caller is obliged
// to send data the system discards, and nothing says so.
//
// Found by submitting a claim: `create(… firstLine: string, firstAmount: Money)`
// returned `204` and the claim came back with `lines: []`.  The two fields
// looked like they carried the first claim line; the body never read them.
// The wire contract said "required", the behaviour said "ignored", and
// `0 error(s), 0 warning(s)` said nothing.
//
// A WARNING, not an error, and it fires only on a PARTIALLY-wired body.
//
// An EMPTY body is carved out, and the measurement is why: of 54 hits across
// the shipped corpus, 48 were one storybook model replicated over eight design
// packs, every one of them an empty `create(…) { }` whose comment says "empty
// body — the showcase only exercises the form scaffold the React generator
// produces".  Those params are the subject, not an oversight.  An empty body
// is an unambiguous "not wired yet"; what this gate is actually about is the
// body that reads SOME of its params and silently drops the rest — the shape
// that looks finished and is not.
//
// Note what this gate deliberately does NOT offer: a `_`-prefix opt-out, the
// convention every general-purpose language uses for this lint.  A workflow
// parameter name is not internal — it is a field name in the emitted request
// schema and a label in the generated form — so renaming `notes` to `_notes`
// to silence a warning would change the wire contract and the UI.  The opt-out
// has to be "don't write a half-wired body", which is the advice anyway.
//
// Two parameters are excluded because something OTHER than the body consumes
// them, so "never read" is not "never used":
//
//   * the EVENT binding of an event-triggered `create(e: Event) by …` — `by
//     e.field` routes on it in the header, so a body that only needs the
//     correlation never reads the binding, and that is correct;
//   * the command create's CORRELATION parameter (`commandCreateCorrelationParam`,
//     `ir/util/workflow-own-state.ts`) — `create(orderId: Order id)` supplies
//     the workflow's correlation field by NAME MATCH, and the emitters
//     load-or-allocate the saga row from it before the first statement runs.
//     A body that only mutates saga state never mentions it.  Without this
//     carve-out the gate would warn on the canonical command-create spelling
//     that `workflow-create-state.ddd` exists to pin.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, CreateIR, HandleIR, WorkflowIR } from "../../types/loom-ir.js";
import { walkWorkflowStmtExprsDeep } from "../../util/walk.js";
import { commandCreateCorrelationParam, facadeCreate } from "../../util/workflow-own-state.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** Every `param`-kind name read anywhere in a command entry's body.
 *
 *  Rides `walk.ts` rather than a bespoke descent.  `walkWorkflowStmtExprsDeep`
 *  is deep on BOTH axes already — it recurses through the `for-each` / `if-let`
 *  bodies a workflow statement carries AND, via `walkExprDeep`, through every
 *  sub-expression including a block-bodied lambda's statements.  A hand-rolled
 *  scan of `entry.statements` would miss the moment the IR grows a kind, and
 *  miss SILENTLY: a param read only inside a `match` arm or an `if-let` branch
 *  would read as unused and the warning would be a FALSE positive
 *  (`ir-walk-census`, the #2720/#2705 defect class). */
function paramNamesRead(statements: readonly { kind: string }[]): Set<string> {
  const read = new Set<string>();
  for (const top of statements as readonly Parameters<typeof walkWorkflowStmtExprsDeep>[0][]) {
    walkWorkflowStmtExprsDeep(top, (e) => {
      if (e.kind === "ref" && e.refKind === "param") read.add(e.name);
    });
  }
  return read;
}

function checkEntry(
  entry: CreateIR | HandleIR,
  label: string,
  wf: WorkflowIR,
  ctxName: string,
  exempt: string | undefined,
  diags: LoomDiagnostic[],
): void {
  // An empty body is "not wired yet", not "wired wrong" — see the header.
  if (entry.statements.length === 0) return;
  const read = paramNamesRead(entry.statements);
  // The event binding of `create(e: Event) by e.field` is routed on in the
  // HEADER, not the body — not an unused parameter.
  const eventBinding = "eventBinding" in entry ? entry.eventBinding : undefined;
  for (const p of entry.params) {
    if (p.name === eventBinding || p.name === exempt || read.has(p.name)) continue;
    diags.push({
      severity: "warning",
      code: "loom.workflow-param-unused",
      message: diagMessage("loom.workflow-param-unused", {
        param: p.name,
        label,
        wfName: wf.name,
      }),
      source: `${ctxName}/${wf.name}`,
    });
  }
}

export function validateWorkflowUnusedParams(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  for (const wf of ctx.workflows) {
    const facade = facadeCreate(wf);
    const corr = commandCreateCorrelationParam(wf)?.name;
    for (const cr of wf.creates) {
      const exempt = cr === facade ? corr : undefined;
      checkEntry(cr, `create${cr.name ? ` ${cr.name}` : ""}`, wf, ctx.name, exempt, diags);
    }
    for (const h of wf.handlers ?? []) {
      checkEntry(h, `handle ${h.name}`, wf, ctx.name, undefined, diags);
    }
  }
}
