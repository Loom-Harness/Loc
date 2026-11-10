import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { installGeneratedProject } from "./support/npm-install.js";
import {
  assertHierarchyIsolation,
  freePort,
  startPostgres,
  waitForReady,
} from "./support/tenancy-isolation-harness.js";

// ---------------------------------------------------------------------------
// The registry tree beside flat data visibility, booted on the node with
// `persistence: mikroorm` (its own filter registration, not Drizzle's) backend.
// Boots the `tenancy-hierarchy.ddd` corpus fixture (a registry `implements
// tenantRegistry` + `tenantOwned` aggregates under the default floor, `allow
// local` and `deny write`) against a throwaway postgres and runs the shared
// `assertHierarchyIsolation` sequence: every org reads exactly its own rows — a
// parent never its child's — no `data_key` column exists, and the write scope
// is the same floor. Opt-in: LOOM_TENANCY_E2E_MIKROORM=1. Needs docker
// (postgres sidecar) or LOOM_TENANCY_PG_URL, and `psql`.
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const ENABLED = process.env.LOOM_TENANCY_E2E_MIKROORM === "1";

describe.skipIf(!ENABLED)(
  "registry-tree isolation over the generated node/mikroorm backend (LOOM_TENANCY_E2E_MIKROORM=1)",
  () => {
    it("each org reads only its own rows, whatever the registry tree — over the wire", async () => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "loom-tenancy-hier-mikro-"));
      let child: ReturnType<typeof spawn> | undefined;
      let pg: Awaited<ReturnType<typeof startPostgres>> | undefined;
      try {
        const fixture = fs.readFileSync(
          path.join(repoRoot, "test", "fixtures", "corpus", "tenancy-hierarchy.ddd"),
          "utf8",
        );
        const dddPath = path.join(outDir, "tenancy-hierarchy-mikroorm.ddd");
        fs.writeFileSync(
          dddPath,
          fixture.replace("__PLATFORM__", "node { persistence: mikroorm }"),
        );
        execSync(`node ${cli} generate system ${dddPath} -o ${outDir}`, {
          stdio: "pipe",
          cwd: repoRoot,
        });
        const appDir = path.join(outDir, "d"); // deployable `d`

        pg = await startPostgres("hier-mikro");
        const pgUrl = `postgres://${pg.user}:${pg.password}@${pg.host}:${pg.port}/${pg.db}`;

        installGeneratedProject(appDir, { timeout: 180_000 });
        const port = await freePort();
        child = spawn("npx", ["tsx", "index.ts"], {
          cwd: appDir,
          env: { ...process.env, DATABASE_URL: pgUrl, PORT: String(port) },
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
        await waitForReady(base, () => bootLog);

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
    }, 360_000);
  },
);
