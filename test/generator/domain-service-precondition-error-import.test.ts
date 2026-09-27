// A `precondition` inside a PURE-CALCULATOR `domainService` operation renders
// a `throw`/`raise` of the backend's domain-error type, exactly as an aggregate
// operation does — but `domain/services.ts` derives its import surface by
// SCANNING the rendered bodies, and `./errors` was not among the candidates it
// scanned for.  So node emitted:
//
//   import Decimal from "decimal.js";            // the complete import list
//   export namespace Calc {
//     export function quote(km: number, rate: Decimal): Decimal {
//         if (!(km > 0)) throw new DomainError("Precondition failed: km > 0");
//
// which is `tsc` TS2304 ("Cannot find name 'DomainError'"), and — because the
// emitted Dockerfile builds with `tsup`/esbuild, which strips types without
// checking them — SHIPS.  At runtime the guard then threw
// `ReferenceError: DomainError is not defined` instead of the domain error, so
// a rule whose contract is 422 answered 500.
//
// Measured on all five backends: node was the only one that got it wrong.
// dotnet (`using ApiDotnet.Domain.Common;`) and java
// (`import …domain.common.*;`) both already import the namespace their
// `DomainException` lives in, python imports `DomainError` explicitly, and
// elixir raises a fully-qualified `…GuardError` that needs no import at all.
// Each row below asserts that POSITIVELY, so the file is a parity gate rather
// than a node-only regression test.
//
// The corpus fixture `test/fixtures/corpus/domain-services.ddd` does carry
// `precondition`s, which is why this looked covered — but they sit in the
// MUTATING / READING service tiers, whose guards hoist to the caller. No
// fixture had a precondition in a pure calculator, which is the one shape that
// renders the throw into `services.ts` itself.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = (platform: string) => `
system Svc5 {
  subdomain S {
    context C {
      aggregate Bill with crudish { amount: money }
      repository R for Bill { }
      domainService Calc {
        operation quote(km: int, rate: money): money {
          precondition km > 0
          return rate * km
        }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [C]
    dataSources: [st]
    port: 4000
  }
}
`;

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

/** Per backend: the file hosting the calculator, the rendered throw that proves
 *  the guard reached it (the VACUITY GUARD — without it an import assertion
 *  could pass over a file that no longer carries the precondition at all), and
 *  the import that must accompany it. */
const ROWS = [
  {
    platform: "node",
    file: "domain/services.ts",
    throws: 'throw new DomainError("Precondition failed: km > 0")',
    requiredImport: 'import { DomainError } from "./errors";',
  },
  {
    platform: "dotnet",
    file: "Domain/Services/Calc.cs",
    throws: 'throw new DomainException("Precondition failed: km > 0")',
    requiredImport: "using D.Domain.Common;",
  },
  {
    platform: "java",
    file: "domain/services/Calc.java",
    throws: 'throw new DomainException("Precondition failed: km > 0")',
    requiredImport: "import com.loom.d.domain.common.*;",
  },
  {
    platform: "python",
    file: "app/domain/services/calc.py",
    throws: 'raise DomainError("Precondition failed: km > 0")',
    requiredImport: "from app.domain.errors import DomainError",
  },
] as const;

describe("a precondition in a pure-calculator domainService — error-type import parity", () => {
  for (const row of ROWS) {
    it(`${row.platform} imports the error type its calculator throws`, async () => {
      const files = await generateSystemFiles(SRC(row.platform));
      const src = bySuffix(files, row.file);
      // Vacuity guard first: if the precondition stopped rendering here, the
      // import assertion below would pass for the wrong reason.
      expect(src, `${row.platform}: the precondition should render into ${row.file}`).toContain(
        row.throws,
      );
      expect(
        src,
        `${row.platform}: ${row.file} throws its domain error but never imports it`,
      ).toContain(row.requiredImport);
    });
  }

  it("elixir needs no import — the raise is fully qualified", async () => {
    const files = await generateSystemFiles(SRC("elixir"));
    const src = bySuffix(files, "domain/services/calc.ex");
    expect(src).toMatch(/raise\(\s*\w+\.GuardError/);
  });
});
