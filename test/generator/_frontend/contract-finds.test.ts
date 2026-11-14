// The client finds a frontend reads off the Frontend Contract (`clientFinds`,
// `src/generator/_frontend/contract.ts`) agree with what the backend serves:
// for every backend deployable in every corpus model that routes a synthesized
// paged find, the contract's answer — which finds a client may call, and on
// which route — equals the one `pagedFindRoutes` + `servedFindRoute` give over
// the enriched IR.  The routed finds are the only part of the find surface no
// generated frontend in the corpus reaches, so the byte-identical snapshot
// cannot see them; this pins the decision instead.

import { describe, expect, it } from "vitest";
import { clientFinds } from "../../../src/generator/_frontend/contract.js";
import { buildFrontendContract } from "../../../src/ir/contract/frontend-contract.js";
import { exposedContexts } from "../../../src/ir/util/exposed-contexts.js";
import { pagedFindRoutes, servedFindRoute } from "../../../src/ir/util/paged-find-routes.js";
import { dddSourceOf, trackedDddFiles } from "../../_helpers/ddd-corpus.js";
import { toLoomModel } from "../../_helpers/ir.js";
import { parseString } from "../../_helpers/parse.js";

describe("contract client finds", () => {
  it("agree with the routes every backend serves", async () => {
    let routed = 0;
    const mismatches: string[] = [];
    for (const file of trackedDddFiles()) {
      const src = dddSourceOf(file);
      if (!/scaffoldPaged|queryHandler/.test(src)) continue;
      const { model, errors } = await parseString(src, { validate: true });
      if (errors.length > 0) continue;
      const loom = toLoomModel(model);
      for (const sys of loom.systems) {
        const contract = buildFrontendContract(loom, sys);
        for (const backend of sys.deployables.filter((d) => d.serves.length > 0)) {
          const routes = pagedFindRoutes(sys, backend);
          for (const ctx of exposedContexts(sys)) {
            for (const agg of ctx.aggregates) {
              const repo = ctx.repositories.find((r) => r.aggregateName === agg.name);
              const expected = (repo?.finds ?? [])
                .map((f) => ({ name: f.name, path: servedFindRoute(agg.name, f, routes)?.path }))
                .filter((f) => f.name === "all" || f.path !== undefined);
              const actual = clientFinds(contract, agg.name, backend.serves).map((f) => ({
                name: f.name,
                path: f.path,
              }));
              routed += expected.filter((f) => f.path !== undefined).length;
              if (JSON.stringify(actual) !== JSON.stringify(expected)) {
                mismatches.push(
                  `${file} ${backend.name} ${agg.name}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
                );
              }
            }
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(routed).toBeGreaterThan(0);
  }, 600_000);
});
