// The LiveView authorization legs — the HEEx twin of what the REST routes and
// the SPA frontends already enforce.
//
// `run-heex-ui.mjs` copies this in as `heex-auth.spec.ts` next to the emitted
// spec and runs it against the booted Phoenix server.  Each principal is a
// browser context sending the dev stub's `x-loom-dev-claims` header; the
// dev-stub :browser pipeline (`DevBrowserAuth`) writes that principal into the
// session, so the LiveView mounts as it.
//
// What each leg proves, and what reverting the fix does to it:
//
//   - an adjuster's `triage` submit runs the NAMED operation: `severity` (an
//     `immutable` field the generic update cannot set) changes, and the op's
//     `emit` reaches the page as the realtime toast.  Dispatching the form
//     to `update_claim` instead leaves severity unchanged and emits nothing.
//   - a viewer's submit of the same form is refused by `requires`, and an
//     adjuster's submit on a Settled claim by the `when` gate.  Both are sent
//     as crafted LiveView events, because the rendered page hides / disables
//     the trigger: the server is what has to refuse them.
//   - the `setReserve` form renders its value-object param as plain inputs
//     and the submitted map reaches the op.
//   - a principal outside `policy { read Claim … }` gets the detail page's
//     error slot, not the record, on direct navigation.
//   - the workflow form runs `Escalate` as the session principal, so its
//     `requires` admits the adjuster and refuses the viewer.

import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:4000";

async function as(browser: Browser, role: string): Promise<Page> {
  const claims = Buffer.from(JSON.stringify({ role })).toString("base64");
  const context = await browser.newContext({
    baseURL: BASE,
    extraHTTPHeaders: { "x-loom-dev-claims": claims },
  });
  return context.newPage();
}

/** Wait for the LiveView socket: an event pushed before it joins is lost. */
async function connected(page: Page): Promise<void> {
  await page.locator("[data-phx-main].phx-connected").waitFor();
}

/** Create a claim through the scaffolded create form; returns its id. */
async function createClaim(page: Page, title: string): Promise<string> {
  await page.goto("/claims/new");
  await connected(page);
  await page.getByTestId("claims-new-input-title").fill(title);
  await page.getByTestId("claims-new-input-severity").fill("1");
  await page.getByTestId("claims-new-input-reserve-amount").fill("10");
  await page.getByTestId("claims-new-input-reserve-note").fill("initial");
  await page.getByTestId("claims-new-submit").click();
  await page.waitForURL(/\/claims\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

async function openDetail(page: Page, id: string): Promise<void> {
  await page.goto(`/claims/${id}`);
  await connected(page);
}

/** Submit `submit_<op>` with `fields` the way a crafted client would: a form
 *  inside the LiveView carrying `phx-submit`, whether or not the page renders
 *  (or enables) the operation's own trigger. */
async function craftedSubmit(
  page: Page,
  op: string,
  fields: Record<string, string>,
): Promise<void> {
  await page.evaluate(
    ({ op, fields }) => {
      const root = document.querySelector("[data-phx-main]")!;
      const form = document.createElement("form");
      form.id = `crafted-${op}`;
      form.setAttribute("phx-submit", `submit_${op}`);
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.name = `${op}[${name}]`;
        input.value = value;
        form.appendChild(input);
      }
      root.appendChild(form);
      // LiveView binds `submit` on the document; `requestSubmit` fires it
      // without needing a visible control.
      form.requestSubmit();
    },
    { op, fields },
  );
}

test.describe.configure({ mode: "serial" });

test("an adjuster's operation form runs the named op: the gate admits, the field changes, the event fires", async ({
  browser,
}) => {
  const page = await as(browser, "adjuster");
  const id = await createClaim(page, "Hail damage");
  await openDetail(page, id);
  await expect(page.getByTestId("claims-detail-severity")).toHaveText("1");

  await page.getByRole("button", { name: "Triage" }).first().click();
  await page.locator('#claim-op-triage-modal input[name="triage[severity]"]').fill("9");
  await page.locator("#claim-op-triage-modal").getByRole("button", { name: "Triage" }).click();

  await expect(page.getByTestId("claims-detail-severity")).toHaveText("9");
  await expect(page.getByText("Claim triaged").first()).toBeVisible();
});

test("a principal the op's `requires` refuses cannot run it by submitting the form event", async ({
  browser,
}) => {
  const adjuster = await as(browser, "adjuster");
  const id = await createClaim(adjuster, "Flood");

  const viewer = await as(browser, "viewer");
  await openDetail(viewer, id);
  // The viewer may READ the claim …
  await expect(viewer.getByTestId("claims-detail-title")).toHaveText("Flood");
  // … the page offers no Triage trigger …
  await expect(viewer.getByRole("button", { name: "Triage" })).toHaveCount(0);
  // … and the server refuses the submit anyway.
  await craftedSubmit(viewer, "triage", { severity: "7" });
  await expect(viewer.getByText(/Forbidden/).first()).toBeVisible();

  await openDetail(adjuster, id);
  await expect(adjuster.getByTestId("claims-detail-severity")).toHaveText("1");
});

test("an op whose `when` gate refuses the record's state is refused", async ({ browser }) => {
  const page = await as(browser, "adjuster");
  const id = await createClaim(page, "Theft");
  await openDetail(page, id);

  await page.getByRole("button", { name: "Settle" }).first().click();
  await page.locator("#claim-op-settle-modal").getByRole("button", { name: "Settle" }).click();
  await expect(page.getByTestId("claims-detail-status")).toHaveText("Settled");

  // Triage is `when status == Open`: its trigger is disabled now …
  await expect(page.getByRole("button", { name: "Triage" }).first()).toBeDisabled();
  // … and a submit is refused by the gate, not applied.
  await craftedSubmit(page, "triage", { severity: "8" });
  await expect(page.getByText(/not allowed in the current state/).first()).toBeVisible();
  await openDetail(page, id);
  await expect(page.getByTestId("claims-detail-severity")).toHaveText("1");
});

test("a value-object param's form submits the value object to the op", async ({ browser }) => {
  const page = await as(browser, "adjuster");
  const id = await createClaim(page, "Windstorm");
  await openDetail(page, id);

  await page.getByRole("button", { name: "Set Reserve" }).first().click();
  const modal = page.locator("#claim-op-set_reserve-modal");
  await modal.locator('input[name="set_reserve[reserve][amount]"]').fill("2500.5");
  await modal.locator('input[name="set_reserve[reserve][note]"]').fill("pending survey");
  await modal.getByRole("button", { name: "Set Reserve" }).click();

  await expect(page.getByText("pending survey")).toBeVisible();
  await expect(page.getByText("2500.5")).toBeVisible();
});

test("a principal outside the read policy gets no record on direct navigation", async ({
  browser,
}) => {
  const adjuster = await as(browser, "adjuster");
  const id = await createClaim(adjuster, "Confidential claim");

  const outsider = await as(browser, "clerk");
  await openDetail(outsider, id);
  await expect(outsider.getByTestId("claims-detail").getByRole("alert")).toBeVisible();
  await expect(outsider.getByTestId("claims-detail-title")).toHaveCount(0);
  await expect(outsider.getByText("Confidential claim")).toHaveCount(0);
});

test("a workflow form runs the workflow as the session principal", async ({ browser }) => {
  const adjuster = await as(browser, "adjuster");
  await adjuster.goto("/workflows/escalate");
  await connected(adjuster);
  await adjuster.getByTestId("workflow-escalate-input-title").fill("Escalated roof");
  await adjuster.getByTestId("workflow-escalate-submit").click();
  await expect(adjuster.getByText("Escalate started").first()).toBeVisible();
  await adjuster.goto("/claims");
  await expect(adjuster.getByText("Escalated roof").first()).toBeVisible();

  const viewer = await as(browser, "viewer");
  await viewer.goto("/workflows/escalate");
  await connected(viewer);
  await viewer.getByTestId("workflow-escalate-input-title").fill("Not allowed");
  await viewer.getByTestId("workflow-escalate-submit").click();
  await expect(viewer.getByText(/Forbidden/).first()).toBeVisible();
});
