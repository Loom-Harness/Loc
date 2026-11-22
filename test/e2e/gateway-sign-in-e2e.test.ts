// One app behind a gateway, signed in once: `web/src/examples/multi-frontend-system.ddd`
// as generated, with a German translator tree beside it, booted from its own
// `docker-compose.yml` with the bundled Keycloak.
//
// The gateway `site` serves the React back office at `/` and the Angular
// operations console at `/ops`, both on the `admin` backend.  In a browser:
//   - signed out, a page of the console shows the Sign in screen, and signing
//     in through Keycloak lands back on THAT page (the sign-in carries
//     `returnTo`, and `admin` allows the gateway's origin in
//     `OIDC_RETURN_ORIGINS`);
//   - the back office at `/` is then signed in too: one origin, one session;
//   - the language picked in the back office is the console's language, and
//     the console shows the gateway's own translated label for itself;
//   - both parts list both apps, in the gateway's order.
// The signed-out state is the current whole-app gate: until a session exists
// the frontend renders only its Sign in screen.
//
// Opt-in: LOOM_GATEWAY_E2E=1 (npm run test:gateway-e2e).  Needs docker and the
// pre-installed Chromium.  Keycloak issues `host.docker.internal` URLs; the
// browser maps that name to the loopback.

import { execFileSync, execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.LOOM_GATEWAY_E2E === "1";
const PROJECT = "loomgatewaysignin";
const GATEWAY = "http://localhost:8080";
const MODEL = "web/src/examples/multi-frontend-system.ddd";
/** The services the proof boots: the gateway pulls in its parts and their
 *  backend, and the backend its database and Keycloak. */
const BUILT = ["admin", "backoffice", "ops", "site"];
/** The two apps the gateway lists, in its order, as the back office reads them
 *  in German: only the console's label has a German translation. */
const APPS_DE = [
  ["/", "Back office"],
  ["/ops/", "Betrieb"],
];

let dir = "";
let out = "";

function compose(args: string): string {
  return execSync(`docker compose -p ${PROJECT} -f ${join(out, "docker-compose.yml")} ${args}`, {
    stdio: "pipe",
    encoding: "utf8",
    timeout: 900_000,
  });
}

function buildImages(): void {
  const proxy = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].flatMap((k) =>
    process.env[k] ? ["--build-arg", `${k}=${process.env[k]}`] : [],
  );
  const caDir = process.env.LOOM_E2E_CA_DIR;
  for (const service of BUILT) {
    if (caDir && existsSync(caDir) && existsSync(join(out, service, "Dockerfile"))) {
      const certs = join(out, service, "certs");
      mkdirSync(certs, { recursive: true });
      for (const crt of readdirSync(caDir).filter((f) => f.endsWith(".crt"))) {
        copyFileSync(join(caDir, crt), join(certs, crt));
      }
    }
    execFileSync(
      "docker",
      [
        "build",
        "--network",
        "host",
        ...proxy,
        ...(proxy.length > 0
          ? ["--build-arg", "NO_PROXY=localhost", "--build-arg", "no_proxy=localhost"]
          : []),
        "-t",
        `${PROJECT}-${service}`,
        join(out, service),
      ],
      { stdio: "inherit", timeout: 1_200_000 },
    );
  }
}

describe.skipIf(!ENABLED)("gateway — one sign-in over the parts it gathers", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "loom-gateway-signin-"));
    out = join(dir, "out");
    const cli = `node ${join(process.cwd(), "bin/cli.js")}`;
    writeFileSync(join(dir, "sys.ddd"), readFileSync(MODEL, "utf8"));
    // A German tree with one translation: the gateway's label for the console.
    execSync(`${cli} i18n init sys.ddd de`, { cwd: dir, stdio: "pipe" });
    const site = join(dir, "locales", "de", "site.json");
    const source = JSON.parse(
      readFileSync(join(dir, "locales", ".sync", "source.lock", "site.json"), "utf8"),
    ) as Record<string, string>;
    const opsKey = Object.keys(source).find((k) => source[k] === "Operations");
    expect(opsKey).toBeDefined();
    writeFileSync(site, `${JSON.stringify({ [opsKey as string]: "Betrieb" }, null, 2)}\n`);
    execSync(`${cli} generate system sys.ddd -o out`, { cwd: dir, stdio: "pipe" });
    buildImages();
    try {
      compose("up -d --no-build --wait --wait-timeout 900 site");
    } catch (e) {
      console.error(compose("ps -a"));
      console.error(compose("logs --tail=200"));
      throw e;
    }
  }, 3_600_000);

  afterAll(() => {
    if (!out) return;
    try {
      compose("down -v");
    } catch {
      /* best effort */
    }
    rmSync(dir, { recursive: true, force: true });
  }, 300_000);

  it("signs in once, returns to the page it started from, and carries the session and language across parts", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({
      args: ["--host-resolver-rules=MAP host.docker.internal 127.0.0.1"],
    });
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));

      // Signed out, a console page shows only the Sign in screen.
      await page.goto(`${GATEWAY}/ops/products`);
      const signIn = page.getByRole("button", { name: "Sign in" });
      await signIn.waitFor({ timeout: 60_000 });
      expect((await page.request.get(`${GATEWAY}/api/auth/me`)).status()).not.toBe(200);

      // Sign in at Keycloak, and land back on that page.
      await signIn.click();
      await page.locator("#username").waitFor({ timeout: 60_000 });
      await page.fill("#username", "demo");
      await page.fill("#password", "demo");
      await page.click("#kc-login");
      await page.waitForURL(`${GATEWAY}/ops/products`, { timeout: 60_000 });
      await expect
        .poll(async () => (await page.request.get(`${GATEWAY}/api/auth/me`)).status(), {
          timeout: 30_000,
        })
        .toBe(200);
      await page.getByRole("button", { name: "Sign in" }).waitFor({ state: "detached" });

      // The back office at `/` is signed in by the same session.
      await page.goto(`${GATEWAY}/`);
      const switcher = page.getByTestId("locale-switcher").first();
      await switcher.waitFor({ timeout: 30_000 });
      expect(await page.getByRole("button", { name: "Sign in" }).count()).toBe(0);

      // German, picked in the back office.
      await switcher.selectOption("de");
      await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("de");

      // The back office lists both apps in its `Shell` layout.
      await page.goto(`${GATEWAY}/apps`);
      const links = (p: typeof page) =>
        p
          .getByTestId("apps")
          .first()
          .getByTestId("apps-link")
          .evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.textContent?.trim()]));
      await page.getByTestId("apps").first().waitFor({ timeout: 30_000 });
      expect(await links(page)).toEqual(APPS_DE);

      // The console opens in German, signed in, and lists both apps too.
      await page.goto(`${GATEWAY}/ops/apps`);
      await page.getByTestId("apps").first().waitFor({ timeout: 30_000 });
      expect(await page.evaluate(() => document.documentElement.lang)).toBe("de");
      expect(await page.getByRole("button", { name: "Sign in" }).count()).toBe(0);
      expect(await links(page)).toEqual(APPS_DE);

      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 300_000);
});
