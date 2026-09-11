// The UI-tier frontend build (test/behavioral/ui-stack.mjs → `buildFrontend`).
//
// Gated HERE, in the fast per-PR suite, rather than only inside the nightly
// `frontend-fullstack-e2e` leg that consumes it — because the defect it guards
// only fires when the npm registry hiccups, which is exactly when nobody is
// watching. On the 2026-09-09 nightly it took out BOTH the vue and the svelte
// cell inside one runner window:
//
//   Error: Cannot find native binding. npm has a bug related to optional
//   dependencies (https://github.com/npm/cli/issues/4828). …
//   cause: Error: Cannot find module '@rolldown/binding-linux-x64-gnu'
//
// `npm install` had exited 0. Optional means optional: a registry blip while
// fetching the platform-specific binding is not fatal to the install, so the
// damage only surfaces minutes later when the bundler cannot load it. Nothing
// about the generated code was wrong, and re-running the leg fixed it — the
// signature of a hole in the harness, not in the compiler.
//
// The two properties asserted below are the whole contract:
//   1. npm's hole is HEALED — wipe node_modules + package-lock, install again.
//   2. A REAL build failure is NOT retried and NOT swallowed. This is the half
//      that matters: a retry that cannot tell the two apart would paper over
//      the generated-code breakage this leg exists to catch.
//
// The seams (`install` / `buildScript` / `clean` / `distRoot`) are injected, so
// the property is asserted without a network, an npm, or a generated project.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFrontend,
  combinedOutput,
  isOptionalDepMiss,
  preserveArtifacts,
  // @ts-expect-error — .mjs harness module, deliberately dependency-free JS.
} from "../behavioral/ui-stack.mjs";

/** The verbatim shape npm/rolldown produced on the 2026-09-09 nightly. */
const NPM_OPTIONAL_HOLE = [
  "Command failed: npm run build",
  "Error: Cannot find native binding. npm has a bug related to optional dependencies",
  "(https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing",
  "both package-lock.json and node_modules directory.",
  "  cause: Error: Cannot find module '@rolldown/binding-linux-x64-gnu'",
].join("\n");

/** A generated-code failure — what the leg exists to report. */
const REAL_BUILD_FAILURE = [
  "Command failed: npm run build",
  "src/pages/ProductNew.vue(41,7): error TS2322: Type 'string' is not assignable to type 'number'.",
].join("\n");

function failingBuild(message: string, times: number) {
  let calls = 0;
  return () => {
    calls++;
    if (calls <= times) throw new Error(message);
  };
}

describe("buildFrontend — npm's optional-dependency hole", () => {
  it("recognises the signature npm itself prints", () => {
    expect(isOptionalDepMiss(NPM_OPTIONAL_HOLE)).toBe(true);
    // …and the sibling native-binding families that fail the same way.
    expect(isOptionalDepMiss("Cannot find module '@rollup/rollup-linux-x64-gnu'")).toBe(true);
    expect(isOptionalDepMiss("Cannot find module '@esbuild/linux-x64'")).toBe(true);
  });

  it("does not mistake a real build failure for it", () => {
    expect(isOptionalDepMiss(REAL_BUILD_FAILURE)).toBe(false);
  });

  it("heals the hole: wipes node_modules + package-lock and installs again", () => {
    const cleaned: string[] = [];
    const installs: string[] = [];
    const logged: string[] = [];
    const dist = buildFrontend("/tmp/frontend", {
      log: (m: string) => logged.push(m),
      install: (dir: string) => installs.push(dir),
      buildScript: failingBuild(NPM_OPTIONAL_HOLE, 1),
      clean: (dir: string) => cleaned.push(dir),
      distRoot: (dir: string) => `${dir}/dist`,
    });
    expect(installs).toEqual(["/tmp/frontend", "/tmp/frontend"]);
    expect(cleaned).toEqual(["/tmp/frontend"]);
    expect(logged.join("\n")).toContain("loom-retry");
    expect(dist).toBe("/tmp/frontend/dist");
  });

  it("retries at most once — a hole that does not close still fails", () => {
    let installs = 0;
    expect(() =>
      buildFrontend("/tmp/frontend", {
        install: () => {
          installs++;
        },
        buildScript: failingBuild(NPM_OPTIONAL_HOLE, 99),
        clean: () => undefined,
        distRoot: (dir: string) => dir,
      }),
    ).toThrow(/Cannot find native binding/);
    expect(installs).toBe(2);
  });

  it("does NOT retry a real build failure, and reports it", () => {
    let cleans = 0;
    expect(() =>
      buildFrontend("/tmp/frontend", {
        install: () => undefined,
        buildScript: failingBuild(REAL_BUILD_FAILURE, 99),
        clean: () => {
          cleans++;
        },
        distRoot: (dir: string) => dir,
      }),
    ).toThrow(/TS2322/);
    expect(cleans, "a generated-code failure must not be papered over by a reinstall").toBe(0);
  });
});

// The other half of "a diagnostic you only report on success is not a
// diagnostic": the runners generate into a mkdtemp and unlink it in a
// `finally`, so Playwright's traces/screenshots/error-context were deleted
// BEFORE any CI upload step could see them.  Every red nightly on this leg
// left the console tail and nothing else.
describe("preserveArtifacts", () => {
  const dirs: string[] = [];
  const mk = () => {
    const d = mkdtempSync(join(tmpdir(), "loom-pa-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("copies the trace out of the tree that is about to be deleted", () => {
    const genDir = mk();
    const workDir = mk();
    const results = join(genDir, "web_app/e2e/test-results/SalesSystem-ui-chromium");
    mkdirSync(results, { recursive: true });
    writeFileSync(join(results, "trace.zip"), "PK-not-really");
    writeFileSync(join(results, "error-context.md"), "# page snapshot");

    const rescued = preserveArtifacts(genDir, workDir);
    rmSync(genDir, { recursive: true, force: true }); // what the runner does next

    expect(rescued).toHaveLength(1);
    const out = join(workDir, "test-results/SalesSystem-ui-chromium");
    expect(readFileSync(join(out, "trace.zip"), "utf8")).toBe("PK-not-really");
    expect(readFileSync(join(out, "error-context.md"), "utf8")).toBe("# page snapshot");
  });

  it("is a no-op on a green run, and never throws on a missing tree", () => {
    const genDir = mk();
    mkdirSync(join(genDir, "web_app/dist"), { recursive: true });
    expect(preserveArtifacts(genDir, mk())).toEqual([]);
    expect(preserveArtifacts(join(genDir, "gone"), mk())).toEqual([]);
  });
});

describe("combinedOutput", () => {
  it("keeps the stdout half of a failed command's diagnosis", () => {
    const err = Object.assign(new Error("Command failed: npm run build"), {
      stdout: Buffer.from("npm error code EBADPLATFORM"),
      stderr: Buffer.from("npm error path /tmp/frontend"),
    });
    const out = combinedOutput(err);
    expect(out).toContain("Command failed: npm run build");
    expect(out).toContain("EBADPLATFORM");
    expect(out).toContain("/tmp/frontend");
  });
});
