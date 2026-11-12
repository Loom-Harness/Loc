// -------------------------------------------------------------------------
// Timer-source checks (scheduling.md, M-T4.1) — `timerSource` fires a plain
// event on a wall-clock cadence, which workflows react to via the existing
// `on`/`create … by` triggers.  These gates keep the "time as an event source"
// model safe: the for-event must be a dedicated infrastructure tick (not a
// domain event some aggregate also emits), the owning deployable must bind a
// relational `state` resource (the single-fire advisory lock needs Postgres),
// exactly one cadence field is set and is well-formed, and something actually
// reacts to the tick.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { descriptorFor } from "../../../platform/metadata.js";
import { reactedEventNames, timerOwner, timerTickEndpoints } from "../../enrich/hosting-facts.js";
import type {
  BoundedContextIR,
  StmtIR,
  SystemIR,
  TimerSourceIR,
  WorkflowStmtIR,
} from "../../types/loom-ir.js";
import { walkStmtChildren, workflowEmits } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** Every event name that appears as an `emit` operand anywhere in a context —
 *  aggregate operation/create/destroy bodies and workflow bodies.  A timer's
 *  for-event must NOT be in this set (it is infrastructure-emitted only). */
function collectEmittedEvents(ctx: BoundedContextIR): Set<string> {
  const out = new Set<string>();
  const scanStmt = (s: StmtIR): void => {
    if (s.kind === "emit") out.add(s.eventName);
    walkStmtChildren(
      s,
      () => {},
      (child) => scanStmt(child),
    );
  };
  const scanWf = (stmts: readonly WorkflowStmtIR[]): void => {
    for (const e of workflowEmits(stmts)) out.add(e.eventName);
  };
  for (const agg of ctx.aggregates) {
    const ops = [...agg.operations, ...(agg.creates ?? []), ...(agg.destroys ?? [])];
    for (const op of ops) for (const s of op.statements) scanStmt(s);
  }
  for (const wf of ctx.workflows ?? []) {
    for (const c of wf.creates) scanWf(c.statements);
    for (const on of wf.subscriptions ?? []) scanWf(on.statements);
    scanWf(wf.statements);
  }
  return out;
}

/** Resolve the deployable that owns a timer's emission — the DB owner of the
 *  for-event's context.  Derived from the subdomain's enrichment-computed
 *  `migrationsOwner` (the single-fire lock owner and the DB owner coincide). */
const timerOwnerDeployable = timerOwner;

export function validateTimerSources(sys: SystemIR, diags: LoomDiagnostic[]): void {
  const timers = sys.timerSources ?? [];
  if (timers.length === 0) return;

  // Index every context by name (cheap, reused across timers).
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const sub of sys.subdomains) for (const c of sub.contexts) ctxByName.set(c.name, c);

  for (const ts of timers) {
    const ctx = ctxByName.get(ts.context);
    const eventDecl = ctx?.events.find((e) => e.name === ts.event);

    // ── loom.timer-event-shape ──────────────────────────────────────────────
    if (ctx && eventDecl) {
      const emitted = collectEmittedEvents(ctx);
      if (emitted.has(ts.event)) {
        diags.push({
          severity: "error",
          code: "loom.timer-event-shape",
          message: diagMessage("loom.timer-event-shape#not-infrastructure-only", {
            name: ts.name,
            event: ts.event,
            ctxName: ctx.name,
          }),
          source: sys.name,
        });
      }
      const hasAt = eventDecl.fields.some(
        (f) => f.name === "at" && f.type.kind === "primitive" && f.type.name === "datetime",
      );
      if (!hasAt) {
        diags.push({
          severity: "warning",
          code: "loom.timer-event-shape",
          message: diagMessage("loom.timer-event-shape#no-at-field", {
            event: ts.event,
            name: ts.name,
          }),
          source: sys.name,
        });
      }
    }

    // (Cadence well-formedness — both/neither set, cron range, every floor +
    // cron-expressibility — is an AST-level check in
    // `src/language/validators/timer.ts`, where both raw grammar fields are
    // still visible.  Lowering discriminates the cadence to one, so "both set"
    // would be invisible here.)

    // ── loom.timer-needs-state ──────────────────────────────────────────────
    const owner = timerOwnerDeployable(sys, ts);
    const ownerDeployable = sys.deployables.find((d) => d.name === owner);
    if (ownerDeployable) {
      const needsDb = descriptorFor(ownerDeployable.platform).needsDb;
      if (!needsDb) {
        diags.push({
          severity: "error",
          code: "loom.timer-needs-state",
          message: diagMessage("loom.timer-needs-state#owner-binds-no-state", {
            name: ts.name,
            owner,
          }),
          source: sys.name,
        });
      }
    } else {
      diags.push({
        severity: "error",
        code: "loom.timer-needs-state",
        message: diagMessage("loom.timer-needs-state#context-has-no-db-owner", {
          name: ts.name,
          context: ts.context,
        }),
        source: sys.name,
      });
    }

    // ── loom.timer-source-unbound (warning) ─────────────────────────────────
    // A reactor on ANY deployable counts, so long as the tick can reach it:
    // in-process on the timer's own deployable, or over a channel carrying the
    // tick (whose binding `loom.channel-consumer-unwired` enforces).  Without
    // deployables (legacy single-project mode) the system's contexts decide.
    if (ctx) {
      if (sys.deployables.length === 0) {
        const reactedAnywhere = sys.subdomains.some((sub) =>
          sub.contexts.some((c) => reactedEventNames(c).has(ts.event)),
        );
        if (!reactedAnywhere) pushUnbound(ts, sys, diags);
      } else {
        const { consumers, reachable } = timerTickEndpoints(sys, ts);
        if (consumers.length === 0) {
          pushUnbound(ts, sys, diags);
        } else if (reachable.length === 0) {
          diags.push({
            severity: "warning",
            code: "loom.timer-source-unbound",
            message: diagMessage("loom.timer-source-unbound#unreachable", {
              name: ts.name,
              event: ts.event,
              owner: owner ?? "?",
              consumers: consumers.map((d) => d.name).join(", "),
            }),
            source: sys.name,
          });
        }
      }
    }
  }
}

function pushUnbound(ts: TimerSourceIR, sys: SystemIR, diags: LoomDiagnostic[]): void {
  diags.push({
    severity: "warning",
    code: "loom.timer-source-unbound",
    message: diagMessage("loom.timer-source-unbound", { name: ts.name, event: ts.event }),
    source: sys.name,
  });
}
