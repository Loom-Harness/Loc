// M-T1.11 (c) on .NET — the messaged domain-floor rule's exception members.
//
// A messaged `invariant` / `precondition` that trips at the domain floor
// throws `DomainException(message, ruleCode, rulePointer)` and the filter
// answers the `errors[]` entry from those two members.  The pointer member is
// named `RulePointer`, NOT `Pointer`: every emitted csproj runs Roslyn at
// `latest-recommended`, where CA1720 ("identifier contains type name") fires
// on `Pointer`, and the corpus compile legs build with `/warnaserror` — so the
// bare name is a COMPILE ERROR that only the .NET tiers can see.  Wave C5 5b
// shipped `Pointer` and went red on `corpus × dotnet (Dapper)`; this pins the
// identifier where the fast suite runs, the way `wire-numeric-ingress.test.ts`
// pins `WireFormatException.FieldPointer` for the same rule.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system Bank {
  subdomain Banking {
    context Accounts {
      aggregate Account with crudish {
        owner: string
        balance: int
        invariant balance >= 0 message "Balance cannot be negative"
        operation withdraw(amount: int) {
          precondition balance >= amount message "Insufficient funds"
          balance := balance - amount
        }
      }
      repository Accounts for Account { }
    }
  }
  api BankingApi from Banking
  storage primary { type: postgres }
  resource accountsState { for: Accounts, kind: state, use: primary }
  deployable d {
    platform: dotnet
    contexts: [Accounts]
    dataSources: [accountsState]
    serves: BankingApi
    port: 4000
  }
}
`;

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

describe(".NET domain-floor rule code — the exception's pointer member is CA1720-safe", () => {
  it("DomainException carries RuleCode + RulePointer, never a member named `Pointer`", async () => {
    const common = bySuffix(await generateSystemFiles(SRC), "Domain/Common/DomainException.cs");
    expect(common).toContain("public string? RuleCode { get; }");
    expect(common).toContain("public string? RulePointer { get; }");
    expect(common).toContain(
      "public DomainException(string message, string? ruleCode = null, string? rulePointer = null)",
    );
    // CA1720 under `<AnalysisLevel>latest-recommended</AnalysisLevel>` + /warnaserror.
    expect(common).not.toMatch(/public string\?? Pointer \{ get; \}/);
    expect(common).not.toMatch(/string\? pointer = null/);
  });

  it("the filter reads the same member — a rename on one side is a compile error", async () => {
    const files = await generateSystemFiles(SRC);
    const filter = bySuffix(files, "Api/DomainExceptionFilter.cs");
    expect(filter).toContain("context.Exception is DomainException dfe && dfe.RuleCode != null");
    expect(filter).toContain('dfe.RulePointer ?? ""');
    expect(filter).not.toContain("dfe.Pointer");
  });

  it("the throw sites pass the code and pointer positionally, matching the constructor", async () => {
    const entity = bySuffix(await generateSystemFiles(SRC), "Domain/Accounts/Account.cs");
    expect(entity).toMatch(
      /throw new DomainException\("Insufficient funds", "msg\.[0-9a-z]+", ""\)/,
    );
    expect(entity).toMatch(
      /throw new DomainException\("Balance cannot be negative", "msg\.[0-9a-z]+", "\/balance"\)/,
    );
  });
});
