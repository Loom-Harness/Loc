// A `reading`-tier domain service called from an EXPLICIT
// `commandHandler`/`queryHandler`, on all five backends — M-T5.14 (ledger
// `M-T5.14-reading-service-readport-not-threaded`, issue #2649).
//
// `domain-services.md` rev. 4 gives a `reading` operation a HANDLE to the
// repositories it reads, and makes the ORCHESTRATOR supply it.  The handle's
// shape is per-backend and that is the whole reason this stayed broken:
//
//   node / python  leading read-port PARAMETERS (`isHolderFree(accounts, holder)`)
//   dotnet / java  the service is an injected OBJECT that holds its own repos
//                  (`_registration.IsHolderFreeAsync(...)` / `registration.isHolderFree(...)`)
//   elixir         no handle at all — the reading op is a CONTEXT FUNCTION, so
//                  it has the ambient `Repo` (`Context.is_holder_free(holder)`)
//
// Every WORKFLOW emitter wired its own shape.  The explicit-handler emitters
// wired NONE of them, and each failed differently while looking the same in the
// `.ddd`: .NET emitted `Registration.IsHolderFree(...)` — a static member the
// DI'd `sealed class` does not have, with no `using` — java the same against a
// `@Service` bean, and elixir named `D.Domain.Services.Registration`, a module
// that is not emitted for a reading op (its fn lives on the context facade), so
// the handler compiled and then raised `UndefinedFunctionError` on first call.
//
// TWO THINGS THIS ASSERTS THAT A CALL-SITE CHECK WOULD NOT:
//
//  1. The PURE control.  A pure service has zero ports, so its call must stay
//     the static/module shape with no handle and no `await`.  A fix that routed
//     every service call through the injected bean would be a different silent
//     break, and it would pass a reading-only test.  The pure half also caught a
//     SECOND defect on java and .NET: the handler had no import/using for the
//     static class either, so `FeeQuote.forAmount(amount)` was "cannot find
//     symbol" / CS0103 in a handler while the identical call compiled in a
//     workflow.
//  2. The DECLARATION side, per backend — the premise.  If the service did not
//     actually declare the handle, the call-site assertions would be pinning
//     agreement between two wrong things.
//
// node is the CONTROL: it already threaded the ports, and its expectations are
// written from the emitted text before the fix, so a regression there fails here
// too.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const src = (platform: string) => `
system RP {
  subdomain D {
    context C {
      aggregate Account with crudish {
        holder: string
        balance: int = 0
      }
      aggregate Ledger with crudish {
        code: string
      }
      repository Accounts for Account {
        find byHolder(holder: string): Account? where this.holder == holder
      }
      repository Ledgers for Ledger {
        find byCode(code: string): Ledger? where this.code == code
      }
      // PURE — params only, no repository read: zero ports (the control).
      domainService FeeQuote {
        operation forAmount(amount: int): int {
          return amount
        }
      }
      // READING — one port.
      domainService Registration {
        operation isHolderFree(holder: string): bool {
          return Accounts.byHolder(holder) == null
        }
      }
      // READING over TWO distinct repositories — two ports / one bean holding
      // two repos, depending on the backend's handle shape.
      domainService Audit {
        operation bothFree(holder: string, code: string): bool {
          return Accounts.byHolder(holder) == null && Ledgers.byCode(code) == null
        }
      }
      queryHandler CheckHolder(holder: string): bool {
        let free = Registration.isHolderFree(holder)
        return free
      }
      queryHandler CheckBoth(holder: string, code: string): bool {
        let free = Audit.bothFree(holder, code)
        return free
      }
      queryHandler QuoteFee(amount: int): int {
        let q = FeeQuote.forAmount(amount)
        return q
      }
    }
  }
  api A from D {
    route GET "/check" -> C.CheckHolder
    route GET "/check_both" -> C.CheckBoth
    route GET "/quote" -> C.QuoteFee
  }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: ${platform}, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

interface Expectation {
  /** Path suffix of the file carrying the `CheckHolder` handler body. */
  readonly oneHandler: string;
  /** Path suffix of the file carrying the `CheckBoth` handler body. */
  readonly twoHandler: string;
  /** Path suffix of the file carrying the `QuoteFee` (pure) handler body. */
  readonly pureHandler: string;
  /** The one-port READING call, as emitted at the handler call site. */
  readonly oneCall: string;
  /** The two-port READING call. */
  readonly twoCall: string;
  /** The PURE call — no handle, no await. */
  readonly pureCall: string;
  /** What makes the reading service reachable from the handler: an injected
   *  field + ctor, a module alias, or a repository handle constructed in scope. */
  readonly reach: readonly string[];
  /** The pure service's own reachability (an import / using / module path). */
  readonly pureReach: string;
  /** The DECLARATION of the one-port reading op — the premise. */
  readonly declaration: string;
  /** Path suffix of the file carrying that declaration. */
  readonly declaredIn: string;
}

const EXPECTED: Record<string, Expectation> = {
  node: {
    oneHandler: "d/http/a-routes.ts",
    twoHandler: "d/http/a-routes.ts",
    pureHandler: "d/http/a-routes.ts",
    oneCall: "await Registration.isHolderFree(accounts, holder)",
    twoCall: "await Audit.bothFree(accounts, ledgers, holder, code)",
    pureCall: "FeeQuote.forAmount(amount)",
    reach: ["Registration", "Audit"],
    pureReach: "FeeQuote",
    declaration:
      "export async function isHolderFree(accounts: AccountRepositoryPort, holder: string): Promise<boolean> {",
    declaredIn: "d/domain/services.ts",
  },
  dotnet: {
    oneHandler: "d/Application/Handlers/CheckHolderHandler.cs",
    twoHandler: "d/Application/Handlers/CheckBothHandler.cs",
    pureHandler: "d/Application/Handlers/QuoteFeeHandler.cs",
    oneCall: "await _registration.IsHolderFreeAsync(command.Holder, cancellationToken)",
    twoCall: "await _audit.BothFreeAsync(command.Holder, command.Code, cancellationToken)",
    pureCall: "FeeQuote.ForAmount(command.Amount)",
    reach: [
      "using D.Domain.Services;",
      "private readonly Registration _registration;",
      "public CheckHolderHandler(Registration registration)",
    ],
    pureReach: "using D.Domain.Services;",
    declaration: "public async Task<bool> IsHolderFreeAsync(string holder",
    declaredIn: "d/Domain/Services/Registration.cs",
  },
  java: {
    oneHandler: "application/workflows/CheckHolderHandler.java",
    twoHandler: "application/workflows/CheckBothHandler.java",
    pureHandler: "application/workflows/QuoteFeeHandler.java",
    oneCall: "registration.isHolderFree(holder)",
    twoCall: "audit.bothFree(holder, code)",
    pureCall: "FeeQuote.forAmount(amount)",
    reach: [
      "import com.loom.d.domain.services.Registration;",
      "private final Registration registration;",
      "public CheckHolderHandler(Registration registration) {",
    ],
    pureReach: "import com.loom.d.domain.services.FeeQuote;",
    declaration: "public boolean isHolderFree(String holder) {",
    declaredIn: "domain/services/Registration.java",
  },
  elixir: {
    oneHandler: "d/lib/d/c/handlers/check_holder.ex",
    twoHandler: "d/lib/d/c/handlers/check_both.ex",
    pureHandler: "d/lib/d/c/handlers/quote_fee.ex",
    oneCall: "Context.is_holder_free(holder)",
    twoCall: "Context.both_free(holder, code)",
    // Elixir's PURE shape IS the fully-qualified module — no alias, because the
    // pure op really is emitted onto `Domain.Services`.
    pureCall: "D.Domain.Services.FeeQuote.for_amount(amount)",
    reach: ["alias D.C, as: Context"],
    pureReach: "D.Domain.Services.FeeQuote",
    declaration: "def is_holder_free(holder) do",
    declaredIn: "d/lib/d/c.ex",
  },
};

async function filesFor(platform: string): Promise<Map<string, string>> {
  return await generateSystemFiles(src(platform));
}

function pick(all: Map<string, string>, suffix: string): string {
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return all.get(key as string) as string;
}

describe("a reading domain service called from an explicit handler — all five backends", () => {
  for (const [platform, e] of Object.entries(EXPECTED)) {
    describe(platform, () => {
      it("the service DECLARES its handle — the premise, not an assumption", async () => {
        expect(pick(await filesFor(platform), e.declaredIn)).toContain(e.declaration);
      });

      it("the one-port reading call is reachable and correctly shaped", async () => {
        const all = await filesFor(platform);
        const body = pick(all, e.oneHandler);
        expect(body, "the reading call is not in its backend's shape").toContain(e.oneCall);
        for (const r of e.reach) {
          expect(body, `the handler cannot reach the service: missing ${r}`).toContain(r);
        }
      });

      it("the two-port reading call carries both handles", async () => {
        expect(pick(await filesFor(platform), e.twoHandler)).toContain(e.twoCall);
      });

      it("a PURE service call takes no handle and no await", async () => {
        const body = pick(await filesFor(platform), e.pureHandler);
        expect(body).toContain(e.pureCall);
        expect(body, "a pure call must not be awaited").not.toMatch(
          /await\s+(FeeQuote\.|_feeQuote|feeQuote\.)/,
        );
        expect(body, "the pure class is named but unreachable").toContain(e.pureReach);
      });
    });
  }

  // The sweep, over the axis the bug travels on (a reachability obligation).
  // Per backend: every emitted file that NAMES a domain-service symbol must also
  // carry the thing that makes it resolvable in that language.  The defect was
  // invisible file-by-file precisely because the emitter supplied NOTHING — there
  // was no partially-right case to notice — so the sweep counts what it scanned.
  const REACH_RULE: Record<
    string,
    { population: RegExp; offender: (path: string, content: string) => string[] }
  > = {
    dotnet: {
      population: /\b(FeeQuote|Registration|Audit)\b/,
      offender: (path, content) =>
        ["FeeQuote", "Registration", "Audit"]
          .filter((svc) => new RegExp(`\\b${svc}\\b`).test(content))
          // Reachable three ways: the `using`, being IN the namespace, or a
          // fully-qualified reference (`Program.cs` registers the bean that way).
          .filter(
            (svc) =>
              !/using D\.Domain\.Services;|namespace D\.Domain\.Services;/.test(content) &&
              !new RegExp(`D\\.Domain\\.Services\\.${svc}\\b`).test(content),
          )
          .map((svc) => `${path}: ${svc}`),
    },
    java: {
      population: /\b(FeeQuote|Registration|Audit)\b/,
      offender: (path, content) =>
        ["FeeQuote", "Registration", "Audit"]
          .filter((svc) => new RegExp(`\\b${svc}\\b`).test(content))
          .filter(
            (svc) =>
              !new RegExp(`import com\\.loom\\.d\\.domain\\.services\\.${svc};`).test(content) &&
              !/package com\.loom\.d\.domain\.services;/.test(content),
          )
          .map((svc) => `${path}: ${svc}`),
    },
    elixir: {
      // Every file that names ANY of the three services' functions — the
      // population has to be the fn names, because the reading ops are
      // deliberately NOT reachable by module name at all.
      population: /is_holder_free|both_free|for_amount|Domain\.Services/,
      offender: (path, content) =>
        // A reading op named on `Domain.Services` is the original defect: that
        // module is emitted for PURE ops only, so the call raises
        // `UndefinedFunctionError` at runtime out of code that compiles.
        ["Registration", "Audit"]
          .filter((svc) => content.includes(`D.Domain.Services.${svc}`))
          .map((svc) => `${path}: D.Domain.Services.${svc} (reading op — no such module)`),
    },
  };

  for (const [platform, rule] of Object.entries(REACH_RULE)) {
    it(`${platform}: no emitted file names a domain service it cannot reach`, async () => {
      const all = await filesFor(platform);
      const offenders: string[] = [];
      let scanned = 0;
      for (const [path, content] of all) {
        if (path.startsWith(".loom/")) continue;
        if (!rule.population.test(content)) continue;
        scanned++;
        offenders.push(...rule.offender(path, content));
      }
      expect(
        scanned,
        "the sweep found no file naming a service — it would be vacuous",
      ).toBeGreaterThan(1);
      expect(offenders, "these files name a domain service they cannot resolve").toEqual([]);
    });
  }
});
