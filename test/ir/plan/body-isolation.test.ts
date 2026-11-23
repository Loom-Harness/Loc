// `bodyIsolation` is the one answer to "does this body hold a transaction, and
// at which level" for a workflow's command `create`, a reaction and a routed
// handler.  Every backend renders it; none resolves a level itself (the
// `isolation` and `handler-tx` rules of `test/system/workflow-plan-census.test.ts`).

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { bodyIsolation, handlerScope } from "../../../src/ir/plan/index.js";
import type { CommandHandlerIR, QueryHandlerIR } from "../../../src/ir/types/loom-ir.js";
import { parseString } from "../../_helpers/parse.js";

const SRC = (stateIsolation: string) => `
system S {
  subdomain M { context C {
    event Credited { customer: Customer id }
    aggregate Customer with crudish {
      credit: int
      operation add(n: int) { credit := credit + n  emit Credited { customer: id } }
    }
    repository Customers for Customer
    workflow ser transactional(serializable) {
      create(c: Customer id) { let x = Customers.get(c)  x.add(1) }
    }
    workflow dflt transactional {
      create(c: Customer id) { let x = Customers.get(c)  x.add(1) }
    }
    workflow plain {
      create(c: Customer id) { let x = Customers.get(c)  x.add(1) }
    }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg${stateIsolation} }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}`;

async function load(stateIsolation = "") {
  const { model } = await parseString(SRC(stateIsolation), { validate: false });
  const loom = enrichLoomModel(lowerModel(model));
  const sys = loom.systems[0]!;
  const ctx = sys.subdomains[0]!.contexts[0]!;
  const wf = (name: string) => ctx.workflows.find((w) => w.name === name)!;
  return { sys, ctx, wf };
}

describe("bodyIsolation", () => {
  it("a transactional workflow's create pins its own level", async () => {
    const { sys, ctx, wf } = await load();
    expect(bodyIsolation({ kind: "workflow", wf: wf("ser") }, ctx, sys)).toEqual({
      holdsTransaction: true,
      level: "serializable",
    });
  });

  it("a transactional workflow without a level takes the state dataSource's isolationLevel", async () => {
    const { sys, ctx, wf } = await load(", isolationLevel: repeatableRead");
    expect(bodyIsolation({ kind: "workflow", wf: wf("dflt") }, ctx, sys)).toEqual({
      holdsTransaction: true,
      level: "repeatableRead",
    });
    // Without the owning context only the workflow's own level is known.
    expect(bodyIsolation({ kind: "workflow", wf: wf("dflt") })).toEqual({ holdsTransaction: true });
  });

  it("a workflow without `transactional` holds no transaction and pins no level", async () => {
    const { sys, ctx, wf } = await load(", isolationLevel: serializable");
    expect(bodyIsolation({ kind: "workflow", wf: wf("plain") }, ctx, sys)).toEqual({
      holdsTransaction: false,
    });
  });

  it("a reaction always holds a transaction, at the connection default", async () => {
    const { sys, ctx, wf } = await load(", isolationLevel: serializable");
    expect(bodyIsolation({ kind: "reaction", wf: wf("ser") }, ctx, sys)).toEqual({
      holdsTransaction: true,
    });
  });

  it("a command handler holds a transaction; a query handler holds none", () => {
    const h = { name: "H" } as unknown as CommandHandlerIR & QueryHandlerIR;
    expect(bodyIsolation(handlerScope(h, "command"))).toEqual({ holdsTransaction: true });
    expect(bodyIsolation(handlerScope(h, "query"))).toEqual({ holdsTransaction: false });
  });
});
