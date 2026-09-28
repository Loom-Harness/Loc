// End-to-end for the `ddd i18n` CLI handlers against a real temp tree:
// extract → init → translate → sync, exercising the file layout and the lock
// lag that makes the three-way merge work.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractCatalog } from "../../src/cli/i18n/extract.js";
import { runI18nCheck, runI18nInit, runI18nStatus, runI18nSync } from "../../src/cli/i18n/index.js";
import { TODO_PREFIX } from "../../src/i18n/merge.js";

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

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-i18n-"));
  ddd = path.join(tmp, "app.ddd");
  dir = path.join(tmp, "locales");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, string>;

describe("ddd i18n — extract/init/sync", () => {
  it("extractCatalog surfaces user-visible page text keyed by content hash", async () => {
    fs.writeFileSync(ddd, SOURCE);
    const catalog = await extractCatalog(ddd);
    const entries = Object.entries(catalog);
    expect(entries.length).toBeGreaterThan(0);
    expect(Object.values(catalog)).toContain("Welcome");
    // Authored page text carries the D-I18N-KEY page-scoped content-hash shape;
    // an i18n-enabled system also merges the app-shell chrome (`chrome.*`) and
    // the active design pack's DECLARED chrome (`pack.<family>.<role>.<hash>`,
    // D-PACK-CHROME) — neither of which is authored page text.
    const pageKeys = entries.filter(([k]) => !k.startsWith("chrome.") && !k.startsWith("pack."));
    expect(pageKeys.every(([k]) => /^page\.Welcome\./.test(k))).toBe(true);
    expect(catalog["chrome.notFound"]).toBe("Not found");
  });

  it("init seeds a TODO locale file + a lock snapshot of the source", async () => {
    fs.writeFileSync(ddd, SOURCE);
    await runI18nInit(ddd, "fr", { dir });

    const fr = readJson(path.join(dir, "fr.json"));
    expect(Object.values(fr).every((v) => v.startsWith(TODO_PREFIX))).toBe(true);

    const lock = readJson(path.join(dir, ".loom", "source.lock.json"));
    expect(Object.values(lock)).toContain("Welcome");
    // lock == source (BASE snapshot), no TODO prefix.
    expect(Object.values(lock).every((v) => !v.startsWith(TODO_PREFIX))).toBe(true);
  });

  it("init leaves an existing locale untouched", async () => {
    fs.writeFileSync(ddd, SOURCE);
    await runI18nInit(ddd, "fr", { dir });
    const frFile = path.join(dir, "fr.json");
    const key = Object.keys(readJson(frFile))[0];
    fs.writeFileSync(frFile, JSON.stringify({ [key]: "Bienvenue" }, null, 2));

    await runI18nInit(ddd, "fr", { dir });
    expect(readJson(frFile)).toEqual({ [key]: "Bienvenue" });
  });

  it("sync keeps a human translation and reports no new work when source is unchanged", async () => {
    fs.writeFileSync(ddd, SOURCE);
    await runI18nInit(ddd, "fr", { dir });
    const frFile = path.join(dir, "fr.json");
    // Provide a human translation for the page string; leave the other keys
    // (the merged app-shell chrome, M-T1.11) as their seeded TODOs so the file
    // is COMPLETE — an unchanged source must then be no new work.
    const seeded = readJson(frFile);
    const key = Object.keys(seeded).find((k) => !k.startsWith("chrome."))!;
    seeded[key] = "Bienvenue";
    fs.writeFileSync(frFile, JSON.stringify(seeded, null, 2));

    await runI18nSync(ddd, { dir });
    expect(readJson(frFile)).toEqual(seeded);
  });

  it("sync adds a fresh TODO when the source grows a new string", async () => {
    fs.writeFileSync(ddd, SOURCE);
    await runI18nInit(ddd, "fr", { dir });
    const frFile = path.join(dir, "fr.json");
    const key = Object.keys(readJson(frFile))[0];
    fs.writeFileSync(frFile, JSON.stringify({ [key]: "Bienvenue" }, null, 2));
    await runI18nSync(ddd, { dir });

    // Add a second user-visible string, re-extract, re-sync.
    fs.writeFileSync(
      ddd,
      SOURCE.replace(
        'Heading { "Welcome" }',
        'Stack { Heading { "Welcome" }, Text { "Sign in" } }',
      ),
    );
    await runI18nSync(ddd, { dir });

    const fr = readJson(frFile);
    expect(fr[key]).toBe("Bienvenue"); // old translation preserved
    const todos = Object.values(fr).filter((v) => v.startsWith(TODO_PREFIX));
    expect(todos).toContain(`${TODO_PREFIX}Sign in`);
  });
});

// ---------------------------------------------------------------------------
// The design-pack family swap, end to end over REAL packs (merge case 5).
//
// `shadcn@v4` and `mui@v7` are both React packs and spell six chrome roles
// identically ("Remove", "Add {item}", "Yes", "No", "This operation has no
// parameters.", "{operation} succeeded"), so swapping one for the other re-keys
// `pack.shadcn.<role>.<h>` -> `pack.mui.<role>.<h>` with the SAME `<h>` - the
// hash of the unchanged English.  shadcn also declares two roles mui does not
// (`closeDialog`, `breadcrumbsLandmark`), which have nowhere to carry to and
// must still drop.
//
// Nothing here is hand-built: the keys come out of the real extraction, so the
// test fails if the key shape, the pack manifests or the extraction path move.
// ---------------------------------------------------------------------------

/** The same system, rendered through one design pack or the other. */
const withDesign = (design: string) => `
  system S {
    subdomain M { context C { } }
    ui WebApp {
      page Welcome {
        route: "/welcome"
        body:  Heading { "Welcome" }
      }
    }
    deployable api { platform: node, contexts: [C], port: 3000 }
    deployable web { platform: static, targets: api, ui: WebApp, design: "${design}", port: 3001 }
  }
`;

const packKeys = (c: Record<string, string>, family: string) =>
  Object.keys(c).filter((k) => k.startsWith(`pack.${family}.`));

/** `pack.<family>.<role>.<hash>` -> `<role>.<hash>` - the carry identity. */
const identity = (key: string) => key.split(".").slice(2).join(".");

describe("ddd i18n sync - design-pack family swap", () => {
  it("carries finished translations from shadcn's keys onto mui's on a pack swap", async () => {
    fs.writeFileSync(ddd, withDesign("shadcn@v4"));
    await runI18nInit(ddd, "de", { dir });
    const deFile = path.join(dir, "de.json");

    // The pack's chrome really is in the catalog under the shadcn family.
    const seeded = readJson(deFile);
    const shadcnKeys = packKeys(seeded, "shadcn");
    expect(shadcnKeys.length).toBeGreaterThan(0);

    // Translate every shadcn chrome string (and nothing else, so the assertions
    // below can't be satisfied by some other key's value).
    for (const k of shadcnKeys) seeded[k] = `DE(${identity(k)})`;
    fs.writeFileSync(deFile, JSON.stringify(seeded, null, 2));
    await runI18nSync(ddd, { dir });

    // Swap the design pack. Nothing else about the model changes.
    fs.writeFileSync(ddd, withDesign("mui@v7"));
    const after = await extractCatalog(ddd);
    const muiKeys = packKeys(after, "mui");
    expect(muiKeys.length).toBeGreaterThan(0);
    expect(packKeys(after, "shadcn")).toEqual([]);

    await runI18nSync(ddd, { dir });
    const de = readJson(deFile);

    // Every mui key whose (role, hash) shadcn also had keeps the human wording.
    const shadcnIdentities = new Set(shadcnKeys.map(identity));
    const shared = muiKeys.filter((k) => shadcnIdentities.has(identity(k)));
    expect(shared.length).toBeGreaterThan(0);
    for (const k of shared) {
      expect(de[k]).toBe(`DE(${identity(k)})`);
      expect(de[k].startsWith(TODO_PREFIX)).toBe(false);
    }

    // The old family's keys are gone from the locale file.
    expect(packKeys(de, "shadcn")).toEqual([]);

    // A role only shadcn declared has nowhere to carry to: it is simply gone,
    // not smuggled onto some other key.
    const orphaned = shadcnKeys.filter((k) => !muiKeys.some((m) => identity(m) === identity(k)));
    expect(orphaned.length).toBeGreaterThan(0);
    for (const k of orphaned) {
      expect(Object.values(de)).not.toContain(`DE(${identity(k)})`);
    }
  });

  it("a REPHRASED pack string still re-keys to a TODO rather than carrying", async () => {
    // Same swap, but the donor's BASE English is doctored to a different
    // wording. The hash on THEIRS then belongs to a message the translator
    // never saw, and the merge must refuse to move their words onto it - the
    // property that keeps case 5 from becoming "translate once, reuse forever".
    fs.writeFileSync(ddd, withDesign("shadcn@v4"));
    await runI18nInit(ddd, "de", { dir });
    const deFile = path.join(dir, "de.json");
    const lockFile = path.join(dir, ".loom", "source.lock.json");

    const seeded = readJson(deFile);
    const shadcnKeys = packKeys(seeded, "shadcn");
    for (const k of shadcnKeys) seeded[k] = `DE(${identity(k)})`;
    fs.writeFileSync(deFile, JSON.stringify(seeded, null, 2));
    await runI18nSync(ddd, { dir });

    const lock = readJson(lockFile);
    for (const k of shadcnKeys) lock[k] = `REPHRASED ${lock[k]}`;
    fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2));

    fs.writeFileSync(ddd, withDesign("mui@v7"));
    await runI18nSync(ddd, { dir });

    const de = readJson(deFile);
    const muiKeys = packKeys(de, "mui");
    expect(muiKeys.length).toBeGreaterThan(0);
    for (const k of muiKeys) {
      expect(de[k].startsWith(TODO_PREFIX)).toBe(true);
    }
  });

  it("status and `check --strict` stay truthful either side of the swap", async () => {
    // `process.exit` is the non-zero signal both commands use, and in both it
    // is the LAST statement - so recording it instead of exiting leaves the
    // command's behaviour intact.
    const exits: (number | undefined)[] = [];
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      exits.push(code);
      return undefined;
    }) as never);
    try {
      fs.writeFileSync(ddd, withDesign("shadcn@v4"));
      await runI18nInit(ddd, "de", { dir });
      const deFile = path.join(dir, "de.json");

      // Translate EVERYTHING, so the only thing the swap can disturb is the
      // pack chrome.
      const seeded = readJson(deFile);
      for (const k of Object.keys(seeded)) seeded[k] = `DE(${k})`;
      fs.writeFileSync(deFile, JSON.stringify(seeded, null, 2));
      await runI18nSync(ddd, { dir });

      exits.length = 0;
      await runI18nStatus(ddd, { dir });
      await runI18nCheck(ddd, { dir, strict: true });
      expect(exits).toEqual([]); // complete + reconciled

      // Swap the pack. The keys move, so there IS pending work until sync runs.
      fs.writeFileSync(ddd, withDesign("mui@v7"));
      exits.length = 0;
      await runI18nStatus(ddd, { dir });
      await runI18nCheck(ddd, { dir, strict: true });
      expect(exits).toEqual([1, 1]); // pending, and keys missing from the file

      await runI18nSync(ddd, { dir });

      // After the carry-over the file is complete again - no TODO, no
      // conflict, no missing key. A carried value must NOT read as untranslated
      // or as a conflict, or this gate would go red for a finished locale.
      exits.length = 0;
      await runI18nStatus(ddd, { dir });
      await runI18nCheck(ddd, { dir, strict: true });
      expect(exits).toEqual([]);
    } finally {
      exit.mockRestore();
    }
  });
});
