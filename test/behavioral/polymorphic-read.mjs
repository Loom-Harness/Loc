// Runtime acceptance for the polymorphic base read (`GET /api/<bases>`).
//
// Boots the GENERATED Hono backend (from `polymorphic-read.ddd`) and asserts,
// for a TPH hierarchy (one shared table) and a TPC one (a table per concrete):
//
//   1. a row filtered by the BASE's restriction is absent, whatever its subtype;
//   2. a row filtered by its OWN subtype's restriction is absent, while a row
//      of a sibling subtype that the same predicate would reject is present —
//      the subtype filter is guarded by the discriminator, not applied to all;
//   3. every row carries its subtype's `type` tag and that subtype's own fields;
//   4. the order is ONE global `id` order across subtypes and a page window is
//      cut from it — a reader that concatenated the subtypes' reads would
//      answer each subtype's rows as a block.
//
// The emitted DSL `test e2e` cannot express this: an abstract base has no
// `api.<bases>` accessor.
//
// Database: real Postgres when `PG_URL` is set (a fresh database is created on
// that server and dropped afterwards), otherwise PGlite in-process.
//
// `LOOM_POLY_PERSISTENCE=mikroorm` (requires `PG_URL`) runs the same assertions
// against the `persistence: mikroorm` build of the fixture, booted as a real
// process (MikroORM needs a real Postgres): single-table inheritance + default
// filters answer the polymorphic read there.
//
// Usage:  npm ci  (in this dir, once) ; [PG_URL=postgres://…] node polymorphic-read.mjs
//
// Another backend: generate `polymorphic-read.ddd` with its `platform:`, boot
// it on a fresh database, and run `LOOM_POLY_BASE=http://127.0.0.1:<port> node
// polymorphic-read.mjs` — the same assertions over HTTP.
// Exit non-zero on any failed assertion or a boot error.

import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { MIGRATOR_IMPORT, applyMigrationsStmt } from "./emitted-schema.mjs";
import { stopServer, waitForPort, waitForPortFree } from "./proc.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const DDD = join(HERE, "polymorphic-read.ddd");
const MIKRO = process.env.LOOM_POLY_PERSISTENCE === "mikroorm";
const MIKRO_PORT = Number(process.env.LOOM_POLY_PORT ?? "8127");

/** Boot the GENERATED `persistence: mikroorm` backend as a real process
 *  against a fresh database on `pgUrl`, and return a `fetch` dispatch to it. */
async function bootMikro(deplDir, pgUrl) {
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: deplDir, stdio: "pipe" });
  const admin = new pg.Client({ connectionString: pgUrl });
  await admin.connect();
  const name = "loom_poly_mikro_" + process.pid + "_" + Date.now();
  await admin.query("create database " + name);
  const url = new URL(pgUrl);
  url.pathname = "/" + name;
  await waitForPortFree(MIKRO_PORT);
  const server = spawn("npm", ["run", "dev"], {
    cwd: deplDir,
    stdio: "pipe",
    detached: true,
    env: { ...process.env, DATABASE_URL: url.toString(), PORT: String(MIKRO_PORT) },
  });
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  const exited = new Promise((_, rej) => server.on("exit", (code) => rej(new Error(`server exited early (code ${code})\n${log.slice(-2000)}`))));
  await Promise.race([waitForPort(MIKRO_PORT, 90_000), exited]);
  const base = `http://127.0.0.1:${MIKRO_PORT}`;
  const dispatch = (path, init) => fetch(base + path, init);
  const close = async () => {
    await stopServer(server);
    await admin.query("drop database if exists " + name + " with (force)");
    await admin.end();
  };
  return { dispatch, close };
}

/** The boot module: a `boot()` that returns a `fetch`-like dispatch bound to
 *  the generated Hono app over PGlite or node-postgres. */
function entrySource(deplDir, pgUrl) {
  const J = JSON.stringify;
  const common = `
${MIGRATOR_IMPORT}
import { createApp } from ${J(join(deplDir, "http/index.ts"))};
import * as schema from ${J(join(deplDir, "db/schema.ts"))};
`;
  if (!pgUrl) {
    return `${common}
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";

export async function boot() {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  ${applyMigrationsStmt(deplDir)}
  const app = createApp(db);
  const dispatch = (path, init) => app.fetch(new Request("http://x" + path, init));
  return { dispatch, close: async () => pglite.close?.() };
}
`;
  }
  return `${common}
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export async function boot() {
  const admin = new pg.Client({ connectionString: ${J(pgUrl)} });
  await admin.connect();
  const name = "loom_poly_" + process.pid + "_" + Date.now();
  await admin.query("create database " + name);
  const url = new URL(${J(pgUrl)});
  url.pathname = "/" + name;
  const pool = new pg.Pool({ connectionString: url.toString() });
  const conn = { exec: (q) => pool.query(q) };
  ${applyMigrationsStmt(deplDir, "conn")}
  const db = drizzle(pool, { schema });
  const app = createApp(db);
  const dispatch = (path, init) => app.fetch(new Request("http://x" + path, init));
  const close = async () => {
    await pool.end();
    await admin.query("drop database if exists " + name);
    await admin.end();
  };
  return { dispatch, close };
}
`;
}

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures++;
    process.stdout.write(`  ✗ ${name}${detail ? `  — ${detail}` : ""}\n`);
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Create rows in the order given (sequential: node ids are UUIDv7, so `id`
 *  order is creation order) and return `{ label, id, kind }` for each. */
async function seed(dispatch, rows) {
  const out = [];
  for (const r of rows) {
    const res = await dispatch(`/api/${r.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(r.body),
    });
    if (res.status !== 201) throw new Error(`create ${r.label}: ${res.status} ${await res.text()}`);
    out.push({ label: r.label, id: (await res.json()).id, kind: r.kind, visible: r.visible });
  }
  return out;
}

/** Assert one hierarchy's base read: membership, tags, own fields, global
 *  order, and the page window. */
async function assertBaseRead(dispatch, layout, path, seeded, ownField) {
  process.stdout.write(`▶ ${layout}: GET /api/${path}\n`);
  const visible = seeded.filter((s) => s.visible);
  // The global order: ascending id over every visible row, whatever subtype.
  const expected = [...visible].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const label = (id) => seeded.find((s) => s.id === id)?.label ?? id;

  const all = await dispatch(`/api/${path}?page=1&pageSize=50`, { method: "GET" });
  check(`${layout}: responds 200`, all.status === 200, `status=${all.status}`);
  const body = await all.json();
  const ids = body.items.map((i) => i.id);
  check(
    `${layout}: answers exactly the visible rows, in one global id order`,
    same(ids, expected.map((e) => e.id)),
    `got [${ids.map(label)}], want [${expected.map((e) => e.label)}]`,
  );
  for (const hidden of seeded.filter((s) => !s.visible)) {
    check(`${layout}: filtered row ${hidden.label} is absent`, !ids.includes(hidden.id));
  }
  check(`${layout}: total counts the visible rows`, body.total === visible.length, `total=${body.total}`);
  // The seed interleaves subtypes, so a reader that concatenated per-subtype
  // reads would answer the kinds as blocks instead.
  check(
    `${layout}: rows of different subtypes interleave in the global order`,
    same(body.items.map((i) => i.type), expected.map((e) => e.kind)),
    `got [${body.items.map((i) => i.type)}], want [${expected.map((e) => e.kind)}]`,
  );
  for (const item of body.items) {
    const own = ownField[item.type];
    const other = Object.entries(ownField).find(([k]) => k !== item.type)?.[1];
    check(
      `${layout}: ${label(item.id)} carries its tag and only its own subtype fields`,
      typeof item[own] === "number" && !(other in item) && typeof item.name === "string",
      JSON.stringify(item),
    );
  }

  // Paging: windows of 2 cut from the one global order.
  const pages = [];
  for (let page = 1; page <= Math.ceil(visible.length / 2) + 1; page++) {
    const r = await (await dispatch(`/api/${path}?page=${page}&pageSize=2`, { method: "GET" })).json();
    pages.push(r);
  }
  for (const [i, p] of pages.entries()) {
    const want = expected.slice(i * 2, i * 2 + 2).map((e) => e.id);
    check(
      `${layout}: page ${i + 1} is window ${i * 2}..${i * 2 + 1} of the global order`,
      same(p.items.map((x) => x.id), want),
      `got [${p.items.map((x) => label(x.id))}], want [${want.map(label)}]`,
    );
    check(
      `${layout}: page ${i + 1} reports the global counters`,
      p.total === visible.length && p.totalPages === Math.ceil(visible.length / 2) && p.page === i + 1 && p.pageSize === 2,
      JSON.stringify({ total: p.total, totalPages: p.totalPages, page: p.page, pageSize: p.pageSize }),
    );
  }
}

/** Every assertion, against one booted backend. */
async function scenario(dispatch) {
  // TPH.  `capacity > 0` is the BASE's filter; `doors > 0` is Car's and
  // `payloadKg < 10000` is Truck's.  `truck-heavy` would pass Car's filter
  // and `car-doorless` Truck's — each must be judged by its own only.
  const vehicles = await seed(dispatch, [
    { label: "car-a", path: "cars", kind: "Car", visible: true, body: { name: "a", capacity: 4, doors: 4 } },
    { label: "truck-b", path: "trucks", kind: "Truck", visible: true, body: { name: "b", capacity: 2, payloadKg: 5000 } },
    { label: "car-doorless", path: "cars", kind: "Car", visible: false, body: { name: "x", capacity: 4, doors: 0 } },
    { label: "truck-heavy", path: "trucks", kind: "Truck", visible: false, body: { name: "y", capacity: 2, payloadKg: 20000 } },
    { label: "car-empty", path: "cars", kind: "Car", visible: false, body: { name: "z", capacity: 0, doors: 2 } },
    { label: "truck-empty", path: "trucks", kind: "Truck", visible: false, body: { name: "w", capacity: 0, payloadKg: 1 } },
    { label: "car-c", path: "cars", kind: "Car", visible: true, body: { name: "c", capacity: 5, doors: 2 } },
    { label: "truck-d", path: "trucks", kind: "Truck", visible: true, body: { name: "d", capacity: 3, payloadKg: 1 } },
    { label: "car-e", path: "cars", kind: "Car", visible: true, body: { name: "e", capacity: 1, doors: 5 } },
  ]);
  await assertBaseRead(dispatch, "TPH", "vehicles", vehicles, { Car: "doors", Truck: "payloadKg" });

  // The TPH base by-id read: the shared table's one identity, the same
  // restrictions as the list.
  process.stdout.write("▶ TPH: GET /api/vehicles/{id}\n");
  for (const v of vehicles) {
    const r = await dispatch(`/api/vehicles/${v.id}`, { method: "GET" });
    if (v.visible) {
      const b = await r.json();
      check(`TPH by id: ${v.label} answers 200 tagged ${v.kind}`, r.status === 200 && b.type === v.kind && b.id === v.id, `status=${r.status} ${JSON.stringify(b)}`);
    } else {
      check(`TPH by id: filtered ${v.label} is a 404`, r.status === 404, `status=${r.status}`);
    }
  }

  // TPC.  No base filter; `age > 0` is Person's, `employees < 100` Company's.
  const parties = await seed(dispatch, [
    { label: "person-a", path: "persons", kind: "Person", visible: true, body: { name: "a", age: 30 } },
    { label: "company-b", path: "companies", kind: "Company", visible: true, body: { name: "b", employees: 10 } },
    { label: "person-ageless", path: "persons", kind: "Person", visible: false, body: { name: "x", age: 0 } },
    { label: "company-big", path: "companies", kind: "Company", visible: false, body: { name: "y", employees: 500 } },
    { label: "person-c", path: "persons", kind: "Person", visible: true, body: { name: "c", age: 40 } },
    { label: "company-d", path: "companies", kind: "Company", visible: true, body: { name: "d", employees: 0 } },
    { label: "person-e", path: "persons", kind: "Person", visible: true, body: { name: "e", age: 50 } },
  ]);
  await assertBaseRead(dispatch, "TPC", "parties", parties, { Person: "age", Company: "employees" });

  const bad = await dispatch("/api/vehicles?page=0", { method: "GET" });
  check("a page below 1 is refused (422)", bad.status === 422, `status=${bad.status}`);
}

/** A backend already running at `base` (any platform): the same scenario over
 *  HTTP.  The `.ddd` is this directory's, generated with that platform. */
async function runExternal(base) {
  process.stdout.write(`▶ dispatching to ${base}\n`);
  await scenario((path, init) => fetch(base + path, init));
}

async function main() {
  if (process.env.LOOM_POLY_BASE) {
    await runExternal(process.env.LOOM_POLY_BASE);
    process.stdout.write(`\n${failures === 0 ? "PASS" : `FAIL (${failures} assertion(s))`}\n`);
    process.exit(failures === 0 ? 0 : 1);
  }
  const pgUrl = process.env.PG_URL || "";
  const genDir = mkdtempSync(join(tmpdir(), "loom-poly-"));
  const workDir = join(HERE, ".work", "polymorphic-read");
  mkdirSync(workDir, { recursive: true });
  try {
    if (MIKRO && !pgUrl) throw new Error("LOOM_POLY_PERSISTENCE=mikroorm needs PG_URL (a real Postgres)");
    process.stdout.write(`▶ generating ${DDD}${MIKRO ? " [mikroorm]" : ""}\n`);
    let source = DDD;
    if (MIKRO) {
      const injected = readFileSync(DDD, "utf8").replace(/platform: node\b/, "platform: node { persistence: mikroorm }");
      if (!injected.includes("persistence: mikroorm")) throw new Error("no `platform: node` deployable to force mikroorm onto");
      source = join(workDir, "polymorphic-read.mikroorm.ddd");
      writeFileSync(source, injected);
    }
    execFileSync("node", [join(REPO, "bin/cli.js"), "generate", "system", source, "-o", genDir], {
      stdio: "pipe",
    });
    const deplDir = join(genDir, "api");
    let booted;
    if (MIKRO) {
      process.stdout.write("▶ booting on Postgres (PG_URL), real process\n");
      booted = await bootMikro(deplDir, pgUrl);
    } else {
      const entry = join(workDir, "entry.mts");
      const bundle = join(workDir, "bundle.mjs");
      writeFileSync(entry, entrySource(deplDir, pgUrl));
      await build({
        entryPoints: [entry],
        outfile: bundle,
        bundle: true,
        platform: "node",
        format: "esm",
        target: "node20",
        packages: "external",
        logLevel: "warning",
      });
      process.stdout.write(`▶ booting on ${pgUrl ? "Postgres (PG_URL)" : "PGlite"}\n`);
      const { boot } = await import(pathToFileURL(bundle).href);
      booted = await boot();
    }
    const { dispatch, close } = booted;
    try {
      await scenario(dispatch);
    } finally {
      await close();
    }
  } finally {
    rmSync(genDir, { recursive: true, force: true });
  }

  process.stdout.write(`\n${failures === 0 ? "PASS" : `FAIL (${failures} assertion(s))`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(`ERROR: ${err?.stack ?? err}\n`);
  process.exit(1);
});
