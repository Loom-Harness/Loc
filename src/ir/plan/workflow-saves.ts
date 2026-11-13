// Which bindings a workflow body saves, and where.  The save sets themselves
// are lowered onto the IR (`savesAtExit`, a nesting statement's per-branch
// saves); these read them so no backend re-lists the nesting kinds.

import type { WorkflowStmtIR } from "../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";
import { refsRead } from "./workflow-names.js";

type SaveEntry = { name: string; aggName: string; repoName: string };

/** The saves a NESTING statement stages at the end of its own branches — a
 *  `for` iteration's, each `if let` / `if` branch's, each `match` arm's — in source
 *  order; empty for every other kind. */
export function nestedSaves(st: WorkflowStmtIR): SaveEntry[] {
  switch (st.kind) {
    case "for-each":
      return st.savesPerIteration;
    case "if-let":
    case "if":
      return [...st.savesInThen, ...st.savesInElse];
    case "variant-match":
      return [...st.arms.flatMap((a) => a.savesInArm), ...st.savesInElse];
    case "precondition":
    case "requires":
    case "emit":
    case "factory-let":
    case "repo-let":
    case "expr-let":
    case "assign":
    case "repo-run":
    case "op-call":
    case "repo-delete":
    case "resource-call":
    case "domain-service-call":
    case "not-found":
      return [];
    default: {
      const _exhaustive: never = st;
      return _exhaustive;
    }
  }
}

/** The `let` bindings a body keeps alive: every one it reads, saves (at the
 *  exit or at the end of a branch) or calls an operation on.  A `let` outside
 *  this set is a pure existence check — the load still runs (it still answers
 *  not-found on a missing id) but its binding is dead, which a backend whose
 *  linter rejects an unused local must not bind. */
export function liveLetNames(
  statements: readonly WorkflowStmtIR[],
  savesAtExit: readonly { name: string }[],
): Set<string> {
  const live = refsRead(statements, [], "let");
  for (const s of savesAtExit) live.add(s.name);
  for (const st of statements) {
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "op-call") live.add(n.target);
      for (const s of nestedSaves(n)) live.add(s.name);
    });
  }
  return live;
}
