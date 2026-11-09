import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { mixDepsGet, mixLocalInstall } from "./support/mix-retry.js";
import {
  assertHierarchyIsolation,
  freePort,
  startPostgres,
  waitForReady,
} from "./support/tenancy-isolation-harness.js";

// ---------------------------------------------------------------------------
// The registry tree beside flat data visibility, booted on the vanilla Phoenix
// (plain Ecto/Phoenix) backend. Boots the `tenancy-hierarchy.ddd` corpus
// fixture (a registry `implements tenantRegistry` + `tenantOwned` aggregates
// under the default floor, `allow local` and `deny write`) against a throwaway
// postgres and runs the shared `assertHierarchyIsolation` sequence: every org
// reads exactly its own rows — a parent never its child's — no `data_key`
// column exists, and the write scope is the same floor. Opt-in:
// LOOM_TENANCY_E2E_ELIXIR=1. Needs elixir/mix on PATH + docker (postgres
// sidecar) or LOOM_TENANCY_PG_URL, and `psql`. Slow (~5-8 min cold).
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const ENABLED = process.env.LOOM_TENANCY_E2E_ELIXIR === "1";

function hasElixir(): boolean {
  try {
    execSync("mix --version", { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!ENABLED)(
  "registry-tree isolation over the generated vanilla Phoenix backend (LOOM_TENANCY_E2E_ELIXIR=1)",
  () => {
    it("each org reads only its own rows, whatever the registry tree — over the wire", async () => {
      if (!hasElixir())
        throw new Error(
          "LOOM_TENANCY_E2E_ELIXIR=1 set but `mix` is not on PATH. " +
            "Add `erlef/setup-beam@v1` (otp-version 27.x, elixir-version 1.18.x) to the workflow.",
        );
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-tenancy-hier-elixir-"));
      let child: ReturnType<typeof spawn> | undefined;
      let pg: Awaited<ReturnType<typeof startPostgres>> | undefined;
      try {
        const fixture = fs.readFileSync(
          path.join(repoRoot, "test", "fixtures", "corpus", "tenancy-hierarchy.ddd"),
          "utf8",
        );
        const dddPath = path.join(outDir, "tenancy-hierarchy-elixir.ddd");
        fs.writeFileSync(dddPath, fixture.replace("__PLATFORM__", "elixir"));
        execSync(`node ${cli} generate system ${dddPath} -o ${outDir}`, {
          stdio: "pipe",
          cwd: repoRoot,
        });
        const appDir = path.join(outDir, "d"); // deployable `d` → project root

        execSync(`${mixLocalInstall()} && ${mixDepsGet()}`, {
          cwd: appDir,
          stdio: "pipe",
          timeout: 600_000,
          shell: "/bin/bash",
        });

        pg = await startPostgres("hier-elixir");
        const dbUrl = `ecto://${pg.user}:${pg.password}@${pg.host}:${pg.port}/${pg.db}`;
        execSync("mix ecto.create && mix ecto.migrate", {
          cwd: appDir,
          stdio: "pipe",
          env: { ...process.env, DATABASE_URL: dbUrl, MIX_ENV: "dev" },
          timeout: 300_000,
          shell: "/bin/bash",
        });

        const port = await freePort();
        child = spawn("mix", ["phx.server"], {
          cwd: appDir,
          env: {
            ...process.env,
            DATABASE_URL: dbUrl,
            PHX_SERVER: "true",
            PORT: String(port),
            MIX_ENV: "dev",
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        });
        let bootLog = "";
        child.stdout?.on("data", (c: Buffer) => {
          bootLog += c.toString("utf8");
        });
        child.stderr?.on("data", (c: Buffer) => {
          bootLog += c.toString("utf8");
        });
        const base = `http://127.0.0.1:${port}`;
        await waitForReady(base, () => bootLog, 180_000);

        await assertHierarchyIsolation(base, pg);
      } finally {
        if (child?.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill("SIGTERM");
          }
        }
        pg?.stop();
        try {
          fs.rmSync(outDir, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    }, 900_000);
  },
);
