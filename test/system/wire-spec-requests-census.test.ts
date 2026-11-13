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

/** Requests the deployable serves with no declared contract record: an
 *  aggregate with no `repository` in source is served through the repository
 *  enrichment adds, but the scaffold — which runs before enrichment — splices
 *  no command record for it.  Pinned exactly; a fix deletes its rows. */
const UNCONTRACTED_REQUESTS = [
  "test/fixtures/corpus/exists-quantifier.ddd: CreateCategoryCommand",
  "test/fixtures/corpus/exists-quantifier.ddd: UpdateCategoryCommand",
  "test/fixtures/corpus/exists-quantifier.ddd: CreateCategoryShareCommand",
  "test/fixtures/corpus/exists-quantifier.ddd: UpdateCategoryShareCommand",
  "test/fixtures/corpus/exists-quantifier.ddd: CreateSealCommand",
  "test/fixtures/corpus/exists-quantifier.ddd: UpdateSealCommand",
  "test/fixtures/corpus/org-context.ddd: CreateMemoCommand",
  "test/fixtures/corpus/org-context.ddd: UpdateMemoCommand",
  "test/fixtures/corpus/org-context.ddd: CreateMemoGrantCommand",
  "test/fixtures/corpus/org-context.ddd: UpdateMemoGrantCommand",
  "test/fixtures/corpus/part-rules-private-op.ddd: CreateInvoiceCommand",
  "test/fixtures/corpus/part-rules-private-op.ddd: BumpInvoiceCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: CreateOrgCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: UpdateOrgCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: CreateCategoryCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: UpdateCategoryCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: CreateCategoryShareCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: UpdateCategoryShareCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: CreateProductCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: UpdateProductCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: CreateNoteCommand",
  "test/fixtures/corpus/policy-row-rules.ddd: UpdateNoteCommand",
  "test/fixtures/corpus/projection-agg-filters.ddd: CreateOrganizationCommand",
  "test/fixtures/corpus/projection-agg-filters.ddd: UpdateOrganizationCommand",
  "test/fixtures/corpus/ref-collection-service.ddd: CreateSpecialityCommand",
  "test/fixtures/corpus/ref-collection-service.ddd: UpdateSpecialityCommand",
  "test/fixtures/corpus/shareable.ddd: CreateCategoryShareCommand",
  "test/fixtures/corpus/shareable.ddd: RevokeCategoryShareCommand",
  "test/fixtures/corpus/tenancy-claim-name.ddd: CreateOrganizationCommand",
  "test/fixtures/corpus/tenancy-claim-name.ddd: UpdateOrganizationCommand",
  "test/fixtures/corpus/tenancy-owned.ddd: CreatePlanCommand",
  "test/fixtures/corpus/tenancy-owned.ddd: UpdatePlanCommand",
  "test/fixtures/corpus/tenancy-owned.ddd: CreateOrganizationCommand",
  "test/fixtures/corpus/tenancy-owned.ddd: UpdateOrganizationCommand",
];

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
    expect(missing.sort()).toEqual([...UNCONTRACTED_REQUESTS].sort());
  }, 180_000);
});
