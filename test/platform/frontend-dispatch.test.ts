import { describe, expect, it } from "vitest";

import { FRONTEND_GENERATORS } from "../../src/platform/frontend-dispatch.js";
import { descriptorFor } from "../../src/platform/metadata.js";
import { platformFor } from "../../src/platform/registry.js";
import { STATIC_BUNDLE_FRAMEWORKS } from "../../src/platform/surface.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The `web` host dispatches on the ui's `framework:`.
//
// `web` is a static-asset HOST: it serves whatever framework the bound ui
// declares (`STATIC_BUNDLE_FRAMEWORKS`).  The dispatch source of truth is
// `FRONTEND_GENERATORS`; these tests tie the host's advertised
// `hostableFrameworks` to an actual dispatch arm, so a framework advertised
// without a generator (or the reverse) fails here.
// ---------------------------------------------------------------------------

/** A framework-distinctive file marker in a generated frontend project. */
const FRAMEWORK_MARKER: Record<string, RegExp> = {
  react: /\.tsx$/,
  svelte: /\.svelte$/,
  vue: /\.vue$/,
  angular: /\.component\.ts$/,
};

const sorted = (s: Iterable<string>) => [...s].sort();

function systemSrc(uiFramework: string): string {
  return `system HostMix {
  subdomain D { context Shop { aggregate Order { code: string } repository Orders for Order { } } }
  ui WebApp with scaffold(subdomains: [D]) { framework: ${uiFramework} }
  api A from D
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable api1 { platform: node contexts: [Shop] dataSources: [st] serves: A port: 8081 }
  deployable web { platform: web targets: api1 ui: WebApp port: 3001 }
}
`;
}

describe("web host framework dispatch", () => {
  it("the dispatch map covers exactly the static-bundle frameworks", () => {
    expect(sorted(Object.keys(FRONTEND_GENERATORS))).toEqual(sorted(STATIC_BUNDLE_FRAMEWORKS));
  });

  it("the web descriptor advertises only dispatchable frameworks", () => {
    const desc = descriptorFor("web");
    expect(desc.isFrontend).toBe(true);
    for (const fw of desc.hostableFrameworks) {
      expect(FRONTEND_GENERATORS[fw]).toBeTypeOf("function");
    }
    expect(platformFor("web").hostableFrameworks).toBe(desc.hostableFrameworks);
  });

  for (const fw of ["react", "svelte", "vue", "angular"]) {
    it(`a framework:${fw} ui emits a ${fw} project`, async () => {
      const files = await generateSystemFiles(systemSrc(fw));
      const webFiles = [...files.keys()].filter((k) => k.startsWith("web/"));
      expect(webFiles.some((k) => FRAMEWORK_MARKER[fw]!.test(k))).toBe(true);
      // …and none of the OTHER frameworks' markers leaked in.
      for (const [other, otherMarker] of Object.entries(FRAMEWORK_MARKER)) {
        if (other === fw || FRAMEWORK_MARKER[fw]!.source === otherMarker.source) continue;
        expect(webFiles.some((k) => otherMarker.test(k))).toBe(false);
      }
    });
  }
});
