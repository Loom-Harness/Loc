// Gate for D-PARENT-FIRST (docs/decisions).
// A created aggregate is saved before the loop or branch that writes rows
// reading it, and is not saved again at the exit unless something changes it
// afterwards.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parentFirstSaves, withParentFirstSaves } from "../../../src/ir/plan/index.js";
import type { WorkflowIR } from "../../../src/ir/types/loom-ir.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";

async function fanOut(text: string): Promise<WorkflowIR> {
  const loom = await buildLoomModel(text.replaceAll("__PLATFORM__", "node"));
  const wf = enrichedContexts(loom)
    .flatMap((c) => c.workflows)
    .find((w) => w.name === "fanOut");
  if (!wf) throw new Error("fanOut not found");
  return wf;
}

const FIXTURE = readFileSync("test/fixtures/corpus/workflow-parent-first.ddd", "utf8");

describe("parentFirstSaves", () => {
  it("saves the created parent before the loop and drops its exit save", async () => {
    const wf = await fanOut(FIXTURE);
    const plan = parentFirstSaves(wf.statements, wf.savesAtExit);
    const loopAt = wf.statements.findIndex((s) => s.kind === "for-each");
    expect([...plan.before.keys()]).toEqual([loopAt]);
    expect(plan.before.get(loopAt)?.map((s) => s.name)).toEqual(["b"]);
    expect(wf.savesAtExit.map((s) => s.name)).toEqual(["b"]);
    expect(plan.remaining).toEqual([]);
  });

  it("keeps the exit save of a parent an operation changes after the loop", async () => {
    const changed = FIXTURE.replace(
      "name: string\n      }\n      aggregate Seed",
      "name: string\n        operation rename(to: string) { name := to }\n      }\n      aggregate Seed",
    ).replace(
      "            let l = Line.create(batch: b.id, label: s.label)\n          }",
      '            let l = Line.create(batch: b.id, label: s.label)\n          }\n          b.rename("done")',
    );
    const wf = await fanOut(changed);
    const plan = parentFirstSaves(wf.statements, wf.savesAtExit);
    expect(plan.before.size).toBe(1);
    expect(plan.remaining.map((s) => s.name)).toEqual(["b"]);
  });

  it("saves nothing early when the loop writes no rows or never reads the parent", async () => {
    const unread = FIXTURE.replace("Line.create(batch: b.id,", 'Line.create(batch: "none",');
    const wf = await fanOut(unread);
    expect(parentFirstSaves(wf.statements, wf.savesAtExit).before.size).toBe(0);
  });

  it("hands a nesting statement only the saves it still owes", async () => {
    const wf = await fanOut(FIXTURE);
    const loop = wf.statements.find((s) => s.kind === "for-each");
    expect(loop).toBeDefined();
    expect(withParentFirstSaves(loop!)).toMatchObject({ kind: "for-each" });
    // A statement that nests no body comes back unchanged.
    const first = wf.statements[0]!;
    expect(withParentFirstSaves(first)).toBe(first);
  });
});
