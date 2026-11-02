import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Context integration test emission on the Python/FastAPI backend
// (test-placement.md, Phase 3b). A `context`-nested `test` (no `for`) emits an
// in-process, repository-backed `tests/test_<ctx>_integration.py` that reads
// LOOM_PG_URL, applies the SQL migrations, wires the repos, and persists→reads.
// A create persists via `repo.save`; a find awaits a repo read (find_by_id
// nullable → `assert is not None`). Verified end-to-end: the emitted module
// passes mypy --strict + ruff and runs green against a real Postgres.
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
  deployable api { platform: python contexts: [Ordering] serves: ShopApi dataSources: [st] port: 8080 }
}`;

async function gen(src: string): Promise<Map<string, string>> {
  const { model, errors } = await parseString(src);
  expect(errors, "parse/validate errors").toEqual([]);
  return generateSystems(model).files;
}

const find = (files: Map<string, string>, suffix: string): string | undefined =>
  [...files.entries()].find(([p]) => p.endsWith(suffix))?.[1];

describe("Python: context integration test emission (Phase 3b)", () => {
  it("emits tests/test_<ctx>_integration.py with the in-process boot + persist/read body", async () => {
    const files = await gen(SRC);
    const f = find(files, "tests/test_ordering_integration.py");
    expect(f, "test_ordering_integration.py").toBeDefined();
    // Provisioning-agnostic boot: reads LOOM_PG_URL, migrates, per-test session.
    expect(f).toContain('os.environ.get("LOOM_PG_URL"');
    expect(f).toContain("await run_migrations(engine)");
    expect(f).toContain("from app.domain.events import NoopDomainEventDispatcher");
    expect(f).toContain("order_repo = OrderRepository(session, events)");
  });

  it("renders create→save, find→await (nullable asserted), and the assertion", async () => {
    const f = (await gen(SRC)).get("api/tests/test_ordering_integration.py") ?? "";
    expect(f).toMatch(/o = Order\.create\([^)]*\)/);
    expect(f).toContain("await order_repo.save(o)");
    expect(f).toContain("found = await order_repo.find_by_id(o.id)");
    expect(f).toContain("assert found is not None");
    expect(f).toContain("assert found.qty == 2");
  });

  // Each test declares only the fixture locals ITS body reads — ruff F841
  // rejects an unused local, so a value-object-only body declares no `events`
  // and no repo, and a sibling test's repo never leaks into it.
  const MIXED = SRC.replace(
    "repository Orders for Order { }",
    `repository Orders for Order { }
    aggregate Customer { name: string }
    repository Customers for Customer { }
    valueobject Address { street: string  city: string }
    test "an address holds its city" {
      let a = Address { street: "Main", city: "Oslo" }
      expect(a.city).toBe("Oslo")
    }
    test "persists a customer" {
      let c = Customer.create(name: "Ada")
      expect(c.name).toBe("Ada")
    }`,
  );

  /** The `async def <name>(...)` block for one emitted test function. */
  const fnBlock = (f: string, name: string): string => {
    const start = f.indexOf(`async def ${name}(`);
    expect(start, `function ${name}`).toBeGreaterThanOrEqual(0);
    const next = f.indexOf("\nasync def ", start + 1);
    return f.slice(start, next === -1 ? undefined : next);
  };

  it("a body that reads no repository declares no events / repo / session", async () => {
    const f = (await gen(MIXED)).get("api/tests/test_ordering_integration.py") ?? "";
    const vo = fnBlock(f, "test_an_address_holds_its_city");
    expect(vo).toContain("async def test_an_address_holds_its_city() -> None:");
    expect(vo).not.toMatch(/\bevents\b/);
    expect(vo).not.toMatch(/_repo\b/);
    expect(vo).toContain('a = Address("Main", "Oslo")');
  });

  it("each test constructs only the repositories its own body reads", async () => {
    const f = (await gen(MIXED)).get("api/tests/test_ordering_integration.py") ?? "";
    const cust = fnBlock(f, "test_persists_a_customer");
    expect(cust).toContain("(session: AsyncSession) -> None:");
    expect(cust).toContain("events = NoopDomainEventDispatcher()");
    expect(cust).toContain("customer_repo = CustomerRepository(session, events)");
    expect(cust).not.toContain("order_repo");
    const ord = fnBlock(f, "test_persists_and_reads_back_an_order");
    expect(ord).toContain("order_repo = OrderRepository(session, events)");
    expect(ord).not.toContain("customer_repo");
  });

  it("a module whose tests read no repository imports no dispatcher or repository", async () => {
    const voOnly = SRC.replace(
      /test "persists[\s\S]*?\}\n/,
      `valueobject Address { street: string  city: string }
    test "an address holds its city" {
      let a = Address { street: "Main", city: "Oslo" }
      expect(a.city).toBe("Oslo")
    }
`,
    );
    const f = (await gen(voOnly)).get("api/tests/test_ordering_integration.py") ?? "";
    expect(f).toContain("async def test_an_address_holds_its_city() -> None:");
    expect(f).not.toContain("NoopDomainEventDispatcher");
    expect(f).not.toContain("InProcessDispatcher");
    expect(f).not.toContain("OrderRepository");
    expect(f).not.toMatch(/\bevents\b/);
    expect(f).toContain("from app.domain.value_objects import Address");
  });

  it("emits nothing for a context with no integration test", async () => {
    const files = await gen(SRC.replace(/test "persists[\s\S]*?\}\n/, ""));
    expect(find(files, "integration.py")).toBeUndefined();
  });

  it("wires the SYNCHRONOUS InProcessDispatcher when the context runs workflows", async () => {
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
  deployable d { platform: python contexts: [Fulfillment] serves: FApi dataSources: [st] port: 4000 }
}`;
    const f = find(await gen(withWorkflow), "tests/test_fulfillment_integration.py");
    expect(f, "test_fulfillment_integration.py").toBeDefined();
    expect(f).toContain("from app.dispatch import InProcessDispatcher");
    expect(f).toContain("events = InProcessDispatcher(session)");
    // op → mutate-in-place + save (the emit fans out through the dispatcher).
    expect(f).toContain("o.place()");
    expect(f).toContain("await order_repo.save(o)");
  });

  // `app/dispatch.py` exists only under a dispatch condition, and its
  // pure-producer shape defines no `InProcessDispatcher`.  A workflow alone
  // does not emit the class, so the test must not import it (mypy: missing
  // module / missing attribute in the generated project).
  const NO_REACTOR = `
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
  deployable api { platform: python contexts: [Ordering] serves: ShopApi dataSources: [st] port: 8080 }
}`;

  it("a workflow with no event subscription and no app/dispatch.py uses the no-op dispatcher", async () => {
    const files = await gen(NO_REACTOR);
    expect(find(files, "app/dispatch.py")).toBeUndefined();
    const f = find(files, "tests/test_ordering_integration.py") ?? "";
    expect(f).not.toContain("app.dispatch");
    expect(f).toContain("from app.domain.events import NoopDomainEventDispatcher");
    expect(f).toContain("events = NoopDomainEventDispatcher()");
  });

  it("a pure-producer app/dispatch.py (no InProcessDispatcher) leaves the test on the no-op dispatcher", async () => {
    const producer = NO_REACTOR.replace(
      "event OrderBumped { order: Order id }",
      "event OrderBumped { order: Order id }\n    channel Lifecycle { carries: OrderBumped  delivery: queue  retention: work }",
    )
      .replace(
        "storage db { type: postgres }",
        "storage db { type: postgres }\n  storage bus { type: rabbitmq }\n  channelSource lifecycleBus { for: Lifecycle, use: bus }",
      )
      .replace("dataSources: [st] port", "dataSources: [st] channels: [lifecycleBus] port");
    const files = await gen(producer);
    const dispatch = find(files, "app/dispatch.py");
    expect(dispatch, "app/dispatch.py").toBeDefined();
    expect(dispatch).not.toMatch(/^class InProcessDispatcher\b/m);
    const f = find(files, "tests/test_ordering_integration.py") ?? "";
    expect(f).not.toContain("InProcessDispatcher");
    expect(f).toContain("events = NoopDomainEventDispatcher()");
  });
});
