// A declared `create(…)`'s parameter list is the POST request contract —
// proven on a BOOTED generated backend.
//
// Boots the generated Hono backend (from the corpus `create-contract.ddd`) on
// PGlite —
// the same in-process boot `pagination.mjs` uses — and posts a FORGED create
// body carrying fields the declared `create(patient, minutes, fee)` does not
// list.  Each must be ignored and take its declared default.  `status` is the
// one that matters: accepting it would let a client create an appointment
// already `Completed`, skipping the `when`-gated state machine.
//
// The emitted DSL `test e2e` cannot express this — its create call is checked
// against the create contract at compile time, so it cannot send a forged key.
//
// Usage:  npm ci  (in this dir, once) ; node create-contract.mjs
// It also proves the create BODY runs: a valid create dispatches the body's
// `emit`, and a body `precondition` over a param refuses with a 422.
//
// Exit non-zero on any failed assertion or a boot error.

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MIGRATOR_IMPORT, applyMigrationsStmt } from "./emitted-schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
// The corpus fixture, generated on node — the same model every backend's
// behavioural leg runs through its own `test e2e`.
const CORPUS_DDD = join(REPO, "test", "fixtures", "corpus", "create-contract.ddd");

function entrySource(deplDir) {
  const J = JSON.stringify;
  return `
${MIGRATOR_IMPORT}
import { createApp } from ${J(join(deplDir, "http/index.ts"))};
import * as schema from ${J(join(deplDir, "db/schema.ts"))};
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";

export async function boot() {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });
  ${applyMigrationsStmt(deplDir)}
  const app = createApp(db);
  const dispatch = (path, init) => app.fetch(new Request("http://x" + path, init));
  const close = () => pglite.close?.();
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

async function main() {
  const genDir = mkdtempSync(join(tmpdir(), "loom-create-contract-"));
  const workDir = join(HERE, ".work", "create-contract");
  mkdirSync(workDir, { recursive: true });
  try {
    const ddd = join(workDir, "create-contract.ddd");
    writeFileSync(ddd, readFileSync(CORPUS_DDD, "utf8").replace("__PLATFORM__", "node"));
    process.stdout.write(`▶ generating ${CORPUS_DDD} (platform: node)\n`);
    execFileSync("node", [join(REPO, "bin/cli.js"), "generate", "system", ddd, "-o", genDir], {
      stdio: "pipe",
    });
    const deplDir = join(genDir, "d");
    const entry = join(workDir, "entry.mts");
    const bundle = join(workDir, "bundle.mjs");
    writeFileSync(entry, entrySource(deplDir));
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
    // The generated backend logs one JSON line per dispatched event; tee
    // stdout so the create body's `emit` can be asserted on.
    const logLines = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, ...rest) => {
      const text = String(chunk);
      if (text.startsWith('{"level"')) logLines.push(text);
      return write(chunk, ...rest);
    };
    const dispatched = (type) =>
      logLines.filter((l) => l.includes('"event":"event_dispatched"') && l.includes(`"event_type":"${type}"`)).length;
    const { boot } = await import(pathToFileURL(bundle).href);
    const { dispatch, close } = await boot();
    const post = async (path, body) => {
      const r = await dispatch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const get = async (path) => {
      const r = await dispatch(path, { method: "GET" });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    const params = { patient: "p-1", minutes: 30, fee: { amount: 50.0, currency: "EUR" } };

    process.stdout.write("▶ a forged create body cannot set a field the create does not list\n");
    {
      const forged = {
        ...params,
        status: "Completed",
        notes: "forged",
        room: "Z9",
        priority: 99,
        urgent: true,
        tags: ["forged"],
      };
      const created = await post("/api/appointments", forged);
      check("forged create still answers 201", created.status === 201, `status=${created.status} ${JSON.stringify(created.body)}`);
      const id = created.body?.id;
      const read = await get(`/api/appointments/${id}`);
      check("read-back answers 200", read.status === 200, `status=${read.status}`);
      const a = read.body ?? {};
      check("status is the declared default, not the forged value", a.status === "Requested", `status=${a.status}`);
      check("notes is null, not the forged value", a.notes == null, `notes=${a.notes}`);
      check("room is the declared default", a.room === "A1", `room=${a.room}`);
      check("priority is the declared default", a.priority === 3, `priority=${a.priority}`);
      check("urgent is false", a.urgent === false, `urgent=${a.urgent}`);
      check("tags is empty", Array.isArray(a.tags) && a.tags.length === 0, `tags=${JSON.stringify(a.tags)}`);
      check("the listed params were taken", a.patient === "p-1" && a.minutes === 30, JSON.stringify(a));

      // The state machine still runs from the defaulted state.
      const conf = await post(`/api/appointments/${id}/confirm`, {});
      check("confirm() runs from Requested", conf.status >= 200 && conf.status < 300, `status=${conf.status}`);
      const again = await post(`/api/appointments/${id}/confirm`, {});
      check("a second confirm() is refused (the when-gate holds)", again.status === 409, `status=${again.status}`);
    }

    process.stdout.write("▶ the create body runs: its precondition guards, its emit publishes\n");
    {
      const before = dispatched("AppointmentRequested");
      const ok = await post("/api/appointments", params);
      check("a valid create answers 201", ok.status === 201, `status=${ok.status}`);
      check(
        "the create body's emit dispatched AppointmentRequested once",
        dispatched("AppointmentRequested") === before + 1,
        `dispatched=${dispatched("AppointmentRequested") - before}`,
      );
      const bad = await post("/api/appointments", { ...params, patient: "" });
      check("a failed create precondition answers 422", bad.status === 422, `status=${bad.status}`);
      check(
        "its detail is the precondition's message",
        bad.body?.detail === "A patient is required" ||
          bad.body?.errors?.some?.((e) => e.message === "A patient is required"),
        JSON.stringify(bad.body),
      );
      check(
        "a refused create dispatches nothing",
        dispatched("AppointmentRequested") === before + 1,
        `dispatched=${dispatched("AppointmentRequested") - before}`,
      );
    }

    process.stdout.write("▶ a required create param is still required\n");
    {
      const { fee: _fee, ...noFee } = params;
      const r = await post("/api/appointments", noFee);
      check("omitting a listed param is a 422", r.status === 422, `status=${r.status}`);
    }

    close();
  } finally {
    rmSync(genDir, { recursive: true, force: true });
  }
  if (failures > 0) {
    process.stdout.write(`\n✗ ${failures} assertion(s) failed\n`);
    process.exit(1);
  }
  process.stdout.write("\n✓ create-contract: all assertions passed\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
