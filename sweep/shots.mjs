// T5 visual pass: serve a built bundle statically, drive it with Playwright,
// screenshot every probe page at 3 widths (+ dark), and record console errors
// and failed network calls per page.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const [pack, dist, portStr] = process.argv.slice(2);
const port = Number(portStr);
const PAGES = [
  ["home", "/"], ["layout", "/layout"], ["display", "/display"],
  ["inputs", "/inputs"], ["products", "/products"], ["new", "/products/new"],
  ["empty", "/nothing"],
];
const VIEWPORTS = [["desktop", 1440, 900], ["tablet", 834, 1112], ["phone", 390, 844]];

const srv = spawn(process.execPath, ["sweep/serve.mjs", dist, String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));

const outDir = `sweep/shots/${pack}`;
mkdirSync(outDir, { recursive: true });
const report = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
try {
  for (const [scheme] of [["light"], ["dark"]]) {
    for (const [vpName, w, h] of VIEWPORTS) {
      if (scheme === "dark" && vpName !== "desktop") continue; // dark only at desktop
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      const page = await ctx.newPage();
      for (const [name, route] of PAGES) {
        const consoleErrors = [], failedReqs = [];
        page.removeAllListeners("console"); page.removeAllListeners("requestfailed"); page.removeAllListeners("response");
        page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
        page.on("requestfailed", (r) => failedReqs.push(`${r.method()} ${r.url().slice(0, 120)}`));
        page.on("response", (r) => { if (r.status() >= 400) failedReqs.push(`${r.status()} ${r.url().slice(0, 120)}`); });
        let err = "";
        try { await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "networkidle", timeout: 20000 }); }
        catch (e) { err = String(e).split("\n")[0].slice(0, 160); }
        await page.waitForTimeout(500);
        const file = `${outDir}/${name}-${vpName}${scheme === "dark" ? "-dark" : ""}.png`;
        try { await page.screenshot({ path: file, fullPage: true }); } catch (e) { err ||= "screenshot failed"; }
        // structural probes
        const probe = await page.evaluate(() => {
          const body = document.body;
          const txt = (body.innerText || "").trim();
          const overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
          const focusables = document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])").length;
          return { chars: txt.length, nodes: body.querySelectorAll("*").length, hOverflow: overflow,
                   focusables, headings: body.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
                   sample: txt.replace(/\s+/g, " ").slice(0, 160) };
        }).catch(() => ({}));
        report.push({ pack, page: name, route, viewport: vpName, scheme, file, err, consoleErrors, failedReqs, ...probe });
      }
      await ctx.close();
    }
  }
} finally { await browser.close(); srv.kill(); }
writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 2));
const CDN = /cdn\.jsdelivr\.net|unpkg\.com|cdnjs/;
for (const r of report) {
  r.cdnBlocked = r.failedReqs.filter((u) => CDN.test(u));
  r.failedReqs = r.failedReqs.filter((u) => !CDN.test(u));
  r.consoleErrors = r.consoleErrors.filter((e) => !/ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_BLOCKED/.test(e) || r.cdnBlocked.length === 0);
}
const bad = report.filter((r) => r.err || r.consoleErrors.length || r.failedReqs.length || (r.chars ?? 0) < 20 || r.hOverflow);
const cdn = new Set(report.flatMap((r) => r.cdnBlocked.map((u) => u.replace(/^GET /, "").split("/").slice(0, 3).join("/"))));
console.log(`${pack}: ${report.length} shots | problem shots: ${bad.length} | median chars ${report.map(r=>r.chars??0).sort((a,b)=>a-b)[Math.floor(report.length/2)]} | hOverflow ${report.filter(r=>r.hOverflow).length} | CDN deps: ${[...cdn].join(",")||"none"}`);
for (const b of bad.slice(0, 8)) console.log(`   ! ${b.page}/${b.viewport}/${b.scheme} chars=${b.chars} overflow=${b.hOverflow} ${b.err} ${(b.consoleErrors[0] ?? "")} ${(b.failedReqs[0] ?? "")}`);
