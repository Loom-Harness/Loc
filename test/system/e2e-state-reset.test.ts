// The emitted e2e suite's isolation seam (F3 / D-1, `src/util/test-reset.ts`).
//
// Measured before this landed, one generated system against one real Postgres,
// the same suite twice in a row:
//
//   run 1 (fresh DB):   Tests  4 passed (4)
//   run 2 (same DB):    Tests  1 failed | 3 passed (4)   → expected 6 to be 2
//
// There was no `beforeEach`, no truncate, no per-test transaction and no reset
// hook anywhere in the emitted `e2e/` project, and no vocabulary in the DSL to
// ask for one — so an exact count assertion was green on a fresh database and
// red on the second run of the same one, and every `it()` was coupled to the
// blocks before it.  Since the generated compose stack keeps a named `pgdata`
// volume, the second run is the DOCUMENTED one.
//
// The tests below pin the two halves that make the seam safe, because the
// safety property is the whole design: a suite pointed at staging must never
// truncate anything.  `loopbackGate` is the one that matters — it is the gate
// that needs no configuration and therefore cannot be forgotten, so it is
// exercised as BEHAVIOUR (the emitted predicate is evaluated against a host
// table) rather than asserted as emitted text.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { TEST_RESET_ENV, TEST_RESET_PATH } from "../../src/util/test-reset.js";
import { generateSystemFiles } from "../_helpers/index.js";

const SYS = (extra = "") => `
  system Shop {
    subdomain Sales {
      context Orders {
        aggregate Order with crudish {
          code: string
        }
        repository Orders for Order {}
      }
    }
    api OrdersApi from Sales
    storage pg { type: postgres }
    resource s { for: Orders, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [Orders]
      dataSources: [s]
      serves: OrdersApi
      port: 4000
    }
    ${extra}
  }
`;

const WITH_E2E = SYS(`
    test e2e "an exact count sees only its own rows" against d {
      api.orders.create({ code: "A" })
      api.orders.create({ code: "B" })
      expect(api.orders.all().total).toBe(2)
    }

    test e2e "a second block is not coupled to the first" against d {
      api.orders.create({ code: "C" })
      expect(api.orders.all().total).toBe(1)
    }
`);

const files = async (src: string): Promise<Map<string, string>> => generateSystemFiles(src);

/** Lift the emitted loopback predicate out of the generated suite and make it
 *  callable, so the gate is tested by what it DECIDES rather than by how it is
 *  spelled.  Pinning the regex as text would pass for a predicate that is
 *  emitted but never consulted, and would have to be rewritten by anyone who
 *  refactors the same behaviour — neither is the property worth protecting. */
function loopbackGate(e2e: string): (base: string) => boolean {
  const start = e2e.indexOf("function __isLoopbackBase");
  expect(start, "the emitted suite must define __isLoopbackBase").toBeGreaterThan(-1);
  const end = e2e.indexOf("\n}", start);
  // The emitted predicate is TypeScript; strip the annotations rather than
  // hand-rewriting them, so this keeps working if the emitter's signature
  // changes.
  const src = ts.transpileModule(e2e.slice(start, end + 2), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  // biome-ignore lint/security/noGlobalEval: the input is this repo's own emitted source, produced in-process two lines above.
  return eval(`(() => { ${src}; return __isLoopbackBase; })()`) as (base: string) => boolean;
}

describe("the emitted e2e suite resets state between tests", () => {
  it("calls the reset at the top of EVERY test body", async () => {
    const e2e = (await files(WITH_E2E)).get("e2e/Shop.e2e.test.ts")!;
    // One `it(` per declared block, and one reset per `it(` — per-TEST, not
    // per-file.  Per-file would make a RUN idempotent while leaving every
    // block coupled to its predecessors, which is half the finding.
    const its = [...e2e.matchAll(/^ {2}it\(/gm)];
    const resets = [...e2e.matchAll(/^ {4}await __resetState\(base\);$/gm)];
    expect(its).toHaveLength(2);
    expect(resets).toHaveLength(2);
    // …and it is the FIRST thing each block does, so no statement can observe
    // the previous block's rows.
    for (const block of e2e.split(/^ {2}it\(/m).slice(1)) {
      const body = block.slice(block.indexOf("\n") + 1);
      expect(body.trimStart().split("\n").slice(0, 2).join("\n")).toContain("__resetState(base)");
    }
  });

  it("emits no reset machinery for a system that declares no e2e tests", async () => {
    // "The feature off pays nothing" — a system with no `test e2e` block gets
    // no `e2e/` project, so nothing may leak into the rest of its tree either.
    const out = await files(SYS());
    expect([...out.keys()].filter((k) => k.startsWith("e2e/"))).toHaveLength(0);
    expect(out.get("d/docker-compose.yml") ?? "").not.toContain(TEST_RESET_ENV);
    expect(out.get("docker-compose.yml")!).not.toContain(TEST_RESET_ENV);
  });
});

describe("the reset cannot fire against a non-local target", () => {
  // This is the constraint that shapes the design: `E2E_D_BASE=https://staging…`
  // must not truncate staging's database, and must not depend on anyone
  // remembering a flag.  The gate is derived from the target URL itself.
  it("says yes to loopback and no to everything else", async () => {
    const e2e = (await files(WITH_E2E)).get("e2e/Shop.e2e.test.ts")!;
    const isLoopback = loopbackGate(e2e);

    for (const base of [
      "http://localhost:4000",
      "http://LOCALHOST:4000",
      "http://127.0.0.1:4000",
      "http://127.0.0.2:4000", // the whole 127.0.0.0/8 block, not one literal
      "http://127.1.2.3:4000",
      "http://[::1]:4000",
      "http://api.localhost:4000", // RFC 6761 reserves .localhost for loopback
      "https://localhost",
    ]) {
      expect(isLoopback(base), `${base} is loopback`).toBe(true);
    }

    for (const base of [
      "https://staging.example.com",
      "https://api.internal.corp:4000",
      "http://10.0.0.5:4000", // private, but NOT this machine
      "http://192.168.1.10:4000",
      "http://db:5432", // a compose service name, reachable only in-network
      // The near-misses.  Each of these READS as loopback and is not; a
      // substring or `startsWith` test would hand staging a truncate.
      "http://localhost.example.com",
      "http://127.0.0.1.example.com",
      "http://notlocalhost",
      "http://evil.com/?x=localhost",
      "http://evil.com#localhost",
      "http://user@localhost.evil.com",
      "not a url at all",
      "",
    ]) {
      expect(isLoopback(base), `${base} is NOT loopback`).toBe(false);
    }
  });
});

describe("the backend only registers the reset route when told to", () => {
  it("gates registration on an explicit switch with a non-production default", async () => {
    const http = (await files(WITH_E2E)).get("d/http/index.ts")!;
    expect(http).toContain(`app.post("${TEST_RESET_PATH}"`);
    // Registration is wrapped in a runtime `if`, not merely checked inside the
    // handler: outside a dev profile the PATH DOES NOT EXIST, so a production
    // deploy answers through the ordinary not-found floor having touched
    // nothing.
    const gate = http.slice(0, http.indexOf(`app.post("${TEST_RESET_PATH}"`));
    expect(gate).toContain(`process.env.${TEST_RESET_ENV} === "1"`);
    expect(gate).toContain(`process.env.${TEST_RESET_ENV} !== "0"`);
    expect(gate).toContain(`process.env.NODE_ENV !== "production"`);
    expect(gate).toMatch(/if \(testResetEnabled\) \{\s*$/m);
  });

  it("truncates with RESTART IDENTITY CASCADE and preserves the bookkeeping", async () => {
    const http = (await files(WITH_E2E)).get("d/http/index.ts")!;
    expect(http).toContain("restart identity cascade");
    // Discovery is at RUNTIME, so the reset reaches tables the model does not
    // describe but the backend creates (outbox, projections, the seed marker)
    // and cannot drift from a migration chain that moved on.
    expect(http).toContain("from pg_tables");
    // …while the migration ledger and the scheduler watermark survive it.
    expect(http).toContain("'drizzle'");
    expect(http).toContain("'loom_timer_runs'");
  });

  it("is reachable without a principal on an auth-bearing system", async () => {
    // The reset is infra, the same class as `/health` — an auth-bearing
    // system's suite must not have to mint a principal just to empty a table.
    // Bypassing costs nothing: outside a dev profile there is no handler
    // behind the bypassed path.
    const out = await files(`
      system Shop {
        user { id: string  role: string }
        subdomain Sales {
          context Orders {
            aggregate Order with crudish { code: string }
            repository Orders for Order {}
          }
        }
        api OrdersApi from Sales
        storage pg { type: postgres }
        resource s { for: Orders, kind: state, use: pg }
        deployable d {
          platform: node
          contexts: [Orders]
          dataSources: [s]
          serves: OrdersApi
          port: 4000
          auth: required
        }
        test e2e "counts only its own rows" against d {
          api.orders.create({ code: "A" })
          expect(api.orders.all().total).toBe(1)
        }
      }
    `);
    const mw = out.get("d/auth/middleware.ts")!;
    const bypass = mw.slice(mw.indexOf("const BYPASS_PREFIXES"));
    expect(bypass.slice(0, bypass.indexOf("\n"))).toContain(TEST_RESET_PATH);
  });
});

describe("the documented compose recipe opts in by name", () => {
  it("sets the switch on the backend service, so `npm test` is green twice", async () => {
    // The generated container image correctly pins NODE_ENV=production — it is
    // a production image — so without this line the compose stack, which is
    // the LOCAL dev stack built from it, would have no reset route and the
    // documented `docker compose up -d && cd e2e && npm test` would be red on
    // its second run.  That is the whole of F3.
    const compose = (await files(WITH_E2E)).get("docker-compose.yml")!;
    const api = compose.slice(compose.indexOf("\n  d:"));
    expect(api.slice(0, api.indexOf("\n  volumes:"))).toContain(`${TEST_RESET_ENV}: "1"`);
  });
});
