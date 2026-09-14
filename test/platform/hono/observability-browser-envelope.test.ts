// The generated hono backend's BROWSER-mode log envelope (wave C1, row c7
// handed off by wave C0's playground packet).
//
// `obs/log.ts` configures pino for the node build: top-level `formatters.level`
// (level LABEL, not pino's numeric severity) and a `timestamp` that emits the
// envelope's `"ts":"<ISO>"`.  When the same backend is BUNDLED FOR A BROWSER —
// the Loom playground runs it in a worker — the `pino` specifier resolves to
// `pino/browser.js`, which ignores both of those:
//
//   * `setOpts.formatters = opts.browser.formatters` (browser.js) — the
//     top-level `formatters` is never read, so with no `browser` block the
//     write path is the bare `write.apply(proto, args)` branch and the object
//     reaches `console.info` with NO `level` at all; and
//   * a child logger's bindings are PREPENDED AS THEIR OWN ARGUMENT
//     (`prependBindingsInArguments`), so the per-request logger
//     (`baseLogger.child({ request_id })`) calls
//     `console.info({ request_id }, { event: "request_end", … })` — two
//     arguments, neither of them the whole envelope.
//
// Measured against the real `pino/browser.js` (10.3.1, the v5 pin):
//
//   BEFORE  console.info argc=2
//           {"request_id":"req-1"}
//           {"event":"request_end","method":"GET","path":"/products",…}
//   AFTER   console.info argc=1
//           {"ts":"…Z","level":"info","request_id":"req-1","event":"request_end",…}
//
// So this test is not a spelling check on a string: it EXTRACTS the emitted
// `browser` option literal, evaluates it, and runs the two emitted formatter
// functions against the exact intermediate object `pino/browser.js`'s
// `asObject()` builds — `{ time: <opts.timestamp() result>, …level…,
// …bindings…, …payload… }` — asserting the envelope that comes out.

import { describe, expect, it } from "vitest";
import { emitObservabilityFiles } from "../../../src/platform/hono/v4/observability-builder.js";

function logTs(): string {
  const out = new Map<string, string>();
  emitObservabilityFiles(out, "catalog_web");
  const src = out.get("obs/log.ts");
  if (src === undefined) throw new Error("obs/log.ts not emitted");
  return src;
}

/** Slice the `browser: { … }` option literal out of the emitted source and
 *  evaluate it, so the assertions below run the EMITTED code rather than a
 *  hand-typed copy of it (the §59/§63 failure shape: a check that never
 *  reaches the thing it names). */
function browserOptions(src: string): {
  asObject?: boolean;
  formatters?: {
    level?: (label: string, num: number) => Record<string, unknown>;
    log?: (line: Record<string, unknown>) => Record<string, unknown>;
  };
} {
  const start = src.indexOf("\n  browser: {");
  expect(start, "obs/log.ts emits a `browser:` pino option block").toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  expect(end, "the `browser:` block is brace-balanced").toBeGreaterThan(-1);
  const literal = src.slice(open, end);
  // The emitted literal is deliberately annotation-free so it is valid JS.
  return new Function(`return (${literal});`)() as ReturnType<typeof browserOptions>;
}

describe("generated hono backend — browser-mode pino envelope", () => {
  it("emits a browser block that merges a child logger's bindings into one object", () => {
    const opts = browserOptions(logTs());
    // `asObject` is what collapses `console.info(bindings, payload)` into a
    // single structured argument (browser.js `asObject()` merges
    // `_childLevel + 1` leading objects).
    expect(opts.asObject).toBe(true);
  });

  it("labels the level in the BROWSER formatters, not only the top-level ones", () => {
    const src = logTs();
    const opts = browserOptions(src);
    // Without this, browser.js writes pino's numeric severity (`level: 30`).
    expect(opts.formatters?.level?.("info", 30)).toEqual({ level: "info" });
    expect(opts.formatters?.level?.("error", 50)).toEqual({ level: "error" });
    // And the node-side formatter still stands (the browser block must ADD a
    // path, not replace the one the node build reads).
    expect(src).toContain("formatters: {\n    level: (label) => ({ level: label }),\n  },");
  });

  it("renames the browser build's `time` key to the envelope's ISO `ts`", () => {
    const opts = browserOptions(logTs());
    const log = opts.formatters?.log;
    expect(log, "browser.formatters.log is emitted").toBeTypeOf("function");
    // Exactly what browser.js's asObject() hands the formatter: `time` set
    // from the TOP-LEVEL `timestamp`, which for this backend is the node
    // build's serialized fragment — unusable as a value.
    const line = log?.({
      time: ',"ts":"2026-09-11T08:00:00.000Z"',
      level: "info",
      request_id: "req-1",
      event: "request_end",
      status: 200,
    });
    expect(line).toBeDefined();
    expect(Object.hasOwn(line as object, "time")).toBe(false);
    expect(typeof line?.ts).toBe("string");
    expect(new Date(line?.ts as string).toISOString()).toBe(line?.ts);
    // Everything else rides through untouched, `ts` first (envelope order).
    expect(Object.keys(line as object)).toEqual(["ts", "level", "request_id", "event", "status"]);
    expect(line?.level).toBe("info");
    expect(line?.request_id).toBe("req-1");
    expect(line?.event).toBe("request_end");
  });
});
