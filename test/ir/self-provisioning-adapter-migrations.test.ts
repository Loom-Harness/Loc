// Both alternate persistence adapters apply the shared migration chain
// (D-ONE-SCHEMA): Dapper as versioned migrations (`dotnet/emit/dapper-migrations.ts`),
// MikroORM through the same files and ledger as the Drizzle runner
// (`typescript/emit/migrations.ts`).  So a declared `migration` block reaches
// them like any other step, and no adapter refuses one.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

/** One system whose `platform:` clause is the only variable — the adapter is
 *  the independent variable, the model is not. */
const SYS = (platformClause: string, migrationBlock: string): string => `
system Shop {
  subdomain Orders {
    context Orders {
      aggregate Order with crudish {
        code: string
        quantity: int
      }
      repository Orders for Order { }
    }
  }
  api A from Orders
  storage pg { type: postgres }
  resource s { for: Orders, kind: state, use: pg }
  deployable d {
    platform: ${platformClause}
    contexts: [Orders]
    dataSources: [s]
    serves: A
    port: 3000
  }
}
${migrationBlock}`;

async function diagsFor(platformClause: string, migrationBlock: string) {
  const { model } = await parseString(SYS(platformClause, migrationBlock), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

const RENAME_COLUMN = `migration "rename-qty" { Order.qty -> quantity }`;
const RENAME_TABLE = `migration "rename-order" { PurchaseOrder -> Order }`;
const BACKFILL = `migration "fill-qty" { Order.quantity = 0 }`;
const RAW_SQL = `migration "touch" { sql "UPDATE orders SET quantity = 1" }`;

const CASES = [
  ["column rename", RENAME_COLUMN],
  ["table rename", RENAME_TABLE],
  ["backfill", BACKFILL],
  ["raw sql step", RAW_SQL],
] as const;

describe("declared migrations vs. the self-provisioning persistence adapters", () => {
  describe("persistence: dapper", () => {
    for (const [label, block] of CASES) {
      it(`accepts a ${label} — Dapper applies the migration chain like EF`, async () => {
        const diags = await diagsFor("dotnet { persistence: dapper }", block);
        expect(diags.filter((d) => d.code === "loom.dapper-unsupported")).toEqual([]);
      });

      it(`accepts the same ${label} on the default (EF Core) adapter`, async () => {
        const diags = await diagsFor("dotnet", block);
        expect(diags.filter((d) => d.code === "loom.dapper-unsupported")).toEqual([]);
      });
    }
  });

  describe("persistence: mikroorm", () => {
    for (const [label, block] of CASES) {
      it(`accepts a ${label} — MikroORM applies the migration chain like Drizzle`, async () => {
        const diags = await diagsFor("node { persistence: mikroorm }", block);
        expect(diags.filter((d) => d.code === "loom.mikroorm-unsupported")).toEqual([]);
      });
    }
  });

  // The gate must not fire on a model that declares no migration at all —
  // otherwise "dapper refuses migrations" would read as "dapper refuses".
  it("stays silent on both adapters when no migration block is declared", async () => {
    for (const platform of ["dotnet { persistence: dapper }", "node { persistence: mikroorm }"]) {
      const diags = await diagsFor(platform, "");
      expect(
        diags.filter(
          (d) => d.code === "loom.dapper-unsupported" || d.code === "loom.mikroorm-unsupported",
        ),
      ).toEqual([]);
    }
  });
});
