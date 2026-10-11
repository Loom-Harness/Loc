import type { FindIR, RepositoryIR } from "../types/loom-ir.js";

/** The finds a repository implements as methods of its own: every find except
 *  a retrieval route's (`FindIR.retrieval`), which the retrieval's
 *  `run<Retrieval>` method answers.  Repository / port / store emitters read
 *  this; route, OpenAPI and client emitters read `repo.finds`. */
export function repositoryMethodFinds(repo: RepositoryIR | undefined): FindIR[] {
  return (repo?.finds ?? []).filter((f) => f.retrieval === undefined);
}
