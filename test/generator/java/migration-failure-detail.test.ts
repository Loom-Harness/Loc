// A failing boot migration logs `migration_failed` with the whole cause chain:
// Flyway's callbacks only see a summary, so a FlywayMigrationStrategy wraps
// `migrate()` and renders each cause's class + message.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `
system S {
  subdomain M {
    context C {
      aggregate Order with crudish {
        customerId: string
      }
      repository Orders for Order { }
    }
  }
  api OrdersApi from M
  storage primary { type: postgres }
  resource ordersState { for: C, kind: state, use: primary }
  deployable api {
    platform: java
    contexts: [C]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 8080
  }
}
`;

describe("Java migration failure detail", () => {
  it("logs migration_failed with the cause chain from a FlywayMigrationStrategy", async () => {
    const files = await generateSystemFiles(SYSTEM);
    const key = [...files.keys()].find((k) => k.endsWith("/config/MigrationCatalogConfig.java"));
    expect(key).toBeDefined();
    const src = files.get(key!)!;
    expect(src).toContain("FlywayMigrationStrategy migrationCatalogStrategy()");
    expect(src).toContain("catch (FlywayException e)");
    expect(src).toContain('"migration_failed"');
    expect(src).toContain("causeChain(e)");
    expect(src).toContain('t.getClass().getName() + ": " + t.getMessage()');
    expect(src).toContain("throw e;");
    // One failure event, not a second summary-only one from the callback.
    expect(src.match(/"migration_failed"/g)).toHaveLength(1);
  });
});
