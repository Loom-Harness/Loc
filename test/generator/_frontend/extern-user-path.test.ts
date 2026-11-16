// The frontend extern hatch never writes the user's module.
//
// `component <Name>(...) extern from "./components/<Name>"` — the documented
// form — names a module in the framework's own component directory.  Loom's
// machine-owned shim and props file live in the reserved extern directory, so
// the generated tree holds no file at the user's path (any extension: the
// user's `.tsx` / `.ts` / `.vue` / `.svelte`), and the shim it does emit
// resolves to that path.
//
// This is an ABSENCE claim (no emitted file at the user's path), which no
// compile tier observes on its own: a build passes just as well when the shim
// overwrites the user's module.  The build-level twin — the user's module on
// disk before `ddd generate system`, byte-identical after, then built — is the
// `extern-user-path` case of the generated-*-build e2e suites.

import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

type Framework = "react" | "vue" | "svelte" | "angular";

const DEPLOYABLE: Record<Framework, string> = {
  react: "platform: static",
  vue: "platform: static",
  svelte: "platform: svelte",
  angular: "platform: angular",
};

const SHIM_EXT: Record<Framework, string> = {
  react: ".tsx",
  vue: ".ts",
  svelte: ".svelte",
  angular: ".ts",
};

function source(framework: Framework, from: string): string {
  return `
    system S {
      subdomain M { context C { aggregate Order { customerId: string } } }
      api SApi from M
      ui WebApp {
        ${framework === "vue" ? "framework: vue" : ""}
        component RiskBadge(score: int, label: string) extern from "${from}"
        page Home { route: "/" body: RiskBadge { score: 3, label: "risk" } }
      }
      storage loomDb { type: postgres }
      resource cState { for: C, kind: state, use: loomDb }
      deployable api { platform: node, contexts: [C], dataSources: [cState], serves: SApi, port: 3000 }
      deployable web { ${DEPLOYABLE[framework]}, targets: api, ui: WebApp, port: 3001 }
    }
  `;
}

/** Every emitted path naming the module `web/src/<rel>` under any extension. */
function filesAtModule(files: ReadonlyMap<string, string>, rel: string): string[] {
  const stem = `web/src/${rel}`;
  return [...files.keys()].filter((p) => p === stem || p.startsWith(`${stem}.`));
}

/** The module the shim at `shimPath` re-exports, resolved to a project path. */
function shimTarget(shimPath: string, shim: string): string | undefined {
  const spec = [...shim.matchAll(/^\s*(?:import|export)\b.* from "(\.[^"]+)";$/gm)]
    .map((m) => m[1])
    .find((s) => !s.endsWith(".props"));
  return spec === undefined ? undefined : path.posix.join(path.posix.dirname(shimPath), spec);
}

const CASES: ReadonlyArray<{ framework: Framework; rel: string }> = [
  { framework: "react", rel: "components/RiskBadge" },
  { framework: "vue", rel: "components/RiskBadge" },
  { framework: "svelte", rel: "components/RiskBadge" },
  { framework: "svelte", rel: "lib/components/RiskBadge" },
  { framework: "angular", rel: "components/RiskBadge" },
];

describe("extern component shims stay off the user's module path", () => {
  for (const { framework, rel } of CASES) {
    it(`${framework}: from "./${rel}"`, async () => {
      const files = await generateSystemFiles(source(framework, `./${rel}`));
      expect(filesAtModule(files, rel)).toEqual([]);
      const shims = [...files.entries()].filter(
        ([p, c]) => p.endsWith(`/_extern/RiskBadge${SHIM_EXT[framework]}`) && shimTarget(p, c),
      );
      expect(shims.map(([p]) => p)).toHaveLength(1);
      const [shimPath, shim] = shims[0];
      expect(shimTarget(shimPath, shim)).toBe(`web/src/${rel}`);
    });
  }
});
