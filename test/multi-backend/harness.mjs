// The multi-backend harness's booted half: generate a fixture expanded onto
// one store (`topology.mjs`), boot the GENERATED docker-compose stack as
// emitted, and drive the cross-backend matrices over HTTP, SQL and redis.
//
// Nothing here knows a backend's language.  Every backend is a compose service
// built from its own generated Dockerfile; the harness talks to the published
// api ports, the postgres and the redis — the same wiring a user boots.
//
// The two checks:
//   * shared database — a backend writes an order (a required value object,
//     an optional one present or absent, a contained part) and every other
//     backend reads it by id, from the database (the cache is flushed first),
//     answering the writer's own body exactly.  Run once per owner, so every
//     backend reads tables every other backend migrated.
//   * cache — on one redis: an entry one backend stored is a hit on every
//     other backend, answering the stored body even after the row changed under
//     it; each of the six unreadable entry shapes is a miss and then, once the
//     miss replaced it, a hit; a stored etag is replayed on every backend's hit.

import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { MEMBERS, orderedPairs, serviceOf } from "./topology.mjs";

export const CACHE_STATUS_HEADER = "x-loom-cache";

const PG_PORT = Number(process.env.LOOM_MB_PG_PORT ?? 55432);
const REDIS_PORT = Number(process.env.LOOM_MB_REDIS_PORT ?? 56379);

const portOf = (key) => MEMBERS.find((m) => m.key === key).port;
export const baseOf = (key) => `http://localhost:${portOf(key)}`;

// --------------------------------------------------------------------------
// The stack.

/** Publish the store's two ports for the harness, beside the emitted file. */
function writeOverride(out) {
  const file = join(out, "docker-compose.multi-backend.yml");
  writeFileSync(
    file,
    [
      "services:",
      "  db:",
      `    ports: ["${PG_PORT}:5432"]`,
      "  hot:",
      `    ports: ["${REDIS_PORT}:6379"]`,
      "",
    ].join("\n"),
  );
  return file;
}

/** Behind an HTTPS proxy, Gradle in the build stage needs the proxy as JVM
 *  properties (it ignores HTTPS_PROXY), and LOOM_E2E_GRADLE_INIT=<init script>
 *  resolves Maven Central through a mirror (a proxy that rate-limits
 *  repo.maven.apache.org answers 429) — the same adaptation the lifecycle leg
 *  makes.  Inert without a proxy, so a plain runner builds the Dockerfile as
 *  emitted.  Returns the extra `docker build` arguments. */
function adaptGradleForProxy(dir) {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const dockerfile = join(dir, "Dockerfile");
  if (!proxy || !existsSync(dockerfile)) return [];
  let text = readFileSync(dockerfile, "utf8");
  if (!text.includes("gradle --no-daemon")) return [];
  const init = process.env.LOOM_E2E_GRADLE_INIT;
  if (init && !text.includes("mirror.init.gradle.kts")) {
    mkdirSync(join(dir, "certs"), { recursive: true });
    copyFileSync(init, join(dir, "certs", "mirror.init.gradle.kts"));
    text = text.replaceAll("gradle --no-daemon", "gradle --no-daemon -I /tmp/loom-certs/mirror.init.gradle.kts");
  }
  if (!text.includes("ARG JAVA_TOOL_OPTIONS")) text = text.replace(/^(FROM .* AS build)$/m, "$1\nARG JAVA_TOOL_OPTIONS");
  writeFileSync(dockerfile, text);
  const url = new URL(proxy);
  return ["--build-arg", `JAVA_TOOL_OPTIONS=-Dhttps.proxyHost=${url.hostname} -Dhttps.proxyPort=${url.port}`];
}

export function makeStack({ project, out, members }) {
  const override = writeOverride(out);
  const compose = (args, opts = {}) =>
    execSync(`docker compose -p ${project} -f docker-compose.yml -f ${override} ${args}`, {
      cwd: out,
      stdio: "pipe",
      encoding: "utf8",
      timeout: 900_000,
      ...opts,
    });
  return {
    compose,
    /** Build each member's image under the tag compose looks for, so `up`
     *  needs no build.  Host networking and the caller's proxy reach the
     *  package registries from a sandbox; on a plain runner both are inert.
     *  Docker's layer cache makes a rebuild after an owner change cost only
     *  the layers ownership touches. */
    build() {
      const proxy = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"].flatMap((k) =>
        process.env[k] ? ["--build-arg", `${k}=${process.env[k]}`] : [],
      );
      const caDir = process.env.LOOM_E2E_CA_DIR;
      const times = {};
      for (const key of members) {
        const dir = join(out, serviceOf(key));
        if (caDir && existsSync(caDir)) {
          mkdirSync(join(dir, "certs"), { recursive: true });
          for (const crt of readdirSync(caDir).filter((f) => f.endsWith(".crt")))
            copyFileSync(join(caDir, crt), join(dir, "certs", crt));
        }
        const javaArgs = adaptGradleForProxy(dir);
        const t0 = Date.now();
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
            ...javaArgs,
            "-t",
            `${project}-${serviceOf(key)}`,
            dir,
          ],
          { stdio: process.env.LOOM_MB_QUIET_BUILD === "1" ? "pipe" : "inherit", timeout: 1_800_000 },
        );
        times[key] = Math.round((Date.now() - t0) / 1000);
      }
      return times;
    },
    up() {
      compose("up -d --no-build");
    },
    down() {
      try {
        compose("down -v --remove-orphans");
      } catch {
        /* best effort */
      }
    },
    diagnostics() {
      try {
        return `${compose("ps -a")}\n${compose("logs --tail=120")}`;
      } catch (e) {
        return String(e);
      }
    },
    /** One SQL statement through the db container's psql; rows as text. */
    sql(statement) {
      return compose(
        `exec -T db psql -U postgres -d primary -At -v ON_ERROR_STOP=1 -c ${JSON.stringify(statement)}`,
      ).trim();
    },
  };
}

// --------------------------------------------------------------------------
// Redis — a minimal RESP client, so the harness needs no client library.

function encode(args) {
  return `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join("")}`;
}

/** Parse one RESP reply at `buf[i]`; `[value, next]`, or null when incomplete. */
function parse(buf, i = 0) {
  const nl = buf.indexOf("\r\n", i);
  if (nl < 0) return null;
  const type = String.fromCharCode(buf[i]);
  const head = buf.toString("utf8", i + 1, nl);
  if (type === "+") return [head, nl + 2];
  if (type === "-") return [new Error(head), nl + 2];
  if (type === ":") return [Number(head), nl + 2];
  if (type === "$") {
    const n = Number(head);
    if (n < 0) return [null, nl + 2];
    if (buf.length < nl + 2 + n + 2) return null;
    return [buf.toString("utf8", nl + 2, nl + 2 + n), nl + 2 + n + 2];
  }
  if (type === "*") {
    const n = Number(head);
    const items = [];
    let at = nl + 2;
    for (let k = 0; k < n; k++) {
      const r = parse(buf, at);
      if (!r) return null;
      items.push(r[0]);
      at = r[1];
    }
    return [items, at];
  }
  throw new Error(`redis: unexpected reply type ${type}`);
}

export function redis(...args) {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host: "127.0.0.1", port: REDIS_PORT });
    let buf = Buffer.alloc(0);
    sock.setTimeout(10_000, () => sock.destroy(new Error("redis: timeout")));
    sock.on("error", reject);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      const r = parse(buf);
      if (!r) return;
      sock.end();
      if (r[0] instanceof Error) reject(r[0]);
      else resolve(r[0]);
    });
    sock.on("connect", () => sock.write(encode(args)));
  });
}

// --------------------------------------------------------------------------
// HTTP.

export async function call(key, method, path, body) {
  const r = await fetch(`${baseOf(key)}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: r.status, json, text, headers: r.headers };
}

/** Wait until compose reports every member healthy — by the healthcheck the
 *  generated compose file declares, so a member whose tables are wrong still
 *  comes up and its defect shows as a matrix cell, not a boot failure. */
export async function waitUp(stack, members, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let health = {};
  while (Date.now() < deadline) {
    const lines = stack.compose("ps --all --format json").trim().split("\n").filter(Boolean);
    health = Object.fromEntries(
      lines.map((l) => JSON.parse(l)).map((c) => [c.Service, c.Health || c.State]),
    );
    if (members.every((k) => health[serviceOf(k)] === "healthy")) return;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(
    `not healthy: ${members
      .filter((k) => health[serviceOf(k)] !== "healthy")
      .map((k) => `${k} (${health[serviceOf(k)] ?? "absent"})`)
      .join(", ")}`,
  );
}

// --------------------------------------------------------------------------
// Comparing answers.

/** Deep difference between two JSON values, as `path: a ≠ b` lines. */
export function jsonDiff(a, b, path = "$") {
  if (Array.isArray(a) && Array.isArray(b)) {
    const lines = a.length !== b.length ? [`${path}.length: ${a.length} ≠ ${b.length}`] : [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) lines.push(...jsonDiff(a[i], b[i], `${path}[${i}]`));
    return lines;
  }
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => {
      if (!(k in a)) return [`${path}.${k}: absent ≠ ${JSON.stringify(b[k])}`];
      if (!(k in b)) return [`${path}.${k}: ${JSON.stringify(a[k])} ≠ absent`];
      return jsonDiff(a[k], b[k], `${path}.${k}`);
    });
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
}

// --------------------------------------------------------------------------
// The shared-database check.

/** The two orders every writer creates: one with the optional value object
 *  and a contained part, one with neither. */
const ORDERS = [
  { shape: "full", create: (w) => ({ code: `F-${w}`, total: { amount: 40, currency: "EUR" }, lead: { days: 3 } }), line: { sku: "S-1", qty: 2 } },
  { shape: "bare", create: (w) => ({ code: `B-${w}`, total: { amount: 5, currency: "USD" } }) },
];

/**
 * Every member writes both orders; every member reads every order by id from
 * the database (the redis is flushed before each read) and must answer the
 * WRITER's own read exactly.  Returns the failures as `{name, error}` — the
 * shape the behavioural tier's `settle` judges.
 */
export async function sharedDatabaseMatrix(stack, members, owner) {
  const failures = [];
  const fail = (name, error) => failures.push({ name: `${name} (owner ${owner})`, error });
  const written = [];
  for (const w of members) {
    for (const o of ORDERS) {
      const created = await call(w, "POST", "/api/orders", o.create(w));
      if (created.status !== 201 || typeof created.json?.id !== "string") {
        fail(`${w} writes ${o.shape}`, `create → ${created.status} ${created.text.slice(0, 200)}`);
        continue;
      }
      const id = created.json.id;
      if (o.line) {
        const added = await call(w, "POST", `/api/orders/${id}/add_line`, o.line);
        if (added.status >= 300) {
          fail(`${w} writes ${o.shape}`, `add_line → ${added.status} ${added.text.slice(0, 200)}`);
          continue;
        }
      }
      await redis("FLUSHALL");
      const own = await call(w, "GET", `/api/orders/${id}`);
      if (own.status !== 200) {
        fail(`${w} reads its own ${o.shape}`, `GET → ${own.status} ${own.text.slice(0, 200)}`);
        continue;
      }
      written.push({ writer: w, shape: o.shape, id, body: own.json });
    }
  }
  for (const { writer, shape, id, body } of written) {
    for (const r of members.filter((k) => k !== writer)) {
      await redis("FLUSHALL");
      const read = await call(r, "GET", `/api/orders/${id}`);
      const name = `${writer} → ${r} ${shape}`;
      if (read.status !== 200) fail(name, `GET → ${read.status} ${read.text.slice(0, 200)}`);
      else if (read.headers.get(CACHE_STATUS_HEADER) !== "miss")
        fail(name, `the read did not go to the database: ${CACHE_STATUS_HEADER}: ${read.headers.get(CACHE_STATUS_HEADER)}`);
      else {
        const diff = jsonDiff(body, read.json);
        if (diff.length > 0) fail(name, `body differs (writer ≠ reader): ${diff.join("; ")}`);
      }
    }
  }
  // An optional value object stored as columns is absent exactly when its
  // required leaves are NULL (`absenceProbe`), and the shared CHECK refuses a
  // row whose required leaves are NULL while an optional one is set.  Rows
  // written straight to the table, so every member reads the same bytes.
  let absenceCells = 0;
  const seeded = written[0];
  if (seeded) {
    const table = orderTable(stack);
    try {
      stack.sql(`UPDATE ${table} SET lead_days = NULL, lead_note = 'orphan' WHERE id = '${seeded.id}'`);
      fail("absence: required leaf NULL, optional leaf set", "the database accepted the row");
    } catch {
      // refused by the null-consistency CHECK, as it must be
    }
    absenceCells++;
    for (const row of ABSENCE_ROWS) {
      stack.sql(`UPDATE ${table} SET ${row.set} WHERE id = '${seeded.id}'`);
      for (const r of members) {
        absenceCells++;
        await redis("FLUSHALL");
        const read = await call(r, "GET", `/api/orders/${seeded.id}`);
        const name = `absence: ${row.shape} → ${r}`;
        if (read.status !== 200) fail(name, `GET → ${read.status} ${read.text.slice(0, 200)}`);
        else if (!row.reads(read.json?.lead)) fail(name, `lead read as ${JSON.stringify(read.json?.lead)}`);
      }
    }
  }
  return { failures, cells: written.length * (members.length - 1) + absenceCells };
}

/** Rows of the optional `lead` value object written straight to the table,
 *  each with what every member must read it as. */
const ABSENCE_ROWS = [
  {
    shape: "required leaf set, optional leaf NULL",
    set: "lead_days = 3, lead_note = NULL",
    reads: (lead) => lead?.days === 3 && (lead?.note ?? null) === null,
  },
  {
    shape: "every leaf NULL",
    set: "lead_days = NULL, lead_note = NULL",
    reads: (lead) => lead === null || lead === undefined,
  },
];

// --------------------------------------------------------------------------
// The cache check.

/** The one entry key the redis holds for `id`. */
async function entryKeyOf(id) {
  const keys = (await redis("KEYS", `*${id}`)) ?? [];
  if (keys.length !== 1) throw new Error(`expected one cache entry for ${id}, found ${JSON.stringify(keys)}`);
  return keys[0];
}

/** The order table, schema-qualified — wherever the owner's migrations put it. */
function orderTable(stack) {
  const t = stack.sql(
    "SELECT table_schema || '.' || table_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'code' AND table_schema NOT IN ('pg_catalog', 'information_schema')",
  );
  if (!t || t.includes("\n")) throw new Error(`expected one orders table, found ${JSON.stringify(t)}`);
  return t;
}

/** The six entry shapes every backend must read as a miss (CACHE_ENTRY,
 *  `src/ir/plan/cache.ts`): `fp` is the scope fingerprint the stored entry
 *  used, `body` a valid answer's body text. */
export const UNREADABLE = [
  ["not JSON", () => "{not json"],
  ["an array", () => "[]"],
  ["a string answer", (fp) => JSON.stringify({ [fp]: "answer" })],
  ["a non-string body", (fp, body) => JSON.stringify({ [fp]: { body: JSON.parse(body), etag: null } })],
  ["a numeric etag", (fp, body) => JSON.stringify({ [fp]: { body, etag: 7 } })],
  ["a non-JSON body text", (fp) => JSON.stringify({ [fp]: { body: "{oops", etag: null } })],
];

export async function cacheMatrix(stack, members) {
  const failures = [];
  const fail = (name, error) => failures.push({ name, error });
  const table = orderTable(stack);
  let cells = 0;
  let replays = 0;

  // Writer → reader: W's miss stores the entry, the row then changes under the
  // cache, and R must answer W's stored body as a hit.
  for (const [w, r] of orderedPairs(members)) {
    cells++;
    const name = `cache ${w} → ${r}`;
    const created = await call(w, "POST", "/api/orders", { code: `C-${w}-${r}`, total: { amount: 1, currency: "EUR" } });
    if (created.status !== 201) {
      fail(name, `create → ${created.status}`);
      continue;
    }
    const id = created.json.id;
    await redis("FLUSHALL");
    const stored = await call(w, "GET", `/api/orders/${id}`);
    if (stored.headers.get(CACHE_STATUS_HEADER) !== "miss") {
      fail(name, `writer's first read answered ${CACHE_STATUS_HEADER}: ${stored.headers.get(CACHE_STATUS_HEADER)}`);
      continue;
    }
    stack.sql(`UPDATE ${table} SET code = 'under-the-cache' WHERE id = '${id}'`);
    const hit = await call(r, "GET", `/api/orders/${id}`);
    if (hit.status !== 200 || hit.headers.get(CACHE_STATUS_HEADER) !== "hit")
      fail(name, `reader answered ${hit.status} ${CACHE_STATUS_HEADER}: ${hit.headers.get(CACHE_STATUS_HEADER)}`);
    else {
      const diff = jsonDiff(stored.json, hit.json);
      if (diff.length > 0) fail(name, `hit body differs from the stored one: ${diff.join("; ")}`);
      const etag = stored.headers.get("etag");
      if (etag !== null) {
        replays++;
        if (hit.headers.get("etag") !== etag) fail(name, `stored etag ${etag} not replayed (got ${hit.headers.get("etag")})`);
      }
    }
  }

  // node sends an ETag on `GET /{id}` (docs/resources.md), so with node on the
  // store the replay cells must have observed one; otherwise they proved nothing.
  if (members.includes("node") && replays === 0)
    fail("cache etag replay", "no writer's read carried an etag, so no hit was checked for replaying one");

  // Unreadable entries: each shape is a miss on every reader, and the miss
  // replaces it, so the next read is a hit.
  for (const r of members) {
    for (const [shape, make] of UNREADABLE) {
      cells++;
      const name = `cache unreadable ${shape} → ${r}`;
      const created = await call(r, "POST", "/api/orders", { code: `U-${r}`, total: { amount: 2, currency: "EUR" } });
      const id = created.json?.id;
      await redis("FLUSHALL");
      const first = await call(r, "GET", `/api/orders/${id}`);
      const key = await entryKeyOf(id).catch((e) => e);
      if (key instanceof Error) {
        fail(name, key.message);
        continue;
      }
      // The fingerprint is whatever key the reader's own miss stored its
      // answer under; the shapes are built around the body text it answered.
      let fp;
      try {
        [fp] = Object.keys(JSON.parse(await redis("GET", key)));
      } catch (e) {
        fail(name, `the reader's own miss stored an unreadable entry: ${e.message}`);
        continue;
      }
      await redis("SET", key, make(fp, first.text));
      const miss = await call(r, "GET", `/api/orders/${id}`);
      if (miss.status !== 200 || miss.headers.get(CACHE_STATUS_HEADER) !== "miss") {
        fail(name, `answered ${miss.status} ${CACHE_STATUS_HEADER}: ${miss.headers.get(CACHE_STATUS_HEADER)} (expected 200 miss)`);
        continue;
      }
      const diff = jsonDiff(first.json, miss.json);
      if (diff.length > 0) fail(name, `the miss answered another body: ${diff.join("; ")}`);
      const again = await call(r, "GET", `/api/orders/${id}`);
      if (again.headers.get(CACHE_STATUS_HEADER) !== "hit")
        fail(name, `the miss did not replace the entry: next read ${CACHE_STATUS_HEADER}: ${again.headers.get(CACHE_STATUS_HEADER)}`);
    }
  }
  return { failures, cells };
}
