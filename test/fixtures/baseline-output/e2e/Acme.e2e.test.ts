// Auto-generated.  Do not edit by hand.
import { describe, it, expect } from "vitest";

// Override per environment; defaults match the docker-compose ports.
const ENDPOINTS: Record<string, string> = {
  api: process.env.E2E_API_BASE ?? "http://localhost:8080",
  catalog_web: process.env.E2E_CATALOG_WEB_BASE ?? "http://localhost:3000",
  catalog_api: process.env.E2E_CATALOG_API_BASE ?? "http://localhost:8081",
  web_app: process.env.E2E_WEB_APP_BASE ?? "http://localhost:3001",
};

// The parsed JSON body of one generated call.  A generated assertion reads
// DECLARED wire fields straight off it (`read.code`, `page.items[0].total`),
// and this project has no DTO types to import — the wire schemas live inside
// the backend project, which the suite deliberately does not depend on (it
// talks HTTP to a RUNNING service, possibly a different backend than the one
// the types would come from).  So the JSON boundary is typed once, here, with
// a name that says what it is.  Typing it `unknown` instead made EVERY emitted
// assertion a `TS18046: 'x' is of type 'unknown'` error — the emitted `e2e/`
// project did not type-check for any system, which nothing noticed because
// nothing compiled it.
// biome-ignore lint/suspicious/noExplicitAny: the boundary of an untyped JSON wire; narrowing it would require importing the backend's DTOs, which is exactly the coupling this suite avoids.
type __WireBody = any;

// When the target system requires auth, every request must carry a principal
// or the backend rejects it 401 before the assertion's real path
// (create/validation/not-found) is ever reached.  The harness stays
// provider-agnostic and supports both auth modes:
//   • OIDC systems — forward a JWT from `E2E_BEARER_TOKEN` (the runner mints it).
//   • dev-stub systems (no `auth {}` block) — inject `x-loom-dev-claims`, a
//     base64-encoded JSON of principal claims (keyed by declared `user` field,
//     e.g. `{"tenantId":"acme","role":"agent"}`), which every backend's dev-stub
//     verifier merges over its built-in identity.  This is the exact mechanism
//     the tenancy-e2e isolation harness uses.  `E2E_DEV_CLAIMS` is the raw JSON;
//     an unset/empty value sends no header (auth-less systems ignore it anyway).
function __authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = process.env.E2E_BEARER_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const claims = process.env.E2E_DEV_CLAIMS;
  if (claims) headers["x-loom-dev-claims"] = Buffer.from(claims).toString("base64");
  return headers;
}

// ── Test isolation ─────────────────────────────────────────────────────────
// This suite drives a REAL database through a RUNNING backend, so without a
// reset between blocks it is not idempotent: an exact count assertion is
// green on a fresh database and red on the second run of the same one, and
// every `it()` is coupled to the blocks that ran before it.  A per-test
// TRANSACTION cannot close that — the suite talks HTTP to a separate process,
// so it has no transaction to share — so each block instead asks the backend
// to put its own state back.
//
// SAFETY.  A suite pointed at staging must never truncate anything, so the
// reset is gated TWICE and the gate that matters needs no configuration:
//
//   • here — the request is only SENT when the target is a loopback address.
//     Pointing this suite at a deployed environment
//     (`E2E_<DEPLOYABLE>_BASE=https://staging.example.com`) disables it by
//     construction.  There is deliberately NO override: a remote-enable flag
//     is exactly the thing that gets copied into a CI config and then points
//     at the wrong host one refactor later.
//
//   • on the backend — the reset answers 404 unless it is switched on, so in
//     a real deployment it does nothing.  (Three of the five backends go
//     further and do not register the route at all.)
//
// `E2E_RESET=off` turns it off entirely, for a suite whose blocks are written
// to accumulate on purpose.
const __RESET_PATH = "/__loom/test-reset";

function __isLoopbackBase(base: string): boolean {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    // Not a URL this can reason about — treat as remote and reset nothing.
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // `URL.hostname` KEEPS the brackets on an IPv6 literal (and normalizes the
  // long form, so `[0:0:0:0:0:0:0:1]` already arrives as `[::1]`); strip them
  // anyway so this does not rest on that normalization.
  if (host.replace(/^\[|\]$/g, "") === "::1") return true;
  // The whole 127.0.0.0/8 block, not just 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

// Bases already reset in this process, for the default per-file mode.
const __resetOnce = new Set<string>();
// Bases that answered 404 — warned about once, then left alone.
const __resetUnavailable = new Set<string>();

/** Print a warning without ever being the reason a suite fails.
 *
 *  Two hosts, two different gaps, both measured:
 *
 *    • under vitest, `console` output from a PASSING test is swallowed by the
 *      default reporter — and this warning prints exactly when the suite goes
 *      on to pass — so `process.stderr` is tried first;
 *    • under a harness that evaluates this file with a partial `process` shim,
 *      `process.stderr` is UNDEFINED, and reaching for `.write` on it threw
 *      "Cannot read properties of undefined" out of the reset and took 59 cases
 *      down with it.
 *
 *  So: try stderr, fall back to console, and swallow anything either throws.
 *  A diagnostic must never become the fault it was describing. */
function __warnOnce(message: string): void {
  try {
    const err = typeof process !== "undefined" ? process.stderr : undefined;
    if (err && typeof err.write === "function") {
      err.write(message);
      return;
    }
  } catch {
    // fall through to console
  }
  try {
    console.warn(message);
  } catch {
    // nowhere left to print — still not a reason to fail the suite
  }
}

/** Put the target back to its just-migrated-and-seeded state.
 *
 *  `E2E_RESET` picks WHEN:
 *
 *    per-file  (default)  once per target, before the first test that uses it
 *    per-test             before every test
 *    off                  never
 *
 *  The default is per-FILE because per-test changes what a `test e2e` block
 *  MEANS.  A block is free to build on rows an earlier block created — several
 *  do on purpose, one of them named "the second … beside the first" — and
 *  resetting between them turns those into failures.  Per-file is what the
 *  finding actually asks for: the suite starts from the same state every run,
 *  so a second `npm test` against the same stack behaves exactly like the
 *  first, and nothing that passed before stops passing.
 *
 *  `per-test` is the stronger contract — each block sees only the rows it
 *  creates, so a count assertion no longer depends on block ORDER — and is
 *  worth opting into for a suite written that way.  It costs one extra round
 *  trip per block (measured: median 6.0 ms against a local Postgres). */
async function __resetState(base: string): Promise<void> {
  const mode = process.env.E2E_RESET ?? "per-file";
  if (mode === "off") return;
  if (mode !== "per-test" && __resetOnce.has(base)) return;
  if (!__isLoopbackBase(base)) return;
  __resetOnce.add(base);
  const url = `${base}${__RESET_PATH}`;
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: __authHeaders() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`E2E state reset could not reach ${url}: ${message}`);
  }
  if (r.ok) return;
  const detail = await r.text().catch(() => "");
  if (r.status === 404) {
    // NOT fatal, and the reason matters.  404 is the NORMAL answer from a
    // backend that has not been told the reset is allowed — and two of the
    // five (python, java) ship no production-profile marker, so they require
    // `LOOM_TEST_RESET=1` and answer 404 until someone sets it.  Failing here
    // would turn "you did not opt in" into a suite that cannot run at all,
    // against a backend started any way other than through the generated
    // compose file.
    //
    // So this degrades to what the suite did before the reset existed —
    // shared state — and SAYS SO once, rather than surfacing it later as a
    // bare `expected 6 to be 2` in whichever block happened to count rows.
    if (!__resetUnavailable.has(base)) {
      __resetUnavailable.add(base);
      __warnOnce(
        [
          "",
          `[e2e] No state reset at ${base} (404) — these tests SHARE a database.`,
          "      They are green on a fresh one and can fail on a re-run.",
          "      Enable it by starting the backend with LOOM_TEST_RESET=1; the",
          "      generated docker-compose.yml already sets that on every backend",
          "      service. Otherwise use a fresh database per run:",
          "        docker compose down -v && docker compose up --build -d",
          "",
        ].join("\n"),
      );
    }
    return;
  }
  // Anything else IS a fault the author has to see — a 500 from the truncate,
  // a proxy in the way — and silently carrying on would hide it.
  throw new Error(
    [
      `E2E state reset failed: POST ${url} → ${r.status}${detail ? ": " + detail.slice(0, 200) : ""}`,
      "",
      "Without it this suite is NOT idempotent — it passes on a fresh database",
      "and fails on the second run of the same one, because every test shares",
      "state with the tests before it.",
      "",
      "Otherwise: run against a FRESH database each time (docker compose down -v),",
      "or set E2E_RESET=off to accept shared state and write assertions that",
      "tolerate it.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function __post(url: string, body: unknown): Promise<__WireBody> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...__authHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  const text = await r.text();
  // Check the status BEFORE parsing: a 404 (or any error) often carries a
  // non-JSON body (e.g. Hono's "404 Not Found"), and parsing it first would
  // mask the real status behind an opaque "JSON Parse error".
  if (!r.ok) throw new Error(`POST ${url} → ${r.status} ${r.statusText}${text ? ": " + text : ""}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`POST ${url} → ${r.status}: expected JSON, got ${JSON.stringify(text.slice(0, 200))}`);
  }
}

async function __get(url: string): Promise<__WireBody> {
  const r = await fetch(url, { headers: __authHeaders() });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${url} → ${r.status} ${r.statusText}${text ? ": " + text : ""}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GET ${url} → ${r.status}: expected JSON, got ${JSON.stringify(text.slice(0, 200))}`);
  }
}

async function __getQuery(url: string, params: Record<string, unknown>): Promise<__WireBody> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v != null) qs.set(k, String(v));
  }
  const full = qs.toString().length > 0 ? `${url}?${qs}` : url;
  return __get(full);
}

describe("Acme e2e", () => {
  it("create a product, look it up by id against api", async () => {
    const base = ENDPOINTS.api;
    await __resetState(base);
    const p = await __post(`${base}/api/products`, ({ sku: "WIDGET-1", price: ({ amount: 9.99, currency: "USD" }) }));
    const read = await __get(`${base}/api/products/${p.id}`);
    expect(read.sku).toBe("WIDGET-1");
  });

  it("create a product, look it up by id against catalog_web", async () => {
    const base = ENDPOINTS.catalog_web;
    await __resetState(base);
    const p = await __post(`${base}/api/products`, ({ sku: "WIDGET-1", price: ({ amount: 9.99, currency: "USD" }) }));
    const read = await __get(`${base}/api/products/${p.id}`);
    expect(read.sku).toBe("WIDGET-1");
  });

  it("create a product, look it up by id against catalog_api", async () => {
    const base = ENDPOINTS.catalog_api;
    await __resetState(base);
    const p = await __post(`${base}/api/products`, ({ sku: "WIDGET-1", price: ({ amount: 9.99, currency: "USD" }) }));
    const read = await __get(`${base}/api/products/${p.id}`);
    expect(read.sku).toBe("WIDGET-1");
  });

  it("create then confirm an order with one line against api", async () => {
    const base = ENDPOINTS.api;
    await __resetState(base);
    const prod = await __post(`${base}/api/products`, ({ sku: "WIDGET-2", price: ({ amount: 5.00, currency: "USD" }) }));
    const ord = await __post(`${base}/api/orders`, ({ customerId: "cust-001", status: "Draft", placedAt: "2024-01-01T00:00:00Z" }));
    await __post(`${base}/api/orders/${ord.id}/add_line`, ({ productId: prod.id, qty: 3 }));
    await __post(`${base}/api/orders/${ord.id}/confirm`, {});
    const read = await __get(`${base}/api/orders/${ord.id}`);
    expect(read.status).toBe("Confirmed");
    expect(read.lines.length).toBe(1);
  });

  it("by_customer query returns matching orders against api", async () => {
    const base = ENDPOINTS.api;
    await __resetState(base);
    await __post(`${base}/api/orders`, ({ customerId: "cust-002", status: "Draft", placedAt: "2024-01-02T00:00:00Z" }));
    const list = await __getQuery(`${base}/api/orders/by_customer`, ({ customerId: "cust-002" }));
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

});
