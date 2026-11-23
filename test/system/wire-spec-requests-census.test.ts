// Gate for D-WIRE-RECORDS (docs/decisions).
// Every request a corpus deployable accepts has a contract in
// `contracts/wire-spec.json`'s `requests` bucket: each create and public operation
// of an exposed aggregate (its `command` record) and each command-started
// workflow (its facade create's parameters).  The artefact is what `ddd diff`
// compares, so a request missing here is a request whose breaking changes go
// unreported.
//
// A request entry describes the JSON BODY a client sends: a field the route
// carrying the record binds from the path, the query string, a header or the
// raw body (`requestFieldSources`) is named under `bound` and is NOT a body
// property, so `ddd diff` never reads a path `id` as a body field a client
// must start sending.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { requestFieldSources } from "../../src/ir/plan/request-wire.js";
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

  it("a request's body omits every field its route binds elsewhere, and names where", async () => {
    const wrong: string[] = [];
    let bound = 0;
    for (const file of trackedDddFiles().filter(
      (f) => f.startsWith("test/fixtures/corpus/") && f.endsWith(".ddd"),
    )) {
      const { model, errors } = await parseString(dddSourceOf(file), { validate: true });
      expect(errors, `${file}: corpus fixture must parse`).toEqual([]);
      const loom = enrichLoomModel(lowerModel(model));
      for (const sys of loom.systems) {
        const doc = buildWireSpec(sys);
        const entry = (record: string) =>
          doc.requests[record] ??
          Object.entries(doc.requests).find(([k]) => k.split(".").pop() === record)?.[1];
        for (const [, byRecord] of requestFieldSources(sys)) {
          for (const [record, byField] of byRecord) {
            const schema = entry(record);
            if (!schema) continue; // a record the requests bucket does not carry
            for (const [field, sources] of byField) {
              if (sources.has("body")) continue;
              bound++;
              const at = schema.bound?.[field];
              if (!at) wrong.push(`${file}: ${record}.${field} is not listed in \`bound\``);
              else if (Object.hasOwn(schema.properties, field))
                wrong.push(
                  `${file}: ${record}.${field} rides in ${at.join("/")} but is a body property`,
                );
            }
          }
        }
      }
    }
    // The denominator: every corpus model routes a path `{id}` into a record.
    expectReach("fields bound outside the body", bound, 500);
    expect(wrong).toEqual([]);
  }, 180_000);
});
