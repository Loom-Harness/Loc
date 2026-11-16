// The binding-flow plan facts on the `workflow-loop-carried` corpus body:
//
//   let t = Tallies.get(tally)
//   let rows = Buckets.all(…)
//   for b in rows {
//     b.visit()
//     let members = Items.all(InBucket(b.name), …)
//     for i in members { i.see(); t.bump() }
//   }
//
// `t` is bound outside both loops and changed inside the inner one, so the
// outer loop threads it out; `b` and `i` are the loops' own variables and never
// leave them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  carriedInto,
  changedIn,
  isReadAfter,
  threadedOut,
  unreadBindings,
} from "../../../src/ir/plan/index.js";
import type { WorkflowStmtIR } from "../../../src/ir/types/loom-ir.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";

async function body(): Promise<WorkflowStmtIR[]> {
  const text = readFileSync("test/fixtures/corpus/workflow-loop-carried.ddd", "utf8").replaceAll(
    "__PLATFORM__",
    "node",
  );
  const loom = await buildLoomModel(text);
  const wf = enrichedContexts(loom)
    .flatMap((c) => c.workflows)
    .find((w) => w.name === "tallyAll");
  if (!wf) throw new Error("tallyAll not found");
  return wf.statements;
}

type ForEach = Extract<WorkflowStmtIR, { kind: "for-each" }>;

describe("binding-flow", () => {
  it("carries into a loop only the outer names it reads", async () => {
    const stmts = await body();
    const outer = stmts.find((s): s is ForEach => s.kind === "for-each")!;
    expect([...carriedInto(outer.body, [outer.var])].sort()).toEqual(["t"]);
    const inner = outer.body.find((s): s is ForEach => s.kind === "for-each")!;
    expect([...carriedInto(inner.body, [inner.var], new Set(["t"]))].sort()).toEqual(["t"]);
  });

  it("knows what a loop changes and what it threads out", async () => {
    const stmts = await body();
    const i = stmts.findIndex((s) => s.kind === "for-each");
    const loop = stmts[i]!;
    expect([...changedIn([(loop as ForEach).body])].sort()).toEqual(["b", "i", "t"]);
    // Nothing after the loop reads `t`; the exit save keeps it.
    const unsaved = threadedOut(loop, { rest: stmts.slice(i + 1) });
    expect(unsaved).toEqual({ threaded: ["t"], kept: [], ownState: false });
    const saved = threadedOut(loop, { rest: stmts.slice(i + 1), saved: new Set(["t"]) });
    expect(saved.kept).toEqual(["t"]);
  });

  it("answers read-after and unread bindings", async () => {
    const stmts = await body();
    expect(isReadAfter("rows", stmts.slice(2))).toBe(true);
    expect(isReadAfter("rows", stmts.slice(3))).toBe(false);
    // `t` is only an operation receiver inside the loop: a read.  Nothing is unread.
    expect(unreadBindings(stmts)).toEqual([]);
  });

  it("is empty for a statement that nests no body", async () => {
    const stmts = await body();
    expect(threadedOut(stmts[0]!, { rest: stmts.slice(1) })).toEqual({
      threaded: [],
      kept: [],
      ownState: false,
    });
  });

  it("reports an own-state assignment inside a branch", async () => {
    const text = readFileSync("test/fixtures/corpus/workflow-if.ddd", "utf8").replaceAll(
      "__PLATFORM__",
      "node",
    );
    const loom = await buildLoomModel(text);
    const bodies = enrichedContexts(loom)
      .flatMap((c) => c.workflows)
      .flatMap((w) => (w.subscriptions ?? []).map((o) => o.statements));
    const branch = bodies
      .flat()
      .find((s) => s.kind === "if" && threadedOut(s, { rest: [] }).ownState);
    expect(branch, "an `if` that assigns own state in a branch").toBeDefined();
  });
});
