// `loom.transactional-no-effect` — an effect NESTED in a `for`-each body
// (eval-closure-review item 44).
//
// The per-arm `markMutated` calls in `validateWorkflowStatements` counted a
// nested `op-call` inside a `for`-each but not an `emit`, a factory `let` or a
// `Repo.delete`, so a transactional workflow whose only effect lived in a loop
// drew a false "has no effect" warning — while every backend emitted a
// `db.transaction(...)` wrapping exactly that effect.  The effect test now
// rides `walkWorkflowStmtsDeep`, so it sees every reachable statement.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const src = (loopBody: string): string => `
system Tx {
  subdomain Core {
    context Jobs {
      event Pinged { job: Job id }
      aggregate Job with crudish {
        name: string
      }
      criterion ByName(n: string) of Job = name == n
      repository Jobs for Job { }
      workflow sweep transactional {
        create(needle: string) {
          let matched = Jobs.run(ByName(needle), page: { offset: 0, limit: 100 })
          for j in matched {
            ${loopBody}
          }
        }
      }
    }
  }
  storage primary { type: postgres }
  resource appState { for: Jobs, kind: state, use: primary }
  deployable api { platform: node, contexts: [Jobs], dataSources: [appState], port: 8000 }
}
`;

async function diagnose(loopBody: string) {
  const { model, errors } = await parseString(src(loopBody));
  expect(errors).toEqual([]);
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const CODE = "loom.transactional-no-effect";

describe("transactional-no-effect sees an effect nested in a for-each", () => {
  it.each([
    ["an emit", "emit Pinged { job: j.id }"],
    ["a factory let", "let c = Job.create({ name: j.name })"],
    ["a repository delete", "Jobs.delete(j)"],
  ])("%s inside the loop is an effect", async (_label, body) => {
    const diags = await diagnose(body);
    expect(diags.filter((d) => d.severity === "error")).toEqual([]);
    expect(diags.map((d) => d.code)).not.toContain(CODE);
  });

  it("a loop that only READS still has no effect (the warning is not blanket-suppressed)", async () => {
    const diags = await diagnose("precondition j.name != needle");
    expect(diags.map((d) => d.code)).toContain(CODE);
  });
});
