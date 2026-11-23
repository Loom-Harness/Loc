import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bootableBackends } from "../../web/src/build/boot-plan.js";
import { analyzeDeployables, isMockDeployable } from "../../web/src/build/deployables.js";
import type { VirtualFile } from "../../web/src/build/protocol.js";
import type { BundleOk } from "../../web/src/bundle/protocol.js";
import { MOCK } from "../../web/src/layout/vocabulary.js";
import { backendBundlesOk, initialPipelineState } from "../../web/src/pipeline/state.js";
import { apiSuiteRefusal } from "../../web/src/testing/run-api-tests.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { mockSystem } from "../_helpers/mock-system.js";

// ---------------------------------------------------------------------------
// A `mock` deployable in the playground: booted like any Hono backend, known
// as a mock by the module only its project has (`http/mock-runtime.ts`),
// carried to the boot as a backend with no database layer, and the API suite
// refused while the mock is its target.
// ---------------------------------------------------------------------------

const MOCK_EXAMPLE = readFileSync(
  path.resolve(__dirname, "../../web/src/examples/mock-system.ddd"),
  "utf8",
);

async function tree(source: string): Promise<VirtualFile[]> {
  const files = await generateSystemFiles(source);
  return [...files].map(
    ([p, content]) => ({ path: p, content, size: content.length }) as VirtualFile,
  );
}

const ok = (code: string): BundleOk =>
  ({
    ok: true,
    kind: "hono",
    code,
    size: code.length,
    durationMs: 0,
    fetchedUrls: [],
    versions: {},
    diagnostics: [],
  }) as BundleOk;

describe("a mock deployable in the deployable analysis", () => {
  it("boots the mock example's backend and lists it as a mock", async () => {
    const out = analyzeDeployables(await tree(MOCK_EXAMPLE));
    expect(out.backends).toEqual(["catalog_api/http/index.ts"]);
    expect(out.mocks).toEqual(["catalog_api"]);
    expect(out.unsupported).toEqual([]);
    expect(isMockDeployable(out.mocks, "catalogApi")).toBe(true);
    expect(isMockDeployable(out.mocks, "backoffice")).toBe(false);
  });

  it("lists no mock for the same system on a node backend", async () => {
    const mock = analyzeDeployables(await tree(mockSystem("mock")));
    const node = analyzeDeployables(await tree(mockSystem("node")));
    expect(mock.mocks).toEqual(["api"]);
    expect(node.mocks).toEqual([]);
    expect(node.backends).toEqual(mock.backends);
  });
});

describe("the bundle a boot starts from", () => {
  it("carries a backend's missing database layer from the pipeline state", () => {
    const state = {
      ...initialPipelineState,
      bundle: {
        kind: "result" as const,
        backends: [
          { slug: "api", entry: "api/http/index.ts", bundle: ok("m"), database: false as const },
          { slug: "db", entry: "db/http/index.ts", bundle: ok("d") },
        ],
        frontends: [],
      },
    };
    expect(backendBundlesOk(state)).toEqual([
      { slug: "api", entry: "api/http/index.ts", bundle: ok("m"), database: false },
      { slug: "db", entry: "db/http/index.ts", bundle: ok("d") },
    ]);
    expect(backendBundlesOk(state)).toEqual(bootableBackends(state.bundle.backends));
  });
});

describe("the API suite against a mock", () => {
  it("is refused when its target is a mock, with one line saying why", () => {
    expect(apiSuiteRefusal("catalog_api", ["catalog_api"])).toBe(MOCK.apiRefusal("catalog_api"));
    expect(MOCK.apiRefusal("catalog_api")).not.toContain("\n");
  });

  it("runs when its target is a real backend, even beside a mock", () => {
    expect(apiSuiteRefusal("api", ["mocked"])).toBeNull();
    expect(apiSuiteRefusal(null, ["mocked"])).toBeNull();
  });
});
