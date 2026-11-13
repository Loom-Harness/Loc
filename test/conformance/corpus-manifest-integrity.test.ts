import { describe, expect, it } from "vitest";
import { BACKENDS } from "../fixtures/corpus/backends.js";
import { CORPUS, type CorpusFeature } from "../fixtures/corpus/manifest.js";

// ---------------------------------------------------------------------------
// Manifest integrity: the invariants `corpus-coverage.test.ts` cannot see.
//
// Every lane appends rows to `manifest.ts`, so a merge can leave two rows with
// one id, or fuse two ids into one string.  Nothing flags either: `tsc` accepts
// duplicate object literals in an array, the coverage gate checks row→file by
// set membership, and the behavioural case runner keys cases by id, so the
// second row is silently skipped.  This file fails on the shapes a merge makes.
// ---------------------------------------------------------------------------

const ID_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Ids that appear on more than one row. */
function duplicateIds(rows: readonly Pick<CorpusFeature, "id">[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) (seen.has(r.id) ? dup : seen).add(r.id);
  return [...dup].sort();
}

/** Rows whose `backends` or `deployables` list repeats an entry. */
function repeatedEntries(rows: readonly CorpusFeature[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    for (const [key, list] of [
      ["backends", r.backends],
      ["deployables", r.deployables ?? []],
    ] as const) {
      if (new Set(list).size !== list.length) out.push(`${r.id}.${key}`);
    }
  }
  return out;
}

describe("corpus manifest integrity", () => {
  it("no id appears on two rows (the second would be skipped silently)", () => {
    expect(duplicateIds(CORPUS)).toEqual([]);
  });

  it("every id is one kebab-case name (a fused id never matches its .ddd)", () => {
    expect(CORPUS.filter((f) => !ID_SHAPE.test(f.id)).map((f) => f.id)).toEqual([]);
  });

  it("no row repeats a backend or a deployable", () => {
    expect(repeatedEntries(CORPUS)).toEqual([]);
  });

  it("every declared backend is a known backend", () => {
    const known = new Set<string>(BACKENDS);
    expect(
      CORPUS.flatMap((f) => f.backends.filter((b) => !known.has(b)).map((b) => `${f.id}:${b}`)),
    ).toEqual([]);
  });

  it("the detectors flag the shapes a merge produces (positive control)", () => {
    const row = (id: string, backends: CorpusFeature["backends"] = ["node"]) =>
      ({ id, title: "t", backends }) as CorpusFeature;
    expect(duplicateIds([row("a"), row("b"), row("a")])).toEqual(["a"]);
    expect(repeatedEntries([row("a", ["node", "node"])])).toEqual(["a.backends"]);
    expect(ID_SHAPE.test("oneTwo")).toBe(false);
    expect(ID_SHAPE.test("one--two")).toBe(false);
  });
});
