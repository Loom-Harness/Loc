// A `gateway` deployable, end to end: one origin over four frontends that
// share one backend.
//
// The fixture gathers a React bundle at the root and Vue, Svelte and Angular
// bundles under `/shop`, `/kiosk` and `/ops`, all targeting one node backend.
// The stack is the generated `docker-compose.yml`, booted as emitted, so what
// is under test is the whole wiring: the gateway's nginx routes, each part
// built under its base path, each part's own server answering beneath that
// path (vite preview for React/Vue/Svelte, the static `server.mjs` for
// Angular), and the healthchecks that probe a part under its path.
//
// What each assertion proves:
//   - `/api` through the gateway reaches the backend itself, with the root
//     part (whose own server also proxies `/api`) stopped: a write and its read;
//   - every part's page and every asset it references load through the
//     gateway, each under its own path, so no part's asset is answered by
//     another part (a missed base would fetch `/assets/…` from the root part);
//   - a part also answers on its own port, under the same path;
//   - every part's menu lists every app the gateway serves, and each of those
//     links loads that app on the same origin;
//   - in a browser, each part renders a deep link under its path, reads the
//     backend through the gateway's `/api`, and its menu, its links and its
//     in-code navigation all stay within its path.
//
// Opt-in: LOOM_GATEWAY_E2E=1 (npm run test:gateway-e2e).  Needs docker and
// the pre-installed Chromium.  The images build with `--network host` and the
// caller's proxy env; LOOM_E2E_CA_DIR=<dir-of-*.crt> drops a TLS-intercepting
// proxy's CA into each image (the generated Dockerfiles copy `certs/`).

import { execFileSync, execSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.LOOM_GATEWAY_E2E === "1";
const PROJECT = "loomgateway";
const GATEWAY = "http://localhost:8088";

const FIXTURE = `
system Gw {
  subdomain Catalog { context Catalog {
    aggregate Product with crudish { sku: string }
  } }
  ui Back with scaffold(subdomains: [Catalog]) { }
  ui Shop with scaffold(subdomains: [Catalog]) { framework: vue }
  ui Kiosk with scaffold(subdomains: [Catalog]) { framework: svelte }
  ui Ops with scaffold(subdomains: [Catalog]) { framework: angular }
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable admin { platform: node contexts: [Catalog] dataSources: [catalogState] port: 3000 }
  deployable back { platform: web targets: admin ui: Back port: 3001 }
  deployable shop { platform: web targets: admin ui: Shop port: 3002 }
  deployable kiosk { platform: web targets: admin ui: Kiosk port: 3003 }
  deployable ops { platform: web targets: admin ui: Ops port: 3004 }
  deployable site {
    platform: gateway
    port: 8088
    gathers: [ back at "/", shop at "/shop", kiosk at "/kiosk", ops at "/ops" ]
  }
}
`;

/** Each gathered part: its service, its path under the gateway (`/` or
 *  `/shop/`), and its own published port. */
const PARTS = [
  { service: "back", path: "/", port: 3001 },
  { service: "shop", path: "/shop/", port: 3002 },
  { service: "kiosk", path: "/kiosk/", port: 3003 },
  { service: "ops", path: "/ops/", port: 3004 },
] as const;
const SERVICES = ["admin", ...PARTS.map((p) => p.service), "site"];

let dir = "";
let out = "";

function compose(args: string): string {
  return execSync(`docker compose -p ${PROJECT} -f ${join(out, "docker-compose.yml")} ${args}`, {
    stdio: "pipe",
    encoding: "utf8",
    timeout: 900_000,
  });
}

/** Build each image under the tag compose looks for, so `up` needs no build. */
function buildImages(): void {
  const proxy = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].flatMap((k) =>
    process.env[k] ? ["--build-arg", `${k}=${process.env[k]}`] : [],
  );
  const caDir = process.env.LOOM_E2E_CA_DIR;
  for (const service of SERVICES) {
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

/** The same-origin asset URLs a page references (`src="/…"` / `href="/…"`),
 *  resolved against the page's own path for a relative one. */
function assetUrls(html: string, pagePath: string): string[] {
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1] as string)
    .filter((u) => !/^(?:[a-z]+:|\/\/|#|data:)/i.test(u))
    .map((u) => (u.startsWith("/") ? u : `${pagePath}${u.replace(/^\.\//, "")}`))
    .filter((u) => /\.(?:js|mjs|css)(?:\?|$)/.test(u));
  return [...new Set(urls)];
}

describe.skipIf(!ENABLED)("gateway — one origin over the parts it gathers", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "loom-gateway-"));
    out = join(dir, "out");
    writeFileSync(join(dir, "sys.ddd"), FIXTURE);
    execSync(`node ${join(process.cwd(), "bin/cli.js")} generate system sys.ddd -o out`, {
      cwd: dir,
      stdio: "pipe",
    });
    buildImages();
    try {
      // `--wait` holds until every service's healthcheck passes; a part's
      // healthcheck probes beneath its base path.
      compose(`up -d --no-build --wait --wait-timeout 600 ${SERVICES.join(" ")}`);
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

  it("answers its own probe", async () => {
    const r = await fetch(`${GATEWAY}/healthz`);
    expect(r.status).toBe(200);
  });

  it("routes /api to the parts' backend itself", async () => {
    // The root part's own server also proxies `/api`, so it is stopped while
    // the gateway answers: the route must reach the backend directly.
    compose("stop back");
    try {
      await assertApiRoundTrip("GW-0");
    } finally {
      compose("start back");
      compose(`up -d --no-build --wait --wait-timeout 300 back`);
    }
    await assertApiRoundTrip("GW-1");
  }, 400_000);

  async function assertApiRoundTrip(sku: string): Promise<void> {
    const created = await fetch(`${GATEWAY}/api/products`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const read = await fetch(`${GATEWAY}/api/products/${id}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { sku: string }).sku).toBe(sku);
  }

  it("sends a bare base path to its slash form, on the browser's own origin", async () => {
    const r = await fetch(`${GATEWAY}/ops`, { redirect: "manual" });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/ops/");
  });

  it.each(PARTS)("serves $service and every asset it references at $path", async (part) => {
    const page = await fetch(`${GATEWAY}${part.path}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");
    const assets = assetUrls(await page.text(), part.path);
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      // A part under a base path references nothing outside it.
      if (part.path !== "/") expect(asset.startsWith(part.path)).toBe(true);
      const r = await fetch(`${GATEWAY}${asset}`);
      expect(r.status, asset).toBe(200);
      expect(r.headers.get("content-type") ?? "", asset).not.toContain("text/html");
    }
  });

  it.each(PARTS)("serves $service on its own port, under the same path", async (part) => {
    const r = await fetch(`http://localhost:${part.port}${part.path}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
  });

  it.each(
    PARTS,
  )("renders $service's deep link under $path, reading /api through the gateway", async (part) => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${GATEWAY}${part.path}products`);
      await page.getByText("GW-1").first().waitFor({ timeout: 30_000 });
      // The menu navigates within the part's path.
      await page.goto(`${GATEWAY}${part.path}`);
      await page
        .getByRole("link", { name: /products/i })
        .first()
        .click();
      await page.waitForURL(`${GATEWAY}${part.path}products`, { timeout: 30_000 });
      await page.getByText("GW-1").first().waitFor({ timeout: 30_000 });
      // A page's own navigation stays within the path too: the create
      // button navigates in code, the breadcrumb is a link.
      await page.getByTestId("products-list-create").click();
      await page.waitForURL(`${GATEWAY}${part.path}products/new`, { timeout: 30_000 });
      await page
        .getByRole("link", { name: /^Products\/?$/ })
        .locator("visible=true")
        .first()
        .click();
      await page.waitForURL(`${GATEWAY}${part.path}products`, { timeout: 30_000 });
      await page
        .getByRole("link", { name: /^Home\/?$/ })
        .locator("visible=true")
        .first()
        .click();
      await page.waitForURL(`${GATEWAY}${part.path}`, { timeout: 30_000 });
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);

  it.each(
    PARTS,
  )("lists every app in $service's menu, and each link loads that app", async (part) => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      for (const other of PARTS) {
        await page.goto(`${GATEWAY}${part.path}`);
        for (const listed of PARTS) {
          await page.getByTestId(`nav-app-${listed.service}`).first().waitFor({ timeout: 30_000 });
        }
        await page.getByTestId(`nav-app-${other.service}`).first().click();
        await page.waitForURL(`${GATEWAY}${other.path}`, { timeout: 30_000 });
        // The other app booted: its own menu lists this one.
        await page.getByTestId(`nav-app-${part.service}`).first().waitFor({ timeout: 30_000 });
      }
      expect(errors).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 180_000);
});
