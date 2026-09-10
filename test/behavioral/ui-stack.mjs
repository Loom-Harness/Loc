// The one-origin generated-stack boot shared by the UI-tier runners.
//
// Both `run-ui.mjs` (the emitted `*.ui.spec.ts` round-trips) and
// `paged-ui.mjs` (the hand-written-page paging proof) need the SAME thing:
// locate the generated node deployable + frontend, build the frontend with
// its own build script, and serve the built bundle AND the generated Hono
// backend (on PGlite, in-process — no docker) from ONE node HTTP server so
// the browser sees one origin with no proxy and no CORS.
//
// It lives here rather than in either runner because a second copy of this
// wiring is a second place for the origin/proxy/CORS invariant to drift —
// and a drift there fails as a browser-level mystery, not a diff.

// esbuild is loaded lazily inside the bundler step: the runtime legs have it
// (the generated project installs it), but the fast suite that unit-tests this
// module's pure helpers (test/harness/ui-stack-frontend-build.test.ts) must
// not need it at import time.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

/** Recursively collect files under `dir` matching `pred`. */
export function walk(dir, pred, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") continue;
      walk(p, pred, out);
    } else if (pred(p)) out.push(p);
  }
  return out;
}

/** The one `platform: node` deployable dir: has both http/index.ts and db/schema.ts. */
export function findNodeDeployable(genDir) {
  const hits = walk(genDir, (p) => p.endsWith("/http/index.ts")).map((p) => resolve(p, "..", ".."));
  const dirs = [...new Set(hits)].filter((d) => existsSync(join(d, "db", "schema.ts")));
  if (dirs.length !== 1) {
    throw new Error(
      `expected exactly one node (Hono) deployable, found ${dirs.length}: ${dirs.join(", ")}`,
    );
  }
  return dirs[0];
}

/** Locate the built SPA root under a frontend dir — the dir that holds the
 *  emitted `index.html`.  Framework-agnostic: react/vue → `dist/`, SvelteKit
 *  (adapter-static) → `build/`, Angular → `dist/<app>/browser/`.  Excludes the
 *  source tree (a frontend's `index.html` also lives at its root pre-build) by
 *  only accepting a build-output dir (`dist`/`build` segment in the path). */
export function findDistRoot(frontendDir) {
  const hits = walk(frontendDir, (p) => p.endsWith("/index.html")).filter((p) => {
    const rel = p.slice(frontendDir.length);
    return /[/\\](dist|build)[/\\]/.test(rel);
  });
  if (hits.length === 0) {
    throw new Error(`no built index.html under ${frontendDir} — did the frontend build?`);
  }
  // Prefer the shallowest (e.g. dist/index.html over a nested asset copy).
  hits.sort((a, b) => a.split("/").length - b.split("/").length);
  return dirname(hits[0]);
}

/** The frontend deployable dir: has e2e/playwright.config.ts.  Framework-agnostic
 *  — the emitted `.ui.spec.ts` + page objects are testid-driven, so the same
 *  round-trip runs against any frontend; the per-framework build command
 *  (`npm run build`) and built-root (findDistRoot) are resolved above. */
export function findFrontendDeployable(genDir) {
  const hits = walk(genDir, (p) => p.endsWith("/e2e/playwright.config.ts")).map((p) =>
    resolve(p, "..", ".."),
  );
  const dirs = [...new Set(hits)];
  if (dirs.length !== 1) {
    throw new Error(
      `expected exactly one frontend with a UI e2e suite (e2e/playwright.config.ts), found ${dirs.length}: ${dirs.join(", ")}`,
    );
  }
  return dirs[0];
}

/** Everything a failed `execFileSync` knows, as one string.  `err.message`
 *  carries stderr but NOT stdout, and npm writes a good half of its diagnosis
 *  (the `npm error` block, the resolution log) to stdout — so a harness that
 *  reports only `err.message` throws away the half that names the cause. */
export function combinedOutput(err) {
  const dec = (b) => (typeof b === "string" ? b : b?.toString?.("utf8"));
  return [err?.message, dec(err?.stdout), dec(err?.stderr)].filter(Boolean).join("\n");
}

/** npm's optional-dependency hole (npm/cli#4828), as it reads from the other
 *  side.  A registry blip while fetching a PLATFORM-SPECIFIC optional package
 *  (`@rolldown/binding-linux-x64-gnu` for the vite 8 bundler, `@rollup/rollup-*`,
 *  `@esbuild/*`, `@swc/*`, …) is NOT fatal to `npm install`: optional means
 *  optional, so the install exits 0 having silently skipped it.  The damage
 *  surfaces minutes later, in `npm run build`, as the bundler failing to load
 *  its native binding — an error that names npm's bug and prescribes the fix
 *  ("remove both package-lock.json and node_modules directory"), and has
 *  nothing to do with the generated code under test.
 *
 *  Measured on this leg: the 2026-09-09 nightly lost BOTH the vue and the
 *  svelte cell to it inside the same runner window
 *  (`Cannot find module '@rolldown/binding-linux-x64-gnu'`), while the feliz
 *  cell in the same run failed for an unrelated, real reason. */
export const OPTIONAL_DEP_MISS_RE =
  /Cannot find native binding|npm has a bug related to optional dependencies|Cannot find module '@(?:rolldown|rollup|esbuild|swc|napi-rs|parcel|tailwindcss)\/[^']*'/;

/** Does this build output look like npm's optional-dependency hole? */
export function isOptionalDepMiss(text) {
  return OPTIONAL_DEP_MISS_RE.test(String(text ?? ""));
}

/** npm config that narrows the registry window this leg keeps falling into:
 *  five fetch attempts instead of two, and a longer ceiling between them. */
const FETCH_RETRY_FLAGS = ["--fetch-retries=5", "--fetch-retry-maxtimeout=120000"];

/**
 * Install + build a generated frontend with its OWN build script, and return
 * the built SPA root.
 *
 * Shared by `run-ui.mjs` and `paged-ui.mjs` for the same reason the boot below
 * is shared: two copies of "how a generated frontend is built" is two places
 * for the optional-dependency heal to be missing from.
 *
 * `install` / `buildScript` / `clean` / `distRoot` are injection seams for the
 * per-PR harness gate (test/harness/ui-stack-frontend-build.test.ts), which has
 * to assert the heal WITHOUT a network, an npm, or a generated project.
 * Production callers pass none of them.
 */
export function buildFrontend(frontendDir, opts = {}) {
  const {
    log = () => {},
    install = (dir, extra = []) =>
      execFileSync(npm, ["install", "--no-audit", "--no-fund", ...FETCH_RETRY_FLAGS, ...extra], {
        cwd: dir,
        stdio: "pipe",
      }),
    buildScript = (dir) => {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.scripts?.build) execFileSync(npm, ["run", "build"], { cwd: dir, stdio: "pipe" });
      else execFileSync(npx, ["vite", "build"], { cwd: dir, stdio: "pipe" });
    },
    clean = (dir) => {
      rmSync(join(dir, "node_modules"), { recursive: true, force: true });
      rmSync(join(dir, "package-lock.json"), { force: true });
    },
    distRoot = findDistRoot,
  } = opts;

  const attempt = () => {
    install(frontendDir);
    buildScript(frontendDir);
  };

  try {
    attempt();
  } catch (err) {
    const out = combinedOutput(err);
    // Only npm's own hole is retried, and only once.  Anything else is the
    // generated code failing to build — the thing this leg exists to catch —
    // and is rethrown WITH the stdout half of its diagnosis attached.
    if (!isOptionalDepMiss(out)) {
      err.message = out;
      throw err;
    }
    log(
      "loom-retry: the frontend build hit npm's optional-dependency hole " +
        "(npm/cli#4828) — wiping node_modules + package-lock.json and reinstalling once.\n" +
        `${out.split("\n").slice(0, 6).join("\n")}\n`,
    );
    clean(frontendDir);
    try {
      attempt();
    } catch (err2) {
      err2.message = combinedOutput(err2);
      throw err2;
    }
  }
  return distRoot(frontendDir);
}

/**
 * Copy every `test-results` dir out of a generated tree into `workDir`.
 *
 * Playwright's evidence for a red cell — `trace.zip`, `test-failed-1.png`,
 * `error-context.md` — is written under `<frontend>/e2e/test-results`, i.e.
 * INSIDE the mkdtemp the runners unlink in their `finally`.  So the nightly
 * leg's log named a trace file that no longer existed by the time the job
 * ended, and every investigation had to start from the console tail.  `workDir`
 * lives in the repo, where the workflow's `upload-artifact` step can reach it.
 *
 * Never throws: rescuing evidence must not replace the failure it documents.
 */
export function preserveArtifacts(genDir, workDir) {
  const MARK = "/test-results";
  try {
    const roots = new Set(
      walk(genDir, (p) => p.slice(genDir.length).includes(`${MARK}/`)).map((p) =>
        p.slice(0, p.indexOf(`${MARK}/`) + MARK.length),
      ),
    );
    for (const root of roots) {
      cpSync(root, join(workDir, "test-results"), { recursive: true, force: true });
    }
    return [...roots];
  } catch {
    return [];
  }
}

/** The bundled boot: createApp on PGlite, served (static dist + /api) over one HTTP origin. */
function serverEntrySource({ deplDir }) {
  const J = JSON.stringify;
  return `
import { synthDDL } from ${J(join(REPO, "web/src/runtime/ddl.ts"))};
import { createApp } from ${J(join(deplDir, "http/index.ts"))};
import * as schema from ${J(join(deplDir, "db/schema.ts"))};
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { is, Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

// \`.wasm\` MUST be \`application/wasm\`: \`WebAssembly.instantiateStreaming\`
// REJECTS any other content-type, and CanvasKit (the Flutter web renderer)
// streams its \`.wasm\` that way — served as octet-stream the Flutter bundle
// silently never boots (no error, no <flutter-view>, an empty body).  \`.otf\`
// is here for the same reason in a milder form (Flutter's tree-shaken
// MaterialIcons face).
const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".css":"text/css", ".json":"application/json", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".gif":"image/gif", ".ico":"image/x-icon", ".woff2":"font/woff2", ".woff":"font/woff", ".ttf":"font/ttf", ".otf":"font/otf", ".wasm":"application/wasm", ".map":"application/json", ".txt":"text/plain", ".webmanifest":"application/manifest+json" };

export async function startServer({ distDir }) {
  const pglite = new PGlite();
  await pglite.exec(synthDDL(schema, { is, Table, getTableConfig }));
  const db = drizzle(pglite, { schema });
  const app = createApp(db);
  const server = createServer(async (req, res) => {
    try {
      const p = new URL(req.url, "http://localhost").pathname;
      // /api, /health, /ready → the generated Hono app, in-process.
      if (p === "/api" || p.startsWith("/api/") || p === "/health" || p === "/ready") {
        let body;
        if (req.method !== "GET" && req.method !== "HEAD") {
          const chunks = []; for await (const c of req) chunks.push(c); body = Buffer.concat(chunks);
        }
        const fres = await app.fetch(new Request("http://localhost" + req.url, { method: req.method, headers: req.headers, body, duplex: "half" }));
        const buf = Buffer.from(await fres.arrayBuffer());
        const h = {}; fres.headers.forEach((v, k) => { h[k] = v; });
        res.writeHead(fres.status, h); res.end(buf); return;
      }
      // everything else → the built SPA, with index.html fallback for routes.
      let file = join(distDir, normalize(p)); let data;
      try { const s = await stat(file); if (s.isDirectory()) file = join(file, "index.html"); data = await readFile(file); }
      catch { if (extname(p)) { res.writeHead(404); res.end("not found"); return; } file = join(distDir, "index.html"); data = await readFile(file); }
      const buf = Buffer.from(data);
      res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "content-length": String(buf.length) }); res.end(buf);
    } catch (e) { res.writeHead(500); res.end(String(e?.message ?? e)); }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: server.address().port,
    close: () => new Promise((r) => server.close(() => { try { pglite.close?.(); } catch {} r(); })),
  };
}
`;
}

/** Bundle + import the boot module; returns { startServer }. */
export async function buildServerModule(deplDir, workDir) {
  const entry = join(workDir, "server-entry.mts");
  const bundle = join(workDir, "server-bundle.mjs");
  writeFileSync(entry, serverEntrySource({ deplDir }));
  const { build } = await import("esbuild");
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
  return import(pathToFileURL(bundle).href);
}

/** Recursively flatten a Playwright JSON report to {name,status,error} outcomes. */
export function outcomesFromPlaywrightJson(json) {
  const out = [];
  const visit = (suites) => {
    for (const s of suites ?? []) {
      for (const spec of s.specs ?? []) {
        const err = spec.tests
          ?.flatMap((t) => t.results ?? [])
          .map((r) => r.error?.message)
          .find(Boolean);
        out.push({ name: spec.title, status: spec.ok ? "pass" : "fail", error: err });
      }
      visit(s.suites);
    }
  };
  visit(json.suites);
  return out;
}
