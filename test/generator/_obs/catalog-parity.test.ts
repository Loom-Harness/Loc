import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LogEvents, type LogLevel } from "../../../src/generator/_obs/log-events.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Cross-backend catalog-coupling guard for the two backends whose log
// emitters DON'T import `log-events.ts` at generate time — Java (a
// hand-rolled `CatalogLog.event("…")` writer) and Python (a `log("level",
// "event", …)` facade inside template strings).  The Hono / .NET / Phoenix
// renderers read the catalog directly, so a typo there is a typecheck
// error; Java + Python re-spell the event names by hand and, before this
// test, leaned ENTIRELY on the slow per-backend obs-e2e suites to keep
// parity (LOOM_OBS_E2E_JAVA / _PYTHON).
//
// This is the fast per-PR substitute: scan the emitted source for every
// event the backend logs and assert each name (and, for Python, its level)
// matches a catalog entry.  An off-catalog event name or a level that
// disagrees with the catalog now fails `npm test`, not a nightly docker
// boot.  See docs/observability.md.
// ---------------------------------------------------------------------------

const CATALOG_LEVEL = new Map<string, LogLevel>(
  Object.values(LogEvents).map((e) => [e.event, e.level] as const),
);

const JAVA_SYSTEM = `
system S {
  subdomain M {
    context C {
      aggregate Order with crudish {
        customerId: string
        status: string
      }
      repository Orders for Order { }
    }
  }
  api OrdersApi from M
  storage primary { type: postgres }
  resource ordersState { for: C, kind: state, use: primary }
  deployable api {
    platform: java
    contexts: [C]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 8080
  }
}
`;

const PYTHON_SYSTEM = `
system S {
  subdomain M {
    context C {
      aggregate Order with crudish {
        customerId: string
        status: string
      }
      repository Orders for Order { }
    }
  }
  api OrdersApi from M
  storage primary { type: postgres }
  resource ordersState { for: C, kind: state, use: primary }
  deployable api {
    platform: python
    contexts: [C]
    dataSources: [ordersState]
    serves: OrdersApi
    port: 8000
  }
}
`;

function sourceFor(files: Map<string, string>, ext: string): string {
  return [...files.entries()]
    .filter(([k]) => k.endsWith(ext))
    .map(([, v]) => v)
    .join("\n");
}

describe("log-event catalog — Java emission parity", () => {
  it('every CatalogLog.event("…") name is a known catalog event', async () => {
    const java = sourceFor(await generateSystemFiles(JAVA_SYSTEM), ".java");
    const emitted = [...java.matchAll(/CatalogLog\.event\(\s*"([a-z][a-z0-9_]*)"/g)].map(
      (m) => m[1]!,
    );
    expect(emitted.length, "expected the Java backend to emit catalog events").toBeGreaterThan(0);
    const unknown = [...new Set(emitted)].filter((name) => !CATALOG_LEVEL.has(name));
    expect(unknown, `Java emits events absent from src/generator/_obs/log-events.ts`).toEqual([]);
  });

  it("every CatalogLog.event call passes a level that agrees with the catalog", async () => {
    // The unified channel takes (name, level, …); the level must match the
    // catalog so a `jq 'select(.level=="error")'` query is the same shape on
    // every backend.  trace folds to debug (Java has no trace level), so the
    // catalog's trace events are allowed to be emitted as debug.
    const java = sourceFor(await generateSystemFiles(JAVA_SYSTEM), ".java");
    const calls = [
      ...java.matchAll(
        /CatalogLog\.event\(\s*"([a-z][a-z0-9_]*)"\s*,\s*"(trace|debug|info|warn|error)"/g,
      ),
    ].map((m) => ({ event: m[1]!, level: m[2]! as LogLevel }));
    expect(calls.length, "expected leveled CatalogLog.event calls").toBeGreaterThan(0);
    const fold = (l: LogLevel): LogLevel => (l === "trace" ? "debug" : l);
    const mismatch = calls
      .filter((c) => CATALOG_LEVEL.has(c.event) && fold(CATALOG_LEVEL.get(c.event)!) !== c.level)
      .map((c) => `${c.event}: emitted ${c.level}, catalog ${CATALOG_LEVEL.get(c.event)}`);
    expect([...new Set(mismatch)], "Java CatalogLog level disagrees with the catalog").toEqual([]);
  });

  it("routes domain log lines through CatalogLog — no off-catalog slf4j survives", async () => {
    // Before unification, domain lines went through plain-text slf4j
    // (log.info/warn/error("<event> …")) — not JSON, not the envelope, some
    // off-catalog.  Every such line must now either be gone (routed through
    // CatalogLog) or, if any slf4j survives, name a known catalog event.
    const java = sourceFor(await generateSystemFiles(JAVA_SYSTEM), ".java");
    const slf4j = [
      ...java.matchAll(/\blog\.(?:info|warn|error|debug)\(\s*"([a-z][a-z0-9_]*)/g),
    ].map((m) => m[1]!);
    const offCatalog = [...new Set(slf4j)].filter((name) => !CATALOG_LEVEL.has(name));
    expect(
      offCatalog,
      "Java still logs off-catalog domain events via slf4j (route them through CatalogLog)",
    ).toEqual([]);
  });

  it("the CatalogLog envelope leads every line with the ts + level keys", async () => {
    // The cross-backend envelope is { ts, level, event, request_id, … }.  Java
    // logs through SLF4J: `level` + `event` are structured key/value pairs, `ts`
    // is the timestamp provider in logback.xml, and emission gates on LOG_LEVEL.
    const files = await generateSystemFiles(JAVA_SYSTEM);
    const java = sourceFor(files, ".java");
    expect(java, "CatalogLog must emit a level key/value").toContain('.addKeyValue("level", lvl)');
    expect(java, "CatalogLog must emit an event key/value").toContain(
      '.addKeyValue("event", name)',
    );
    expect(java, "CatalogLog must gate emission on LOG_LEVEL").toContain(
      'System.getenv("LOG_LEVEL")',
    );
    const logback = files.get(
      [...files.keys()].find((k) => k.endsWith("src/main/resources/logback.xml"))!,
    )!;
    expect(logback, "logback.xml must emit a ts timestamp field").toContain(
      "<fieldName>ts</fieldName>",
    );
  });

  it("the request bracket carries the cross-backend `duration_ms` field (not camelCase)", async () => {
    // The field name is a bare string literal passed as a key/value pair — easy
    // to drift to camelCase and silently break a
    // `jq 'select(.event=="request_end").duration_ms'` query that works on every
    // other backend.
    const java = sourceFor(await generateSystemFiles(JAVA_SYSTEM), ".java");
    expect(java).toContain('"duration_ms", durationMs');
    expect(java).not.toContain('"durationMs"');
  });
});

describe("log-event catalog — Python emission parity", () => {
  it('every log("level", "event") call matches a catalog entry at the same level', async () => {
    const py = sourceFor(await generateSystemFiles(PYTHON_SYSTEM), ".py");
    const calls = [
      ...py.matchAll(/\blog\(\s*"(trace|debug|info|warn|error)"\s*,\s*"([a-z][a-z0-9_]*)"/g),
    ].map((m) => ({ level: m[1]! as LogLevel, event: m[2]! }));
    expect(calls.length, "expected the Python backend to emit catalog events").toBeGreaterThan(0);

    const offCatalog = calls.filter((c) => !CATALOG_LEVEL.has(c.event));
    expect(
      [...new Set(offCatalog.map((c) => c.event))],
      "Python emits events absent from src/generator/_obs/log-events.ts",
    ).toEqual([]);

    const levelMismatch = calls
      .filter((c) => CATALOG_LEVEL.has(c.event) && CATALOG_LEVEL.get(c.event) !== c.level)
      .map((c) => `${c.event}: emitted ${c.level}, catalog ${CATALOG_LEVEL.get(c.event)}`);
    expect([...new Set(levelMismatch)], "Python log level disagrees with the catalog").toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The REVERSE direction (audit finding F35).  Everything above catches an
// event a backend emits that the catalog does not carry.  Nothing caught the
// opposite — a catalog entry NO backend emits — which is how
// `extern_handlers_registered` outlived its producer: the Python backend
// deliberately deleted its boot-time registration verify (see
// `test/generator/python/python-extern.test.ts`, "deleted apparatus"), no other
// backend ever had one, and the entry sat in the catalog unnoticed.
//
// The scan is source-level rather than output-level on purpose.  Every emitter
// reaches the catalog by KEY (`renderHonoLogCall("healthDegraded", …)`,
// `javaLogEvent("migrationApplied")`), so one grep of `src/` over the key and
// the event string covers all five backends at once — no generate, no docker.
//
// RESERVED_UNEMITTED is a ratcheting waiver: an entry deliberately kept for a
// future emitter, each with its reason. It ratchets both ways — a new orphan
// fails the gate rather than joining silently, and an entry that GAINS an
// emitter fails too, so the fix deletes its waiver in the same change.
// ---------------------------------------------------------------------------

const RESERVED_UNEMITTED: Readonly<Record<string, string>> = {
  dbConnecting:
    "reserved for a future eager-connect path; today's backend uses pg's lazy pool, so a " +
    "one-shot 'connected' event would either lie or block boot.",
  dbConnected: "the other half of the eager-connect pair above.",
  dbPoolExhausted:
    "pg.Pool exposes no exhaustion event; detecting it means polling waitingCount vs " +
    "options.max with debouncing. Kept so a future pool wrapper can fire it.",
};

describe("log-event catalog — no orphan entries", () => {
  it("every catalog entry is emitted by some backend, or waived with a reason", () => {
    const srcRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "src",
    );
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts") && !p.endsWith(path.join("_obs", "log-events.ts"))) {
          files.push(p);
        }
      }
    };
    walk(srcRoot);
    const all = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");

    // A key is REACHED when the emitters name it, either by catalog key
    // (`renderHonoLogCall("healthDegraded")`) or by the wire event string
    // (Java/Python re-spell it by hand).
    const reached = (key: string, event: string): boolean =>
      new RegExp(`\\b${key}\\b`).test(all) || new RegExp(`\\b${event}\\b`).test(all);

    const orphans = Object.entries(LogEvents)
      .filter(([key, e]) => !reached(key, e.event))
      .map(([key, e]) => `${key} → ${e.event}`);
    const waived = Object.keys(RESERVED_UNEMITTED);

    expect(
      orphans.filter((o) => !waived.includes(o.split(" ")[0]!)),
      "A catalog entry no backend emits is an orphan — delete it, or add it to " +
        "RESERVED_UNEMITTED with the reason it is being held.",
    ).toEqual([]);

    // Ratchet the other way: a waiver whose entry now HAS an emitter (or was
    // deleted) must go in the same change that earned it.
    const stale = waived.filter((k) => {
      const entry = (LogEvents as Record<string, { event: string } | undefined>)[k];
      return entry === undefined || reached(k, entry.event);
    });
    expect(
      stale,
      "RESERVED_UNEMITTED entry is stale — the event is now emitted (or gone). Drop the waiver.",
    ).toEqual([]);
  });
});

describe("log-event catalog — completeness", () => {
  it("carries the auth + outbox lifecycle events emitted across backends", () => {
    // These were emitted by Hono (auth_*) and Python (outbox_*) BEFORE they
    // existed in the catalog — added so the catalog is the genuine single
    // source of truth.  Pin them so a removal is a deliberate, reviewed change.
    for (const event of [
      "auth_oidc_verifier_registered",
      "auth_dev_stub_registered",
      "outbox_relay_started",
      "outbox_relay_error",
    ]) {
      expect(CATALOG_LEVEL.has(event), `${event} missing from the catalog`).toBe(true);
    }
  });
});
