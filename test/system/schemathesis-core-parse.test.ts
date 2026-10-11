// The schemathesis leg core must count what the fuzzer could NOT do (M-T9.21).
//
// Two ways a leg read clean while fuzzing nothing:
//
// 1. An operation schemathesis cannot test emits `NonFatalError` events, not
//    check results.  The core read only check results, so an unresolvable `$ref`
//    in the served document (a schema error) and a fuzzer-internal crash (an
//    unpinned `jsonschema-rs` whose 0.56 release removed a method the generator
//    calls) both counted as "0 findings" for an operation that was never sent a
//    request.  Observed on the elixir cell: 14 schema errors + 12 runtime errors
//    over 29 operations, invisible to the verdict.
// 2. `--url` replaces the document's server URL, path included.  Phoenix serves
//    `servers: [{url: "/api"}]` with relative paths, so the fuzzer hit the
//    LiveView HTML pages at `/customers` instead of the API at `/api/customers`.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — untyped .mjs harness module
import { parseFindings, specServerBase } from "../behavioral/schemathesis-core.mjs";

function ndjson(events: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "loom-st-parse-"));
  const p = join(dir, "events.ndjson");
  writeFileSync(p, events.map((e) => JSON.stringify(e)).join("\n"));
  return p;
}

describe("schemathesis core — an untested operation is a finding", () => {
  it("keys a NonFatalError as <op>::error:<type>, one per operation and type", () => {
    const p = ndjson([
      {
        NonFatalError: {
          label: "POST /orders/{id}/add_line",
          phase: "Examples",
          value: { type: "InvalidSchema", message: "Unresolvable reference in the schema\n\nmore" },
        },
      },
      {
        NonFatalError: {
          label: "POST /orders/{id}/add_line",
          phase: "Fuzzing",
          value: { type: "InvalidSchema", message: "Unresolvable reference in the schema" },
        },
      },
      {
        NonFatalError: {
          label: "GET /customers",
          phase: "Fuzzing",
          value: {
            type: "AttributeError",
            message: "'builtins.CanonicalSchema' object has no attribute 'is_satisfiable'",
          },
        },
      },
    ]);
    try {
      const f: Map<string, { check: string; message: string; request: { method: string } }> =
        parseFindings(p);
      expect([...f.keys()].sort()).toEqual([
        "GET /customers::error:AttributeError",
        "POST /orders/{id}/add_line::error:InvalidSchema",
      ]);
      const schemaErr = f.get("POST /orders/{id}/add_line::error:InvalidSchema")!;
      expect(schemaErr.check).toBe("error:InvalidSchema");
      expect(schemaErr.message).toBe("Unresolvable reference in the schema");
      expect(schemaErr.request.method).toBe("POST");
    } finally {
      rmSync(join(p, ".."), { recursive: true, force: true });
    }
  });

  it("still keys a failed check as <op>::<check>", () => {
    const p = ndjson([
      {
        ScenarioFinished: {
          recorder: {
            label: "GET /api/customers/{id}",
            checks: { c1: [{ name: "not_a_server_error", status: "failure", message: "500" }] },
            cases: {},
            interactions: {
              c1: {
                request: { method: "GET", uri: "http://h/api/customers/0" },
                response: { status_code: 500 },
              },
            },
          },
        },
      },
    ]);
    try {
      expect([...parseFindings(p).keys()]).toEqual(["GET /api/customers/{id}::not_a_server_error"]);
    } finally {
      rmSync(join(p, ".."), { recursive: true, force: true });
    }
  });
});

describe("schemathesis core — the fuzz base keeps the spec's server path", () => {
  const base = "http://127.0.0.1:8193";
  it("resolves a relative server URL onto the booted origin", () => {
    expect(specServerBase({ servers: [{ url: "/api" }] }, base)).toBe(`${base}/api`);
    expect(specServerBase({ servers: [{ url: "/api/" }] }, base)).toBe(`${base}/api`);
  });
  it("keeps only the path of an absolute server URL", () => {
    expect(specServerBase({ servers: [{ url: "http://localhost:3000" }] }, base)).toBe(base);
    expect(specServerBase({ servers: [{ url: "https://example.test/v1" }] }, base)).toBe(
      `${base}/v1`,
    );
  });
  it("leaves the origin alone when the spec names no server", () => {
    expect(specServerBase({}, base)).toBe(base);
    expect(specServerBase({ servers: [] }, base)).toBe(base);
  });
});
