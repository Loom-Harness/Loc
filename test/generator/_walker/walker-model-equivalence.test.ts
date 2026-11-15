// The two `WalkerModel` adapters answer alike.
//
// React and Vue walk their pages on the model `walkerModelOfContract` builds
// from the Frontend Contract; every other target walks on the one
// `walkerModelOf` builds from the enriched contexts.  For every tracked model
// with a React or Vue frontend, this serializes both models over the facts a
// page walk and a whole-ui scan read — the type scope a form resolves in, the
// finds and projections a read calls, the create requests, the error records,
// the operations and workflows a form renders, and the context each type's
// identity text is keyed under — and requires them equal.  A fact the contract
// does not carry shows up here as a model difference, not as emitted text.

import { describe, expect, it } from "vitest";
import {
  type WalkerHome,
  type WalkerModel,
  type WalkerReach,
  walkerModelOf,
  walkerModelOfContract,
} from "../../../src/generator/_walker/walker-model.js";
import {
  buildFrontendContract,
  type FrontendContract,
} from "../../../src/ir/contract/frontend-contract.js";
import type { BoundedContextIR, EnrichedSystemIR } from "../../../src/ir/types/loom-ir.js";
import { enumPool, findValueObjectInScope } from "../../../src/ir/util/reachable-types.js";
import { expectReach } from "../../_helpers/census-reach.js";
import { CONTRACT_FRAMEWORKS, trackedFrontendModels } from "../../_helpers/frontend-models.js";

/** The contexts the system hands a frontend deployable: its own, with every
 *  abstract base dropped except a polymorphic read home (`ownTable`). */
function frontendContexts(sys: EnrichedSystemIR, contextNames: readonly string[]) {
  const want = new Set(contextNames);
  return sys.subdomains
    .flatMap((sd) => sd.contexts)
    .filter((c) => want.has(c.name))
    .map((c) => ({
      ...c,
      aggregates: c.aggregates.filter((a) => !a.isAbstract || a.inheritanceUsing === "ownTable"),
    })) as BoundedContextIR[];
}

function enrichedModel(contexts: BoundedContextIR[], reach: WalkerReach): WalkerModel {
  if (reach === "contexts") return walkerModelOf({ contexts });
  const bcByAggregate = new Map<string, BoundedContextIR>();
  const bcByWorkflow = new Map<string, BoundedContextIR>();
  for (const c of contexts) {
    for (const a of c.aggregates) bcByAggregate.set(a.name, c);
    for (const w of c.workflows) bcByWorkflow.set(w.name, c);
  }
  return walkerModelOf({ bcByAggregate, bcByWorkflow });
}

/** The type names a walk can ask about: everything the contract names (the
 *  closure of the ui and its wire), plus the enums, aggregates, parts and
 *  workflows the contexts declare. */
function probes(contract: FrontendContract, contexts: readonly BoundedContextIR[]) {
  const w = contract.wire;
  const enums = [
    ...new Set([
      ...w.enums.map((e) => e.name),
      ...contexts.flatMap((c) => [...c.enums, ...(c.siblingEnums ?? [])].map((e) => e.name)),
    ]),
  ].sort();
  // A walk looks a value object up only by a type it meets in a page body or
  // on the wire, and the contract carries the closure of both; an enum it may
  // also iterate whole (an `EnumBadge` catalogues every declared one).
  const valueObjects = w.valueObjects.map((v) => v.name).sort();
  return {
    enums,
    valueObjects,
    types: [
      ...new Set([
        ...enums,
        ...valueObjects,
        ...contexts.flatMap((c) =>
          c.aggregates.flatMap((a) => [a.name, ...a.parts.map((p) => p.name)]),
        ),
        ...contexts.flatMap((c) => c.workflows.map((x) => x.name)),
      ]),
    ].sort(),
    records: w.records.map((r) => r.name),
  };
}

function serialize(
  model: WalkerModel,
  p: ReturnType<typeof probes>,
  aggregateNames: readonly string[],
) {
  const homeFacts = (home: WalkerHome) => ({
    name: home.name,
    // An `EnumBadge` catalogues the text of every enum a home declares; the
    // catalogue is keyed, so the set is what it reads.
    declaredEnums: home.enums.map((e) => e.name).sort(),
    enums: Object.fromEntries(
      p.enums.map((n) => [n, enumPool(home).find((e) => e.name === n)?.values ?? null]),
    ),
    valueObjects: Object.fromEntries(
      p.valueObjects.map((n) => [
        n,
        findValueObjectInScope(home, n)?.fields.map((f) => ({
          name: f.name,
          type: f.type,
          optional: !!f.optional,
          default: f.default ?? null,
        })) ?? null,
      ]),
    ),
    owners: Object.fromEntries(p.types.map((t) => [t, model.modelTextOwner(t, home) ?? null])),
    errorRecords: p.records.filter((r) => model.isErrorRecord(home, r)),
  });
  return {
    homes: model.homes.map(homeFacts),
    ownerless: Object.fromEntries(
      p.types.map((t) => [t, model.modelTextOwner(t, undefined) ?? null]),
    ),
    aggregates: aggregateNames.map((name) => {
      const hit = model.aggregates.get(name);
      const home = model.homeOfAggregate(name);
      const ops = (hit?.agg.operations ?? []).filter((o) => o.visibility === "public");
      return {
        name,
        home: home?.name ?? null,
        operations: ops.map((o) => ({
          name: o.name,
          params: o.params.map((x) => ({
            name: x.name,
            type: x.type,
            labelledByAggregate: hit!.agg.fields.some((f) => f.name === x.name),
          })),
        })),
        create: home
          ? model.createRequestFields(home, { name }).map((f) => ({
              name: f.name,
              type: f.type,
              optional: f.optional,
              default: f.default ?? null,
            }))
          : null,
        pagedAll: model.isPagedAll(name),
      };
    }),
    workflows: [...model.workflows.entries()]
      .map(([name, { wf, home }]) => ({
        name,
        home: home.name,
        workflowHome: model.homeOfWorkflow(name)?.name ?? null,
        startable: wf.startable,
        params: wf.params.map((x) => ({ name: x.name, type: x.type })),
        resultSegment: wf.resultSegment ?? null,
        requestBase: wf.requestBase ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    readable: [...model.readableProjectionSet].sort(),
    listShaped: [...model.listShapedProjections].sort(),
  };
}

interface Cell {
  file: string;
  deployable: string;
  contract: FrontendContract;
  contexts: BoundedContextIR[];
}

async function cells(): Promise<Cell[]> {
  const out: Cell[] = [];
  for (const { file, model } of await trackedFrontendModels()) {
    for (const sys of model.systems) {
      if (sys.uis.length === 0) continue;
      const contract = buildFrontendContract(model, sys);
      for (const d of sys.deployables) {
        if (!d.uiName || !CONTRACT_FRAMEWORKS.has(d.uiFramework ?? "")) continue;
        out.push({
          file,
          deployable: d.name,
          contract,
          contexts: frontendContexts(sys, d.contextNames),
        });
      }
    }
  }
  return out;
}

describe("WalkerModel adapters answer alike", () => {
  it("the contract-built model equals the enriched one, for every React / Vue frontend", async () => {
    const all = await cells();
    expectReach("React / Vue frontend deployables", all.length, 20);
    // A model split across imported files is among them.
    expect(all.some((c) => c.file === "web/src/examples/erp/main.ddd")).toBe(true);
    const diffs: string[] = [];
    for (const c of all) {
      const names = c.contexts.map((x) => x.name);
      const aggregateNames = [
        ...new Set(c.contexts.flatMap((x) => x.aggregates.map((a) => a.name))),
      ];
      const p = probes(c.contract, c.contexts);
      for (const reach of ["aggregates", "contexts"] as const) {
        const enriched = serialize(enrichedModel(c.contexts, reach), p, aggregateNames);
        const contract = serialize(
          walkerModelOfContract(c.contract, names, reach),
          p,
          aggregateNames,
        );
        const a = JSON.stringify(enriched);
        const b = JSON.stringify(contract);
        if (a !== b)
          diffs.push(`${c.file} ${c.deployable} (${reach}): ${firstDiff(enriched, contract)}`);
      }
    }
    expect(diffs).toEqual([]);
  }, 600_000);
});

/** The first path at which two serialized models disagree. */
function firstDiff(a: unknown, b: unknown, at = "$"): string {
  if (JSON.stringify(a) === JSON.stringify(b)) return "";
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])];
    for (const k of keys) {
      const d = firstDiff(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${at}.${k}`,
      );
      if (d) return d;
    }
  }
  return `${at}: enriched ${JSON.stringify(a)?.slice(0, 160)} ≠ contract ${JSON.stringify(b)?.slice(0, 160)}`;
}
