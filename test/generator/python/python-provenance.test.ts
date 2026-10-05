import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Provenance runtime on the Python (FastAPI / SQLAlchemy 2 async) backend — W2.
//
// A `provenanced` field gets a co-located `<field>_provenance` jsonb backing
// column; every named-operation write to it captures a lineage (rule snapshot
// + leaf inputs + computed value) onto a per-request `contextvars.ContextVar`
// buffer, and the repository's `save` drains that buffer into the
// `provenance_records` history table BEFORE its `flush()` (no nested
// transaction — the request-scoped session commits once, so the history is
// atomic with the aggregate).  The shared SDK (`app/domain/provenance.py`
// ContextVar buffer + `app/db/provenance.py` history model) and a LATE
// hand-emitted migration (ALTER backing columns + CREATE history) ride along.
//
// Every backend emits provenance, so python is un-gated.  This is a
// mechanical mirror of node / .NET / elixir-vanilla.
// ---------------------------------------------------------------------------

const SOURCE = `
system OrderingSystem {
  subdomain Ordering {
    context Ordering {
      aggregate Order with crudish {
        reference: string
        quantity: int
        unitPrice: int
        discount: int
        total: int provenanced
        operation reprice(qty: int, price: int) {
          precondition qty > 0
          precondition price >= 0
          quantity := qty
          unitPrice := price
          total := qty * price - discount
        }
        operation applyDiscount(amount: int) {
          precondition amount >= 0
          discount := amount
          total := total - amount
        }
      }
      repository Orders for Order { }
    }
  }
  api OrderingApi from Ordering
  storage primary { type: postgres }
  resource orderingState { for: Ordering, kind: state, use: primary }
  deployable d {
    platform: python
    contexts: [Ordering]
    dataSources: [orderingState]
    serves: OrderingApi
    port: 4000
  }
}
`;

// A second system with no provenanced field — to assert the runtime is gated
// (no SDK / migration / capture / column) when nothing is marked.
const PLAIN = `
system Plain {
  subdomain Core {
    context Stock {
      aggregate Item with crudish {
        total: int
        operation bump() { total := total + 1 }
      }
      repository Items for Item { }
    }
  }
  api StockApi from Core
  storage primary { type: postgres }
  resource itemState { for: Stock, kind: state, use: primary }
  deployable d {
    platform: python
    contexts: [Stock]
    dataSources: [itemState]
    serves: StockApi
    port: 4000
  }
}
`;

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

describe("python provenance runtime (W2)", () => {
  it("emits the provenance SDK — ContextVar buffer + ProvLineage dataclass", async () => {
    const prov = file(await generateSystemFiles(SOURCE), "/app/domain/provenance.py");
    expect(prov).toContain("from contextvars import ContextVar");
    expect(prov).toContain("class ProvLineage:");
    expect(prov).toContain(
      '_trace_buffer: ContextVar[list[ProvLineage]] = ContextVar("loom_prov_traces")',
    );
    expect(prov).toContain("def record(lineage: ProvLineage) -> ProvLineage:");
    expect(prov).toContain("def drain() -> list[ProvLineage]:");
    // The camelCase jsonb shape shared with the other backends.
    expect(prov).toContain('"snapshotId": self.snapshot_id');
    expect(prov).toContain('"computedValue": self.computed_value');
  });

  it("emits the provenance_records history model (governance stamps)", async () => {
    const db = file(await generateSystemFiles(SOURCE), "/app/db/provenance.py");
    expect(db).toContain("class ProvenanceRecord(Base):");
    expect(db).toContain('__tablename__ = "provenance_records"');
    expect(db).toContain("correlation_id: Mapped[str | None]");
    expect(db).toContain("scope_id: Mapped[str | None]");
    expect(db).toContain("actor_id: Mapped[str | None]");
    expect(db).toContain("parent_id: Mapped[str | None]");
  });

  it("persists the co-located column and flushes records before save flush()", async () => {
    const repo = file(await generateSystemFiles(SOURCE), "/order_repository.py");
    // Co-located column on the upsert root dict.
    expect(repo).toContain('"total_provenance": (aggregate.total_provenance.to_wire()');
    // Drain → insert provenance_records, stamped with the request-context ids.
    expect(repo).toContain("__traces = drain()");
    expect(repo).toContain("insert(ProvenanceRecord)");
    expect(repo).toContain('"correlation_id": correlation_id()');
    // The flush insert comes BEFORE the save flush() — one request transaction.
    const insertIdx = repo.indexOf("insert(ProvenanceRecord)");
    const flushIdx = repo.indexOf("await self._session.flush()");
    expect(insertIdx).toBeGreaterThan(-1);
    expect(flushIdx).toBeGreaterThan(insertIdx);
    // No nested transaction opened in the repository.
    expect(repo).not.toContain("session.begin()");
  });

  it("emits the LATE provenance migration (co-located ALTER only)", async () => {
    const files = await generateSystemFiles(SOURCE);
    const mig = file(files, "_provenance.sql");
    // The orders table lives in the `ordering` schema — the ALTER is qualified.
    expect(mig).toContain('ALTER TABLE "ordering".orders ADD COLUMN "total_provenance" jsonb;');
    // The history table's DDL moved to the shared MigrationsIR
    // (`provenanceTableShape`), so it arrives in the ordinary module migration
    // like the outbox and audit tables — not hand-written here.
    expect(mig).not.toContain("CREATE TABLE");
    const initial = file(files, "_ordering_initial.sql");
    expect(initial).toContain('CREATE TABLE "provenance_records"');
    expect(initial).toContain('CREATE INDEX "provenance_records_correlation_idx"');
  });

  it("is gated: no SDK / migration / capture / column when nothing is provenanced", async () => {
    const files = await generateSystemFiles(PLAIN);
    expect([...files.keys()].some((k) => k.endsWith("/app/domain/provenance.py"))).toBe(false);
    expect([...files.keys()].some((k) => k.endsWith("/app/db/provenance.py"))).toBe(false);
    expect([...files.keys()].some((k) => k.endsWith("_provenance.sql"))).toBe(false);
    const agg = file(files, "/app/domain/item.py");
    expect(agg).not.toContain("record(");
    expect(agg).not.toContain("ProvLineage");
    const schema = file(files, "/app/db/schema.py");
    expect(schema).not.toContain("_provenance");
  });
});
