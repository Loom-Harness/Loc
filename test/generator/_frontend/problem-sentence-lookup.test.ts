// ---------------------------------------------------------------------------
// The optional per-aggregate problem sentence, client half.
//
// A refusal that concerns one aggregate carries `params.type` (its identity
// key, `C.Doc`), and every frontend localizer tries `<type>.problem.<class>`
// before the generic `problem.<class>`.  The key is OPTIONAL: no catalog
// carries it until a translator writes one (or a `locales/<source>` override
// rewords it), so:
//
//   * the source catalog carries none by default, and an override's key once
//     written;
//   * a translated catalog carries the translator's key beside its generic;
//   * the EMITTED localizer, run against such a catalog, picks the
//     per-aggregate sentence when it exists (override takes effect) and the
//     generic one otherwise (fallback) — executed, not grepped;
//   * Feliz, Flutter and HEEx read the same two-step lookup in their own
//     runtimes (string-level: their toolchains do not run under vitest).
// ---------------------------------------------------------------------------

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { renderGettextCatalog } from "../../../src/generator/elixir/i18n.js";
import { generateSystemFiles } from "../../_helpers/index.js";
import { buildLoomModel } from "../../_helpers/ir.js";

const source = (platform: string, design?: string) => `
  system Demo {
    subdomain S {
      context C {
        aggregate Doc with crudish { name: string }
      }
    }
    api DemoApi from S
    ui Web {
      api Ops: DemoApi
      page Home { route: "/" title: "Welcome" body: Stack { Heading { "All the documents" } } }
    }
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [C], dataSources: [cState], serves: DemoApi, port: 3000 }
    deployable web { platform: ${platform}, targets: api, ui: Web { Ops: api }, ${design ? `design: ${design}, ` : ""}port: 3001 }
  }
`;

/** A scaffolded ui: its forms are what render a refusal on Feliz and Flutter. */
const scaffolded = (platform: string) => `
  system Demo {
    subdomain S {
      context C {
        aggregate Doc with crudish { name: string }
      }
    }
    ui Web with scaffold(subdomains: [S]) { }
    storage loomDb { type: postgres }
    resource cState { for: C, kind: state, use: loomDb }
    deployable api { platform: node, contexts: [C], dataSources: [cState], port: 3000 }
    deployable web { platform: ${platform}, targets: api, ui: Web, port: 3001 }
  }
`;

const DE: Record<string, string> = {
  "problem.not-found": "Nicht gefunden.",
  "problem.version-conflict": "Jemand anderes hat das geändert.",
  "C.Doc.problem.not-found": "Dieses Dokument gibt es nicht.",
};

const OVERRIDES = new Map([
  ["C.Doc.problem.version-conflict", "Someone else edited this document."],
]);

function fileEndingWith(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no emitted file ending ${suffix}`);
  return hit[1];
}

/** Run an emitted TS module's `localizeProblem` against `catalog`: its `t`
 *  import is the catalog lookup the generated runtime performs (the active
 *  locale's message, else the default). */
function emittedLocalizer(
  text: string,
  catalog: Record<string, string>,
): (code: string, fallback: string, params?: Record<string, unknown>) => string {
  const js = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const t = (key: string, fallback: string): string => catalog[key] ?? fallback;
  const exports: Record<string, unknown> = {};
  const require = (): Record<string, unknown> => ({ t });
  new Function("exports", "require", js)(exports, require);
  return exports.localizeProblem as never;
}

describe("per-aggregate problem sentences — catalogs", () => {
  it("the source catalog carries none by default", async () => {
    const files = await generateSystemFiles(source("react", "mantine"));
    const en = JSON.parse(fileEndingWith(files, "web/src/locales/en.json")) as Record<
      string,
      string
    >;
    expect(en["problem.not-found"]).toBeDefined();
    expect(Object.keys(en).filter((k) => /^C\.Doc\.problem\./.test(k))).toEqual([]);
  });

  it("an override's key ships in the source catalog; a translator's key in its locale's", async () => {
    const files = await generateSystemFiles(source("react", "mantine"), {
      translations: new Map([["de", DE]]),
      sourceOverrides: OVERRIDES,
    });
    const en = JSON.parse(fileEndingWith(files, "web/src/locales/en.json")) as Record<
      string,
      string
    >;
    expect(en["C.Doc.problem.version-conflict"]).toBe("Someone else edited this document.");
    expect(en["C.Doc.problem.not-found"]).toBeUndefined();
    const de = JSON.parse(fileEndingWith(files, "web/src/locales/de.json")) as Record<
      string,
      string
    >;
    expect(de["C.Doc.problem.not-found"]).toBe("Dieses Dokument gibt es nicht.");
  });

  it("HEEx: the .po keys a per-aggregate entry by its generic sentence's msgid", async () => {
    const model = await buildLoomModel(source("react", "mantine"));
    const ui = model.systems[0]!.uis[0]!;
    const po = renderGettextCatalog(ui, "po", [], {}, "en", [], DE);
    expect(po).toContain(
      'msgctxt "C.Doc.problem.not-found"\nmsgid "Not found"\nmsgstr "Dieses Dokument gibt es nicht."',
    );
    // No translation, no entry: the key stays optional.
    expect(renderGettextCatalog(ui, "po")).not.toContain("C.Doc.problem.");
  });
});

describe("per-aggregate problem sentences — the emitted localizer", () => {
  for (const [platform, design, path] of [
    ["react", "mantine", "web/src/lib/apply-server-errors.ts"],
    ["angular", "angularMaterial", "web/src/lib/server-errors.ts"],
  ] as const) {
    it(`${platform}: the per-aggregate sentence wins where the catalog has it, else the generic one`, async () => {
      const files = await generateSystemFiles(source(platform, design));
      const localize = emittedLocalizer(fileEndingWith(files, path), DE);
      // Override takes effect.
      expect(localize("problem.not-found", "Doc 7 not found", { type: "C.Doc" })).toBe(
        "Dieses Dokument gibt es nicht.",
      );
      // Fallback: no sentence for this aggregate / this class / no type at all.
      expect(localize("problem.not-found", "Other 7 not found", { type: "C.Other" })).toBe(
        "Nicht gefunden.",
      );
      expect(localize("problem.version-conflict", "Doc 7 was modified", { type: "C.Doc" })).toBe(
        "Jemand anderes hat das geändert.",
      );
      expect(localize("problem.not-found", "Doc 7 not found")).toBe("Nicht gefunden.");
      // A code the catalog lacks keeps the server's English.
      expect(localize("problem.state-gate", "Not allowed", { type: "C.Doc" })).toBe("Not allowed");
    });
  }

  it("feliz + flutter: the localizer probes the active catalog for the aggregate's sentence first", async () => {
    const feliz = await generateSystemFiles(scaffolded("feliz"));
    const fs = [...feliz.values()].join("\n");
    expect(fs).toContain("let has (key: string) : bool =");
    expect(fs).toContain('I18n.has (ty + "." + issue.Code)');
    expect(fs).toContain("try I18n.tf (key issue) issue.Message issue.Params");

    const flutter = await generateSystemFiles(scaffolded("flutter"));
    const dart = [...flutter.values()].join("\n");
    expect(dart).toContain("bool hasMessage(String key) =>");
    expect(dart).toContain("hasMessage('$type.$code')");
    expect(dart).toContain("return t(key, message, params);");
  });
});
