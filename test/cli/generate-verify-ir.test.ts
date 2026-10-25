// `generate system --verify-ir` runs the IR verifier (compiler self-check) before
// phase ⑦.  Acceptance: a clean model passes with the flag on, and an IR with a
// seeded `enumName: undefined` makes the CLI exit non-zero, naming the violation.
// The seeded mutation is injected by a Node loader hook that wraps
// `enrichLoomModel` in the built CLI, so the real process path is exercised.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const cli = path.join(repoRoot, "bin", "cli.js");
const acme = path.join(repoRoot, "examples", "acme.ddd");

let tmp: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-verify-ir-"));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function seedPreload(): string {
  const modelExprs = pathToFileURL(path.join(repoRoot, "out/ir/util/model-exprs.js")).href;
  const hooks = `
    export async function load(url, ctx, next) {
      const r = await next(url, ctx);
      if (!url.endsWith("/out/ir/enrich/enrichments.js")) return r;
      const src = String(r.source)
        .replace("export function enrichLoomModel(", "function __orig(")
        + \`
import { forEachModelExpr as __each } from "${modelExprs}";
export function enrichLoomModel(m) {
  const r = __orig(m);
  let done = false;
  __each(r, ({ expr: e }) => {
    if (!done && e.kind === "ref" && e.refKind === "enum-value" && e.enumName) {
      e.enumName = undefined;
      done = true;
    }
  });
  return r;
}\`;
      return { ...r, source: src, shortCircuit: true };
    }`;
  const preload = path.join(tmp, "seed.mjs");
  fs.writeFileSync(
    preload,
    `import { register } from "node:module";\nregister("data:text/javascript," + encodeURIComponent(${JSON.stringify(hooks)}));\n`,
  );
  return preload;
}

function gen(args: string[], nodeArgs: string[] = []): { stderr: string; status: number } {
  const out = fs.mkdtempSync(path.join(tmp, "out-"));
  const r = spawnSync("node", [...nodeArgs, cli, "generate", "system", acme, "-o", out, ...args], {
    encoding: "utf8",
  });
  return { stderr: r.stderr ?? "", status: r.status ?? 1 };
}

describe("generate system --verify-ir", () => {
  it("passes on a clean model", () => {
    const r = gen(["--verify-ir", "--dry-run"]);
    expect(r.stderr).not.toContain("IR verification failed");
    expect(r.status).toBe(0);
  }, 120_000);

  it("exits non-zero on a seeded `enumName: undefined`", () => {
    const r = gen(["--verify-ir", "--dry-run"], ["--import", seedPreload()]);
    expect(r.stderr).toContain("IR verification failed");
    expect(r.stderr).toMatch(/enum-value ref .* has no enumName/);
    expect(r.status).not.toBe(0);
  }, 120_000);

  it("is off by default — the same seeded IR does not trip the verifier", () => {
    const r = gen(["--dry-run"], ["--import", seedPreload()]);
    expect(r.stderr).not.toContain("IR verification failed");
  }, 120_000);
});

describe("GenerateSystemOptions.verifyIr", () => {
  it("accepts a clean model (the throwing path is the CLI test above)", async () => {
    const files = await generateSystemFiles(readFileSync(acme, "utf8"), { verifyIr: true });
    expect(files.size).toBeGreaterThan(0);
  }, 120_000);
});
