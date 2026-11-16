// The multi-backend harness's pure half, and the sidecar rows it settles —
// pinned without booting anything (the booted leg is
// `multi-backend-e2e.test.ts`, opt-in).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OUTCOMES } from "../behavioral/case-loop.mjs";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import {
  CHECKS,
  dropE2eBlocks,
  expandFixture,
  MEMBER_KEYS,
  MEMBERS,
  orderedPairs,
  rotations,
  serviceOf,
} from "./topology.mjs";

const CORPUS_DIR = join(process.cwd(), "test", "fixtures", "corpus");
const fixtures = CORPUS.filter((f) => f.multiBackend);

describe("expandFixture — one deployable per member, on the fixture's own stores", () => {
  const src = readFileSync(join(CORPUS_DIR, "multi-backend-store.ddd"), "utf8");
  const order = ["elixir", "node", "dapper"];
  const out = expandFixture(src, order);
  // A platform clause can carry its own `{ … }`, so each block runs to the
  // next deployable (or the end of the system).
  const blocks = out
    .split(/\n[ \t]*deployable\s+/)
    .slice(1)
    .map((b) => [b, /^(\w+)/.exec(b)![1], b] as const);

  it("declares the members in the given order — the first is the database's migrator", () => {
    expect(blocks.map((b) => b[1])).toEqual(order.map(serviceOf));
  });

  it("gives each its platform clause and port, and keeps every other line of the block", () => {
    for (const [i, key] of order.entries()) {
      const m = MEMBERS.find((x) => x.key === key)!;
      expect(blocks[i][2]).toContain(`platform: ${m.clause}`);
      expect(blocks[i][2]).toContain(`port: ${m.port}`);
      expect(blocks[i][2]).toContain("dataSources: [ordersState, ordersCache]");
    }
    expect(out).not.toContain("__PLATFORM__");
  });

  it("drops the per-backend e2e blocks, whole", () => {
    expect(src).toMatch(/test e2e "/);
    expect(out).not.toMatch(/test e2e/);
    expect(out.trimEnd().endsWith("}")).toBe(true);
    expect(dropE2eBlocks('x\n  test e2e "a" against d {\n  f({ a: 1 })\n }\ny')).toBe("x\ny");
  });

  it("refuses an unknown or repeated member, and a fixture without exactly one __PLATFORM__ deployable", () => {
    expect(() => expandFixture(src, ["cobol"])).toThrow(/unknown member/);
    expect(() => expandFixture(src, ["node", "node"])).toThrow(/twice/);
    expect(() => expandFixture("system S { }", ["node"])).toThrow(/exactly one/);
  });

  it("publishes every member on its own port", () => {
    expect(new Set(MEMBERS.map((m) => m.port)).size).toBe(MEMBERS.length);
  });
});

describe("the matrix shape", () => {
  it("rotates the owner through every member", () => {
    const r = rotations(["a", "b", "c"]);
    expect(r).toEqual([
      ["a", "b", "c"],
      ["b", "a", "c"],
      ["c", "a", "b"],
    ]);
  });

  it("pairs every ordered (writer, reader) of distinct members", () => {
    expect(orderedPairs(["a", "b", "c"])).toHaveLength(6);
    expect(orderedPairs(MEMBER_KEYS.slice(0, 5))).toHaveLength(20);
  });
});

describe("multiBackend sidecar rows", () => {
  it("at least one fixture is booted by the harness", () => {
    expect(fixtures.map((f) => f.id)).toContain("multi-backend-store");
  });

  const rows = fixtures.flatMap((f) =>
    Object.entries((f.multiBackend?.xfail ?? {}) as Record<string, Record<string, unknown>>).map(
      ([name, e]) => ({ where: `${f.id}/${name}`, name, e }),
    ),
  );

  it("names a member or a check", () => {
    const names = new Set<string>([...MEMBER_KEYS, ...CHECKS]);
    expect(rows.filter((r) => !names.has(r.name)).map((r) => r.where)).toEqual([]);
  });

  it("links every row to an issue and gives it a reason", () => {
    expect(
      rows
        .filter(
          (r) => !/^#\d+(, #\d+)*$/.test(String(r.e.issue)) || !String(r.e.reason ?? "").trim(),
        )
        .map((r) => r.where),
    ).toEqual([]);
  });

  it("pins every row in the form its outcome kind needs, with compiling patterns", () => {
    const bad = rows.filter(({ e }) => {
      if (!(OUTCOMES as readonly string[]).includes(e.expect as string)) return true;
      if (e.expect === "error") return typeof e.match !== "string";
      if (e.expect === "fail") return !e.tests || Object.keys(e.tests as object).length === 0;
      return true;
    });
    expect(bad.map((r) => r.where)).toEqual([]);
    for (const { e } of rows)
      for (const re of [e.match, ...Object.values((e.tests ?? {}) as Record<string, string>)])
        if (typeof re === "string") expect(() => new RegExp(re)).not.toThrow();
  });

  it("a member row is a generation refusal; a check row is a set of failing cells", () => {
    expect(
      rows
        .filter((r) =>
          MEMBER_KEYS.includes(r.name) ? r.e.expect !== "error" : r.e.expect !== "fail",
        )
        .map((r) => r.where),
    ).toEqual([]);
  });
});
