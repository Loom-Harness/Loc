// Shared storage, end to end: deployables bound to one `storage` share its
// database.
//
// The fixture puts two backends of DIFFERENT families on `storage primary`:
// `writer` (node) hosts Catalog, `reader` (python) hosts Catalog and Orders.
// A third, `loner` (node), hosts Catalog on `storage separate`.  The stack is
// the generated `docker-compose.yml`, booted as emitted, so what is under test
// is the whole wiring: `db-init/` creating one database per storage, every
// deployable's `DATABASE_URL`, the one migrator per database, and the
// `depends_on` that starts `reader` after `writer` has migrated.
//
// What each assertion proves:
//   - a Product POSTed through `writer` is read back by id through `reader`:
//     the two run on one database;
//   - `loner` answers 404 for that id: a second storage is a second database;
//   - an Order POSTed through `reader` lands: `reader` runs no migrations at
//     boot, so the Orders table exists only because `writer` — the database's
//     migrator — applied the migrations of every module on the database, not
//     just the Catalog it hosts.
//
// Opt-in: LOOM_SHARED_STORAGE_E2E=1 (npm run test:shared-storage).  Needs
// docker.  The images build with `--network host` and the caller's proxy env,
// and LOOM_E2E_CA_DIR=<dir-of-*.crt> drops a TLS-intercepting proxy's CA into
// each image (the generated Dockerfiles copy `certs/`); a plain CI runner needs
// neither.

import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.LOOM_SHARED_STORAGE_E2E === "1";
const PROJECT = "loomsharedstorage";

const FIXTURE = `
system SharedStore {
  subdomain Catalog { context Catalog { aggregate Product with crudish { sku: string } } }
  subdomain Orders { context Orders { aggregate Order with crudish { code: string } } }
  storage primary { type: postgres }
  storage separate { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  resource ordersState { for: Orders, kind: state, use: primary }
  resource catalogElsewhere { for: Catalog, kind: state, use: separate }
  deployable writer { platform: node contexts: [Catalog] dataSources: [catalogState] port: 3000 }
  deployable reader { platform: python contexts: [Catalog, Orders] dataSources: [catalogState, ordersState] port: 3002 }
  deployable loner { platform: node contexts: [Catalog] dataSources: [catalogElsewhere] port: 3004 }
}
`;

const BACKENDS = [
  { service: "writer", base: "http://localhost:3000" },
  { service: "reader", base: "http://localhost:3002" },
  { service: "loner", base: "http://localhost:3004" },
] as const;
const base = (service: (typeof BACKENDS)[number]["service"]): string =>
  BACKENDS.find((b) => b.service === service)!.base;

let dir = "";
let out = "";

function compose(args: string): string {
  return execSync(`docker compose -p ${PROJECT} -f ${join(out, "docker-compose.yml")} ${args}`, {
    stdio: "pipe",
    encoding: "utf8",
    timeout: 600_000,
  });
}

/** Build each backend image under the tag compose looks for, so `up` needs no
 *  build.  Host networking and the caller's proxy reach the package
 *  registries from a sandbox; on a plain runner both are inert. */
function buildImages(): void {
  const proxy = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].flatMap((k) =>
    process.env[k] ? ["--build-arg", `${k}=${process.env[k]}`] : [],
  );
  const caDir = process.env.LOOM_E2E_CA_DIR;
  for (const { service } of BACKENDS) {
    if (caDir && existsSync(caDir)) {
      for (const crt of readdirSync(caDir).filter((f) => f.endsWith(".crt"))) {
        copyFileSync(join(caDir, crt), join(out, service, "certs", crt));
      }
    }
    execFileSync(
      "docker",
      [
        "build",
        "--network",
        "host",
        ...proxy,
        ...(proxy.length > 0
          ? ["--build-arg", "NO_PROXY=localhost", "--build-arg", "no_proxy=localhost"]
          : []),
        "-t",
        `${PROJECT}-${service}`,
        join(out, service),
      ],
      { stdio: "inherit", timeout: 900_000 },
    );
  }
}

async function waitReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${url}/ready`);
      if (r.ok) return;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${url}/ready never answered 200 (last: ${last})`);
}

async function post(
  url: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

describe.skipIf(!ENABLED)("shared storage — deployables on one storage share its database", () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "loom-shared-storage-"));
    out = join(dir, "out");
    writeFileSync(join(dir, "sys.ddd"), FIXTURE);
    execSync(`node ${join(process.cwd(), "bin/cli.js")} generate system sys.ddd -o out`, {
      cwd: dir,
      stdio: "pipe",
    });
    buildImages();
    try {
      compose("up -d --no-build");
      for (const b of BACKENDS) await waitReady(b.base, 240_000);
    } catch (e) {
      console.error(compose("ps -a"));
      console.error(compose("logs --tail=200"));
      throw e;
    }
  }, 1_800_000);

  afterAll(() => {
    if (!out) return;
    try {
      compose("down -v");
    } catch {
      /* best effort */
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("a write through one deployable is a read through the other", async () => {
    const created = await post(`${base("writer")}/api/products`, { sku: "SHARED-1" });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    expect(typeof id).toBe("string");

    const read = await fetch(`${base("reader")}/api/products/${id}`);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { sku: string }).sku).toBe("SHARED-1");

    // A deployable on another storage runs on another database.
    const elsewhere = await fetch(`${base("loner")}/api/products/${id}`);
    expect(elsewhere.status).toBe(404);
  });

  it("the migrator lands the tables of every module on its database", async () => {
    // `reader` applies no migrations at boot; Orders exists only because
    // `writer` migrated the whole database, Orders included.
    const created = await post(`${base("reader")}/api/orders`, { code: "ORD-1" });
    expect(created.status).toBe(201);
    const read = await fetch(`${base("reader")}/api/orders/${created.json.id as string}`);
    expect(read.status).toBe(200);
  });
});
