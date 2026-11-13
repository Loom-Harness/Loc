// Headless behavioural UI tier — the TRANSLATED-LOCALE leg for the four
// static-bundle frontends (react, vue, svelte, angular).
//
// The i18n chrome claims (the page-`requires` Forbidden view, a `money` ICU
// hole, nav labels, the ProvenanceInfo disclosure, an `Action { x.op }` label)
// are pinned at generator level by emitted-text tests, which cannot say the
// translated sentence reaches a screen: a `t()` call whose key the catalog
// builder does not know, a Decimal the ICU formatter rejects, or a label read
// from the wrong key all emit fine and render English or crash.  This leg
// ships a `fr` translator tree (`i18n-ui/locales/fr/`) beside the fixture,
// builds each frontend with its own toolchain, serves the bundle plus the
// generated Hono backend (PGlite, in-process, dev-stub auth) from ONE origin,
// opens it in headless Chromium with `locale: "fr-FR"`, and reads the TRANSLATED
// text off the rendered DOM.  Nothing is mocked: `/auth/me` is answered by the
// real backend for the principal `x-loom-dev-claims` names.
//
// Usage:  npm ci (in this dir, once) ; node i18n-ui.mjs [static|vue|svelte|angular ...]
//         (default: all four)
//         LOOM_UI_MUTATE=<module.mjs> — mutation-proof seam, as in run-ui.mjs
// Exit code is non-zero if any frontend errors or any probe fails.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyLocales, localesBeside } from "./case-source.mjs";
import {
  buildFrontend,
  buildServerModule,
  findFrontendDeployable,
  findNodeDeployable,
  preserveArtifacts,
} from "./ui-stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK = join(HERE, ".work-i18n-ui");
const FIXTURE = join(HERE, "i18n-ui", "i18n-ui.ddd");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

const PRINCIPAL = {
  admin: { id: "u-admin", role: "admin" },
  viewer: { id: "u-viewer", role: "viewer" },
};
const claimsHeader = (p) => ({
  "x-loom-dev-claims": Buffer.from(JSON.stringify(p)).toString("base64"),
});

/** Open `path` as `principal` in `locale`; wait until `until(text)` holds (or
 *  the budget runs out) and return the rendered text, page errors and API log. */
async function visit(browser, origin, locale, principal, path, until) {
  const context = await browser.newContext({
    locale,
    extraHTTPHeaders: claimsHeader(principal),
  });
  const page = await context.newPage();
  const api = [];
  const errors = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) api.push({ path: u.pathname, status: r.status() });
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${origin}${path}`);
  const deadline = Date.now() + 30_000;
  let text = "";
  for (;;) {
    text = await page.evaluate(() => document.body.innerText ?? "");
    if (until(text) || Date.now() > deadline) break;
    await page.waitForTimeout(250);
  }
  return { page, context, text, api, errors };
}

const nbsp = (s) => s.replace(/[  ]/g, " ");

function probes(invoiceId) {
  const sawSession = (v) =>
    v.api.some((a) => a.path === "/api/auth/me" && a.status === 200)
      ? []
      : [`the app's /auth/me never answered 200 (saw: ${JSON.stringify(v.api)})`];
  return [
    {
      name: "(a) Forbidden view: a viewer on /admin reads the translated title and body",
      principal: PRINCIPAL.viewer,
      path: "/admin",
      until: (t) => /Interdit|Forbidden/.test(t),
      check: (v) => [
        ...sawSession(v),
        ...(v.text.includes("Interdit") ? [] : ["translated title 'Interdit' not rendered"]),
        ...(v.text.includes("Vous n'avez pas accès à cette page.")
          ? []
          : ["translated body not rendered"]),
        ...(/Forbidden|You do not have access/.test(v.text)
          ? ["English Forbidden chrome rendered under fr"]
          : []),
        ...(v.text.includes("Admin Area") ? ["'Admin Area' leaked to a viewer"] : []),
      ],
    },
    {
      name: "(a) control: the same viewer under en-US reads the English Forbidden view",
      locale: "en-US",
      principal: PRINCIPAL.viewer,
      path: "/admin",
      until: (t) => /Interdit|Forbidden/.test(t),
      check: (v) => [
        ...sawSession(v),
        ...(v.text.includes("Forbidden") ? [] : ["English 'Forbidden' not rendered under en-US"]),
      ],
    },
    {
      name: "(a) control: an admin on /admin sees the body, not the Forbidden view",
      principal: PRINCIPAL.admin,
      path: "/admin",
      until: (t) => /Admin Area|Interdit/.test(t),
      check: (v) => [
        ...sawSession(v),
        ...(v.text.includes("Admin Area") ? [] : ["'Admin Area' not rendered"]),
        ...(v.text.includes("Interdit") ? ["Forbidden rendered for a matching role"] : []),
      ],
    },
    {
      name: "(b) money hole: {amount, number, ::currency/EUR} renders formatted under fr, no crash",
      principal: PRINCIPAL.admin,
      path: `/invoices/${invoiceId}`,
      until: (t) => /Montant|Total/.test(t),
      check: (v) => [
        ...(/Montant total : 12,50 €/.test(nbsp(v.text))
          ? []
          : ["'Montant total : 12,50 €' not rendered"]),
        ...(/Total 12|Total :/.test(nbsp(v.text)) ? ["the English hole text rendered under fr"] : []),
        ...(/\{amount|Decimal|NaN/.test(v.text) ? ["the hole was not formatted"] : []),
      ],
    },
    {
      name: "(c) nav: the titled page's link, the untitled page's name and the menu section read the fr catalog",
      principal: PRINCIPAL.admin,
      path: "/price",
      until: (t) => /Tarifs/.test(t) && /Simple/.test(t),
      links: true,
      check: (v) => [
        ...sawSession(v),
        ...(v.links.includes("Tarifs") ? [] : [`no 'Tarifs' nav link (saw ${JSON.stringify(v.links)})`]),
        ...(v.links.includes("Pricing") ? ["the English title 'Pricing' still linked"] : []),
        ...(/principal/i.test(v.text) ? [] : ["menu section 'Principal' not rendered"]),
        ...(v.links.includes("Simple")
          ? []
          : [`the untitled page's link is not its translated name 'Simple' (saw ${JSON.stringify(v.links)})`]),
        ...(v.links.includes("Plain") ? ["the English page name 'Plain' still linked"] : []),
      ],
    },
    {
      name: "(d) ProvenanceInfo + Action: the disclosure labels and the op button read the fr catalog",
      principal: PRINCIPAL.admin,
      path: `/invoices/${invoiceId}`,
      until: (t) => /recalculer|reprice/i.test(t),
      provenance: true,
      check: (v) => [
        ...sawSession(v),
        ...(/recalculer/i.test(v.text) ? [] : ["translated op button 'Recalculer' not rendered"]),
        ...(/reprice/i.test(v.text) ? ["English 'Reprice' under fr"] : []),
        ...(v.prov.summary === "Comment cette valeur a été calculée"
          ? []
          : [`provenance summary label is ${JSON.stringify(v.prov.summary)}`]),
        ...(/Règle/.test(v.prov.text) && /Valeur/.test(v.prov.text)
          ? []
          : [`provenance rows not translated: ${JSON.stringify(v.prov.text)}`]),
        ...(/Rule|Value/.test(v.prov.text) ? ["English provenance row labels under fr"] : []),
      ],
    },
  ];
}

async function runFrontend(platform) {
  const genDir = mkdtempSync(join(tmpdir(), `loom-i18nui-${platform}-`));
  const workDir = join(WORK, platform);
  mkdirSync(workDir, { recursive: true });
  let server;
  let browser;
  const results = [];
  try {
    const src = readFileSync(FIXTURE, "utf8").replace(
      /^(\s+)platform: static$/m,
      `$1platform: ${platform}`,
    );
    if (platform !== "static" && !src.includes(`platform: ${platform}\n`)) {
      throw new Error("fixture: no `platform: static` deployable line to retarget");
    }
    const ddd = join(genDir, "i18n-ui.ddd");
    writeFileSync(ddd, src);
    copyLocales(localesBeside(FIXTURE), genDir);
    const out = join(genDir, "out");
    execFileSync("node", [join(REPO, "bin/cli.js"), "generate", "system", ddd, "-o", out], {
      stdio: "pipe",
    });
    const frontendDir = findFrontendDeployable(out);
    if (process.env.LOOM_UI_MUTATE) {
      const mutate = await import(pathToFileURL(resolve(process.env.LOOM_UI_MUTATE)).href);
      await mutate.default({ genDir: out, frontendDir, caseName: platform });
    }
    const distDir = buildFrontend(frontendDir, { log: (m) => process.stdout.write(`    ${m}`) });
    const { startServer } = await buildServerModule(findNodeDeployable(out), workDir, {
      devStub: true,
    });
    server = await startServer({ distDir });
    const origin = `http://127.0.0.1:${server.port}`;
    process.stdout.write(`    stack on :${server.port}\n`);

    // An invoice whose `total` carries lineage: create, then run the op that
    // writes the provenanced field.
    const post = async (path, body) => {
      const res = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...claimsHeader(PRINCIPAL.admin) },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (res.status >= 300) throw new Error(`seed POST ${path} -> ${res.status}: ${text}`);
      return text ? JSON.parse(text) : {};
    };
    const invoice = await post("/api/invoices", { label: "INV-1", amount: "12.50", total: 0 });
    await post(`/api/invoices/${invoice.id}/reprice`, {});

    execFileSync(npx, ["playwright", "install", "--with-deps", "chromium"], {
      cwd: HERE,
      stdio: "pipe",
    });
    const { chromium } = await import("playwright");
    browser = await chromium.launch();
    for (const p of probes(invoice.id)) {
      let v;
      try {
        v = await visit(browser, origin, p.locale ?? "fr-FR", p.principal, p.path, p.until);
        if (p.links) {
          v.links = await v.page.evaluate(() =>
            [...document.querySelectorAll("a, [role=link]")].map((e) =>
              (e.getAttribute("aria-label") || e.textContent || "").trim(),
            ),
          );
        }
        if (p.provenance) {
          const details = v.page.locator("details").first();
          await details.waitFor({ timeout: 15_000 });
          v.prov = {
            summary: await details.locator("summary").first().getAttribute("aria-label"),
            text: (await details.textContent()) ?? "",
          };
        }
        const why = [...p.check(v), ...v.errors.slice(0, 3)];
        results.push({
          name: p.name,
          status: why.length ? "fail" : "pass",
          error: why.length ? `${why.join("; ")} — page text ${JSON.stringify(v.text.slice(0, 240))}` : "",
        });
      } catch (err) {
        results.push({ name: p.name, status: "fail", error: String(err?.message ?? err) });
      } finally {
        await v?.context.close().catch(() => {});
      }
    }
    return { results };
  } finally {
    preserveArtifacts(genDir, workDir);
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(genDir, { recursive: true, force: true });
  }
}

const ALL = ["static", "vue", "svelte", "angular"];
const asked = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const frontends = asked.length ? asked : ALL;
for (const fw of frontends) {
  if (!ALL.includes(fw)) {
    process.stdout.write(`unknown frontend '${fw}' (${ALL.join(" | ")})\n`);
    process.exit(1);
  }
}

let pass = 0;
let fail = 0;
let errored = 0;
for (const fw of frontends) {
  process.stdout.write(`\n▶ i18n-ui on ${fw}  (${FIXTURE.slice(REPO.length + 1)})\n`);
  let out;
  try {
    out = await runFrontend(fw);
  } catch (err) {
    errored++;
    process.stdout.write(`  ERROR: ${err?.message ?? err}\n`);
    continue;
  }
  for (const r of out.results) {
    const ok = r.status === "pass";
    ok ? pass++ : fail++;
    process.stdout.write(`  ${ok ? "✓" : "✗"} [i18n-ui ${fw}] ${r.name}\n`);
    if (!ok && r.error) process.stdout.write(`      ${r.error}\n`);
  }
}
process.stdout.write(`\n${pass} passed, ${fail} failed, ${errored} errored\n`);
process.exit(fail || errored ? 1 : 0);
