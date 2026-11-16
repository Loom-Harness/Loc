// `transactional` is the only way a workflow gets a transaction.  A workflow
// whose create answers an expected failure (`T or E`) or that re-checks a held
// row's write scope must roll back as a whole, so it must say `transactional`
// (`loom.workflow-implicit-transaction`); the plan fact
// `workflowRunsInTransaction` then reads the keyword alone, and the boundary
// every backend keeps is the one the source shows.

import * as fs from "node:fs";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { workflowRunsInTransaction } from "../../src/ir/plan/index.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.workflow-implicit-transaction";

const entryResult = (keyword: string) => `
system S {
  subdomain M { context C {
    error Declined { reason: string }
    payload Receipt { left: int }
    aggregate Account with crudish {
      balance: int
      operation withdraw(amt: int) { precondition amt <= balance  balance := balance - amt }
    }
    repository Accounts for Account
    workflow Pay${keyword} {
      create(account: Account id, amt: int): Receipt or Declined {
        let a = Accounts.get(account)
        a.withdraw(amt)
        return Receipt { left: a.balance }
      }
    }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}`;

/** The corpus fixture whose `touchNotes` re-checks a held row's write scope. */
const recheck = (keyword: string) =>
  fs
    .readFileSync("test/fixtures/corpus/tenancy-hierarchy.ddd", "utf8")
    .replaceAll("__PLATFORM__", "node")
    .replace("workflow touchNotes transactional {", `workflow touchNotes${keyword} {`);

async function lowered(src: string) {
  const { model, errors } = await parseString(src, { validate: false });
  expect(errors).toEqual([]);
  return enrichLoomModel(lowerModel(model));
}

function workflow(loom: Awaited<ReturnType<typeof lowered>>, name: string) {
  for (const sys of loom.systems)
    for (const sd of sys.subdomains)
      for (const ctx of sd.contexts)
        for (const wf of ctx.workflows) if (wf.name === name) return { wf, ctx };
  throw new Error(`no workflow ${name}`);
}

describe(CODE, () => {
  it("refuses an entry-result workflow without `transactional`", async () => {
    const hits = validateLoomModel(await lowered(entryResult(""))).filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.severity).toBe("error");
    expect(hits[0]!.message).toContain("workflow 'Pay'");
    expect(hits[0]!.message).toContain("expected failure");
  });

  it("refuses a write-scope re-checking workflow without `transactional`", async () => {
    const hits = validateLoomModel(await lowered(recheck(""))).filter((d) => d.code === CODE);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("workflow 'touchNotes'");
    expect(hits[0]!.message).toContain("write scope");
  });

  it("accepts both once declared `transactional`", async () => {
    for (const src of [entryResult(" transactional"), recheck(" transactional")]) {
      expect(validateLoomModel(await lowered(src)).map((d) => d.code)).not.toContain(CODE);
    }
  });
});

describe("workflowRunsInTransaction reads the keyword alone", () => {
  it("is false for an entry-result workflow without the keyword, true with it", async () => {
    const without = workflow(await lowered(entryResult("")), "Pay");
    expect(workflowRunsInTransaction(without.wf, without.ctx)).toBe(false);
    const withKw = workflow(await lowered(entryResult(" transactional")), "Pay");
    expect(workflowRunsInTransaction(withKw.wf, withKw.ctx)).toBe(true);
  });
});
