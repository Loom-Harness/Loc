// Every corpus fixture's generated docker-compose.yml must be valid YAML in
// the one respect string assertions never notice: no mapping holds the same key
// twice.  A `depends_on` fed by several dependency sources (the database
// migrator, a called api, a broker, a sidecar) used to repeat a service key
// when two sources named it, and compose rejects the file.
//
// Tier: string/structure.  It asserts compose wiring that no booted tier
// reports (a duplicate key only fails at `docker compose up`, which the
// behavioural legs run on a subset of fixtures).  It walks every corpus fixture
// so a new dependency source cannot bypass it.
//
// The `yaml` package is not a dependency, so the check is a small
// indentation-based scan of the block-style YAML the composer emits.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { PLATFORM_CLAUSE } from "../fixtures/corpus/backends.js";

/** Dotted paths of every key that appears twice in one block mapping. */
function duplicateYamlKeys(text: string): string[] {
  const dups: string[] = [];
  // Stack of open mappings: indent, the key path to here, keys seen so far.
  const stack: { indent: number; path: string[]; seen: Set<string> }[] = [];
  let scalarIndent = -1; // inside a `|` / `>` block scalar while > -1
  let lastKey: { indent: number; key: string } | undefined;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    if (scalarIndent >= 0) {
      if (indent > scalarIndent) continue;
      scalarIndent = -1;
    }
    let body = raw.trimStart();
    let at = indent;
    // A list item opens a fresh mapping at the column after its dash.
    while (body.startsWith("- ")) {
      while (stack.length && stack[stack.length - 1]!.indent >= at) stack.pop();
      at += 2;
      body = body.slice(2);
      lastKey = undefined;
    }
    const m = /^("[^"]*"|'[^']*'|[^\s:#][^:#]*?):(\s|$)/.exec(body);
    if (!m) continue;
    const key = m[1]!;
    while (stack.length && stack[stack.length - 1]!.indent > at) stack.pop();
    let top = stack[stack.length - 1];
    if (!top || top.indent < at) {
      const parent = lastKey && lastKey.indent < at ? [...(top?.path ?? []), lastKey.key] : [];
      top = { indent: at, path: parent, seen: new Set() };
      stack.push(top);
    }
    if (top.seen.has(key)) dups.push([...top.path, key].join("."));
    top.seen.add(key);
    lastKey = { indent: at, key };
    const rest = body.slice(m[0].length).trim();
    if (/^[|>][-+0-9]*$/.test(rest)) scalarIndent = at;
  }
  return dups;
}

describe("duplicateYamlKeys", () => {
  it("names a repeated key and its path", () => {
    const yml = [
      "services:",
      "  a:",
      "    depends_on:",
      "      b:",
      "        condition: x",
      "      b:",
      "        condition: y",
    ].join("\n");
    expect(duplicateYamlKeys(yml)).toEqual(["services.a.depends_on.b"]);
  });
  it("accepts the same key in sibling mappings and list items", () => {
    const yml = [
      "services:",
      "  a:",
      "    ports:",
      "      - x: 1",
      "      - x: 2",
      "  b:",
      "    ports: []",
    ].join("\n");
    expect(duplicateYamlKeys(yml)).toEqual([]);
  });
});

const corpusDir = path.join(__dirname, "../fixtures/corpus");
const fixtures = fs
  .readdirSync(corpusDir)
  .filter((f) => f.endsWith(".ddd"))
  .map((f) => f.slice(0, -4))
  .sort();

describe("generated docker-compose.yml has no duplicate keys", () => {
  for (const fixture of fixtures) {
    it(fixture, async () => {
      const src = fs
        .readFileSync(path.join(corpusDir, `${fixture}.ddd`), "utf8")
        .replaceAll("__PLATFORM__", PLATFORM_CLAUSE.node);
      const files = await generateSystemFiles(src);
      const compose = files.get("docker-compose.yml");
      if (compose === undefined) return;
      expect(duplicateYamlKeys(compose)).toEqual([]);
    }, 60_000);
  }
});
