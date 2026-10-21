// A custom `design: "<path>"` pack is loaded and checked before codegen.
//
// Every way such a pack can be malformed is ONE defect list
// (`src/generator/_packs/pack-defects.ts` + `loader-fs.ts#inspectPackDir`), read
// by two consumers that must agree:
//
//   * phase ⑦ (`design-pack-checks.ts`) — the model is refused with
//     `loom.design-pack-invalid` naming the defect, before `generate` runs;
//   * the loader — `loadPack` refuses the same pack with the same code, for a
//     caller that skipped validation.
//
// Each case below builds a broken pack from a shipped one and asserts BOTH.
// Plus: every shipped pack inspects clean (the check has no false positives on
// the packs the toolchain itself ships), and a relative `design:` path resolves
// against the `.ddd` file's directory, not the process working directory.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";
import {
  fsDesignPackInspector,
  inspectPackDir,
  loadPack,
} from "../../../src/generator/_packs/loader-fs.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = path.join(repoRoot, "bin", "cli.js");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loom-pack-defects-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

let seq = 0;
/** Copy a shipped pack into a fresh temp dir and let `mutate` break it. */
function brokenPack(
  shipped: string,
  mutate: (dir: string, manifest: Record<string, unknown>) => void,
): string {
  const dir = path.join(tmpRoot, `pack-${seq++}`);
  fs.cpSync(path.join(repoRoot, "designs", shipped), dir, { recursive: true });
  const manifestPath = path.join(dir, "pack.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  mutate(dir, manifest);
  // Write the (mutated) manifest back unless the mutation removed or corrupted
  // pack.json on purpose.
  if (fs.existsSync(manifestPath) && isJson(fs.readFileSync(manifestPath, "utf8"))) {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }
  return dir;
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

const reactSystem = (design: string) => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Customer with crudish {
        name: string
      }
      repository Customers for Customer {}
    }
  }
  api SalesApi from Sales
  storage primary { type: postgres }
  resource st { for: Orders, kind: state, use: primary }
  ui WebApp with scaffold(subdomains: [Sales]) {
    api Sales: SalesApi
  }
  deployable api {
    platform: node
    contexts: [Orders]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
  deployable web {
    platform: react
    design: ${JSON.stringify(design)}
    targets: api
    ui: WebApp { Sales: api }
    port: 3000
  }
}
`;

const elixirSystem = (design: string) => `
system Shop {
  subdomain Sales {
    context Orders {
      aggregate Customer with crudish {
        name: string
      }
      repository Customers for Customer {}
    }
  }
  api SalesApi from Sales
  storage primary { type: postgres }
  resource st { for: Orders, kind: state, use: primary }
  ui WebApp with scaffold(subdomains: [Sales]) {
    api Sales: SalesApi
  }
  deployable app {
    platform: elixir
    design: ${JSON.stringify(design)}
    contexts: [Orders]
    dataSources: [st]
    serves: SalesApi
    ui: WebApp { Sales: app }
    port: 4000
  }
}
`;

/** Phase ⑦ through the toolkit, with the CLI's disk-backed pack reader. */
async function irErrors(source: string) {
  const report = await validate(source, { designPacks: fsDesignPackInspector(tmpRoot) });
  return report.diagnostics.filter((d) => d.severity === "error");
}

interface Case {
  name: string;
  shipped: string;
  system: (design: string) => string;
  mutate: (dir: string, manifest: Record<string, unknown>) => void;
  /** The defect kind the inspection reports. */
  kind: string;
  /** A fragment of the defect sentence, in the diagnostic AND the loader error. */
  text: RegExp;
}

const SCAN_KINDS = new Set([
  "chrome-role-undeclared",
  "chrome-hole-heex",
  "template-syntax",
  "partial-unknown",
]);

const emitsOf = (m: Record<string, unknown>) => m.emits as Record<string, string>;

const CASES: Case[] = [
  {
    name: "no pack.json (loader-fs.ts#loadPack)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (dir) => fs.rmSync(path.join(dir, "pack.json")),
    kind: "manifest-missing",
    text: /no pack\.json at /,
  },
  {
    name: "pack.json is not JSON",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (dir) => fs.writeFileSync(path.join(dir, "pack.json"), "{ not json"),
    kind: "manifest-unreadable",
    text: /is not valid JSON/,
  },
  {
    name: "no emits map (loader-fs.ts#loadPack$2)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      delete m.emits;
    },
    kind: "emits-missing",
    text: /has no `emits` map/,
  },
  {
    name: "an emits entry names a missing .hbs (loader-fs.ts#loadPack$4)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      emitsOf(m)["primitive-button"] = "nope.hbs";
    },
    kind: "template-missing",
    text: /template "primitive-button" → "nope\.hbs" not found/,
  },
  {
    name: "an unknown stack (loader-fs.ts#loadPack$5)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      m.stack = "v999";
    },
    kind: "stack-unknown",
    text: /declares stack "v999", which is not a shipped stack/,
  },
  {
    name: "an unknown format",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      m.format = "jsx";
    },
    kind: "format-unknown",
    text: /declares format "jsx"/,
  },
  {
    name: "a required primitive is missing (loader.ts#compilePack$3)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      delete emitsOf(m)["primitive-button"];
    },
    kind: "required-missing",
    text: /missing required template\(s\) for format tsx: primitive-button/,
  },
  {
    name: "an empty chrome message (pack-chrome.ts#assertDeclaredChromeIsSane)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      (m.chrome as Record<string, string>).boolTrue = "";
    },
    kind: "chrome-message-empty",
    text: /chrome role "boolTrue" has a non-string or empty message/,
  },
  {
    name: "a chrome message carrying `<` (pack-chrome.ts#assertDeclaredChromeIsSane$2)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      (m.chrome as Record<string, string>).boolTrue = "<b>Yes";
    },
    kind: "chrome-message-forbidden-char",
    text: /chrome role "boolTrue" contains a character that is significant/,
  },
  {
    name: "a chrome message with an unbalanced brace (pack-chrome.ts#assertDeclaredChromeIsSane$3)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      (m.chrome as Record<string, string>).boolTrue = "Yes {";
    },
    kind: "chrome-message-brace",
    text: /chrome role "boolTrue" has an unbalanced or non-ICU brace/,
  },
  {
    name: "a template uses an undeclared chrome role (pack-chrome.ts#declared)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      delete (m.chrome as Record<string, string>).boolTrue;
    },
    kind: "chrome-role-undeclared",
    text: /uses chrome role "boolTrue", which pack\.json's `chrome` map does not declare/,
  },
  {
    name: "a HEEx template passes ICU hole values (pack-chrome.ts#bind)",
    shipped: "coreComponents/v3",
    system: elixirSystem,
    mutate: (dir) => {
      const f = path.join(dir, "core-components.heex.hbs");
      fs.writeFileSync(
        f,
        fs
          .readFileSync(f, "utf8")
          .replace('{{{chrome "rowActions"}}}', '{{{chrome "rowActions" who="x"}}}'),
      );
    },
    kind: "chrome-hole-heex",
    text: /passes ICU hole values to chrome role "rowActions", which the heex format does not render/,
  },
  {
    name: "a shellFiles key not in emits (shell-emits.ts#emitShellFiles)",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (_dir, m) => {
      m.shellFiles = { "nonexistent-tpl": "src/x.tsx" };
    },
    kind: "shellfile-not-emitted",
    text: /shellFiles entry "nonexistent-tpl" → "src\/x\.tsx" is not present in the emits map/,
  },
  {
    name: "a template that is not valid Handlebars",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (dir, m) => {
      fs.writeFileSync(path.join(dir, emitsOf(m)["primitive-button"]!), "{{#if x}}unclosed");
    },
    kind: "template-syntax",
    text: /template "primitive-button" is not valid Handlebars/,
  },
  {
    name: "a template includes a partial nothing provides",
    shipped: "mantine/v7",
    system: reactSystem,
    mutate: (dir, m) => {
      const f = path.join(dir, emitsOf(m)["primitive-button"]!);
      fs.writeFileSync(f, `${fs.readFileSync(f, "utf8")}{{> no-such-partial}}`);
    },
    kind: "partial-unknown",
    text: /includes partial "no-such-partial", which no template/,
  },
];

describe("a malformed custom design pack is refused as loom.design-pack-invalid", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const dir = brokenPack(c.shipped, c.mutate);

      it("the inspection names the defect", () => {
        const kinds = inspectPackDir(dir).defects.map((d) => d.kind);
        expect(kinds).toContain(c.kind);
      });

      it("phase ⑦ refuses the model with the code and the defect", async () => {
        const errors = await irErrors(c.system(dir));
        expect(errors.map((e) => e.code)).toEqual(["loom.design-pack-invalid"]);
        expect(errors[0]!.message).toMatch(c.text);
      });

      // The template SCAN (roles, holes, syntax, partials) parses every
      // template, so the loader leaves it to phase ⑦; its backstop for a chrome
      // role is the render-time helper (pack-declared-chrome.test.ts).
      it.skipIf(SCAN_KINDS.has(c.kind))(
        "the loader refuses the same pack with the same coded message",
        () => {
          expect(() => loadPack(dir)).toThrow(/^Design pack '.*' cannot be rendered: /);
          expect(() => loadPack(dir)).toThrow(c.text);
        },
      );
    });
  }

  it("a well-formed custom pack passes (the copy of a shipped one)", async () => {
    const dir = brokenPack("mantine/v7", () => {});
    expect(inspectPackDir(dir).defects).toEqual([]);
    expect(await irErrors(reactSystem(dir))).toEqual([]);
  });

  it("a custom pack of the wrong format is loom.design-pack-format-mismatch", async () => {
    const dir = brokenPack("coreComponents/v3", () => {});
    const errors = await irErrors(reactSystem(dir));
    expect(errors.map((e) => e.code)).toEqual(["loom.design-pack-format-mismatch"]);
    expect(errors[0]!.message).toMatch(/is a heex pack but framework 'react' renders tsx/);
  });

  it("without a pack reader (browser / in-memory toolkit) the check is skipped", async () => {
    const report = await validate(reactSystem("./no-such-pack"));
    expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("every shipped design pack inspects clean", () => {
  const designs = path.join(repoRoot, "designs");
  for (const family of fs.readdirSync(designs).sort()) {
    for (const version of fs.readdirSync(path.join(designs, family)).sort()) {
      const dir = path.join(designs, family, version);
      if (!fs.existsSync(path.join(dir, "pack.json"))) continue;
      it(`${family}@${version}`, () => {
        expect(inspectPackDir(dir).defects).toEqual([]);
      });
    }
  }
});

describe("a relative design: path resolves against the .ddd file, not the cwd", () => {
  // The project lives in its own dir with the pack beside the source; the CLI
  // runs from an unrelated cwd.  Resolving against the cwd found no pack.json.
  const project = path.join(tmpRoot, "project");
  fs.mkdirSync(path.join(project, "design"), { recursive: true });
  fs.cpSync(path.join(repoRoot, "designs", "mantine", "v7"), path.join(project, "design", "mine"), {
    recursive: true,
  });
  const file = path.join(project, "main.ddd");
  fs.writeFileSync(file, reactSystem("./design/mine"));
  const elsewhere = fs.mkdtempSync(path.join(tmpRoot, "cwd-"));

  it("`ddd parse` reports no error from another cwd", () => {
    const r = spawnSync("node", [cli, "parse", file], { cwd: elsewhere, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("loom.design-pack-invalid");
  });

  it("`ddd generate system` loads the pack from another cwd", () => {
    const out = path.join(tmpRoot, "out-relative");
    const r = spawnSync("node", [cli, "generate", "system", file, "-o", out], {
      cwd: elsewhere,
      encoding: "utf8",
    });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(out, "web", "package.json"))).toBe(true);
  });

  it("a pack missing beside the .ddd is reported at its .ddd-relative path", () => {
    const missing = path.join(project, "missing.ddd");
    fs.writeFileSync(missing, reactSystem("./design/absent"));
    const r = spawnSync("node", [cli, "parse", missing], { cwd: elsewhere, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("loom.design-pack-invalid");
    expect(r.stderr).toContain(path.join(project, "design", "absent", "pack.json"));
  });
});
