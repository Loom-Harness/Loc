// UI test runner — bundles the generated `*.ui.spec.ts` (+ its page
// objects) in the parent, runs it with a `@playwright/test` shim, and
// drives the preview iframe through the message-driven driver.
//
// `bundle` (esbuild-wasm over the e2e VFS, `@playwright/test` aliased)
// is injected so the orchestration is testable without the worker.

import { createUiHarness, runUiTests, type UiTestCase } from "./ui-harness.js";
import {
  RemotePage,
  type DriverTransport,
} from "../../../packages/ui-test-driver/index";
import type { TestResult } from "./harness.js";
import type { EsbuildBuild } from "./transform-client.js";
import type { VirtualFile } from "../build/protocol.js";

// Each load hands its harness over under its own global, so two discoveries
// in flight at once never read — or clear — each other's harness.
let loads = 0;
const pwShim = (key: string): string =>
  `export const test = globalThis.${key}.test; export const expect = globalThis.${key}.expect;`;

/** The generated UI spec within a generated file tree, if any. */
export function findUiTestFile(files: VirtualFile[]): VirtualFile | null {
  return (
    files.find((f) => /(^|\/)e2e\/[^/]+\.ui\.spec\.ts$/.test(f.path)) ?? null
  );
}

/** Collect the spec + everything under its `e2e/` dir (page objects). */
export function uiSuiteFiles(
  files: VirtualFile[],
  spec: VirtualFile,
): Record<string, string> {
  const dir = spec.path.slice(0, spec.path.lastIndexOf("/e2e/") + "/e2e/".length);
  const out: Record<string, string> = {};
  for (const f of files) {
    if (f.path.startsWith(dir) && /\.tsx?$/.test(f.path)) out[f.path] = f.content;
  }
  return out;
}

interface PwGlobal {
  test: ReturnType<typeof createUiHarness>["test"];
  expect: ReturnType<typeof createUiHarness>["expect"];
}

export interface LoadUiSuiteOpts {
  entry: string;
  files: Record<string, string>;
  build: EsbuildBuild;
  /** The frontend's package.json `dependencies` — the pins any npm import
   *  of the spec or its page objects installs at. */
  deps?: Record<string, string>;
}

/** Bundle + register the UI suite (run `test(...)` calls, NOT the
 *  bodies) so cases can be listed and run individually.  The bundled
 *  module captures `test`/`expect` from its `globalThis.__loomPw<n>` at
 *  import, so it's safe to clear afterwards — the cases keep working. */
export async function loadUiSuite(opts: LoadUiSuiteOpts): Promise<UiTestCase[]> {
  const key = `__loomPw${++loads}`;
  const js = await opts.build(
    opts.entry,
    opts.files,
    { "@playwright/test": pwShim(key) },
    opts.deps,
  );
  const harness = createUiHarness();
  const g = globalThis as unknown as Record<string, PwGlobal | undefined>;
  g[key] = { test: harness.test, expect: harness.expect };
  // Blob-import registers the suite's `test(...)` calls (parent has no
  // CSP, so blob: module import is fine here).
  const url = URL.createObjectURL(new Blob([js], { type: "text/javascript" }));
  try {
    await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
    delete g[key];
  }
  return harness.tests;
}

export interface RunUiTestsOpts extends LoadUiSuiteOpts {
  transport: DriverTransport;
}

export async function runUiSuite(opts: RunUiTestsOpts): Promise<TestResult[]> {
  const cases = await loadUiSuite(opts);
  return runUiTests(cases, new RemotePage(opts.transport));
}
