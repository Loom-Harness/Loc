// D-FRONTEND-CONTRACT: the facts a contract-built frontend reads beside its
// walker and aggregate models answer as the enriched derivation does.
//
// React, Vue, Svelte, Angular, Feliz and Flutter read these off the Frontend Contract; the
// test oracles in `test/_helpers/enriched-frontend-builders.ts` derive them
// independently off the enriched contexts.  For every contract-built frontend deployable
// of every tracked model (multi-file graphs included), both derivations must
// agree on:
//   - the usage flags a runtime is gated on (money, provenance);
//   - the kind of every page of the deployable's ui (`classifyPage` over the
//     served aggregate and workflow names);
//   - the input of every scaffold workflow form's page object;
//   - the value objects a component prop or extern signature is spelled from,
//     for every one the ui names.  No tracked model names one; the prop path
//     itself is generated through the contract by
//     `test/generator/_walker/component-prop-money-file-vo.test.ts`.

import { describe, expect, it } from "vitest";
import {
  valueObjectIndex,
  valueObjectIndexOfContract,
} from "../../../src/generator/_frontend/component-prop-type.js";
import { pageNamesOfContract } from "../../../src/generator/_frontend/page-names.js";
import {
  contractUsesMoney,
  contractUsesProvenance,
} from "../../../src/generator/_frontend/usage-flags.js";
import {
  type WorkflowPageObjectInput,
  workflowPageObjectsOfContract,
} from "../../../src/generator/_frontend/workflow-page-object.js";
import {
  type BoundedContextIR,
  contextUsesMoney,
  type TypeIR,
} from "../../../src/ir/types/loom-ir.js";
import { classifyPage } from "../../../src/ir/util/page-kind.js";
import { contextsHaveProvenancedField } from "../../../src/ir/util/prov-id.js";
import { enumPool, findValueObjectInScope } from "../../../src/ir/util/reachable-types.js";
import { expectReach } from "../../_helpers/census-reach.js";
import { pageNamesOf, workflowPageObjectsOf } from "../../_helpers/enriched-frontend-builders.js";
import { contractFrontendCells } from "../../_helpers/frontend-models.js";

/** The enum and value-object names `t` reaches. */
function namedTypes(t: TypeIR): string[] {
  if (t.kind === "array") return namedTypes(t.element);
  if (t.kind === "optional") return namedTypes(t.inner);
  return t.kind === "enum" || t.kind === "valueobject" ? [t.name] : [];
}

function pageObjectFacts(input: WorkflowPageObjectInput | undefined) {
  if (!input) return null;
  const names = input.params.flatMap((p) => namedTypes(p.type));
  return {
    name: input.name,
    requestBase: input.requestBase,
    params: input.params.map((p) => ({ name: p.name, type: p.type })),
    scope: names.map((n) => ({
      n,
      values: enumPool(input.scope).find((e) => e.name === n)?.values ?? null,
      fields:
        findValueObjectInScope(input.scope, n)?.fields.map((f) => ({
          name: f.name,
          type: f.type,
        })) ?? null,
    })),
  };
}

function bcByAggregate(contexts: readonly BoundedContextIR[]): Map<string, BoundedContextIR> {
  const out = new Map<string, BoundedContextIR>();
  for (const c of contexts) for (const a of c.aggregates) out.set(a.name, c);
  return out;
}

describe("contract-built frontend scope", () => {
  it("answers as the enriched contexts do, for every contract-built frontend", async () => {
    const cells = await contractFrontendCells();
    expectReach("contract-built frontend deployables", cells.length, 20);
    expect(cells.some((c) => c.file === "web/src/examples/erp/main.ddd")).toBe(true);
    const diffs: string[] = [];
    let pages = 0;
    let workflowForms = 0;
    for (const c of cells) {
      const at = `${c.file} ${c.deployable}`;
      const names = c.contexts.map((x) => x.name);
      const check = (what: string, enriched: unknown, contract: unknown): void => {
        const a = JSON.stringify(enriched);
        const b = JSON.stringify(contract);
        if (a !== b)
          diffs.push(`${at}: ${what}: enriched ${a?.slice(0, 200)} ≠ contract ${b?.slice(0, 200)}`);
      };
      check("usesMoney", c.contexts.some(contextUsesMoney), contractUsesMoney(c.contract, names));
      check(
        "usesProvenance",
        contextsHaveProvenancedField(c.contexts),
        contractUsesProvenance(c.contract, names),
      );
      const ui = c.sys.uis.find(
        (u) => u.name === c.sys.deployables.find((d) => d.name === c.deployable)?.uiName,
      );
      const enrichedNames = pageNamesOf(c.contexts);
      const contractNames = pageNamesOfContract(c.contract, names);
      const enrichedWf = workflowPageObjectsOf(new Map(c.contexts.map((x) => [x.name, x])));
      const contractWf = workflowPageObjectsOfContract(c.contract, names);
      for (const page of ui?.pages ?? []) {
        pages++;
        const kind = classifyPage(page, enrichedNames);
        check(`page ${page.name} kind`, kind, classifyPage(page, contractNames));
        if (kind.kind === "workflow-form") {
          workflowForms++;
          check(
            `page ${page.name} workflow page object`,
            pageObjectFacts(enrichedWf(kind.workflowName, kind.contextName)),
            pageObjectFacts(contractWf(kind.workflowName, kind.contextName)),
          );
        }
      }
      // A prop or extern signature only ever asks for a value object its ui
      // names; the contract closes over exactly those.
      const asked = [
        ...new Set(
          [
            ...(ui?.components ?? []).flatMap((x) => x.params),
            ...(ui?.pages ?? []).flatMap((x) => x.params),
          ]
            .map((p) => p.type)
            .concat(
              (ui?.functions ?? []).flatMap((f) => [...f.params.map((p) => p.type), f.returnType]),
            )
            .flatMap(namedTypes),
        ),
      ];
      const enrichedVos = valueObjectIndex(bcByAggregate(c.contexts));
      const contractVos = valueObjectIndexOfContract(c.contract, names);
      const vo = (
        m: ReadonlyMap<string, { fields: readonly { name: string; type: TypeIR }[] }>,
        n: string,
      ) => m.get(n)?.fields.map((f) => ({ name: f.name, type: f.type })) ?? null;
      for (const n of asked) {
        check(`value object ${n}`, vo(enrichedVos, n), vo(contractVos, n));
      }
    }
    expectReach("ui pages classified", pages, 200);
    expectReach("scaffold workflow forms", workflowForms, 5);
    expect(diffs).toEqual([]);
  }, 600_000);
});
