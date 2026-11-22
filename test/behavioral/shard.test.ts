// The behavioural legs run as 2-way shards (`index % 2 == shard` over the derived
// corpus list).  This is the proof the two shards together run exactly the cases
// the single leg ran, over the REAL derived list of every sharded leg — so a
// selector change that drops or duplicates a case fails here, not in a green CI
// run that quietly ran half the corpus.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sharedSystemGoldenCases } from "./registers.mjs";
import { parseShard, partitionProblems, selectShard, shardFromInvocation } from "./shard.mjs";

/** The shard count every sharded leg's workflow declares. */
const SHARDS = 2;

/** The derived list every sharded runner builds is the manifest's behavioural
 *  features then the shared systems (cases.mjs `featureCases` + `sharedSystemCases`,
 *  which needs the runner-only esbuild, so it cannot load in this suite).  The
 *  partition is index-based, so the real fixture and system names stand in for
 *  that list here; each runner re-proves the partition over its exact list at
 *  start-up (`shardCorpus`). */
async function derivedList(): Promise<{ name: string }[]> {
  const { CORPUS } = await import("../fixtures/corpus/manifest.js");
  return [...CORPUS.map((f: { id: string }) => f.id), ...sharedSystemGoldenCases()].map((name) => ({
    name,
  }));
}

describe("behavioural leg sharding", () => {
  it("the shards cover the derived list exactly once", async () => {
    const cases = await derivedList();
    expect(cases.length).toBeGreaterThan(SHARDS);
    expect(partitionProblems(cases, SHARDS)).toEqual([]);
    const union = Array.from({ length: SHARDS }, (_, k) =>
      selectShard(cases, { index: k, count: SHARDS }),
    );
    expect(
      union
        .flat()
        .map((c) => c.name)
        .sort(),
    ).toEqual(cases.map((c) => c.name).sort());
    // both halves carry work, so neither job is an empty shell
    for (const half of union) expect(half.length).toBeGreaterThan(0);
  });

  it("flags a case in no shard and a case in two", () => {
    const cases = ["a", "b", "c", "d"].map((name) => ({ name }));
    expect(partitionProblems(cases, 2)).toEqual([]);
    // the same list with one entry repeated lands both copies on different shards
    expect(partitionProblems([...cases, { name: "a" }], 2)).toEqual([
      "a runs in 2 shards (want exactly 1)",
    ]);
  });

  it("no shard selected → the whole leg", () => {
    const cases = [{ name: "a" }, { name: "b" }];
    expect(selectShard(cases, null)).toEqual(cases);
    expect(shardFromInvocation([], {})).toBeNull();
  });

  it("takes the shard from --shard=K/N or LOOM_BH_SHARD, the flag winning", () => {
    expect(shardFromInvocation(["--shard=1/2"], {})).toEqual({ index: 1, count: 2 });
    expect(shardFromInvocation([], { LOOM_BH_SHARD: "0/2" })).toEqual({ index: 0, count: 2 });
    expect(shardFromInvocation(["--shard=1/2"], { LOOM_BH_SHARD: "0/2" })).toEqual({
      index: 1,
      count: 2,
    });
  });

  it.each(["2/2", "x", "1", "0/0", "-1/2"])("rejects the malformed shard %s", (spec) => {
    expect(() => parseShard(spec)).toThrow(/bad shard/);
  });

  it("indexes by position: shard k holds the cases at i % N == k", () => {
    const cases = ["a", "b", "c", "d", "e"].map((name) => ({ name }));
    expect(selectShard(cases, { index: 0, count: 2 }).map((c) => c.name)).toEqual(["a", "c", "e"]);
    expect(selectShard(cases, { index: 1, count: 2 }).map((c) => c.name)).toEqual(["b", "d"]);
  });
});

describe("the sharded workflows", () => {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const LEGS = ["dotnet", "dapper", "java", "mikroorm", "python"];

  it.each(
    LEGS,
  )("behavioral-e2e-%s fans out into exactly the shards the selector partitions by", (leg) => {
    const yml = readFileSync(
      path.join(repo, `.github/workflows/behavioral-e2e-${leg}.yml`),
      "utf8",
    );
    // matrix size and the `/N` the runner is told must be the same N, and the
    // matrix must list every K in 0..N-1 — a missing K is a half nobody runs.
    expect(yml).toMatch(/^\s+shard: \[0, 1\]$/m);
    expect(yml).toContain("LOOM_BH_SHARD: ${{ matrix.shard }}/2");
    expect(yml).toContain(`name: behavioral-${leg} (shard \${{ matrix.shard }}/2)`);
    // fail-fast would cancel the sibling half and hide its verdict
    expect(yml).toMatch(/fail-fast: false/);
  });
});
