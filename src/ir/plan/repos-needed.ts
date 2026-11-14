// The repositories a workflow, reactor or handler body needs: every one it
// reads through, deletes through, creates through or saves through.  A backend
// constructs (or injects) exactly these, so one that missed a statement kind
// named a repository it never built, and one that listed them in a different
// order produced a different file from the same model.  Every backend declares
// them in the order this returns: sorted by repository name.  A created
// aggregate is named through its save, never through the `factory-let`.

import type { WorkflowStmtIR } from "../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../util/walk.js";

export interface RepoNeed {
  repoName: string;
  aggName: string;
}

type Save = { repoName: string; aggName: string };

/** The repositories `bodies` (and their exit `saves`) need, de-duplicated by
 *  repository and sorted by repository name. */
export function reposNeeded(
  bodies: readonly (readonly WorkflowStmtIR[])[],
  saves: readonly Save[] = [],
): RepoNeed[] {
  const byRepo = new Map<string, string>();
  const add = (r: Save): void => {
    byRepo.set(r.repoName, r.aggName);
  };
  for (const body of bodies) {
    for (const top of body) {
      walkWorkflowStmtsDeep(top, (s) => {
        switch (s.kind) {
          case "repo-let":
          case "repo-run":
          case "repo-delete":
            add(s);
            break;
          case "if-let":
            add(s);
            s.savesInThen.forEach(add);
            s.savesInElse.forEach(add);
            break;
          case "for-each":
            s.savesPerIteration.forEach(add);
            break;
          case "if":
            s.savesInThen.forEach(add);
            s.savesInElse.forEach(add);
            break;
          case "variant-match":
            for (const arm of s.arms) {
              arm.savesInArm.forEach(add);
              (arm.discardsInArm ?? []).forEach(add);
            }
            s.savesInElse.forEach(add);
            (s.discardsInElse ?? []).forEach(add);
            break;
          case "precondition":
          case "requires":
          case "expr-let":
          case "assign":
          case "emit":
          case "op-call":
          case "resource-call":
          case "domain-service-call":
          case "not-found":
          // A created aggregate is saved at exit (or by its branch), so its
          // save names the repository.
          case "factory-let":
            break;
          default: {
            const _exhaustive: never = s;
            void _exhaustive;
          }
        }
      });
    }
  }
  saves.forEach(add);
  return [...byRepo.entries()]
    .map(([repoName, aggName]) => ({ repoName, aggName }))
    .sort((a, b) => (a.repoName < b.repoName ? -1 : a.repoName > b.repoName ? 1 : 0));
}
