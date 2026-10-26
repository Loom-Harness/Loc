// What an entity-history read looks like in a page body — one predicate, read
// by the validator (`loom.target-unsupported#entity-history-read`) and by every
// frontend's read layer, so the two cannot disagree about what a history read
// is.  See `src/generator/_walker/history-read.ts` for how each frontend
// collects one.

import { AUDIT_HISTORY_FIND } from "../../util/audit-names.js";
import type { ExprIR, UiIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** True when a `QueryView` `of:` expression is the derived entity-history read
 *  — `<api>.<Agg>.history(id)` or the no-api-handle `<Agg>.history(id)`.  The
 *  receiver must name an aggregate this ui knows, so an unrelated
 *  `something.history(…)` is not mistaken for one. */
export function isEntityHistoryRead(
  ofArg: ExprIR,
  aggregatesByName: { has(name: string): boolean },
): boolean {
  if (ofArg.kind !== "method-call" || ofArg.member !== AUDIT_HISTORY_FIND) return false;
  const recv = ofArg.receiver;
  const name = recv.kind === "member" ? recv.member : recv.kind === "ref" ? recv.name : undefined;
  return name !== undefined && aggregatesByName.has(name);
}

/** True when `body` holds a `QueryView` whose `of:` is an entity-history read
 *  over one of `aggregatesByName`. */
function bodyReadsEntityHistory(
  body: ExprIR | undefined,
  aggregatesByName: { has(name: string): boolean },
): boolean {
  let found = false;
  walkExprDeep(body, (e) => {
    if (found || e.kind !== "call" || e.name !== "QueryView") return;
    const i = e.argNames?.indexOf("of") ?? -1;
    const of = i >= 0 ? e.args[i] : undefined;
    if (of && isEntityHistoryRead(of, aggregatesByName)) found = true;
  });
  return found;
}

/** The ui's history-reading hosts, labelled for a diagnostic. */
export function entityHistoryReadHosts(
  ui: UiIR,
  aggregatesByName: { has(name: string): boolean },
): string[] {
  return [
    ...ui.pages
      .filter((p) => bodyReadsEntityHistory(p.body, aggregatesByName))
      .map((p) => `page '${p.name}'`),
    ...ui.components
      .filter((c) => bodyReadsEntityHistory(c.body, aggregatesByName))
      .map((c) => `component '${c.name}'`),
  ];
}
