// The `tenantRegistry` capability provides the registry tree field —
// `parent: Self id?` (immutable self-FK, null = a top-level org) — and it flows
// through the shared MigrationsIR + wire projection with no bespoke code:
//   - `parent` → a nullable self-referential FK column + FK index,
//   - `parent` settable on create (immutable) but not update.
// The tree takes no part in data visibility (D-TENANCY-FLAT), so the registry
// carries no materialized-path column.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = `
  system Billder {
    user { id: guid  tenantId: string }
    tenancy by user.tenantId of Organization
    subdomain Platform {
      context Accounts {
        aggregate Organization {
          name: string
          implements tenantRegistry
        }
        repository Organizations for Organization { }
      }
    }
    api PlatformApi from Platform
    storage primary { type: postgres }
    resource accountsState { for: Accounts, kind: state, use: primary }
    deployable api {
      platform: node
      contexts: [Accounts]
      dataSources: [accountsState]
      serves: PlatformApi
      port: 3001
      auth: required
    }
  }
`;

describe("tenantRegistry — the registry tree column flows through migrations + wire", () => {
  it("emits a nullable self-FK `parent` column + FK constraint + index", async () => {
    const files = await generateSystemFiles(SRC);
    const sql = [...files.entries()].find(
      ([p]) => p.endsWith(".sql") && p.includes("migrations"),
    )?.[1];
    expect(sql).toBeDefined();
    expect(sql!).toContain(`"parent" UUID NULL`);
    // Self-referential FK: parent → the organizations table itself.
    expect(sql!).toMatch(/FOREIGN KEY \("parent"\) REFERENCES "accounts"\."organizations"/);
    expect(sql!).toContain(`"organizations_parent_idx"`);
  });

  // Absence: no tier boots a column that is not there.
  it("emits no materialized-path column, index or field anywhere", async () => {
    const files = await generateSystemFiles(SRC);
    for (const [path, text] of files) {
      expect(text, path).not.toMatch(/data_key|dataKey/);
    }
  });

  it("`parent` is settable on create (immutable)", async () => {
    const files = await generateSystemFiles(SRC);
    const domain = files.get("api/domain/organization.ts")!;
    expect(domain).toMatch(/static create\(input: \{ name: string; parent\?/);
  });
});
