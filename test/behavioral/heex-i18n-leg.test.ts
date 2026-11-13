// The FAST-suite guard over the Phoenix translated-locale leg
// (`run-heex-ui.mjs i18n`).
//
// The leg boots a Phoenix app and a browser, so it runs outside `npm test`.
// What can rot between its runs is its SUBJECT: a `fr` key that names no
// emitted catalog key leaves the page rendering English, and the leg fails only
// in CI hours later.  This pins, on every PR, that
//   - every key in the shipped `fr` tree is a key the fixture emits, and
//   - the French sentences the spec reads off the DOM are shipped verbatim.
//
// Fast-tier claim: a fixture/catalog consistency check, not a behaviour claim —
// the behaviour (the French text is rendered) is the leg itself.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

const DIR = path.resolve(__dirname, "heex-i18n");
const SPEC = fs.readFileSync(path.join(DIR, "heex-i18n.pw.ts"), "utf8");
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

describe("heex-i18n leg — the fixture it drives", () => {
  it("every fr key is a key the fixture emits", async () => {
    const files = await generateSystemFiles(
      fs.readFileSync(path.join(DIR, "heex-i18n.ddd"), "utf8"),
    );
    const emitted = JSON.parse(
      [...files].find(([p]) => p.endsWith(".loom/messages.en.json"))![1],
    ) as Record<string, string>;
    const fr = frCatalog();
    expect(Object.keys(fr).length).toBeGreaterThan(0);
    for (const key of Object.keys(fr)) expect(emitted, `fr key ${key}`).toHaveProperty(key);
  });

  it("the spec asserts sentences the fr tree ships", () => {
    const shipped = Object.values(frCatalog());
    for (const sentence of [
      "Tarifs",
      "Principal",
      "Recalculer",
      "Comment cette valeur a été calculée",
      "Règle",
      "Valeur",
    ]) {
      expect(SPEC.toLowerCase(), `spec reads '${sentence}'`).toContain(sentence.toLowerCase());
      expect(
        shipped.map((s) => s.toLowerCase()),
        `fr tree ships '${sentence}'`,
      ).toContain(sentence.toLowerCase());
    }
    expect(shipped).toContain("Montant total : {amount, number, ::currency/EUR}");
  });
});
