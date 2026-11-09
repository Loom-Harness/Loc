import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { type BackendPlatform, backendSystemFor } from "../../_helpers/backend-system.js";

/**
 * Generate ONE backend project from a repo-relative `.ddd` fixture through
 * `ddd generate system`, the CLI's only generation path, and return the
 * emitted project dir.
 *
 * A bare-context fixture gets a `platform` deployable over its root contexts;
 * one that declares its system (an `examples/` source) has its single
 * `platform: node|dotnet` clause re-targeted at `platform` — the same source
 * is compile-gated on both backends.  The specialised source is written into
 * `outDir`, so no `migrations/` chain beside the fixture is read.  The fixture
 * must not `import` others.
 */
export function generateBackendProject(
  repoRoot: string,
  fixture: string,
  platform: BackendPlatform,
  outDir: string,
): string {
  const { source, deployable } = backendSystemFor(
    fs.readFileSync(path.join(repoRoot, fixture), "utf8"),
    platform,
  );
  const srcDir = path.join(outDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
  const entry = path.join(srcDir, `${path.basename(fixture, ".ddd")}.${platform}.ddd`);
  fs.writeFileSync(entry, source);
  const genDir = path.join(outDir, "gen");
  execSync(`node ${path.join(repoRoot, "bin", "cli.js")} generate system ${entry} -o ${genDir}`, {
    stdio: "inherit",
    cwd: repoRoot,
  });
  return path.join(genDir, deployable);
}
