// Which bindings a workflow body saves, and where.  The save sets themselves
// are lowered onto the IR (`savesAtExit`, a nesting statement's per-branch
// saves); these read them so no backend re-lists the nesting kinds.

import type { WorkflowStmtIR } from "../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";
import { refsRead } from "./workflow-names.js";

export type SaveEntry = { name: string; aggName: string; repoName: string };

/** The saves a NESTING statement stages at the end of its own bodies — a
 *  `for` iteration's, each `if let` / `if` branch's, each `match` arm's — in
 *  source order; empty for every other kind. */
export function nestedSaves(st: WorkflowStmtIR): SaveEntry[] {
  return nestedSaveScopes(st).flatMap((scope) => scope.saves);
}

/** One body a NESTING statement runs and the saves it stages at that body's
 *  end.  `iteration` is a `for` body, which runs once per element; `branch` is
 *  an `if let` / `if` branch or a `match` arm, which runs at most once. */
export interface SaveScope {
  readonly kind: "iteration" | "branch";
  readonly body: readonly WorkflowStmtIR[];
  readonly saves: readonly SaveEntry[];
}

/** The bodies a NESTING statement runs, each with the saves it stages at its
 *  end, in source order; empty for every other kind.  A missing `else` is an
 *  empty body that saves nothing. */
export function nestedSaveScopes(st: WorkflowStmtIR): SaveScope[] {
  switch (st.kind) {
    case "for-each":
      return [{ kind: "iteration", body: st.body, saves: st.savesPerIteration }];
    case "if-let":
    case "if":
      return [
        { kind: "branch", body: st.thenBody, saves: st.savesInThen },
        { kind: "branch", body: st.elseBody ?? [], saves: st.savesInElse },
      ];
    case "variant-match":
      return [
        ...st.arms.map((a) => ({ kind: "branch" as const, body: a.body, saves: a.savesInArm })),
        { kind: "branch", body: st.elseBody ?? [], saves: st.savesInElse },
      ];
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
