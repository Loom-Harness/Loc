// Auto-generated smoke spec.
import { test, expect } from "./fixtures";

test("OrganizationList loads", async ({ page }) => {
  await page.goto("/organizations");
  await expect(page).toHaveURL(new RegExp("/organizations$"));
});

test("OrganizationNew loads", async ({ page }) => {
  await page.goto("/organizations/new");
  await expect(page).toHaveURL(new RegExp("/organizations/new$"));
});

test("CustomerList loads", async ({ page }) => {
  await page.goto("/customers");
  await expect(page).toHaveURL(new RegExp("/customers$"));
});

test("CustomerNew loads", async ({ page }) => {
  await page.goto("/customers/new");
  await expect(page).toHaveURL(new RegExp("/customers/new$"));
});

test("SiteList loads", async ({ page }) => {
  await page.goto("/sites");
  await expect(page).toHaveURL(new RegExp("/sites$"));
});

test("SiteNew loads", async ({ page }) => {
  await page.goto("/sites/new");
  await expect(page).toHaveURL(new RegExp("/sites/new$"));
});

test("AssetList loads", async ({ page }) => {
  await page.goto("/assets");
  await expect(page).toHaveURL(new RegExp("/assets$"));
});

test("AssetNew loads", async ({ page }) => {
  await page.goto("/assets/new");
  await expect(page).toHaveURL(new RegExp("/assets/new$"));
});

test("TechnicianList loads", async ({ page }) => {
  await page.goto("/technicians");
  await expect(page).toHaveURL(new RegExp("/technicians$"));
});

test("TechnicianNew loads", async ({ page }) => {
  await page.goto("/technicians/new");
  await expect(page).toHaveURL(new RegExp("/technicians/new$"));
});

test("PartList loads", async ({ page }) => {
  await page.goto("/parts");
  await expect(page).toHaveURL(new RegExp("/parts$"));
});

test("PartNew loads", async ({ page }) => {
  await page.goto("/parts/new");
  await expect(page).toHaveURL(new RegExp("/parts/new$"));
});

test("WorkOrderList loads", async ({ page }) => {
  await page.goto("/work_orders");
  await expect(page).toHaveURL(new RegExp("/work_orders$"));
});

test("WorkOrderNew loads", async ({ page }) => {
  await page.goto("/work_orders/new");
  await expect(page).toHaveURL(new RegExp("/work_orders/new$"));
});

test("InvoiceList loads", async ({ page }) => {
  await page.goto("/invoices");
  await expect(page).toHaveURL(new RegExp("/invoices$"));
});

test("InvoiceNew loads", async ({ page }) => {
  await page.goto("/invoices/new");
  await expect(page).toHaveURL(new RegExp("/invoices/new$"));
});

test("Home loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp("/$"));
});
