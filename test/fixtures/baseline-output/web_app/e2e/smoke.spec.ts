// Auto-generated smoke spec.
import { test, expect } from "./fixtures";

test("ProductList loads", async ({ page }) => {
  await page.goto("/products");
  await expect(page).toHaveURL(new RegExp("/products$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("ProductNew loads", async ({ page }) => {
  await page.goto("/products/new");
  await expect(page).toHaveURL(new RegExp("/products/new$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("OrderList loads", async ({ page }) => {
  await page.goto("/orders");
  await expect(page).toHaveURL(new RegExp("/orders$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("OrderNew loads", async ({ page }) => {
  await page.goto("/orders/new");
  await expect(page).toHaveURL(new RegExp("/orders/new$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("PlaceOrderWorkflow loads", async ({ page }) => {
  await page.goto("/workflows/place_order");
  await expect(page).toHaveURL(new RegExp("/workflows/place_order$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("CustomerList loads", async ({ page }) => {
  await page.goto("/customers");
  await expect(page).toHaveURL(new RegExp("/customers$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("CustomerNew loads", async ({ page }) => {
  await page.goto("/customers/new");
  await expect(page).toHaveURL(new RegExp("/customers/new$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("Home loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp("/$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});

test("WorkflowsIndex loads", async ({ page }) => {
  await page.goto("/workflows");
  await expect(page).toHaveURL(new RegExp("/workflows$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});
