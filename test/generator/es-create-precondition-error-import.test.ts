// An event-sourced aggregate whose `create` carries a `precondition` must
// import the error class that precondition throws.
//
// The node and python aggregate emitters derive their `errors` import from
// declarative flags (invariants, operation preconditions, `requires`, `when`).
// An event-sourced `create`'s precondition lives in neither `invariants` nor
// `operations` — it renders into the private `_init` (node) / the create
// classmethod (python) — so the import was dropped while the body still threw
// `DomainError`: TS2304 under `tsc --noEmit`, F821 / mypy name-defined on
// python.  Found by the `context-named-like-app` corpus row (corpus × tsc).
//
// Mutation-proven: dropping the body-scan OR from either emitter's import list
// (`typescript/emit/aggregate.ts` `throwsError`, `python/emit/aggregate.ts`
// `refersTo`) fails that backend's case below.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string) => `
system S {
  subdomain M {
    context C {
      event Filed { ledger: Ledger id, amount: int }
      aggregate Ledger persistedAs: eventLog {
        total: int
        create open(amount: int) {
          precondition amount > 0 message "amount must be positive"
          emit Filed { ledger: id, amount: amount }
        }
        apply(e: Filed) { total := e.amount }
      }
      repository Ledgers for Ledger { }
    }
  }
  api A from M
  storage pg { type: postgres }
  resource cState { for: C, kind: state, use: pg }
  resource cLog { for: C, kind: eventLog, use: pg }
  deployable d {
    platform: ${platform}
    contexts: [C]
    dataSources: [cState, cLog]
    serves: A
    port: 4000
  }
}
`;

function find(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `emitted ${suffix}`).toBeDefined();
  return hit![1];
}

describe("event-sourced create precondition pulls its error import", () => {
  it("node: domain/ledger.ts imports the DomainError it throws", async () => {
    const ledger = find(await generateSystemFiles(src("node")), "domain/ledger.ts");
    expect(ledger).toContain("throw new DomainError(");
    expect(ledger).toMatch(/import \{[^}]*\bDomainError\b[^}]*\} from "\.\/errors";/);
  });

  it("python: the ledger module imports the DomainError it raises", async () => {
    const files = await generateSystemFiles(src("python"));
    const ledger = [...files].find(
      ([p, c]) => p.endsWith(".py") && /class Ledger\b/.test(c) && c.includes("raise DomainError("),
    );
    expect(ledger, "python Ledger aggregate module").toBeDefined();
    expect(ledger![1]).toMatch(/from [\w.]+errors import [^\n]*\bDomainError\b/);
  });
});
