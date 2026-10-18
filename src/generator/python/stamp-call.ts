// Python lifecycle-stamp call sites.  The aggregate module owns the stamp
// bodies (`_stamp_on_create` / `_stamp_on_update`, emitted by
// `emit/aggregate.ts`); this module decides WHEN they run.  Python stamps at
// the call site, right before the repository persist, so every emitter that
// writes `await <repo>.save(<var>)` must route through here — the REST routes
// thread the request's `current_user`, and the in-process save sites
// (workflow routes, explicit command handlers, event reactors) go through
// `pyStampedSaveLines`.  A save that skipped the stamp persisted the
// factory's placeholder values (`created_by=""`, a `due_at` of "now" instead
// of the authored SLA), which no other backend does: .NET stamps in its
// SaveChangesInterceptor, Hono/Phoenix in the repository insert/update.

import type { AggregateIR, WorkflowStmtIR } from "../../ir/types/loom-ir.js";
import { exprUsesCurrentUser } from "../../ir/types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../ir/util/walk.js";
import { snake } from "../../util/naming.js";

export type StampEvent = "create" | "update";

type Stamped = Pick<AggregateIR, "contextStamps">;

/** The stamp assignments for one lifecycle event (create / update). */
export function stampRules(agg: Stamped, event: StampEvent) {
  return (agg.contextStamps ?? []).filter((r) => r.event === event).flatMap((r) => r.assignments);
}

/** Whether this aggregate carries a lifecycle stamp for `event`. */
export function hasStamp(agg: Stamped, event: StampEvent): boolean {
  return stampRules(agg, event).length > 0;
}

/** Whether the `event` stamp references the principal (so the call must pass
 *  a `User` into the stamp method). */
export function stampUsesUser(agg: Stamped, event: StampEvent): boolean {
  return stampRules(agg, event).some((a) => exprUsesCurrentUser(a.value));
}

/** The ambient-principal accessor the in-process save sites read.  Aliased
 *  because those bodies may already bind a local `current_user: User`, which
 *  would shadow the module function of the same name. */
export const AMBIENT_PRINCIPAL = "ambient_principal";
export const AMBIENT_PRINCIPAL_IMPORT = `from app.auth.user import current_user as ${AMBIENT_PRINCIPAL}`;

/** The `let` names a body binds through an aggregate factory
 *  (`let t = Ticket.create({ … })`) — the bindings whose save is an INSERT
 *  and so takes the create stamp; every other saved binding was loaded and
 *  takes the update stamp. */
export function factoryLetNames(sts: readonly WorkflowStmtIR[]): Set<string> {
  const out = new Set<string>();
  for (const st of sts)
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "factory-let") out.add(n.name);
    });
  return out;
}

export interface PySaveRef {
  name: string;
  aggName: string;
  repoName: string;
}

/** Renders one in-process save (stamp + persist) at a given indent. */
export type PySaveLines = (save: PySaveRef, indent: string) => string[];

/** The save renderer for one body: its factory-bound names decide create vs
 *  update for every save the body (and its nested branches / loops) emits. */
export function pySaveRenderer(
  sts: readonly WorkflowStmtIR[],
  aggregates: readonly (Stamped & { name: string })[],
): PySaveLines {
  const created = factoryLetNames(sts);
  return (save, indent) => pyStampedSaveLines(save, indent, created, aggregates);
}

/** The stamp call (if the aggregate has one) plus the persist for one
 *  in-process save.  Mirrors the REST routes: a fresh aggregate takes the
 *  create stamp, a loaded one the update stamp.  A principal-referencing
 *  stamp reads the ambient principal the auth middleware set; a save with no
 *  principal in scope (an outbox-relayed reactor, a system task) persists
 *  unstamped, as Hono's repository-level stamp does — principal stamps are
 *  only legal on an authenticated deployable, so a request-driven save always
 *  has one. */
export function pyStampedSaveLines(
  save: PySaveRef,
  indent: string,
  created: ReadonlySet<string>,
  aggregates: readonly (Stamped & { name: string })[],
): string[] {
  const v = snake(save.name);
  const persist = `${indent}await ${snake(save.repoName)}.save(${v})`;
  const agg = aggregates.find((a) => a.name === save.aggName);
  const event: StampEvent = created.has(save.name) ? "create" : "update";
  if (!agg || !hasStamp(agg, event)) return [persist];
  if (!stampUsesUser(agg, event)) return [`${indent}${v}._stamp_on_${event}()`, persist];
  return [
    `${indent}if (__principal := ${AMBIENT_PRINCIPAL}()) is not None:`,
    `${indent}    ${v}._stamp_on_${event}(__principal)`,
    persist,
  ];
}
