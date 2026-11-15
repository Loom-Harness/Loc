import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Backend-package layering invariant (see
// docs/backend-packages.md).
//
//   Edges point one way: package → shared, NEVER shared → package.
//
// The shared emitters under `src/generator/` must not import
// anything from `src/platform/<family>/<vN>/` (a versioned backend
// package).  Per-version data (dep pins today) is threaded in as a
// parameter by the package surface / entrypoints.  A reverse edge
// would re-pin the shared core to one version (blocking `hono@v5`)
// and foreclose a future per-backend packaging split.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const generatorDir = path.join(repoRoot, "src", "generator");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

// Matches a static `from "…/platform/…"`, a dynamic `import("…/platform/…")`,
// and a side-effect `import "…/platform/…"` in any relative form
// (`../platform`, `../../platform`, …) — so a shared→package edge can't hide
// behind a side-effect or dynamic import.
const PLATFORM_IMPORT =
  /(?:from|import\()\s*["'][^"']*\/platform\/[^"']*["']|(?:^|[;\n])\s*import\s+["'][^"']*\/platform\/[^"']*["']/m;

describe("backend-packages layering — no shared→package edges", () => {
  const files = tsFiles(generatorDir);

  it("scans a non-trivial number of shared emitter files", () => {
    // Guard against the walker silently finding nothing (e.g. a
    // moved directory) and the invariant passing vacuously.
    expect(files.length).toBeGreaterThan(20);
  });

  it("no file under src/generator/ imports from src/platform/", () => {
    const offenders = files
      .filter((f) => PLATFORM_IMPORT.test(fs.readFileSync(f, "utf-8")))
      .map((f) => path.relative(repoRoot, f));
    expect(
      offenders,
      `Shared emitter must not depend on a backend package — ` +
        `thread per-version data in as a parameter instead. Offenders:\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Inside a versioned backend dir the same rule holds one level down: the
// version-free `shared/` emitter never imports a version's pin set, and a
// directory is named after a version only while that version is registered
// (D-HONO-SHARED) — a retired version's code does not stay behind under its
// old name.
// ---------------------------------------------------------------------------

const platformDir = path.join(repoRoot, "src", "platform");
/** Backend dir name → the `family` its versions register under. */
const FAMILY_OF_DIR: Readonly<Record<string, string>> = { hono: "node" };
const VERSION_DIR = /^v\d+$/;

describe("backend-packages layering — versioned backend dirs", () => {
  const backendDirs = fs
    .readdirSync(platformDir, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        fs.readdirSync(path.join(platformDir, e.name)).some((n) => VERSION_DIR.test(n)),
    )
    .map((e) => e.name);

  it("finds the versioned backend dirs (guard against a vacuous pass)", () => {
    expect(backendDirs).toContain("hono");
  });

  it("every `v<N>/` dir is a registered version of its family", async () => {
    const { defaultBuiltInBackends } = await import("../../src/platform/registry.js");
    const registered = new Set(
      defaultBuiltInBackends().map((b) => `${b.manifest.family}@${b.manifest.loomVersion}`),
    );
    const stale: string[] = [];
    for (const dir of backendDirs) {
      const family = FAMILY_OF_DIR[dir] ?? dir;
      for (const v of fs.readdirSync(path.join(platformDir, dir))) {
        if (VERSION_DIR.test(v) && !registered.has(`${family}@${v}`)) stale.push(`${dir}/${v}`);
      }
    }
    expect(
      stale,
      "a directory named after an unregistered version — move live code to `shared/`",
    ).toEqual([]);
  });

  it("no `shared/` file imports a version dir", () => {
    const offenders: string[] = [];
    for (const dir of backendDirs) {
      const shared = path.join(platformDir, dir, "shared");
      if (!fs.existsSync(shared)) continue;
      for (const f of tsFiles(shared)) {
        if (/(?:from|import\()\s*["'][^"']*\/v\d+\/[^"']*["']/.test(fs.readFileSync(f, "utf-8"))) {
          offenders.push(path.relative(repoRoot, f));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
