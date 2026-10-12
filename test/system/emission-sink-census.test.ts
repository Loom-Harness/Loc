// Every generator OUTPUT map is a write-once `EmissionSink`.
//
// `src/util/emission-sink.ts` only closes the path-clobber class if every
// orchestrator writes into one. A new orchestrator (or a sub-emitter that
// returns its own file map) built on a plain `new Map<string, string>()`
// silently re-opens it. This census reads the source of src/generator,
// src/platform and src/system and fails on a plain map bound to an output-map
// name — `out`, `files`, `prefixed` — the names every file map in the tree
// uses. A `Map<string, string>` that is NOT a file map (a name → expression
// table, a lookup) keeps a plain map under any other name.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

const ROOTS = ["src/generator", "src/platform", "src/system"];
const OUTPUT_MAP_NAMES = ["out", "files", "prefixed"];

/** Plain `Map<string, string>` declarations whose name says "output map" but
 *  which are a lookup table, not a file map. Each entry is a reviewed claim;
 *  a stale entry fails the census below. */
const NOT_FILE_MAPS: Record<string, string> = {
  "src/generator/_frontend/page-identity.ts": "page slot key → module path (an index, not files)",
  "src/generator/python/emit/wire-constraints.ts": "field name → pydantic kwargs",
  "src/generator/feliz/store-persist.ts": "model field → init expression",
  "src/generator/flutter/store-persist.ts": "field name → build() initializer",
  "src/generator/elixir/sidebar-emit.ts": "route → HEEx gate expression",
};

function* tsFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) yield p;
  }
}

const PLAIN_OUTPUT_MAP = new RegExp(
  String.raw`\b(?:const|let)\s+(${OUTPUT_MAP_NAMES.join("|")})\s*(?::\s*Map<string,\s*string>\s*)?=\s*new Map(?:<string,\s*string>)?\(\)`,
  "g",
);

function scan(): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  for (const root of ROOTS) {
    for (const abs of tsFiles(join(REPO_ROOT, root))) {
      const rel = relative(REPO_ROOT, abs);
      const text = readFileSync(abs, "utf8");
      for (const m of text.matchAll(PLAIN_OUTPUT_MAP)) {
        const line = text.slice(0, m.index).split("\n").length;
        (hits.get(rel) ?? hits.set(rel, []).get(rel)!).push(`${rel}:${line}  ${m[0]}`);
      }
    }
  }
  return hits;
}

describe("every generator output map is a write-once EmissionSink", () => {
  const hits = scan();

  it("no plain Map<string, string> is bound to an output-map name", () => {
    const offenders = [...hits]
      .filter(([file]) => !(file in NOT_FILE_MAPS))
      .flatMap(([, lines]) => lines);
    expect(
      offenders.join("\n"),
      "use emissionSink(label) from src/util/emission-sink.ts — a plain Map lets two emitters " +
        "clobber one path silently (or, if this is a lookup table and not a file map, add it " +
        "to NOT_FILE_MAPS with a reason)",
    ).toBe("");
  });

  it("every NOT_FILE_MAPS waiver still names a live site (the list ratchets)", () => {
    const stale = Object.keys(NOT_FILE_MAPS).filter((f) => !hits.has(f));
    expect(stale, "delete the stale waiver").toEqual([]);
  });

  it("the census reaches the orchestrators it names (non-vacuity)", () => {
    // If the regex stopped matching, both cases above would pass vacuously.
    // The waived lookup tables are real plain maps it must still see.
    expect(hits.size).toBeGreaterThanOrEqual(Object.keys(NOT_FILE_MAPS).length);
    const sink = readFileSync(join(REPO_ROOT, "src/generator/react/index.ts"), "utf8");
    expect(sink).toMatch(/const out = emissionSink\(/);
  });
});
