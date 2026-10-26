// `npm run db:migrate` in a generated node project runs the generated
// migration runner (`db/migrate-cli.ts` → `db/migrate.ts`), the one the boot
// path calls.  `drizzle-kit migrate` wraps every pending file in one
// transaction, so it fails on a `-- loom:no-transaction` file — the
// `CREATE INDEX CONCURRENTLY` unit a chain emits when a generation adds an
// index to an existing table.

import { describe, expect, it } from "vitest";
import { generateSystemFiles, recordChain } from "../../_helpers/generate.js";

const shop = (v2: boolean) => `system Market {
  subdomain Commerce { context Store {
    enum OrderStatus { Open, Paid }
    aggregate Order with crudish { ref: string  status: OrderStatus  qty: int }
    repository Orders for Order { }
  }}
  storage primary { type: postgres }
  resource storeState { for: Store, kind: state, use: primary${v2 ? ", index: [Order.status]" : ""} }
  deployable api { platform: node, contexts: [Store], dataSources: [storeState], port: 3000 }
}
`;

async function generateEvolved(): Promise<Map<string, string>> {
  return generateSystemFiles(shop(true), {
    migrationChain: await recordChain([shop(false), shop(true)]),
  });
}

describe("node `db:migrate` runs the generated migration runner", () => {
  it("wires `db:migrate` to `tsx db/migrate-cli.ts`, never to drizzle-kit migrate", async () => {
    const files = await generateEvolved();
    // The chain does hold a non-transactional unit — the case drizzle-kit fails on.
    const concurrent = [...files.keys()].find((p) => p.endsWith("_concurrent.sql"));
    expect(concurrent).toBeDefined();
    expect(files.get(concurrent!)!.split("\n")[0]).toBe("-- loom:no-transaction");

    const pkg = JSON.parse(files.get("api/package.json")!) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts["db:migrate"]).toBe("tsx db/migrate-cli.ts");
    expect(Object.values(pkg.scripts)).not.toContain("drizzle-kit migrate");
    // tsx runs it; drizzle-kit stays for the introspection scripts.
    expect(pkg.devDependencies.tsx).toBeDefined();
    expect(pkg.scripts["db:generate"]).toBe("drizzle-kit generate");
  });

  it("the entry opens a pool from DATABASE_URL and calls the boot runner's migrate()", async () => {
    const files = await generateEvolved();
    const cli = files.get("api/db/migrate-cli.ts");
    expect(cli).toBeDefined();
    expect(cli).toContain(`import { migrate } from "./migrate";`);
    expect(cli).toContain("new pg.Pool({ connectionString: process.env.DATABASE_URL })");
    expect(cli).toContain(`await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });`);
    expect(cli).toContain("await pool.end();");
    // A failure exits non-zero, so a deploy step running it stops.
    expect(cli).toContain("process.exitCode = 1;");
    // Boot uses the same runner and the same folder.
    expect(files.get("api/index.ts")).toContain(`import { migrate } from "./db/migrate";`);
    expect(files.get("api/index.ts")).toContain(`migrationsFolder: "./db/migrations"`);
  });
});
