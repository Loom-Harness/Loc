// The scaffolded-form behaviour probe (#5212), for a case that declares
// `"textProbe": "form-spec"` in corpus.json.  It drives the BUILT app's forms
// over the DOM (the JS / Feliz frontends) against `form-spec-ui.ddd` and reads
// the result back over the api, so what is on trial is what the form SUBMITS:
//
//   update prefill   the Update dialog opens on the record: changing one field
//                    keeps every other field (a zero-seeded form reset them).
//   absence          clearing an optional text input submits `null`, not `""`;
//                    an optional value object left out submits `null`.
//   collections      a scalar list is typed comma-separated and an enum list is
//                    a checkbox group; both submit arrays.
//   pickers          a reference collection offers every row of its target,
//                    not one list page (the 25th provider is tickable).
//   part tables      a part's value-object fields are columns of its table.
//   navigation       an update stays on the record; a workflow whose start
//                    answers the created record's id opens it; a fresh form
//                    shows no error before a touch.
//   optional group   checking an optional value object's presence box and
//                    filling it saves the object.
//
// Inputs are found by the shared test ids (`<slug>-op-<op>-input-<field>`);
// where a pack puts the id on a wrapper, the probe reaches the input inside it.

/** Seed one provider and one policy over the api; returns the policy as stored. */
export async function seedFormSpec(base) {
  const post = async (path, body) => {
    const r = await fetch(`${base}/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`seed failed: POST ${path} → ${r.status} ${await r.text()}`);
    return r.json();
  };
  const provider = await post("/providers", { name: "Acme Towing" });
  // More providers than one default list page (20): a picker must offer the
  // last one too.
  let lastProvider = provider;
  for (let i = 2; i <= 25; i++) {
    lastProvider = await post("/providers", { name: `Provider ${String(i).padStart(2, "0")}` });
  }
  const created = await post("/policies", {
    holder: "Ada",
    region: "North",
    priority: 3,
    rate: 1.5,
    premium: "120.00",
    active: true,
    startsOn: "2026-01-02",
    reviewAt: "2026-03-04T05:06:00Z",
    schedule: null,
    usage: "Commercial",
    provider: provider.id,
    backup: null,
    limit: { amount: "5000.00", note: "cap" },
    vehicle: null,
    tags: ["a", "b"],
    perils: ["Fire"],
    alternates: [],
    riders: [{ code: "R1", premium: 2.5 }],
  });
  return { ...(await readPolicy(base, created.id)), lastProviderId: lastProvider.id };
}

export async function readPolicy(base, id) {
  const r = await fetch(`${base}/api/policies/${id}`);
  if (!r.ok) throw new Error(`GET /policies/${id} → ${r.status}`);
  return r.json();
}

/** The fields an update that changed only `priority` and cleared `region` must
 *  leave as they were. */
export const KEPT_FIELDS = [
  "holder",
  "rate",
  "active",
  "startsOn",
  "usage",
  "provider",
  "limit",
  "riders",
  // Absent on the record and untouched: a zero object would fail its invariant.
  "vehicle",
];

/** Judge the record after the update: `[]` when it holds, else the problems. */
export function judgeFormSpec(before, after) {
  const why = [];
  if (after.priority !== 7) why.push(`priority: expected 7, got ${JSON.stringify(after.priority)}`);
  if (after.region !== null && after.region !== undefined) {
    why.push(`region: a cleared optional input must submit null, got ${JSON.stringify(after.region)}`);
  }
  if (JSON.stringify(after.tags) !== JSON.stringify(["x", "y"])) {
    why.push(`tags: expected ["x","y"], got ${JSON.stringify(after.tags)}`);
  }
  if (JSON.stringify([...(after.perils ?? [])].sort()) !== JSON.stringify(["Fire", "Flood"])) {
    why.push(`perils: expected Fire + Flood, got ${JSON.stringify(after.perils)}`);
  }
  if (!(after.alternates ?? []).includes(before.lastProviderId)) {
    why.push(`alternates: the 25th provider was not pickable, got ${JSON.stringify(after.alternates)}`);
  }
  for (const k of KEPT_FIELDS) {
    const a = JSON.stringify(normalize(before[k]));
    const b = JSON.stringify(normalize(after[k]));
    if (a !== b) why.push(`${k}: the update reset it (${a} → ${b})`);
  }
  return why;
}

/** Money and decimals may come back with a different scale; compare by value. */
function normalize(v) {
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  }
  return v;
}

/** The `<input>` a test id names — the element itself, or the first input
 *  inside a wrapper that carries the id. */
async function inputOf(page, testId) {
  const el = page.locator(`[data-testid="${testId}"]`).first();
  await el.waitFor({ state: "attached", timeout: 15000 });
  const tag = await el.evaluate((n) => n.tagName);
  return tag === "INPUT" || tag === "TEXTAREA" ? el : el.locator("input, textarea").first();
}

/** Drive the Update dialog on the record's detail page. */
export async function driveUpdate(page, origin, id, lastProviderId) {
  await page.goto(`${origin}/policies/${id}`);
  await page.locator('[data-testid="policies-op-update"]').first().click({ timeout: 20000 });
  const priority = await inputOf(page, "policies-op-update-input-priority");
  await priority.fill("7");
  const region = await inputOf(page, "policies-op-update-input-region");
  await region.fill("");
  const tags = await inputOf(page, "policies-op-update-input-tags");
  await tags.fill("x, y");
  await tags.press("Tab");
  await (await inputOf(page, "policies-op-update-input-perils-option-Flood")).check();
  await (await inputOf(page, `policies-op-update-input-alternates-option-${lastProviderId}`)).check();
  await page.locator('[data-testid="policies-op-update-submit"]').first().click();
}

/** Add the optional value object through the Update dialog's opt-in group. */
export async function driveAddVehicle(page, origin, id) {
  await page.goto(`${origin}/policies/${id}`);
  await page.locator('[data-testid="policies-op-update"]').first().click({ timeout: 20000 });
  await (await inputOf(page, "policies-op-update-input-vehicle-present")).check();
  await (await inputOf(page, "policies-op-update-input-vehicle-vin")).fill("1HGCM82633A004352");
  await (await inputOf(page, "policies-op-update-input-vehicle-year")).fill("2019");
  await page.locator('[data-testid="policies-op-update-submit"]').first().click();
}

/** Judge the record after the vehicle was added. */
export function judgeVehicleAdded(after) {
  const v = after.vehicle;
  if (!v || v.vin !== "1HGCM82633A004352" || v.year !== 2019) {
    return [`vehicle: the opt-in group did not save it, got ${JSON.stringify(v)}`];
  }
  return [];
}

/** Add one coverage — a part row carrying a value object — over the api, for
 *  the part-table check. */
export async function seedCoverage(base, id) {
  const r = await fetch(`${base}/api/policies/${id}/add_coverage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "COV-1", limit: { amount: "777.00", note: "per claim" }, premium: "12.00" }),
  });
  if (!r.ok) throw new Error(`seed failed: POST add_coverage → ${r.status} ${await r.text()}`);
}

/** The detail page's coverages table shows the part's value-object fields as
 *  columns (header and cell), not just its scalars. */
export async function judgePartTable(page, origin, id) {
  await page.goto(`${origin}/policies/${id}`);
  const card = page.locator('[data-testid="policies-detail-coverages"]').first();
  let text = "";
  for (let i = 0; i < 30; i++) {
    text = await card.innerText().catch(() => "");
    if (text.includes("COV-1")) break;
    await page.waitForTimeout(500);
  }
  const why = [];
  if (!text.includes("COV-1")) why.push("coverages: the part row never rendered");
  if (!/Limit Amount/i.test(text)) why.push("coverages: no Limit Amount column");
  if (!text.includes("777")) why.push(`coverages: the limit amount cell is missing (card text ${JSON.stringify(text.slice(0, 300))})`);
  return why;
}

/** The record stays open after an operation: the update dialog closes onto the
 *  same detail page, not the list. */
export function judgeStaysOnRecord(page, id) {
  const path = new URL(page.url()).pathname;
  return path === `/policies/${id}`
    ? []
    : [`after the update the page left the record: ${path}`];
}

/** A fresh create form shows no field error before the user touched anything. */
export async function judgeNoEarlyErrors(page, origin) {
  await page.goto(`${origin}/providers/new`);
  await page.locator('[data-testid="providers-new-submit"]').first().waitFor({ timeout: 20000 });
  const text = await page.locator("body").innerText().catch(() => "");
  return /invalid|required|must match/i.test(text)
    ? [`the create form shows errors before any touch: ${JSON.stringify(text.slice(0, 300))}`]
    : [];
}

/** A workflow whose start answers the created record's id opens that record. */
export async function judgeWorkflowOpensResult(page, origin) {
  await page.goto(`${origin}/workflows/open_provider`);
  await (await inputOf(page, "workflow-open_provider-input-name")).fill("From workflow");
  await page.locator('[data-testid="workflow-open_provider-submit"]').first().click();
  for (let i = 0; i < 30; i++) {
    if (/\/providers\/[0-9a-f-]{36}$/.test(new URL(page.url()).pathname)) return [];
    await page.waitForTimeout(500);
  }
  return [`the workflow run did not open the provider it created (at ${new URL(page.url()).pathname})`];
}
