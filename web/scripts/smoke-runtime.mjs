// Full end-to-end smoke: generate → install (real npm tarballs) →
// bundle (VFS-npm plugin, NO esm.sh) → import in Node → boot PGlite +
// the generated Hono app → dispatch + round-trip a product.
//
// Runs the SAME pipeline the browser runtime worker runs, through
// `generateSystems` (per-context `pgSchema(...)` — tables live under e.g.
// `sales`, so the repositories query schema-qualified relations
// `from "sales"."products"`).
//
// It is the reliable gate for the per-context-pgSchema regression:
// the schema must be created and schema-qualified, or the backend boots but
// every query 500s on a missing `sales.*` relation.  System mode migrates
// the way the runtime worker does: nothing is created while the model has
// no recorded migration; once the initial migration is recorded, the chain's
// SQL (the generated backend's own `db/migrations/`) builds the schema, and a
// recorded evolution migrates it in place with the rows kept.  The browser e2e (`e2e/runtime.spec.ts`) covers the same
// path but self-skips when the npm registry is unreachable; this Node
// smoke runs wherever CI has network, with no skip.
//
// Switched off the esm.sh bundler: esm.sh serves a broken drizzle-orm
// build (pg-core/utils drops the `extractUsedTable` export), which
// fails every backend bundle — the exact bug class the npm-in-browser
// engine was built to escape.  This smoke exercises that engine's
// pipeline (the same install + makeVfsNpmPlugin + postProcessNpmBundle
// path the browser worker runs), so it reflects the runtime we intend
// to ship and is independent of esm.sh's upstream breakage.

import * as esbuild from "esbuild";
import { NodeFileSystem } from "langium/node";
import { URI } from "langium";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import os from "node:os";
import { createDddServices } from "../../out/language/ddd-module.js";
import { API_BASE_PATH } from "../../out/util/api-base.js";
import { generateSystems } from "../../out/system/index.js";
import {
  bootEntryFor,
  devStubEntryFor,
  makeEntryStdin,
  pgliteAssetUrl,
  resolveInFs,
  schemaPathFor,
  RUNTIME_VERSIONS,
} from "../src/bundle/plugin.ts";
import { migrationPlan, recordMigration } from "../src/build/evolution.ts";
import { chainDdl, migrateChain } from "../src/runtime/migrate.ts";
import { install } from "../src/engine/npm/install.ts";
import { makeVfsNpmPlugin } from "../src/engine/npm/esbuild-vfs-plugin.ts";
import { postProcessNpmBundle } from "../src/engine/npm/postprocess.ts";
import {
  absentNodeGlobals,
  createWorkerRealm,
  evaluateInWorkerRealm,
} from "./worker-realm.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// `--realm-only` stops each case after the worker-realm evaluation, before
// PGlite.  That half needs no jsdelivr WASM fetch and no database, which is
// what makes it cheap and stable enough to gate every PR; the full run
// (boot + dispatch) stays on the deploy lane.
const REALM_ONLY = process.argv.includes("--realm-only");

const EXPECTED_EXPORTS = [
  "bootApp",
  "createApp",
  "schema",
  "drizzle",
  "PGlite",
  "is",
  "Table",
  "getTableConfig",
];

/** Report which Node globals the realm is actually withholding, so a
 *  regression that quietly re-admits one shows up in the log instead of
 *  being assumed.  A gate that stops enforcing anything must not look
 *  identical to one that passes. */
function absentNodeGlobalsIn() {
  const absent = absentNodeGlobals(createWorkerRealm());
  if (absent.length === 0) {
    fail(
      "worker realm withheld NOTHING — the realm is not browser-shaped and " +
        "the gate proves nothing.  Check scripts/worker-globals.json.",
    );
  }
  return absent.join("/");
}

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

/** Parse + generate a single source file through the system composer,
 *  returning the generated file Map plus the Hono entry path (under the
 *  deployable slug). */
async function generateBackend(sourcePath) {
  const text = readFileSync(sourcePath, "utf8");
  const services = createDddServices(NodeFileSystem);
  const docs = services.shared.workspace.LangiumDocuments;
  const doc = docs.createDocument(URI.parse("inmemory:///main.ddd"), text);
  await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
  if ((doc.diagnostics ?? []).some((d) => d.severity === 1)) {
    fail(`parse/validation errors in ${path.basename(sourcePath)}`);
  }
  const { files } = generateSystems(doc.parseResult.value);
  const entry = [...files.keys()].find((p) => /^[^/]+\/http\/index\.ts$/.test(p));
  if (!entry) fail(`no Hono deployable in system output for ${path.basename(sourcePath)}`);
  return { files, entry };
}

let pgliteAssetsPromise = null;
/** Fetch + compile PGlite's WASM/data once, reused across cases. */
function pgliteAssets() {
  if (!pgliteAssetsPromise) {
    pgliteAssetsPromise = (async () => {
      const [pgliteRes, initdbRes, dataRes] = await Promise.all([
        fetch(pgliteAssetUrl("pglite.wasm")),
        fetch(pgliteAssetUrl("initdb.wasm")),
        fetch(pgliteAssetUrl("pglite.data")),
      ]);
      const [pgliteWasmModule, initdbWasmModule, fsBundle] = await Promise.all([
        WebAssembly.compile(await pgliteRes.arrayBuffer()),
        WebAssembly.compile(await initdbRes.arrayBuffer()),
        dataRes.blob(),
      ]);
      return { pgliteWasmModule, initdbWasmModule, fsBundle };
    })();
  }
  return pgliteAssetsPromise;
}

/** Run the full generate→install→bundle→boot→dispatch pipeline for one
 *  source and assert a clean product round-trip.  `expectSchemaQualified`
 *  additionally asserts the synthesised DDL declares a Postgres schema —
 *  so the system-mode case can't silently degrade into testing an
 *  unqualified backend (which would no longer guard the regression). */
const ENTRY = "/workspace/main.ddd";

/** The workspace tree the build worker plans and records from: the entry
 *  source plus the chain files recorded so far. */
function workspaceTree(text, chain) {
  return { entryPath: ENTRY, files: [{ kind: "file", path: ENTRY, content: text }, ...chain] };
}

async function recordChain(text, name, chain) {
  const r = await recordMigration({ current: workspaceTree(text, chain), name, now: "20261108120000" });
  if (!r.ok) fail(`recording "${name}" failed: ${JSON.stringify(r.diagnostics)}`);
  return [...chain, ...r.files.map((f) => ({ kind: "file", path: f.path, content: f.content }))];
}

async function planFor(text, chain) {
  const r = await migrationPlan({ current: workspaceTree(text, chain) });
  if (!r.ok || r.plan.kind !== "chain") fail(`migration plan failed: ${JSON.stringify(r)}`);
  return r.plan;
}

async function userSchemas(pglite) {
  const res = await pglite.query(
    "SELECT nspname FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema' ORDER BY 1",
  );
  return res.rows.map((r) => r.nspname);
}

async function runCase({
  label,
  sourcePath,
  mode,
  expectSchemaQualified,
  expectAuth,
  evolve,
  afterBoot,
}) {
  // Per-CASE identity for the emitted bundle.  It used to be the `mode` alone,
  // which is not unique: `await import()` caches by URL, so a second case with
  // the same mode re-imported the FIRST case's already-evaluated module and
  // asserted against the wrong backend — silently, and green.  The auth case
  // below is the one that surfaced it (it booted the sales-system app, which
  // has no /auth routes at all).  Keyed off the fixture, which is what actually
  // distinguishes two cases.
  const caseId = `${mode}-${path.basename(sourcePath, ".ddd")}`;
  console.log(`\n=== case: ${label} (${path.basename(sourcePath)}) ===`);

  console.log("# 1/5 generating…");
  const { files, entry } = await generateBackend(sourcePath);
  const schemaPath = schemaPathFor(entry);
  if (!resolveInFs(files, entry) || !resolveInFs(files, schemaPath)) {
    fail(`entry/schema missing (${entry} / ${schemaPath})`);
  }
  console.log(`# generated ${files.size} files; entry ${entry}`);

  console.log("# 2/5 installing real npm tarballs + bundling (VFS plugin, no esm.sh)…");
  const vfs = new Map();
  for (const [p, c] of files) vfs.set("/" + p, c);
  // The Hono deployable's package.json sits next to its entry, under the slug.
  const slugMatch = entry.match(/^(.+)\/http\/index\.ts$/);
  const pkgPath = slugMatch ? `${slugMatch[1]}/package.json` : "package.json";
  const pkg = JSON.parse(files.get(pkgPath) ?? "{}");
  const rootDeps = {
    ...(pkg.dependencies ?? {}),
    "@electric-sql/pglite": RUNTIME_VERSIONS["@electric-sql/pglite"],
  };
  const t0 = Date.now();
  const { versions, fileCount } = await install(rootDeps, (p, d) => vfs.set(p, d));
  console.log(`# installed ${versions.size} pkgs / ${fileCount} files in ${Date.now() - t0} ms`);

  const bundleStart = Date.now();
  const out = await esbuild.build({
    stdin: {
      // `vfs` is keyed "/" + path, which is what devStubEntryFor expects.  An
      // `auth: required` fixture would otherwise die at the createApp below
      // with "No user verifier is registered" — the same #2571 gap the runtime
      // engine had.  Today's fixtures declare no auth, so this is a no-op that
      // keeps the two boot paths from drifting apart again.
      contents: makeEntryStdin(
        entry,
        schemaPath,
        devStubEntryFor(vfs, entry),
        bootEntryFor(vfs, entry),
      ),
      resolveDir: "/",
      sourcefile: "__entry__.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    write: false,
    sourcemap: false,
    outdir: "/",
    loader: { ".wasm": "binary" },
    plugins: [makeVfsNpmPlugin(vfs)],
  });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js")) ?? out.outputFiles[0];
  const code = js.text;
  console.log(`# bundled ${(code.length / 1024).toFixed(0)} KB in ${Date.now() - bundleStart} ms`);

  console.log("# 3/5 post-processing + importing…");
  const patched = postProcessNpmBundle(code);

  // WORKER-REALM GATE — run BEFORE the Node import below, because the Node
  // import is exactly what cannot see this class of bug.  Node has a real
  // `process` and a real `Buffer`; the browser worker that actually boots
  // this bundle has neither, and a dependency reading one while its module
  // body evaluates kills `await import(blobUrl)` outright ("Bundle import
  // failed: …").  Two shipped that way — prom-client's `process.uptime()`
  // and pg-protocol's `Buffer.allocUnsafe(0)`, both top-level statements.
  // See worker-realm.mjs for what this does and does not prove.
  const realm = await evaluateInWorkerRealm(patched, {
    filename: `loom-bundle-${caseId}.mjs`,
  }).catch((err) => {
    fail(
      `bundle failed to evaluate in a worker-shaped realm: ${err.message}\n` +
        `        This is what the browser reports as "Bundle import failed".\n` +
        `        A Node global read at module-evaluation time is the usual cause —\n` +
        `        shim it in web/src/engine/npm/postprocess.ts (globals the bundle\n` +
        `        prefix installs) or web/src/runtime/runtime.worker.ts (globals the\n` +
        `        worker itself must provide, e.g. Buffer).`,
    );
  });
  for (const name of EXPECTED_EXPORTS) {
    if (!(name in realm)) fail(`bundle missing export in worker realm: ${name}`);
  }
  console.log(
    `# worker realm OK — evaluated with ${absentNodeGlobalsIn()} absent, ` +
      `${EXPECTED_EXPORTS.length} exports present`,
  );
  if (REALM_ONLY) {
    console.log(`# --realm-only: skipping PGlite boot + dispatch for "${label}"`);
    return;
  }

  const tmpFile = path.join(os.tmpdir(), `loom-bundle-${caseId}-${process.pid}.mjs`);
  writeFileSync(tmpFile, patched);
  const mod = await import(pathToFileURL(tmpFile).href);
  for (const name of EXPECTED_EXPORTS) {
    if (!(name in mod)) fail(`bundle missing export: ${name}`);
  }

  const assets = await pgliteAssets();
  const pglite = new mod.PGlite(assets);
  await pglite.exec("SELECT 1;");
  const text = readFileSync(sourcePath, "utf8");
  let chain = [];
  let ddl;
  console.log("# 4/5 recorded migrations + PGlite + createApp…");
  // No chain: the whole schema is unrecorded, and nothing is created.
  const before = await userSchemas(pglite);
  const unrecorded = await migrateChain(pglite, await planFor(text, chain));
  if (!("blocked" in unrecorded) || !unrecorded.blocked.initial) {
    fail(`a model with no recorded migration must not migrate, got ${JSON.stringify(unrecorded)}`);
  }
  const after = await userSchemas(pglite);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    fail(`an unrecorded initial migration created schemas: ${before} → ${after}`);
  }
  console.log("# no recorded migration — database left untouched");
  chain = await recordChain(text, "initial", chain);
  const plan = await planFor(text, chain);
  const res = await migrateChain(pglite, plan);
  if (!("applied" in res) || res.applied.length === 0) {
    fail(`the recorded initial migration did not apply: ${JSON.stringify(res)}`);
  }
  ddl = chainDdl(plan.units);
  console.log(`# applied ${res.applied.join(", ")}`);
  if (expectSchemaQualified) {
    // Guards that this case is genuinely exercising a pgSchema-qualified
    // backend (the regression surface) — not silently a public-schema one.
    if (!/CREATE SCHEMA IF NOT EXISTS/.test(ddl)) {
      console.log("--- DDL ---\n" + ddl + "\n-----------");
      fail("expected a CREATE SCHEMA in the system-mode DDL (pgSchema not exercised)");
    }
    if (!/CREATE TABLE (IF NOT EXISTS )?"[^"]+"\."products"/.test(ddl)) {
      console.log("--- DDL ---\n" + ddl + "\n-----------");
      fail('expected a schema-qualified "products" table in the system-mode DDL');
    }
    console.log("# DDL is schema-qualified (CREATE SCHEMA + qualified products table)");
  }

  const db = mod.drizzle(pglite, { schema: mod.schema });
  // The runtime worker's boot call, verbatim: the generated start-up sequence
  // with the browser's answers (no IdP, no broker, no second connection).
  const { app, stop } = await mod.bootApp(db, { verifier: "dev-stub", infra: "in-process" });
  console.log("# app booted (bootApp)");

  console.log("# 5/5 dispatching requests against in-process backend…");
  // Domain routes mount under the shared API base path (`/api`); infra
  // (`/health`, `/ready`) stays at the root.
  const productsUrl = `http://localhost${API_BASE_PATH}/products`;
  const list0 = await app.fetch(new Request(productsUrl));
  if (list0.status !== 200)
    fail(`GET ${API_BASE_PATH}/products expected 200, got ${list0.status}: ${await list0.text()}`);

  const created = await app.fetch(
    new Request(productsUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "WIDGET-1", price: { amount: 5.0, currency: "USD" } }),
    }),
  );
  if (created.status >= 400)
    fail(`POST ${API_BASE_PATH}/products returned ${created.status}: ${await created.text()}`);

  const list1 = await app.fetch(new Request(productsUrl));
  const body = await list1.text();
  if (list1.status !== 200) fail(`GET /products (after create) expected 200, got ${list1.status}: ${body}`);
  const parsed = JSON.parse(body);
  // A `crudish` aggregate's findAll returns the paged envelope
  // ({ items, page, pageSize, total, totalPages }); a plain findAll returns a
  // bare array. Accept either so the smoke matches the current contract.
  const rows = Array.isArray(parsed) ? parsed : parsed.items;
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].sku !== "WIDGET-1") {
    fail(`expected 1 product 'WIDGET-1', got ${JSON.stringify(parsed)}`);
  }
  console.log(`# OK — round-tripped 1 product (${rows[0].sku}) through PGlite + drizzle + Hono`);

  // A FRAMEWORK fault must answer an RFC 7807 document, not take the worker
  // down.  The reason phrase used to come from node's `STATUS_CODES`, which
  // bundles to an empty module on the browser target this preview runs — so
  // `frameworkProblemBody` threw inside the very handler meant to turn a fault
  // into a response, and every 404/422/500 killed the runtime.  No case ever
  // requested a missing route, so nothing noticed.
  const miss = await app.fetch(new Request(`http://localhost${API_BASE_PATH}/__no_such_route`));
  if (miss.status !== 404) fail(`expected 404 for an unrouted path, got ${miss.status}`);
  const missBody = await miss.text();
  const problem = JSON.parse(missBody);
  if (problem?.title !== "Not Found" || problem?.status !== 404) {
    fail(`404 should be an RFC 7807 problem document, got ${missBody}`);
  }
  console.log(`# framework 404 answered a problem document (${problem.title})`);

  if (expectAuth) {
    // The session probe the `auth: ui` guard reads.  Reaching it at all means
    // the dev-stub verifier was registered (createApp would have thrown
    // otherwise), and the body is the DECLARED `user { … }` shape — id + role,
    // filled by the stub's built-in identity (#2548, #2571).
    const me = await app.fetch(new Request(`http://localhost${API_BASE_PATH}/auth/me`));
    const meBody = await me.text();
    if (me.status !== 200) fail(`GET ${API_BASE_PATH}/auth/me expected 200, got ${me.status}: ${meBody}`);
    const principal = JSON.parse(meBody);
    if (typeof principal?.id !== "string" || typeof principal?.role !== "string") {
      fail(`/auth/me should answer the declared user shape {id, role}, got ${meBody}`);
    }
    console.log(`# auth: dev stub registered — /auth/me answered ${meBody}`);
  }

  if (evolve) {
    // A recorded schema change migrates the SAME database in place: the
    // product created above survives, and the new column exists.
    const evolved = text.replace(evolve.from, evolve.to);
    if (evolved === text) fail(`the evolution edit did not apply to ${path.basename(sourcePath)}`);
    const pending = await migrateChain(pglite, await planFor(evolved, chain));
    if (!("blocked" in pending) || pending.blocked.initial) {
      fail(`an unrecorded change must leave the database as it is, got ${JSON.stringify(pending)}`);
    }
    chain = await recordChain(evolved, evolve.name, chain);
    const res = await migrateChain(pglite, await planFor(evolved, chain));
    if (!("applied" in res) || res.applied.length !== 1) {
      fail(`the recorded evolution did not apply exactly one unit: ${JSON.stringify(res)}`);
    }
    const col = await pglite.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = $1",
      [evolve.column],
    );
    if (col.rows.length !== 1) fail(`column ${evolve.column} missing after ${res.applied[0]}`);
    const kept = await app.fetch(new Request(productsUrl));
    const keptBody = JSON.parse(await kept.text());
    const keptRows = Array.isArray(keptBody) ? keptBody : keptBody.items;
    if (keptRows?.length !== 1 || keptRows[0].sku !== "WIDGET-1") {
      fail(`the product did not survive ${res.applied[0]}: ${JSON.stringify(keptBody)}`);
    }
    console.log(`# evolved in place by ${res.applied[0]} — ${evolve.column} added, 1 product kept`);
  }

  if (afterBoot) await afterBoot(app);

  await stop();
  await pglite.close();
}

/** Poll `GET url` until `accept(rows)` holds, or fail after `ms`. */
async function waitForRows(app, url, accept, what, ms = 8000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    const res = await app.fetch(new Request(url));
    const body = JSON.parse(await res.text());
    last = Array.isArray(body) ? body : body.items;
    if (Array.isArray(last) && accept(last)) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  fail(`${what} within ${ms} ms; last rows ${JSON.stringify(last)}`);
}

await runCase({
  label: "system mode (per-context pgSchema)",
  sourcePath: path.resolve(here, "../src/examples/sales-system.ddd"),
  mode: "system",
  expectSchemaQualified: true,
  evolve: {
    name: "add-barcode",
    from: "        sku: string\n        price: Money\n",
    to: "        sku: string\n        barcode: string?\n        price: Money\n",
    column: "barcode",
  },
});

// `auth: required` (#2571).  The preview boots `createApp`, which asserts a
// registered verifier — so before the entry registered the emitted dev stub
// this case died at "# app booted" with
// "createApp failed: No user verifier is registered".
await runCase({
  label: "auth: required (dev-stub verifier registered by the bundle entry)",
  sourcePath: path.resolve(here, "fixtures/auth-required-smoke.ddd"),
  mode: "system",
  expectSchemaQualified: true,
  expectAuth: true,
});

// The generated start-up sequence (#4775).  Booting bare `createApp(db)`
// skipped the broker transports, the consumer loop and the timers, so this
// case's channel subscriber and `every:` timer never fired in the preview.
await runCase({
  label: "boot sequence (channel consumer + every: timer through bootApp)",
  sourcePath: path.resolve(here, "fixtures/boot-sequence-smoke.ddd"),
  mode: "system",
  expectSchemaQualified: true,
  afterBoot: async (app) => {
    const base = `http://localhost${API_BASE_PATH}`;
    const list = await app.fetch(new Request(`${base}/products`));
    const product = JSON.parse(await list.text()).items?.[0];
    if (!product?.id) fail("no product to announce");
    const announced = await app.fetch(
      new Request(`${base}/products/${product.id}/announce`, { method: "POST" }),
    );
    if (announced.status >= 400) {
      fail(`POST announce returned ${announced.status}: ${await announced.text()}`);
    }
    // `ProductAnnounced` rides a redis-bound channel: it reaches the
    // co-located `Notify` workflow only through the publish tee, the
    // in-process broker and the consumer loop.
    await waitForRows(
      app,
      `${base}/notices`,
      (rows) => rows.some((r) => r.sku === product.sku),
      "the channel subscriber did not create a Notice",
    );
    console.log("# channel: ProductAnnounced reached the co-located subscriber");
    // `pulse` ticks every second; each tick starts a `Pulse` saga that
    // creates a Beat.
    const beats = await waitForRows(
      app,
      `${base}/beats`,
      (rows) => rows.some((r) => r.source === "timer"),
      "the every: timer did not fire",
    );
    console.log(`# timer: every: fired (${beats.length} beat(s))`);
  },
});

console.log("\n# all green");
