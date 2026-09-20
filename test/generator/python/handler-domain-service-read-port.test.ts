// A `reading`-tier domain service called from an EXPLICIT handler — M-T5.14's
// python arm (ledger `M-T5.14-reading-service-readport-not-threaded`, issue
// #2649).
//
// `domain-services.md` rev. 4: a `reading` operation declares one read-port
// repository PARAMETER per repository it reads, and the ORCHESTRATOR supplies
// the handle at the call site.  The workflow builder does; the explicit
// `commandHandler`/`queryHandler` emitter did not — it built its render context
// with no `readPortArgs` resolver and had no `app.domain.services.*` import line
// at all.  So the emitted handler was wrong three ways at once:
//
//   free = is_holder_free(holder)          # no import  → ruff F821
//                                          # no port    → arity-short
//                                          # no await   → a coroutine, not bool
//
// against `async def is_holder_free(accounts: AccountRepositoryPort, holder: str)`.
//
// The fix reuses the workflow builder's three pieces rather than growing a
// second derivation — `pyReadPortResolver`, `collectServiceReadPorts` and the
// shared `readPortsForOperation` (`src/ir/util/domain-service-read-ports.ts`).
//
// The PURE tier is the control: zero ports, so its call must stay a bare
// synchronous `quote(...)` with no handle and no `await` — a fix that awaited
// every service call would be a different silent break.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = `
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
      // READING over TWO distinct repositories: two ports, in first-read order,
      // and the handler must construct BOTH — including the one its own body
      // never touches.
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
  deployable d { platform: python, contexts: [C], dataSources: [st], serves: A, port: 4000 }
}
`;

async function files(): Promise<Map<string, string>> {
  return await generateSystemFiles(src);
}

async function handler(name: string): Promise<string> {
  const all = await files();
  const suffix = `app/application/${name}.py`;
  const key = [...all.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return all.get(key as string) as string;
}

describe("a reading domain service called from an explicit handler (M-T5.14 python)", () => {
  it("the service DECLARES the read-port parameter — the premise, not an assumption", async () => {
    const all = await files();
    const svc = all.get(
      [...all.keys()].find((k) => k.endsWith("app/domain/services/registration.py")) as string,
    )!;
    expect(svc).toContain(
      "async def is_holder_free(accounts: AccountRepositoryPort, holder: str) -> bool:",
    );
  });

  it("the handler imports the service function, supplies the port and awaits it", async () => {
    const py = await handler("check_holder");
    expect(py).toContain("from app.domain.services.registration import is_holder_free");
    expect(py).toContain("accounts = AccountRepository(session, NoopDomainEventDispatcher())");
    expect(py).toContain("await is_holder_free(accounts, holder)");
  });

  it("two ports come through in first-read order, both repositories constructed", async () => {
    const py = await handler("check_both");
    expect(py).toContain("accounts = AccountRepository(session, NoopDomainEventDispatcher())");
    expect(py).toContain("ledgers = LedgerRepository(session, NoopDomainEventDispatcher())");
    expect(py).toContain("await both_free(accounts, ledgers, holder, code)");
  });

  it("a PURE service call takes no port and no await", async () => {
    // The control: a `pure` operation has zero ports, so its declaration is a
    // plain `def quote(amount)` and the call site must stay byte-identical.
    const py = await handler("quote_fee");
    expect(py).toContain("from app.domain.services.fee_quote import for_amount");
    expect(py).toContain("for_amount(amount)");
    expect(py).not.toContain("await for_amount");
    expect(py).not.toContain("Repository(session");
  });

  it("no handler module names a function it never imported", async () => {
    // The sweep, over the axis the bug travels on (an import obligation): every
    // emitted handler module, every domain-service function this system
    // declares.  The defect was invisible per-file because the emitter had NO
    // service import line at all — there was no partially-right case to notice.
    const all = await files();
    const serviceFns = ["for_amount", "is_holder_free", "both_free"];
    const offenders: string[] = [];
    let scanned = 0;
    for (const [path, content] of all) {
      if (!path.includes("app/application/")) continue;
      scanned++;
      const body = content.slice(content.indexOf("async def "));
      for (const fn of serviceFns) {
        if (!new RegExp(`\\b${fn}\\(`).test(body)) continue;
        if (!new RegExp(`^from [\\w.]+ import .*\\b${fn}\\b`, "m").test(content)) {
          offenders.push(`${path}: ${fn}`);
        }
      }
    }
    // Three handlers plus the package `__init__.py`.
    expect(scanned, "no handler modules emitted — the sweep would be vacuous").toBe(4);
    expect(offenders, "these handlers call a service function they never imported").toEqual([]);
  });
});
