import { type ChildProcess, execSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { mixDepsGet, mixLocalInstall } from "./support/mix-retry.js";
import { installGeneratedProject } from "./support/npm-install.js";
import {
  assertOrgContextGate,
  freePort,
  type Postgres,
  startPostgres,
  waitForReady,
} from "./support/tenancy-isolation-harness.js";

// ---------------------------------------------------------------------------
// `organizationContext` — the operating-scope switch gate, proven on a BOOTED
// generated app per backend (M-T3.6 items 3+5; docs/tenancy.md →
// "organizationContext").  The `tenancy-e2e` sibling of the hierarchy legs.
//
// The accessor re-roots the tenant write stamp onto a caller-SUBMITTED value
// (the `x-org-context` header), so it is only safe with a fail-closed gate on
// every backend.  The structural tier pins that each backend EMITS the gate
// (`test/generator/org-context-gate.test.ts`); only a boot proves it HOLDS: the
// middleware runs before the handler, the switched value reaches the stamp,
// and a refused switch writes nothing.  The shared `assertOrgContextGate`
// sequence drives all four arms (in-scope switch → sub-scope stamp + deep
// visibility; out-of-subtree switch → 403 + no write; forged header on an
// orgPath-less token → 403 + no write; reads principal-anchored) plus the
// catalog `org_context_denied` log line.
//
// One file, one `describe` per backend, each behind the SAME env var its
// hierarchy sibling uses, so a `tenancy-e2e` matrix cell runs exactly one boot:
//
//   node    LOOM_TENANCY_E2E=1         npm run test:tenancy-org-context
//   python  LOOM_TENANCY_E2E_PYTHON=1  npm run test:tenancy-org-context-python
//   java    LOOM_TENANCY_E2E_JAVA=1    npm run test:tenancy-org-context-java
//   dotnet  LOOM_TENANCY_E2E_DOTNET=1  npm run test:tenancy-org-context-dotnet
//   elixir  LOOM_TENANCY_E2E_ELIXIR=1  npm run test:tenancy-org-context-elixir
//
// LOOM_TENANCY_PG_URL=postgres://… skips the docker sidecar.  Needs `psql`
// (the no-write assertions read the table directly).
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

interface Booted {
  child: ChildProcess;
  base: string;
  log: () => string;
}

/** Generate the `org-context` fixture for `platform` into a fresh dir; returns
 *  the deployable's project dir and the temp root to clean up. */
function generate(platform: string): { appDir: string; outDir: string } {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `loom-org-context-${platform}-`));
  const fixture = fs.readFileSync(
    path.join(repoRoot, "test", "fixtures", "corpus", "org-context.ddd"),
    "utf8",
  );
  const dddPath = path.join(outDir, `org-context-${platform}.ddd`);
  fs.writeFileSync(dddPath, fixture.replace("__PLATFORM__", platform));
  execSync(`node ${cli} generate system ${dddPath} -o ${outDir}`, { stdio: "pipe", cwd: repoRoot });
  return { appDir: path.join(outDir, "d"), outDir };
}

function capture(child: ChildProcess): () => string {
  let log = "";
  child.stdout?.on("data", (c: Buffer) => {
    log += c.toString("utf8");
  });
  child.stderr?.on("data", (c: Buffer) => {
    log += c.toString("utf8");
  });
  return () => log;
}

function has(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "pipe", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

type Boot = (appDir: string, pg: Postgres, port: number) => Promise<ChildProcess>;

const BOOTS: Record<string, { env: string; tool?: string; readyMs: number; boot: Boot }> = {
  node: {
    env: "LOOM_TENANCY_E2E",
    readyMs: 90_000,
    boot: async (appDir, pg, port) => {
      installGeneratedProject(appDir, { timeout: 180_000 });
      return spawn("npx", ["tsx", "index.ts"], {
        cwd: appDir,
        env: {
          ...process.env,
          DATABASE_URL: `postgres://${pg.user}:${pg.password}@${pg.host}:${pg.port}/${pg.db}`,
          PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    },
  },
  python: {
    env: "LOOM_TENANCY_E2E_PYTHON",
    tool: "uv --version",
    readyMs: 120_000,
    boot: async (appDir, pg, port) => {
      execSync("uv sync", { cwd: appDir, stdio: "pipe", timeout: 300_000 });
      return spawn(
        path.join(appDir, ".venv", "bin", "python"),
        ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)],
        {
          cwd: appDir,
          env: {
            ...process.env,
            DATABASE_URL: `postgresql+asyncpg://${pg.user}:${pg.password}@${pg.host}:${pg.port}/${pg.db}`,
            PORT: String(port),
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        },
      );
    },
  },
  java: {
    env: "LOOM_TENANCY_E2E_JAVA",
    tool: "gradle --version",
    readyMs: 120_000,
    boot: async (appDir, pg, port) => {
      execSync("gradle --no-daemon -q bootJar", { cwd: appDir, stdio: "pipe", timeout: 600_000 });
      const jar = fs
        .readdirSync(path.join(appDir, "build", "libs"))
        .find((f) => f.endsWith(".jar") && !f.endsWith("-plain.jar"));
      if (!jar) throw new Error("bootJar produced no runnable jar");
      // The toolchain JDK (Java 25); a stale PATH `java` cannot load v69 classes.
      const javaBin = process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, "bin", "java")
        : "java";
      return spawn(javaBin, ["-jar", path.join("build", "libs", jar)], {
        cwd: appDir,
        env: {
          ...process.env,
          SPRING_DATASOURCE_URL: `jdbc:postgresql://${pg.host}:${pg.port}/${pg.db}`,
          SPRING_DATASOURCE_USERNAME: pg.user,
          SPRING_DATASOURCE_PASSWORD: pg.password,
          SERVER_PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    },
  },
  dotnet: {
    env: "LOOM_TENANCY_E2E_DOTNET",
    tool: "dotnet --version",
    readyMs: 180_000,
    boot: async (appDir, pg, port) => {
      execSync("dotnet restore", { cwd: appDir, stdio: "pipe", timeout: 300_000 });
      return spawn("dotnet", ["run", "--no-restore", "--no-launch-profile"], {
        cwd: appDir,
        env: {
          ...process.env,
          ConnectionStrings__Default: `Host=${pg.host};Port=${pg.port};Database=${pg.db};Username=${pg.user};Password=${pg.password}`,
          ASPNETCORE_URLS: `http://127.0.0.1:${port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    },
  },
  elixir: {
    env: "LOOM_TENANCY_E2E_ELIXIR",
    tool: "mix --version",
    readyMs: 180_000,
    boot: async (appDir, pg, port) => {
      execSync(`${mixLocalInstall()} && ${mixDepsGet()}`, {
        cwd: appDir,
        stdio: "pipe",
        timeout: 600_000,
        shell: "/bin/bash",
      });
      const dbUrl = `ecto://${pg.user}:${pg.password}@${pg.host}:${pg.port}/${pg.db}`;
      execSync("mix ecto.create && mix ecto.migrate", {
        cwd: appDir,
        stdio: "pipe",
        env: { ...process.env, DATABASE_URL: dbUrl, MIX_ENV: "dev" },
        timeout: 300_000,
        shell: "/bin/bash",
      });
      return spawn("mix", ["phx.server"], {
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
    },
  },
};

for (const [platform, spec] of Object.entries(BOOTS)) {
  describe.skipIf(process.env[spec.env] !== "1")(
    `organizationContext switch gate over the generated ${platform} backend (${spec.env}=1)`,
    () => {
      it("an in-scope switch stamps the sub-scope; an out-of-scope or forged one is 403 with no write", async () => {
        if (spec.tool && !has(spec.tool)) {
          throw new Error(`${spec.env}=1 set but \`${spec.tool.split(" ")[0]}\` is not on PATH.`);
        }
        const { appDir, outDir } = generate(platform);
        let booted: Booted | undefined;
        let pg: Postgres | undefined;
        try {
          pg = await startPostgres(`orgctx-${platform}`);
          const port = await freePort();
          const child = await spec.boot(appDir, pg, port);
          booted = { child, base: `http://127.0.0.1:${port}`, log: capture(child) };
          await waitForReady(booted.base, booted.log, spec.readyMs);
          await assertOrgContextGate(booted.base, pg, booted.log);
        } finally {
          const pid = booted?.child.pid;
          if (pid) {
            try {
              process.kill(-pid, "SIGTERM");
            } catch {
              booted?.child.kill("SIGTERM");
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
}
