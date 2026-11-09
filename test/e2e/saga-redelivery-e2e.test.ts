// Idempotent-consumer dedup, end to end: a durable envelope redelivered to a
// hosted saga consumer is a no-op.  The consumer's workflow lives in a
// different context than the durable channel, so its saga row only dedups if
// the marker is decided deployable-wide.  A redelivery is forced by clearing
// the outbox row's `dispatched_at`, which makes the local relay deliver the
// SAME row id again; without the `last_event_id` check the reactor runs twice
// and a second Note appears.
//
// Opt-in: LOOM_SAGA_REDELIVERY_E2E=1 (npm run test:saga-redelivery-java / -elixir).  Needs
// docker, and gradle + JDK 25 (java leg) / mix (elixir leg) on PATH.

import { type ChildProcess, execSync, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mixDepsGet } from "./support/mix-retry.js";

const ENABLED = process.env.LOOM_SAGA_REDELIVERY_E2E === "1";

// The consumer's workflow lives in a different context than the durable
// channel where the platform supports a cross-context subscription, so its saga
// row only dedups if the marker is decided deployable-wide.
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

/** The reactor's effect — one Note per run — is countable from outside. */
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
  platform: "java" | "elixir";
  crossContext: boolean;
  pgPort: number;
  appPort: number;
}
const LEGS: Leg[] = [
  { platform: "java", crossContext: true, pgPort: 55461, appPort: 4261 },
  { platform: "elixir", crossContext: false, pgPort: 55462, appPort: 4262 },
];

describe.skipIf(!ENABLED).each(LEGS)(
  "saga redelivery is a no-op ($platform)",
  ({ platform, crossContext, pgPort, appPort }) => {
    let dir: string;
    let app: ChildProcess | undefined;
    const pg = `loom-saga-redelivery-${platform}-pg`;
    const base = `http://localhost:${appPort}`;
    const psql = (sql: string): string =>
      sh(`docker exec ${pg} psql -U postgres -d d -At -c "${sql}"`);

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), `loom-saga-redelivery-${platform}-`));
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
      if (platform === "java") {
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
      } else {
        env = {
          DATABASE_URL: `postgres://postgres:postgres@localhost:${pgPort}/d`,
          MIX_ENV: "dev",
          PORT: String(appPort),
        };
        sh(mixDepsGet(), out, env);
        sh("mix ecto.migrate", out, env);
        cmd = "mix";
        args = ["phx.server"];
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
        platform === "java" ? 180_000 : 120_000,
        `${platform} /ready`,
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

    it("runs the reactor once for a redelivered envelope", async () => {
      const created = await post("/api/products", { sku: "s1" });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      expect((await post(`/api/products/${id}/record`, {})).ok).toBe(true);

      await waitFor(
        async () => (await instances()).some((i) => i.productId === id) && (await notes()) === 1,
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
      // Let the redelivered reactor settle before asserting the effect stayed single.
      await new Promise((r) => setTimeout(r, 2_000));
      expect(await notes()).toBe(1);
    }, 180_000);
  },
);
