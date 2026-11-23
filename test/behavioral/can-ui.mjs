// The permission query, clicked in a browser.
//
// The api tier proves `GET /<aggs>/{id}/can_<op>` answers the operation's
// gates; this leg proves the PAGE reads it: an operation with a permission
// query is disabled while its gates refuse, and one whose gate reads a
// parameter (no permission query) stays enabled and its submit answers 403 or
// 409 itself.  Fixture `can-ui.ddd`, spec `can-ui.pw.ts` (copied in as
// `can-ui.spec.ts`), stack `ui-stack.mjs`: the generated Hono backend on
// PGlite + the vite-built React bundle, one origin, no docker.
//
// Usage:  npm ci  (in this dir, once) ; node can-ui.mjs
// Exit non-zero on any failed assertion or a boot error.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { playwrightFallbackArgs } from "./browser-fallback.mjs";
import {
  buildFrontend,
  buildServerModule,
  findFrontendDeployable,
  findNodeDeployable,
  outcomesFromPlaywrightJson,
  REPO,
} from "./ui-stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DDD = join(HERE, "can-ui.ddd");
const SPEC = join(HERE, "can-ui.pw.ts");
const WORK = join(HERE, ".work-can-ui");
process.env.LOG_LEVEL ??= "warn";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

async function main() {
  const genDir = mkdtempSync(join(tmpdir(), "loom-can-ui-"));
  mkdirSync(WORK, { recursive: true });
  let server;
  let failures = 0;
  try {
    process.stdout.write(`▶ generating ${DDD}\n`);
    execFileSync("node", [join(REPO, "bin/cli.js"), "scaffold", DDD, "-o", genDir], { stdio: "pipe" });
    execFileSync("node", [join(REPO, "bin/cli.js"), "generate", "system", DDD, "-o", genDir], {
      stdio: "pipe",
    });
    const frontendDir = findFrontendDeployable(genDir);
    const deplDir = findNodeDeployable(genDir);
    const e2eDir = join(frontendDir, "e2e");

    process.stdout.write("▶ building the generated frontend\n");
    const distDir = buildFrontend(frontendDir, {
      log: (m) => process.stdout.write(`    ${m}`),
    });

    const { startServer } = await buildServerModule(deplDir, WORK);
    server = await startServer({ distDir });
    const base = `http://127.0.0.1:${server.port}`;
    process.stdout.write(`    stack on :${server.port}\n`);

    // The spec is hand-authored, so it is COPIED in rather than emitted —
    // renamed on the way so the repo's vitest run never discovers it.
    copyFileSync(SPEC, join(e2eDir, "can-ui.spec.ts"));

    process.stdout.write("▶ driving the page in a browser\n");
    execFileSync(npm, ["install", "--no-audit", "--no-fund"], { cwd: e2eDir, stdio: "pipe" });
    execFileSync(npx, ["playwright", "install", "--with-deps", "chromium"], {
      cwd: e2eDir,
      stdio: "pipe",
    });
    const reportFile = join(WORK, "report.json");
    // ASYNC spawn — `spawnSync` would block the event loop and freeze the
    // in-process server, so every request from the browser would hang.
    await new Promise((res) => {
      const cp = spawn(npx, ["playwright", "test", ...playwrightFallbackArgs(e2eDir), "--reporter=list,json"], {
        cwd: e2eDir,
        stdio: "inherit",
        env: {
          ...process.env,
          E2E_BASE_URL: base,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        },
      });
      cp.on("exit", res);
    });
    if (!existsSync(reportFile)) throw new Error("Playwright produced no JSON report");
    const results = outcomesFromPlaywrightJson(JSON.parse(readFileSync(reportFile, "utf8")));
    if (results.length === 0) throw new Error("Playwright ran no specs");
    for (const r of results) {
      const ok = r.status === "pass";
      if (!ok) failures++;
      process.stdout.write(`  ${ok ? "✓" : "✗"} ${r.name}\n`);
      if (!ok && r.error) {
        const lines = String(r.error)
          .replace(/\[[0-9;]*m/g, "")
          .split("\n")
          .slice(0, 6);
        process.stdout.write(`      ${lines.join("\n      ")}\n`);
      }
    }
  } finally {
    if (server) await server.close().catch(() => {});
    rmSync(genDir, { recursive: true, force: true });
  }

  process.stdout.write(`\n${failures === 0 ? "PASS" : `FAIL (${failures} spec(s))`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(`ERROR: ${err?.stack ?? err}\n`);
  process.exit(1);
});
