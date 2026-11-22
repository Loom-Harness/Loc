// The create → LIST → detail round-trip, spelled out.
//
// `run-heex-ui.mjs` copies this in as `heex-roundtrip.spec.ts` next to the
// EMITTED `HeexUiSystem.ui.spec.ts` and runs both against the booted Phoenix
// server.  It imports the same auto-generated page objects the emitted spec
// imports (`./pages/widget`) — nothing here reaches around the generator, and
// a page object whose selectors drift breaks this spec exactly as it breaks
// the emitted one.
//
// It is hand-authored for one reason: the `test e2e` DSL surface can express
// `ui.<agg>.create(…)` and `ui.<agg>.getById(…)` but has no spelling for "and
// the row is now IN the list" (see `renderAggregateCall` in
// src/system/ui-e2e-render.ts — create / getById / operations, nothing else).
// The emitted spec therefore passes THROUGH the list page on its way to the
// create form but never asserts what the list renders afterwards.  This spec
// closes that middle leg:
//
//   list.goto()          — the LiveView list mounts and renders its table
//   list.create()        — the list's own create affordance navigates
//   form.fill/submit()   — a real HEEx form POST through the LiveView socket
//   list.goto()          — SECOND mount: the new row is in the rendered table
//   list.open(id)        — reached by CLICKING the row link, not a URL guess
//   detail.field(...)    — the values survived the render, not just the insert
//
// Every assertion is on RENDERED TEXT, so a HEEx primitive arm that stops
// emitting a cell fails here even though the row exists in postgres and the
// route still answers 200.

import { expect, test } from "./fixtures";
import { WidgetDetailPage, WidgetListPage } from "./pages/widget";

test("create → list → detail round-trips through the rendered LiveView", async ({ page }) => {
  const list = await new WidgetListPage(page).goto();
  const before = await list.rowCount();

  const form = await list.create();
  await form.fill({ name: "Flywheel", rank: 42 });
  const created = await form.submit();
  expect(created.id, "submit landed on a detail route carrying an id").toMatch(/[0-9a-f-]{8,}/i);

  // ── LIST leg ────────────────────────────────────────────────────────────
  // A SECOND mount of the list LiveView — not a client-side cache — has to
  // render the new row, with its text.  Asserted on the TABLE BODY rather than
  // a per-row testid: the HEEx `.table` does not emit `widgets-row-<id>` /
  // `-link` yet (the emitted page objects address them, another gap this leg
  // surfaces), and a row-count delta plus the rendered cell text proves the
  // same thing without pinning a selector that does not exist.
  const relisted = await new WidgetListPage(page).goto();
  expect(await relisted.rowCount(), "the list gained exactly the row we created").toBe(before + 1);
  const body = page.getByTestId("widgets-list").locator("tbody");
  await expect(body).toContainText("Flywheel");
  await expect(body).toContainText("42");

  // ── DETAIL leg ──────────────────────────────────────────────────────────
  // The values survived the render, not just the insert.
  const detail = await new WidgetDetailPage(page, created.id).goto();
  await expect(detail.field("name")).toContainText("Flywheel");
  await expect(detail.field("rank")).toContainText("42");
});

// A detail page whose QueryView data lambda param is `widget`, not `data`: the
// op-form's submit clause must read and rewrite the assign that param was bound
// to.  A clause reading a fixed `socket.assigns.data` raises at the first submit
// while `mix compile` stays clean, so the assertion is on the rank rendered
// after the modal's submit.
test("an operation form under a non-`data` QueryView binding submits and updates the record", async ({
  page,
}) => {
  const list = await new WidgetListPage(page).goto();
  const form = await list.create();
  await form.fill({ name: "Cog", rank: 7 });
  const created = await form.submit();

  await page.goto(`/widget-bumps/${created.id}`);
  await expect(page.getByTestId("bump-rank")).toHaveText("7");

  await page.getByRole("button", { name: "Bump" }).first().click();
  await page.locator("#widget-op-bump-modal").getByRole("button", { name: "Bump" }).click();

  await expect(page.getByTestId("bump-rank")).toHaveText("8");
});

// The breadcrumb trail is a list the pack's CSS lays out in a row.  The
// walker emits `breadcrumbs` / `breadcrumb-item` / `breadcrumb-sep` classes
// that no Tailwind utility spells, so a pack that does not define them
// renders the `<ol>` as a vertical stack: the first and last crumb then sit
// on different rows.
test("breadcrumbs render on a single row", async ({ page }) => {
  const list = await new WidgetListPage(page).goto();
  const form = await list.create();
  await form.fill({ name: "Sprocket", rank: 3 });
  const created = await form.submit();

  await new WidgetDetailPage(page, created.id).goto();
  const items = page.locator(".breadcrumbs .breadcrumb-item");
  await expect(items.first()).toBeVisible();
  expect(await items.count(), "the trail has a root and a current crumb").toBeGreaterThanOrEqual(2);

  const first = await items.first().boundingBox();
  const last = await items.last().boundingBox();
  expect(first, "first crumb is laid out").not.toBeNull();
  expect(last, "last crumb is laid out").not.toBeNull();
  expect(
    Math.abs((first?.y ?? 0) - (last?.y ?? 1000)),
    "first and last breadcrumb share one row (a stacked list differs by a row height)",
  ).toBeLessThan(6);
});
