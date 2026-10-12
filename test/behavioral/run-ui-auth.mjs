// Headless behavioral UI tier — the RUNTIME auth-UI leg for the two
// SELF-HOSTING frontends (M-T9.14's residue: "no RUNTIME auth-UI leg").
//
// `auth: ui` on Feliz and Flutter is pinned at generator level
// (`test/generator/{feliz,flutter}/auth-gate.test.ts`: the emitted text has a
// session probe, a gate, a per-page guard, a hidden button) and compiled by
// `generated-{feliz,flutter}-build.yml`.  Neither proves the gate WORKS: that
// the app's own `/auth/me` probe reaches a backend and decodes the principal,
// that a `requires` page renders its body for one role and the Forbidden view
// for another, that the Approve button tracks the role the backend itself
// enforces.  The JSX frontends' runtime smoke (`test/e2e/auth-gate-ui-e2e`)
// mocks `/auth/me` with no backend at all, and never ran on these two.
//
// This leg runs run-ui.mjs's topology — generate → build the frontend with its
// OWN toolchain → serve the built bundle and the generated Hono backend (PGlite,
// in-process) from ONE origin → drive it in headless Chromium — against
// `test/e2e/fixtures/feliz-flutter-auth-ui/auth-ui.ddd`, with the backend's
// DEV-STUB verifier registered.  The principal is chosen per browser context by
// the `x-loom-dev-claims` header, the behavioural tier's `DEV_CLAIMS`
// mechanism (`cases.mjs`): every request the app makes carries it, so `/auth/me`
// answers that principal from the real backend and the backend's own `requires`
// on `approve` judges the same one the button mirrors.  Nothing is mocked on
// the authenticated paths.  The one mock is the ANONYMOUS probe: the dev stub
// authenticates every request by design, so "no session" is a `/auth/me` 401
// fulfilled in the browser — the branch that renders the sign-in prompt.
//
// Per frontend, the assertion surface differs the way run-ui-flutter.mjs
// already established: Feliz renders DOM (roles and text), Flutter renders to a
// canvas and is read through its semantics tree (accessible text).  Flutter
// also emits NO navigation from a `menu { }` block, so its menu-link gate site
// does not exist to test — recorded in the hand-off, and the leg asserts the
// three sites Flutter does render (session, page guard, action).
//
// Usage:  npm ci (in this dir, once) ; node run-ui-auth.mjs [feliz] [flutter]
//         (default: both)  FLUTTER=/path/to/flutter — SDK override
//         LOOM_UI_MUTATE=<module.mjs> — mutation-proof seam, as in run-ui.mjs
// Exit code is non-zero if any frontend errors or any probe fails.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildFrontend,
  buildServerModule,
  findDistRoot,
  findNodeDeployable,
  walk,
} from "./ui-stack.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WORK = join(HERE, ".work-ui-auth");
const FIXTURE = join(REPO, "test/e2e/fixtures/feliz-flutter-auth-ui/auth-ui.ddd");
const FLUTTER = process.env.FLUTTER ?? "flutter";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

/** The three principals, as `x-loom-dev-claims` payloads.  `id` differs per
 *  role so a probe that accidentally reuses a context is visible in the log. */
const PRINCIPAL = {
  admin: { id: "u-admin", role: "admin" },
  superadmin: { id: "u-super", role: "superadmin" },
  viewer: { id: "u-viewer", role: "viewer" },
};
const claimsHeader = (p) => ({
  "x-loom-dev-claims": Buffer.from(JSON.stringify(p)).toString("base64"),
});

/** The frontend deployable dir for each target: Feliz ships an `App.fsproj`,
 *  Flutter a `pubspec.yaml` + `lib/main.dart`. */
function findFrontend(genDir, fw) {
  const hits =
    fw === "flutter"
      ? walk(genDir, (p) => p.endsWith("/pubspec.yaml"))
          .map((p) => dirname(p))
          .filter((d) => existsSync(join(d, "lib", "main.dart")))
      : walk(genDir, (p) => p.endsWith("/App.fsproj")).map((p) => dirname(p));
  const dirs = [...new Set(hits)];
  if (dirs.length !== 1) throw new Error(`expected one ${fw} deployable, found ${dirs.length}`);
  return dirs[0];
}

function build(fw, frontendDir) {
  if (fw === "flutter") {
    // As run-ui-flutter.mjs: `--no-web-resources-cdn` bundles CanvasKit so the
    // leg is hermetic (a CDN fetch at runtime renders nothing, silently).
    execFileSync(FLUTTER, ["pub", "get"], { cwd: frontendDir, stdio: "pipe" });
    execFileSync(FLUTTER, ["build", "web", "--release", "--no-web-resources-cdn"], {
      cwd: frontendDir,
      stdio: "pipe",
    });
    return findDistRoot(frontendDir);
  }
  return buildFrontend(frontendDir, { log: (m) => process.stdout.write(`    ${m}`) });
}

/** What a page shows, as text.  Feliz: the DOM's innerText.  Flutter: turn the
 *  semantics tree on and read the accessible text (innerText + aria-labels),
 *  polling until `until(text)` holds or the budget runs out — the chrome paints
 *  before the session probe resolves, so a single early sample proves nothing. */
async function pageText(page, fw, until, { enable = true } = {}) {
  const deadline = Date.now() + 30_000;
  let text = "";
  // Enabling is once per page: the engine removes the placeholder when the
  // semantics tree comes on, so a second wait for it can only time out.
  if (fw === "flutter" && enable) {
    await page.waitForFunction(() => !!document.querySelector("flt-semantics-placeholder"), null, {
      timeout: 120_000,
      polling: 250,
    });
    await page.evaluate(() => document.querySelector("flt-semantics-placeholder")?.click());
  }
  for (;;) {
    text = await page.evaluate(
      () =>
        `${document.body.innerText ?? ""}\n${[...document.querySelectorAll("[aria-label]")]
          .map((e) => e.getAttribute("aria-label"))
          .join("\n")}`,
    );
    if (until(text) || Date.now() > deadline) return text;
    await page.waitForTimeout(250);
  }
}

/** Open `path` as `principal` (null = anonymous) and return what rendered, the
 *  `/api` calls the app made, and its page errors. */
async function visit(browser, origin, fw, principal, path, until) {
  const context = await browser.newContext(
    principal ? { extraHTTPHeaders: claimsHeader(principal) } : {},
  );
  const page = await context.newPage();
  const api = [];
  const errors = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) {
      api.push({ method: r.request().method(), path: u.pathname, status: r.status() });
    }
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  if (!principal) {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
    );
  }
  // Flutter routes by hash (`#/admin`), Feliz by path.
  await page.goto(fw === "flutter" ? `${origin}/#${path}` : `${origin}${path}`);
  const text = await pageText(page, fw, until);
  return { page, context, text, api, errors };
}

/** The probes.  Each names ONE gate site and one principal, and each asserts
 *  the branch it names AND that the app's session probe reached the backend
 *  (so a leg that silently fell back to the sign-in prompt cannot pass a
 *  "hidden" assertion by rendering nothing at all). */
function probes(fw, jobId) {
  // An AUTHENTICATED probe must see the app itself: the probe answered 200 AND
  // the gate let the principal in.  The second half is not redundant — a
  // claims decoder that cannot read the answer (a wrong wire key) leaves the
  // app on the sign-in prompt behind a perfectly good 200, and every "X is
  // hidden" assertion then passes on an empty page (measured: the seeded
  // wrong-key mutation left the viewer's hidden-Approve probe green until this
  // check existed).
  const sawSession = (v) => [
    ...(v.api.some((a) => a.path === "/api/auth/me" && a.status === 200)
      ? []
      : [`the app's /auth/me never answered 200 (saw: ${JSON.stringify(v.api)})`]),
    ...(/Sign in|not signed in/.test(v.text)
      ? ["the session gate fell back to the sign-in prompt for an authenticated principal"]
      : []),
  ];
  const menu = fw === "feliz";
  const list = [
    {
      name: "session gate: an anonymous visitor gets the sign-in prompt, not the app",
      principal: null,
      path: "/public",
      until: (t) => /Sign in/.test(t),
      check: (v) => [
        ...(/Sign in/.test(v.text) ? [] : ["no 'Sign in' prompt"]),
        ...(/Admin Area|Forbidden/.test(v.text) ? ["the app rendered behind the gate"] : []),
      ],
    },
    {
      name: "page guard: admin sees the /admin body",
      principal: PRINCIPAL.admin,
      path: "/admin",
      until: (t) => /Admin Area|Forbidden/.test(t),
      check: (v) => [
        ...sawSession(v),
        ...(/Admin Area/.test(v.text) ? [] : ["'Admin Area' not rendered"]),
        ...(/Forbidden/.test(v.text) ? ["Forbidden rendered for a matching role"] : []),
      ],
    },
    {
      name: "page guard: a viewer gets Forbidden on /admin",
      principal: PRINCIPAL.viewer,
      path: "/admin",
      until: (t) => /Admin Area|Forbidden/.test(t),
      check: (v) => [
        ...sawSession(v),
        ...(/Forbidden/.test(v.text) ? [] : ["'Forbidden' not rendered"]),
        ...(/Admin Area/.test(v.text) ? ["'Admin Area' leaked to a non-matching role"] : []),
      ],
    },
    {
      name: "page guard: admin gets Forbidden on /super (a DIFFERENT role's page)",
      principal: PRINCIPAL.admin,
      path: "/super",
      until: (t) => /Super Area|Forbidden/.test(t),
      check: (v) => [
        ...sawSession(v),
        ...(/Forbidden/.test(v.text) ? [] : ["'Forbidden' not rendered"]),
        ...(/Super Area/.test(v.text) ? ["'Super Area' leaked to admin"] : []),
      ],
    },
    {
      name: "action gate: admin sees Approve on the job page",
      principal: PRINCIPAL.admin,
      path: `/jobs/${jobId}`,
      until: (t) => /Approve/.test(t),
      check: (v) => [...sawSession(v), ...(/Approve/.test(v.text) ? [] : ["no Approve button"])],
    },
    {
      name: "action gate: a viewer does not see Approve on the job page",
      principal: PRINCIPAL.viewer,
      path: `/jobs/${jobId}`,
      // Hidden is only meaningful once the page has READ the job — wait for the
      // app's own byId read, not for text that must never appear.
      until: () => true,
      settle: (v) => v.api.some((a) => a.path === `/api/jobs/${jobId}` && a.status === 200),
      check: (v) => [
        ...sawSession(v),
        ...(v.api.some((a) => a.path === `/api/jobs/${jobId}` && a.status === 200)
          ? []
          : [`the job page never read /api/jobs/${jobId}`]),
        ...(/Approve/.test(v.text) ? ["Approve shown to a viewer"] : []),
      ],
    },
  ];
  if (menu) {
    list.push(
      {
        name: "menu gate: admin sees the Admin link and not the Super link",
        principal: PRINCIPAL.admin,
        path: "/public",
        until: (t) => /Public/.test(t),
        links: true,
        check: (v) => [
          ...sawSession(v),
          ...(v.links.includes("Public") ? [] : ["the ungated Public link is missing"]),
          ...(v.links.includes("Admin") ? [] : ["no Admin link for admin"]),
          ...(v.links.includes("Super") ? ["Super link shown to admin"] : []),
        ],
      },
      {
        name: "menu gate: superadmin sees the Super link and not the Admin link",
        principal: PRINCIPAL.superadmin,
        path: "/public",
        until: (t) => /Public/.test(t),
        links: true,
        check: (v) => [
          ...sawSession(v),
          ...(v.links.includes("Super") ? [] : ["no Super link for superadmin"]),
          ...(v.links.includes("Admin") ? ["Admin link shown to superadmin"] : []),
        ],
      },
    );
  }
  return list;
}

async function runFrontend(fw) {
  const genDir = mkdtempSync(join(tmpdir(), `loom-bhauth-${fw}-`));
  const workDir = join(WORK, fw);
  mkdirSync(workDir, { recursive: true });
  let server;
  let browser;
  const results = [];
  try {
    // The deployable line, not the header comment that names it.
    const src = readFileSync(FIXTURE, "utf8").replace(/^(\s+)platform: feliz$/m, `$1platform: ${fw}`);
    if (!src.includes(`platform: ${fw}\n`)) throw new Error(`fixture: no feliz deployable line to retarget`);
    const ddd = join(genDir, "auth-ui.ddd");
    writeFileSync(ddd, src);
    const out = join(genDir, "out");
    execFileSync("node", [join(REPO, "bin/cli.js"), "generate", "system", ddd, "-o", out], {
      stdio: "pipe",
    });
    const frontendDir = findFrontend(out, fw);
    if (process.env.LOOM_UI_MUTATE) {
      const mutate = await import(pathToFileURL(resolve(process.env.LOOM_UI_MUTATE)).href);
      await mutate.default({ genDir: out, frontendDir, caseName: fw });
    }
    const distDir = build(fw, frontendDir);
    const { startServer } = await buildServerModule(findNodeDeployable(out), workDir, {
      devStub: true,
    });
    server = await startServer({ distDir });
    const origin = `http://127.0.0.1:${server.port}`;
    process.stdout.write(`    stack on :${server.port}\n`);

    // The row the gated job page reads, created as admin over the same origin.
    const created = await fetch(`${origin}/api/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...claimsHeader(PRINCIPAL.admin) },
      body: JSON.stringify({ title: "Gate me", status: "new" }),
    });
    const createdText = await created.text();
    if (created.status >= 300) throw new Error(`seed POST /api/jobs -> ${created.status}: ${createdText}`);
    const jobId = JSON.parse(createdText).id;

    // The backend half of the action gate, which the button mirrors: a viewer's
    // approve is refused by the SERVER, an admin's lands.  Without this the
    // button probes could pass against a backend that enforces nothing.
    const approve = (p) =>
      fetch(`${origin}/api/jobs/${jobId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json", ...claimsHeader(p) },
        body: "{}",
      }).then((r) => r.status);
    const viewerStatus = await approve(PRINCIPAL.viewer);
    results.push({
      name: "backend: a viewer's approve is refused (403) — the gate the button mirrors is real",
      status: viewerStatus === 403 ? "pass" : "fail",
      error: viewerStatus === 403 ? "" : `expected 403, got ${viewerStatus}`,
    });

    execFileSync(npx, ["playwright", "install", "--with-deps", "chromium"], {
      cwd: HERE,
      stdio: "pipe",
    });
    const { chromium } = await import("playwright");
    browser = await chromium.launch(
      fw === "flutter"
        ? { channel: "chromium", args: ["--no-sandbox", "--enable-unsafe-swiftshader"] }
        : {},
    );
    for (const p of probes(fw, jobId)) {
      let v;
      try {
        v = await visit(browser, origin, fw, p.principal, p.path, p.until);
        if (p.settle) {
          const deadline = Date.now() + 30_000;
          while (!p.settle(v) && Date.now() < deadline) await v.page.waitForTimeout(250);
          await v.page.waitForTimeout(500);
          v.text = await pageText(v.page, fw, () => true, { enable: false });
        }
        if (p.links) {
          v.links = (await v.page.getByRole("link").allInnerTexts()).map((t) => t.trim());
        }
        const why = [...p.check(v), ...v.errors.slice(0, 3)];
        results.push({
          name: p.name,
          status: why.length ? "fail" : "pass",
          error: why.length ? `${why.join("; ")} — page text ${JSON.stringify(v.text.slice(0, 240))}` : "",
        });
      } catch (err) {
        results.push({ name: p.name, status: "fail", error: String(err?.message ?? err) });
      } finally {
        await v?.context.close().catch(() => {});
      }
    }

    // And the admin's click goes through: the button is wired to the backend,
    // not merely drawn.  Last, because it changes the row the probes read.
    {
      const name = "action gate: admin's Approve click reaches the backend and approves the job";
      let v;
      try {
        v = await visit(browser, origin, fw, PRINCIPAL.admin, `/jobs/${jobId}`, (t) =>
          /Approve/.test(t),
        );
        if (fw === "flutter") {
          await v.page.locator("flt-semantics[role=button]", { hasText: "Approve" }).first().click();
        } else {
          await v.page.getByRole("button", { name: "Approve" }).click();
        }
        const deadline = Date.now() + 15_000;
        while (
          !v.api.some((a) => a.method === "POST" && a.path === `/api/jobs/${jobId}/approve`) &&
          Date.now() < deadline
        ) {
          await v.page.waitForTimeout(250);
        }
        const post = v.api.find((a) => a.method === "POST" && a.path === `/api/jobs/${jobId}/approve`);
        const row = await fetch(`${origin}/api/jobs/${jobId}`, {
          headers: claimsHeader(PRINCIPAL.admin),
        }).then((r) => r.json());
        const why = [];
        if (!post) why.push("the click issued no approve POST");
        else if (post.status >= 300) why.push(`approve POST -> ${post.status}`);
        if (row.status !== "approved") why.push(`job status is ${JSON.stringify(row.status)}`);
        results.push({ name, status: why.length ? "fail" : "pass", error: why.join("; ") });
      } catch (err) {
        results.push({ name, status: "fail", error: String(err?.message ?? err) });
      } finally {
        await v?.context.close().catch(() => {});
      }
    }
    return { results };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await server.close().catch(() => {});
    rmSync(genDir, { recursive: true, force: true });
  }
}

/** Probes that FAIL today because the generated app is wrong, keyed by frontend
 *  and exact probe name, each with the defect it shows.  C3 is a test-only wave,
 *  so a defect the leg finds is registered here and handed off rather than
 *  fixed; the entry RATCHETS — a registered probe that passes, or that no longer
 *  runs, fails the leg, so the fix deletes its entry in the same change. */
const KNOWN_DEFECTS = {
  flutter: {
    "action gate: admin's Approve click reaches the backend and approves the job":
      "(wave C3 3b, D-3b-2): the Flutter `Action` button posts a param-less " +
      "operation with no body and no `Content-Type: application/json` " +
      "(src/generator/flutter/flutter-target.ts:674), so the Hono backend answers " +
      "415 and the button silently does nothing — its snackbar only shows on 2xx. " +
      "The OperationForm path (riverpod-emit.ts:401) sends both.",
  },
};

const asked = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const frontends = asked.length ? asked : ["feliz", "flutter"];
for (const fw of frontends) {
  if (fw !== "feliz" && fw !== "flutter") {
    process.stdout.write(`unknown frontend '${fw}' (feliz | flutter)\n`);
    process.exit(1);
  }
}

let pass = 0;
let fail = 0;
let xfail = 0;
let errored = 0;
for (const fw of frontends) {
  process.stdout.write(`\n▶ auth-ui on ${fw}  (${FIXTURE.slice(REPO.length + 1)})\n`);
  let out;
  try {
    out = await runFrontend(fw);
  } catch (err) {
    errored++;
    process.stdout.write(`  ERROR: ${err?.message ?? err}\n`);
    continue;
  }
  const known = KNOWN_DEFECTS[fw] ?? {};
  for (const r of out.results) {
    const defect = known[r.name];
    if (defect && r.status === "fail") {
      xfail++;
      process.stdout.write(`  ⊘ [auth-ui ${fw}] ${r.name}\n      KNOWN DEFECT ${defect}\n      ${r.error}\n`);
      continue;
    }
    if (defect) {
      // The ratchet: a registered defect whose probe now PASSES is a stale
      // entry — the fix must delete it in the same change, or the register
      // stops meaning anything.
      fail++;
      process.stdout.write(`  ✗ [auth-ui ${fw}] ${r.name}\n      STALE KNOWN_DEFECTS entry — the probe passes now; delete it\n`);
      continue;
    }
    const ok = r.status === "pass";
    ok ? pass++ : fail++;
    process.stdout.write(`  ${ok ? "✓" : "✗"} [auth-ui ${fw}] ${r.name}\n`);
    if (!ok && r.error) process.stdout.write(`      ${r.error}\n`);
  }
  // A registered probe that did not run at all is stale too (renamed/removed).
  for (const name of Object.keys(known)) {
    if (!out.results.some((r) => r.name === name)) {
      fail++;
      process.stdout.write(`  ✗ [auth-ui ${fw}] KNOWN_DEFECTS names a probe that did not run: ${name}\n`);
    }
  }
}

process.stdout.write(
  `\n${pass} passed, ${fail} failed${xfail ? `, ${xfail} known defects` : ""}${errored ? `, ${errored} frontends errored` : ""}\n`,
);
process.exit(fail > 0 || errored > 0 ? 1 : 0);
