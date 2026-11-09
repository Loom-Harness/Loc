#!/usr/bin/env node
// Fold the per-test timing files `LOOM_E2E_TIMING=<dir> npx playwright test`
// writes (see `e2e/_test.ts`) into a per-spec phase breakdown, as Markdown.
//
//   node scripts/e2e-timing.mjs <dir> [--json]
//
// Attribution is wall clock, per test:
// - page load      every main-frame navigation → its `load` event;
// - prep           the first load → the first Bundle: playground ready (LSP
//                  `0 errors`), example select, recorded migration, Generate;
// - bundle         the `bundle` mark → the last `[npm-engine]` line after it,
//                  split into npm install and esbuild by the engine's own
//                  `install=… bundle=…` numbers (summed over hono + react);
// - boot           `boot:start` → `idle`, split by the active `boot:*` mark:
//                  PGlite assets (fetch + compile), initdb (`pglite-construct`
//                  → next mark: PGlite comes up), migrations (`ddl-*`), the
//                  rest (bundle import, storage connect, create-app);
// - body           everything else: playground ready, example select,
//                  generate, the test's own steps and assertions.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: e2e-timing.mjs <dir> [--json]");
  process.exit(2);
}
const asJson = process.argv.includes("--json");

const PHASES = ["load", "prep", "install", "esbuild", "bundleOther", "assets", "initdb", "migrate", "bootOther", "body"];

function attribute(rec) {
  const ev = [...rec.events].sort((a, b) => a.t - b.t);
  const out = Object.fromEntries(PHASES.map((p) => [p, 0]));
  out.boots = 0;
  out.bundles = 0;
  out.bootWall = [];
  // page loads
  let gotoAt = null;
  for (const e of ev) {
    if (e.kind === "goto" && gotoAt === null) gotoAt = e.t;
    if (e.kind === "load" && gotoAt !== null) {
      out.load += e.t - gotoAt;
      gotoAt = null;
    }
  }
  // prep: the first page load → the first Bundle (LSP ready, example,
  // recorded migration, Generate)
  const firstLoad = ev.find((e) => e.kind === "load");
  const firstBundle = ev.find((e) => e.kind === "mark" && e.name === "bundle");
  if (firstLoad && firstBundle && firstBundle.t > firstLoad.t) out.prep = firstBundle.t - firstLoad.t;
  // bundles
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].kind !== "mark" || ev[i].name !== "bundle") continue;
    let end = null;
    let install = 0;
    let esbuild = 0;
    for (let j = i + 1; j < ev.length; j++) {
      const e = ev[j];
      if (e.kind === "mark" && (e.name === "bundle" || e.name === "boot:start")) break;
      if (e.kind === "engine") {
        const m = /install=(\d+)ms bundle=(\d+)ms/.exec(e.name);
        if (m) {
          install += Number(m[1]);
          esbuild += Number(m[2]);
          end = e.t;
        }
      }
    }
    if (end === null) continue;
    out.bundles++;
    const wall = end - ev[i].t;
    // hono + react bundle one after the other today; if they ever overlap,
    // scale the engine's own split to the wall clock.
    const scale = install + esbuild > wall ? wall / (install + esbuild) : 1;
    out.install += install * scale;
    out.esbuild += esbuild * scale;
    out.bundleOther += Math.max(0, wall - install - esbuild);
  }
  // boots
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].kind !== "mark" || ev[i].name !== "boot:start") continue;
    let active = "bootOther";
    let at = ev[i].t;
    let done = false;
    for (let j = i + 1; j < ev.length && !done; j++) {
      const e = ev[j];
      if (e.kind !== "mark") continue;
      out[active] += e.t - at;
      at = e.t;
      if (e.name === "idle" || e.name === "boot:start" || e.name === "bundle") {
        done = e.name === "idle";
        if (done) {
          out.boots++;
          out.bootWall.push(e.t - ev[i].t);
        }
        break;
      }
      active =
        e.name === "boot:pglite-assets"
          ? "assets"
          : e.name === "boot:pglite-construct"
            ? "initdb"
            : /^boot:ddl-(meta|apply|drop)$/.test(e.name)
              ? "migrate"
              : "bootOther";
    }
  }
  const total = rec.ended - rec.started;
  const accounted = PHASES.filter((p) => p !== "body").reduce((s, p) => s + out[p], 0);
  out.body = Math.max(0, total - accounted);
  out.total = total;
  return out;
}

const recs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

const bySpec = new Map();
for (const rec of recs) {
  const key = `${rec.project}\u0000${rec.file}`;
  const a = attribute(rec);
  const cur = bySpec.get(key) ?? {
    project: rec.project,
    file: rec.file,
    tests: 0,
    failed: 0,
    boots: 0,
    bundles: 0,
    total: 0,
    bootWall: [],
    ...Object.fromEntries(PHASES.map((p) => [p, 0])),
  };
  cur.tests++;
  if (rec.status !== "passed" && rec.status !== "skipped") cur.failed++;
  cur.boots += a.boots;
  cur.bundles += a.bundles;
  cur.total += a.total;
  cur.bootWall.push(...a.bootWall);
  for (const p of PHASES) cur[p] += a[p];
  bySpec.set(key, cur);
}

const rows = [...bySpec.values()].sort((a, b) => a.project.localeCompare(b.project) || b.total - a.total);
if (asJson) {
  console.log(JSON.stringify(rows, null, 1));
  process.exit(0);
}

const s = (ms) => (ms / 1000).toFixed(1);
const HEAD = ["load", "prep", "install", "esbuild", "bundle other", "PGlite assets", "initdb", "migrations", "boot other", "body"];
for (const project of [...new Set(rows.map((r) => r.project))]) {
  const lane = rows.filter((r) => r.project === project);
  console.log(`\n### ${project}\n`);
  console.log(`| spec | tests | bundles | boots | ${HEAD.join(" | ")} | total |`);
  console.log(`|---|---:|---:|---:|${HEAD.map(() => "---:").join("|")}|---:|`);
  const sum = { tests: 0, bundles: 0, boots: 0, total: 0, ...Object.fromEntries(PHASES.map((p) => [p, 0])) };
  for (const r of lane) {
    const flag = r.failed ? ` (${r.failed} failed)` : "";
    console.log(
      `| ${r.file}${flag} | ${r.tests} | ${r.bundles} | ${r.boots} | ${PHASES.map((p) => s(r[p])).join(" | ")} | ${s(r.total)} |`,
    );
    for (const k of Object.keys(sum)) sum[k] += r[k];
  }
  console.log(
    `| **lane total** | ${sum.tests} | ${sum.bundles} | ${sum.boots} | ${PHASES.map((p) => `**${s(sum[p])}**`).join(" | ")} | **${s(sum.total)}** |`,
  );
}
