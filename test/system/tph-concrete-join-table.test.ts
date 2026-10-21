// A TPH concrete's `X id[]` reference collection gets its join table in the
// shared MigrationsIR (found while moving Dapper onto the chain, M-T2.17).
//
// The concrete owns no table — its rows live in the base's shared table — and
// the builder's TPH-concrete branch emitted only its part tables, so the join
// table every backend's repository reads (`customer_tags`) was never migrated:
// EF's `CustomerTagses` DbSet queried a relation that did not exist, and the
// old Dapper bootstrap only had it because it wrote its own DDL.  The owner FK
// points at the shared base table, whose row id the concrete's id is.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = `
system Tj {
  subdomain Registry {
    context Parties {
      aggregate Tag with crudish { label: string }
      abstract aggregate Party inheritanceUsing: sharedTable { name: string }
      aggregate Customer extends Party with crudish { tags: Tag id[] }
      repository Customers for Customer { }
      repository Tags for Tag { }
    }
  }
  api A from Registry
  storage pg { type: postgres }
  resource s { for: Parties, kind: state, use: pg }
  deployable d {
    platform: dotnet
    contexts: [Parties]
    dataSources: [s]
    serves: A
    port: 4000
  }
}`;

describe("TPH concrete reference collection → join table", () => {
  it("is created, its owner FK on the shared base table", async () => {
    const files = await generateSystemFiles(SRC);
    const sql = [...files.entries()]
      .filter(([p]) => p.startsWith("d/Migrations/"))
      .map(([, c]) => c.replace(/""/g, '"'))
      .join("\n");
    expect(sql).toContain('CREATE TABLE "parties"."customer_tags" (');
    expect(sql).toContain(
      'FOREIGN KEY ("customer_id") REFERENCES "parties"."parties" ON DELETE CASCADE',
    );
    expect(sql).not.toContain('REFERENCES "parties"."customers"');
  });
});
