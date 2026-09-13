import { describe, expect, it } from "vitest";
import { installConsoleTee, setLogSink } from "../../web/src/runtime/console-tee.js";
import { LOG_LEVELS, type LogLine } from "../../web/src/util/log-line.js";

// A throwaway Console-shaped object so the tee install doesn't clobber
// the test runner's real console.  Every level is a no-op passthrough.
function fakeConsole(): Console {
  const c = {} as Record<string, unknown>;
  for (const level of LOG_LEVELS) c[level] = () => {};
  return c as unknown as Console;
}

describe("runtime console tee", () => {
  it("routes a logger that bound console BEFORE the sink swap to the current sink", () => {
    // This is the exact regression: pino binds `console.info` once, at
    // boot — long before any dispatch sets its own sink.  The permanent
    // tee + swappable sink must still deliver that bound call to whatever
    // RPC is active when it fires.
    const con = fakeConsole();
    installConsoleTee(con);

    // Simulate pino capturing the console method at logger-creation time.
    const boundInfo = con.info.bind(con);

    const dispatchLogs: LogLine[] = [];
    setLogSink(dispatchLogs);
    boundInfo({ level: "info", event: "request_end", status: 200 });
    setLogSink(null);

    expect(dispatchLogs).toHaveLength(1);
    expect(dispatchLogs[0].level).toBe("info");
    expect(dispatchLogs[0].structured?.event).toBe("request_end");
  });

  it("overrides the LogLine level from the structured pino payload", () => {
    const con = fakeConsole();
    installConsoleTee(con);
    const logs: LogLine[] = [];
    setLogSink(logs);
    // pino-in-browser routes logger.trace through console.debug, so the
    // method name under-represents the level — the payload wins.
    (con.debug as (...a: unknown[]) => void)({ level: "trace", event: "deep" });
    setLogSink(null);
    expect(logs[0].level).toBe("trace");
  });

  it("structures the shape pino's BROWSER build actually emits", () => {
    // The two tests above type the payload the way pino's NODE build writes
    // it — one argument, `level` inside.  The generated backend does not run
    // on that build here: the playground bundles it for a worker, so pino
    // resolves its `browser` entry, which
    //   (a) reads `formatters` off `opts.browser.formatters` (the generated
    //       obs/log.ts sets the top-level `formatters`), so with neither
    //       `browser.asObject` nor `browser.formatters` set it takes the
    //       `write.apply(proto, args)` branch and the object carries NO
    //       `level`; and
    //   (b) prepends a child logger's bindings as their own argument, so the
    //       per-request logger (`baseLogger.child({ request_id })`) calls
    //       `console.info({ request_id }, { event: "request_end", … })`.
    // Simulating (a)+(b) is the difference between a green test and a gate:
    // with the single-argument probe this line was captured as plain text,
    // `structured` was undefined, `aggregateRequestTraces` saw zero
    // request_end lines, and the Runtime tab's Requests view rendered
    // "No requests yet" after a real GET.
    const con = fakeConsole();
    installConsoleTee(con);
    const logs: LogLine[] = [];
    setLogSink(logs);
    (con.info as (...a: unknown[]) => void)(
      { request_id: "abc-123" },
      { event: "request_end", method: "GET", path: "/api/products", status: 200, duration_ms: 3 },
    );
    setLogSink(null);

    expect(logs).toHaveLength(1);
    expect(logs[0].structured, "the browser-pino line must reach `structured`").toBeDefined();
    expect(logs[0].structured?.event).toBe("request_end");
    expect(logs[0].structured?.level).toBe("info");
    expect(logs[0].structured?.request_id).toBe("abc-123");
  });

  it("drops output (no throw) when no sink is active", () => {
    const con = fakeConsole();
    installConsoleTee(con);
    setLogSink(null);
    expect(() => (con.info as (...a: unknown[]) => void)("ignored")).not.toThrow();
  });

  it("captures plain string console calls during an active sink", () => {
    const con = fakeConsole();
    installConsoleTee(con);
    const logs: LogLine[] = [];
    setLogSink(logs);
    (con.error as (...a: unknown[]) => void)("boom");
    setLogSink(null);
    expect(logs).toEqual([{ level: "error", text: "boom" }]);
  });
});
