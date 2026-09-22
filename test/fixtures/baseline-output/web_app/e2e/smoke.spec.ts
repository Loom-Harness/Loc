// Auto-generated smoke spec.
import { test, expect } from "./fixtures";

test("ProductList loads", async ({ page }) => {
  await page.goto("/products");
  await expect(page).toHaveURL(new RegExp("/products$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("ProductNew loads", async ({ page }) => {
  await page.goto("/products/new");
  await expect(page).toHaveURL(new RegExp("/products/new$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("OrderList loads", async ({ page }) => {
  await page.goto("/orders");
  await expect(page).toHaveURL(new RegExp("/orders$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("OrderNew loads", async ({ page }) => {
  await page.goto("/orders/new");
  await expect(page).toHaveURL(new RegExp("/orders/new$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("PlaceOrderWorkflow loads", async ({ page }) => {
  await page.goto("/workflows/place_order");
  await expect(page).toHaveURL(new RegExp("/workflows/place_order$"));
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

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
