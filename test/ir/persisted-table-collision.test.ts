// `loom.persisted-table-collision`: two persisted declarations of one context
// deriving the same physical table name are refused at validation, and the
// check's table derivation agrees with the migration builder's — table for
// table — so the gate cannot drift from the DDL it guards.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { persistedTablesOf } from "../../src/ir/validate/checks/table-name-checks.js";
import { schemaFromModule } from "../../src/system/migrations-builder.js";
import { loadExampleModel, repoRoot, toLoomModel } from "../_helpers/index.js";
import { buildLoomModel } from "../_helpers/ir.js";

const system = (body: string) => `
system R {
  subdomain S { context C {
${body}
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}`;

async function collisions(body: string): Promise<string[]> {
  const res = await validate(system(body));
  return res.diagnostics
    .filter((d) => d.code === "loom.persisted-table-collision")
    .map((d) => d.message);
}

describe("loom.persisted-table-collision", () => {
  it("refuses a workflow and an aggregate whose names differ only in case", async () => {
    const msgs = await collisions(`
      aggregate Sweep with crudish { at: datetime }
      repository Sweeps for Sweep { }
      event Tick { sweep: Sweep id }
      workflow sweep { sweep: Sweep id  create(t: Tick) by t.sweep { } }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain(
      "aggregate 'Sweep' and workflow 'sweep' both persist to table 'sweeps'",
    );
  });

  it("refuses two aggregates' same-named entity parts (both map to one child table)", async () => {
    const msgs = await collisions(`
      aggregate Order with crudish { n: int  contains lines: Line[]  entity Line { q: int } }
      aggregate Quote with crudish { n: int  contains lines: Line[]  entity Line { q: int } }
      repository Orders for Order { }
      repository Quotes for Quote { }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain(
      "entity 'Line' of aggregate 'Order' and entity 'Line' of aggregate 'Quote'",
    );
  });

  it("refuses a value-collection table that lands on a sibling aggregate's table", async () => {
    // `Order.charges: Money[]` → child table `order_charges`; aggregate
    // `OrderCharge` → `order_charges` too.
    const msgs = await collisions(`
      valueobject Money { amount: int }
      aggregate Order with crudish { charges: Money[] }
      aggregate OrderCharge with crudish { n: int }
      repository Orders for Order { }
      repository OrderCharges for OrderCharge { }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("'order_charges'");
  });

  it("refuses an aggregate and a folded projection of the same name (no namespace gate covers it)", async () => {
    const msgs = await collisions(`
      aggregate Tick with crudish { n: int }
      event Tock { tick: Tick id  n: int }
      projection Tick keyed by tick { tick: Tick id  n: int  on(e: Tock) by e.tick { tick := e.tick  n := e.n } }
      repository TickRepo for Tick { }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain(
      "aggregate 'Tick' and projection 'Tick' both persist to table 'ticks'",
    );
  });

  it("does not double-report an exact-name workflow/aggregate clash", async () => {
    const res = await validate(
      system(`
      aggregate Thing with crudish { name: string }
      repository Things for Thing { }
      event Tick { thing: Thing id }
      workflow Thing { thing: Thing id  create(t: Tick) by t.thing { } }`),
    );
    const codes = res.diagnostics.map((d) => d.code);
    expect(codes).toContain("loom.workflow-name-collision");
    expect(codes).not.toContain("loom.persisted-table-collision");
  });

  it("stays quiet on distinct table names", async () => {
    expect(
      await collisions(`
      aggregate Sweep with crudish { at: datetime }
      repository Sweeps for Sweep { }
      event Tick { sweep: Sweep id }
      workflow runSweep { sweep: Sweep id  create(t: Tick) by t.sweep { } }`),
    ).toEqual([]);
  });
});

// Module-level machinery the builder adds beside the context-owned tables —
// not derived from any declaration, so not the check's to enumerate.
const INFRA = new Set(["__loom_outbox", "audit_records", "provenance_records"]);

/** A fixture exercising every table kind the builder derives from a
 *  declaration: aggregate, entity part, `X id[]` join, `<VO>[]` child table
 *  (root and part), plain correlation workflow, materialized projection, the
 *  event log (eventLog aggregate + eventSourced workflow), TPH and TPC. */
const EVERY_KIND = `
system K {
  subdomain S { context Ctx {
    valueobject Money { amount: int }
    aggregate Tag with crudish { name: string }
    aggregate Order with crudish {
      tags: Tag id[]
      charges: Money[]
      contains lines: Line[]
      entity Line { q: int  fees: Money[] }
      operation place() { emit Placed { order: id, total: 1 } }
    }
    aggregate Ledger persistedAs: eventLog {
      total: int
      create open() { emit Opened { total: 0 } }
      apply(e: Opened) { total := e.total }
    }
    event Opened { total: int }
    abstract aggregate Party inheritanceUsing: sharedTable { name: string }
    aggregate Person extends Party with crudish { age: int }
    abstract aggregate Asset inheritanceUsing: ownTable { label: string }
    aggregate Truck extends Asset with crudish { axles: int }
    repository Tags for Tag { }
    repository Orders for Order { }
    repository Ledgers for Ledger { }
    repository People for Person { }
    repository Trucks for Truck { }
    event Placed { order: Order id  total: int }
    workflow fulfil { order: Order id  create(e: Placed) by e.order { } }
    projection OrderTotals keyed by orderId {
      orderId: Order id
      total: int
      on(e: Placed) by e.order { orderId := e.order  total := e.total }
    }
  } }
  storage pg { type: postgres }
  resource st { for: Ctx, kind: state, use: pg }
  deployable api { platform: node, contexts: [Ctx], dataSources: [st], port: 3000 }
}`;

function agreement(loom: Awaited<ReturnType<typeof buildLoomModel>>): void {
  for (const sys of loom.systems) {
    for (const mod of sys.subdomains) {
      const ddl = schemaFromModule(mod)
        .tables.map((t) => t.name)
        .filter((n) => !INFRA.has(n));
      const derived = mod.contexts.flatMap((c) => persistedTablesOf(c).map((t) => t.table));
      expect([...new Set(derived)].sort(), `${sys.name}/${mod.name}`).toEqual(
        [...new Set(ddl)].sort(),
      );
    }
  }
}

describe("persistedTablesOf agrees with schemaFromModule", () => {
  it("over a fixture covering every declaration-derived table kind", async () => {
    const loom = await buildLoomModel(EVERY_KIND);
    const kinds = new Set(
      loom.systems[0]!.subdomains[0]!.contexts.flatMap((c) =>
        persistedTablesOf(c).map((t) => t.kind),
      ),
    );
    // The fixture must actually reach every kind, or the agreement is vacuous.
    expect([...kinds].sort()).toEqual(
      [
        "aggregate",
        "event-log",
        "join",
        "part",
        "projection",
        "value-collection",
        "workflow",
      ].sort(),
    );
    agreement(loom);
  });

  it("over every example system", async () => {
    const files = readdirSync(`${repoRoot}/examples`).filter((f) => f.endsWith(".ddd"));
    let checked = 0;
    for (const f of files) {
      if (f === "sales-ui.ddd") continue; // deliberately unparseable fixture
      const model = await loadExampleModel(`examples/${f}`, { validate: false });
      let loom: ReturnType<typeof toLoomModel>;
      try {
        loom = toLoomModel(model);
      } catch {
        continue;
      }
      if (loom.systems.length === 0) continue;
      agreement(loom);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });
});
