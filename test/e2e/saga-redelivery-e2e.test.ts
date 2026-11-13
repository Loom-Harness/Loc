// Idempotent-consumer dedup, end to end: a durable envelope redelivered to a
// hosted consumer is a no-op.  The consumers live in a different context than
// the durable channel, so they only dedup if the decision is deployable-wide.
// A redelivery is forced by clearing the outbox row's `dispatched_at`, which
// makes the local relay deliver the SAME row id again.
//
//   - saga reactor (java, elixir): without the `last_event_id` check the
//     reactor runs twice and a second Note appears;
//   - projection fold (every backend, D-PROJECTION-FOLD-INBOX): without the
//     fold-inbox claim the `seen += 1` fold counts the event twice.
//
// Opt-in: LOOM_SAGA_REDELIVERY_E2E=1 (npm run test:saga-redelivery-<backend>).
// Needs docker, plus the leg's toolchain on PATH: gradle + JDK 25 (java), mix
// (elixir), npm (node, node-mikroorm), uv (python), the .NET SDK (dotnet,
// dotnet-dapper).

import { type ChildProcess, execSync, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mixDepsGet } from "./support/mix-retry.js";
import { installGeneratedProject } from "./support/npm-install.js";

const ENABLED = process.env.LOOM_SAGA_REDELIVERY_E2E === "1";

// The consumer's workflow lives in a different context than the durable
// channel, so its saga row only dedups if the marker is decided deployable-wide.
const fixture = (platform: string, crossContext: boolean): string => `
system SagaRedelivery {
  subdomain Catalog {
    context Catalog {
      aggregate Product with crudish {
        sku: string
        operation record() {
          emit ProductLogged { product: id, at: now() }
        }
      }
      repository Products for Product { }
      event ProductLogged { product: Product id, at: datetime }
      channel History { carries: ProductLogged delivery: queue retention: work }
${crossContext ? "" : feedContext("      ")}    }
  }
${
  crossContext
    ? `  subdomain Admin {
    context AdminFeed {
${feedContext("      ")}    }
  }
`
    : ""
}  api CatalogApi from Catalog
  storage pg { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: pg }
${crossContext ? "  resource adminState { for: AdminFeed, kind: state, use: pg }\n" : ""}  deployable d {
    platform: ${platform}
    contexts: [Catalog${crossContext ? ", AdminFeed" : ""}]
    dataSources: [catalogState${crossContext ? ", adminState" : ""}]
    serves: CatalogApi
    port: 4000
  }
}
`;

/** The reactor's effect — one Note per run — and the fold's — one count per
 *  application — are both countable from outside. */
function feedContext(indent: string): string {
  return [
    "aggregate Note with crudish { text: string }",
    "repository Notes for Note { }",
    "workflow Feed {",
    "  productId: Product id",
    "  seen: int",
    "  create(e: ProductLogged) by e.product {",
    "    seen := 1",
    '    let n = Note.create(text: "fed")',
    "  }",
    "}",
    "projection Tally keyed by product {",
    "  product: Product id",
    "  seen: int",
    "  on(e: ProductLogged) {",
    "    seen += 1",
    "  }",
    "}",
  ]
    .map((l) => `${indent}${l}\n`)
    .join("");
}

const sh = (cmd: string, cwd?: string, env: Record<string, string> = {}): string =>
  execSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600_000,
  }).toString();

async function waitFor(probe: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${label}`);
}

interface Leg {
  /** The leg's name: the `-t` filter of its `test:saga-redelivery-*` script. */
  backend: string;
  /** The deployable's `platform:` clause. */
  platform: string;
  /** The toolchain that builds and boots it. */
  boot: "java" | "elixir" | "node" | "python" | "dotnet";
  /** The saga reactor's dedup is asserted (the backends whose saga rows map
   *  `last_event_id` on this fixture). */
  saga: boolean;
  crossContext: boolean;
  pgPort: number;
  appPort: number;
}
const LEGS: Leg[] = (
  [
    { backend: "java", platform: "java", boot: "java", saga: true },
    { backend: "elixir", platform: "elixir", boot: "elixir", saga: true },
    { backend: "node", platform: "node", boot: "node", saga: false },
    {
      backend: "node-mikroorm",
      platform: "node { persistence: mikroorm }",
      boot: "node",
      saga: false,
    },
    { backend: "python", platform: "python", boot: "python", saga: false },
    { backend: "dotnet", platform: "dotnet", boot: "dotnet", saga: false },
    {
      backend: "dotnet-dapper",
      platform: "dotnet { persistence: dapper }",
      boot: "dotnet",
      saga: false,
    },
  ] satisfies Omit<Leg, "crossContext" | "pgPort" | "appPort">[]
).map((l, i) => ({ ...l, crossContext: true, pgPort: 55461 + i, appPort: 4261 + i }));

describe.skipIf(!ENABLED).each(LEGS)(
  "durable redelivery is a no-op ($backend)",
  ({ backend, platform, boot, saga, crossContext, pgPort, appPort }) => {
    let dir: string;
    let app: ChildProcess | undefined;
    const pg = `loom-saga-redelivery-${backend}-pg`;
    const base = `http://localhost:${appPort}`;
    const psql = (sql: string): string =>
      sh(`docker exec ${pg} psql -U postgres -d d -At -c "${sql}"`);

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), `loom-saga-redelivery-${backend}-`));
      writeFileSync(join(dir, "sys.ddd"), fixture(platform, crossContext));
      sh(`node ${join(process.cwd(), "bin/cli.js")} generate system sys.ddd -o out`, dir);
      sh(
        `docker run -d --rm --name ${pg} -e POSTGRES_PASSWORD=postgres -p ${pgPort}:5432 postgres:18-alpine`,
      );
      await waitFor(
        async () => {
          sh(`docker exec ${pg} psql -U postgres -c "CREATE DATABASE d;"`);
          return true;
        },
        60_000,
        "postgres accepting CREATE DATABASE",
      );
      const out = join(dir, "out", "d");
      let cmd: string;
      let args: string[];
      let env: Record<string, string>;
      if (boot === "java") {
        sh("gradle --no-daemon -q bootJar", out);
        const jar = readdirSync(join(out, "build", "libs")).find(
          (f) => f.endsWith(".jar") && !f.endsWith("-plain.jar"),
        );
        if (!jar) throw new Error("bootJar produced no runnable jar");
        cmd = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", "java") : "java";
        args = ["-jar", join("build", "libs", jar)];
        env = {
          SPRING_DATASOURCE_URL: `jdbc:postgresql://localhost:${pgPort}/d`,
          SPRING_DATASOURCE_USERNAME: "postgres",
          SPRING_DATASOURCE_PASSWORD: "postgres",
          SERVER_PORT: String(appPort),
        };
      } else if (boot === "elixir") {
        env = {
          DATABASE_URL: `postgres://postgres:postgres@localhost:${pgPort}/d`,
          MIX_ENV: "dev",
          PORT: String(appPort),
        };
        sh(mixDepsGet(), out, env);
        sh("mix ecto.migrate", out, env);
        cmd = "mix";
        args = ["phx.server"];
      } else if (boot === "node") {
        installGeneratedProject(out, { flags: [], timeout: 420_000 });
        env = {
          DATABASE_URL: `postgres://postgres:postgres@localhost:${pgPort}/d`,
          PORT: String(appPort),
        };
        cmd = join(out, "node_modules/.bin/tsx");
        args = ["index.ts"];
      } else if (boot === "python") {
        sh("uv sync --quiet", out);
        env = {
          DATABASE_URL: `postgresql+asyncpg://postgres:postgres@localhost:${pgPort}/d`,
          PORT: String(appPort),
        };
        cmd = "uv";
        args = ["run", "uvicorn", "app.main:app", "--port", String(appPort)];
      } else {
        sh("dotnet restore", out);
        env = {
          ConnectionStrings__Default: `Host=localhost;Port=${pgPort};Database=d;Username=postgres;Password=postgres`,
          ASPNETCORE_URLS: `http://0.0.0.0:${appPort}`,
        };
        cmd = "dotnet";
        args = ["run", "--no-restore", "--no-launch-profile"];
      }
      app = spawn(cmd, args, {
        cwd: out,
        detached: true,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const sink = (d: Buffer): void => appendFileSync(join(dir, "app.log"), d);
      app.stdout?.on("data", sink);
      app.stderr?.on("data", sink);
      await waitFor(
        async () => (await fetch(`${base}/ready`)).ok,
        boot === "java" || boot === "dotnet" ? 180_000 : 120_000,
        `${backend} /ready`,
      );
    }, 900_000);

    afterAll(async () => {
      if (app?.pid !== undefined) {
        for (const sig of ["SIGTERM", "SIGKILL"] as const) {
          try {
            process.kill(-app.pid, sig);
          } catch {
            /* already gone */
          }
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
      try {
        sh(`docker rm -f ${pg}`);
      } catch {
        /* already gone */
      }
      if (dir) rmSync(dir, { recursive: true, force: true });
    }, 60_000);

    const post = async (path: string, body: unknown): Promise<Response> =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const instances = async (): Promise<{ productId: string }[]> => {
      const res = await fetch(`${base}/api/workflows/feed/instances`);
      return res.ok ? ((await res.json()) as { productId: string }[]) : [];
    };
    const notes = async (): Promise<number> => {
      const res = await fetch(`${base}/api/notes`);
      return res.ok ? ((await res.json()) as { items: unknown[] }).items.length : -1;
    };

    const tally = async (product: string): Promise<number | undefined> => {
      const res = await fetch(`${base}/api/projections/tally/${product}`);
      return res.ok ? ((await res.json()) as { seen: number }).seen : undefined;
    };

    it("applies a redelivered envelope once", async () => {
      const created = await post("/api/products", { sku: "s1" });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect((await post(`/api/products/${id}/record`, {})).ok).toBe(true);

      await waitFor(
        async () =>
          (await tally(id)) === 1 &&
          (!saga || ((await instances()).some((i) => i.productId === id) && (await notes()) === 1)),
        30_000,
        "first delivery",
      );
      await waitFor(
        async () =>
          psql("SELECT count(*) FROM __loom_outbox WHERE dispatched_at IS NULL") === "0\n",
        30_000,
        "outbox drained",
      );

      // Redeliver the SAME envelope id: the relay picks the row up again.
      expect(psql("UPDATE __loom_outbox SET dispatched_at = NULL")).toContain("UPDATE");
      await waitFor(
        async () =>
          psql("SELECT count(*) FROM __loom_outbox WHERE dispatched_at IS NULL") === "0\n",
        30_000,
        "redelivery drained",
      );
      // Let the redelivered handlers settle before asserting the effects stayed single.
      await new Promise((r) => setTimeout(r, 2_000));
      expect(await tally(id)).toBe(1);
      if (saga) expect(await notes()).toBe(1);
    }, 180_000);
  },
);
