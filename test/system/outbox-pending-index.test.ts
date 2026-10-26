import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

// The relay polls `__loom_outbox WHERE dispatched_at IS NULL ... ORDER BY
// occurred_at`.  Dispatched rows accumulate, so the shared companion-table
// shape carries a partial index over the pending rows; every backend that
// renders DDL from MigrationsIR must emit it.

const source = (platform: string) => `
system Acme {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        customerId: string
        status: string
        operation place() { precondition status == "Draft"  status := "Placed"  emit OrderPlaced { order: id } }
      }
      repository Orders for Order {}
      event OrderPlaced { order: Order id }
      channel Lifecycle { carries: OrderPlaced  delivery: broadcast  retention: log }
      workflow Fulfil {
        orderId: Order id
        status: string
        create(p: OrderPlaced) by p.order { status := "Pending" }
      }
    }
  }
  storage primary { type: postgres }
  resource ordersState { for: Orders, kind: state, use: primary }
  deployable api { platform: ${platform} contexts: [Orders] dataSources: [ordersState] port: 3000 }
}
`;

const INDEX = "__loom_outbox_pending_idx";

describe("__loom_outbox pending-row index", () => {
  for (const platform of ["node", "python", "java", "elixir", "dotnet"]) {
    it(`${platform} migrations create a partial index over undispatched rows`, async () => {
      const files = await generateSystemFiles(source(platform));
      // Ecto derives the index name from table + columns, so it matches on the
      // `create index` call instead of the explicit name.
      const marker = platform === "elixir" ? "create index(:__loom_outbox, [:occurred_at]" : INDEX;
      const hits = [...files.entries()].filter(([p, c]) => /migrat/i.test(p) && c.includes(marker));
      expect(hits.length, `no migration mentions ${marker}`).toBeGreaterThan(0);
      expect(hits.map(([, c]) => c).join("\n")).toMatch(/dispatched_at IS NULL/);
    });
  }
});
