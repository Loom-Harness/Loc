// The optional per-aggregate problem sentences (`<Ctx>.<Type>.problem.<class>`)
// through the `ddd i18n` CLI: the source never derives them, so a translator
// (or a source override) adds one, and `check` / `sync` / `prune` must treat
// it as a known optional key — not obsolete, not dropped — while still
// holding it to the generic sentence's placeholders, and `sync` carries it
// across a rename of its aggregate.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractProject } from "../../src/cli/i18n/extract.js";
import { runI18nCheck, runI18nInit, runI18nPrune, runI18nSync } from "../../src/cli/i18n/index.js";
import { readNamespaceDir, writeNamespaceDir } from "../../src/cli/i18n/tree.js";
import { joinCatalog, splitCatalog } from "../../src/i18n/namespace.js";

const source = (agg: string, migration = "") => `
  system S {
    subdomain M {
      context C {
        aggregate ${agg} with crudish { qty: int }
      }
    }
    ui WebApp with scaffold(subdomains: [M]) { }
    deployable api { platform: node, contexts: [C], port: 3000 }
    deployable web { platform: static, targets: api, ui: WebApp, port: 3001 }
  }
  ${migration}
`;

let tmp: string;
let ddd: string;
let dir: string;
let logged: string[];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loom-i18n-problem-"));
  ddd = path.join(tmp, "app.ddd");
  dir = path.join(tmp, "locales");
  logged = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logged.push(args.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const NAMES = new Set(["C", "WebApp"]);
const readLocale = (locale: string) => joinCatalog(readNamespaceDir(path.join(dir, locale)));
const writeLocale = (locale: string, flat: Record<string, string>) =>
  writeNamespaceDir(path.join(dir, locale), splitCatalog(flat, NAMES));

/** Run `fn` with `process.exit` recorded instead of taken. */
async function exitsOf(fn: () => Promise<void>): Promise<(number | undefined)[]> {
  const exits: (number | undefined)[] = [];
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exits.push(code);
    return undefined;
  }) as typeof process.exit);
  try {
    await fn();
  } finally {
    exit.mockRestore();
  }
  return exits;
}

describe("ddd i18n — optional per-aggregate problem sentences", () => {
  it("extraction knows every aggregate × class as an optional key, none of them in the source", async () => {
    fs.writeFileSync(ddd, source("Order"));
    const { catalog, optional } = await extractProject(ddd);
    expect(optional.get("C.Order.problem.not-found")).toBe("problem.not-found");
    expect(optional.get("C.Order.problem.referenced-in-use")).toBe("problem.referenced-in-use");
    // Optional: absent from the source until someone writes one.
    expect(Object.keys(catalog).some((k) => k.includes(".problem."))).toBe(false);
    // A class that concerns no single aggregate has no per-aggregate key.
    expect(optional.has("C.Order.problem.internal")).toBe(false);
  });

  it("check accepts a per-aggregate translation, and flags an unknown aggregate as obsolete", async () => {
    fs.writeFileSync(ddd, source("Order"));
    await runI18nInit(ddd, "de", { dir });
    writeLocale("de", {
      "C.Order.problem.not-found": "Diese Bestellung gibt es nicht.",
      "C.Ghost.problem.not-found": "Dieses Gespenst gibt es nicht.",
    });
    await exitsOf(() => runI18nCheck(ddd, { dir }));
    const obsolete = logged.filter((l) => l.includes("obsolete:"));
    expect(obsolete.some((l) => l.includes("C.Ghost.problem.not-found"))).toBe(true);
    expect(obsolete.some((l) => l.includes("C.Order.problem.not-found"))).toBe(false);
  });

  it("check holds a per-aggregate sentence to the generic one's placeholders — no spliced type name", async () => {
    fs.writeFileSync(ddd, source("Order"));
    await runI18nInit(ddd, "de", { dir });
    writeLocale("de", { "C.Order.problem.not-found": "{type} gibt es nicht." });
    await exitsOf(() => runI18nCheck(ddd, { dir }));
    expect(
      logged.some((l) => l.includes("invalid:") && l.includes("C.Order.problem.not-found")),
    ).toBe(true);
  });

  it("check accepts a source-language override of a per-aggregate sentence (not a stale override)", async () => {
    fs.writeFileSync(ddd, source("Order"));
    await runI18nInit(ddd, "de", { dir });
    writeNamespaceDir(
      path.join(dir, "en"),
      splitCatalog({ "C.Order.problem.not-found": "This order does not exist." }, NAMES),
    );
    await exitsOf(() => runI18nCheck(ddd, { dir }));
    expect(logged.some((l) => l.includes("stale override"))).toBe(false);
  });

  it("sync keeps a per-aggregate translation (never dropped as stale), and prune keeps it", async () => {
    fs.writeFileSync(ddd, source("Order"));
    await runI18nInit(ddd, "de", { dir });
    writeLocale("de", { "C.Order.problem.not-found": "Diese Bestellung gibt es nicht." });
    await runI18nSync(ddd, { dir });
    expect(readLocale("de")["C.Order.problem.not-found"]).toBe("Diese Bestellung gibt es nicht.");
    expect(logged.some((l) => / -\d+ dropped/.test(l))).toBe(false);
    await runI18nPrune(ddd, { dir });
    expect(readLocale("de")["C.Order.problem.not-found"]).toBe("Diese Bestellung gibt es nicht.");
  });

  it("sync carries a per-aggregate translation across a declared rename of its aggregate", async () => {
    fs.writeFileSync(ddd, source("Order"));
    await runI18nInit(ddd, "de", { dir });
    writeLocale("de", {
      "C.Order.problem.not-found": "Diese Bestellung gibt es nicht.",
    });
    await runI18nSync(ddd, { dir });
    fs.writeFileSync(ddd, source("Purchase", `migration "rename" { Order -> Purchase }`));
    await runI18nSync(ddd, { dir });
    const de = readLocale("de");
    expect(de["C.Purchase.problem.not-found"]).toBe("Diese Bestellung gibt es nicht.");
    expect(de["C.Order.problem.not-found"]).toBeUndefined();
  });
});
