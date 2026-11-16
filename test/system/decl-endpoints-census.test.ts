// Census for `declEndpoints` (src/ir/plan/decl-endpoints.ts): which built-in
// endpoints a declaration has, and what each binds, is decided once.  The
// validator and every backend read the fact; none of them compares a route
// target's `endpoint` against a literal name ("history", "read", …), which
// would be a second, drifting list of the same vocabulary.
//
// What this catches: an `endpoint === "<name>"` (or `!==`, or a `case
// "<name>":` inside a switch on `.endpoint`) anywhere under src/ outside the
// fact itself.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../src");
const FACT = path.join(SRC, "ir/plan/decl-endpoints.ts");

function tsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "generated" ? [] : tsFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

/** A comparison of a route target's `endpoint` with a string literal, or a
 *  switch over it. */
const RE_DERIVED = /\.endpoint\s*[!=]==?\s*["'`]|switch\s*\([^)]*\.endpoint\s*\)/;

function endpointRederivations(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const f of files) {
    if (f === FACT) continue;
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (RE_DERIVED.test(line) && !/^\s*(\/\/|\*)/.test(line))
        hits.push(`${path.relative(SRC, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe("declEndpoints census", () => {
  it("no file outside the fact matches a route target's endpoint by name", () => {
    expect(endpointRederivations(tsFiles(SRC))).toEqual([]);
  });

  it("reaches the code it polices (the fact exists and the scan sees src/)", () => {
    const files = tsFiles(SRC);
    expect(files).toContain(FACT);
    expect(files.length).toBeGreaterThan(500);
  });
});
