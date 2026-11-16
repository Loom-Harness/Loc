// `workflowPostBody` lists the steps a workflow command route runs after its
// body, in the one order every backend keeps.  Pinned on corpus workflows that
// reach each condition: an expected-failure result (commit, then the error
// answer), a non-transactional body (no commit), its `transactional` twin, and
// a durable `emit` captured inside the transaction.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workflowPostBody } from "../../../src/ir/plan/index.js";
import { commandWorkflowsOf } from "../../../src/ir/util/workflow-command-route.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";

async function stepsOf(fixture: string): Promise<Record<string, string[]>> {
  const text = readFileSync(`test/fixtures/corpus/${fixture}.ddd`, "utf8").replaceAll(
    "__PLATFORM__",
    "node",
  );
  const loom = await buildLoomModel(text);
  const out: Record<string, string[]> = {};
  for (const ctx of enrichedContexts(loom)) {
    for (const wf of commandWorkflowsOf(ctx)) {
      out[`${ctx.name}.${wf.name}`] = workflowPostBody(wf, ctx).map((s) => s.kind);
    }
  }
  return out;
}

describe("workflowPostBody", () => {
  it("answers an expected failure after the commit; its events flush only on success", async () => {
    const steps = await stepsOf("workflow-expected-failure");
    expect(steps["Ledger.Pay"]).toEqual([
      "result",
      "commit",
      "aggregate-events-flush",
      "entry-error-answer",
      "emit-dispatch",
    ]);
    expect(steps["Ledger.Hold"]).toEqual([
      "state-row-save",
      "result",
      "commit",
      "aggregate-events-flush",
      "entry-error-answer",
    ]);
  });

  it("commits only a body that runs in a transaction", async () => {
    const steps = await stepsOf("workflow-partial-commit");
    expect(steps["Shop.BumpThenFail"]).toEqual(["exit-saves"]);
    expect(steps["Shop.BumpThenFailAtomically"]).toEqual([
      "exit-saves",
      "commit",
      "aggregate-events-flush",
    ]);
  });

  it("captures a durable emit inside the transaction, before the commit", async () => {
    const steps = await stepsOf("saga-durable-cross-context");
    expect(steps["Catalog.Relog"]).toEqual([
      "durable-capture",
      "commit",
      "aggregate-events-flush",
      "emit-dispatch",
    ]);
  });
});
