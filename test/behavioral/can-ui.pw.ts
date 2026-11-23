// The permission query, clicked: an operation with one is disabled while its
// gates refuse; an operation without one stays enabled and its submit answers.
//
// Copied into the GENERATED frontend's `e2e/` dir by `can-ui.mjs` (as
// `can-ui.spec.ts`) and run against the one-origin stack — built React bundle
// + generated Hono backend on PGlite.  The fixture is `can-ui.ddd`:
//   - `close()` gates on `when !closed` only, so the detail page asks
//     `GET /tickets/{id}/can_close` and disables Close once the ticket closes;
//   - `reassign(to)` gates on `requires to != owner`, which reads its
//     parameter, so it has no permission query: Reassign is never disabled,
//     and its submit answers 403 (the `requires`) or 409 (the `when`).
//
// Hand-authored because the `test e2e` DSL has no verb for "this trigger is
// disabled".

import { expect, test } from "./fixtures";

async function createTicket(page: import("@playwright/test").Page): Promise<string> {
  const res = await page.request.post("/api/tickets", {
    data: { title: "Printer", owner: "ann" },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).id as string;
}

test("an operation with a permission query is disabled while its gate refuses", async ({
  page,
}) => {
  const id = await createTicket(page);
  await page.goto(`/tickets/${id}`);
  const close = page.getByTestId("tickets-op-close");
  await expect(close).toBeEnabled();

  await close.click();
  await page.getByTestId("tickets-op-close-submit").click();
  await expect(page.getByTestId("tickets-detail-closed")).toContainText("Yes");
  // The query now answers `{ allowed: false }`.
  await expect(close).toBeDisabled();
});

test("an operation without a permission query stays enabled and its submit answers", async ({
  page,
}) => {
  const asked: string[] = [];
  page.on("request", (r) => {
    if (/\/can_reassign\b/.test(r.url())) asked.push(r.url());
  });
  const id = await createTicket(page);
  await page.goto(`/tickets/${id}`);
  const reassign = page.getByTestId("tickets-op-reassign");
  await expect(reassign).toBeEnabled();

  // The `requires` reads the argument: reassigning to the owner is refused.
  await reassign.click();
  await page.getByTestId("tickets-op-reassign-input-to").fill("ann");
  await page.getByTestId("tickets-op-reassign-submit").click();
  await expect(page.getByText(/Forbidden/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tickets-detail-owner")).toContainText("ann");

  // Close the ticket: Reassign is still enabled, and the `when` answers 409.
  const close = await page.request.post(`/api/tickets/${id}/close`, { data: {} });
  expect(close.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId("tickets-detail-closed")).toContainText("Yes");
  await expect(reassign).toBeEnabled();
  await reassign.click();
  await page.getByTestId("tickets-op-reassign-input-to").fill("bob");
  await page.getByTestId("tickets-op-reassign-submit").click();
  await expect(page.getByText(/not allowed/i).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tickets-detail-owner")).toContainText("ann");

  // The page never asked a permission query for it.
  expect(asked).toEqual([]);
});
