// Where a workflow saves an aggregate it creates, relative to the loops and
// branches that write rows referencing it.
//
// A body that creates an aggregate and then loops, creating rows that carry its
// id, writes the child rows inside the loop while the parent is still only in
// memory: a database enforcing the foreign key refuses the first child.  So a
// created aggregate is saved just before the first nesting statement that
// reads it and saves rows of its own — the parent exists by the time any child
// insert runs.  Every backend saves at that point; none decides it again.
//
// Saving earlier moves the save, it does not repeat it: the exit (or branch
// end) save of a parent nothing changes afterwards is dropped.  A parent an
// operation changes after the loop keeps its exit save, which then writes the
// change.

import type { ExprIR, WorkflowStmtIR } from "../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";
import { namesUsed } from "./workflow-names.js";
import { nestedSaveScopes, type SaveEntry } from "./workflow-saves.js";

/** What a statement list saves early and what it still saves at its end. */
export interface ParentFirstSaves {
  /** Statement index → the entries saved immediately before that statement. */
  readonly before: ReadonlyMap<number, readonly SaveEntry[]>;
  /** The list's own end saves, without the parents that need none. */
  readonly remaining: readonly SaveEntry[];
}

/** True when `st` or anything nested in it saves rows of its own. */
function writesRows(st: WorkflowStmtIR): boolean {
  let found = false;
  walkWorkflowStmtsDeep(st, (s) => {
    if (nestedSaveScopes(s).some((scope) => scope.saves.length > 0)) found = true;
  });
  return found;
}

/** True when `rest` changes `name` in memory: an operation called on it, or a
 *  domain-service call passing it. */
function changedAfter(name: string, rest: readonly WorkflowStmtIR[]): boolean {
  let changed = false;
  for (const top of rest) {
    walkWorkflowStmtsDeep(top, (s) => {
      if (s.kind === "op-call" && s.target === name) changed = true;
      if (s.kind === "domain-service-call" && s.call.kind === "call") {
        if (s.call.args.some((a: ExprIR) => a.kind === "ref" && a.name === name)) changed = true;
      }
    });
  }
  return changed;
}

/** The early saves of one statement list, whose own end saves are `saves`. */
export function parentFirstSaves(
  body: readonly WorkflowStmtIR[],
  saves: readonly SaveEntry[],
): ParentFirstSaves {
  // Only a created aggregate can be a parent saved early.
  if (!body.some((st) => st.kind === "factory-let")) return { before: new Map(), remaining: saves };
  const before = new Map<number, SaveEntry[]>();
  const hoisted = new Set<string>();
  const bySave = new Map(saves.map((s) => [s.name, s]));
  body.forEach((st, i) => {
    if (nestedSaveScopes(st).length === 0 || !writesRows(st)) return;
    const read = namesUsed(st.kind === "for-each" ? st.body : bodiesOf(st));
    for (let j = 0; j < i; j++) {
      const created = body[j]!;
      if (created.kind !== "factory-let" || hoisted.has(created.name)) continue;
      const entry = bySave.get(created.name);
      if (!entry || !read.has(created.name)) continue;
      hoisted.add(created.name);
      before.set(i, [...(before.get(i) ?? []), entry]);
    }
  });
  const remaining = saves.filter((s) => {
    if (!hoisted.has(s.name)) return true;
    const at = [...before.entries()].find(([, es]) => es.some((e) => e.name === s.name))![0];
    return changedAfter(s.name, body.slice(at));
  });
  return { before, remaining };
}

function bodiesOf(st: WorkflowStmtIR): WorkflowStmtIR[] {
  return nestedSaveScopes(st).flatMap((scope) => [...scope.body]);
}

/** `st` with each of its bodies' end saves reduced to what that body still
 *  owes after its early saves (`parentFirstSaves`); a statement that nests no
 *  body is returned as is. */
export function withParentFirstSaves(st: WorkflowStmtIR): WorkflowStmtIR {
  const left = (body: readonly WorkflowStmtIR[], saves: readonly SaveEntry[]): SaveEntry[] => [
    ...parentFirstSaves(body, saves).remaining,
  ];
  switch (st.kind) {
    case "for-each":
      return { ...st, savesPerIteration: left(st.body, st.savesPerIteration) };
    case "if-let":
    case "if":
      return {
        ...st,
        savesInThen: left(st.thenBody, st.savesInThen),
        savesInElse: left(st.elseBody ?? [], st.savesInElse),
      };
    case "variant-match":
      return {
        ...st,
        arms: st.arms.map((a) => ({ ...a, savesInArm: left(a.body, a.savesInArm) })),
        savesInElse: left(st.elseBody ?? [], st.savesInElse),
      };
    case "precondition":
    case "requires":
    case "emit":
    case "factory-let":
    case "repo-let":
    case "expr-let":
    case "history-let":
    case "assign":
    case "repo-run":
    case "op-call":
    case "repo-delete":
    case "resource-call":
    case "domain-service-call":
    case "not-found":
      return st;
    default: {
      const _exhaustive: never = st;
      return _exhaustive;
    }
  }
}
