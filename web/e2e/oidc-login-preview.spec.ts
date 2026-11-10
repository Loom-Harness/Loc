// The generated frontend's real OIDC login in the preview: "Sign in" runs the
// generated backend handshake (`/api/auth/login` → the playground identity
// provider's login page → `/api/auth/callback`, code + PKCE) and lands on the
// app with HttpOnly session cookies; an expired access token is renewed
// through `/api/auth/refresh` (rotation); "Sign out" clears the session.  Every
// assertion is something the app or the identity provider observably did.
// Needs real internet (npm), like runtime.spec.ts.

import { expect, type FrameLocator, type Page, test } from "./_test";
import { browserCanReachNetwork, recordAndGenerate, startFromExample, waitForBundle } from "./_helpers";

const infra = (page: Page, service: string, op: string, params?: unknown): Promise<unknown> =>
  page.evaluate(
    ([s, o, p]) =>
      (window as unknown as { __loomInfraService: (s: string, o: string, p?: unknown) => Promise<unknown> }).__loomInfraService(
        s as string,
        o as string,
        p,
      ),
    [service, op, params] as const,
  );

const grants = async (page: Page): Promise<string[]> =>
  ((await infra(page, "oidc", "grants")) as { grant: string; persona: string }[]).map((g) => `${g.grant}:${g.persona}`);

/** `GET /api/auth/me` from inside the preview, as the app's own fetches go. */
async function me(page: Page): Promise<number> {
  const handle = await page.locator('[data-testid="preview-iframe"]').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error("no preview frame");
  return frame.evaluate(async () => {
    const base = (window as unknown as { __LOOM_API_BASE__: string }).__LOOM_API_BASE__;
    return (await fetch(`${base}/auth/me`, { credentials: "include" })).status;
  });
}

/** Print the App and Runtime log lines that name an error — what a failed
 *  step needs to be diagnosable from CI output alone. */
async function dumpLogs(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /^Output/ }).click();
  for (const stream of [/App logs/i, /Runtime logs/i]) {
    await page.getByTestId("output-stream-select").click();
    await page.getByRole("option", { name: stream }).click();
    const text = await page.locator("body").innerText();
    console.log(`[oidc-login] ${stream}:\n${text.split("\n").filter((l) => /^\[|Sign-in|navigat|error/i.test(l.trim())).slice(0, 60).join("\n")}`);
  }
}

test("the generated frontend signs in through the playground identity provider", async ({ page }) => {
  await page.goto("/");
  await startFromExample(page, /OIDC auth/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 600_000 });

  const app: FrameLocator = page.frameLocator('[data-testid="preview-iframe"]');
  // Tokens a grant mints live 3 s, so the session needs a refresh within the test.
  await infra(page, "oidc", "settings", { accessTokenLifetime: 3 });

  page.on("console", (m) => m.type() === "error" && console.log(`[oidc-login] console: ${m.text().slice(0, 300)}`));
  try {
  await test.step("signed out: the app shows its sign-in screen and /auth/me is 401", async () => {
    await expect(app.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 60_000 });
    expect(await me(page)).toBe(401);
  });

  await test.step("Sign in → the provider's login page → back in the app, signed in", async () => {
    await app.getByRole("button", { name: "Sign in" }).click();
    await expect(app.getByTestId("loom-idp-login")).toBeVisible();
    await app.getByTestId("loom-idp-persona-demo-admin").click();
    await expect(app.getByTestId("sign-out")).toBeVisible({ timeout: 30_000 });
    // The code was exchanged at the token endpoint — with the PKCE verifier,
    // or the provider would have refused it.
    expect(await grants(page)).toEqual(["authorization_code:demo-admin"]);
    expect(await me(page)).toBe(200);
  });

  await test.step("an expired session is renewed through /auth/refresh, and the app keeps working", async () => {
    await page.waitForTimeout(4_000);
    // The preview pane is narrow, so the nav link sits under the editor;
    // click it in the frame's own DOM.
    await app.getByTestId("nav-notes").evaluate((a: HTMLElement) => a.click());
    await expect(app.getByTestId("sign-out")).toBeVisible();
    await expect.poll(() => grants(page), { timeout: 30_000 }).toContain("refresh_token:demo-admin");
    expect(await me(page)).toBe(200);
  });

  await test.step("Sign out → back to the sign-in screen, no session", async () => {
    await app.getByTestId("sign-out").click();
    await expect(app.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 });
    expect(await me(page)).toBe(401);
  });

  await test.step("cancelling the login page leaves the app signed out", async () => {
    await app.getByRole("button", { name: "Sign in" }).click();
    await app.getByTestId("loom-idp-cancel").click();
    await expect(app.getByTestId("loom-idp-login")).toHaveCount(0);
    await expect(app.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(await me(page)).toBe(401);
  });
  } catch (e) {
    await dumpLogs(page).catch(() => undefined);
    throw e;
  }
});
