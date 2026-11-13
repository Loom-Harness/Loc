// Lifecycle / chaos leg — the generated stack under normal operations, not just
// the happy path.  One cell per backend × persistence adapter.
//
// Each cell generates the fixture below, boots the GENERATED `docker-compose.yml`
// as-is, and walks it through what an operator does to a running service:
//
//   1. boot + write          — create an order, place it; the queue reactor
//                              creates its shipment.
//   2. stop + boot again     — the same image restarts against the migrated
//                              database: idempotent schema, the timer resumes,
//                              old rows read back.
//   3. regenerate + migrate  — a field added to the FIRST of two modules, the
//                              change recorded with `ddd migrate add`, the tree
//                              regenerated in place and rebuilt; old rows read,
//                              the new field writes.
//   4. broker outage (30 s)  — both brokers stopped and restored: the service
//                              keeps answering, a command that commits during
//                              the outage still succeeds, the consumer resumes.
//   5. DB pause (10 s)       — readiness reflects it, the service is not
//                              restarted, and it serves again once unpaused.
//   6. final                 — every compose service healthy, the service never
//                              restarted, it accepts IPv4, its log lines carry
//                              the shared envelope.
//   7. dead letter           — a reactor that fails every delivery is retried,
//                              then parked in its DLQ under the generated broker
//                              ACL.  Last, because the unmet form of this fact
//                              can crash-loop the consumer.
//   9. object store          — a workflow writes through its objectStore
//                              resource; the object lands in the dev MinIO
//                              sidecar's bucket.
//
// The claims come from the platform's operations contract
// (`src/platform/operations.ts`).  A fact the contract states as unmet (with
// the issue behind it in `gaps`) runs as a STRICT expected failure: it must
// still fail, and the moment it passes the cell fails, naming the fact to flip
// and the gap to delete.  So the leg never hides a known defect and never lets
// a fix land without the register catching up.
//
// Opt-in: LOOM_LIFECYCLE_E2E=1.  LOOM_LIFECYCLE_CELLS narrows the cells
// (`node,dotnet:dapper` — `<backend>[:<persistence>]`; default every backend on
// its default adapter).  Behind a TLS-intercepting proxy, LOOM_E2E_CA_DIR=<dir
// of *.crt> copies the CAs into the image's `certs/` and builds on the host
// network (the timer-e2e knob).  Needs docker + the compose plugin.

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PlatformOperations } from "../../src/platform/operations.js";
import { platformFor } from "../../src/platform/registry.js";
import { declareRunPrecondition } from "./support/run-precondition.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");

const BACKENDS = ["node", "python", "dotnet", "java", "elixir"] as const;
type Backend = (typeof BACKENDS)[number];
interface Cell {
  backend: Backend;
  persistence?: string;
}

const ENABLED = process.env.LOOM_LIFECYCLE_E2E === "1";
const CELLS: Cell[] = (process.env.LOOM_LIFECYCLE_CELLS ?? BACKENDS.join(","))
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean)
  .map((c) => {
    const [backend, persistence] = c.split(":");
    if (!(BACKENDS as readonly string[]).includes(backend!)) {
      throw new Error(`LOOM_LIFECYCLE_CELLS: unknown backend '${backend}'`);
    }
    return { backend: backend as Backend, persistence };
  });

/** The service's published port, and how long the outages last. */
const PORT = 4000;
const BROKER_OUTAGE_MS = 30_000;
const DB_PAUSE_MS = 10_000;

function hasComposeDocker(): boolean {
  try {
    execSync("docker compose version", { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

const RUN = declareRunPrecondition({
  suite: "lifecycle e2e",
  gate: "LOOM_LIFECYCLE_E2E=1",
  enabled: ENABLED,
  requirements: [{ name: "a reachable docker daemon with compose", ok: hasComposeDocker() }],
});

/** Two modules (contexts) in one database, a rabbitmq queue channel with a
 *  reactor, a redis ephemeral channel, and a timer.  `v2` adds a field to the
 *  FIRST module, so its migration is not the chain's last module. */
function fixture(cell: Cell, v2: boolean): string {
  const platform = cell.persistence
    ? `${cell.backend} { persistence: ${cell.persistence} }`
    : cell.backend;
  return `
system Lifecycle {
  subdomain Sales {
    context Orders {
      aggregate Order with crudish {
        customerId: string
        status: string${v2 ? "\n        priority: int?" : ""}
        operation place() {
          precondition status == "Draft"
          status := "Placed"
          emit OrderPlaced { order: id, customerId: customerId, at: now() }
          emit OrderPinged { order: id }
        }
      }
      repository Orders for Order {}
      event OrderPlaced { order: Order id, customerId: string, at: datetime }
      event OrderPinged { order: Order id }
      channel Lifecycle { carries: OrderPlaced  delivery: queue  retention: work }
      channel Pings { carries: OrderPinged  delivery: broadcast  retention: ephemeral }
    }
    context Shipping {
      aggregate Shipment with crudish {
        orderRef: Order id
        status: string
      }
      repository Shipments for Shipment {}
      workflow Fulfil {
        orderId: Order id
        create(p: OrderPlaced) by p.order {
          // A "poison" customer makes the reactor fail every delivery: the
          // consumer must retry it a bounded number of times, then park it.
          precondition p.customerId != "poison"
          let s = Shipment.create(orderRef: p.order, status: "Pending")
        }
      }
      // Writes one object through the object-store resource: the dev stack
      // must reach its MinIO sidecar, with the bucket already created.
      workflow Archive {
        create(note: string) {
          shippingFiles.put("notes/" + note, note)
        }
      }
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
  storage bus { type: rabbitmq }
  storage cache { type: redis }
  storage files { type: s3, config: { bucket: "lifecycle" } }
  resource ordersState { for: Orders, kind: state, use: pg }
  resource shippingState { for: Shipping, kind: state, use: pg }
  resource shippingFiles { for: Shipping, kind: objectStore, use: files }
  channelSource lifecycleBus { for: Lifecycle, use: bus }
  channelSource pingBus { for: Pings, use: cache }
  timerSource sweep { for: SweepTick, every: 2s }
  api A from Sales
  deployable d {
    platform: ${platform}
    contexts: [Orders, Shipping]
    dataSources: [ordersState, shippingState, shippingFiles]
    channels: [lifecycleBus, pingBus]
    serves: A
    port: ${PORT}
  }
}
`;
}

function sh(cmd: string, cwd: string, timeout = 120_000): string {
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitFor(label: string, ms: number, probe: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch {
      // not yet
    }
    await sleep(1_000);
  }
  throw new Error(`timed out after ${ms} ms waiting for: ${label}`);
}

/** One HTTP call to the service; never throws on a status, only on transport. */
async function call(
  method: string,
  route: string,
  body?: unknown,
  timeoutMs = 10_000,
): Promise<{ status: number; json: unknown }> {
  // A pooled keep-alive socket outlives a restarted service and fails the next
  // request with a bare "fetch failed": that is the client's socket, not the
  // service, so a dropped connection is retried.  A timeout is not.
  let res: Response | undefined;
  for (let attempt = 0; !res; attempt++) {
    try {
      res = await fetch(`http://localhost:${PORT}${route}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if ((err as Error).name !== "TypeError" || attempt >= 2) throw err;
      await sleep(500);
    }
  }
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // keep the text
  }
  return { status: res.status, json };
}

/** Behind a proxy (LOOM_E2E_CA_DIR set), build the image up front on the host
 *  network, tagged with the name compose gives the service image, so `up`
 *  reuses it.  Returns the `up` flag to use. */
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
    const dockerfile = path.join(out, "d", "Dockerfile");
    const text = fs.readFileSync(dockerfile, "utf8");
    if (text.includes("gradle") && !text.includes("ARG JAVA_TOOL_OPTIONS")) {
      const url = new URL(proxy);
      fs.writeFileSync(
        dockerfile,
        text.replace(/^(FROM .* AS build)$/m, "$1\nARG JAVA_TOOL_OPTIONS"),
      );
      args.push(
        `--build-arg JAVA_TOOL_OPTIONS="-Dhttps.proxyHost=${url.hostname} -Dhttps.proxyPort=${url.port}"`,
      );
    }
  }
  sh(`docker build --network host ${args.join(" ")} -t ${project}-d ./d`, out, 1_500_000);
  return "";
}

/** A contract fact.  Met → the check must pass.  Unmet → the check must still
 *  FAIL (a strict expected failure): a check that starts passing means the
 *  defect is fixed and the contract must say so. */
async function claim(
  ops: PlatformOperations,
  factPath: string,
  holds: boolean,
  label: string,
  check: () => Promise<void>,
): Promise<"held" | "expected-failure"> {
  if (holds) {
    await check();
    return "held";
  }
  const gap = ops.gaps?.[factPath];
  let passed = false;
  try {
    await check();
    passed = true;
  } catch (err) {
    console.log(`  expected failure — ${label} (${factPath}, ${gap}): ${(err as Error).message}`);
  }
  if (passed) {
    throw new Error(
      `${label} now holds — set \`${factPath}\` true in the platform's operations contract and delete its gap (${gap})`,
    );
  }
  return "expected-failure";
}

const ENVELOPE_KEYS = ["ts", "level", "event"] as const;

describe.runIf(RUN)("lifecycle: reboot, regenerate, broker outage, DB pause", () => {
  for (const cell of CELLS) {
    const id = cell.persistence ? `${cell.backend}:${cell.persistence}` : cell.backend;
    it(`${id}: survives normal operations`, { timeout: 3_600_000 }, async () => {
      const ops = platformFor(cell.backend).operations;
      const broker = ops.broker!;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `loom-lifecycle-${cell.backend}-`));
      const project = `loomlc${cell.backend}${cell.persistence ?? ""}`;
      const src = path.join(dir, "lifecycle.ddd");
      const out = path.join(dir, "out");
      const compose = `docker compose -p ${project}`;
      /** Requests that answered 5xx outside an expected-failure window. */
      const fivexx: string[] = [];
      const ok = async (method: string, route: string, body?: unknown) => {
        const r = await call(method, route, body);
        if (r.status >= 500) fivexx.push(`${method} ${route} → ${r.status}`);
        return r;
      };
      const generate = (v2: boolean, migration: string) => {
        fs.writeFileSync(src, fixture(cell, v2));
        sh(`node ${cli} migrate add ${migration} ${src}`, dir);
        sh(`node ${cli} generate system ${src} -o ${out}`, dir);
      };
      const up = () =>
        sh(`${compose} up -d ${prebuildBehindProxy(out, project)} --wait`, out, 1_800_000);
      const container = () => sh(`${compose} ps -q d`, out).trim();
      const restarts = () =>
        Number(sh(`docker inspect -f '{{.RestartCount}}' ${container()}`, out));
      const placeOrder = async (customerId: string, extra: Record<string, unknown> = {}) => {
        const created = await ok("POST", "/api/orders", { customerId, status: "Draft", ...extra });
        expect(created.status, JSON.stringify(created.json)).toBe(201);
        const orderId = (created.json as { id: string }).id;
        const placed = await call("POST", `/api/orders/${orderId}/place`, {});
        return { orderId, placed };
      };
      const shipped = async (orderId: string, ms: number) =>
        waitFor(`a shipment for order ${orderId}`, ms, async () => {
          const r = await call("GET", "/api/shipments?pageSize=200");
          const items = (r.json as { items?: { orderRef: string }[] }).items ?? [];
          return items.some((s) => s.orderRef === orderId);
        });
      const ordersTotal = async () =>
        ((await ok("GET", "/api/orders?pageSize=200")).json as { total: number }).total;

      try {
        // ── 1. boot + write ────────────────────────────────────────────────
        generate(false, "initial");
        up();
        const first = await placeOrder("c-boot");
        expect(first.placed.status).toBeLessThan(300);
        await shipped(first.orderId, 60_000);
        const restartsAtBoot = restarts();

        // ── 2. stop + boot again ───────────────────────────────────────────
        // The service owns a timer and an applied migration chain: the second
        // boot must neither re-apply the schema nor trip over the timer's state.
        sh(`${compose} stop d`, out);
        sh(`${compose} up -d --wait d`, out, 600_000);
        expect(await ordersTotal()).toBe(1);
        const second = await placeOrder("c-reboot");
        await shipped(second.orderId, 60_000);

        // ── 3. regenerate + migrate (a non-last module changes) ────────────
        generate(true, "add-order-priority");
        up();
        expect(await ordersTotal()).toBe(2);
        const third = await placeOrder("c-v2", { priority: 3 });
        const read = await ok("GET", `/api/orders/${third.orderId}`);
        expect((read.json as { priority?: number }).priority).toBe(3);
        await shipped(third.orderId, 60_000);
        const restartsAfterRegen = restarts();

        // ── 4. broker outage ───────────────────────────────────────────────
        sh(`${compose} stop bus cache`, out);
        await sleep(BROKER_OUTAGE_MS / 2);
        // A command that commits while the brokers are down: the outbox owns
        // the queue channel, but the ephemeral tee publishes inline.
        let duringOutage = "";
        await claim(
          ops,
          "broker.publishFailureKeepsCommit",
          broker.publishFailureKeepsCommit,
          "a command committed during the outage answers 2xx",
          async () => {
            const o = await placeOrder("c-outage");
            duringOutage = o.orderId;
            if (o.placed.status >= 300) throw new Error(`place → ${o.placed.status}`);
          },
        );
        await sleep(BROKER_OUTAGE_MS / 2);
        expect(
          sh(`docker inspect -f '{{.State.Running}}' ${container()}`, out).trim(),
          "the service must keep running through a broker outage",
        ).toBe("true");
        sh(`${compose} start bus cache`, out);
        sh(`${compose} up -d --wait bus cache`, out, 300_000);
        const resumed = await claim(
          ops,
          "broker.reconnects",
          broker.reconnects,
          "the consumer resumes after the broker returns",
          async () => {
            const after = await placeOrder("c-after-outage");
            await shipped(after.orderId, 90_000);
          },
        );
        // Delivery of the outage-time event is observable only through a
        // consumer that came back.
        if (duringOutage && resumed === "held") {
          await claim(
            ops,
            "broker.outboxRidesOutOutage",
            broker.outboxRidesOutOutage,
            "an event committed during the outage is delivered after it",
            async () => shipped(duringOutage, 60_000),
          );
        }
        if (resumed === "expected-failure") {
          // Recover a clean consumer for the DB phase: the reboot path is what
          // the fact being unmet costs an operator today.
          sh(`${compose} restart d`, out, 300_000);
          sh(`${compose} up -d --wait d`, out, 600_000);
        } else {
          expect(restarts(), "no restart across the broker outage").toBe(restartsAfterRegen);
        }
        const restartsBeforePause = restarts();

        // ── 5. DB pause ────────────────────────────────────────────────────
        sh(`${compose} pause db`, out);
        try {
          await waitFor(
            "readiness reports not-ready while the DB is paused",
            DB_PAUSE_MS,
            async () => {
              try {
                return (await call("GET", ops.health.readiness, undefined, 2_000)).status >= 500;
              } catch {
                return true; // a hung readiness probe is not-ready to k8s too
              }
            },
          );
          const live = await call("GET", ops.health.liveness, undefined, 3_000).catch(() => null);
          expect(live?.status, "liveness stays up while only the DB is down").toBe(200);
          await sleep(DB_PAUSE_MS);
        } finally {
          sh(`${compose} unpause db`, out);
        }
        await waitFor("readiness recovers after the DB returns", 60_000, async () => {
          return (await call("GET", ops.health.readiness, undefined, 3_000)).status === 200;
        });
        expect(restarts(), "no restart across the DB pause").toBe(restartsBeforePause);
        const fifth = await placeOrder("c-after-pause");
        await shipped(fifth.orderId, 90_000);

        // ── 6. final ───────────────────────────────────────────────────────
        // Healthchecks re-converge on their own interval after the pause.
        let unhealthy: string[] = [];
        await waitFor("every compose service running and healthy", 90_000, async () => {
          unhealthy = sh(`${compose} ps --format json`, out)
            .split("\n")
            .filter((l) => l.trim().startsWith("{"))
            .map((l) => JSON.parse(l) as { Service: string; State: string; Health: string })
            .filter((s) => s.State !== "running" || (s.Health !== "" && s.Health !== "healthy"))
            .map((s) => `${s.Service}: ${s.State}/${s.Health}`);
          return unhealthy.length === 0;
        }).catch(() => {
          throw new Error(`not healthy: ${unhealthy.join(", ")}`);
        });
        expect(restartsAtBoot, "no crash-loop at first boot").toBe(0);
        expect(fivexx, "no 5xx outside an expected-failure window").toEqual([]);

        await claim(
          ops,
          "listen",
          ops.listen !== "ipv6-required",
          "accepts IPv4 inside the container",
          async () => {
            // In the container the service listens on its internal port — the
            // right-hand side of the compose `ports:` mapping.
            const mapping = new RegExp(`"${PORT}:(\\d+)"`).exec(
              fs.readFileSync(path.join(out, "docker-compose.yml"), "utf8"),
            );
            const internal = mapping?.[1] ?? String(PORT);
            sh(
              `${compose} exec -T d wget -qO- http://127.0.0.1:${internal}${ops.health.liveness}`,
              out,
            );
          },
        );

        if (ops.log.format !== "text") {
          const lines = sh(`${compose} logs --no-color --no-log-prefix d`, out, 120_000)
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.startsWith("{"));
          expect(lines.length, "the service logs JSON").toBeGreaterThan(0);
          await claim(
            ops,
            "log.format",
            ops.log.format === "loom-json",
            "every JSON log line carries the shared envelope",
            async () => {
              const off = lines.filter((l) => {
                try {
                  const o = JSON.parse(l) as Record<string, unknown>;
                  return ENVELOPE_KEYS.some((k) => typeof o[k] !== "string");
                } catch {
                  return true;
                }
              });
              if (off.length > 0)
                throw new Error(`${off.length} line(s), e.g. ${off[0]!.slice(0, 200)}`);
            },
          );
        }

        // ── 7. dead letter ─────────────────────────────────────────────────
        await claim(
          ops,
          "broker.deadLettersUnderAcl",
          broker.deadLettersUnderAcl,
          "a reactor failing every delivery is parked in its DLQ",
          async () => {
            await placeOrder("poison");
            await waitFor("a message parked in a loom.dlq.* queue", 90_000, async () => {
              const queues = sh(
                `${compose} exec -T bus rabbitmqctl -q list_queues -p loom name messages`,
                out,
              );
              return queues.split("\n").some((l) => /^loom\.dlq\.\S+\s+[1-9]/.test(l.trim()));
            });
          },
        );

        // ── 9. object store ───────────────────────────────────────────────
        if (ops.resources) {
          await claim(
            ops,
            "resources.objectStoreReachesSidecar",
            ops.resources.objectStoreReachesSidecar,
            "an object-store write lands in the dev MinIO sidecar's bucket",
            async () => {
              const r = await ok("POST", "/api/workflows/archive", { note: "n1" });
              expect(r.status, JSON.stringify(r.json)).toBeLessThan(300);
              sh(`${compose} exec -T files mc stat local/lifecycle/notes/n1`, out);
            },
          );
        }
      } catch (err) {
        try {
          console.error(sh(`${compose} logs --no-color --tail=120`, out, 120_000));
        } catch {
          // best-effort diagnostics
        }
        throw err;
      } finally {
        try {
          execSync(`${compose} down -v`, { cwd: out, stdio: "ignore", timeout: 300_000 });
        } catch {
          // best-effort teardown
        }
      }
    });
  }
});
