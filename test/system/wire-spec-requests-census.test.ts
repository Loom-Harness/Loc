// Every request a corpus deployable accepts has a contract in
// `.loom/wire-spec.json`'s `requests` bucket: each create and public operation
// of an exposed aggregate (its `command` record) and each command-started
// workflow (its facade create's parameters).  The artefact is what `ddd diff`
// compares, so a request missing here is a request whose breaking changes go
// unreported.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { EnrichedSystemIR } from "../../src/ir/types/loom-ir.js";
import { workflowEmitsCommandRoute } from "../../src/ir/types/queries.js";
import { declaredResponseFor } from "../../src/ir/util/declared-response.js";
import { buildWireSpec } from "../../src/system/wire-spec.js";
import { upperFirst } from "../../src/util/naming.js";
import { expectReach } from "../_helpers/census-reach.js";
import { dddSourceOf, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/parse.js";

/** The request names one system must carry, and the keys it does carry. */
function expectedRequests(sys: EnrichedSystemIR): { want: string[]; have: Set<string> } {
  const doc = buildWireSpec(sys);
  // A colliding key is context-qualified; compare on the bare name.
  const have = new Set(Object.keys(doc.requests).map((k) => k.split(".").pop()!));
  const want: string[] = [];
  for (const sd of sys.subdomains) {
    for (const ctx of sd.contexts) {
      for (const agg of ctx.aggregates) {
        // Only a served aggregate (one a repository loads) takes requests.
        if (!declaredResponseFor(ctx.payloads, agg)) continue;
        if (!ctx.repositories.some((r) => r.aggregateName === agg.name)) continue;
        for (const c of agg.creates) {
          want.push(
            `${c.name === null || c.name === "create" ? "Create" : upperFirst(c.name)}${agg.name}Command`,
          );
        }
        for (const op of agg.operations) {
          if (op.visibility !== "public") continue;
          want.push(`${upperFirst(op.name)}${agg.name}Command`);
        }
      }
      for (const wf of ctx.workflows) {
        if (workflowEmitsCommandRoute(wf)) want.push(`${upperFirst(wf.name)}Command`);
      }
    }
  }
  return { want, have };
}

describe("wire-spec request contracts (corpus census)", () => {
  it("carries a request contract for every create, operation and command-started workflow", async () => {
    const missing: string[] = [];
    let requests = 0;
    let workflows = 0;
    for (const file of trackedDddFiles().filter(
      (f) => f.startsWith("test/fixtures/corpus/") && f.endsWith(".ddd"),
    )) {
      const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
      expect(errors, `${file}: corpus fixture must parse`).toEqual([]);
      const loom = enrichLoomModel(lowerModel(model));
      for (const sys of loom.systems) {
        const { want, have } = expectedRequests(sys);
        requests += want.length;
        workflows += want.filter((w) =>
          sys.subdomains.some((sd) =>
            sd.contexts.some((c) =>
              c.workflows.some((wf) => `${upperFirst(wf.name)}Command` === w),
            ),
          ),
        ).length;
        for (const w of want) if (!have.has(w)) missing.push(`${file}: ${w}`);
      }
    }
    // The denominator: a census over an empty population proves nothing.
    expectReach("served requests", requests, 900);
    expectReach("command-started workflows", workflows, 50);
    expect(missing).toEqual([]);
  }, 180_000);
});
