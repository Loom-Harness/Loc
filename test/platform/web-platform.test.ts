// Gate for D-WEB-PLATFORM (docs/decisions).
import { describe, expect, it } from "vitest";
import { descriptorFor, frontendPlatformNames } from "../../src/platform/metadata.js";
import { allPlatforms } from "../../src/platform/registry.js";
import { STATIC_BUNDLE_FRAMEWORKS } from "../../src/platform/surface.js";
import { buildLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

const system = (uiFramework: string, platform = "web"): string => `
  system S {
    subdomain M { context C { aggregate A { x: int } } }
    ui Web { ${uiFramework} }
    deployable api { platform: node, contexts: [C], port: 3000 }
    deployable web { platform: ${platform}, targets: api, ui: Web }
  }
`;

describe("D-WEB-PLATFORM", () => {
  it("has exactly three frontend platforms, and `web` hosts every static bundle", () => {
    expect(frontendPlatformNames()).toEqual(["feliz", "flutter", "web"]);
    expect([...descriptorFor("web").hostableFrameworks].sort()).toEqual(
      [...STATIC_BUNDLE_FRAMEWORKS].sort(),
    );
    expect([...STATIC_BUNDLE_FRAMEWORKS].sort()).toEqual(["angular", "react", "svelte", "vue"]);
  });

  it("registers `web` once and no per-framework platform", () => {
    const names = allPlatforms().map((p) => p.name);
    expect(names.filter((n) => n === "web")).toHaveLength(1);
    for (const old of ["react", "vue", "svelte", "angular", "static"]) {
      expect(names, old).not.toContain(old);
    }
  });

  it.each([
    "react",
    "vue",
    "svelte",
    "angular",
    "static",
  ])("`platform: %s` is not a platform", async (old) => {
    const { errors } = await parseString(system("", old));
    expect(errors.length, `platform: ${old}`).toBeGreaterThan(0);
  });

  it.each([
    ["", "react", 3001],
    ["framework: svelte", "svelte", 3002],
    ["framework: vue", "vue", 3003],
    ["framework: angular", "angular", 3004],
  ] as const)("a web deployable renders the ui's framework (%s)", async (clause, fw, port) => {
    const model = await buildLoomModel(system(clause));
    const web = model.systems[0]!.deployables.find((d) => d.name === "web")!;
    expect(web.platform).toBe("web");
    expect(web.uiFramework).toBe(fw);
    expect(web.port).toBe(port);
  });

  it("a ui may be named `web`", async () => {
    const { errors } = await parseString(`
      system S {
        subdomain M { context C { aggregate A { x: int } } }
        ui web { }
        deployable api { platform: node, contexts: [C], port: 3000 }
        deployable site { platform: web, targets: api, ui: web }
      }
    `);
    expect(errors).toEqual([]);
  });

  it("a deployable carries no `framework:` clause — the ui owns it", async () => {
    const { errors } = await parseString(`
      system S {
        subdomain M { context C { aggregate A { x: int } } }
        ui W { }
        deployable api { platform: node, contexts: [C], port: 3000 }
        deployable site { platform: web, framework: vue, targets: api, ui: W }
      }
    `);
    expect(errors.some((e) => /found `framework`/.test(e)), errors.join("\n")).toBe(true);
  });
});
