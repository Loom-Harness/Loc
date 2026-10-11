// node/MikroORM — a `transactional` workflow opens its transaction on the
// EntityManager, whose spelling is `em.transactional(cb, opts)`.  The drizzle
// spelling `db.transaction(cb, opts)` does not exist on an EntityManager, so
// it compiled under esbuild (no typecheck) and answered EVERY call with a 500
// ("db.transaction is not a function").  The runtime proof is
// `corpus/domain-services` on the mikroorm leg, which drives both of its
// `transactional` workflows; this pins the isolation-level arm, which no
// booted fixture declares: MikroORM takes the `IsolationLevel` enum (its
// values are the same SQL level strings drizzle takes as literals).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const model = (persistence: string): string => `
system T {
  subdomain S {
    context C {
      aggregate Wallet with crudish {
        credit: int
        operation add(n: int) { credit := credit + n }
      }
      repository Wallets for Wallet { }
      workflow Plain transactional {
        create(w: Wallet id) {
          let x = Wallets.getById(w)
          x.add(1)
        }
      }
      workflow Strict transactional(serializable) {
        create(w: Wallet id) {
          let x = Wallets.getById(w)
          x.add(2)
        }
      }
      workflow Snapshot transactional(repeatableRead) {
        create(w: Wallet id) {
          let x = Wallets.getById(w)
          x.add(3)
        }
      }
    }
  }
  api A from S
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d {
    platform: node${persistence}
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}
`;

const workflowsFile = (files: Map<string, string>): string =>
  [...files.entries()].find(([p]) => p.endsWith("/http/workflows.ts"))?.[1] ?? "";

describe("node — a transactional workflow's transaction, per persistence adapter", () => {
  it("mikroorm: `db.transactional`, isolation through the IsolationLevel enum", async () => {
    const wf = workflowsFile(await generateSystemFiles(model(" { persistence: mikroorm }")));
    expect(wf.match(/await db\.transactional\(async \(tx\) => \{/g)?.length).toBe(3);
    expect(wf).not.toContain("db.transaction(");
    expect(wf).toContain("}, { isolationLevel: IsolationLevel.SERIALIZABLE });");
    expect(wf).toContain("}, { isolationLevel: IsolationLevel.REPEATABLE_READ });");
    expect(wf).toContain('import { IsolationLevel } from "@mikro-orm/core";');
  });

  it("drizzle: `db.transaction`, isolation as the SQL level literal (unchanged)", async () => {
    const wf = workflowsFile(await generateSystemFiles(model("")));
    expect(wf.match(/await db\.transaction\(async \(tx\) => \{/g)?.length).toBe(3);
    expect(wf).toContain('}, { isolationLevel: "serializable" });');
    expect(wf).toContain('}, { isolationLevel: "repeatable read" });');
    expect(wf).not.toContain("IsolationLevel");
  });
});
