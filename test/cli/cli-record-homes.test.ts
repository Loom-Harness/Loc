// Where the CLI writes its own records: beside the `.ddd`, never into a
// generated tree and never under a tool-named folder.  `ddd snapshot` writes
// `provenance/<ts>-<guid>.json`, `ddd verify` writes `verification/`, and the
// Frontend Contract goes to stdout only.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { materializeCorpusFixture } from "../fixtures/corpus/harness.js";

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/cli.js");
const run = (...args: string[]) => spawnSync("node", [cli, ...args], { encoding: "utf8" });

describe("CLI records live beside the model", () => {
  it("`ddd snapshot` with no -o writes provenance/<ts>-<guid>.json beside the .ddd", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "record-homes-"));
    const src = materializeCorpusFixture("provenance", "node", dir);
    const r = run("snapshot", src);
    expect(r.status, r.stderr).toBe(0);
    const written = fs.readdirSync(path.join(path.dirname(src), "provenance"));
    expect(written.length).toBeGreaterThan(0);
    for (const f of written) expect(f).toMatch(/^\d{8}T\d{6}Z-[0-9a-f-]+\.json$/);
    expect(fs.existsSync(path.join(path.dirname(src), ".loom"))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it("`ddd emit-frontend-contract` takes no -o", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "record-homes-"));
    const src = materializeCorpusFixture("provenance", "node", dir);
    const r = run("emit-frontend-contract", src, "-o", dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("unknown option '-o'");
    fs.rmSync(dir, { recursive: true, force: true });
  }, 120_000);
});
