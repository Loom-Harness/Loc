// Eval item #24 — a generated stack must survive a database that is not
// reachable YET.  Two halves:
//
//   1. compose: every app service carries `restart: unless-stopped`, so a
//      backend that gives up (or crashes later) comes back on its own instead
//      of leaving the stack half-dead — `depends_on: service_healthy` only
//      orders the FIRST `up`.
//   2. each of the five backends retries its boot-time migration run with the
//      shared capped-backoff policy (`BOOT_DB_RETRY`) while the failure is
//      connection-shaped, logging the catalog `db_connect_retry` event — and
//      still gives up after `maxAttempts` (a db that never comes up must fail
//      boot, loudly).
//
// Before the fix: `grep -c 'restart:' docker-compose.yml` = 0 and every
// backend's boot migrate was a one-shot that rethrew on ECONNREFUSED.

import { describe, expect, it } from "vitest";
import {
  BOOT_DB_RETRY,
  bootDbRetryBudgetMs,
  bootDbRetryDelayMs,
} from "../../src/generator/_obs/boot-db-retry.js";
import { expectEmitted } from "../_helpers/emitted.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const FIVE_BACKENDS = `
system Acme {
  subdomain Core {
    context A { aggregate Aa with crudish { name: string } repository Aas for Aa { } }
    context B { aggregate Bb with crudish { name: string } repository Bbs for Bb { } }
    context C { aggregate Cc with crudish { name: string } repository Ccs for Cc { } }
    context D { aggregate Dd with crudish { name: string } repository Dds for Dd { } }
    context E { aggregate Ee with crudish { name: string } repository Ees for Ee { } }
  }
  storage primary { type: postgres }
  resource aState { for: A, kind: state, use: primary }
  resource bState { for: B, kind: state, use: primary }
  resource cState { for: C, kind: state, use: primary }
  resource dState { for: D, kind: state, use: primary }
  resource eState { for: E, kind: state, use: primary }
  deployable nodeSvc   { platform: node   contexts: [A] dataSources: [aState] port: 3000 }
  deployable pySvc     { platform: python contexts: [B] dataSources: [bState] port: 3001 }
  deployable netSvc    { platform: dotnet contexts: [C] dataSources: [cState] port: 3002 }
  deployable javaSvc   { platform: java   contexts: [D] dataSources: [dState] port: 3003 }
  deployable exSvc     { platform: elixir contexts: [E] dataSources: [eState] port: 3004 }
}
`;

/** Top-level service blocks of a compose file, keyed by service name. */
function composeServices(compose: string): Map<string, string> {
  const out = new Map<string, string>();
  const body = compose.split(/^services:\n/m)[1] ?? "";
  let name: string | undefined;
  let acc: string[] = [];
  for (const line of body.split("\n")) {
    const head = /^ {2}([a-z0-9_-]+):\s*$/.exec(line);
    if (head || /^\S/.test(line)) {
      if (name) out.set(name, acc.join("\n"));
      name = head?.[1];
      acc = [];
      if (!head) break;
      continue;
    }
    acc.push(line);
  }
  if (name) out.set(name, acc.join("\n"));
  return out;
}

describe("boot-db-retry policy (#24)", () => {
  it("is capped exponential backoff with a finite budget", () => {
    expect(bootDbRetryDelayMs(1)).toBe(BOOT_DB_RETRY.baseDelayMs);
    expect(bootDbRetryDelayMs(2)).toBe(BOOT_DB_RETRY.baseDelayMs * 2);
    expect(bootDbRetryDelayMs(BOOT_DB_RETRY.maxAttempts)).toBe(BOOT_DB_RETRY.maxDelayMs);
    // Long enough to ride out a Postgres cold start, short enough that a db
    // that never appears still fails boot within a minute.
    expect(bootDbRetryBudgetMs()).toBeGreaterThanOrEqual(30_000);
    expect(bootDbRetryBudgetMs()).toBeLessThanOrEqual(120_000);
  });
});

describe("generated stack survives a late database (#24)", async () => {
  const files = await generateSystemFiles(FIVE_BACKENDS);
  const compose = expectEmitted(files, "docker-compose.yml");
  const { maxAttempts, baseDelayMs, maxDelayMs } = BOOT_DB_RETRY;

  it("every app service in compose carries `restart: unless-stopped`", () => {
    const services = composeServices(compose);
    const apps = ["node_svc", "py_svc", "net_svc", "java_svc", "ex_svc"];
    for (const app of apps) {
      const block = services.get(app);
      expect(block, `compose service ${app}`).toBeDefined();
      expect(block, app).toMatch(/^ {4}restart: unless-stopped$/m);
    }
    // Infrastructure is not an app service — the db keeps its own lifecycle.
    expect(services.get("db") ?? "").not.toContain("restart:");
  });

  it("node retries the boot drizzle migrate on connection-shaped failures only", () => {
    const index = expectEmitted(files, "node_svc/index.ts");
    expect(index).toContain(`for (let attempt = 1, maxAttempts = ${maxAttempts}; ; attempt++) {`);
    expect(index).toContain(`Math.min(${baseDelayMs} * 2 ** (attempt - 1), ${maxDelayMs})`);
    expect(index).toContain("if (attempt < maxAttempts && reason !== undefined) {");
    expect(index).toContain('"ECONNREFUSED"');
    expect(index).toContain('event: "db_connect_retry"');
    // The retry wraps the migrate call itself, and a non-transient failure
    // still logs migration_failed and aborts boot.
    const loop = index.slice(index.indexOf("for (let attempt = 1"));
    expect(loop.indexOf("await migrate(db")).toBeGreaterThan(-1);
    expect(loop.indexOf("await migrate(db")).toBeLessThan(loop.indexOf("db_connect_retry"));
    expect(loop).toContain('event: "migration_failed"');
  });

  it("python waits for the database before the migration transaction", () => {
    const migrate = expectEmitted(files, "py_svc/app/db/migrate.py");
    expect(migrate).toContain(`_DB_CONNECT_MAX_ATTEMPTS = ${maxAttempts}`);
    expect(migrate).toContain("except (OSError, OperationalError, InterfaceError) as exc:");
    expect(migrate).toContain('"db_connect_retry"');
    const run = migrate.slice(migrate.indexOf("async def run_migrations"));
    expect(run.indexOf("await wait_for_db(target)")).toBeGreaterThan(-1);
    expect(run.indexOf("await wait_for_db(target)")).toBeLessThan(
      run.indexOf("async with target.begin()"),
    );
  });

  it(".NET probes the connection with transient-only retry before EF Migrate", () => {
    const program = expectEmitted(files, "net_svc/Program.cs");
    expect(program).toContain("static async Task LoomWaitForDbAsync(");
    expect(program).toContain(`const int maxAttempts = ${maxAttempts};`);
    expect(program).toContain("when (attempt < maxAttempts && IsTransientDbError(dbError))");
    expect(program).toContain("Npgsql.NpgsqlException { IsTransient: true }");
    expect(program).toContain('"db_connect_retry"');
    const wait = program.indexOf("await LoomWaitForDbAsync(");
    expect(wait).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(program.indexOf("db.Database.Migrate();"));
  });

  it("java keeps Hikari retrying the first connection for the shared budget", () => {
    const yml = expectEmitted(files, "java_svc/src/main/resources/application.yml");
    expect(yml).toMatch(
      new RegExp(
        `^ {2}datasource:\\n(?: {4}.*\\n)*? {4}hikari:\\n {6}initialization-fail-timeout: ${bootDbRetryBudgetMs()}$`,
        "m",
      ),
    );
  });

  it("elixir retries the release migrate on DBConnection.ConnectionError", () => {
    const release = Array.from(files.entries()).find(([p]) =>
      /^ex_svc\/lib\/[a-z_]+\/release\.ex$/.test(p),
    )?.[1];
    expect(release, "ex_svc release.ex").toBeDefined();
    expect(release).toContain(`@db_connect_max_attempts ${maxAttempts}`);
    expect(release).toContain("migrate_with_retry(repo, 1)");
    expect(release).toContain("error in DBConnection.ConnectionError ->");
    expect(release).toContain(`min(${baseDelayMs} * Integer.pow(2, attempt - 1), ${maxDelayMs})`);
    expect(release).toContain('Logger.warning("db_connect_retry"');
    expect(release).toContain("reraise error, __STACKTRACE__");
  });
});
