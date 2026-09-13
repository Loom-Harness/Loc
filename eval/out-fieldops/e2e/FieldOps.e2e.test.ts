// Auto-generated.  Do not edit by hand.
import { describe, it, expect } from "vitest";

// Override per environment; defaults match the docker-compose ports.
const ENDPOINTS: Record<string, string> = {
  api: process.env.E2E_API_BASE ?? "http://localhost:3000",
  notifier: process.env.E2E_NOTIFIER_BASE ?? "http://localhost:3002",
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

describe("FieldOps e2e", () => {
  it("dispatcher schedules a work order to a qualified technician against api", async () => {
    const base = ENDPOINTS.api;
    await __post(`${base}/api/organizations`, ({ name: "Acme Field Services" }));
    const cust = await __post(`${base}/api/customers`, ({ name: "Northwind Facilities" }));
    const site = await __post(`${base}/api/sites`, ({ customerId: cust.id, label: "HQ", addressLine: "1 Main St", city: "Springfield" }));
    const asset = await __post(`${base}/api/assets`, ({ siteId: site.id, requiredSkill: "HVAC", serialNumber: "SN-1", model: "AC-3000", warrantyExpiry: "2030-01-01T00:00:00Z" }));
    const tech = await __post(`${base}/api/technicians`, ({ userId: "tech-1", name: "Jordan Lee", skills: ["HVAC"], costRatePerHour: 40.0 }));
    const wo = await __post(`${base}/api/work_orders`, ({ customerId: cust.id, siteId: site.id, assetId: asset.id, status: "Draft", priority: "Normal", currency: "USD" }));
    await __post(`${base}/api/work_orders/${wo.id}/assign_technician`, ({ assignTo: tech.id, assignedUserId: tech.userId, at: "2026-01-01T09:00:00Z" }));
    const read = await __get(`${base}/api/work_orders/${wo.id}`);
    expect(read.status).toBe("Scheduled");
  });

});
