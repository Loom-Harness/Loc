// Natural-key reads — `Repo.getBy(<col>: v, …)` / `Repo.findBy(<col>: v, …)`
// (D-REPO-KEY-LOOKUP).
//
// A natural-key read loads ONE row by a declared `unique (…)` tuple, so its
// named arguments must equal one tuple of the repository's aggregate exactly —
// in any order, every column present:
//
//   - loom.repo-key-not-unique  — the names are covered by no declared tuple
//                                 (with a did-you-mean over the tuples);
//   - loom.repo-key-incomplete  — the names are part of a tuple but miss a
//                                 column, or an argument is positional.
//
// The tuple rule itself lives in `util/repository-contract.ts`
// (`resolveKeyTuple`) and the tuples in `language/repo-key-tuples.ts`; the
// lowerer reads the same two, so a call this check accepts is exactly a call
// the lowerer can emit.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { nearestName } from "../../util/edit-distance.js";
import { repositoryVerb, resolveKeyTuple } from "../../util/repository-contract.js";
import {
  isBoundedContext,
  isMemberSuffix,
  isNameRef,
  isPostfixChain,
  isRepository,
  type Model,
  type Repository,
} from "../generated/ast.js";
import { declaredKeyTuples } from "../repo-key-tuples.js";

/** The tuple to suggest for a call naming `names`: the one sharing the most
 *  columns, else the one whose spelling is closest. */
function suggestTuple(names: readonly string[], tuples: readonly string[][]): string[] | undefined {
  let best: string[] | undefined;
  let bestShared = 0;
  for (const t of tuples) {
    const shared = t.filter((c) => names.includes(c)).length;
    if (shared > bestShared) {
      best = t;
      bestShared = shared;
    }
  }
  if (best) return best;
  const spelled = new Map(tuples.map((t) => [t.join(", "), t]));
  const near = nearestName(names.join(", "), spelled.keys());
  return near ? spelled.get(near) : undefined;
}

function argSpelling(cols: readonly string[]): string {
  return cols.map((c) => `${c}: …`).join(", ");
}

export function checkRepoKeyLookups(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isPostfixChain(node) || !isNameRef(node.head) || node.suffixes.length !== 1) continue;
    const s = node.suffixes[0]!;
    if (!isMemberSuffix(s) || !s.call) continue;
    if (repositoryVerb(s.member)?.args !== "key") continue;
    const ctx = AstUtils.getContainerOfType(node, isBoundedContext);
    const repoName = node.head.name;
    const repo = ctx?.members.find((m): m is Repository => isRepository(m) && m.name === repoName);
    const agg = repo?.aggregate?.ref;
    if (!repo || !agg) continue;
    const tuples = declaredKeyTuples(agg);
    const args = s.args ?? [];
    const names = args.map((a) => a.name);
    const res = resolveKeyTuple(names, tuples);
    if (res.kind === "match") continue;
    const verb = s.member;
    if (res.kind === "positional") {
      accept(
        "error",
        diagMessage("loom.repo-key-incomplete#positional", { repo: repoName, verb, agg: agg.name }),
        { node: s, code: "loom.repo-key-incomplete" },
      );
      continue;
    }
    if (res.kind === "incomplete") {
      accept(
        "error",
        diagMessage("loom.repo-key-incomplete", {
          repo: repoName,
          verb,
          agg: agg.name,
          tuple: res.tuple.join(", "),
          missing: res.missing.map((c) => `'${c}'`).join(", "),
        }),
        { node: s, code: "loom.repo-key-incomplete" },
      );
      continue;
    }
    const given = names as string[];
    const suggestion = suggestTuple(given, tuples);
    accept(
      "error",
      diagMessage("loom.repo-key-not-unique", {
        repo: repoName,
        verb,
        cols: given.join(", "),
        agg: agg.name,
        declared: tuples.map((t) => `(${t.join(", ")})`).join(", "),
        suggestion: suggestion ? argSpelling(suggestion) : "",
      }),
      { node: s, code: "loom.repo-key-not-unique" },
    );
  }
}
