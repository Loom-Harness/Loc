// Aggregate events raised inside a `transactional` workflow dispatch only after
// the workflow's transaction COMMITS (banking-eval B-04).
//
// A repository dispatches the events it drained once its `save()` returns.
// That is right when the save owns its commit; inside a transactional workflow
// the save only writes into the workflow's open transaction (its own
// transaction is a savepoint), so a later failure — here a duplicate unique
// `reference` on the Transfer insert — rolls the debit back after `Debited`
// has already reached every consumer.  On node that was runtime-proven:
// 1×204 + 2×409 committed ONE debit but THREE reactor-written Audit rows.
//
// node: the repositories built on `tx` get a buffering `deferredDispatcher`,
//       flushed after `db.transaction(...)` resolves.
// .NET: the handler opens an ambient `DomainEventDeferral` scope before
//       `BeginTransactionAsync` and flushes it after `CommitAsync`; the
//       repository dispatch loops route through it.
//
// A non-transactional workflow keeps per-save dispatch: each save commits on
// its own, so its events are already post-commit.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const source = (platform: string, transactional: boolean): string => `system R {
  subdomain S { context C {
    event Debited { acct: Acct id, amount: money }
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
    repository Accts for Acct { }
    repository Transfers for Transfer { }
    aggregate Audit { note: string }
    repository Audits for Audit { }
    workflow onDebit {
      a: Acct id
      create(e: Debited) by e.acct { let x = Audit.create({ note: "debited" }) }
    }
    workflow pay ${transactional ? "transactional " : ""}{
      create(src: Acct id, reference: string) {
        let s = Accts.getById(src)
        s.debit(money("10"))
        let t = Transfer.create({ reference: reference, source: src })
      }
    }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [st], port: 3000 }
}`;

const fileEnding = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  expect(hit, `no ${suffix} emitted`).toBeDefined();
  return hit![1];
};

/** The `pay` route handler only — the file pools every workflow. */
const payRoute = (src: string): string => {
  const start = src.indexOf('path: "/pay"');
  expect(start, "no /pay route").toBeGreaterThan(-1);
  const end = src.indexOf("app.openapi(", start);
  return src.slice(start, end === -1 ? undefined : end);
};

describe("node: transactional workflow defers aggregate events past commit", () => {
  // The transactional half is NOT string-tested here: it is gated by the
  // behavioural corpus case `test/fixtures/corpus/transactional-workflow-event-rollback.ddd`
  // (node leg), which drives a committed and a rolled-back transactional
  // workflow and counts the reactor's rows.  Mutation-proved there: with the
  // tx repositories handed the root `events` dispatcher the run hangs on the
  // reactor's PGlite deadlock and never passes.  A string copy would only add
  // to the string tier (string-tier-ratchet.test.ts) under a stronger gate.

  it("keeps per-save dispatch on a non-transactional workflow", async () => {
    const files = await generateSystemFiles(source("node", false));
    const route = payRoute(fileEnding(files, "http/workflows.ts"));
    expect(route).toContain("new AcctRepository(db, events)");
    expect(route).not.toContain("deferredDispatcher");
  });
});

describe(".NET: transactional workflow defers aggregate events past commit", () => {
  it("opens a DomainEventDeferral before the transaction and flushes it after commit", async () => {
    const files = await generateSystemFiles(source("dotnet", true));
    const handler = fileEnding(files, "Application/Workflows/PayHandler.cs");
    const scope = handler.indexOf("using var __deferral = DomainEventDeferral.Begin();");
    const begin = handler.indexOf("await using var tx = await _uow.BeginTransactionAsync(");
    const commit = handler.indexOf("await tx.CommitAsync(cancellationToken);");
    const rethrow = handler.indexOf("throw;", commit);
    const flush = handler.indexOf("await __deferral.FlushAsync(cancellationToken);");
    expect(scope, "no deferral scope opened").toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(scope);
    expect(rethrow).toBeGreaterThan(commit);
    // After the rollback arm's rethrow: only the committed path reaches it.
    expect(flush, "the scope is never flushed after commit").toBeGreaterThan(rethrow);
  });

  it("routes every repository's post-save dispatch through the deferral", async () => {
    const files = await generateSystemFiles(source("dotnet", true));
    for (const repo of ["AcctRepository.cs", "TransferRepository.cs"]) {
      const src = fileEnding(files, `Infrastructure/Repositories/${repo}`);
      expect(src).toContain(
        "await DomainEventDeferral.DispatchAsync(_events, ev, cancellationToken);",
      );
      expect(src, `${repo} still dispatches straight to the dispatcher`).not.toContain(
        "await _events.DispatchAsync(ev",
      );
    }
    const common = fileEnding(files, "Domain/Common/DomainException.cs");
    expect(common).toContain("public sealed class DomainEventDeferral : IDisposable");
    // Buffered into the open scope, never dispatched inline while one is open.
    expect(common).toContain("scope._buffered.Add((dispatcher, ev));");
  });

  it("opens no deferral scope on a non-transactional workflow", async () => {
    const files = await generateSystemFiles(source("dotnet", false));
    const handler = fileEnding(files, "Application/Workflows/PayHandler.cs");
    expect(handler).not.toContain("DomainEventDeferral");
  });
});
