import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DapArgsError, resolveMapPathFromArgs } from "../../src/dap-server/args.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

// `ddd-dap` argv parsing: the documented `--map <path>` form, the `--map=<path>`
// form, the env / default fallbacks, and a hard error on anything else.

describe("resolveMapPathFromArgs", () => {
  it("--map <path> (space-separated, the documented form) is honoured", () => {
    expect(resolveMapPathFromArgs(["--map", "out/.loom/sourcemap.json"], undefined)).toBe(
      path.resolve("out/.loom/sourcemap.json"),
    );
  });

  it("--map=<path> is honoured", () => {
    expect(resolveMapPathFromArgs(["--map=out/.loom/sourcemap.json"], undefined)).toBe(
      path.resolve("out/.loom/sourcemap.json"),
    );
  });

  it("the flag wins over LOOM_DAP_MAP; the env var wins over the default", () => {
    expect(resolveMapPathFromArgs(["--map", "a.json"], "b.json")).toBe(path.resolve("a.json"));
    expect(resolveMapPathFromArgs([], "b.json")).toBe(path.resolve("b.json"));
    expect(resolveMapPathFromArgs([], undefined)).toBe(path.resolve(".loom", "sourcemap.json"));
  });

  it.each([
    [["--bogus"], /unknown argument '--bogus'/],
    [["out/.loom/sourcemap.json"], /unknown argument 'out\/\.loom\/sourcemap\.json'/],
    [["--map"], /--map needs a path/],
    [["--map", "--other"], /--map needs a path/],
    [["--map="], /--map needs a path/],
    [["--map", "a.json", "--map=b.json"], /--map given more than once/],
  ])("%j is an error", (argv, message) => {
    expect(() => resolveMapPathFromArgs(argv, undefined)).toThrow(DapArgsError);
    expect(() => resolveMapPathFromArgs(argv, undefined)).toThrow(message);
  });
});

describe("ddd-dap bin", () => {
  it("an unknown argument exits 1 with the message on stderr and nothing on stdout", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(repoRoot, "packages", "ddd-dap", "bin.js"), "--bogus"],
      { encoding: "utf8", input: "" },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ddd-dap: unknown argument '--bogus'.");
    expect(r.stdout).toBe("");
  });
});
