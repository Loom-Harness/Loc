// The runtime locale model on the Vue, Svelte and Angular frontends — the fan-out
// of the React reference (`locale-runtime.test.ts`, whose runtime half runs the
// emitted `i18n.ts` and applies unchanged to every JS target).  What differs per
// framework is the BINDING: how the store reaches a component, how a switch
// re-renders the `t()` calls, where the switcher mounts, and what the shell,
// `index.html`, API client and format helpers read.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const UI_BODY = `
      page About {
        route: "/about"
        title: "About us"
        body: Stack { Heading { "All the documents" }, Text { "Second sentence" } }
      }`;

const system = (
  platform: "vue" | "svelte" | "angular",
  design: string,
  uiBody = UI_BODY,
  i18n = "",
): string => `
  system Demo {${i18n}
    subdomain S {
      context C {
        aggregate Doc with crudish { name: string }
        repository Docs for Doc { }
      }
    }
    api DemoApi from S
    ui Web with scaffold(subdomains: [S]) {
      framework: ${platform}
      api Ops: DemoApi${uiBody}
    }
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [C], dataSources: [cState], serves: DemoApi, port: 3000 }
    deployable web { platform: ${platform}, targets: api, ui: Web { Ops: api }, design: ${design}, port: 3001 }
  }
`;

const catalogsFor = (...locales: string[]): Map<string, Record<string, string>> =>
  new Map(locales.map((l) => [l, {}]));

const file = (files: Map<string, string>, suffix: string): string | undefined =>
  [...files].find(([p]) => p.endsWith(suffix))?.[1];

const mustFile = (files: Map<string, string>, suffix: string): string => {
  const f = file(files, suffix);
  if (f === undefined) throw new Error(`no emitted file ends with ${suffix}`);
  return f;
};

interface Cell {
  platform: "vue" | "svelte" | "angular";
  design: string;
  /** Path of the shell the switcher mounts in. */
  shell: string;
  /** The tag the shell mounts. */
  tag: string;
}

const CELLS: readonly Cell[] = [
  { platform: "vue", design: "vuetify", shell: "src/App.vue", tag: "<LocaleSwitcher" },
  { platform: "vue", design: "shadcnVue", shell: "src/App.vue", tag: "<LocaleSwitcher" },
  {
    platform: "svelte",
    design: "flowbite",
    shell: "src/routes/(app)/+layout.svelte",
    tag: "<LocaleSwitcher",
  },
  {
    platform: "svelte",
    design: "shadcnSvelte",
    shell: "src/routes/(app)/+layout.svelte",
    tag: "<LocaleSwitcher",
  },
  {
    platform: "angular",
    design: "angularMaterial",
    shell: "src/app/app.component.ts",
    tag: "<loom-locale-switcher",
  },
  {
    platform: "angular",
    design: "primeng",
    shell: "src/app/app.component.ts",
    tag: "<loom-locale-switcher",
  },
  {
    platform: "angular",
    design: "spartanNg",
    shell: "src/app/app.component.ts",
    tag: "<loom-locale-switcher",
  },
];

const cellName = (c: Cell): string => `${c.platform}/${c.design}`;

describe("shell switcher — mounted at 2+ locales, absent otherwise", () => {
  for (const c of CELLS) {
    it(`${cellName(c)}: header carries the switcher`, async () => {
      const files = await generateSystemFiles(system(c.platform, c.design), {
        translations: catalogsFor("de", "fr"),
      });
      expect(mustFile(files, c.shell)).toContain(c.tag);
    });

    it(`${cellName(c)}: no switcher with the source language alone`, async () => {
      const files = await generateSystemFiles(system(c.platform, c.design));
      const shell = mustFile(files, c.shell);
      expect(shell).not.toContain(c.tag);
      expect(shell).not.toMatch(/useLocale|\$locale|locale\(\)/);
    });

    it(`${cellName(c)}: a translator tree holding only the source language is one locale`, async () => {
      const files = await generateSystemFiles(system(c.platform, c.design), {
        translations: catalogsFor("en"),
      });
      expect(mustFile(files, c.shell)).not.toContain(c.tag);
    });
  }
});

describe("Vue — t() and getLocale() read a ref, no remount", () => {
  it("the adapter is a ref seeded from the store; t and getLocale read it first", async () => {
    const files = await generateSystemFiles(system("vue", "vuetify"), {
      translations: catalogsFor("de"),
    });
    const mod = mustFile(files, "src/lib/locale.ts");
    expect(mod).toContain("const locale = ref(baseGetLocale());");
    expect(mod).toMatch(/subscribe\(\(\) => \{\s*locale\.value = baseGetLocale\(\);/);
    expect(mod).toMatch(/export function useLocale\(\)/);
    expect(mod).toMatch(/export function getLocale\(\): string \{\s*return locale\.value;/);
    expect(mod).toMatch(
      /export function t\([^)]*\): string \{\s*void locale\.value;\s*return baseT\(/s,
    );
    const sw = mustFile(files, "src/components/LocaleSwitcher.vue");
    expect(sw).toContain('data-testid="locale-switcher"');
    expect(sw).toContain("setLocale((e.target as HTMLSelectElement).value)");
  });

  for (const design of ["vuetify", "shadcnVue"]) {
    it(`${design}: the shell mounts the switcher and does not key <router-view>`, async () => {
      const files = await generateSystemFiles(system("vue", design), {
        translations: catalogsFor("de", "fr"),
      });
      const shell = mustFile(files, "src/App.vue");
      expect(shell).toMatch(/import \{ t \} from "(\.\/|@\/)lib\/locale";/);
      expect(shell).toContain("<router-view v-else />");
      expect(shell).not.toMatch(/useLocale|:key="locale"/);
    });
  }

  it("named layouts mount the switcher and do not key their routed view", async () => {
    const src = system("vue", "vuetify").replace(
      "api DemoApi from S",
      "api DemoApi from S\n    layout Frame {\n      header { LocaleSwitcher {} }\n      main\n    }",
    );
    const files = await generateSystemFiles(
      src.replace('route: "/about"', 'route: "/about"\n        layout: Frame'),
      { translations: catalogsFor("de", "fr") },
    );
    const layout = mustFile(files, "src/layouts/Frame.vue");
    expect(layout).toContain("<router-view />");
    expect(layout).not.toContain(":key");
    expect(layout).toContain('import LocaleSwitcher from "../components/LocaleSwitcher.vue";');
  });
});

describe("Svelte — t() and getLocale() read a $state, no remount", () => {
  it("the runes adapter holds the locale as $state; t and getLocale read it first", async () => {
    const files = await generateSystemFiles(system("svelte", "flowbite"), {
      translations: catalogsFor("de"),
    });
    const mod = mustFile(files, "src/lib/locale.svelte.ts");
    expect(mod).toContain("let current = $state(baseGetLocale());");
    expect(mod).toMatch(/subscribe\(\(\) => \{\s*current = baseGetLocale\(\);/);
    expect(mod).toMatch(/export function getLocale\(\): string \{\s*return current;/);
    expect(mod).toMatch(/export function t\([^)]*\): string \{\s*void current;\s*return baseT\(/s);
    expect(file(files, "src/lib/locale.ts")).toBeUndefined();
    const sw = mustFile(files, "src/lib/components/LocaleSwitcher.svelte");
    expect(sw).toContain('data-testid="locale-switcher"');
    expect(sw).toContain("setLocale(e.currentTarget.value);");
    expect(sw).not.toMatch(/tick|focus\(/);
  });

  for (const design of ["flowbite", "shadcnSvelte"]) {
    it(`${design}: the root layout renders its children directly`, async () => {
      const files = await generateSystemFiles(system("svelte", design), {
        translations: catalogsFor("de", "fr"),
      });
      const root = mustFile(files, "src/routes/+layout.svelte");
      expect(root).toContain('import { t } from "$lib/locale.svelte";');
      expect(root).not.toMatch(/\{#key|\$locale/);
      expect(root).toContain("{@render children()}");
    });
  }
});

// ---------------------------------------------------------------------------
// Census: no remount key anywhere, and every `t` / `getLocale` a generated file
// imports comes from the reactive adapter.  Walks EVERY emitted file (pages,
// components, layouts, shell, data-grid children, pack helpers), so a new
// emitter that imports from `i18n` directly fails here.
// ---------------------------------------------------------------------------

const CENSUS_UI = `
      page About {
        route: "/about"
        title: "About us"
        layout: Frame
        state { entries: string[] }
        body: Stack {
          Heading { "All the documents" },
          Timeline { of: entries },
          LocaleSwitcher {}
        }
      }`;

const censusSystem = (platform: "vue" | "svelte", design: string): string =>
  system(platform, design, CENSUS_UI).replace(
    "api DemoApi from S",
    "api DemoApi from S\n    layout Frame {\n      header { LocaleSwitcher {} }\n      main\n    }",
  );

/** Path an import specifier resolves to, relative to the project root. */
const resolveSpec = (importer: string, spec: string): string => {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  if (spec.startsWith("$lib/")) return `src/lib/${spec.slice(5)}`;
  if (!spec.startsWith(".")) return spec;
  const parts = importer.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
};

const REACTIVE_ADAPTER: Record<"vue" | "svelte", string> = {
  vue: "src/lib/locale",
  svelte: "src/lib/locale.svelte",
};
const BASE_RUNTIME: Record<"vue" | "svelte", string> = {
  vue: "src/i18n",
  svelte: "src/lib/i18n",
};
/** Files that may read the base store directly: the runtime, the adapter, the
 *  API client (Accept-Language wants the plain value, not a reactive read). */
const BASE_READERS: Record<"vue" | "svelte", readonly string[]> = {
  vue: ["src/i18n.ts", "src/lib/locale.ts", "src/api/client.ts"],
  svelte: ["src/lib/i18n.ts", "src/lib/locale.svelte.ts", "src/lib/api/client.ts"],
};

/** Every `[names, resolved module]` pair a file's import statements spell. */
const importsOf = (path: string, content: string): Array<{ names: string[]; mod: string }> =>
  [...content.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)].map((m) => ({
    names: (m[1] ?? "").split(",").map((n) => n.trim().split(/\s+as\s+/)[0] ?? ""),
    mod: resolveSpec(path, m[2] ?? "").replace(/\.(ts|js)$/, ""),
  }));

describe("reactive-adapter census — no remount, no direct i18n import of t / getLocale", () => {
  const CENSUS_CELLS = CELLS.filter(
    (c): c is Cell & { platform: "vue" | "svelte" } => c.platform !== "angular",
  );
  for (const c of CENSUS_CELLS) {
    it(`${cellName(c)}: every t / getLocale import comes from the reactive adapter`, async () => {
      const files = await generateSystemFiles(censusSystem(c.platform, c.design), {
        translations: catalogsFor("de", "fr"),
      });
      let fromAdapter = 0;
      for (const [fullPath, content] of files) {
        // Paths are relative to the project root (`web/src/...` -> `src/...`).
        const at = fullPath.indexOf("src/");
        const path = at >= 0 ? fullPath.slice(at) : fullPath;
        // No remount key keyed on the locale.
        expect(content, fullPath).not.toMatch(/:key="locale"|\{#key \$locale\}|\$locale\b/);
        if (!/\.(vue|svelte|ts|tsx)$/.test(path)) continue;
        for (const { names, mod } of importsOf(path, content)) {
          if (!names.some((n) => n === "t" || n === "getLocale")) continue;
          if (mod === BASE_RUNTIME[c.platform]) {
            expect(BASE_READERS[c.platform], `${path} imports t/getLocale from i18n`).toContain(
              path,
            );
          } else if (mod === REACTIVE_ADAPTER[c.platform]) {
            fromAdapter++;
          }
        }
      }
      // Pages, components, layouts, shell, helpers all ride the adapter.
      expect(fromAdapter).toBeGreaterThan(2);
    });

    it(`${cellName(c)}: pack format helpers and the Timeline read the reactive getLocale`, async () => {
      const files = await generateSystemFiles(censusSystem(c.platform, c.design), {
        translations: catalogsFor("de", "fr"),
      });
      const fmt = mustFile(files, "src/lib/format.ts");
      expect(fmt).toContain(
        `import { getLocale } from "./locale${c.platform === "svelte" ? ".svelte" : ""}";`,
      );
      const page = [...files].find(([p]) => p.endsWith("about.vue") || p.includes("about/+page"));
      expect(page?.[1], cellName(c)).toMatch(/toLocaleString\(getLocale\(\)\)/);
      expect(page?.[1], cellName(c)).toMatch(/import \{[^}]*getLocale[^}]*\} from "[^"]*locale/);
    });
  }
});

describe("Angular — every t() and getLocale() call reads a signal", () => {
  it("locale is a signal set from subscribe; t and getLocale read it first", async () => {
    const files = await generateSystemFiles(system("angular", "angularMaterial"), {
      translations: catalogsFor("de"),
    });
    const mod = mustFile(files, "src/lib/locale.ts");
    expect(mod).toContain("export const locale = signal(i18n.getLocale());");
    expect(mod).toContain("i18n.subscribe(() => locale.set(i18n.getLocale()));");
    expect(mod).toMatch(/export function getLocale\(\): string \{\s*return locale\(\);/);
    expect(mod).toMatch(/export function t\([^)]*\): string \{\s*locale\(\);\s*return i18n\.t\(/s);
    const sw = mustFile(files, "src/lib/locale-switcher.ts");
    expect(sw).toContain('selector: "loom-locale-switcher"');
    expect(sw).toContain('data-testid="locale-switcher"');
    expect(sw).toContain("setLocale((e.target as HTMLSelectElement).value)");
  });

  it("pages, the shell, data grids and the 404 import t from the signal-reading module", async () => {
    const files = await generateSystemFiles(system("angular", "angularMaterial"), {
      translations: catalogsFor("de"),
    });
    expect(mustFile(files, "src/app/pages/about.component.ts")).toContain(
      'import { t } from "../../lib/locale";',
    );
    expect(mustFile(files, "src/app/app.component.ts")).toContain(
      'import { t } from "../lib/locale";',
    );
    expect(mustFile(files, "src/app/not-found.component.ts")).toContain(
      'import { t } from "../lib/locale";',
    );
    for (const [path, content] of files) {
      if (path.endsWith(".component.ts") || path.includes("/pages/")) {
        expect(content, path).not.toMatch(/import \{ t \} from "[./]*\/lib\/i18n"/);
      }
    }
  });

  for (const design of ["angularMaterial", "primeng", "spartanNg"]) {
    it(`${design}: the shell registers the switcher and imports t from the signal module`, async () => {
      const files = await generateSystemFiles(system("angular", design), {
        translations: catalogsFor("de", "fr"),
      });
      const shell = mustFile(files, "src/app/app.component.ts");
      expect(shell).toContain('import { LocaleSwitcher } from "../lib/locale-switcher";');
      expect(shell).toMatch(/imports: \[[^\]]*LocaleSwitcher/s);
    });
  }
});

describe("one locale for text, formatting and the API", () => {
  const API_CLIENT: Record<Cell["platform"], string> = {
    vue: "src/api/client.ts",
    svelte: "src/lib/api/client.ts",
    angular: "src/api/client.ts",
  };
  const FORMAT: Record<Cell["platform"], string> = {
    vue: "src/lib/format.ts",
    svelte: "src/lib/format.ts",
    angular: "src/lib/format.ts",
  };
  const CLIENT_IMPORT: Record<Cell["platform"], string> = {
    vue: 'import { getLocale } from "../i18n";',
    svelte: 'import { getLocale } from "../i18n";',
    angular: 'import { getLocale } from "../lib/i18n";',
  };
  const FORMAT_IMPORT: Record<Cell["platform"], string> = {
    vue: 'import { getLocale } from "./locale";',
    svelte: 'import { getLocale } from "./locale.svelte";',
    angular: 'import { getLocale } from "./locale";',
  };

  for (const c of CELLS) {
    it(`${cellName(c)}: Accept-Language on JSON and upload requests; formatters take the active locale`, async () => {
      const files = await generateSystemFiles(system(c.platform, c.design), {
        translations: catalogsFor("de"),
      });
      const client = mustFile(files, API_CLIENT[c.platform]);
      expect(client).toContain(CLIENT_IMPORT[c.platform]);
      expect(client.match(/"accept-language": getLocale\(\)/g)).toHaveLength(2);
      const fmt = mustFile(files, FORMAT[c.platform]);
      expect(fmt).toContain(FORMAT_IMPORT[c.platform]);
      expect(fmt).toContain("toLocaleString(getLocale(),");
      expect(fmt).toContain("Intl.NumberFormat(getLocale(),");
      expect(fmt).not.toContain("(undefined,");
    });

    it(`${cellName(c)}: sets <html dir> under i18n, rtl included`, async () => {
      const ar = await generateSystemFiles(
        system(c.platform, c.design, UI_BODY, '\n  i18n { source: "ar" }'),
      );
      const html =
        c.platform === "angular"
          ? mustFile(ar, "src/index.html")
          : c.platform === "svelte"
            ? mustFile(ar, "src/app.html")
            : mustFile(ar, "index.html");
      expect(html).toContain('<html lang="ar" dir="rtl"');
    });
  }

  for (const platform of ["vue", "svelte", "angular"] as const) {
    it(`${platform}: an app with no strings keeps its output and emits no locale runtime`, async () => {
      const off = `
      page Home { route: "/home" state { q: string = "" } body: Stack { Text { q } } }`;
      const design = { vue: "vuetify", svelte: "flowbite", angular: "angularMaterial" }[platform];
      // The scaffold's own pages carry text, so use a hand-written ui.
      const src = system(platform, design, off)
        .replace("ui Web with scaffold(subdomains: [S]) {", "ui Web {")
        .replace(/\n\s*framework: \w+/, `\n      framework: ${platform}`);
      const files = await generateSystemFiles(src);
      expect(file(files, "src/lib/locale.ts")).toBeUndefined();
      expect(file(files, "src/lib/locale.svelte.ts")).toBeUndefined();
      expect(file(files, API_CLIENT[platform])).not.toContain("accept-language");
      expect(file(files, FORMAT[platform])).toContain("toLocaleString(undefined");
    });
  }
});

describe("LocaleSwitcher primitive", () => {
  const withSwitcher = `
      page About { route: "/about" body: Stack { Heading { "Hello" }, LocaleSwitcher {} } }`;
  const alone = `
      page About { route: "/about" body: Stack { LocaleSwitcher {} } }`;

  it("vue: renders the component and imports it", async () => {
    const files = await generateSystemFiles(system("vue", "vuetify", withSwitcher), {
      translations: catalogsFor("de"),
    });
    const page = mustFile(files, "src/pages/about.vue");
    expect(page).toContain("<LocaleSwitcher />");
    expect(page).toContain('import LocaleSwitcher from "../components/LocaleSwitcher.vue";');
  });

  it("svelte: renders the component and imports it", async () => {
    const files = await generateSystemFiles(system("svelte", "flowbite", withSwitcher), {
      translations: catalogsFor("de"),
    });
    const page = mustFile(files, "about/+page.svelte");
    expect(page).toContain("<LocaleSwitcher />");
    expect(page).toContain('import LocaleSwitcher from "$lib/components/LocaleSwitcher.svelte";');
  });

  it("angular: renders the component and registers it", async () => {
    const files = await generateSystemFiles(system("angular", "angularMaterial", withSwitcher), {
      translations: catalogsFor("de"),
    });
    const page = mustFile(files, "src/app/pages/about.component.ts");
    expect(page).toContain("<loom-locale-switcher />");
    expect(page).toContain('import { LocaleSwitcher } from "../../lib/locale-switcher";');
    expect(page).toMatch(/imports: \[[^\]]*LocaleSwitcher/s);
  });

  for (const [platform, design, runtime] of [
    ["vue", "vuetify", "src/components/LocaleSwitcher.vue"],
    ["svelte", "flowbite", "src/lib/components/LocaleSwitcher.svelte"],
    ["angular", "angularMaterial", "src/lib/locale-switcher.ts"],
  ] as const) {
    it(`${platform}: ships the locale runtime when the switcher is the only i18n-relevant thing`, async () => {
      const src = system(platform, design, alone)
        .replace("ui Web with scaffold(subdomains: [S]) {", "ui Web {")
        .replace(/\n\s*framework: \w+/, `\n      framework: ${platform}`);
      const files = await generateSystemFiles(src);
      expect(file(files, runtime)).toBeDefined();
      expect(file(files, "i18n.ts")).toBeDefined();
    });
  }

  for (const [platform, design] of [
    ["vue", "shadcnVue"],
    ["svelte", "shadcnSvelte"],
    ["angular", "primeng"],
    ["angular", "spartanNg"],
  ] as const) {
    it(`${platform}/${design}: the primitive is no placeholder comment`, async () => {
      const files = await generateSystemFiles(system(platform, design, withSwitcher), {
        translations: catalogsFor("de"),
      });
      for (const [path, content] of files) {
        if (path.includes("/pages/") || path.includes("+page")) {
          expect(content, path).not.toContain("LocaleSwitcher: not yet supported");
        }
      }
    });
  }
});
