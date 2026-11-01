// The node behavioural leg runs every case's bundle in its own worker process.
//
// An `import()`ed ES module is never unloaded, so a case bundle imported into
// the runner keeps whatever its module scope reaches alive for the rest of the
// run — module-level state in the bundle (the recorder's dispatch, the
// generated auth module's `routeProbe`, …) reaches the case's app, its drizzle
// db and PGlite's ~230 MB WASM heap, so the leg grows by a database per leaking
// case until the CI runner is OOM-killed with no failing test.  The memory
// ceilings in run.mjs catch a regression on the leg itself; this pins the shape
// cheaply in the fast suite and exercises the worker protocol.

import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const HERE = __dirname;
const WORKER = join(HERE, "case-worker.mjs");
const RUN = readFileSync(join(HERE, "run.mjs"), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "loom-case-worker-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Reply = { ok: boolean; out?: unknown; message?: string; maxRssMb: number };

function runWorker(bundleSource: string): Promise<{ reply: Reply | null; code: number | null }> {
  const bundle = join(tmp, `b${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(bundle, bundleSource);
  return new Promise((resolve, reject) => {
    const child = fork(WORKER, [bundle], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      serialization: "advanced",
    });
    let reply: Reply | null = null;
    child.on("message", (m) => {
      reply = m as Reply;
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ reply, code }));
  });
}

describe("node leg: one process per case, with bounded memory", () => {
  it("run.mjs forks case-worker.mjs and never imports a case bundle into the runner", () => {
    expect(RUN).not.toMatch(/await import\(pathToFileURL\(bundle\)/);
    expect(RUN).toMatch(/fork\(WORKER, \[bundle\]/);
  });

  it("the generated run() releases the dispatch and closes PGlite in a finally", () => {
    expect(RUN).toMatch(
      /\} finally \{\s*__releaseDispatch\(\);\s*await pglite\.close\?\.\(\);\s*\}/,
    );
  });

  it("the runner bounds each case's peak and its own RSS after every case", () => {
    expect(RUN).toMatch(/reply\.maxRssMb > CASE_RSS_LIMIT_MB/);
    expect(RUN).toMatch(
      /await loop\.run\(c, runCase, [^\n]*\);\n\s*assertRunnerBounded\(c\.name, /,
    );
  });

  it("delivers run()'s result, structured-cloned, with the case's peak RSS", async () => {
    const { reply, code } = await runWorker(
      "export async function run() { return { results: [{ name: 'a', status: 'pass', error: undefined }], wire: [new Error('x')] }; }\n",
    );
    expect(code).toBe(0);
    expect(reply?.ok).toBe(true);
    const out = reply?.out as { results: { name: string; error?: unknown }[]; wire: unknown[] };
    expect(out.results[0].name).toBe("a");
    expect("error" in out.results[0]).toBe(true);
    expect(out.wire[0]).toBeInstanceOf(Error);
    expect(reply?.maxRssMb).toBeGreaterThan(0);
  });

  it("reports a throwing case as an error, and exits even with handles left open", async () => {
    const { reply, code } = await runWorker(
      "setInterval(() => {}, 1000);\nexport async function run() { throw new Error('boom'); }\n",
    );
    expect(code).toBe(0);
    expect(reply?.ok).toBe(false);
    expect(reply?.message).toMatch(/boom/);
    expect(reply?.maxRssMb).toBeGreaterThan(0);
  });
});
