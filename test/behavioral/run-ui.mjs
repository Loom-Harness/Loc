// Headless behavioral UI test tier (the sibling of run.mjs).
//
// For each corpus case with a React frontend + UI e2e: generate the
// system, `vite build` its generated React frontend, then serve that
// built bundle AND the generated Hono backend (on PGlite, in-process —
// no docker) from ONE in-process node HTTP server (static dist + `/api`
// delegated straight to `app.fetch`, same origin, no proxy/CORS), and
// run the EMITTED Playwright spec — the one Loom lowers from
//   test e2e "…" against <react-deployable>
// — against the live stack with a real (headless Chromium) browser.
//
// This is the UI counterpart to run.mjs's `api`/`unit` tiers: a fast,
// docker-free, per-PR gate for the page-object round-trips
// (`ui.orders.create(...)` → submit → read back) that the in-process
// `app.fetch` API tier can't exercise.  It closes the rollup gap run.mjs
// flagged: `against <web>` UI testCases were "unverified" until this tier
// landed.  It sidesteps the playground's in-browser npm bundle entirely
// (and so issue #1242) — the frontend is built with the same `vite build`
// the generated-*-e2e workflows use.
//
// The stack wiring itself (locate the deployables, build the frontend,
// serve dist + /api from one origin) lives in `ui-stack.mjs`, shared with
// `paged-ui.mjs`.  Two things about it are easy to get wrong:
//   1. The browser, the backend and the static bundle all share ONE
//      origin (one node server), so there is no proxy and no CORS.
//   2. Playwright is launched with async `spawn` (NOT `spawnSync`):
//      `spawnSync` blocks the event loop, which would freeze the
//      in-process server so every request hangs.
//
// Heavier than run.mjs (a real `npm install` of the React/Mantine tree +
// `vite build` + a Chromium download), so it is opt-in: its own npm
// script + CI workflow, never part of the fast `npm test`.
//
// Usage:  npm ci  (in this dir, once) ; node run-ui.mjs [caseName...]
// Exit code is non-zero if any case errors, any UI test fails, or any
// requirement is FAILING in the Definition-of-Done rollup.

import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NUMERIC_FIELDS, numericSeedBody } from "./numeric-ui-contract.mjs";
import {
  buildFrontend,
  buildServerModule,
  findFrontendDeployable,
  findNodeDeployable,
  outcomesFromPlaywrightJson,
  preserveArtifacts,
  walk,
} from "./ui-stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK = join(HERE, ".work-ui");

/** Definition-of-Done rollup: join UI outcomes onto the requirements
 *  graph via the same computeVerification run.mjs / the playground use. */
async function rollup(genDir, workDir, outcomes) {
  const traceFile = join(genDir, ".loom", "traceability.json");
  if (!existsSync(traceFile)) return null;
  const entry = join(workDir, "verify-entry.mts");
  const bundle = join(workDir, "verify-bundle.mjs");
  writeFileSync(
    entry,
    `export { computeVerification } from ${JSON.stringify(join(REPO, "src/verify/verification.ts"))};\n`,
  );
  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    packages: "external",
    logLevel: "warning",
  });
  const { computeVerification } = await import(pathToFileURL(bundle).href);
  const trace = JSON.parse(readFileSync(traceFile, "utf8"));
  return computeVerification(
    trace.index,
    trace.requirements.map((r) => r.id),
    outcomes,
  );
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

/**
 * The LIST half of a case's numeric round-trip (M-T9.15), for a case that
 * declares `numericList` in corpus.json.
 *
 * The emitted `*.ui.spec.ts` covers CREATE (through the real form) and the
 * DETAIL read, but all it asks of a list page is that the list container
 * mounted — `ListPage.goto()` waits for `<slug>-list`, which renders before
 * (and whether or not) the list's own read resolves.  So a paged envelope the
 * client cannot decode, a column reading the wrong wire key, or a column the
 * emitter dropped would leave every emitted test green.  This probe closes
 * that: seed one row over `/api` with the numeric half taken from
 * `numeric-ui-contract.mjs` (the table the fast-suite ratchet holds this case
 * to), check the backend spells it the way the contract says — so a red probe
 * names WHICH side broke — then load the app's own list page and require that
 * row's cells to read exactly the contract's rendered text for this frontend
 * (`cfg.render` names the contract column).
 *
 * Exact cell equality, not substring: a bare number is found inside a UUID
 * often enough to matter, and a cell is the unit a dropped column removes.
 */
async function numericListProbe(origin, cfg) {
  const name = `numeric list probe: ${cfg.route} renders every numeric host type as the '${cfg.render}' contract column spells it`;
  const why = [];
  const seedRes = await fetch(`${origin}${cfg.api}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...cfg.seed, ...numericSeedBody() }),
  });
  const seedText = await seedRes.text();
  if (seedRes.status >= 300) {
    return {
      tier: "ui-probe",
      name,
      status: "fail",
      error: `seed POST ${cfg.api} -> ${seedRes.status}: ${seedText}`,
    };
  }
  const id = JSON.parse(seedText).id;

  // The backend half first: when the WIRE is wrong, say so, instead of letting
  // the browser half report a rendering failure that is not the frontend's.
  const wire = await fetch(`${origin}${cfg.api}/${id}`).then((r) => r.json());
  for (const f of NUMERIC_FIELDS) {
    const v = wire[f.field];
    const type = f.wire === "string" ? "string" : "number";
    if (typeof v !== type || String(v) !== String(f.seed)) {
      why.push(
        `backend wire ${f.field}=${JSON.stringify(v)} (contract: ${type} ${JSON.stringify(f.seed)})`,
      );
    }
  }

  // The browser build THIS harness's playwright expects — the emitted e2e dir
  // installed its own, possibly a different revision (run-ui-flutter.mjs does
  // the same).  A no-op once cached.
  execFileSync(npx, ["playwright", "install", "--with-deps", "chromium"], {
    cwd: HERE,
    stdio: "pipe",
  });
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const api = [];
    const errors = [];
    page.on("response", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/")) {
        api.push(`${r.request().method()} ${u.pathname} -> ${r.status()}`);
      }
    });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(`${origin}${cfg.route}`);
    const row = page.getByTestId(`${cfg.row}${id}`);
    try {
      await row.waitFor({ timeout: 30_000 });
      const cells = (await row.locator("td").allInnerTexts()).map((t) => t.trim());
      // Column-aware: each value must sit under ITS OWN header.  A bare
      // "does some cell read 4242" passes a list whose `stock` and `weight`
      // cells read each other's wire keys — the swapped-alias defect this
      // probe exists for.  Headers are the humanised field name ("List
      // Price"), compared letters-only so sort arrows and case do not matter.
      const headers = (
        await page.locator("table").filter({ has: row }).locator("thead th").allInnerTexts()
      ).map((t) => t.toLowerCase().replace(/[^a-z]/g, ""));
      for (const f of NUMERIC_FIELDS) {
        const want = f[cfg.render];
        const col = headers.indexOf(f.field.toLowerCase());
        if (col < 0) why.push(`${f.field}: the list has no '${f.field}' column`);
        else if (cells[col] !== want) {
          why.push(`${f.field}: its column reads ${JSON.stringify(cells[col])}, contract ${JSON.stringify(want)}`);
        }
      }
      if (why.length) why.push(`headers ${JSON.stringify(headers)}, row cells ${JSON.stringify(cells)}`);
    } catch (err) {
      why.push(`row ${cfg.row}${id} never rendered (${String(err?.message ?? err).split("\n")[0]})`);
      const shown = await page.locator("body").innerText().catch(() => "");
      why.push(`page text: ${JSON.stringify(shown.slice(0, 300))}`);
    }
    if (!api.some((a) => a.startsWith(`GET ${cfg.api} -> 2`))) {
      why.push(`the app's own list read never answered 2xx (saw: ${api.join(", ") || "nothing"})`);
    }
    if (errors.length) why.push(errors.slice(0, 3).join(" | "));
  } finally {
    await browser.close().catch(() => {});
  }
  return { tier: "ui-probe", name, status: why.length ? "fail" : "pass", error: why.join("; ") };
}

async function runCase(c) {
  const genDir = mkdtempSync(join(tmpdir(), `loom-bhui-${c.name}-`));
  const workDir = join(WORK, c.name);
  mkdirSync(workDir, { recursive: true });
  let server;
  try {
    execFileSync(
      "node",
      [join(REPO, "bin/cli.js"), "generate", "system", join(REPO, c.ddd), "-o", genDir],
      { stdio: "pipe" },
    );
    const frontendDir = findFrontendDeployable(genDir);
    // Mutation-proof seam (CLAUDE.md → "Mutation-prove a new gate"): a module
    // named by LOOM_UI_MUTATE receives the GENERATED tree before anything is
    // built, so a proof can seed a defect into the emitted app itself — a wrong
    // wire key, a dropped list column — without touching an emitter.  Never set
    // in CI; unset, this is a no-op.
    if (process.env.LOOM_UI_MUTATE) {
      const mutate = await import(pathToFileURL(resolve(process.env.LOOM_UI_MUTATE)).href);
      await mutate.default({ genDir, frontendDir, caseName: c.name });
    }
    const e2eDir = join(frontendDir, "e2e");
    const uiSpecs = walk(e2eDir, (p) => p.endsWith(".ui.spec.ts"));
    if (uiSpecs.length === 0) return { skipped: "no .ui.spec.ts emitted" };
    const deplDir = findNodeDeployable(genDir);

    // 1. Build the generated frontend via ITS OWN build script (react/vue →
    //    vite→dist, svelte → vite→build, angular → ng→dist/<app>/browser,
    //    feliz → fable+vite→dist).  `npm run build` picks the right one per
    //    package.json; findDistRoot locates the emitted index.html.  The
    //    install+build pair (and its one heal for npm's optional-dependency
    //    hole) lives in ui-stack.mjs, shared with paged-ui.mjs.
    const distDir = buildFrontend(frontendDir, {
      log: (m) => process.stdout.write(`    ${m}`),
    });

    // 2. Boot ONE in-process server: built SPA + the generated Hono
    //    backend on PGlite (/api), same origin.
    const { startServer } = await buildServerModule(deplDir, workDir);
    server = await startServer({ distDir });
    process.stdout.write(`    stack on :${server.port}\n`);

    // 3. Install the e2e deps + Chromium, then run the emitted UI spec.
    //    ASYNC spawn — `spawnSync` would block the event loop and freeze
    //    the in-process server.
    execFileSync(npm, ["install", "--no-audit", "--no-fund"], { cwd: e2eDir, stdio: "pipe" });
    execFileSync(npx, ["playwright", "install", "--with-deps", "chromium"], {
      cwd: e2eDir,
      stdio: "pipe",
    });
    const reportFile = join(workDir, "report.json");
    await new Promise((res) => {
      const cp = spawn(npx, ["playwright", "test", "--reporter=list,json"], {
        cwd: e2eDir,
        stdio: "inherit",
        env: {
          ...process.env,
          E2E_BASE_URL: `http://127.0.0.1:${server.port}`,
          PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
        },
      });
      cp.on("exit", res);
    });
    if (!existsSync(reportFile)) throw new Error("Playwright produced no JSON report");
    const json = JSON.parse(readFileSync(reportFile, "utf8"));
    const results = outcomesFromPlaywrightJson(json).map((r) => ({ tier: "ui", ...r }));
    const verification = await rollup(
      genDir,
      workDir,
      results.map((r) => ({ name: r.name, status: r.status })),
    );
    // The list half of the numeric round-trip, for a case that declares it —
    // after the emitted suite, on the same live stack.  Kept OUT of the rollup
    // above: it verifies no `.ddd` requirement, it is the harness's own probe
    // of a surface the emitted page objects cannot address.
    if (c.numericList) {
      results.push(
        await numericListProbe(`http://127.0.0.1:${server.port}`, c.numericList).catch((err) => ({
          tier: "ui-probe",
          name: "numeric list probe",
          status: "fail",
          error: String(err?.message ?? err),
        })),
      );
    }
    return { results, verification };
  } finally {
    if (server) await server.close().catch(() => {});
    // Rescue Playwright's evidence BEFORE the generated tree is unlinked.
    // The traces, screenshots and error-context the reporter names live under
    // <frontend>/e2e/test-results — inside the mkdtemp this `finally` deletes,
    // so on CI they were gone by the time any upload step could run and the
    // nightly leg's only failure record was the console tail.
    preserveArtifacts(genDir, workDir);
    rmSync(genDir, { recursive: true, force: true });
  }
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
// Nightly-tier cases (non-React frontends) run only when explicitly named or
// under `--all` / LOOM_UI_ALL — so the per-PR behavioral-ui gate stays React-only
// (no extra frontend build cost per PR) while the nightly matrix covers the rest.
const allTiers = process.argv.includes("--all") || process.env.LOOM_UI_ALL === "1";
const corpus = JSON.parse(readFileSync(join(HERE, "corpus.json"), "utf8")).cases.filter(
  (c) =>
    (only.length === 0 || only.includes(c.name)) &&
    c.ui !== false &&
    (only.length > 0 || allTiers || c.uiTier !== "nightly"),
);

let pass = 0;
let fail = 0;
let errored = 0;
let reqFailing = 0;
for (const c of corpus) {
  process.stdout.write(`\n▶ ${c.name}  (${c.ddd})\n`);
  let out;
  try {
    out = await runCase(c);
  } catch (err) {
    errored++;
    process.stdout.write(`  ERROR: ${err?.message ?? err}\n`);
    continue;
  }
  if (out.skipped) {
    process.stdout.write(`  ⃠ skipped: ${out.skipped}\n`);
    continue;
  }
  for (const r of out.results) {
    const ok = r.status === "pass";
    ok ? pass++ : fail++;
    process.stdout.write(`  ${ok ? "✓" : "✗"} [${r.tier}] ${r.name}\n`);
    if (!ok && r.error)
      process.stdout.write(
        // 24 lines, not 4: the emitted fixture appends the collected browser
        // diagnostics (page errors, and the method/path/status/body of every
        // non-OK call) AFTER the assertion message, and a 4-line window cut
        // the cause off exactly when it mattered.
        `      ${String(r.error).replace(/\[[0-9;]*m/g, "").split("\n").slice(0, 24).join("\n      ")}\n`,
      );
  }
  const v = out.verification;
  if (v && v.summary.total > 0) {
    const s = v.summary;
    reqFailing += s.failing;
    process.stdout.write(
      `  ⟐ requirements: ${s.verified}/${s.total} verified` +
        `${s.failing ? `, ${s.failing} FAILING` : ""}` +
        `${s.unverified ? `, ${s.unverified} unverified` : ""}` +
        `${s.untested ? `, ${s.untested} untested` : ""}\n`,
    );
    for (const [id, r] of Object.entries(v.requirements)) {
      if (r.verdict === "FAILING")
        process.stdout.write(`      ✗ ${id} FAILING (${r.failingTestCaseIds.join(", ")})\n`);
    }
  }
}

const reqTail = reqFailing ? `, ${reqFailing} requirement(s) FAILING` : "";
process.stdout.write(
  `\n${pass} passed, ${fail} failed${reqTail}${errored ? `, ${errored} cases errored` : ""}\n`,
);
process.exit(fail > 0 || errored > 0 || reqFailing > 0 ? 1 : 0);
