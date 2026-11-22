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
//   rows             a value-object row renders each field's own input: the
//                    seeded row keeps its enum, reference and flag through an
//                    update, and an added row saves its defaults (first enum
//                    value, unchecked flag, unset reference as null).
//   detail arrays    the Detail page shows the record's array fields.
//   untouched submit a create form submitted untouched sends each required
//                    field's zero (`""`, `0`, `"0"`) and the server keeps it.
//   blank reference  a create form whose required reference is unpicked sends
//                    nothing.
//   blank rule       a rule on a required field judges its blank: the create
//                    form sends nothing and shows the rule's message.
//   typed text       (P-UI-5, P-UI-6) a `Meter` create form typed `12abc` /
//                    `abc` sends nothing, keeps the text and shows a message;
//                    retyped `42` / `120.50` it sends those values, and its
//                    optional number and amount left blank arrive as null.
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
    riders: [{ code: "R1", premium: 2.5, peril: "Flood", insurer: provider.id, waived: true }],
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
  await page.goto(`${origin}/policies/new`);
  await page.locator('[data-testid="policies-new-submit"]').first().waitFor({ timeout: 20000 });
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

/** Add a rider row through the Update dialog, filling only its text inputs: the
 *  row's enum starts on its first value, its bool unchecked and its optional
 *  reference unset. */
export async function driveAddRider(page, origin, id) {
  await page.goto(`${origin}/policies/${id}`);
  await page.locator('[data-testid="policies-op-update"]').first().click({ timeout: 20000 });
  await (await inputOf(page, "policies-op-update-input-riders-0-code")).waitFor();
  const widgets = await judgeRowWidgets(page);
  await page.getByRole("button", { name: /Add Rider/i }).first().click({ timeout: 15000 });
  await (await inputOf(page, "policies-op-update-input-riders-1-code")).fill("R2");
  await (await inputOf(page, "policies-op-update-input-riders-1-premium")).fill("4");
  await page.locator('[data-testid="policies-op-update-submit"]').first().click();
  return widgets;
}

const CHOICE = 'select, [role="combobox"], [aria-haspopup="listbox"]';
const TOGGLE = 'input[type="checkbox"], [role="switch"], [role="checkbox"]';

/** A row's enum and reference fields are choice controls and its bool a
 *  toggle — the inputs the same fields get at the top level, not text boxes. */
async function judgeRowWidgets(page) {
  const why = [];
  const cells = [
    ["peril", CHOICE],
    ["insurer", CHOICE],
    ["waived", TOGGLE],
  ];
  for (const [sub, want] of cells) {
    const ok = await page
      .locator(
        `[data-testid="policies-op-update-input-riders-0-${sub}"], [data-testid="policies-op-update-riders-row-input-${sub}"]`,
      )
      .first()
      .evaluate((el, sel) => el.matches(sel) || el.querySelector(sel) !== null, want)
      .catch(() => false);
    if (!ok) why.push(`riders row ${sub}: not rendered as its field's input (${want})`);
  }
  return why;
}

/** Judge the record after the rider row was added: the seeded row kept its
 *  enum, reference and flag, and the new one saved its row defaults. */
export function judgeRiderAdded(before, after) {
  const why = [];
  const rows = after.riders ?? [];
  if (rows.length !== 2) return [`riders: expected 2 rows, got ${JSON.stringify(rows)}`];
  const [kept, added] = rows;
  const seeded = before.riders[0];
  if (kept.peril !== seeded.peril || kept.insurer !== seeded.insurer || kept.waived !== seeded.waived) {
    why.push(`riders[0]: the row lost its values (${JSON.stringify(seeded)} → ${JSON.stringify(kept)})`);
  }
  if (added.code !== "R2" || Number(added.premium) !== 4) {
    why.push(`riders[1]: the typed values did not save, got ${JSON.stringify(added)}`);
  }
  if (added.peril !== "Fire") why.push(`riders[1].peril: expected the first value, got ${JSON.stringify(added.peril)}`);
  if (added.waived !== false) why.push(`riders[1].waived: expected false, got ${JSON.stringify(added.waived)}`);
  if (added.insurer !== null && added.insurer !== undefined) {
    why.push(`riders[1].insurer: an unset reference must submit null, got ${JSON.stringify(added.insurer)}`);
  }
  return why;
}

/** The Detail page shows the record's array fields: the joined strings, the
 *  enum items and the value-object rows, each where its test id says. */
export async function judgeDetailCollections(page, origin, id) {
  const record = await readPolicy(origin, id);
  await page.goto(`${origin}/policies/${id}`);
  const why = [];
  const expect = [
    ["policies-detail-tags", record.tags.join(", ")],
    ["policies-detail-perils", record.perils[0]],
    ["policies-detail-riders", record.riders[0].code],
  ];
  for (const [testId, text] of expect) {
    const el = page.locator(`[data-testid="${testId}"]`).first();
    const shown = await el
      .waitFor({ state: "attached", timeout: 15000 })
      .then(() => el.innerText())
      .catch(() => "(absent)");
    if (!shown.includes(text)) {
      why.push(`${testId}: the detail page shows ${JSON.stringify(shown)}, not "${text}"`);
    }
  }
  return why;
}

/** An event-sourced aggregate's create form asks for its `create` action's
 *  params alone (`owner`), not the folded state (`balance`), and submitting it
 *  opens an account the fold reads back. */
export async function judgeEventSourcedCreate(page, origin) {
  const owner = "Event-sourced Ada";
  await page.goto(`${origin}/accounts/new`);
  await (await inputOf(page, "accounts-new-input-owner")).fill(owner);
  const why = [];
  const stray = await page.locator('[data-testid^="accounts-new-input-balance"]').count();
  if (stray > 0) why.push("accounts create form renders `balance`, which the create command does not take");
  await page.locator('[data-testid="accounts-new-submit"]').first().click();
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${origin}/api/accounts`);
    const body = r.ok ? await r.json() : null;
    const rows = Array.isArray(body) ? body : (body?.items ?? []);
    const hit = rows.find((a) => a.owner === owner);
    if (hit) {
      if (hit.balance !== 0) why.push(`the created account folded balance ${JSON.stringify(hit.balance)}, expected 0`);
      return why;
    }
    await page.waitForTimeout(500);
  }
  why.push(`submitting the accounts create form opened no account owned by ${JSON.stringify(owner)}`);
  return why;
}

/** Every row of a collection, read over the api. */
export async function listRows(origin, collection) {
  const r = await fetch(`${origin}/api/${collection}`);
  if (!r.ok) throw new Error(`GET /${collection} → ${r.status}`);
  const body = await r.json();
  return Array.isArray(body) ? body : (body?.items ?? []);
}

/** What an untouched `Tally` create form must have sent: every required field
 *  is a value — text `""`, a number `0`, money `"0"` — and the server kept it. */
export const UNTOUCHED_TALLY = { label: "", count: 0, amount: "0" };

/** Poll for a tally created after `before` (the ids seen before the submit)
 *  and judge it against {@link UNTOUCHED_TALLY}. */
export async function judgeUntouchedTally(origin, before, wait) {
  for (let i = 0; i < 30; i++) {
    const created = (await listRows(origin, "tallies")).filter((t) => !before.has(t.id));
    if (created.length > 0) {
      const row = created[0];
      const got = { label: row.label, count: row.count, amount: row.amount };
      return JSON.stringify(normalize(got)) === JSON.stringify(normalize(UNTOUCHED_TALLY))
        ? []
        : [`untouched tally: expected ${JSON.stringify(UNTOUCHED_TALLY)}, the server holds ${JSON.stringify(got)}`];
    }
    await wait(500);
  }
  return ["untouched tally: submitting the untouched create form created no tally"];
}

/** Submit the `Tally` create form untouched: a blank required field is a value
 *  the form sends, so the server receives `{ label: "", count: 0, amount: "0" }`. */
export async function judgeUntouchedCreate(page, origin) {
  const before = new Set((await listRows(origin, "tallies")).map((t) => t.id));
  await page.goto(`${origin}/tallies/new`);
  const submit = page.locator('[data-testid="tallies-new-submit"]').first();
  await submit.waitFor({ timeout: 20000 });
  // Forced: a form that wrongly disables its submit then sends nothing, and the
  // verdict below names that instead of a click timeout.
  await submit.click({ force: true, timeout: 5000 }).catch(() => {});
  return judgeUntouchedTally(origin, before, (ms) => page.waitForTimeout(ms));
}

/** Judge the requests a `Claim` create form sent while its required reference
 *  was unpicked: none may reach the server, and no claim may exist. */
export async function judgeNothingPosted(origin, posts) {
  const why = [];
  if (posts.length > 0) {
    why.push(`blank reference: the claims create form sent ${posts.join(", ")} with no provider picked`);
  }
  const rows = await listRows(origin, "claims");
  if (rows.length > 0) why.push(`blank reference: a claim was created: ${JSON.stringify(rows[0])}`);
  return why;
}

/** Submit the `Claim` create form without picking its required `provider`: the
 *  form holds the submit, so nothing reaches the server. */
export async function judgeBlankReference(page, origin) {
  const posts = [];
  const record = (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/claims")) {
      posts.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  };
  page.on("request", record);
  try {
    await page.goto(`${origin}/claims/new`);
    const submit = page.locator('[data-testid="claims-new-submit"]').first();
    await submit.waitFor({ timeout: 20000 });
    // A frontend that disables the button while the form is invalid leaves
    // nothing to click; one that validates on submit refuses the click's POST.
    await submit.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);
  } finally {
    page.off("request", record);
  }
  return judgeNothingPosted(origin, posts);
}

/** The text a `Badge` code's `length >= 2` rule shows, on every frontend. */
export const BLANK_RULE_MESSAGE = /at least 2/i;

/** Judge a `Badge` create form submitted blank: the rule refused it, so no
 *  request reached the server, no badge exists, and the page shows the rule's
 *  message. */
export async function judgeBlankRuleRefused(origin, posts, pageText) {
  const why = [];
  if (posts.length > 0) {
    why.push(`blank rule: the badges create form sent ${posts.join(", ")} with a blank code`);
  }
  const rows = await listRows(origin, "badges");
  if (rows.length > 0) why.push(`blank rule: a badge was created: ${JSON.stringify(rows[0])}`);
  if (!BLANK_RULE_MESSAGE.test(pageText)) {
    why.push(`blank rule: the rule's message is not shown (page text ${JSON.stringify(pageText.slice(0, 300))})`);
  }
  return why;
}

/** Submit the `Badge` create form with its required `code` blank: the
 *  `code.length >= 2` rule judges the blank, so nothing reaches the server. */
export async function judgeBlankRule(page, origin) {
  const posts = [];
  const record = (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/badges")) {
      posts.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  };
  page.on("request", record);
  try {
    await page.goto(`${origin}/badges/new`);
    // Touch the field (a frontend shows a field's message once it is blurred),
    // then submit.
    const code = await inputOf(page, "badges-new-input-code");
    await code.click();
    await code.press("Tab");
    const submit = page.locator('[data-testid="badges-new-submit"]').first();
    await submit.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);
  } finally {
    page.off("request", record);
  }
  const text = await page.locator("body").innerText().catch(() => "");
  return judgeBlankRuleRefused(origin, posts, text);
}

/** The texts the refused `12abc` / `abc` show, on every frontend: the catalog
 *  English of the wire codes the server answers for the same values, the
 *  amount's naming the typed text. */
export const TYPED_TEXT_MESSAGES = ["Invalid value", "Invalid decimal abc"];

/** Judge a `Meter` create form after the refused submit: nothing was sent, the
 *  typed text is still in its input, and the refusal is shown. */
export function judgeTypedRefused(posts, kept, pageText) {
  const why = [];
  if (posts.length > 0) why.push(`typed text: the meters create form sent ${posts.join(", ")} for "12abc" / "abc"`);
  for (const [field, want, got] of kept) {
    if (got !== want) why.push(`typed text: the ${field} input no longer holds ${JSON.stringify(want)} (holds ${JSON.stringify(got)})`);
  }
  for (const message of TYPED_TEXT_MESSAGES) {
    if (!pageText.includes(message)) {
      why.push(`typed text: the refusal "${message}" is not shown (page text ${JSON.stringify(pageText.slice(0, 400))})`);
    }
  }
  return why;
}

/** What a create form shows in place of a field whose default the server fills. */
export const SET_WHEN_SAVED = "set when saved";

/** Judge the server-filled `readAt` of the meter the create form saved: the
 *  form sent it absent (no key in the create body) and the server applied its
 *  `now()` default. */
export function judgeServerFilled(row, posts) {
  const why = [];
  const create = posts.find((p) => p.startsWith("POST /api/meters "));
  if (create?.includes('"readAt"')) why.push(`set when saved: the create form sent readAt (${create})`);
  if (!row || typeof row.readAt !== "string" || Number.isNaN(Date.parse(row.readAt))) {
    why.push(`set when saved: the server holds readAt ${JSON.stringify(row?.readAt)}, not its now() default`);
  }
  return why;
}

/** Judge the meter the corrected create form saved: the typed values. */
export function judgeTypedSent(row) {
  if (!row) return ["typed text: the corrected meters create form created no meter"];
  const why = [];
  if (row.reading !== 42) why.push(`typed text: reading should be 42, the server holds ${JSON.stringify(row.reading)}`);
  if (Number(row.fee) !== 120.5) why.push(`typed text: fee should be 120.50, the server holds ${JSON.stringify(row.fee)}`);
  return why;
}

/** Judge the meter after its optional fields were cleared in the update
 *  dialog: each is absent, and the required ones kept their values. */
export function judgeBlankOptional(row) {
  const why = [];
  for (const k of ["rate", "spare", "surcharge"]) {
    if (row[k] !== null && row[k] !== undefined) {
      why.push(`blank optional: ${k} cleared must be sent absent, the server holds ${JSON.stringify(row[k])}`);
    }
  }
  if (row.reading !== 42) why.push(`blank optional: reading changed to ${JSON.stringify(row.reading)}`);
  return why;
}

/** Drive the `Meter` forms: the create form with refused text, then with
 *  corrected text; then the update dialog clearing the optional fields. */
export async function judgeTypedText(page, origin) {
  const posts = [];
  const record = (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.startsWith("/api/meters")) {
      posts.push(`${r.method()} ${new URL(r.url()).pathname} ${r.postData() ?? ""}`);
    }
  };
  page.on("request", record);
  let row;
  try {
    await page.goto(`${origin}/meters/new`);
    const reading = await inputOf(page, "meters-new-input-reading");
    const fee = await inputOf(page, "meters-new-input-fee");
    const opened = await page.locator("body").innerText().catch(() => "");
    if (!opened.includes(SET_WHEN_SAVED)) {
      return [`set when saved: the meters create form does not show "${SET_WHEN_SAVED}" for readAt`];
    }
    await reading.fill("12abc");
    await fee.fill("abc");
    await fee.press("Tab");
    const submit = page.locator('[data-testid="meters-new-submit"]').first();
    await submit.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const kept = [
      ["reading", "12abc", await reading.inputValue().catch(() => "(gone)")],
      ["fee", "abc", await fee.inputValue().catch(() => "(gone)")],
    ];
    const text = await page.locator("body").innerText().catch(() => "");
    const refused = judgeTypedRefused([...posts], kept, text);
    if (refused.length > 0) return refused;
    const before = new Set((await listRows(origin, "meters")).map((m) => m.id));
    await reading.fill("42");
    await fee.fill("120.50");
    await fee.press("Tab");
    await submit.click({ force: true, timeout: 5000 }).catch(() => {});
    for (let i = 0; i < 30 && !row; i++) {
      row = (await listRows(origin, "meters")).find((m) => !before.has(m.id));
      if (!row) await page.waitForTimeout(500);
    }
    const sent = [...judgeTypedSent(row), ...judgeServerFilled(row, posts)];
    if (sent.length > 0) return sent;
  } finally {
    page.off("request", record);
  }
  // Give the optional fields values over the api, then clear them in the
  // update dialog.
  const put = await fetch(`${origin}/api/meters/${row.id}/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reading: 42, fee: "120.50", rate: 2.5, spare: 3, surcharge: "1.25" }),
  });
  if (!put.ok) return [`blank optional: seeding the optional fields failed: POST update → ${put.status} ${await put.text()}`];
  await page.goto(`${origin}/meters/${row.id}`);
  await page.locator('[data-testid="meters-op-update"]').first().click({ timeout: 20000 });
  for (const f of ["rate", "spare", "surcharge"]) {
    await (await inputOf(page, `meters-op-update-input-${f}`)).fill("");
  }
  await page.locator('[data-testid="meters-op-update-submit"]').first().click();
  let after = row;
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${origin}/api/meters/${row.id}`);
    after = r.ok ? await r.json() : after;
    if (after.rate === null || after.rate === undefined) break;
    await page.waitForTimeout(500);
  }
  return judgeBlankOptional(after);
}
