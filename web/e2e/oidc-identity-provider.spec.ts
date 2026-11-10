// The fake OIDC identity provider: an `auth { oidc }` backend boots with its
// GENERATED OIDC verifier — discovery + JWKS fetched from the infra worker's
// identity provider, signature / `iss` / `aud` / `exp` checked by `jose` in
// the generated `auth/oidc.ts` — and every assertion is a status or a row the
// verifier's verdict produced.  Needs real internet (npm), like runtime.spec.ts.

import { expect, type Page, test } from "./_test";
import { browserCanReachNetwork, recordAndGenerate, startFromExample, waitForBundle } from "./_helpers";

interface Dispatched {
  ok: boolean;
  message?: string;
  response?: { status: number; body: string };
}

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

/** A request to the `api` deployable, carrying `token` (if any). */
async function call(page: Page, method: string, path: string, token: string | null, body?: unknown): Promise<{ status: number; body: unknown }> {
  const out = (await page.evaluate(
    ([m, p, b, t]) =>
      (
        window as unknown as {
          __loomDispatch: (target: string, method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<unknown>;
        }
      ).__loomDispatch("api", m as string, p as string, b ?? undefined, t ? { authorization: `Bearer ${t}` } : {}),
    [method, path, body ?? null, token] as const,
  )) as Dispatched;
  if (!out.ok || !out.response) throw new Error(`dispatch failed: ${out.message}`);
  let parsed: unknown = out.response.body;
  try {
    parsed = JSON.parse(out.response.body);
  } catch {
    // not JSON
  }
  return { status: out.response.status, body: parsed };
}

async function mint(page: Page, params: Record<string, unknown>): Promise<string> {
  return ((await infra(page, "oidc", "mint", params)) as { access_token: string }).access_token;
}

test("fake OIDC identity provider: the generated verifier accepts and rejects real tokens", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

  await page.goto("/");
  await startFromExample(page, /OIDC auth/);
  if (!(await browserCanReachNetwork(page))) test.skip(true, "browser cannot reach the npm registry");

  await recordAndGenerate(page);
  await page.getByTestId("btn-bundle").click();
  await waitForBundle(page);
  await page.getByTestId("devtools-tab-backend").click();
  await page.getByTestId("btn-boot").click();
  try {
    const bootError = page.getByText(/Boot failed before the API came up/);
    await expect(async () => {
      if (await bootError.isVisible()) {
        throw new Error(`boot failed: ${await page.getByTestId("runtime-subview").innerText().catch(() => "")}`);
      }
      await expect(page.getByTestId("backend-status")).toHaveText("booted", { timeout: 2_000 });
    }).toPass({ timeout: 600_000, intervals: [2_000] });
  } catch (e) {
    console.log(`[oidc] errors:\n${consoleErrors.map((m) => `  ${m.slice(0, 400)}`).join("\n")}`);
    throw e;
  }

  await test.step("the realm and personas come from the generated dev realm and compose env", async () => {
    const realms = (await infra(page, "oidc", "realms")) as { issuer: string; audience: string }[];
    expect(realms).toEqual([expect.objectContaining({ issuer: "http://host.docker.internal:8081/realms/desk", audience: "desk-api" })]);
    const personas = (await infra(page, "oidc", "personas")) as { username: string }[];
    expect(personas.map((p) => p.username)).toEqual(["demo", "demo-admin"]);
  });

  await test.step("the Auth tab mints a token the API console sends", async () => {
    await page.getByTestId("devtools-tab-auth").click();
    await expect(page.getByTestId("auth-no-token")).toBeVisible();
    await page.getByTestId("auth-persona").selectOption("demo-admin");
    await page.getByTestId("auth-mint").click();
    await expect(page.getByTestId("auth-token")).toContainText("demo-admin");
    await page.getByTestId("devtools-tab-backend").click();
    await page.getByTestId("req-endpoint").click();
    await page.getByRole("option", { name: /^GET \/(api\/)?notes$/ }).click();
    await page.getByTestId("btn-send").click();
    try {
      await expect(page.getByTestId("resp-status")).toContainText("200", { timeout: 30_000 });
    } catch (e) {
      console.log(`[oidc] response: ${await page.getByTestId("resp-body").textContent()}`);
      await page.getByRole("tab", { name: /^Output/ }).click();
      await page.getByTestId("output-stream-select").click();
      await page.getByRole("option", { name: /Runtime logs/i }).click();
      const text = await page.locator("body").innerText();
      console.log(`[oidc] backend log:\n${text.split("\n").filter((l) => /error|fail|oidc|auth|jwks/i.test(l)).slice(0, 30).join("\n")}`);
      throw e;
    }
  });

  const admin = await mint(page, { persona: "demo-admin" });
  const agent = await mint(page, { persona: "demo" });

  await test.step("a valid token is accepted", async () => {
    expect((await call(page, "GET", "/api/notes", admin)).status).toBe(200);
  });

  await test.step("the real verifier rejects a missing, expired, forged or mis-addressed token", async () => {
    expect((await call(page, "GET", "/api/notes", null)).status).toBe(401);
    const expired = await mint(page, { persona: "demo-admin", expiresIn: -120 });
    expect((await call(page, "GET", "/api/notes", expired)).status).toBe(401);
    const forged = await mint(page, { persona: "demo-admin", signWith: "foreign" });
    expect((await call(page, "GET", "/api/notes", forged)).status).toBe(401);
    const otherAudience = await mint(page, { persona: "demo-admin", audience: "some-other-api" });
    expect((await call(page, "GET", "/api/notes", otherAudience)).status).toBe(401);
    const otherIssuer = await mint(page, { persona: "demo-admin", claims: { iss: "http://evil.example/realms/desk" } });
    expect((await call(page, "GET", "/api/notes", otherIssuer)).status).toBe(401);
  });

  let noteId = "";
  await test.step("a `requires` permission gate follows the persona's realm roles", async () => {
    const created = await call(page, "POST", "/api/notes", agent, { body: "first", open: true });
    expect(created.status).toBe(201);
    noteId = (created.body as { id: string }).id;
    // `demo` holds no `support.closeNotes` role: refused by the gate.
    expect((await call(page, "POST", `/api/notes/${noteId}/close`, agent)).status).toBe(403);
    expect(((await call(page, "GET", `/api/notes/${noteId}`, agent)).body as { open: boolean }).open).toBe(true);
    // `demo-admin` holds it.
    expect((await call(page, "POST", `/api/notes/${noteId}/close`, admin)).status).toBeLessThan(300);
    expect(((await call(page, "GET", `/api/notes/${noteId}`, admin)).body as { open: boolean }).open).toBe(false);
  });

  await test.step("the tenant claim scopes reads per persona", async () => {
    const otherTenant = await mint(page, {
      persona: "demo-admin",
      claims: { tenantId: "00000000-0000-4000-8000-0000000000b2" },
    });
    const theirs = await call(page, "POST", "/api/notes", otherTenant, { body: "second", open: true });
    expect(theirs.status).toBe(201);
    const ids = async (token: string): Promise<string[]> =>
      ((await call(page, "GET", "/api/notes", token)).body as { items: { id: string }[] }).items.map((n) => n.id);
    expect(await ids(admin)).toEqual([noteId]);
    expect(await ids(otherTenant)).toEqual([(theirs.body as { id: string }).id]);
    expect((await call(page, "GET", `/api/notes/${noteId}`, otherTenant)).status).toBe(404);
  });
});
