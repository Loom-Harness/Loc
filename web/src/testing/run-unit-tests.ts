// Unit test runner — runs the generated aggregate unit suites
// (`<backend>/domain/<agg>.test.ts`) in the playground.
//
// These are pure in-process domain tests: they import the generated
// aggregate / value-object / id classes and call them directly
// (`Order.create(…)`, `expectThrows order.confirm()`), with no HTTP,
// no DB, no booted runtime.  So we bundle the test + its domain imports
// (esbuild over the domain VFS, `vitest` aliased to the harness, the npm
// packages it imports installed at the deployable's package.json pins) and
// run it — runnable straight after Generate, before any Boot.

import { createHarness, runTests, type TestCase, type TestResult } from "./harness.js";
import type { EsbuildBuild } from "./transform-client.js";
import type { VirtualFile } from "../build/protocol.js";

// Each load hands its harness over under its own global, so two discoveries
// in flight at once (a regenerate while the previous one is still
// installing) never read — or clear — each other's harness.
let loads = 0;
const vitestShim = (key: string): string =>
  `export const describe = globalThis.${key}.describe;` +
  ` export const it = globalThis.${key}.it;` +
  ` export const expect = globalThis.${key}.expect;`;

/** Generated aggregate unit suites in a file tree (one per aggregate
 *  that declares `test "…" { … }`). */
export function findUnitTestFiles(files: VirtualFile[]): VirtualFile[] {
  return files.filter((f) => /(^|\/)domain\/[^/]+\.test\.ts$/.test(f.path));
}

/** The domain dir holding `spec` (the aggregate + its value-objects /
 *  ids / enums / events / errors) — everything the test imports. */
export function unitSuiteFiles(
  files: VirtualFile[],
  spec: VirtualFile,
): Record<string, string> {
  const dir = spec.path.slice(0, spec.path.lastIndexOf("/") + 1);
  const out: Record<string, string> = {};
  for (const f of files) {
    if (f.path.startsWith(dir) && /\.tsx?$/.test(f.path)) out[f.path] = f.content;
  }
  return out;
}

interface UnitGlobal {
  describe: ReturnType<typeof createHarness>["describe"];
  it: ReturnType<typeof createHarness>["it"];
  expect: ReturnType<typeof createHarness>["expect"];
}

export interface LoadUnitSuiteOpts {
  entry: string;
  files: Record<string, string>;
  build: EsbuildBuild;
  /** The deployable's package.json `dependencies` — the pins the suite's
   *  npm imports (`uuidv7`, `decimal.js`) install at. */
  deps?: Record<string, string>;
}

/** Bundle + register the unit suite (run `describe`/`it`, NOT the
 *  bodies).  The bundled module captures the harness off its
 *  `globalThis.__loomUnit<n>` at import, so it's safe to clear after. */
export async function loadUnitSuite(
  opts: LoadUnitSuiteOpts,
): Promise<TestCase[]> {
  const key = `__loomUnit${++loads}`;
  const js = await opts.build(opts.entry, opts.files, { vitest: vitestShim(key) }, opts.deps);
  const harness = createHarness();
  const g = globalThis as unknown as Record<string, UnitGlobal | undefined>;
  g[key] = {
    describe: harness.describe,
    it: harness.it,
    expect: harness.expect,
  };
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  try {
    await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
    delete g[key];
  }
  return harness.tests;
}

export async function runUnitSuite(
  opts: LoadUnitSuiteOpts,
): Promise<TestResult[]> {
  return runTests(await loadUnitSuite(opts));
}
