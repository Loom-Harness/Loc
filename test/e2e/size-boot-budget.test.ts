// ---------------------------------------------------------------------------
// M-T9.23 — the generated-output SIZE + COLD-BOOT budget (nightly).
//
// Measures, per cell, the thing no correctness gate notices rotting:
//
//   bundle:<framework>/<pack> — gzip bytes of the built frontend's js + css
//     (the generated project `npm install`ed and `npm run build`), over one
//     fixed scaffold fixture;
//   boot:<backend>           — ms from `docker compose up -d` (images already
//     built, so this is the process + migrations + first DB round-trip, not the
//     image build) to the first 200 on the backend's `/ready`.
//
// …and hands the numbers to `evaluateBudget` (test/budget/size-boot-ratchet.ts)
// against `test/budget/size-boot-budget.json`: growth past the tolerance fails,
// and so does a shrink past it — the baseline must come DOWN with a genuine
// improvement (the M-T9.8 ratchet shape).
//
// Run modes (never part of `npm test`):
//   LOOM_SIZE_BOOT=1 npx vitest run test/e2e/size-boot-budget.test.ts
//   LOOM_SIZE_BOOT_CASE=bundle:react/mantine   — one cell (the nightly's shard)
//   LOOM_SIZE_BOOT_REPORT=<file.json>          — also write the measurements
// Boot cells need docker; bundle cells need network for `npm install`.
// ---------------------------------------------------------------------------

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { SIZE_BOOT_CELLS, type SizeBootCell } from "../budget/size-boot-cells.js";
import { type BudgetFile, budgetFailures, evaluateBudget } from "../budget/size-boot-ratchet.js";
import { requireDocker } from "./support/docker-probe.js";
import { installGeneratedProject } from "./support/npm-install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");
const budgetPath = path.join(repoRoot, "test", "budget", "size-boot-budget.json");

const SHARD = process.env.LOOM_SIZE_BOOT_CASE;
const ENABLED = process.env.LOOM_SIZE_BOOT === "1" || SHARD !== undefined;

// --- the fixture -------------------------------------------------------------

const DOMAIN = `
  subdomain Sales {
    context Orders {
      enum Status { Open, Closed }
      aggregate Customer with crudish { name: string  email: string  derived display: string = name }
      aggregate Order with crudish {
        code: string
        customer: Customer id
        status: Status
        total: money
        placed: datetime
      }
      repository Customers for Customer { }
      repository OrderRepo for Order { }
    }
  }
  api SalesApi from Sales
  storage db { type: postgres }
  resource st { for: Orders, kind: state, use: db }`;

const frontendSystem = (framework: string, pack: string): string => `
system Budget {${DOMAIN}
  ui Web with scaffold(aggregates: [Customer, Order]) {
    framework: ${framework}
    api Sales: SalesApi
  }
  deployable api { platform: node contexts: [Orders] dataSources: [st] serves: SalesApi port: 3000 }
  deployable web { platform: ${framework} design: "${pack}" targets: api ui: Web { Sales: api } port: 3001 }
}`;

const BOOT_PORT = 8080;
const backendSystem = (platform: string): string => `
system Budget {${DOMAIN}
  deployable api { platform: ${platform} contexts: [Orders] dataSources: [st] serves: SalesApi port: ${BOOT_PORT} }
}`;

// --- cells -------------------------------------------------------------------

type Cell = SizeBootCell;
const CELLS = SIZE_BOOT_CELLS;

// --- measuring ---------------------------------------------------------------

function generate(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-size-boot-"));
  fs.writeFileSync(path.join(dir, "main.ddd"), source);
  execFileSync(
    "node",
    [cli, "generate", "system", path.join(dir, "main.ddd"), "-o", path.join(dir, "out")],
    {
      stdio: "pipe",
    },
  );
  return path.join(dir, "out");
}

/** Every built js/css asset under the frontend's output dirs (vite `dist/`,
 *  SvelteKit static `build/`, Angular `dist/<app>/browser`). */
function builtAssets(webDir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(m?js|css)$/.test(e.name)) out.push(p);
    }
  };
  for (const sub of ["dist", "build"]) {
    const d = path.join(webDir, sub);
    if (fs.existsSync(d)) walk(d);
  }
  return out;
}

function measureBundle(cell: Extract<Cell, { kind: "bundle" }>): number {
  const out = generate(frontendSystem(cell.framework, cell.pack));
  try {
    const webDir = path.join(out, "web");
    installGeneratedProject(webDir);
    execFileSync("npm", ["run", "build"], { cwd: webDir, stdio: "pipe", timeout: 900_000 });
    const assets = builtAssets(webDir);
    // Vacuity guard: a build that emitted nothing would measure 0 and read as a
    // spectacular improvement.
    expect(assets.length, `${cell.key}: the build emitted no js/css`).toBeGreaterThan(0);
    return assets.reduce(
      (sum, f) => sum + zlib.gzipSync(fs.readFileSync(f), { level: 9 }).length,
      0,
    );
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
}

async function measureBoot(cell: Extract<Cell, { kind: "boot" }>): Promise<number> {
  requireDocker(`${cell.key} cold boot`);
  const out = generate(backendSystem(cell.platform));
  const compose = (...args: string[]) =>
    spawnSync("docker", ["compose", "-p", `loombudget${cell.platform}`, ...args], {
      cwd: out,
      encoding: "utf8",
      timeout: 1_800_000,
    });
  try {
    const built = compose("build");
    expect(built.status, `${cell.key}: image build failed\n${built.stderr}`).toBe(0);
    const t0 = Date.now();
    const up = compose("up", "-d");
    expect(up.status, `${cell.key}: compose up failed\n${up.stderr}`).toBe(0);
    const deadline = t0 + 300_000;
    let lastErr = "";
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${BOOT_PORT}/ready`);
        if (r.status === 200) return Date.now() - t0;
        lastErr = `HTTP ${r.status}`;
      } catch (e) {
        lastErr = String(e);
      }
      await new Promise((res) => setTimeout(res, 250));
    }
    const logs = compose("logs", "--no-color", "--tail", "80").stdout;
    throw new Error(`${cell.key}: /ready never answered 200 within 300s (${lastErr})\n${logs}`);
  } finally {
    // `--rmi local` drops the images this cell built, so a nightly that walks
    // five backends does not accumulate five toolchains' worth of layers.
    compose("down", "-v", "--remove-orphans", "--rmi", "local");
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  }
}

// --- the gate ----------------------------------------------------------------

describe.runIf(ENABLED)("size + cold-boot budget (M-T9.23)", () => {
  const cells = CELLS.filter((c) => SHARD === undefined || c.key === SHARD);

  it("the shard names a real cell", () => {
    expect(cells.length, `unknown LOOM_SIZE_BOOT_CASE=${SHARD}`).toBeGreaterThan(0);
  });

  it("every measured cell is within its budget, and every gain is pinned", async () => {
    const measured: Record<string, number> = {};
    for (const cell of cells) {
      measured[cell.key] = cell.kind === "bundle" ? measureBundle(cell) : await measureBoot(cell);
    }
    const report = process.env.LOOM_SIZE_BOOT_REPORT;
    if (report) fs.writeFileSync(report, `${JSON.stringify(measured, null, 2)}\n`);
    const budget = JSON.parse(fs.readFileSync(budgetPath, "utf8")) as BudgetFile;
    const verdicts = evaluateBudget(budget, measured, new Set(cells.map((c) => c.key)));
    console.log(JSON.stringify(verdicts, null, 2));
    expect(budgetFailures(verdicts)).toEqual([]);
  }, 3_600_000);
});
