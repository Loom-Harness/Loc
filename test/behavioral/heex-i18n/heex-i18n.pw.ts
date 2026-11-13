// The Phoenix translated-locale leg: the rendered LiveView under `fr-FR`.
//
// `run-heex-ui.mjs i18n` copies this in as `heex-i18n.spec.ts` beside the
// emitted page objects and runs it against the booted Phoenix app.  The
// generator-level tests pin the emitted `pgettext` / `loom_icu` / `loom_date`
// calls; they cannot say the French sentence reaches a screen — a catalog key
// the `.po` lacks, a CLDR locale the backend did not compile, a Decimal the ICU
// step rejects, or a `Calendar.strftime` left in place all emit and compile
// fine and render English or ISO.  So every probe reads the TRANSLATED text off
// the DOM.
//
// The seed goes through the generated REST API (the same app serves it), then
// the `reprice` operation writes the provenanced field so the page has a
// lineage to disclose.

import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4111";

/** Replace the no-break / narrow no-break spaces CLDR puts between a number and
 *  its currency sign with a plain space, so the assertions read naturally. */
const plain = (s: string): string => s.replace(/[  ]/g, " ");

let invoiceId = "";

/** Poll a cheap GET until it answers 2xx — a freshly booted server can reset the
 *  first connection (`SocketError: other side closed`) before it is warm. */
async function waitReady(path: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}${path}`);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = String((e as Error)?.cause ?? e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `server not ready: GET ${path} did not return 2xx within ${timeoutMs}ms (last: ${last})`,
  );
}

test.beforeAll(async () => {
  await waitReady("/api/invoices");
  const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status >= 300) throw new Error(`seed POST ${path} -> ${res.status}: ${text}`);
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  };
  const invoice = await post("/api/invoices", {
    label: "INV-1",
    amount: "12.50",
    issuedOn: "2026-03-04",
    total: 0,
  });
  invoiceId = String(invoice.id);
  await post(`/api/invoices/${invoiceId}/reprice`, {});
});

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });

  test("the titled page's nav link and the menu section read the fr catalog", async ({ page }) => {
    await page.goto(`${BASE}/price`);
    const nav = page.getByTestId("sidebar");
    await expect(nav.getByRole("link", { name: "Tarifs" })).toBeVisible();
    await expect(nav).toContainText("Principal");
    await expect(nav.getByRole("link", { name: "Pricing" })).toHaveCount(0);
  });

  test("an ICU money hole renders the amount in French currency format", async ({ page }) => {
    await page.goto(`${BASE}/invoices/${invoiceId}`);
    await expect(page.locator("body")).toContainText("Montant total", { timeout: 15_000 });
    expect(plain(await page.locator("body").innerText())).toContain("Montant total : 12,50 €");
  });

  test("DateDisplay renders the date in the negotiated locale", async ({ page }) => {
    await page.goto(`${BASE}/invoices/${invoiceId}`);
    const time = page.locator("time").first();
    await expect(time).toHaveText(/4\s+mars\s+2026/, { timeout: 15_000 });
    // The machine-readable value stays ISO.
    await expect(time).toHaveAttribute("datetime", "2026-03-04");
  });

  test("the ProvenanceInfo disclosure and the op button read the fr catalog", async ({ page }) => {
    await page.goto(`${BASE}/invoices/${invoiceId}`);
    await expect(page.getByRole("button", { name: /recalculer/i })).toBeVisible({
      timeout: 15_000,
    });
    const details = page.locator("details.loom-provenance");
    await expect(details.locator("summary")).toHaveAttribute(
      "aria-label",
      "Comment cette valeur a été calculée",
    );
    const text = (await details.textContent()) ?? "";
    expect(text).toContain("Règle");
    expect(text).toContain("Valeur");
    expect(text).not.toMatch(/\bRule\b|\bValue\b/);
  });
});

test.describe("en-US control", () => {
  test.use({ locale: "en-US" });

  test("the same page under en-US keeps the source language", async ({ page }) => {
    await page.goto(`${BASE}/invoices/${invoiceId}`);
    await expect(page.locator("body")).toContainText("Total", { timeout: 15_000 });
    const body = plain(await page.locator("body").innerText());
    expect(body).toContain("Total €12.50");
    expect(body).not.toContain("Montant total");
    await expect(page.locator("time").first()).toHaveText(/Mar 4, 2026/);
    await expect(page.locator("details.loom-provenance summary")).toHaveAttribute(
      "aria-label",
      "How this value was computed",
    );
  });
});
