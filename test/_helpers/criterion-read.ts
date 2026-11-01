// The read a predicate takes now that a repository declares no `find`s: a
// `criterion` over the aggregate, run through the repository by a
// `queryHandler`.  Tests that measure how a predicate lowers (queryable gates,
// adapter renderings) were written against `find x(params): T? where <pred>`;
// this spells the same predicate in the position that reaches the same query
// emitters — the criterion's `findAllBy<Criterion>` retrieval.

export interface CriterionRead {
  /** The criterion's name. */
  readonly name: string;
  /** The repository method the read emits (`findAllBy<Criterion>`). */
  readonly method: string;
  /** The `criterion` + `queryHandler` declarations, ready to splice into a
   *  context body. */
  readonly members: string;
}

/** `name` and `params` (`q: int, f: bool`) as a find spelled them, `where` the
 *  predicate over the aggregate `agg` read through repository `repo`. */
export function criterionRead(
  name: string,
  params: string,
  where: string,
  agg: string,
  repo: string,
): CriterionRead {
  const crit = `${name[0]!.toUpperCase()}${name.slice(1)}`;
  const args = params
    .split(",")
    .map((x) => x.split(":")[0]!.trim())
    .filter(Boolean)
    .join(", ");
  return {
    name: crit,
    method: `findAllBy${crit}`,
    members: [
      `criterion ${crit}${params ? `(${params})` : ""} of ${agg} = ${where}`,
      `queryHandler List${crit}(${params}): ${agg}[] {`,
      `  let r = ${repo}.run(${crit}(${args}))`,
      `  return r`,
      `}`,
    ].join("\n"),
  };
}

/** {@link criterionRead} from a find spelled `find <name>(<params>): <T>[?]
 *  where <predicate>`. */
export function criterionReadOfFind(find: string, agg: string, repo: string): CriterionRead {
  const m = /^\s*find (\w+)\(([^)]*)\)\s*:\s*[^\s]+\s+where\s+(.+?)\s*$/.exec(find);
  if (!m) throw new Error(`not a find with a where: ${find}`);
  return criterionRead(m[1]!, m[2]!, m[3]!, agg, repo);
}
