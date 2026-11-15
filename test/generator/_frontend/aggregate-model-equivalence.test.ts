// The two `FrontendAggregate` adapters answer alike.
//
// React and Vue emit their per-aggregate api modules and page objects from the
// model `frontendAggregateOfContract` builds from the Frontend Contract; the
// other frontends build their page objects with `frontendAggregateOf`, from
// the enriched aggregate and its context.  For every aggregate a tracked
// model's React or Vue frontend emits an api module for, this serializes both
// models over every fact those emitters read — the create surface and request
// fields, the public operations and their forms, the contained collections and
// part order, the enum and value-object schemas the module declares (as the
// schema text it emits), the money and provenance flags, the error records the
// union responses name, and the value-object fields a form fill descends into —
// and requires them equal.

import { describe, expect, it } from "vitest";
import {
  type FrontendAggregate,
  frontendAggregateOf,
  frontendAggregateOfContract,
} from "../../../src/generator/_frontend/aggregate-model.js";
import { type ClientFind, clientFinds } from "../../../src/generator/_frontend/contract.js";
import { emitValueObjectSchema } from "../../../src/generator/_frontend/zod-schemas.js";
import {
  buildFrontendContract,
  type FrontendContract,
} from "../../../src/ir/contract/frontend-contract.js";
import { buildFrontendHost } from "../../../src/ir/contract/host.js";
import type { AggregateIR, BoundedContextIR, TypeIR } from "../../../src/ir/types/loom-ir.js";
import { findValueObjectInScope } from "../../../src/ir/util/reachable-types.js";
import { expectReach } from "../../_helpers/census-reach.js";
import { CONTRACT_FRAMEWORKS, trackedFrontendModels } from "../../_helpers/frontend-models.js";

interface Cell {
  file: string;
  deployable: string;
  contract: FrontendContract;
  agg: AggregateIR;
  ctx: BoundedContextIR;
  finds: ClientFind[];
}

/** The named types a form fill or a union response can ask the scope about. */
function scopeProbes(m: FrontendAggregate): string[] {
  const names = new Set<string>();
  const visit = (t: TypeIR): void => {
    if (t.kind === "valueobject") {
      if (names.has(t.name)) return;
      names.add(t.name);
      for (const f of findValueObjectInScope(m.scope, t.name)?.fields ?? []) visit(f.type);
    } else if (t.kind === "array") visit(t.element);
    else if (t.kind === "optional") visit(t.inner);
  };
  for (const f of m.createFields) visit(f.type);
  for (const o of m.operations) for (const p of o.formParams) visit(p.type);
  for (const vo of m.valueObjects) visit({ kind: "valueobject", name: vo.name });
  return [...names].sort();
}

function serialize(m: FrontendAggregate, probes: readonly string[]) {
  const errorNames = m.operations.flatMap((o) =>
    (o.union ?? []).flatMap((v) => (v.kind === "entity" ? [v.name] : [])),
  );
  return {
    name: m.name,
    restCreate: m.restCreate,
    createFields: m.createFields,
    operations: m.operations,
    collections: m.collections,
    parts: m.parts,
    enums: m.enums.map((e) => ({ name: e.name, values: e.values })),
    valueObjectSchemas: m.valueObjects.map((v) => emitValueObjectSchema(v).join("\n")),
    usesMoney: m.usesMoney,
    carriesProvenance: m.carriesProvenance,
    errorRecords: Object.fromEntries(errorNames.map((n) => [n, m.errorRecord(n) ?? null])),
    scope: Object.fromEntries(
      probes.map((n) => [
        n,
        findValueObjectInScope(m.scope, n)?.fields.map((f) => ({ name: f.name, type: f.type })) ??
          null,
      ]),
    ),
  };
}

async function cells(): Promise<Cell[]> {
  const out: Cell[] = [];
  for (const { file, model } of await trackedFrontendModels()) {
    for (const sys of model.systems) {
      if (sys.uis.length === 0) continue;
      const contract = buildFrontendContract(model, sys);
      for (const d of sys.deployables) {
        if (!d.uiName || !CONTRACT_FRAMEWORKS.has(d.uiFramework ?? "")) continue;
        const serves = buildFrontendHost(sys, d).serves;
        const want = new Set(d.contextNames);
        for (const ctx of sys.subdomains.flatMap((s) => s.contexts)) {
          if (!want.has(ctx.name)) continue;
          // The aggregates a frontend emits an api module for: every concrete
          // one, and a polymorphic read home (`ownTable`).
          for (const agg of ctx.aggregates) {
            if (agg.isAbstract && agg.inheritanceUsing !== "ownTable") continue;
            out.push({
              file,
              deployable: d.name,
              contract,
              agg,
              ctx,
              finds: clientFinds(contract, agg.name, serves),
            });
          }
        }
      }
    }
  }
  return out;
}

describe("FrontendAggregate adapters answer alike", () => {
  it("the contract-built model equals the enriched one, for every React / Vue api module", async () => {
    const all = await cells();
    expectReach("React / Vue api-module aggregates", all.length, 150);
    // A model split across imported files, with a polymorphic read home.
    expect(all.some((c) => c.file === "web/src/examples/erp/main.ddd" && c.agg.isAbstract)).toBe(
      true,
    );
    const diffs: string[] = [];
    for (const c of all) {
      const enriched = frontendAggregateOf(c.agg, c.ctx, c.finds);
      const contract = frontendAggregateOfContract(c.contract, c.agg.name, c.finds);
      if (!contract) {
        diffs.push(`${c.file} ${c.deployable} ${c.agg.name}: not in the contract`);
        continue;
      }
      // The api module renders a response schema for the aggregate and each
      // of its parts from the contract's declared records.
      for (const e of [c.agg.name, ...contract.parts]) {
        if (!c.contract.wire.responses.some((r) => r.entity === e)) {
          diffs.push(`${c.file} ${c.deployable} ${e}: no response record in the contract`);
        }
      }
      const probes = [...new Set([...scopeProbes(enriched), ...scopeProbes(contract)])].sort();
      const a = serialize(enriched, probes);
      const b = serialize(contract, probes);
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        diffs.push(`${c.file} ${c.deployable} ${c.agg.name}: ${firstDiff(a, b)}`);
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
