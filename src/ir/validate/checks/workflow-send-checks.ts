// ---------------------------------------------------------------------------
// Workflow `send` and `step` (D-WORKFLOW-STEPS).
//
//   loom.workflow-send-placement   only a workflow body sends (a handler does
//                                  not); a `step` sits at the top level of a
//                                  `create` / `on` body; a send sits there or
//                                  directly in a step's body or `undo` body; a
//                                  step and its `undo` hold only sends; step
//                                  names are unique in a body.
//   loom.workflow-send-record      the sent name is a `command` / `query`
//                                  record of the named context; its fields are
//                                  the record's.
//   loom.workflow-send-handler     exactly one declaration catches the record;
//                                  `let r = send` needs a declared result.
//   loom.workflow-send-result-unmatched
//                                  a `T or E` result bound with `let` is matched.
//   loom.workflow-step-undo-required
//                                  a step that commits on its own and that
//                                  anything able to fail follows carries
//                                  `undo { … }` or `final`.
//   loom.workflow-step-cross-storage
//                                  a scope declared as one transaction (a step,
//                                  a `transactional` workflow) reaches one
//                                  storage, and every send in it is delivered
//                                  now.
//   loom.workflow-send-outbox-unsupported
//                                  a send delivered through the command outbox
//                                  (another deployable or storage) is refused
//                                  until the outbox exists.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { handlersOf } from "../../plan/command-bus.js";
import {
  type SendIR,
  type StepBlockIR,
  sendDelivery,
  sendsIn,
  stepStores,
  stepsNeedingCompensation,
} from "../../plan/workflow-steps.js";
import type {
  BoundedContextIR,
  EnrichedLoomModel,
  SystemIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../../types/loom-ir.js";
import { allContexts } from "../../types/loom-ir.js";
import { walkWorkflowStmtChildren, walkWorkflowStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

interface Body {
  readonly label: string;
  readonly statements: readonly WorkflowStmtIR[];
  /** True when the whole body is one transaction (a `transactional`
   *  workflow's command `create`). */
  readonly oneTransaction: boolean;
}

function workflowBodies(wf: WorkflowIR): Body[] {
  return [
    ...wf.creates.map((c) => ({
      label: c.name ? `create ${c.name}` : "create",
      statements: c.statements,
      oneTransaction: c.triggerKind === "command" && wf.transactional,
    })),
    ...wf.subscriptions.map((s) => ({
      label: `on(${s.event})`,
      statements: s.statements,
      oneTransaction: false,
    })),
  ];
}

export function validateWorkflowSends(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  const ctxByName = new Map<string, BoundedContextIR>();
  for (const c of allContexts(loom)) ctxByName.set(c.name, c);
  const sysOf = new Map<string, SystemIR>();
  for (const sys of loom.systems)
    for (const sd of sys.subdomains) for (const c of sd.contexts) sysOf.set(c.name, sys);
  for (const ctx of allContexts(loom)) {
    const sys = sysOf.get(ctx.name);
    for (const h of [...ctx.commandHandlers, ...(ctx.queryHandlers ?? [])])
      refuseInHandler(`${ctx.name}/${h.name}`, h.name, h.statements, diags);
    for (const wf of ctx.workflows) {
      for (const body of workflowBodies(wf)) {
        const where = `${ctx.name}/${wf.name}`;
        const owner = `workflow '${wf.name}' ${body.label}`;
        checkPlacement(body, owner, where, diags);
        for (const send of sendsIn(body.statements))
          checkSend(send, owner, where, ctxByName, body.statements, diags);
        for (const step of stepsNeedingCompensation(
          body.statements,
          body.oneTransaction,
          wf.stateFields.length > 0,
        ))
          diags.push({
            severity: "error",
            code: "loom.workflow-step-undo-required",
            message: diagMessage("loom.workflow-step-undo-required", { owner, step: step.name }),
            source: where,
            origin: step.origin ?? wf.origin,
          });
        if (sys) checkDelivery(body, ctx, sys, owner, where, diags);
      }
    }
  }
}

/** Only a workflow sends (ruling 135): a handler changes aggregates itself. */
function refuseInHandler(
  where: string,
  handler: string,
  statements: readonly WorkflowStmtIR[],
  diags: LoomDiagnostic[],
): void {
  for (const st of statements)
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind !== "send" && n.kind !== "step") return;
      diags.push({
        severity: "error",
        code: "loom.workflow-send-placement",
        message: diagMessage("loom.workflow-send-placement#handler", {
          handler,
          what: n.kind === "send" ? `send ${n.record}` : `step ${n.name}`,
        }),
        source: where,
        origin: n.origin,
      });
    });
}

function checkPlacement(body: Body, owner: string, where: string, diags: LoomDiagnostic[]): void {
  const push = (st: WorkflowStmtIR, message: string) =>
    diags.push({
      severity: "error",
      code: "loom.workflow-send-placement",
      message,
      source: where,
      origin: st.origin,
    });
  const spell = (c: SendIR | StepBlockIR) =>
    c.kind === "send" ? `send ${c.record}` : `step ${c.name}`;
  const names = new Set<string>();
  // A step or send nested under any other statement (a loop, a branch, a
  // match arm) has no fixed place in the body's sequence of commits.
  const nested = (st: WorkflowStmtIR): void =>
    walkWorkflowStmtChildren(st, {
      workflowStmt: (c) => {
        if (c.kind === "send" || c.kind === "step")
          push(c, diagMessage("loom.workflow-send-placement#nested", { owner, what: spell(c) }));
        nested(c);
      },
    });
  for (const st of body.statements) {
    if (st.kind === "step") {
      if (names.has(st.name))
        push(st, diagMessage("loom.workflow-send-placement#duplicate", { owner, step: st.name }));
      names.add(st.name);
      const inside = [...st.body, ...(st.compensation.kind === "undo" ? st.compensation.body : [])];
      for (const s of inside) {
        if (s.kind !== "send")
          push(s, diagMessage("loom.workflow-send-placement#step-body", { owner, step: st.name }));
        else nested(s);
      }
    } else if (st.kind !== "send") {
      nested(st);
    }
  }
}

function checkSend(
  send: SendIR,
  owner: string,
  where: string,
  ctxByName: ReadonlyMap<string, BoundedContextIR>,
  body: readonly WorkflowStmtIR[],
  diags: LoomDiagnostic[],
): void {
  const site = { severity: "error" as const, source: where, origin: send.origin };
  const record$ = send.record;
  const target = ctxByName.get(send.context);
  const record = target?.payloads.find(
    (p) => p.name === send.record && (p.kind === "command" || p.kind === "query"),
  );
  if (!target || !record) {
    diags.push({
      ...site,
      code: "loom.workflow-send-record",
      message: diagMessage("loom.workflow-send-record#unknown", {
        owner,
        record: record$,
        context: send.context,
      }),
    });
    return;
  }
  const given = new Set(send.fields.map((f) => f.name));
  for (const f of send.fields)
    if (!record.fields.some((rf) => rf.name === f.name))
      diags.push({
        ...site,
        code: "loom.workflow-send-record",
        message: diagMessage("loom.workflow-send-record#unknown-field", {
          owner,
          record: record$,
          field: f.name,
        }),
      });
  for (const rf of record.fields)
    if (
      !rf.optional &&
      rf.default === undefined &&
      rf.type.kind !== "optional" &&
      !given.has(rf.name)
    )
      diags.push({
        ...site,
        code: "loom.workflow-send-record",
        message: diagMessage("loom.workflow-send-record#missing-field", {
          owner,
          record: record$,
          field: rf.name,
        }),
      });
  const handlers = handlersOf(target, send.record);
  if (handlers.length === 0) {
    diags.push({
      ...site,
      code: "loom.workflow-send-handler",
      message: diagMessage("loom.workflow-send-handler#none", {
        owner,
        record: record$,
        kind: record.kind,
        context: target.name,
      }),
    });
    return;
  }
  if (handlers.length > 1) {
    diags.push({
      ...site,
      code: "loom.workflow-send-handler",
      message: diagMessage("loom.workflow-send-handler#several", {
        owner,
        record: record$,
        handlers: handlers.map((h) => `'${h.handler.name}'`).join(", "),
      }),
    });
    return;
  }
  const result = send.result;
  if (!result) return;
  const only = handlers[0]!;
  const declaresResult = only.handler.form === "workflow-create" || only.returnType !== undefined;
  if (!declaresResult || result.type.kind === "none") {
    diags.push({
      ...site,
      code: "loom.workflow-send-handler",
      message: diagMessage("loom.workflow-send-handler#no-result", {
        owner,
        record: record$,
        name: result.name,
        handler: only.handler.name,
      }),
    });
    return;
  }
  if (result.errorVariants.length > 0 && !matchedIn(body, result.name))
    diags.push({
      ...site,
      code: "loom.workflow-send-result-unmatched",
      message: diagMessage("loom.workflow-send-result-unmatched", {
        owner,
        record: record$,
        name: result.name,
        errors: result.errorVariants.map((v) => `'${v}'`).join(", "),
      }),
    });
}

/** True when a statement `match` over `name` covers every variant. */
function matchedIn(body: readonly WorkflowStmtIR[], name: string): boolean {
  let found = false;
  for (const st of body)
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "variant-match" && n.subject.kind === "ref" && n.subject.name === name)
        found = true;
    });
  return found;
}

function checkDelivery(
  body: Body,
  sender: BoundedContextIR,
  sys: SystemIR,
  owner: string,
  where: string,
  diags: LoomDiagnostic[],
): void {
  const steps = body.statements.filter(
    (s): s is Extract<WorkflowStmtIR, { kind: "step" }> => s.kind === "step",
  );
  for (const d of sys.deployables) {
    if (!d.contextNames.includes(sender.name)) continue;
    const scopes: { name: string; sends: SendIR[]; ownState: boolean }[] = body.oneTransaction
      ? [{ name: body.label, sends: sendsIn(body.statements), ownState: true }]
      : steps.map((s) => ({ name: `step ${s.name}`, sends: sendsIn(s.body), ownState: false }));
    const inScope = new Set(scopes.flatMap((s) => s.sends));
    for (const scope of scopes) {
      const stores = stepStores(scope.sends, sender, d, sys, scope.ownState);
      const outboxed = scope.sends.filter((s) => sendDelivery(s, sender, d, sys).kind === "outbox");
      if (stores.size <= 1 && outboxed.length === 0) continue;
      const reached = [...stores.entries()]
        .map(
          ([storage, reasons]) =>
            `'${storage}' (${reasons.map((r) => `${r.via}, resource ${r.resource}`).join("; ")})`,
        )
        .concat(
          outboxed.map(
            (s) => `${s.context}.${s.record} (not hosted by '${d.name}' on its storage)`,
          ),
        );
      diags.push({
        severity: "error",
        code: "loom.workflow-step-cross-storage",
        message: diagMessage("loom.workflow-step-cross-storage", {
          owner,
          scope: scope.name,
          deployable: d.name,
          reached: reached.join(", "),
        }),
        source: where,
        origin: (scope.sends[0] ?? steps[0])?.origin,
      });
    }
    for (const send of sendsIn(body.statements)) {
      if (inScope.has(send)) continue;
      const delivery = sendDelivery(send, sender, d, sys);
      if (delivery.kind !== "outbox") continue;
      diags.push({
        severity: "error",
        code: "loom.workflow-send-outbox-unsupported",
        message: diagMessage("loom.workflow-send-outbox-unsupported", {
          owner,
          record: `${send.context}.${send.record}`,
          deployable: d.name,
          why:
            delivery.reason === "other-deployable"
              ? `'${d.name}' does not host context '${send.context}'`
              : `'${send.context}' keeps its state on storage '${delivery.storage}', not '${delivery.senderStorage}'`,
        }),
        source: where,
        origin: send.origin,
      });
    }
  }
}
