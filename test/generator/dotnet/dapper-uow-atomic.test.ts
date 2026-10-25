// A `transactional` workflow on `persistence: dapper` commits ATOMICALLY: every
// repository / port adapter it drives writes on the unit of work's ONE
// connection + transaction (banking-eval B-04, follow-up to #3142).
//
// The defect: `DapperUnitOfWork` opened its transaction on its OWN connection
// while each repository call opened — and each `SaveAsync` committed — a
// separate pooled connection, so `transactional` was a no-op.  The banking
// repro (debit an Acct, then insert a Transfer whose `unique (reference)`
// collides) answered 409 yet kept the debit: balance 100 → 70 after 1×204 +
// 2×409, where 90 is right.  With #3142's `DomainEventDeferral` that read as
// "committed but unannounced".  Runtime-proven on a booted Dapper stack: 70
// before, 90 after (one Transfer row, one reactor-written Audit row).
//
// The runtime gate is the behavioural corpus case
// `transactional-workflow-event-rollback`, keyed `dotnet` in the corpus
// manifest (so it runs on the EF and Dapper legs): pre-fix it fails on the
// Dapper leg with `expected 80 to be 90`.  This file pins the emitted SHAPE the fix rests
// on, which no compile gate sees — a repository that opens its own connection
// compiles fine and silently leaves the workflow's transaction.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const generate = (source: string): Promise<Map<string, string>> => generateSystemFiles(source);

/** Every persistence shape a workflow can drive, plus a correlated saga (the
 *  saga-state store) and the workflow under test. */
const source = (isolation: string): string => `system R {
  subdomain S { context C {
    event Debited { acct: Acct id, amount: money }
    event Touched { who: string }
    aggregate Acct {
      name: string
      balance: money
      operation debit(amount: money) {
        precondition balance >= amount
        balance := balance - amount
        emit Debited { acct: id, amount: amount }
      }
    }
    aggregate Transfer { reference: string  source: Acct id  unique (reference) }
    aggregate Note shape: document { text: string }
    aggregate Ledger persistedAs: eventLog {
      who: string
      create open(who: string) { emit Touched { who: who } }
      apply(e: Touched) { who := e.who }
    }
    repository Accts for Acct { }
    repository Transfers for Transfer { }
    repository Notes for Note { }
    repository Ledgers for Ledger { }
    workflow onDebit {
      a: Acct id
      seen: int
      create(e: Debited) by e.acct { seen := 1 }
    }
    workflow pay transactional${isolation} {
      create(src: Acct id, reference: string) {
        let s = Accts.getById(src)
        s.debit(money("10"))
        let t = Transfer.create({ reference: reference, source: src })
      }
    }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  resource ev { for: C, kind: eventLog, use: pg }
  deployable api { platform: dotnet { persistence: dapper }, contexts: [C], dataSources: [st, ev], port: 3000 }
}`;

const file = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  expect(hit, `no ${suffix} emitted`).toBeDefined();
  return hit![1];
};

/** The body of one C# method, from its signature to the next member. */
const method = (src: string, signature: string): string => {
  const start = src.indexOf(signature);
  expect(start, `no ${signature}`).toBeGreaterThan(-1);
  const end = src.indexOf("\n    public ", start + signature.length);
  return src.slice(start, end === -1 ? undefined : end);
};

describe("dotnet/dapper: a transactional workflow writes on the unit of work's connection + transaction", () => {
  it("every repository and workflow port adapter opens through the enlisting lease, never its own connection", async () => {
    const files = await generate(source(""));
    const participants = [...files.entries()].filter(
      ([p]) =>
        /\/Infrastructure\/Repositories\/\w+Repository\.cs$/.test(p) ||
        p.endsWith("/Infrastructure/Persistence/DapperPersistencePorts.cs"),
    );
    // relational Acct/Transfer, document Note, event-sourced Ledger + the ports file.
    expect(participants.map(([p]) => p.split("/").pop()).sort()).toEqual([
      "AcctRepository.cs",
      "DapperPersistencePorts.cs",
      "LedgerRepository.cs",
      "NoteRepository.cs",
      "TransferRepository.cs",
    ]);
    for (const [p, src] of participants) {
      // A raw open is a connection outside the workflow's transaction; a raw
      // begin is a second transaction the unit of work cannot roll back.
      expect(src, p).not.toMatch(/_db\.OpenConnectionAsync|conn\.BeginTransactionAsync/);
      expect(src, p).toContain(
        ".Infrastructure.Persistence.DapperConnectionLease.OpenAsync(_db, cancellationToken)",
      );
    }
    // The relational save: its transaction comes FROM the lease (the unit of
    // work's when enlisted) and its commit is the lease's (a no-op when enlisted).
    const save = method(file(files, "/AcctRepository.cs"), "public async Task SaveAsync(");
    expect(save).toContain("var __tx = await __lease.BeginTransactionAsync(cancellationToken);");
    expect(save).toContain("RecordDurableAsync(__pending, __tx, cancellationToken)");
    expect(save).toContain("await __lease.CommitAsync(cancellationToken);");
    expect(save).not.toContain("__tx.CommitAsync");
  });

  it("the unit of work hands out the ambient transaction, registered before the first await", async () => {
    const files = await generate(source(""));
    const uow = file(files, "/DapperPersistencePorts.cs");
    // Delegating, NOT `async` — an AsyncLocal write inside an async method is
    // discarded when it returns, so the handler would never see the scope.
    expect(uow).toMatch(
      /public Task<IDomainTransaction> BeginTransactionAsync\(CancellationToken cancellationToken = default\)\s*=> global::Api\.Infrastructure\.Persistence\.DapperAmbientTransaction\.BeginAsync\(_db, null, cancellationToken\);/,
    );
    const lease = file(files, "/Infrastructure/Persistence/DapperConnectionLease.cs");
    expect(lease).toMatch(/public static Task<IDomainTransaction> BeginAsync\(/);
    expect(lease).toMatch(
      /private DapperAmbientTransaction\(\)\s*\{\s*_previous = _current\.Value;\s*_current\.Value = this;/,
    );
    // Enlisted leases borrow the ambient connection + transaction and own neither.
    expect(lease).toMatch(
      /if \(DapperAmbientTransaction\.Current is \{ \} ambient\)\s*return new DapperConnectionLease\(ambient\.Connection, ambient\.Transaction, owned: false\);/,
    );
  });

  it("an isolation level reaches the ambient transaction's BEGIN", async () => {
    const files = await generate(source("(serializable)"));
    expect(file(files, "/PayHandler.cs")).toContain(
      "_uow.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken)",
    );
    expect(file(files, "/DapperPersistencePorts.cs")).toContain(
      "DapperAmbientTransaction.BeginAsync(_db, isolationLevel, cancellationToken);",
    );
    expect(file(files, "/Infrastructure/Persistence/DapperConnectionLease.cs")).toContain(
      "? await _conn.BeginTransactionAsync(level, cancellationToken)",
    );
  });
});
