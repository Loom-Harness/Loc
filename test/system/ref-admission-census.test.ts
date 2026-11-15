// Write-time reference admission census (docs/tenancy.md → "Reference
// admission").
//
// `src/ir/plan/ref-scope.ts` decides which persisted `X id` references a save
// must probe (`admittedReferences`).  This census forbids a write path that
// persists such a reference without consuming that decision: over every corpus
// fixture whose model carries one, on every backend, the generated repository
// of each relational aggregate with an admitted reference spells that backend's
// probe.  A non-relational save (event-sourced, document, embedded) is refused
// before generation by `loom.target-unsupported#reference-admission-unrealized`,
// so it has no row here.
//
// It asserts wiring nothing else observes until a two-tenant boot: the
// behaviour itself is the isolation e2e's `assertReferenceAdmission` rung.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { admittedReferences } from "../../src/ir/plan/ref-scope.js";
import { aggregateIsEventSourced } from "../../src/ir/util/resolve-datasource.js";
import { expectReach } from "../_helpers/census-reach.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

/** The corpus fixtures whose model persists a reference to a tenantOwned
 *  target.  A fixture that gains one is caught by the completeness case. */
const FIXTURES = ["tenancy-owned", "policy-row-rules", "shareable", "org-context"] as const;

import type { Backend } from "../fixtures/corpus/backends.js";

/** Every backend on its default persistence, plus the alternate adapters. */
const LEGS: readonly { backend: Backend; persistence?: string }[] = [
  { backend: "node" },
  { backend: "node", persistence: "mikroorm" },
  { backend: "dotnet" },
  { backend: "dotnet", persistence: "dapper" },
  { backend: "java" },
  { backend: "python" },
  { backend: "vanilla" },
];

const snake = (n: string): string => n.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const lowerFirst = (n: string): string => n.charAt(0).toLowerCase() + n.slice(1);

/** Each backend's repository file for an aggregate, and the probe it spells. */
const PROBE: Record<Backend, { file: (agg: string) => RegExp; probe: string }> = {
  node: {
    file: (a) => new RegExp(`/db/repositories/${lowerFirst(a)}-repository\\.ts$`),
    probe: "throw referenceNotAdmitted()",
  },
  dotnet: { file: (a) => new RegExp(`/${a}Repository\\.cs$`), probe: "__admit0Found" },
  java: {
    file: (a) => new RegExp(`/${a}RepositoryImpl\\.java$`),
    probe: "_admitReferences(aggregate)",
  },
  python: {
    file: (a) => new RegExp(`/${snake(a)}_repository\\.py$`),
    probe: "_reference_not_admitted()",
  },
  vanilla: {
    file: (a) => new RegExp(`/${snake(a)}_repository\\.ex$`),
    probe: "__admit_references()",
  },
};

async function admittingAggregates(fixture: string): Promise<string[]> {
  const loom = await buildLoomModel(corpusSourceFor(fixture, "node"));
  return enrichedContexts(loom).flatMap((ctx) =>
    ctx.aggregates
      .filter((a) => !a.isAbstract && !aggregateIsEventSourced(a))
      .filter((a) => (a.savingShape ?? "relational") === "relational")
      .filter((a) => admittedReferences(a, ctx.aggregates).length > 0)
      .map((a) => a.name),
  );
}

describe("reference admission census — every admitting save probes", () => {
  it("lists every corpus fixture that persists a reference to a tenantOwned target", async () => {
    const dir = path.resolve(__dirname, "../fixtures/corpus");
    const found: string[] = [];
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".ddd"))) {
      const id = f.replace(/\.ddd$/, "");
      if (!fs.readFileSync(path.join(dir, f), "utf8").includes("__PLATFORM__")) continue;
      if (!/tenantOwned/.test(fs.readFileSync(path.join(dir, f), "utf8"))) continue;
      if ((await admittingAggregates(id)).length > 0) found.push(id);
    }
    expect(found.sort()).toEqual([...FIXTURES].sort());
  }, 600_000);
  for (const fixture of FIXTURES) {
    it(`${fixture}: carries an admitted reference`, async () => {
      expect(await admittingAggregates(fixture)).not.toEqual([]);
    });
    for (const leg of LEGS) {
      const { backend, persistence } = leg;
      const label = persistence ? `${backend}/${persistence}` : backend;
      it(`${fixture} × ${label}: each admitting repository spells the probe`, async () => {
        const aggs = await admittingAggregates(fixture);
        expectReach(`${fixture} admitting aggregates`, aggs.length, 1);
        const files = await generateSystemFiles(corpusSourceFor(fixture, backend, persistence));
        for (const agg of aggs) {
          const hits = [...files.entries()].filter(([p]) => PROBE[backend].file(agg).test(`/${p}`));
          expect(hits.length, `${label}: no repository file for ${agg}`).toBe(1);
          expect(hits[0]![1], `${label}: ${agg}'s save does not probe its references`).toContain(
            PROBE[backend].probe,
          );
        }
      }, 120_000);
    }
  }
});
