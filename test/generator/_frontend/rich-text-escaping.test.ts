// `tRich` returns HTML that the React / Vue / Svelte / Angular pages bind raw
// (`dangerouslySetInnerHTML`, `v-html`, `{@html}`, `[innerHTML]`), so a hole
// VALUE must never become markup: it is HTML-escaped, and the private marker
// characters the runtime turns the message's own `<b>` / `<i>` / `<code>` tags
// into are stripped from it, so a value cannot forge an emphasis tag either.
//
// This runs the runtime module each frontend actually ships.  The ICU step is
// a stand-in that substitutes `{name}` holes — `intl-messageformat` is a
// generated-app dependency, not one of this repo's — which is exactly what the
// real formatter does with a plain string argument.

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
        body: Text { "Hello ", Bold { \`{name}\` }, ", welcome" }
      }
    }
    deployable api { platform: node contexts: [Cat] dataSources: [s] serves: ShopApi port: 3000 }
    deployable web {
      platform: ${platform} design: "${pack}" targets: api
      ui: WebApp { Shop: api } port: 3005
    }
  }
`;

/** Substitutes `{name}` holes from `values` — the plain-argument behaviour of
 *  `intl-messageformat`. */
class StubMessageFormat {
  constructor(private readonly message: string) {}
  format(values: Record<string, unknown>): string {
    return this.message.replace(/\{(\w+)\}/g, (_m, k: string) => String(values[k]));
  }
}

type TRich = (key: string, defaultMessage: string, values?: Record<string, string>) => string;

/** Load the emitted runtime module and return its `tRich`. */
function loadTRich(source: string): TRich {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const require = (id: string): unknown => {
    if (id === "intl-messageformat") return { IntlMessageFormat: StubMessageFormat };
    if (id.endsWith(".json")) return { default: {} };
    throw new Error(`the i18n runtime imports ${id}`);
  };
  new Function("require", "module", "exports", js)(require, module, module.exports);
  return module.exports.tRich as TRich;
}

const PAYLOAD = "<img src=x onerror=alert(1)>";
const MESSAGE = "Hello <b>{name}</b>, welcome";

describe("tRich escapes hole values on every HTML-binding frontend", () => {
  for (const [platform, pack] of [
    ["static", "mantine"],
    ["vue", "vuetify"],
    ["svelte", "flowbite"],
    ["angular", "angularMaterial"],
  ] as const) {
    it(`${platform}: an injected element comes out as text`, async () => {
      const files = await generateSystemFiles(system(platform, pack));
      const defining = [...files].filter(
        ([p, c]) => p.startsWith("web/") && c.includes("export function tRich("),
      );
      // The framework locale adapter (Vue / Svelte / Angular) wraps the runtime's
      // `tRich` for reactivity and adds no formatting of its own.
      const runtimes = defining.filter(([, c]) => c.includes("intl-messageformat"));
      expect(runtimes.length, "one emitted tRich runtime").toBe(1);
      for (const [p, c] of defining) {
        if (c.includes("intl-messageformat")) continue;
        expect(c, `${p} delegates to the runtime`).toMatch(
          /return (?:baseTRich|i18n\.tRich)\(key, defaultMessage, values\);\n\}/,
        );
      }
      const tRich = loadTRich(runtimes[0]![1]);

      // The message's own tag renders; the value's markup is inert text.
      expect(tRich("k", MESSAGE, { name: PAYLOAD })).toBe(
        "Hello <strong>&lt;img src=x onerror=alert(1)&gt;</strong>, welcome",
      );
      // A value that smuggles the private markers cannot forge a tag.
      const forged = "/b<script>x</script>b";
      const out = tRich("k", MESSAGE, { name: forged });
      expect(out).toBe("Hello <strong>/b&lt;script&gt;x&lt;/script&gt;b</strong>, welcome");
      expect(out).not.toMatch(/<(?!\/?strong>)/);
    });
  }
});
