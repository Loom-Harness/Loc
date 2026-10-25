import { execSync, spawn } from "node:child_process";
import { describe, it } from "vitest";
import * as harness from "./support/migration-evolution-harness.js";
import {
  type BackendDriver,
  handleFor,
  type PgConn,
  runDapperLegacyBaselineGate,
  runMigrationEvolutionGate,
} from "./support/migration-evolution-harness.js";

// ---------------------------------------------------------------------------
// Migration-evolution gate (M-T2.13) — .NET/ASP.NET Core backend, on BOTH of
// its persistence adapters.  Sibling of migration-evolution.test.ts; same
// fixtures + shared checks, boots via `dotnet run` (which recompiles the
// regenerated migration on reboot).
//
//   - EF Core (default) — migrations apply at boot via `Database.Migrate()`
//     (`__EFMigrationsHistory`).  Opt-in: LOOM_MIGRATION_E2E_DOTNET=1.
//   - Dapper (`persistence: dapper`, M-T2.17) — the SAME MigrationsIR chain as
//     versioned `Migrations/*.cs`, applied at boot by `DbSchema.EnsureAsync`
//     (`public.__loom_migrations`).  Opt-in: LOOM_MIGRATION_E2E_DAPPER=1 (its
//     own CI matrix cell).  Every gate the EF leg runs, the Dapper leg runs
//     too, plus the transition case only Dapper has: baselining a database
//     its old `CREATE TABLE IF NOT EXISTS` bootstrap provisioned.
//
// Needs the .NET SDK + docker (postgres sidecar) or LOOM_MIGRATION_PG_URL, plus
// host `psql`.
// ---------------------------------------------------------------------------

const EF_ENABLED = process.env.LOOM_MIGRATION_E2E_DOTNET === "1";
const DAPPER_ENABLED = process.env.LOOM_MIGRATION_E2E_DAPPER === "1";

/** The .NET boot recipe; `platform` is `dotnet` (EF Core) or `dapper` — the
 *  harness's `generate` expands the latter to `dotnet { persistence: dapper }`. */
function dotnetDriver(platform: "dotnet" | "dapper"): BackendDriver {
  return {
    platform,
    toolchain: {
      name: "dotnet",
      check: () => {
        try {
          execSync("dotnet --version", { stdio: "pipe", timeout: 15_000 });
          return true;
        } catch {
          return false;
        }
      },
    },
    install(appDir) {
      execSync("dotnet restore", { cwd: appDir, stdio: "pipe", timeout: 300_000 });
    },
    boot(appDir, pg: PgConn, port) {
      const conn = `Host=${pg.host};Port=${pg.port};Database=${pg.db};Username=${pg.user};Password=${pg.password}`;
      // `dotnet run` (no --no-build) recompiles, so the regenerated migration is
      // picked up on the v2 reboot without a separate rebuild step.
      const child = spawn("dotnet", ["run", "--no-restore", "--no-launch-profile"], {
        cwd: appDir,
        env: {
          ...process.env,
          ConnectionStrings__Default: conn,
          ASPNETCORE_URLS: `http://127.0.0.1:${port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
      return handleFor(child, `http://127.0.0.1:${port}`).handle;
    },
    readyTimeoutMs: 240_000,
  };
}

describe.skipIf(!EF_ENABLED)(
  "migration-evolution gate over the generated .NET backend (LOOM_MIGRATION_E2E_DOTNET=1)",
  () => {
    it("migrate-chain ≡ fresh-create, and seeded rows survive forward-migrate", async () => {
      await runMigrationEvolutionGate(dotnetDriver("dotnet"));
    }, 900_000);
  },
);

describe.skipIf(!DAPPER_ENABLED)(
  "migration-evolution gate over the generated .NET backend on persistence: dapper (LOOM_MIGRATION_E2E_DAPPER=1)",
  () => {
    it("migrate-chain ≡ fresh-create, and seeded rows survive forward-migrate", async () => {
      await runMigrationEvolutionGate(dotnetDriver("dapper"));
    }, 900_000);

    it("baselines a database the pre-migration DbSchema bootstrap provisioned, then migrates it", async () => {
      await runDapperLegacyBaselineGate(dotnetDriver("dapper"));
    }, 900_000);

    // The unique-index evolution gate (#3229 / #3248 — a `unique` across a
    // softDeletable flip, a TPC/TPH inherited key) lands in the harness on a
    // sibling branch of this stack.  Looked up by NAME so the Dapper leg runs
    // it the moment the stack merges, without a second edit here; until then
    // the case is skipped and says why.
    const uniqueGate = (harness as Record<string, unknown>).runUniqueIndexEvolutionGate as
      | ((d: BackendDriver) => Promise<void>)
      | undefined;
    it.skipIf(!uniqueGate)(
      "unique-index evolution: rebuilds the index across a softDeletable flip; inherited keys enforce per table / hierarchy",
      async () => {
        await uniqueGate!(dotnetDriver("dapper"));
      },
      900_000,
    );
  },
);
