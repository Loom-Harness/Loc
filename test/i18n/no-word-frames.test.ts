// The unit of translation is a whole sentence.  A chrome or pack-chrome message
// may carry a placeholder only for DATA (a number, an id, a user value) — never
// for a WORD a generator humanized or translated into a fixed frame.
// "Delete this {entity}?" cannot be right in a language with gender or case
// agreement ("Supprimer cette tâche ?" / "Supprimer ce projet ?"), so every
// such message is generated as one complete sentence per aggregate, operation
// or item type instead.
//
// This census reads every chrome table, every design pack's declared chrome,
// and the system catalog of a representative corpus (the crud starter,
// `examples/acme.ddd` and `examples/showcase.ddd`), and fails on a placeholder outside the data allowlist.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderStarter } from "../../src/cli/new-templates.js";
import { buildUiCatalog } from "../../src/generator/_frontend/i18n-runtime.js";
import {
  APP_SHELL_CHROME,
  CHROME_MESSAGES,
  FORM_CHROME,
  TABLE_CONTROLS_CHROME,
} from "../../src/generator/_walker/i18n-chrome.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { buildMessageCatalog } from "../../src/system/i18n-catalog.js";
import { parseString } from "../_helpers/parse.js";

/** Placeholders that stand for DATA the runtime supplies. */
const DATA_HOLES = new Set([
  "id",
  "count",
  "page",
  "pages",
  "value",
  "min",
  "max",
  "total",
  "index",
]);

/** Placeholders that stand for a WORD a generator fills into a frame. */
const WORD_HOLES = ["entity", "item", "operation", "column"];

const HOLE = /\{(\w+)(?:,[^}]*)?\}/g;

function holesOf(message: string): string[] {
  return [...message.matchAll(HOLE)].map((m) => m[1]!);
}

function wordFrames(table: Record<string, string>): string[] {
  return Object.entries(table)
    .filter(([, message]) => holesOf(message).some((h) => !DATA_HOLES.has(h)))
    .map(([key, message]) => `${key}: ${message}`);
}

const DESIGNS = join(__dirname, "..", "..", "designs");

function packManifests(): Array<{ id: string; chrome: Record<string, string> }> {
  const out: Array<{ id: string; chrome: Record<string, string> }> = [];
  for (const family of readdirSync(DESIGNS)) {
    for (const version of readdirSync(join(DESIGNS, family))) {
      let manifest: { chrome?: Record<string, string> };
      try {
        manifest = JSON.parse(readFileSync(join(DESIGNS, family, version, "pack.json"), "utf8"));
      } catch {
        continue;
      }
      out.push({ id: `${family}/${version}`, chrome: manifest.chrome ?? {} });
    }
  }
  return out;
}

async function systemOf(source: string) {
  const { model } = await parseString(source, { validate: false });
  return enrichLoomModel(lowerModel(model)).systems[0]!;
}

async function corpus() {
  const crud = renderStarter({
    name: "x",
    template: "crud",
    platform: "node",
    design: "mantine",
    invocation: "ddd",
  });
  const example = (file: string) =>
    readFileSync(join(__dirname, "..", "..", "examples", file), "utf8");
  return [
    { name: "crud starter", sys: await systemOf(crud) },
    { name: "acme", sys: await systemOf(example("acme.ddd")) },
    // Hard-delete forms, operation forms and repeated value-object rows.
    { name: "showcase", sys: await systemOf(example("showcase.ddd")) },
  ];
}

describe("i18n: no word-inserting frames", () => {
  it("the static chrome tables carry data holes only", () => {
    for (const table of [CHROME_MESSAGES, APP_SHELL_CHROME, FORM_CHROME, TABLE_CONTROLS_CHROME]) {
      expect(wordFrames(table)).toEqual([]);
    }
  });

  it("no design pack declares chrome with a word hole", () => {
    const packs = packManifests();
    expect(packs.length).toBeGreaterThan(5);
    for (const pack of packs) {
      expect(wordFrames(pack.chrome), pack.id).toEqual([]);
    }
  });

  it("no chrome table or pack mentions {entity}, {item}, {operation} or {column}", () => {
    const everything = [
      ...Object.values(CHROME_MESSAGES),
      ...Object.values(FORM_CHROME),
      ...Object.values(TABLE_CONTROLS_CHROME),
      ...Object.values(APP_SHELL_CHROME),
      ...packManifests().flatMap((p) => Object.values(p.chrome)),
    ];
    for (const message of everything) {
      for (const word of WORD_HOLES) expect(message).not.toContain(`{${word}`);
    }
  });

  it("a pack declares a sentence base exactly when its templates read the token", () => {
    // base → [the template that reads it, its token].  `successMessage` is two
    // sentences, one per template: the op dialog's `operationSucceeded`, and the
    // inline create / run form's `created` / `completed`.
    const tokens: Record<string, [file: string | undefined, token: string]> = {
      addItem: [undefined, "{{{addItemLabel}}}"],
      operationSucceeded: ["form-op-module.hbs", "{{{successMessage}}}"],
      created: ["form-default-onsubmit.hbs", "{{{successMessage}}}"],
      completed: ["form-default-onsubmit.hbs", "{{{successMessage}}}"],
    };
    for (const family of readdirSync(DESIGNS)) {
      for (const version of readdirSync(join(DESIGNS, family))) {
        const dir = join(DESIGNS, family, version);
        let manifest: { sentenceChrome?: string[] };
        try {
          manifest = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
        } catch {
          continue;
        }
        const templatesOf = (file: string | undefined): string =>
          readdirSync(dir)
            .filter((f) => (file === undefined ? f.endsWith(".hbs") : f === file))
            .map((f) => readFileSync(join(dir, f), "utf8"))
            .join("\n");
        for (const [base, [file, token]] of Object.entries(tokens)) {
          expect(
            (manifest.sentenceChrome ?? []).includes(base),
            `${family}/${version} ${base}`,
          ).toBe(templatesOf(file).includes(token));
        }
      }
    }
  });

  it("the system catalog of the corpus has no word hole in chrome or pack chrome", async () => {
    for (const { name, sys } of await corpus()) {
      const catalog = buildMessageCatalog(sys);
      const chrome = Object.fromEntries(
        Object.entries(catalog).filter(
          ([key]) => key.startsWith("chrome.") || key.startsWith("pack."),
        ),
      );
      expect(Object.keys(chrome).length, name).toBeGreaterThan(0);
      expect(wordFrames(chrome), name).toEqual([]);
    }
  });

  it("each aggregate gets its own whole delete sentences", async () => {
    const showcase = (await corpus()).find((c) => c.name === "showcase");
    const catalog = buildMessageCatalog(showcase!.sys);
    const confirms = Object.entries(catalog).filter(([key]) =>
      key.startsWith("chrome.deleteConfirm."),
    );
    expect(confirms.length).toBeGreaterThan(0);
    for (const [key, message] of confirms) {
      const aggregate = key.slice("chrome.deleteConfirm.".length);
      expect(message).toMatch(/^Delete this .+\?$/);
      expect(catalog[`chrome.deleteEntity.${aggregate}`]).toMatch(/^Delete .+/);
    }
    expect(catalog["chrome.deleteConfirm"]).toBeUndefined();
    expect(catalog["chrome.deleteEntity"]).toBeUndefined();
  });

  it("the per-UI catalog carries the same sentences and no frame", async () => {
    for (const { name, sys } of await corpus()) {
      const contexts = sys.subdomains.flatMap((sub) => sub.contexts);
      for (const ui of sys.uis) {
        const catalog = buildUiCatalog(
          ui,
          {},
          { contexts, sentences: ["addItem", "operationSucceeded"] },
        );
        const chrome = Object.fromEntries(
          Object.entries(catalog).filter(([key]) => key.startsWith("chrome.")),
        );
        expect(wordFrames(chrome), `${name}/${ui.name}`).toEqual([]);
      }
    }
  });
});
