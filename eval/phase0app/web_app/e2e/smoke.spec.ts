// Auto-generated smoke spec.
import { test, expect } from "./fixtures";

test("ProjectList loads", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(new RegExp("/projects$"));
});

test("ProjectNew loads", async ({ page }) => {
  await page.goto("/projects/new");
  await expect(page).toHaveURL(new RegExp("/projects/new$"));
});

test("TaskList loads", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(new RegExp("/tasks$"));
});

test("TaskNew loads", async ({ page }) => {
  await page.goto("/tasks/new");
  await expect(page).toHaveURL(new RegExp("/tasks/new$"));
});

test("Home loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp("/$"));
});
