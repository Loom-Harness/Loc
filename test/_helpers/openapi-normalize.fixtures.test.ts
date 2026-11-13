import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffSpecs, isCleanDiff, type OpenApiSpec, type ParityDiff } from "./openapi-normalize.js";

// Fixture pairs for the structural parity normalizer (D-OPENAPI-FRAMEWORK-NATIVE).
//
//   openapi-parity-fixtures/equivalent/<case>/{a,b}.json
//       Two framework-native spellings of ONE contract.  The pair must diff
//       clean in both directions.
//   openapi-parity-fixtures/different/<case>/{a,b,expect}.json
//       A real contract difference.  The pair must NOT diff clean, and the
//       dimension `expect.json` names must report it, in both directions.
//
// Add a pair when the normalizer learns a new equivalence, and a `different`
// pair next to it for the closest difference it must still reject.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "openapi-parity-fixtures");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function cases(kind: "equivalent" | "different"): string[] {
  return fs
    .readdirSync(path.join(root, kind), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** A pair's documents and the backend names it is compared under —
 *  `names.json` (`{"a": "hono", "b": "dotnet"}`) when an equivalence is
 *  scoped to particular backends, else `a` / `b`. */
function load(
  kind: string,
  name: string,
): { a: OpenApiSpec; b: OpenApiSpec; names: { a: string; b: string } } {
  const dir = path.join(root, kind, name);
  const namesFile = path.join(dir, "names.json");
  return {
    a: readJson<OpenApiSpec>(path.join(dir, "a.json")),
    b: readJson<OpenApiSpec>(path.join(dir, "b.json")),
    names: fs.existsSync(namesFile)
      ? readJson<{ a: string; b: string }>(namesFile)
      : { a: "a", b: "b" },
  };
}

function nonEmptyDimensions(diff: ParityDiff): string[] {
  return Object.entries(diff)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k]) => k);
}

describe("openapi parity fixtures", () => {
  it("has fixture pairs on both sides", () => {
    expect(cases("equivalent").length).toBeGreaterThanOrEqual(6);
    expect(cases("different").length).toBeGreaterThanOrEqual(11);
  });

  describe("equivalent spellings compare equal", () => {
    for (const name of cases("equivalent")) {
      it(name, () => {
        const { a, b, names } = load("equivalent", name);
        const ab = diffSpecs({ name: names.a, spec: a }, { name: names.b, spec: b });
        const ba = diffSpecs({ name: names.b, spec: b }, { name: names.a, spec: a });
        expect(nonEmptyDimensions(ab), JSON.stringify(ab, null, 2)).toEqual([]);
        expect(isCleanDiff(ba), JSON.stringify(ba, null, 2)).toBe(true);
      });
    }
  });

  describe("real contract differences still fail", () => {
    for (const name of cases("different")) {
      it(name, () => {
        const { a, b, names } = load("different", name);
        const { dimension } = readJson<{ dimension: keyof ParityDiff }>(
          path.join(root, "different", name, "expect.json"),
        );
        for (const diff of [
          diffSpecs({ name: names.a, spec: a }, { name: names.b, spec: b }),
          diffSpecs({ name: names.b, spec: b }, { name: names.a, spec: a }),
        ]) {
          expect(isCleanDiff(diff)).toBe(false);
          expect(nonEmptyDimensions(diff), JSON.stringify(diff, null, 2)).toContain(dimension);
        }
      });
    }
  });

  it("does not modify the documents it compares", () => {
    const { a, b } = load("equivalent", "allof-inheritance-vs-oneof-union");
    const before = JSON.stringify([a, b]);
    diffSpecs({ name: "a", spec: a }, { name: "b", spec: b });
    expect(JSON.stringify([a, b])).toBe(before);
  });
});
