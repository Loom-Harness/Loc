import { describe, expect, it } from "vitest";
import type { AggregateIR } from "../../../src/ir/types/loom-ir.js";
import {
  aggregateCanTripDanglingReference,
  aggregatesCanTripDanglingReference,
  aggregatesCanTripReferencedDelete,
  aggregatesHaveUniqueKeys,
  aggregatesNeedConcurrency,
  outboundReferenceFields,
} from "../../../src/ir/util/aggregate-flags.js";
import { buildLoomModel, enrichedAggregates } from "../../_helpers/ir.js";

// Presence gates: every backend orchestrator asks these two booleans before
// emitting its optimistic-concurrency machinery (the 409 arm, the conflict
// error class) and its unique-violation handling.  A false negative silently
// drops the 409 path from a project that needs it; a false positive breaks the
// byte-identical guarantee for a project that does not.  M-T9.17 slice 2 — no
// direct test.
//
// The composition is the interesting part: `versioned` OR `event-sourced` ⇒
// concurrency, because an event-log append hits the same stale-write conflict
// on a `(stream_id, version)` collision.  That rule was hand-inlined in five
// backends before it was factored here, so each disjunct is asserted ALONE —
// a copy that kept only the `versioned` half would still pass a test that only
// ever supplies both.

const agg = (over: Partial<AggregateIR> = {}): AggregateIR =>
  ({
    name: "Order",
    capabilities: [],
    persistedAs: "state",
    uniqueKeys: [],
    ...over,
  }) as unknown as AggregateIR;

const versioned = agg({ capabilities: ["versioned"] } as Partial<AggregateIR>);
const eventSourced = agg({ persistedAs: "eventLog" } as Partial<AggregateIR>);
const plain = agg();

describe("aggregatesNeedConcurrency", () => {
  it("is false for an empty set", () => {
    expect(aggregatesNeedConcurrency([])).toBe(false);
  });

  it("is false when no aggregate is versioned or event-sourced", () => {
    expect(aggregatesNeedConcurrency([plain, plain])).toBe(false);
  });

  it("is true on the VERSIONED disjunct alone", () => {
    expect(aggregatesNeedConcurrency([versioned])).toBe(true);
  });

  it("is true on the EVENT-SOURCED disjunct alone", () => {
    // The half a `versioned`-only copy would drop: an event-log append raises
    // the same conflict, so the 409 machinery is still required.
    expect(aggregatesNeedConcurrency([eventSourced])).toBe(true);
  });

  it("is a `some`, not an `every` — one qualifying aggregate is enough", () => {
    expect(aggregatesNeedConcurrency([plain, plain, versioned])).toBe(true);
    expect(aggregatesNeedConcurrency([eventSourced, plain])).toBe(true);
  });
});

describe("aggregatesHaveUniqueKeys", () => {
  it("is false for an empty set, and for aggregates with no unique keys", () => {
    expect(aggregatesHaveUniqueKeys([])).toBe(false);
    expect(aggregatesHaveUniqueKeys([plain, plain])).toBe(false);
  });

  it("treats an EMPTY uniqueKeys array as no unique keys", () => {
    // `(a.uniqueKeys?.length ?? 0) > 0` — the length check, not mere presence.
    // A truthiness test on the array itself would call `[]` a unique key.
    expect(aggregatesHaveUniqueKeys([agg({ uniqueKeys: [] } as Partial<AggregateIR>)])).toBe(false);
  });

  it("treats a MISSING uniqueKeys field as no unique keys", () => {
    const noField = {
      name: "Order",
      capabilities: [],
      persistedAs: "state",
    } as unknown as AggregateIR;
    expect(aggregatesHaveUniqueKeys([noField])).toBe(false);
  });

  it("is true when some aggregate declares one", () => {
    const keyed = agg({
      uniqueKeys: [{ fields: ["code"] }],
    } as unknown as Partial<AggregateIR>);
    expect(aggregatesHaveUniqueKeys([keyed])).toBe(true);
    expect(aggregatesHaveUniqueKeys([plain, keyed])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The two FK-violation presence gates (M-T9.17 slice 2, completed in wave C3
// packet 3f).  Both halves of one Postgres constraint: a cross-aggregate `X id`
// becomes an `ON DELETE RESTRICT` FK column, so a DELETE of a referenced row
// trips 23503 (→ `ReferencedInUse`, 409) and a WRITE naming an absent row trips
// it too (→ the domain-floor 422).  A false negative is the 500 the doc comments
// record (java gated the whole advice on `unique` keys; every backend wrote its
// 23503 arm on the delete path only).  Fixtures are PARSED + lowered, not
// hand-built, because the thing under test is how real `X id`, `X id?`,
// `X id[]`, part fields and `Self id?` lower — a hand-built `TypeIR` would
// encode my reading of the lowerer rather than the lowerer.
// ---------------------------------------------------------------------------

async function aggsOf(members: string): Promise<AggregateIR[]> {
  const loom = await buildLoomModel(`
  context C {
${members}
  }`);
  return enrichedAggregates(loom);
}

const byName = (aggs: readonly AggregateIR[], n: string): AggregateIR => {
  const a = aggs.find((x) => x.name === n);
  if (!a) throw new Error(`no aggregate ${n}`);
  return a;
};

describe("aggregatesCanTripReferencedDelete — BOTH halves required", () => {
  it("is true when something is REST-deletable AND something references an in-scope aggregate", async () => {
    const aggs = await aggsOf(`
    aggregate Customer with crudish { name: string }
    aggregate Order with crudish { customer: Customer id }
    repository Customers for Customer { }
    repository Orders for Order { }`);
    // Vacuity guard: the fixture really has a destroy route.
    expect(aggs.some((a) => a.canonicalDestroy != null)).toBe(true);
    expect(aggregatesCanTripReferencedDelete(aggs)).toBe(true);
  });

  it("is false with a reference but NOTHING deletable (the destroy half)", async () => {
    const aggs = await aggsOf(`
    aggregate Customer { name: string  create(name: string) { } }
    aggregate Order { customer: Customer id  create(customer: Customer id) { } }
    repository Customers for Customer { }
    repository Orders for Order { }`);
    expect(aggs.every((a) => a.canonicalDestroy == null)).toBe(true);
    expect(aggregatesCanTripReferencedDelete(aggs)).toBe(false);
  });

  it("is false with a destroy but NO in-scope reference (the reference half)", async () => {
    const aggs = await aggsOf(`
    aggregate Customer with crudish { name: string }
    repository Customers for Customer { }`);
    expect(aggregatesCanTripReferencedDelete(aggs)).toBe(false);
  });

  it("peels optional and array wrappers — `X id?` and `X id[]` still reference", async () => {
    const opt = await aggsOf(`
    aggregate Customer with crudish { name: string }
    aggregate Order with crudish { customer: Customer id? }
    repository Customers for Customer { }
    repository Orders for Order { }`);
    expect(aggregatesCanTripReferencedDelete(opt)).toBe(true);
    const arr = await aggsOf(`
    aggregate Tag with crudish { label: string }
    aggregate Post with crudish { tags: Tag id[] }
    repository Tags for Tag { }
    repository Posts for Post { }`);
    expect(aggregatesCanTripReferencedDelete(arr)).toBe(true);
  });

  it("an OUT-OF-SCOPE target is not a reference (its table is not in this schema)", async () => {
    const aggs = await aggsOf(`
    aggregate Customer with crudish { name: string }
    aggregate Order with crudish { customer: Customer id }
    repository Customers for Customer { }
    repository Orders for Order { }`);
    // Only Order in scope: its `Customer id` names a table the scope does not own.
    expect(aggregatesCanTripReferencedDelete([byName(aggs, "Order")])).toBe(false);
  });
});

describe("aggregatesCanTripDanglingReference / aggregateCanTripDanglingReference / outboundReferenceFields", () => {
  it("a top-level `X id` field to an in-scope aggregate can dangle — no destroy needed", async () => {
    const aggs = await aggsOf(`
    aggregate Customer { name: string  create(name: string) { } }
    aggregate Order { customer: Customer id  create(customer: Customer id) { } }
    repository Customers for Customer { }
    repository Orders for Order { }`);
    // The twin of the delete gate, NOT gated on a destroy route.
    expect(aggregatesCanTripDanglingReference(aggs)).toBe(true);
    const names = new Set(aggs.map((a) => a.name));
    expect(aggregateCanTripDanglingReference(byName(aggs, "Order"), names)).toBe(true);
    expect(aggregateCanTripDanglingReference(byName(aggs, "Customer"), names)).toBe(false);
    expect(outboundReferenceFields(byName(aggs, "Order").fields, names).map((f) => f.name)).toEqual(
      ["customer"],
    );
  });

  it("a PART's `X id` field counts (the FK lives on the part's own table)", async () => {
    const aggs = await aggsOf(`
    aggregate Product { sku: string  create(sku: string) { } }
    aggregate Order {
      contains lines: Line[]
      entity Line { product: Product id  qty: int }
      create() { }
    }
    repository Products for Product { }
    repository Orders for Order { }`);
    const order = byName(aggs, "Order");
    const names = new Set(aggs.map((a) => a.name));
    // Vacuity guard: the reference is on the part, not the root.
    expect(outboundReferenceFields(order.fields, names)).toEqual([]);
    expect(order.parts.some((p) => outboundReferenceFields(p.fields, names).length > 0)).toBe(true);
    expect(aggregateCanTripDanglingReference(order, names)).toBe(true);
    expect(aggregatesCanTripDanglingReference(aggs)).toBe(true);
  });

  it("a SELF reference (`parent: Self id?`, the registry tree) counts", async () => {
    const aggs = await aggsOf(`
    aggregate Node { name: string  parent: Node id?  create(name: string) { } }
    repository Nodes for Node { }`);
    expect(aggregatesCanTripDanglingReference(aggs)).toBe(true);
    expect(outboundReferenceFields(aggs[0]!.fields, new Set(["Node"])).map((f) => f.name)).toEqual([
      "parent",
    ]);
  });

  it("is false with no reference, and for a reference whose target is out of scope", async () => {
    const plainAggs = await aggsOf(`
    aggregate Customer { name: string  create(name: string) { } }
    repository Customers for Customer { }`);
    expect(aggregatesCanTripDanglingReference(plainAggs)).toBe(false);
    const aggs = await aggsOf(`
    aggregate Customer { name: string  create(name: string) { } }
    aggregate Order { customer: Customer id  create(customer: Customer id) { } }
    repository Customers for Customer { }
    repository Orders for Order { }`);
    expect(aggregatesCanTripDanglingReference([byName(aggs, "Order")])).toBe(false);
    expect(aggregateCanTripDanglingReference(byName(aggs, "Order"), new Set(["Order"]))).toBe(
      false,
    );
  });

  it("outboundReferenceFields keeps only the referencing fields, in declaration order", async () => {
    const aggs = await aggsOf(`
    aggregate A { name: string  create(name: string) { } }
    aggregate B { first: A id  note: string  second: A id?  tags: A id[]  create(first: A id) { } }
    repository As for A { }
    repository Bs for B { }`);
    const names = new Set(aggs.map((a) => a.name));
    expect(outboundReferenceFields(byName(aggs, "B").fields, names).map((f) => f.name)).toEqual([
      "first",
      "second",
      "tags",
    ]);
  });
});
