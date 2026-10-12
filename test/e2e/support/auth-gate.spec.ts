// Shared runtime auth UI-gate smoke.  Copied into a generated SPA's emitted
// `e2e/` dir by test/e2e/auth-gate-ui-e2e.test.ts and run against `vite
// preview` (or `ng serve`/dist).  No backend: the session (`/auth/me`) and the
// Job read (`/jobs/:id`) are mocked via `page.route`, so the test exercises the
// REAL client-side gate evaluation (`currentUser.role === …`) for matching vs
// non-matching roles.  Identical across react/vue/svelte/angular — they share
// `src/auth/session.ts` (currentUser ← /auth/me), the `data-testid="nav-<slug>"`
// menu selectors, the "Forbidden"/"Admin Area" page text, and the "Approve"
// operation button.  Asserts all three gate sites: menu link, page guard, and
// operation action button.
import { expect, test } from "./fixtures";

// biome-ignore lint/suspicious/noExplicitAny: Playwright Route/Page typing kept loose for portability.
async function seed(page: any, role: string): Promise<void> {
  // Mock the verified session — AuthGate fetches this on mount; `role` drives
  // every gate.  Set BEFORE goto so the first render already sees the user.
  // Scope to the `/api/` base so the mock never shadows a same-named SPA page
  // route (e.g. the `/jobs/:id` page vs the `/api/jobs/:id` data call).
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Route typing kept loose for portability.
  await page.route("**/api/auth/me", (route: any) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "u1", role }),
    }),
  );
  // Mock the Job byId read so the `/jobs/:id` detail renders (and with it the
  // role-gated Approve button) without a real backend.
  //
  // The body must satisfy the EMITTED `JobResponse` zod schema, not just look
  // plausible.  `wireShape` puts `version` on every aggregate response, so a
  // payload without it fails `JobResponse.parse(r)`, the query goes to
  // `isError`, and the generated page renders that branch as `null` — a
  // completely BLANK page.  The Approve button is then missing for a reason
  // that has nothing to do with the role gate this file exists to test.
  //
  // That is exactly how this gate failed its first ever CI run: the mock
  // omitted `version`, so "visible for the matching role" failed while
  // "hidden for a non-matching role" PASSED VACUOUSLY on the same blank page.
  // Keep this in step with the wire shape; the toolbar assertion below is the
  // tripwire if it drifts again.
  //
  // biome-ignore lint/suspicious/noExplicitAny: Playwright Route typing kept loose for portability.
  await page.route("**/api/jobs/*", (route: any) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "1", title: "Job One", status: "new", version: 1 }),
    }),
  );
}

// ---- menu-link hiding -----------------------------------------------------

test("nav: admin sees the admin link, not the superadmin link", async ({ page }) => {
  await seed(page, "admin");
  await page.goto("/public");
  await expect(page.locator('[data-testid="nav-public"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-admin"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-super"]')).toHaveCount(0);
});

test("nav: superadmin sees the super link, not the admin link", async ({ page }) => {
  await seed(page, "superadmin");
  await page.goto("/public");
  await expect(page.locator('[data-testid="nav-super"]')).toBeVisible();
  await expect(page.locator('[data-testid="nav-admin"]')).toHaveCount(0);
});

// ---- page guard -----------------------------------------------------------

test("page guard: non-matching role gets Forbidden", async ({ page }) => {
  await seed(page, "viewer");
  await page.goto("/admin");
  await expect(page.getByText("Forbidden")).toBeVisible();
  await expect(page.getByText("Admin Area")).toHaveCount(0);
});

test("page guard: matching role sees the page", async ({ page }) => {
  await seed(page, "admin");
  await page.goto("/admin");
  await expect(page.getByText("Admin Area")).toBeVisible();
});

// ---- operation action button ---------------------------------------------

test("op button: hidden for a non-matching role", async ({ page }) => {
  await seed(page, "viewer");
  await page.goto("/jobs/1");
  // ANTI-VACUITY: assert the detail actually rendered first.  `toHaveCount(0)`
  // alone is satisfied by any page that fails to render — a schema-invalid mock,
  // a 500, a routing miss — so on its own it proves nothing about the role gate.
  // The toolbar is inside the QueryView's `data:` branch and every frontend
  // emits it with this role/label, so its presence means the read resolved and
  // the ONLY thing left to explain a missing button is the gate.
  //
  // ATTACHED, not VISIBLE: with the button correctly gated away the toolbar is
  // an EMPTY `<div role="toolbar">`, which collapses to zero size, so
  // `toBeVisible()` fails on exactly the state this case is asserting.  (Caught
  // by this guard's own first run.)  Presence in the DOM is the real claim.
  await expect(page.getByRole("toolbar", { name: "Actions" })).toBeAttached();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});

test("op button: visible for the matching role", async ({ page }) => {
  await seed(page, "admin");
  await page.goto("/jobs/1");
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
});
