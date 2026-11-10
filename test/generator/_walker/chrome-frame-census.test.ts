// Census: no emitter builds user-visible English by splicing a model name into
// a word frame.
//
// A sentence that varies by aggregate / operation / item type is ONE catalog
// message per subject (`chrome.created.Order` = "Order created",
// `chrome.addItem.LineItem` = "Add line item"), never `${humanize(name)} created`
// assembled at generate time: such a frame cannot be translated, and in a
// language with gender or case agreement the spliced noun cannot be right.  The
// sentence builders live in `SENTENCE_CHROME` (`_walker/i18n-chrome.ts`) — the
// one sanctioned home of a frame, because that is where the catalog text is
// made.
//
// This scans every emitter for a template literal that puts a model name beside
// an action / status word, and fails on one outside `SENTENCE_CHROME`.  The
// `KNOWN_UNCATALOGUED` ratchet lists the frames that still exist: each entry
// must still match (a fixed frame must leave the list), and a NEW frame fails.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const generatorDir = path.resolve(here, "../../../src/generator");

/** An action / status word directly before or after a `${…}` splice, inside one
 *  template literal. */
const FRAME =
  /`[^`\n]*(?:\b(?:Add|Create|Delete|Run|Remove|Edit|Save|Update)\s+\$\{|\}\s+(?:created|completed|succeeded|deleted|updated|saved|is invalid|is required|is not available|not found))[^`\n]*`/;

/** The one file whose frames ARE the catalog text. */
const SANCTIONED = new Set(["_walker/i18n-chrome.ts"]);

/** A frame that is not user-visible text (an error thrown at generate time, a
 *  log line, a developer-facing assertion), recognised by its enclosing call. */
const NOT_USER_VISIBLE =
  /(?:throw new Error|message:|Exception\(|diagMessage|console\.|giveUp|`Action\(|`Form\()/;

/** file → the frames not yet in the catalog, by a distinctive substring. */
const KNOWN_UNCATALOGUED: Readonly<Record<string, readonly string[]>> = {
  "elixir/liveview-emit.ts": ["${b.opHuman} succeeded"],
  "elixir/heex-primitives.ts": ["is not available in the current state"],
  "elixir/heex-walker-core.ts": ["${upperFirst(aggName)} not found"],
  "feliz/feliz-target.ts": [
    '"Create ${upperFirst(form.aggregate)}"',
    '"Run ${upperFirst(form.workflow)}"',
  ],
  "flutter/forms-emit.ts": [
    "`Create ${humanize(agg.name)}`",
    "`Run ${humanize(wf.name)}`",
    "is required",
  ],
  "angular/form-fields.ts": ["${humanize(f.name)} is invalid"],
};

/** The emitters that write UI text (the backends emit error text through the
 *  problem-detail catalog, and the pack / persistence layers emit no page text). */
const UI_EMITTERS = new Set([
  "_walker",
  "_frontend",
  "react",
  "vue",
  "svelte",
  "angular",
  "feliz",
  "flutter",
  "elixir",
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every user-visible-looking frame: `[relative file, trimmed line]`. */
function frames(): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const file of sourceFiles(generatorDir)) {
    const rel = path.relative(generatorDir, file).split(path.sep).join("/");
    if (SANCTIONED.has(rel) || !UI_EMITTERS.has(rel.split("/")[0]!)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
      if (!FRAME.test(line) || NOT_USER_VISIBLE.test(line)) continue;
      found.push([rel, line]);
    }
  }
  return found;
}

describe("word frames outside the message catalog", () => {
  const all = frames();

  it("no emitter splices a model name into an English frame", () => {
    const unexpected = all.filter(
      ([file, line]) => !(KNOWN_UNCATALOGUED[file] ?? []).some((snippet) => line.includes(snippet)),
    );
    expect(
      unexpected.map(([file, line]) => `${file}: ${line}`),
      "a whole-sentence catalog message per subject (`sentenceChromeName`) replaces a frame",
    ).toEqual([]);
  });

  it("every known uncatalogued frame still exists (a fixed one leaves the list)", () => {
    const stale = Object.entries(KNOWN_UNCATALOGUED).flatMap(([file, snippets]) =>
      snippets
        .filter((s) => !all.some(([f, line]) => f === file && line.includes(s)))
        .map((s) => `${file}: ${s}`),
    );
    expect(stale).toEqual([]);
  });
});
