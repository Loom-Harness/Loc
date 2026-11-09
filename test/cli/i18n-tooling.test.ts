// End-to-end for the translator tooling: `check` validating ICU / placeholders /
// plural forms, the out-of-band untranslated + needs-review state (and the
// migration of legacy `TODO:` trees), XLIFF / PO export + import, and the
// `en-XA` pseudo-locale.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractCatalog } from "../../src/cli/i18n/extract.js";
import {
  runI18nApprove,
  runI18nCheck,
  runI18nExport,
  runI18nImport,
  runI18nInit,
  runI18nStatus,
  runI18nSync,
} from "../../src/cli/i18n/index.js";
import { readNamespaceDir, writeNamespaceDir } from "../../src/cli/i18n/tree.js";
import { conflictMarker, TODO_PREFIX } from "../../src/i18n/merge.js";
import { joinCatalog, splitCatalog } from "../../src/i18n/namespace.js";
import { PSEUDO_LOCALE } from "../../src/i18n/pseudo.js";

// The app-shell chrome carries ICU holes ("Page {page} of {pages}"), which the check compares.
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
    deployable web { platform: static, targets: api, ui: WebApp, design: "shadcn@v4", port: 3001 }
  }
`;

const NAMES = new Set(["C", "WebApp"]);

let tmp: string;
let ddd: string;
let dir: string;
let exits: (number | undefined)[];
let logs: string[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-i18n-tooling-"));
  ddd = path.join(tmp, "app.ddd");
  dir = path.join(tmp, "locales");
  fs.writeFileSync(ddd, SOURCE);
  exits = [];
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    logs.push(a.join(" "));
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code);
    return undefined;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const readLocale = (locale: string) => joinCatalog(readNamespaceDir(path.join(dir, locale)));
const writeLocale = (locale: string, flat: Record<string, string>) =>
  writeNamespaceDir(path.join(dir, locale), splitCatalog(flat, NAMES));
const text = () => logs.join("\n");

/** Runtime key of the chrome string whose source is exactly `message`. */
async function keyOf(message: string): Promise<string> {
  const catalog = await extractCatalog(ddd);
  const key = Object.keys(catalog).find((k) => catalog[k] === message);
  if (!key) throw new Error(`no source string ${JSON.stringify(message)}`);
  return key;
}

/** Translate the whole source `DE <english>`, so a locale is complete + valid. */
async function translateAll(locale: string, prefix = "DE "): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(await extractCatalog(ddd))) out[k] = `${prefix}${v}`;
  writeLocale(locale, out);
  return out;
}

describe("check — ICU, placeholders, plural forms", () => {
  it("a placeholder renamed by the translator fails --strict and names the key", async () => {
    await runI18nInit(ddd, "es", { dir });
    const full = await translateAll("es", "ES ");
    const add = await keyOf("Page {page} of {pages}");
    writeLocale("es", { ...full, [add]: "Página {número} de {pages}" });
    await runI18nSync(ddd, { dir });

    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([1]);
    expect(text()).toContain("invalid");
    expect(text()).toContain(`${add}: placeholder {page} from the source is missing`);
    expect(text()).toContain("placeholder {número} is not in the source");
  });

  it("broken ICU syntax fails --strict", async () => {
    await runI18nInit(ddd, "es", { dir });
    const full = await translateAll("es", "ES ");
    const add = await keyOf("Page {page} of {pages}");
    writeLocale("es", { ...full, [add]: "Página {page de {pages}" });
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([1]);
    expect(text()).toContain("invalid ICU");
  });

  it("a complete, valid locale passes --strict", async () => {
    await runI18nInit(ddd, "es", { dir });
    await translateAll("es", "ES ");
    await runI18nSync(ddd, { dir });
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([]);
    expect(text()).toContain("es: ok");
  });

  it("requires the plural forms the locale needs (Polish)", async () => {
    await runI18nInit(ddd, "pl", { dir });
    const full = await translateAll("pl", "PL ");
    const add = await keyOf("Page {page} of {pages}");
    writeLocale("pl", { ...full, [add]: "{page, plural, one {a} other {b}} {pages}" });
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([1]);
    expect(text()).toContain('lacks the "few" form');
    expect(text()).toContain('lacks the "many" form');

    exits.length = 0;
    writeLocale("pl", {
      ...full,
      [add]: "{page, plural, one {a} few {b} many {c} other {d}} {pages}",
    });
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([]);
  });

  it("reports keys the source no longer emits", async () => {
    await runI18nInit(ddd, "es", { dir });
    const full = await translateAll("es", "ES ");
    writeLocale("es", { ...full, "WebApp.page.Gone.heading.zzzzzz": "Huérfano" });
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([1]);
    expect(text()).toContain("obsolete:     WebApp.page.Gone.heading.zzzzzz");
  });

  it("--strict with no locale files at all fails instead of passing vacuously", async () => {
    await runI18nCheck(ddd, { dir });
    expect(exits).toEqual([]);
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([1]);
  });
});

describe("untranslated and needs-review live out of band", () => {
  it("a new locale and a synced locale hold no TODO values — untranslated is absence", async () => {
    await runI18nInit(ddd, "fr", { dir });
    await runI18nSync(ddd, { dir });
    expect(readLocale("fr")).toEqual({});
    await runI18nStatus(ddd, { dir }); // settled: nothing pending
    expect(exits).toEqual([]);

    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([1]);
    expect(text()).toContain("untranslated");
  });

  it("a source change over a translation keeps the value clean and flags it in the sidecar; approve clears it", async () => {
    await runI18nInit(ddd, "fr", { dir });
    await translateAll("fr", "FR ");
    await runI18nSync(ddd, { dir });

    // Move the English under the translation by editing the lock (BASE).
    const lockDir = path.join(dir, ".loom", "source.lock");
    const lock = joinCatalog(readNamespaceDir(lockDir));
    const notFound = "chrome.notFound";
    writeNamespaceDir(lockDir, splitCatalog({ ...lock, [notFound]: "Page missing" }, NAMES));
    await runI18nSync(ddd, { dir });

    expect(readLocale("fr")[notFound]).toBe("FR Not found");
    const flags = JSON.parse(
      fs.readFileSync(path.join(dir, ".loom", "review", "fr", "_chrome.json"), "utf8"),
    );
    expect(flags[notFound]).toMatchObject({ previousSource: "Page missing", source: "Not found" });

    exits.length = 0;
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([1]);
    expect(text()).toContain(`needs review: ${notFound}`);

    exits.length = 0;
    await runI18nApprove(ddd, [], { dir });
    expect(fs.existsSync(path.join(dir, ".loom", "review", "fr"))).toBe(false);
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([]);
  });

  it("editing a flagged translation clears the flag without approve", async () => {
    await runI18nInit(ddd, "fr", { dir });
    const full = await translateAll("fr", "FR ");
    await runI18nSync(ddd, { dir });
    const lockDir = path.join(dir, ".loom", "source.lock");
    const lock = joinCatalog(readNamespaceDir(lockDir));
    writeNamespaceDir(lockDir, splitCatalog({ ...lock, "chrome.notFound": "Page missing" }, NAMES));
    await runI18nSync(ddd, { dir });

    writeLocale("fr", { ...full, "chrome.notFound": "FR Introuvable" });
    await runI18nSync(ddd, { dir });
    expect(fs.existsSync(path.join(dir, ".loom", "review", "fr"))).toBe(false);
  });

  it("a legacy TODO / conflict-marker / _stale tree migrates cleanly through sync", async () => {
    await runI18nInit(ddd, "de", { dir });
    const catalog = await extractCatalog(ddd);
    const keys = Object.keys(catalog);
    const done = "chrome.notFound";
    const todo = keys.find((k) => k !== done && !k.includes("{"))!;
    const legacy: Record<string, string> = {
      [done]: "Nicht gefunden",
      [todo]: `${TODO_PREFIX}${catalog[todo]}`,
      "_stale.page.Old.heading.zzzzzz": "Alt",
    };
    writeLocale("de", legacy);
    // Park a conflict block on a second real key.
    const conflicted = keys.find((k) => k !== done && k !== todo && !catalog[k]!.includes("{"))!;
    writeLocale("de", {
      ...legacy,
      [conflicted]: conflictMarker("Meins", "Old source", catalog[conflicted]!),
    });
    // Lock is current, so only the markers need migrating.
    writeNamespaceDir(path.join(dir, ".loom", "source.lock"), splitCatalog(catalog, NAMES));

    await runI18nStatus(ddd, { dir });
    expect(exits).toEqual([1]); // legacy markers are pending work
    expect(text()).toContain("in-band marker");

    exits.length = 0;
    await runI18nSync(ddd, { dir });
    const de = readLocale("de");
    expect(de[done]).toBe("Nicht gefunden");
    expect(todo in de).toBe(false); // TODO value became absence
    expect(de[conflicted]).toBe("Meins"); // conflict block became the OURS value
    expect(Object.values(de).some((v) => v.startsWith(TODO_PREFIX) || v.includes("<<<<<<<"))).toBe(
      false,
    );
    expect(Object.keys(de).some((k) => k.startsWith("_stale."))).toBe(false);
    const flags = JSON.parse(
      fs.readFileSync(
        path.join(
          dir,
          ".loom",
          "review",
          "de",
          `${conflicted.split(".")[0] === "WebApp" ? "WebApp" : "_chrome"}.json`,
        ),
        "utf8",
      ),
    );
    expect(Object.values(flags)[0]).toMatchObject({
      translation: "Meins",
      previousSource: "Old source",
    });
    const stale = readNamespaceDir<string>(path.join(dir, ".loom", "stale", "de"));
    expect(JSON.stringify([...stale])).toContain("Alt");

    // Idempotent, and no longer pending.
    const before = JSON.stringify(readLocale("de"));
    await runI18nSync(ddd, { dir });
    expect(JSON.stringify(readLocale("de"))).toBe(before);
    exits.length = 0;
    await runI18nStatus(ddd, { dir });
    expect(exits).toEqual([]);
  });
});

describe("export / import", () => {
  it.each([
    ["xliff", "de.xlf"],
    ["po", "de.po"],
  ] as const)("%s: exports every unit with state + context, and imports a translated file back", async (format, name) => {
    await runI18nInit(ddd, "de", { dir });
    const notFound = "chrome.notFound";
    writeLocale("de", { [notFound]: "Nicht gefunden" });
    await runI18nSync(ddd, { dir });

    const out = path.join(tmp, name);
    await runI18nExport(ddd, { dir, locale: "de", format, out });
    const body = fs.readFileSync(out, "utf8");
    const catalog = await extractCatalog(ddd);
    for (const k of Object.keys(catalog)) expect(body).toContain(k);
    expect(body).toContain("Nicht gefunden");
    expect(body).toContain("family: chrome");

    // A translator fills in the heading in the exchange file.
    const headingKey = await keyOf("Welcome");
    const edited =
      format === "xliff"
        ? body.replace(
            new RegExp(`(<trans-unit id="${headingKey}"[^>]*>\\s*<source>Welcome</source>)`),
            '$1\n<target state="translated">Willkommen</target>',
          )
        : body.replace(
            new RegExp(`(msgctxt "${headingKey}"\\nmsgid "Welcome"\\nmsgstr )""`),
            '$1"Willkommen"',
          );
    expect(edited).not.toBe(body);
    fs.writeFileSync(out, edited);

    await runI18nImport(ddd, out, { dir });
    expect(exits).toEqual([]);
    expect(readLocale("de")[headingKey]).toBe("Willkommen");
    expect(readLocale("de")[notFound]).toBe("Nicht gefunden");

    // Re-importing the same file changes nothing.
    const before = JSON.stringify(readLocale("de"));
    await runI18nImport(ddd, out, { dir });
    expect(JSON.stringify(readLocale("de"))).toBe(before);
    expect(text()).toContain("0 translation(s)");
  });

  it("import rejects units with invalid ICU / placeholders and writes the rest", async () => {
    await runI18nInit(ddd, "es", { dir });
    const add = await keyOf("Page {page} of {pages}");
    const heading = await keyOf("Welcome");
    const out = path.join(tmp, "es.xlf");
    await runI18nExport(ddd, { dir, locale: "es", format: "xliff", out });
    let xml = fs.readFileSync(out, "utf8");
    const fill = (id: string, value: string) => {
      xml = xml.replace(
        new RegExp(`(<trans-unit id="${id}"[^>]*>\\s*<source>[^<]*</source>)`),
        `$1<target state="translated">${value}</target>`,
      );
    };
    fill(add, "Página {número} de {pages}");
    fill(heading, "Bienvenido");
    fs.writeFileSync(out, xml);

    await runI18nImport(ddd, out, { dir });
    expect(exits).toEqual([1]);
    expect(text()).toContain(`rejected: ${add}: placeholder {page} from the source is missing`);
    const es = readLocale("es");
    expect(es[heading]).toBe("Bienvenido");
    expect(add in es).toBe(false);
  });

  it("a needs-review unit exports its previous source/translation and imports as flagged", async () => {
    await runI18nInit(ddd, "fr", { dir });
    await translateAll("fr", "FR ");
    await runI18nSync(ddd, { dir });
    const lockDir = path.join(dir, ".loom", "source.lock");
    const lock = joinCatalog(readNamespaceDir(lockDir));
    writeNamespaceDir(lockDir, splitCatalog({ ...lock, "chrome.notFound": "Page missing" }, NAMES));
    await runI18nSync(ddd, { dir });

    const out = path.join(tmp, "fr.po");
    await runI18nExport(ddd, { dir, locale: "fr", format: "po", out });
    const po = fs.readFileSync(out, "utf8");
    expect(po).toMatch(/#, fuzzy\n#\| msgid "Page missing"\nmsgctxt "chrome.notFound"/);

    // Approving, then importing the still-fuzzy file, re-flags it.
    await runI18nApprove(ddd, [], { dir });
    await runI18nImport(ddd, out, { dir });
    expect(fs.existsSync(path.join(dir, ".loom", "review", "fr", "_chrome.json"))).toBe(true);
  });

  it("export of a re-keyed string carries the previous source", async () => {
    await runI18nInit(ddd, "fr", { dir });
    const heading = await keyOf("Welcome");
    const prefix = heading.slice(0, heading.lastIndexOf("."));
    const oldKey = `${prefix}.aaaaaa`;
    const lockDir = path.join(dir, ".loom", "source.lock");
    const lock = joinCatalog(readNamespaceDir(lockDir));
    const { [heading]: _dropped, ...rest } = lock;
    writeNamespaceDir(lockDir, splitCatalog({ ...rest, [oldKey]: "Hello" }, NAMES));
    writeLocale("fr", { [oldKey]: "Bonjour" });
    await runI18nSync(ddd, { dir });

    const out = path.join(tmp, "fr.xlf");
    await runI18nExport(ddd, { dir, locale: "fr", format: "xliff", out });
    const xml = fs.readFileSync(out, "utf8");
    expect(xml).toContain('<note from="loom-previous-source">Hello</note>');
    expect(xml).toContain('<note from="loom-previous-translation">Bonjour</note>');
  });
});

describe("pseudo-locale en-XA", () => {
  it("init generates a full accented catalog, sync keeps it current, check stays green", async () => {
    await runI18nInit(ddd, PSEUDO_LOCALE, { dir });
    const catalog = await extractCatalog(ddd);
    const xa = readLocale(PSEUDO_LOCALE);
    expect(Object.keys(xa)).toEqual(Object.keys(catalog));
    const heading = await keyOf("Welcome");
    expect(xa[heading]).toMatch(/^\[.*~+\]$/);
    expect(xa[heading]).not.toContain("Welcome");

    await runI18nStatus(ddd, { dir });
    await runI18nCheck(ddd, { dir, strict: true });
    expect(exits).toEqual([]);

    // The source grows: sync regenerates (no translator involved), status notices first.
    fs.writeFileSync(ddd, SOURCE.replace('Heading { "Welcome" }', 'Heading { "Welcome back" }'));
    await runI18nStatus(ddd, { dir });
    expect(exits).toEqual([1]);
    await runI18nSync(ddd, { dir });
    const after = readLocale(PSEUDO_LOCALE);
    expect(Object.keys(after)).toEqual(Object.keys(await extractCatalog(ddd)));
    expect(Object.values(after).some((v) => v.includes("Welcome back"))).toBe(false);
  });
});
