// `ddd render` — print one output path as `generate system` renders it, or
// list the hatch files with their expected signatures, writing nothing.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/cli.js");
const run = (...args: string[]) => spawnSync("node", [cli, ...args], { encoding: "utf8" });

describe("ddd render", () => {
  it("prints the bytes generation writes, and lists hatches present or pending", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "render-"));
    const ddd = path.join(tmp, "main.ddd");
    fs.writeFileSync(ddd, corpusSourceFor("extern-handlers", "node"));
    const out = path.join(tmp, "out");
    expect(run("scaffold", ddd, "-o", out).status).toBe(0);
    expect(run("generate", "system", ddd, "-o", out).status).toBe(0);

    const listed = run("render", ddd, "--hatches", "-o", out, "--json");
    expect(listed.status, listed.stderr).toBe(0);
    const rows = JSON.parse(listed.stdout) as { owner: string; path: string; state: string }[];
    expect(rows.map((r) => r.state)).toEqual(rows.map(() => "present"));
    const quote = rows.find((r) => r.owner === "Sales.GetQuote")!;
    expect(quote).toMatchObject({ signatures: ["GetQuote(sku: string): string"] });

    // A hatch stub and a generated file both come back byte-for-byte; nothing
    // is written.
    const stub = run("render", ddd, quote.path);
    expect(stub.stdout).toBe(fs.readFileSync(path.join(out, quote.path), "utf8"));
    const compose = run("render", ddd, "docker-compose.yml");
    expect(compose.stdout).toBe(fs.readFileSync(path.join(out, "docker-compose.yml"), "utf8"));

    fs.rmSync(path.join(out, quote.path));
    const after = JSON.parse(run("render", ddd, "--hatches", "-o", out, "--json").stdout) as {
      path: string;
      state: string;
    }[];
    expect(after.find((r) => r.path === quote.path)!.state).toBe("pending");
    expect(fs.existsSync(path.join(out, quote.path))).toBe(false);

    const absent = run("render", ddd, "no/such/file");
    expect(absent.status).toBe(1);
    expect(absent.stderr).toContain("the model produces no file at no/such/file");
    fs.rmSync(tmp, { recursive: true });
  }, 120_000);
});
