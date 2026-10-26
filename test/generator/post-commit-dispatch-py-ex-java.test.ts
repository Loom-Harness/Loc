// M-T4.3 item 6 (banking-eval B-04) on python, elixir and java: request-path
// events reach their consumers only after the enclosing transaction COMMITS,
// and are dropped on a rollback (D-WRITE-TX).  The durable outbox row keeps
// riding the transaction.  The runtime proof is the behavioural corpus case
// `transactional-workflow-post-commit-dispatch` (all five backends); these
// pins hold the emitted shape so a regression names its seam.
//
// python: the whole REQUEST is one session/transaction (TransactionMiddleware),
//         so the deferral is request-wide — `make_dispatcher` returns a
//         `PostCommitDispatcher` that queues on the request's `post_commit`
//         list; the middleware runs it after `session.commit()` and clears it
//         on a rollback.
// elixir: a transactional workflow opens `<App>.PostCommit.transaction/1`
//         around its `Repo.transaction`; the op tail's `Dispatcher.AfterCommit`
//         and the PubSub broadcast route through `PostCommit.run/1`.
// java:   the `<Ctx>Workflows` command path never published a workflow-raised
//         event at all; it now publishes each save's drained events (and the
//         body's `emit`s) inside its `@Transactional`, so the reactors'
//         `@TransactionalEventListener(AFTER_COMMIT)` runs them post-commit.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const source = (platform: string): string => `system R {
  subdomain S { context C {
    event Debited { acct: Acct id, amount: int }
    aggregate Acct {
      name: string
      balance: int
      operation debit(amount: int) {
        precondition balance >= amount
        balance := balance - amount
        emit Debited { acct: id, amount: amount }
      }
    }
    repository Accts for Acct { }
    aggregate Audit { note: string }
    repository Audits for Audit { }
    workflow onDebit {
      a: Acct id
      create(e: Debited) by e.acct { let x = Audit.create(note: "debited") }
    }
    workflow pay transactional {
      create(src: Acct id) {
        let s = Accts.getById(src)
        s.debit(10)
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

describe("post-commit dispatch — python (request-wide)", () => {
  it("make_dispatcher defers the chain; the middleware runs it after commit, drops it on rollback", async () => {
    const files = await generateSystemFiles(source("python"));
    const dispatch = fileEnding(files, "app/dispatch.py");
    expect(dispatch).toContain(
      "return PostCommitDispatcher(InProcessDispatcher(session, isolate=True))",
    );
    const events = fileEnding(files, "app/domain/events.py");
    expect(events).toContain("class PostCommitDispatcher:");
    expect(events).toMatch(/if pending is None or event\.type in self\._durable:/);
    const tx = fileEnding(files, "app/db/transaction.py");
    // Commit FIRST, then the deferred work — before the response starts.
    expect(tx).toMatch(/await session\.commit\(\)\n\s+await _run_post_commit\(session, deferred\)/);
    // An error status drops the queue before rolling back.
    expect(tx).toMatch(/else:\n\s+deferred\.clear\(\)\n\s+await session\.rollback\(\)/);
  });
});

describe("post-commit dispatch — elixir (transactional-workflow buffer)", () => {
  it("the transactional workflow opens PostCommit around Repo.transaction; AfterCommit defers through it", async () => {
    const files = await generateSystemFiles(source("elixir"));
    const wf = fileEnding(files, "/workflows/pay.ex");
    expect(wf).toMatch(/PostCommit\.transaction\(fn ->\n\s+Repo\.transaction\(fn ->/);
    const dispatcher = fileEnding(files, "/dispatcher.ex");
    expect(dispatcher).toMatch(
      /def dispatch\(event\) do\n\s+Api\.PostCommit\.run\(fn -> deliver\(event\) end\)/,
    );
    const pc = fileEnding(files, "/post_commit.ex");
    // Flushed only on a committed result; anything else drops the queue.
    expect(pc).toMatch(
      /\{:ok, _\} -> queued \|> Enum\.reverse\(\) \|> Enum\.each\(&run\/1\)\n\s+_ -> :ok/,
    );
  });
});

describe("post-commit dispatch — java (the workflow route publishes)", () => {
  it("each exit save is followed by publishing its drained events on the injected publisher", async () => {
    const files = await generateSystemFiles(source("java"));
    const wf = fileEnding(files, "/CWorkflows.java");
    expect(wf).toContain("private final ApplicationEventPublisher eventPublisher;");
    expect(wf).toMatch(
      /accts?Repository\.save\(s\);\n\s+for \(var __e : s\.pullEvents\(\)\) eventPublisher\.publishEvent\(__e\);/,
    );
    // …and the reactors that receive it are the AFTER_COMMIT listener.
    const dispatcher = fileEnding(files, "/CDispatcher.java");
    expect(dispatcher).toContain("TransactionPhase.AFTER_COMMIT");
  });
});
