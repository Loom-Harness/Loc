// The translator tree's on-disk layout (locales/<locale>/<ns>.json), the move
// off the flat layout, and the source language's override files.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractCatalog } from "../../src/cli/i18n/extract.js";
import {
  loadSourceOverrides,
  loadTranslations,
  runI18nCheck,
  runI18nInit,
  runI18nPrune,
  runI18nStatus,
  runI18nSync,
} from "../../src/cli/i18n/index.js";
import { readNamespaceDir } from "../../src/cli/i18n/tree.js";
import { hasConflictMarkers, TODO_PREFIX } from "../../src/i18n/merge.js";
import { generateSystemFiles } from "../_helpers/index.js";

const SOURCE = `
  system S {
    subdomain M { context C { } }
    ui WebApp {
      page Welcome {
        route: "/welcome"
        body:  Heading { "Welcome" }
      }
    }
    deployable api { platform: node, contexts: [C], port: 3000 }
    deployable web { platform: static, targets: api, ui: WebApp, port: 3001 }
  }
`;

let tmp: string;
let ddd: string;
let dir: string;
let exits: (number | undefined)[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-i18n-layout-"));
  ddd = path.join(tmp, "app.ddd");
  dir = path.join(tmp, "locales");
  fs.writeFileSync(ddd, SOURCE);
  exits = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code);
    return undefined;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, string>;
const writeJson = (p: string, v: unknown) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
};

/** The runtime key of the page heading, and its file spelling. */
async function headingKey(): Promise<{ runtime: string; file: string }> {
  const catalog = await extractCatalog(ddd);
  const runtime = Object.keys(catalog).find((k) => catalog[k] === "Welcome")!;
  return { runtime, file: runtime.replace(/^WebApp\./, "") };
}

/** Every file under `root`, relative, with its content — a whole-tree snapshot. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full)] = fs.readFileSync(full, "utf8");
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

describe("locales/<locale>/<ns>.json layout", () => {
  it("files authored keys under their ui, chrome verbatim, and the lock in the same shape", async () => {
    await runI18nInit(ddd, "de", { dir });
    expect(fs.readdirSync(path.join(dir, "de")).sort()).toEqual(["WebApp.json", "_chrome.json"]);
    expect(fs.readdirSync(path.join(dir, ".loom", "source.lock")).sort()).toEqual([
      "WebApp.json",
      "_chrome.json",
    ]);
    const { file } = await headingKey();
    // No ui prefix inside the ui's own file; the chrome keeps its full key.
    expect(Object.keys(readJson(path.join(dir, "de", "WebApp.json")))).toContain(file);
    expect(Object.keys(readJson(path.join(dir, "de", "_chrome.json")))).toContain(
      "chrome.notFound",
    );
    expect(
      Object.keys(readJson(path.join(dir, "de", "_chrome.json"))).every(
        (k) => !k.startsWith("WebApp."),
      ),
    ).toBe(true);
  });

  it("generate reads the split tree: finished values ship, TODOs do not", async () => {
    await runI18nInit(ddd, "de", { dir });
    const { runtime, file } = await headingKey();
    const webApp = path.join(dir, "de", "WebApp.json");
    writeJson(webApp, { ...readJson(webApp), [file]: "Willkommen" });

    const translations = loadTranslations(ddd, { dir });
    expect([...translations.keys()]).toEqual(["de"]);
    expect(translations.get("de")).toEqual({ [runtime]: "Willkommen" });

    const files = await generateSystemFiles(SOURCE, { translations });
    const de = [...files].find(([p]) => p.endsWith("src/locales/de.json"))![1];
    expect(JSON.parse(de)).toMatchObject({ [runtime]: "Willkommen" });
  });
});

describe("flat -> split migration", () => {
  /** A project as the flat layout left it: legacy (ui-less) page keys. */
  async function writeFlatTree() {
    const catalog = await extractCatalog(ddd);
    const legacy = (k: string) => k.replace(/^WebApp\./, "");
    const lock: Record<string, string> = {};
    const de: Record<string, string> = {};
    for (const [k, v] of Object.entries(catalog)) {
      lock[legacy(k)] = v;
      de[legacy(k)] = v === "Welcome" ? "Willkommen" : `DE(${v})`;
    }
    writeJson(path.join(dir, "de.json"), de);
    writeJson(path.join(dir, ".loom", "source.lock.json"), lock);
    return { catalog };
  }

  it("rewrites a flat tree, keeps the translations, and is idempotent", async () => {
    await writeFlatTree();
    const { runtime, file } = await headingKey();

    await runI18nSync(ddd, { dir });

    expect(fs.existsSync(path.join(dir, "de.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, ".loom", "source.lock.json"))).toBe(false);
    expect(readJson(path.join(dir, "de", "WebApp.json"))[file]).toBe("Willkommen");
    // The translation was carried, not re-requested.
    const joined = Object.assign(
      {},
      ...[...readNamespaceDir(path.join(dir, "de")).values()],
    ) as Record<string, string>;
    expect(Object.values(joined).some((v) => v.startsWith(TODO_PREFIX))).toBe(false);
    expect(runtime).toMatch(/^WebApp\./);
    expect(exits).toEqual([]);

    const first = snapshot(dir);
    await runI18nSync(ddd, { dir });
    expect(snapshot(dir)).toEqual(first);
  });

  it("status reports the pending layout migration, then none after sync", async () => {
    await writeFlatTree();
    await runI18nStatus(ddd, { dir });
    expect(exits).toEqual([1]);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("layout:");

    await runI18nSync(ddd, { dir });
    exits.length = 0;
    await runI18nStatus(ddd, { dir });
    expect(exits).toEqual([]);
  });

  it("refuses a locale present in both layouts", async () => {
    await writeFlatTree();
    writeJson(path.join(dir, "de", "_chrome.json"), { "chrome.notFound": "Nicht gefunden" });
    await expect(runI18nSync(ddd, { dir })).rejects.toThrow(/both exist/);
    // Nothing was touched.
    expect(fs.existsSync(path.join(dir, "de.json"))).toBe(true);
  });

  it("refuses a lock present in both layouts", async () => {
    await runI18nInit(ddd, "de", { dir });
    writeJson(path.join(dir, ".loom", "source.lock.json"), {});
    await expect(runI18nSync(ddd, { dir })).rejects.toThrow(/Lock layout conflict/);
  });
});

describe("source-language overrides", () => {
  /** init de, translate the heading, sync: a finished German catalog. */
  async function germanTree() {
    await runI18nInit(ddd, "de", { dir });
    const { file } = await headingKey();
    const webApp = path.join(dir, "de", "WebApp.json");
    writeJson(webApp, { ...readJson(webApp), [file]: "Willkommen" });
    await runI18nSync(ddd, { dir });
    return { file, webApp };
  }

  it("init of the source language scaffolds nothing", async () => {
    await runI18nInit(ddd, "en", { dir });
    expect(fs.existsSync(path.join(dir, "en"))).toBe(false);
    await runI18nInit(ddd, "de", { dir });
    expect(fs.existsSync(path.join(dir, "en"))).toBe(false);
  });

  it("an override changes the extracted source text and the generated default", async () => {
    const { runtime, file } = await headingKey();
    writeJson(path.join(dir, "en", "WebApp.json"), { [file]: "Hello there" });

    const catalog = await extractCatalog(ddd);
    expect(catalog[runtime]).toBe("Hello there");

    const overrides = loadSourceOverrides(ddd, { dir });
    expect([...overrides]).toEqual([[runtime, "Hello there"]]);
    const files = await generateSystemFiles(SOURCE, { sourceOverrides: overrides });
    const page = [...files].find(([p]) => p.endsWith("welcome.tsx"))![1];
    expect(page).toContain(`t(${JSON.stringify(runtime)}, "Hello there")`);
    expect(page).not.toContain('"Welcome"');
    const en = [...files].find(([p]) => p.endsWith("src/locales/en.json"))![1];
    expect(JSON.parse(en)[runtime]).toBe("Hello there");
    const messages = [...files].find(([p]) => p.endsWith(".loom/messages.en.json"))![1];
    expect(JSON.parse(messages)[runtime]).toBe("Hello there");
    // Without the overrides nothing leaks between runs.
    const plain = await generateSystemFiles(SOURCE);
    expect([...plain].find(([p]) => p.endsWith("welcome.tsx"))![1]).toContain('"Welcome"');
  });

  it("sync flags the German translation when the English override changes", async () => {
    const { file, webApp } = await germanTree();
    expect(readJson(webApp)[file]).toBe("Willkommen");

    writeJson(path.join(dir, "en", "WebApp.json"), { [file]: "Hello there" });
    await runI18nSync(ddd, { dir });

    const value = readJson(webApp)[file];
    expect(hasConflictMarkers(value)).toBe(true);
    expect(value).toContain("Willkommen");
    expect(value).toContain("Welcome");
    expect(value).toContain("Hello there");
    expect(exits).toEqual([1]);
    // The source directory is never merged: it still holds only the override.
    expect(readJson(path.join(dir, "en", "WebApp.json"))).toEqual({ [file]: "Hello there" });
    expect(fs.existsSync(path.join(dir, "en", "_chrome.json"))).toBe(false);
  });

  it("an unfinished or conflicted override value is not applied", async () => {
    const { file } = await headingKey();
    writeJson(path.join(dir, "en", "WebApp.json"), { [file]: `${TODO_PREFIX}Hello` });
    expect(loadSourceOverrides(ddd, { dir }).size).toBe(0);
  });

  it("check reports an override the source no longer emits, prune removes it", async () => {
    const { file } = await headingKey();
    writeJson(path.join(dir, "en", "WebApp.json"), {
      [file]: "Hello there",
      "page.Gone.heading.zzzzzz": "Orphan",
    });
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([1]);
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain(
      "stale override: WebApp.page.Gone.heading.zzzzzz",
    );

    exits.length = 0;
    await runI18nPrune(ddd, { dir });
    expect(readJson(path.join(dir, "en", "WebApp.json"))).toEqual({ [file]: "Hello there" });
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([]);
  });

  it("a flat en.json migrates into en/ as overrides, minus unfinished entries", async () => {
    await runI18nInit(ddd, "de", { dir });
    const { runtime, file } = await headingKey();
    writeJson(path.join(dir, "en.json"), {
      [file]: "Hello there",
      "chrome.notFound": `${TODO_PREFIX}Not found`,
    });
    // Legacy flat source keys carry no ui prefix; the migration files them.
    await runI18nSync(ddd, { dir });
    expect(fs.existsSync(path.join(dir, "en.json"))).toBe(false);
    expect(readJson(path.join(dir, "en", "WebApp.json"))).toEqual({ [file]: "Hello there" });
    expect(fs.existsSync(path.join(dir, "en", "_chrome.json"))).toBe(false);
    expect((await extractCatalog(ddd, { dir }))[runtime]).toBe("Hello there");
  });
});
