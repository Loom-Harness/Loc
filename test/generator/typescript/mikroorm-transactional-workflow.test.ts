// A `transactional` workflow on `platform: node { persistence: mikroorm }`
// emitted drizzle's `db.transaction(async (tx) => …)` into `http/workflows.ts`
// — but the handle there is a MikroORM EntityManager, which has no
// `transaction` (TS2551 on every mikro + transactional-workflow project).  The
// workflow wrapper now rides the adapter's transaction seam (`txWrapperCall`,
// the same one the audited / provenanced routes use), and an explicit isolation
// level is spelled as MikroORM's `IsolationLevel` enum rather than drizzle's
// string.  The drizzle spelling is pinned alongside so the fix stays scoped.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = (platform: string): string => `
system MikroWf {
  subdomain Banking {
    context Ledger {
      aggregate Account with crudish {
        holder: string
        balance: int
        operation deposit(amount: int) {
          precondition amount > 0
          balance := balance + amount
        }
      }
      repository Accounts for Account { }

      workflow Open transactional {
        create(holder: string) {
          let acct = Account.create({ holder: holder, balance: 0 })
        }
      }

      workflow TopUp transactional(serializable) {
        create(target: Account id, amount: int) {
          let a = Accounts.getById(target)
          a.deposit(amount)
        }
      }
    }
  }
  api LedgerApi from Banking
  storage primary { type: postgres }
  resource ledgerState { for: Ledger, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Ledger]
    dataSources: [ledgerState]
    serves: LedgerApi
    port: 4000
  }
}
`;

async function workflowsTs(platform: string): Promise<string> {
  const files = await generateSystemFiles(src(platform));
  const f = [...files].find(([p]) => p.endsWith("d/http/workflows.ts"))?.[1];
  expect(f, "no http/workflows.ts emitted").toBeDefined();
  return f!;
}

describe("transactional workflow — per-adapter transaction seam", () => {
  it("mikroorm opens the EntityManager's `transactional`, never drizzle's `transaction`", async () => {
    const wf = await workflowsTs("node { persistence: mikroorm }");
    expect(wf).not.toContain("db.transaction(");
    expect(wf.match(/await db\.transactional\(async \(tx\) => \{/g)?.length).toBe(2);
    expect(wf).toContain("}, { isolationLevel: IsolationLevel.SERIALIZABLE });");
    expect(wf).toContain(`import { EntityManager, IsolationLevel } from "@mikro-orm/postgresql";`);
  });

  it("drizzle keeps `db.transaction` and the string isolation level", async () => {
    const wf = await workflowsTs("node");
    expect(wf).not.toContain("transactional(");
    expect(wf.match(/await db\.transaction\(async \(tx\) => \{/g)?.length).toBe(2);
    expect(wf).toContain(`}, { isolationLevel: "serializable" });`);
    expect(wf).not.toContain("IsolationLevel");
  });
});
