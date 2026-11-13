// The FAST-suite guard over the translated-locale UI leg (`i18n-ui.mjs`).
//
// The leg is heavy (four frontend installs + builds + a browser) and runs
// outside `npm test`, so what can rot between its runs is its SUBJECT: a `fr`
// key that no longer names an emitted catalog key keeps the leg's fixture
// green-looking while the page quietly renders English (the leg would then
// fail, but only in CI hours later).  This pins, on every PR, that
//   - every key in the shipped `fr` tree is a runtime key the fixture emits
//     (the namespace-prefix spelling is the easy thing to get wrong), and
//   - every chrome claim the runner asserts has its translation shipped, with
//     the exact sentences the runner reads off the DOM.
//
// Fast-tier claim: a fixture/catalog consistency check, not a behaviour claim —
// the behaviour (the text is rendered) is the leg itself.
//
// MUTATION-PROVEN (file copy, restored and verified): renaming
// `page.Price.title.e656gd` in `locales/fr/WebApp.json` fails "every fr key is
// a key the fixture emits" naming it.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const DIR = path.resolve(__dirname, "i18n-ui");
const RUNNER = fs.readFileSync(path.resolve(__dirname, "i18n-ui.mjs"), "utf8");
const FR = path.join(DIR, "locales", "fr");

/** The fr tree as RUNTIME keys (file keys carry no namespace prefix, except
 *  `_chrome`, which stores them verbatim). */
function frCatalog(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of fs.readdirSync(FR)) {
    const ns = file.replace(/\.json$/, "");
    const body = JSON.parse(fs.readFileSync(path.join(FR, file), "utf8")) as Record<string, string>;
    for (const [k, v] of Object.entries(body)) out[ns === "_chrome" ? k : `${ns}.${k}`] = v;
  }
  return out;
}

describe("i18n-ui leg — the fixture it drives", () => {
  it("every fr key is a key the fixture emits", async () => {
    const files = await generateSystemFiles(fs.readFileSync(path.join(DIR, "i18n-ui.ddd"), "utf8"));
    const emitted = JSON.parse(
      [...files].find(([p]) => p.endsWith(".loom/messages.en.json"))![1],
    ) as Record<string, string>;
    const fr = frCatalog();
    expect(Object.keys(fr).length).toBeGreaterThan(0);
    for (const key of Object.keys(fr)) expect(emitted, `fr key ${key}`).toHaveProperty(key);
  });

  it("the runner asserts the sentences the fr tree ships", () => {
    const sentences = Object.values(frCatalog()).filter((v) => !v.includes("{"));
    // Every chrome sentence the probes read must be shipped verbatim.
    for (const asserted of [
      "Interdit",
      "Vous n'avez pas accès à cette page.",
      "Comment cette valeur a été calculée",
      "Règle",
      "Valeur",
      "Tarifs",
      "Simple",
      "Principal",
      "Recalculer",
      "Filtrer…",
      "Filtrer le tableau",
    ]) {
      expect(RUNNER, `runner reads '${asserted}'`).toContain(
        asserted.replace("Principal", "principal").replace("Recalculer", "recalculer"),
      );
      expect(
        sentences.some((s) => s.toLowerCase() === asserted.toLowerCase()) ||
          Object.values(frCatalog()).includes(asserted),
        `fr tree ships '${asserted}'`,
      ).toBe(true);
    }
    expect(Object.values(frCatalog())).toContain(
      "Montant total : {amount, number, ::currency/EUR}",
    );
  });
});
