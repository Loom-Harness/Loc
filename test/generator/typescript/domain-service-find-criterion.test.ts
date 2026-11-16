// A reading-tier domain service comparing `Repo.find(<Criterion>)` against
// `null` (the single-row read over a key no `unique (…)` declares).  `??` binds looser than `===`, so the first-row read has
// to be parenthesised whole: `(await …)[0] ?? null === null` is
// `(await …)[0] ?? true` — an `Account | boolean` that fails tsc.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
system D {
  subdomain S { context Accounts {
    aggregate Account with crudish { holder: string }
    repository Accounts for Account { }
    criterion ByHolder(holder: string) of Account = this.holder == holder
    domainService Registration {
      operation isHolderFree(holder: string): bool { return Accounts.find(ByHolder(holder)) == null }
    }
  } }
  api A from S
  storage pg { type: postgres }
  resource st { for: Accounts, kind: state, use: pg }
  deployable n { platform: node, contexts: [Accounts], dataSources: [st], serves: A, port: 5001 }
}`;

describe("typescript — Repo.find(<Criterion>) in a domain-service expression", () => {
  it("parenthesises the first-row read so a comparison applies to it", async () => {
    const files = await generateSystemFiles(SRC);
    const services = [...files].find(([k]) => k.endsWith("n/domain/services.ts"))?.[1] ?? "";
    expect(services).toContain(
      "return ((await accounts.runFindAllByByHolder(holder))[0] ?? null) === null;",
    );
  });
});
