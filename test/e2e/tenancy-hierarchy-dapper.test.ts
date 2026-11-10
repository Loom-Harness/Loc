import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import {
  assertHierarchyIsolation,
  freePort,
  startPostgres,
  waitForReady,
} from "./support/tenancy-isolation-harness.js";

// ---------------------------------------------------------------------------
// The registry tree beside flat data visibility, booted on the .NET with
// `persistence: dapper` (raw SQL filter fragments, not a model-level filter)
// backend. Boots the `tenancy-hierarchy.ddd` corpus fixture (a registry
// `implements tenantRegistry` + `tenantOwned` aggregates under the default
// floor, `allow local` and `deny write`) against a throwaway postgres and runs
// the shared `assertHierarchyIsolation` sequence: every org reads exactly its
// own rows — a parent never its child's — no `data_key` column exists, and the
// write scope is the same floor. Opt-in: LOOM_TENANCY_E2E_DAPPER=1. Needs the
// .NET SDK on PATH + docker (postgres sidecar) or LOOM_TENANCY_PG_URL, and
// `psql`.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const ENABLED = process.env.LOOM_TENANCY_E2E_DAPPER === "1";

function hasDotnet(): boolean {
  try {
    execSync("dotnet --version", { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!ENABLED)(
  "registry-tree isolation over the generated .NET/Dapper backend (LOOM_TENANCY_E2E_DAPPER=1)",
  () => {
    it("each org reads only its own rows, whatever the registry tree — over the wire", async () => {
      if (!hasDotnet())
        throw new Error("LOOM_TENANCY_E2E_DAPPER=1 set but `dotnet` is not on PATH.");
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-tenancy-hier-dapper-"));
      let child: ReturnType<typeof spawn> | undefined;
      let pg: Awaited<ReturnType<typeof startPostgres>> | undefined;
      try {
        const fixture = fs.readFileSync(
          path.join(repoRoot, "test", "fixtures", "corpus", "tenancy-hierarchy.ddd"),
          "utf8",
        );
        const dddPath = path.join(outDir, "tenancy-hierarchy-dapper.ddd");
        fs.writeFileSync(
          dddPath,
          fixture.replace("__PLATFORM__", "dotnet { persistence: dapper }"),
        );
        execSync(`node ${cli} generate system ${dddPath} -o ${outDir}`, {
          stdio: "pipe",
          cwd: repoRoot,
        });
        const appDir = path.join(outDir, "d"); // deployable `d`

        execSync("dotnet restore", { cwd: appDir, stdio: "pipe", timeout: 300_000 });

        pg = await startPostgres("hier-dapper");
        const conn = `Host=${pg.host};Port=${pg.port};Database=${pg.db};Username=${pg.user};Password=${pg.password}`;

        const port = await freePort();
        child = spawn("dotnet", ["run", "--no-restore", "--no-launch-profile"], {
          cwd: appDir,
          env: {
            ...process.env,
            ConnectionStrings__Default: conn,
            ASPNETCORE_URLS: `http://127.0.0.1:${port}`,
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
    }, 600_000);
  },
);
