// A `money` / `decimal` wire value reaches `t()` as a decimal.js `Decimal`.  The
// emitted runtime must (1) accept it in its `Values` type, so a page that
// passes `totals.amount` still compiles, and (2) hand a `number` to a numeric
// ICU hole (`{x, number, ::currency/EUR}`) while a plain `{x}` hole keeps the
// Decimal's exact text.  This loads the runtime each frontend ships; the ICU
// step is a recorder, since `intl-messageformat` is a generated-app dependency.

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const system = (platform: string, pack: string): string => `
  system Shop {
    api ShopApi from Catalog
    subdomain Catalog {
      context Cat {
        aggregate Product { name: string }
        repository Products for Product { }
      }
    }
    storage db { type: postgres }
    resource s { for: Cat, kind: state, use: db }
    ui WebApp {
      api Shop: ShopApi
      page Home {
        route: "/"
        state { name: string = "" }
        body: Text { \`Hello {name}\` }
      }
    }
    deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
    deployable web {
      platform: ${platform} design: "${pack}" targets: api
      ui: WebApp { Shop: api } port: 3005
    }
  }
`;

const seen: Record<string, unknown>[] = [];
class RecordingFormat {
  constructor(private readonly message: string) {}
  format(values: Record<string, unknown>): string {
    seen.push(values);
    return this.message;
  }
}

/** Stand-in for a decimal.js `Decimal` (only the structural surface matters). */
const decimal = (text: string) => ({ toNumber: () => Number(text), toString: () => text });

function loadT(source: string) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const require = (id: string): unknown => {
    if (id === "intl-messageformat") return { IntlMessageFormat: RecordingFormat };
    if (id.endsWith(".json")) return { default: {} };
    throw new Error(`the i18n runtime imports ${id}`);
  };
  new Function("require", "module", "exports", js)(require, module, module.exports);
  return module.exports.t as (k: string, m: string, v: Record<string, unknown>) => string;
}

/** Type errors of `call` against the runtime source (stubbed ICU import). */
function typeErrors(runtime: string, call: string): string[] {
  const files: Record<string, string> = {
    "/i18n.ts": runtime,
    "/main.ts": `import { t } from "./i18n";\n${call}\n`,
    "/intl.d.ts": `declare module "intl-messageformat" { export class IntlMessageFormat { constructor(m: string, l: string); format(v: unknown): string } }
declare module "*.json" { const v: Record<string, string>; export default v }`,
  };
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  const exists = host.fileExists.bind(host);
  host.fileExists = (f) => f in files || exists(f);
  host.readFile = (f) => files[f] ?? read(f);
  host.getSourceFile = (f, lv) => {
    const text = files[f] ?? read(f);
    return text === undefined ? undefined : ts.createSourceFile(f, text, lv);
  };
  const program = ts.createProgram(["/main.ts", "/intl.d.ts"], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === "/main.ts")
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("a Decimal reaches a numeric ICU hole as a number", () => {
  for (const [platform, pack] of [
    ["static", "mantine"],
    ["vue", "vuetify"],
    ["svelte", "flowbite"],
    ["angular", "angularMaterial"],
  ] as const) {
    it(`${platform}: type admits Decimal, number hole gets a number`, async () => {
      const files = await generateSystemFiles(system(platform, pack));
      const runtime = [...files].find(
        ([p, c]) =>
          p.startsWith("web/") &&
          c.includes("intl-messageformat") &&
          c.includes("export function t("),
      )![1];

      expect(
        typeErrors(
          runtime,
          `declare const amount: { toNumber(): number };\nt("k", "{amount, number, ::currency/EUR}", { amount });`,
        ),
      ).toEqual([]);

      const t = loadT(runtime);
      seen.length = 0;
      t("k", "Total {amount, number, ::currency/EUR}", { amount: decimal("12.30") });
      expect(seen[0]).toEqual({ amount: 12.3 });
      t("k", "Total {amount}", { amount: decimal("12.30") });
      expect(seen[1]).toEqual({ amount: "12.30" });
    });
  }
});

describe("emitted runtime headers", () => {
  // String tier (absence claim): no compile or boot tier observes header prose,
  // and the claim is that stale hand-registration advice is gone.
  it("does not instruct hand registration of a locale", async () => {
    const files = await generateSystemFiles(system("static", "mantine"));
    const runtime = [...files].find(([p]) => p === "web/src/i18n.ts")![1];
    expect(runtime).not.toContain("drop a `src/locales/");
    expect(runtime).not.toContain("register it in `catalogs`");
  });
});
