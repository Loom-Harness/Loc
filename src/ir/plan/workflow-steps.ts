// The steps of a workflow body, and where each send is delivered
// (D-WORKFLOW-STEPS).
//
// A workflow body changes aggregates by SENDING commands to their handlers.
// Every send belongs to one step:
//
//   * a `step <name> { send … }` block is one step: its sends commit together,
//     in one transaction, at its closing brace;
//   * a send outside any block is a step of its own, named after its record:
//     it commits alone;
//   * in a `transactional` workflow every step JOINS the body's one
//     transaction instead, which commits at the body's end.
//
// A step that commits (it does not join) and that anything able to fail
// follows carries `undo { … }` or `final`; a step that joins rolls back with
// the body and needs neither.
//
// A send is delivered NOW (the handler runs in this request, on the
// deployable's connection) when the deployable hosts the record's context and
// that context keeps its state on the sending context's storage.  Anything
// else goes through the command OUTBOX: another deployable, or another storage
// of the same deployable.  The outbox is not built yet, so such a send is
// refused (`loom.workflow-send-outbox-unsupported`); inside a scope declared
// as one transaction (a step block, a `transactional` workflow) a send that
// cannot join is a compile error naming both storages
// (`loom.workflow-step-cross-storage`).
//
// A sent command's `requires` gate is checked against the workflow's caller
// for a body a command starts, and against the system principal for a
// reaction (an `on` reactor or an event-started `create`), which no caller
// started.
//
// Backends read these facts; none decides a step's mode or a send's delivery
// itself.

import type {
  BoundedContextIR,
  DeployableIR,
  StepCompensationIR,
  SystemIR,
  WorkflowStmtIR,
} from "../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";
import { nestedSaveScopes } from "./workflow-saves.js";

export type SendIR = Extract<WorkflowStmtIR, { kind: "send" }>;
export type StepBlockIR = Extract<WorkflowStmtIR, { kind: "step" }>;

/** How a step's writes commit: on their own at the step's end, or by joining
 *  the transaction the whole body holds. */
export type StepMode = "own-commit" | "joins";

/** One step of a workflow body. */
export interface WorkflowStep {
  /** The block's name, or the record's name for a lone send. */
  readonly name: string;
  /** A lone `send` line, or a `step` block. */
  readonly kind: "send" | "block";
  readonly sends: readonly SendIR[];
  readonly mode: StepMode;
  /** The block's compensation; a lone send has none. */
  readonly compensation: StepCompensationIR["kind"];
  /** True for a block that commits on its own, carries neither `undo` nor
   *  `final`, and is followed by something able to fail. */
  readonly owesCompensation: boolean;
  /** The source statement. */
  readonly stmt: SendIR | StepBlockIR;
}

/** The sends a statement holds, at any depth, in source order. */
export function sendsIn(stmts: readonly WorkflowStmtIR[]): SendIR[] {
  const out: SendIR[] = [];
  for (const st of stmts)
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "send") out.push(n);
    });
  return out;
}

/** The steps of one body, in source order, at any depth: a step inside an
 *  `if`, a loop or a match arm is a step of the body too.  `holdsTransaction`
 *  is the body's own transaction (`bodyIsolation(…).holdsTransaction` for a
 *  workflow's command `create`): when it holds one, every step joins it.  A
 *  step inside another step joins that step's transaction, and a send inside a
 *  step is part of it, not a step of its own.  Sends in an `undo` body are the
 *  step's compensation, not steps. */
export function workflowSteps(
  statements: readonly WorkflowStmtIR[],
  holdsTransaction: boolean,
  stateful = false,
): WorkflowStep[] {
  const out: WorkflowStep[] = [];
  const visit = (stmts: readonly WorkflowStmtIR[], inStep: boolean, followed: boolean): void => {
    stmts.forEach((st, i) => {
      // Anything after this statement in its block, in an enclosing block, or
      // a later loop iteration can still fail once it has committed.
      const followedHere = followed || i < stmts.length - 1;
      const mode: StepMode = holdsTransaction || inStep ? "joins" : "own-commit";
      if (st.kind === "step") {
        out.push({
          name: st.name,
          kind: "block",
          sends: sendsIn(st.body),
          mode,
          compensation: st.compensation.kind,
          owesCompensation:
            mode === "own-commit" && st.compensation.kind === "none" && (followedHere || stateful),
          stmt: st,
        });
        visit(st.body, true, followedHere);
      } else if (st.kind === "send") {
        if (!inStep)
          out.push({
            name: st.record,
            kind: "send",
            sends: [st],
            mode,
            compensation: "none",
            owesCompensation: false,
            stmt: st,
          });
      } else {
        for (const scope of nestedSaveScopes(st))
          visit(scope.body, inStep, followedHere || scope.kind === "iteration");
      }
    });
  };
  visit(statements, false, false);
  return out;
}

/** The step blocks that must carry `undo { … }` or `final` (ruling 124): a
 *  block that commits on its own and that something able to fail follows — a
 *  later statement at any level, a later loop iteration, or the end write of
 *  a workflow that keeps state (`stateful`). */
export function stepsNeedingCompensation(
  statements: readonly WorkflowStmtIR[],
  holdsTransaction: boolean,
  stateful: boolean,
): StepBlockIR[] {
  return workflowSteps(statements, holdsTransaction, stateful)
    .filter((s) => s.owesCompensation)
    .map((s) => s.stmt as StepBlockIR);
}

/** Why a step or a body reaches a storage. */
export interface StoreReason {
  readonly kind: "own-state" | "send";
  /** The record sent, or the context whose state the body writes. */
  readonly via: string;
  /** The `resource` (dataSource) binding that puts it on that storage. */
  readonly resource: string;
}

/** Where a send is delivered from a deployable: `now`, or through the
 *  command outbox, with the reason. */
export type SendDelivery =
  | { readonly kind: "now"; readonly storage?: string }
  | { readonly kind: "outbox"; readonly reason: "other-deployable" }
  | {
      readonly kind: "outbox";
      readonly reason: "other-storage";
      readonly storage: string;
      readonly senderStorage: string;
    };

/** The dataSource that keeps `context`'s state in `deployable`, if any. */
function stateBinding(sys: SystemIR, deployable: DeployableIR, context: string) {
  return sys.dataSources.find(
    (d) =>
      d.contextName === context &&
      d.kind === "state" &&
      deployable.dataSourceNames.includes(d.name),
  );
}

/** Where `send`, sent from a workflow of `sender` hosted by `deployable`, is
 *  delivered. */
export function sendDelivery(
  send: SendIR,
  sender: BoundedContextIR,
  deployable: DeployableIR,
  sys: SystemIR,
): SendDelivery {
  if (!deployable.contextNames.includes(send.context))
    return { kind: "outbox", reason: "other-deployable" };
  const own = stateBinding(sys, deployable, sender.name);
  const theirs = stateBinding(sys, deployable, send.context);
  if (own && theirs && own.storageName !== theirs.storageName)
    return {
      kind: "outbox",
      reason: "other-storage",
      storage: theirs.storageName,
      senderStorage: own.storageName,
    };
  return theirs ? { kind: "now", storage: theirs.storageName } : { kind: "now" };
}

/** The storages one transaction scope reaches in `deployable`, each with the
 *  reasons: the sending context's own state when `ownState` (a `transactional`
 *  workflow writes its state row in the same transaction), and every send's
 *  target context's state.  More than one entry is a scope that cannot be one
 *  transaction (`loom.workflow-step-cross-storage`). */
export function stepStores(
  sends: readonly SendIR[],
  sender: BoundedContextIR,
  deployable: DeployableIR,
  sys: SystemIR,
  ownState: boolean,
): Map<string, StoreReason[]> {
  const out = new Map<string, StoreReason[]>();
  const add = (storage: string, reason: StoreReason) =>
    out.set(storage, [...(out.get(storage) ?? []), reason]);
  if (ownState) {
    const own = stateBinding(sys, deployable, sender.name);
    if (own) add(own.storageName, { kind: "own-state", via: sender.name, resource: own.name });
  }
  for (const s of sends) {
    if (!deployable.contextNames.includes(s.context)) continue;
    const ds = stateBinding(sys, deployable, s.context);
    if (ds)
      add(ds.storageName, { kind: "send", via: `${s.context}.${s.record}`, resource: ds.name });
  }
  return out;
}

/** Whose permissions a sent command's `requires` gate is checked against: the
 *  workflow's caller for a body a command starts, the system principal for a
 *  reaction. */
export function sendPrincipal(body: { readonly reaction: boolean }): "caller" | "system" {
  return body.reaction ? "system" : "caller";
}
