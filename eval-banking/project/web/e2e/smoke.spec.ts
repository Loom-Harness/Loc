// Auto-generated smoke spec.
import { test, expect } from "./fixtures";

test("CustomerList loads", async ({ page }) => {
  await page.goto("/customers");
  await expect(page).toHaveURL(new RegExp("/customers$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("CustomerNew loads", async ({ page }) => {
  await page.goto("/customers/new");
  await expect(page).toHaveURL(new RegExp("/customers/new$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("AccountList loads", async ({ page }) => {
  await page.goto("/accounts");
  await expect(page).toHaveURL(new RegExp("/accounts$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("TransferList loads", async ({ page }) => {
  await page.goto("/transfers");
  await expect(page).toHaveURL(new RegExp("/transfers$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("InterestRunList loads", async ({ page }) => {
  await page.goto("/interest_runs");
  await expect(page).toHaveURL(new RegExp("/interest_runs$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("MonthlyInterestInstancesList loads", async ({ page }) => {
  await page.goto("/workflows/monthly_interest/instances");
  await expect(page).toHaveURL(new RegExp("/workflows/monthly_interest/instances$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("OpenAccountWorkflow loads", async ({ page }) => {
  await page.goto("/workflows/open_account");
  await expect(page).toHaveURL(new RegExp("/workflows/open_account$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("TransferWorkflow loads", async ({ page }) => {
  await page.goto("/workflows/transfer");
  await expect(page).toHaveURL(new RegExp("/workflows/transfer$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("RequestLargeTransferWorkflow loads", async ({ page }) => {
  await page.goto("/workflows/request_large_transfer");
  await expect(page).toHaveURL(new RegExp("/workflows/request_large_transfer$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("ApproveTransferWorkflow loads", async ({ page }) => {
  await page.goto("/workflows/approve_transfer");
  await expect(page).toHaveURL(new RegExp("/workflows/approve_transfer$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("Home loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp("/$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("WorkflowsIndex loads", async ({ page }) => {
  await page.goto("/workflows");
  await expect(page).toHaveURL(new RegExp("/workflows$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});
