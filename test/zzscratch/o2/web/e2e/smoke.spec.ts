// Auto-generated smoke spec.
import { test, expect } from "./fixtures";

test("Home loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp("/$"));
  // The route's lazy page chunk has loaded (its Suspense fallback is gone).
  await expect(page.getByTestId("route-loading")).toHaveCount(0);
  // The app mounted rather than crashing into its root error boundary.
  await expect(page.getByTestId("app-error")).toHaveCount(0);
});
