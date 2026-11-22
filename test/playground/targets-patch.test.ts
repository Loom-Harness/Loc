import { describe, expect, it } from "vitest";
import { applyPatches } from "../../src/api/index.js";
import { parseDdd } from "../../web/src/builder/parse.js";
import {
  designPackMenu,
  frontendFrameworkMenu,
  maskInert,
  platformMenu,
  readClause,
  readTargets,
  rewriteClause,
  type TargetDeployable,
  targetPatches,
} from "../../web/src/layout/targets-patch.js";

// The targets drawer's pure half (M-T8.23 slice 1, research §4 #21).  A target
// change is a NODE-ADDRESSED patch — `{op:"replace", target:"deployable web",
// source:<the block with one clause rewritten>}` — so the applier splices a CST
// range and every other byte of the file, comments included, survives.
//
// What these pin: the clause scanner does not match inside a comment or a
// string; the rewrite preserves the rest of the block verbatim; a frontend's
// framework change moves the deployable to the platform that renders it and
// carries an incompatible `design:` with it; and a scan that disagrees with the
// AST refuses instead of rewriting the wrong line.

const SOURCE = `system Shop {
  context Sales {
    aggregate Order {
      total: Money
    }
  }

  ui WebApp {
    framework: react
  }

  // A comment that says platform: dotnet — the scanner must not see it.
  deployable api {
    platform: node
    contexts: [Sales]
    port: 8080
  }

  deployable webApp {
    platform: web
    targets: api
    ui: WebApp
    design: mantine
    port: 3001
  }
}
`;

function targets(source = SOURCE): TargetDeployable[] {
  const parsed = parseDdd(source);
  expect(parsed.parserErrors).toEqual([]);
  return readTargets(parsed.ast, source);
}

function byName(name: string, source = SOURCE): TargetDeployable {
  const found = targets(source).find((t) => t.name === name);
  if (!found) throw new Error(`no deployable '${name}'`);
  return found;
}

describe("maskInert / readClause — the scanner", () => {
  it("blanks comments but keeps offsets and newlines", () => {
    const text = "a // platform: dotnet\nb";
    const mask = maskInert(text);
    expect(mask.length).toBe(text.length);
    expect(mask).toBe("a                    \nb");
  });

  it("neutralises string CONTENT but keeps the quotes, so `\\s*` can't swallow a value", () => {
    const mask = maskInert('design: "mantine@v9"');
    expect(mask).toBe('design: "~~~~~~~~~~"');
    expect(readClause('design: "mantine@v9"', "design")).toBe("mantine@v9");
  });

  it("does not read a clause out of a comment", () => {
    // The only real `platform:` is `node`; the comment above it says dotnet.
    expect(readClause(byName("api").text, "platform")).toBe("node");
  });

  it("returns null for an absent clause", () => {
    expect(readClause(byName("api").text, "design")).toBeNull();
  });
});

describe("rewriteClause", () => {
  it("replaces the value and leaves every other byte alone", () => {
    const before = byName("webApp").text;
    const after = rewriteClause(before, "platform", "feliz");
    expect(after).not.toBeNull();
    expect(after).toContain("platform: feliz");
    // Everything except the bytes of the value is untouched.
    expect(after?.replace("platform: feliz", "platform: web")).toBe(before);
  });

  it("is a no-op (null) when the clause already reads the value", () => {
    expect(rewriteClause(byName("webApp").text, "platform", "web")).toBeNull();
  });

  it("quotes a value the grammar's barewords do not cover", () => {
    const after = rewriteClause(byName("webApp").text, "design", "mantine@v9");
    expect(after).toContain('design: "mantine@v9"');
  });

  it("inserts an absent clause on its own line after `platform:`", () => {
    const after = rewriteClause(byName("api").text, "design", "mantine");
    expect(after).toContain("platform: node\n    design: mantine\n");
  });

  it("inserts into a one-line block with a separating comma", () => {
    const text = "deployable web { platform: web, targets: api }";
    expect(rewriteClause(text, "design", "mantine")).toBe(
      "deployable web { platform: web, targets: api, design: mantine }",
    );
  });
});

describe("readTargets", () => {
  it("reads every deployable with its platform, design and bound ui", () => {
    expect(targets().map((t) => t.name)).toEqual(["api", "webApp"]);
    const api = byName("api");
    expect(api.platform).toBe("node");
    expect(api.isFrontend).toBe(false);
    expect(api.design).toBeNull();
    expect(api.ui).toBeNull();
    const web = byName("webApp");
    expect(web.platform).toBe("web");
    expect(web.isFrontend).toBe(true);
    expect(web.design).toBe("mantine");
    expect(web.mountsUi).toBe(true);
    expect(web.ui?.name).toBe("WebApp");
    expect(web.ui?.framework).toBe("react");
    expect(web.address).toBe("deployable webApp");
    expect(web.ui?.address).toBe("ui WebApp");
  });

  it("slices the declaration's own source, not the whole file", () => {
    expect(byName("api").text.startsWith("deployable api {")).toBe(true);
    expect(byName("api").text.endsWith("}")).toBe(true);
    expect(byName("api").text).not.toContain("deployable webApp");
  });
});

describe("targetPatches — the drawer's edit", () => {
  it("picking a framework rewrites the bound ui's `framework:`", () => {
    const patches = targetPatches(byName("webApp"), "framework", "vue");
    const ui = patches.find((p) => p.target === "ui WebApp");
    expect(ui?.op).toBe("replace");
    expect(ui?.source).toContain("framework: vue");
  });

  it("carries an incompatible design pack with the framework", () => {
    // `mantine` is a tsx pack; a vue ui renders vue markup, so leaving it
    // would hand the user `loom.design-pack-format-mismatch` for a change the
    // drawer made.
    const patches = targetPatches(byName("webApp"), "framework", "vue");
    expect(patches.map((p) => p.target)).toEqual(["ui WebApp", "deployable webApp"]);
    const source = patches.find((p) => p.target === "deployable webApp")?.source ?? "";
    expect(source).toContain("design: vuetify");
    expect(source).toContain("platform: web");
    expect(source).not.toContain("mantine");
  });

  it("moves the deployable to the platform that renders the framework", () => {
    const patches = targetPatches(byName("webApp"), "framework", "feliz");
    expect(patches.find((p) => p.target === "ui WebApp")?.source).toContain("framework: feliz");
    expect(patches.find((p) => p.target === "deployable webApp")?.source).toContain(
      "platform: feliz",
    );
  });

  it("leaves a compatible design pack alone", () => {
    const noFramework = SOURCE.replace("    framework: react\n", "");
    const patches = targetPatches(byName("webApp", noFramework), "platform", "web");
    expect(patches).toEqual([]);
    expect(targetPatches(byName("webApp"), "design", "shadcn")[0]?.source).toContain(
      "platform: web",
    );
  });

  it("changes the design pack on its own", () => {
    const patches = targetPatches(byName("webApp"), "design", "shadcn");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.source).toContain("design: shadcn");
    expect(patches[0]?.source).toContain("platform: web");
  });

  it("on a backend, the framework axis rewrites only the ui", () => {
    const hosted = SOURCE.replace(
      "    contexts: [Sales]\n",
      "    contexts: [Sales]\n    ui: WebApp\n",
    ).replace("platform: node", "platform: dotnet");
    const patches = targetPatches(byName("api", hosted), "framework", "vue");
    expect(patches.map((p) => p.target)).toEqual(["ui WebApp"]);
  });

  it("emits nothing for a no-op change — the caller refuses visibly", () => {
    expect(targetPatches(byName("webApp"), "framework", "react")).toEqual([]);
    expect(targetPatches(byName("webApp"), "platform", "web")).toEqual([]);
    expect(targetPatches(byName("api"), "framework", "vue")).toEqual([]);
  });

  it("refuses when the scanned clause disagrees with the AST", () => {
    // A hand-built target whose `text` does not contain the platform the AST
    // read — the offsets describe something else, so no patch is emitted
    // (the same READ gate `builder/pane-write.ts` applies to a recovered AST).
    const bogus: TargetDeployable = {
      ...byName("webApp"),
      platform: "feliz",
    };
    expect(targetPatches(bogus, "framework", "vue")).toEqual([]);
    expect(targetPatches(bogus, "platform", "flutter")).toEqual([]);
  });
});

describe("the menus", () => {
  it("offers frontends to a frontend and backends to a backend", () => {
    expect(platformMenu(byName("webApp"))).toEqual(["feliz", "flutter", "web"]);
    expect(frontendFrameworkMenu()).toEqual([
      "angular",
      "feliz",
      "flutter",
      "react",
      "svelte",
      "vue",
    ]);
    expect(platformMenu(byName("webApp"))).not.toContain("node");
    expect(platformMenu(byName("api"))).toContain("java");
    expect(platformMenu(byName("api"))).not.toContain("web");
  });

  it("offers a gateway only itself", () => {
    const withGateway = SOURCE.replace(
      /\n}\n$/,
      `
  deployable site {
    platform: gateway
    port: 8090
    gathers: [ webApp at "/" ]
  }
}
`,
    );
    const site = targets(withGateway).find((t) => t.name === "site");
    expect(site && platformMenu(site)).toEqual(["gateway"]);
  });

  it("offers only packs whose format matches the framework", () => {
    const react = designPackMenu(byName("webApp"));
    expect(react).toContain("mantine");
    expect(react).toContain("shadcn");
    expect(react).not.toContain("vuetify");
    expect(react).not.toContain("coreComponents");
  });

  it("offers vue packs once the deployable is a vue target", () => {
    const vueSource = SOURCE.replace("framework: react", "framework: vue").replace(
      "design: mantine",
      "design: vuetify",
    );
    const menu = designPackMenu(byName("webApp", vueSource));
    expect(menu).toEqual(["shadcnVue", "vuetify"]);
  });
});

describe("through applyPatches — the real applier", () => {
  it("splices the deployable and the ui, leaving every other byte alone", async () => {
    const patches = targetPatches(byName("webApp"), "framework", "vue");
    const result = await applyPatches(SOURCE, patches);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.text).toContain("platform: web");
    expect(result.text).toContain("framework: vue");
    expect(result.text).toContain("design: vuetify");
    // The comment above `deployable api`, and `api` itself, are untouched.
    expect(result.text).toContain("// A comment that says platform: dotnet");
    expect(result.text).toContain("platform: node");
    // …and the result still parses.
    expect(parseDdd(result.text).parserErrors).toEqual([]);
  });
});
