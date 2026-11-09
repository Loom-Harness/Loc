// `every:` timer single-fire across replicas — runtime gate, one leg per backend.
//
// Claim: an `every:` timerSource fires ONCE per period while two replicas of
// its owning deployable run against one database (decision
// D-TIMER-SINGLE-FIRE).  No compile or string tier can observe this — it is a
// property of two live processes contending on one row.
//
// Each leg generates the fixture below for one backend, boots the generated
// `docker-compose.yml` as-is (`up --build --wait`), then starts a SECOND
// replica of the same service with `docker compose run --no-deps` (same image,
// same env, same network, no published port).  Every fire creates one
// `SweepRun` saga row stamped with the tick's fire time, so the rows written
// while both replicas are healthy are the fires: the leg asserts at most one
// row per period (`floor(epoch_ms / 2000)`) and that the timer kept firing.
//
// Opt-in: LOOM_TIMER_E2E=1 runs every backend; LOOM_TIMER_E2E_BACKENDS=node,python
// narrows it.  Behind a TLS-intercepting proxy, LOOM_E2E_CA_DIR=<dir of *.crt>
// copies the CAs into each image's `certs/` and builds on the host network with
// the predefined HTTPS_PROXY build arg (the e2e.test.ts knob).  Needs docker + the compose plugin (the Phoenix image's
// `mix deps.get` needs hex egress, as every Phoenix compose leg does).

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { declareRunPrecondition } from "./support/run-precondition.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const ALL_BACKENDS = ["node", "python", "dotnet", "java", "elixir"] as const;
type Backend = (typeof ALL_BACKENDS)[number];

const ENABLED = process.env.LOOM_TIMER_E2E === "1";
const SELECTED: Backend[] = (process.env.LOOM_TIMER_E2E_BACKENDS ?? ALL_BACKENDS.join(","))
  .split(",")
  .map((b) => b.trim())
  .filter((b): b is Backend => (ALL_BACKENDS as readonly string[]).includes(b));

/** The timer's period, and how many periods the measured window spans. */
const PERIOD_MS = 2_000;
const WINDOW_PERIODS = 12;

function hasComposeDocker(): boolean {
  try {
    execSync("docker compose version", { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

const RUN = declareRunPrecondition({
  suite: "timer single-fire e2e",
  gate: "LOOM_TIMER_E2E=1",
  enabled: ENABLED,
  requirements: [{ name: "a reachable docker daemon with compose", ok: hasComposeDocker() }],
});

function fixture(platform: Backend): string {
  return `
system Ticker {
  subdomain Ops {
    context Clock {
      aggregate Sweep { note: string }
      event SweepTick { sweep: Sweep id, at: datetime }
      workflow SweepRun {
        sweep: Sweep id
        firedAt: datetime
        create(t: SweepTick) by t.sweep { firedAt := t.at }
      }
    }
  }
  storage pg { type: postgres }
  resource clockState { for: Clock, kind: state, use: pg }
  api A from Ops
  deployable d { platform: ${platform}, contexts: [Clock], dataSources: [clockState], serves: A, port: 4000 }
  timerSource sweep { for: SweepTick, every: 2s }
}
`;
}

/** Behind a proxy (LOOM_E2E_CA_DIR set), build the image up front with a plain
 *  `docker build` on the host network, tagged with the name compose gives the
 *  service image, so `up` reuses it.  Returns the `up` flag to use. */
function prebuildBehindProxy(out: string, project: string): string {
  const caDir = process.env.LOOM_E2E_CA_DIR;
  if (!caDir || !fs.existsSync(caDir)) return "--build";
  for (const crt of fs.readdirSync(caDir).filter((f) => f.endsWith(".crt"))) {
    fs.copyFileSync(path.join(caDir, crt), path.join(out, "d", "certs", crt));
  }
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const args: string[] = [];
  if (proxy) {
    args.push(`--build-arg HTTPS_PROXY=${JSON.stringify(proxy)}`);
    // The JVM ignores HTTPS_PROXY: hand gradle the proxy as system properties
    // through a stage ARG (a stage ARG reaches its RUN steps as env).
    const dockerfile = path.join(out, "d", "Dockerfile");
    const text = fs.readFileSync(dockerfile, "utf8");
    if (text.includes("gradle")) {
      const url = new URL(proxy);
      fs.writeFileSync(dockerfile, text.replace(/^(FROM .* AS build)$/m, "$1\nARG JAVA_TOOL_OPTIONS"));
      args.push(
        `--build-arg JAVA_TOOL_OPTIONS="-Dhttps.proxyHost=${url.hostname} -Dhttps.proxyPort=${url.port}"`,
      );
    }
  }
  sh(`docker build --network host ${args.join(" ")} -t ${project}-d ./d`, out, 1_500_000);
  return "";
}

function sh(cmd: string, cwd: string, timeout = 120_000): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout });
}

function psql(cwd: string, project: string, query: string): string {
  return sh(
    `docker compose -p ${project} exec -T db psql -U postgres -d d -At -c ${JSON.stringify(query)}`,
    cwd,
  ).trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Wait until a container's healthcheck reports healthy. */
async function waitHealthy(container: string, cwd: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let status = "";
  while (Date.now() < deadline) {
    try {
      status = sh(`docker inspect -f '{{.State.Health.Status}}' ${container}`, cwd, 30_000).trim();
    } catch {
      status = "(inspect failed)";
    }
    if (status === "healthy") return;
    await sleep(2_000);
  }
  throw new Error(`replica ${container} not healthy after ${timeoutMs} ms (last: ${status})`);
}

describe.runIf(RUN)("every: timer fires once per period across two replicas", () => {
  for (const backend of SELECTED) {
    it(`${backend}: two replicas, one fire per period`, { timeout: 1_800_000 }, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `loom-timer-${backend}-`));
      const project = `loomtimer${backend}`;
      const second = `${project}-replica2`;
      const src = path.join(dir, "tick.ddd");
      fs.writeFileSync(src, fixture(backend));
      const out = path.join(dir, "out");
      sh(`node ${cli} generate system ${src} -o ${out}`, repoRoot);
      const compose = `docker compose -p ${project}`;
      try {
        const build = prebuildBehindProxy(out, project);
        sh(`${compose} up -d ${build} --wait`, out, 1_500_000);
        sh(`${compose} run -d --no-deps --name ${second} d`, out);
        await waitHealthy(second, out, 300_000);

        // The window opens once both replicas are healthy; measured on the
        // database clock, which is also the clock the claim reads.
        const t0 = psql(out, project, "SELECT now()");
        await sleep(WINDOW_PERIODS * PERIOD_MS);
        const t1 = psql(out, project, "SELECT now()");
        const running = sh(`docker inspect -f '{{.State.Running}}' ${second}`, out).trim();
        expect(running, "the second replica must still be running at the end of the window").toBe(
          "true",
        );

        const [fires, periods] = psql(
          out,
          project,
          `SELECT count(*), count(DISTINCT floor(extract(epoch FROM fired_at) * 1000 / ${PERIOD_MS})) ` +
            `FROM clock.sweep_runs WHERE fired_at >= '${t0}' AND fired_at < '${t1}'`,
        )
          .split("|")
          .map(Number);
        // One fire per period: no period holds two rows.
        expect(fires, `fires=${fires} over ${periods} distinct periods`).toBe(periods);
        // And the timer kept firing through the window (two periods of slack for
        // the partial periods at either edge).
        expect(fires).toBeGreaterThanOrEqual(WINDOW_PERIODS - 2);
      } catch (err) {
        try {
          console.error(sh(`${compose} logs --no-color --tail=80`, out));
          console.error(sh(`docker logs --tail=80 ${second}`, out));
        } catch {
          // best-effort diagnostics
        }
        throw err;
      } finally {
        try {
          execSync(`docker rm -f ${second}`, { stdio: "ignore", timeout: 60_000 });
          execSync(`${compose} down -v`, {
            cwd: out,
            stdio: "ignore",
            timeout: 180_000,
          });
        } catch {
          // best-effort teardown
        }
      }
    });
  }
});
