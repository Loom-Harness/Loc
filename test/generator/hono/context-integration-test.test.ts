import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Context integration test emission on the node/Hono backend (test-placement.md,
// Phase 3a). A `context`-nested `test` (no `for`) emits an in-process,
// repository-backed `test/<ctx>.integration.test.ts` that reads a PG_URL, applies
// the drizzle migrations, wires the repos, and persists→reads. A create persists
// via `repo.save`; a find awaits a repo read (findById nullable → non-null asserted).
// ---------------------------------------------------------------------------

const SRC = `
system Shop {
  subdomain Sales { context Ordering {
    aggregate Order { code: string  qty: int }
    repository Orders for Order { }
    test "persists and reads back an order" {
      let o = Order.create(code: "abc", qty: 2)
      let found = Order.findById(o.id)
      expect(found.qty).toBe(2)
    }
  } }
  api ShopApi from Sales
  storage db { type: postgres }
  resource st { for: Ordering, kind: state, use: db }
  deployable api { platform: node contexts: [Ordering] serves: ShopApi dataSources: [st] port: 8080 }
}`;

const get = (files: Map<string, string>, suffix: string): string | undefined =>
  [...files.entries()].find(([p]) => p.endsWith(suffix))?.[1];

describe("Hono: context integration test emission (Phase 3a)", () => {
  it("emits test/<ctx>.integration.test.ts with the in-process boot + persist/read body", async () => {
    const files = await generateSystemFiles(SRC);
    const f = get(files, "test/ordering.integration.test.ts");
    expect(f, "ordering.integration.test.ts").toBeDefined();
    // Provisioning-agnostic boot: reads a PG_URL, migrates, wires repos.
    expect(f).toContain("process.env.LOOM_PG_URL");
    expect(f).toContain('await migrate(db, { migrationsFolder: "./db/migrations" });');
    expect(f).toContain("repos = { order: new OrderRepository(db, events) };");
    expect(f).toContain('describe("Ordering (integration)"');
  });

  it("renders create→save, find→await (non-null asserted), and the assertion", async () => {
    const files = await generateSystemFiles(SRC);
    const f = get(files, "test/ordering.integration.test.ts") ?? "";
    expect(f).toMatch(/const o = Order\.create\(\{[^}]*\}\);/);
    expect(f).toContain("await repos.order.save(o);");
    expect(f).toContain("const found = (await repos.order.findById(o.id))!;");
    expect(f).toContain("expect(found.qty).toBe(2);");
  });

  it("emits nothing for a context with no integration test", async () => {
    const files = await generateSystemFiles(SRC.replace(/test "persists[\s\S]*?\}\n/, ""));
    expect(get(files, "integration.test.ts")).toBeUndefined();
  });

  it("wires the SYNCHRONOUS in-process dispatcher when the context runs workflows", async () => {
    const withWorkflow = `
system Ship {
  subdomain F { context Fulfillment {
    aggregate Order {
      customerId: string  status: string
      operation place() { precondition status == "Draft"  status := "Placed"  emit OrderPlaced { order: id, at: now() } }
    }
    repository Orders for Order { }
    aggregate Shipment { orderRef: Order id  status: string }
    repository Shipments for Shipment { }
    event OrderPlaced { order: Order id, at: datetime }
    channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: log }
    workflow OrderFulfillment {
      orderId: Order id
      create(p: OrderPlaced) by p.order { let s = Shipment.create(orderRef: p.order, status: "Pending") }
    }
    test "placing transitions to Placed" {
      let o = Order.create(customerId: "c1", status: "Draft")
      o.place()
      let found = Order.findById(o.id)
      expect(found.status).toBe("Placed")
    }
  } }
  api FApi from F
  storage pg { type: postgres }
  resource st { for: Fulfillment, kind: state, use: pg }
  deployable d { platform: node contexts: [Fulfillment] serves: FApi dataSources: [st] port: 4000 }
}`;
    const files = await generateSystemFiles(withWorkflow);
    const f = get(files, "test/fulfillment.integration.test.ts");
    expect(f, "fulfillment.integration.test.ts").toBeDefined();
    expect(f).toContain('import { createInProcessDispatcher } from "../http/workflows";');
    expect(f).toContain("const events = createInProcessDispatcher(db);");
    // op → RELOAD fresh (optimistic-concurrency version) → mutate → save (the
    // emit fans out through the dispatcher).  The mutated binding is `let`, and
    // the reload precedes the op so the second save's version matches the DB.
    expect(f).toContain("let o = Order.create(");
    expect(f).toContain("o = (await repos.order.findById(o.id))!;");
    expect(f).toContain("o.place();");
    expect(f).toContain("await repos.order.save(o);");
  });

  // `http/workflows.ts` exports `createInProcessDispatcher` only for a
  // deployable with event subscriptions or durable events; a workflow alone
  // (a command-started one, nothing reacting) does not emit it.  The test must
  // not import a factory that is not there (TS2305 in the generated project).
  it("a workflow with no event subscription uses the no-op dispatcher (no factory is emitted)", async () => {
    const noReactor = `
system Shop {
  subdomain Sales { context Ordering {
    aggregate Order {
      code: string  qty: int
      operation bump() { qty := qty + 1  emit OrderBumped { order: id } }
    }
    repository Orders for Order { }
    event OrderBumped { order: Order id }
    workflow placeOrder {
      create(code: string) { let o = Order.create(code: code, qty: 1) }
    }
    test "persists and reads back an order" {
      let o = Order.create(code: "abc", qty: 2)
      let found = Order.findById(o.id)
      expect(found.qty).toBe(2)
    }
  } }
  api ShopApi from Sales
  storage db { type: postgres }
  resource st { for: Ordering, kind: state, use: db }
  deployable api { platform: node contexts: [Ordering] serves: ShopApi dataSources: [st] port: 8080 }
}`;
    const files = await generateSystemFiles(noReactor);
    const wf = get(files, "http/workflows.ts");
    expect(wf, "http/workflows.ts").toBeDefined();
    expect(wf).not.toContain("createInProcessDispatcher");
    const f = get(files, "test/ordering.integration.test.ts") ?? "";
    expect(f).not.toContain("createInProcessDispatcher");
    expect(f).toContain('import { NoopDomainEventDispatcher } from "../domain/events";');
    expect(f).toContain("const events = NoopDomainEventDispatcher;");
  });
});

// A context-level test body may construct a value object and name an enum; the
// emitted file must import them (it imported only the repo'd aggregates + Ids:
// TS2304).  Derived from the names the rendered body spells — a body naming
// neither imports neither, so the header stays unused-import clean.
const DOCKING = (body: string) => `
system Ports {
  subdomain Harbour { context Docking {
    enum Size { Small, Large }
    aggregate Ship with crudish { name: string  size: Size }
    valueobject Berth { ship: Ship id  position: int }
    aggregate Dock with crudish { name: string  berth: Berth }
    repository Ships for Ship { }
    repository Docks for Dock { }
    aggregate Crew with crudish { name: string }
    repository Crews for Crew { }
    test "a dock holds a berth naming a ship" {
${body}
    }
  } }
  api DockingApi from Harbour
  storage primary { type: postgres }
  resource dState { for: Docking, kind: state, use: primary }
  deployable d { platform: node contexts: [Docking] dataSources: [dState] serves: DockingApi port: 4000 }
}`;

describe("Hono: context integration test imports the value objects / enums its body uses", () => {
  it("imports a constructed value object and a named enum from domain/value-objects", async () => {
    const f =
      get(
        await generateSystemFiles(
          DOCKING(`      let s = Ship.create(name: "Aurora", size: Size.Large)
      let d = Dock.create(name: "North", berth: Berth { ship: s.id, position: 3 })
      let found = Dock.findById(d.id)
      expect(found.berth.position).toBe(3)`),
        ),
        "test/docking.integration.test.ts",
      ) ?? "";
    expect(f).toContain("new Berth(s.id, 3)");
    expect(f).toContain("Size.Large");
    expect(f).toContain('import { Berth } from "../domain/value-objects";');
    expect(f).toContain('import { Size } from "../domain/value-objects";');
  });

  it("imports neither when the body names neither", async () => {
    const f =
      get(
        await generateSystemFiles(
          DOCKING(`      let c = Crew.create(name: "Aurora")
      let found = Crew.findById(c.id)
      expect(found.name).toBe("Aurora")`),
        ),
        "test/docking.integration.test.ts",
      ) ?? "";
    expect(f).toContain("Crew.create(");
    expect(f).not.toContain("value-objects");
  });
});
