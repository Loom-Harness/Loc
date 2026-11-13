import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { frameworkPlugin } from "../../web/src/engine/npm/frontend-frameworks.js";
import { generateSystemFiles } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The preview compiles a Vue frontend's single-file components in the
// browser.  Every `.vue` file the generator emits for the Vue sales example
// must come out of the plugin as a module that parses — a component the
// compiler rejects is a blank preview.  The booted round-trip (the component
// rendering against a backend) is `web/e2e/multi-frontend-preview.spec.ts`;
// this is the fast, network-free half.
// ---------------------------------------------------------------------------

type OnLoad = (args: { path: string }) => Promise<{
  contents?: string;
  loader?: string;
  errors?: { text: string }[];
}>;

/** The plugin's `.vue` onLoad callback, taken off a recording `build`. */
function vueOnLoad(files: Map<string, string>): OnLoad {
  let load: OnLoad | null = null;
  const build = {
    onResolve: () => {},
    onLoad: (opts: { filter: RegExp; namespace?: string }, cb: OnLoad) => {
      if (opts.filter.test("x.vue") && opts.namespace === "vfs") load = cb;
    },
  };
  frameworkPlugin("vue", files).setup(build as never);
  if (!load) throw new Error("the vue plugin registers no .vue loader");
  return load;
}

describe("the Vue frontend compiler", () => {
  it("compiles every generated single-file component to a module that parses", async () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../web/src/examples/sales-system-vue.ddd"),
      "utf8",
    );
    const generated = await generateSystemFiles(source);
    const files = new Map([...generated].map(([p, c]) => [`/${p}`, c] as const));
    const vue = [...files.keys()].filter((p) => p.endsWith(".vue"));
    expect(vue.length).toBeGreaterThan(5);
    const load = vueOnLoad(files);
    for (const p of vue) {
      const out = await load({ path: p });
      expect(out.errors, p).toBeUndefined();
      const parsed = ts.transpileModule(out.contents ?? "", {
        reportDiagnostics: true,
        fileName: `${p}.ts`,
      });
      expect(parsed.diagnostics, p).toEqual([]);
      expect(out.contents, p).toContain("export default _sfc_main");
    }
  });

  it("pins the compiler to the vue version the generated frontend runs", () => {
    // Compiler output targets one runtime: a compiler ahead of or behind the
    // generated `vue` emits helpers that runtime does not export.
    const stack = readFileSync(
      path.resolve(__dirname, "../../stacks/vue1/stack-package-deps.hbs"),
      "utf8",
    );
    const runtime = stack.match(/"vue":\s*"([^"]+)"/)?.[1];
    const web = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../web/package.json"), "utf8"),
    ) as {
      dependencies: Record<string, string>;
    };
    expect(runtime).toBeDefined();
    expect(web.dependencies["@vue/compiler-sfc"]).toBe(runtime);
  });

  it("reports a component the compiler rejects as a bundle error, naming the file", async () => {
    const files = new Map([["/w/src/Bad.vue", "<template><div></template>"]]);
    const out = await vueOnLoad(files)({ path: "/w/src/Bad.vue" });
    expect(out.errors?.[0]?.text).toContain("/w/src/Bad.vue");
  });
});
