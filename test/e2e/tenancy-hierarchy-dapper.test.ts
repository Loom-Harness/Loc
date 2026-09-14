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
// Hierarchy / `policy {}` read-ladder isolation on the SECOND .NET persistence
// adapter — `platform: dotnet { persistence: dapper }`.  Byte-for-byte the same
// harness as tenancy-hierarchy-dotnet.test.ts (the EF Core leg); only the
// realization clause substituted into the fixture differs.  The MikroORM leg
// (tenancy-hierarchy-mikroorm.test.ts) is the node-side twin of this argument.
//
// Why a second .NET leg rather than a parameter on the first: the subtree
// predicate is the ONE filter shape whose two .NET adapters lower through
// completely different machinery.  EF Core registers a `HasQueryFilter`
// expression tree and lets the provider translate `StartsWith` / `EF.Functions
// .Like`; Dapper has no model-level filter at all, so the predicate is a raw
// SQL STRING spliced into every SELECT with four named parameters bound by
// hand.  A raw fragment is exactly the construct a compile tier cannot check:
// a parameter the fragment names but the anonymous object never binds is a
// runtime "parameter not supplied", a filter reaching three of four reads is a
// cross-tenant leak, and `dotnet build /warnaserror` is green on both.
//
// This adapter was REFUSED on this shape until wave C2 packet 2b
// (`loom.dapper-unsupported#deep-scope`), so there was nothing to run; the
// refusal's stated reason — that the principal claims could not be bound — is
// what this leg now falsifies at runtime rather than on paper.
//
// And the assertion set is the one that matters for this rendering choice: the
// harness seeds the WILDCARD trap (`orgXa.leak`, unreachable from `org_a` only
// if the prefix test escapes the `_` in the caller's own path) and the
// DELIMITER trap (`org_ab` vs `org_a`) alongside the ordinary subtree reads, so
// a `LIKE`-shaped regression fails here even though it compiles.
//
// Opt-in: LOOM_TENANCY_E2E_DAPPER=1.  Needs the .NET SDK on PATH + docker
// (postgres sidecar) or LOOM_TENANCY_PG_URL.  The NULL-dataKey probe needs
// `psql` too.
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
  "hierarchy policy-ladder isolation over the generated .NET/Dapper backend (LOOM_TENANCY_E2E_DAPPER=1)",
  () => {
    it("deep/global/local reads scope to the org subtree — over the wire", async () => {
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
