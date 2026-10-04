// H-28 (helpdesk eval): a reactor that throws must not fail the command whose
// event it reacts to — the request path isolates it (logs `reactor_failed`),
// while the outbox relay / broker consumer keep a RAISING dispatcher, because
// their retry / redelivery / dead-letter bookkeeping rides the throw.
//
// The runtime proof is the behavioural `reactor-failure` corpus case (all five
// backends, booted).  This pins the emitted SHAPE in the fast tier, both
// halves: the request path isolates, and the relay path does not.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const FIXTURE = readFileSync(
  new URL("../fixtures/corpus/reactor-failure.ddd", import.meta.url),
  "utf8",
);

/** The fixture on `platform`, optionally with its channel made durable — the
 *  shape that wires the outbox relay next to the request path. */
const source = (platform: string, durable = false): string => {
  const s = FIXTURE.replace("__PLATFORM__", platform);
  return durable ? s.replace("retention: ephemeral", "retention: work") : s;
};

const file = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files].find(([k]) => k.endsWith(suffix));
  expect(hit, `no ${suffix} emitted`).toBeDefined();
  return hit![1];
};

describe("reactor failure isolation — node", () => {
  it("createApp's default dispatcher isolates; the factory logs reactor_failed", async () => {
    const files = await generateSystemFiles(source("node"));
    expect(file(files, "http/index.ts")).toContain(
      "createInProcessDispatcher(db, { isolateReactorFailures: true })",
    );
    const wf = file(files, "http/workflows.ts");
    expect(wf).toContain("if (!opts.isolateReactorFailures) return run();");
    expect(wf).toContain('event: "reactor_failed"');
    expect(wf).toMatch(/await runReactor\(opts, "askForRatingStartTicketResolved", event, /);
  });

  it("the relay drives the raising instance; the request path its isolating twin", async () => {
    const boot = file(await generateSystemFiles(source("node", true)), "d/index.ts");
    expect(boot).toContain("const inProcessEvents = realtimeTee(createInProcessDispatcher(db));");
    expect(boot).toContain(
      "const requestEvents = realtimeTee(createInProcessDispatcher(db, { isolateReactorFailures: true }));",
    );
    expect(boot).toContain("createApp(db, createOutboxDispatcher(db, requestEvents))");
    expect(boot).toContain("startOutboxRelay(db, inProcessEvents)");
  });
});

describe("reactor failure isolation — .NET", () => {
  it("the in-process dispatcher isolates by default and detaches staged EF changes", async () => {
    const d = file(
      await generateSystemFiles(source("dotnet")),
      "Infrastructure/Events/InProcessDomainEventDispatcher.cs",
    );
    expect(d).toContain("public bool IsolateReactorFailures { get; set; } = true;");
    expect(d).toContain('"reactor_failed"');
    expect(d).toContain("entry.State = Microsoft.EntityFrameworkCore.EntityState.Detached;");
  });

  it("the outbox relay switches isolation off for its scope", async () => {
    const files = await generateSystemFiles(source("dotnet", true));
    const relay = [...files].find(([, v]) => v.includes("class OutboxRelayService"));
    expect(relay, "no OutboxRelayService emitted").toBeDefined();
    expect(relay![1]).toContain("inner.IsolateReactorFailures = false;");
  });
});

describe("reactor failure isolation — elixir", () => {
  it("the op's post-commit dispatch goes through AfterCommit; the reaction is a transaction", async () => {
    const files = await generateSystemFiles(source("elixir"));
    const dispatcher = file(files, "lib/d/desk/dispatcher.ex");
    expect(dispatcher).toContain("defmodule D.Desk.Dispatcher.AfterCommit do");
    expect(dispatcher).toContain('Logger.error("reactor_failed"');
    expect(file(files, "lib/d/desk.ex")).toContain("D.Desk.Dispatcher.AfterCommit.dispatch(");
    expect(file(files, "start_ticket_resolved.ex")).toContain("D.Repo.transaction(fn ->");
  });
});

describe("reactor failure isolation — java", () => {
  it("local reactors run AFTER_COMMIT in REQUIRES_NEW through the nested ReactorListener", async () => {
    const d = file(await generateSystemFiles(source("java")), "DeskDispatcher.java");
    expect(d).toContain("public static class ReactorListener {");
    expect(d).toContain("TransactionPhase.AFTER_COMMIT, fallbackExecution = true");
    expect(d).toContain("PROPAGATION_REQUIRES_NEW");
    expect(d).toContain('"handler", handler');
    // The handler itself is no longer an @EventListener (the listener drives
    // it), so the command's transaction can never run it inline.
    const handler = d.slice(0, d.indexOf("public void onAskForRatingStartTicketResolved"));
    expect(handler.trimEnd().endsWith("@EventListener")).toBe(false);
  });
});

describe("reactor failure isolation — python", () => {
  it("make_dispatcher isolates (SAVEPOINT per reaction); the default raises", async () => {
    const d = file(await generateSystemFiles(source("python")), "app/dispatch.py");
    expect(d).toContain("InProcessDispatcher(session, isolate=True)");
    expect(d).toContain("def __init__(self, session: AsyncSession, isolate: bool = False)");
    expect(d).toContain("async with self._session.begin_nested():");
    expect(d).toContain('log("error", "reactor_failed"');
  });

  it("the outbox relay builds the raising dispatcher", async () => {
    const d = file(await generateSystemFiles(source("python", true)), "app/dispatch.py");
    expect(d).toMatch(/InProcessDispatcher\(session\)(?!,)/);
  });
});
