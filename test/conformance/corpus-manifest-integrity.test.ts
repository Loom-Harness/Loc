import { describe, expect, it } from "vitest";
import { BACKENDS } from "../fixtures/corpus/backends.js";
import {
  CORPUS,
  type CorpusFeature,
  parseSidecar,
  resolveInherits,
  unpairedFixtures,
} from "../fixtures/corpus/manifest.js";

// ---------------------------------------------------------------------------
// Manifest integrity: the invariants `corpus-coverage.test.ts` cannot see.
//
// Each row is a `<id>.corpus.json` sidecar beside its `<id>.ddd`, discovered
// by `manifest.ts`, which refuses to load on an unpaired fixture or sidecar or
// a malformed sidecar.  The checks below cover what the loader's per-file view
// cannot: a repeated id, an id that is not one kebab-case name, a repeated
// backend or deployable, an unknown backend key — and the positive control
// proves the loader's own detectors fire.
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

  it("the sidecar loader refuses the shapes a bad edit produces (positive control)", () => {
    expect(unpairedFixtures(["a.ddd", "a.corpus.json", "b.ddd", "c.corpus.json"])).toEqual([
      "b.ddd has no b.corpus.json",
      "c.corpus.json has no c.ddd",
    ]);
    expect(parseSidecar("a", { title: "t", backends: "ALL" }).errors).toEqual([]);
    expect(parseSidecar("a", { title: "t", backends: "ALL" }).row?.backends).toEqual(BACKENDS);
    expect(parseSidecar("a", { title: "t", backends: "NOPE" }).errors).toEqual([
      'a.corpus.json: unknown backend set "NOPE"',
    ]);
    expect(parseSidecar("a", { title: "t", backends: ["node"], tilte: "x" }).errors).toEqual([
      'a.corpus.json: unknown key "tilte"',
    ]);
    expect(parseSidecar("a", { backends: ["node"] }).row).toBeUndefined();
  });

  it("the gate blocks refuse a malformed row (positive control)", () => {
    const side = (extra: Record<string, unknown>) => ({ title: "t", backends: "ALL", ...extra });
    expect(
      parseSidecar("a", side({ authzGate: { "//": "why", "find GET /x": "rowDataGate" } })).errors,
    ).toEqual([]);
    expect(parseSidecar("a", side({ authzGate: { "find GET /x": 3 } })).errors).toEqual([
      "a.corpus.json: `authzGate.find GET /x` must be a reason-class name",
    ]);
    expect(
      parseSidecar("a", side({ typing: { "ir-differs": { n: 1, why: "a null" } } })).errors,
    ).toEqual([]);
    expect(
      parseSidecar("a", side({ typing: { "ir-differs": { n: 0, why: "a null" } } })).errors,
    ).toEqual([
      'a.corpus.json: `typing.ir-differs` must be { n: <positive integer>, why: <text>, issue?: "#N" }',
    ]);
    expect(parseSidecar("a", side({ inherits: "a" })).errors).toEqual([
      "a.corpus.json: `inherits` must name another corpus fixture",
    ]);
  });

  it("a twin takes its parent's undeclared gate blocks, one hop only (positive control)", () => {
    const row = (id: string, extra: Partial<CorpusFeature> = {}) =>
      ({ id, title: "t", backends: ["node"], ...extra }) as CorpusFeature;
    const gate = { "find GET /x": "rowDataGate" };
    const own = { "find GET /y": "maskIsNotAStatus" };
    const errors: string[] = [];
    const [, twin, ownTwin] = resolveInherits(
      [
        row("p", { authzGate: gate, typing: { "ir-differs": { n: 1, why: "a null" } } }),
        row("t", { inherits: "p" }),
        row("u", { inherits: "p", authzGate: own }),
      ],
      errors,
    );
    expect(errors).toEqual([]);
    expect(twin?.authzGate).toEqual(gate);
    expect(twin?.typing).toEqual({ "ir-differs": { n: 1, why: "a null" } });
    expect(ownTwin?.authzGate).toEqual(own);
    const bad: string[] = [];
    resolveInherits(
      [row("t", { inherits: "nope" }), row("p", { inherits: "t" }), row("q", { inherits: "p" })],
      bad,
    );
    expect(bad).toEqual([
      "t.corpus.json: `inherits` names no corpus fixture (nope)",
      "p.corpus.json: inherits t, which itself inherits nope; name the root",
      "q.corpus.json: inherits p, which itself inherits t; name the root",
    ]);
  });
});
