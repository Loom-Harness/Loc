// `workflowRouteErrorStatuses` is the one answer to "which non-2xx statuses
// does a workflow's command route declare".  Three backends already declare
// the shared base table plus the expected-failure arms' split statuses; this
// pins the plan fact to that answer over every command workflow the corpus
// declares, so a backend that moves onto the fact publishes the same set it
// did before.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { opUnionResponses } from "../../../src/generator/_payload/union-wire.js";
import { workflowRouteErrorStatuses } from "../../../src/ir/plan/index.js";
import { workflowCanAnswerNotFound, workflowIsGuarded } from "../../../src/ir/types/queries.js";
import { errorStatuses } from "../../../src/ir/util/openapi-errors.js";
import { wireStatusResolver } from "../../../src/ir/util/wire-policy.js";
import {
  commandCreateEntryResult,
  commandCreateResult,
  commandWorkflowsOf,
} from "../../../src/ir/util/workflow-command-route.js";
import { expectReach } from "../../_helpers/census-reach.js";
import { buildLoomModel, enrichedContexts } from "../../_helpers/ir.js";

const CORPUS = "test/fixtures/corpus";

describe("workflowRouteErrorStatuses", () => {
  it("equals the base table plus the split arm statuses on every corpus command workflow", async () => {
    let routes = 0;
    let withArms = 0;
    const mismatches: string[] = [];
    for (const f of readdirSync(CORPUS).filter((n) => n.endsWith(".ddd"))) {
      const text = readFileSync(join(CORPUS, f), "utf8").replaceAll("__PLATFORM__", "node");
      let loom: Awaited<ReturnType<typeof buildLoomModel>>;
      try {
        loom = await buildLoomModel(text);
      } catch {
        continue; // a fixture refused on `node` has no node route to compare
      }
      for (const ctx of enrichedContexts(loom)) {
        for (const wf of commandWorkflowsOf(ctx)) {
          routes++;
          const result = commandCreateResult(wf);
          const split =
            result?.type.kind === "union" && commandCreateEntryResult(wf)
              ? opUnionResponses(result.type.variants, ctx)
              : undefined;
          if (split && split.errorStatuses.length > 0) withArms++;
          const expected = [
            ...new Set([
              ...errorStatuses(
                "workflow",
                workflowIsGuarded(wf),
                wireStatusResolver(ctx.structuralErrorStatuses),
                { readsAggregate: workflowCanAnswerNotFound(wf, ctx) },
              ),
              ...(split?.errorStatuses.map((s) => s.status) ?? []),
            ]),
          ].sort((a, b) => a - b);
          const got = workflowRouteErrorStatuses(wf, ctx);
          if (JSON.stringify(got) !== JSON.stringify(expected)) {
            mismatches.push(`${f} ${ctx.name}.${wf.name}: ${got} vs ${expected}`);
          }
        }
      }
    }
    expectReach("corpus command workflows", routes, 70);
    expectReach("corpus command workflows with error arms", withArms, 2);
    expect(mismatches).toEqual([]);
  }, 300_000);
});
