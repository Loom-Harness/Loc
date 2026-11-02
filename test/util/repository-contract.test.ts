import { describe, expect, it } from "vitest";
import {
  isRepoVerbAt,
  isRepoWriteName,
  namedRepoCallOp,
  REPOSITORY_CONTRACT,
  repoOpResult,
  repoOpVerb,
  repositoryVerb,
  repoVerbOp,
  resolveKeyTuple,
} from "../../src/util/repository-contract.js";

// The declared repository contract is the one table typing, lowering, the IR
// validators and the emitters consult.  Each row below is pinned because each
// has a consumer that breaks when it moves: `load` → the not-found rung and the
// .NET throw guard; `load-optional` / `select-one` → the nullable gates and the
// `if let` source; `select-many` → collection typing; `remove` → the
// domain-service purity gate.

// `delete` is a retired verb (refused by `loom.repo-verb-renamed`), so it classifies as nothing.
const WRITE_NAMES = ["save", "insert", "update", "add", "remove", "commit"];
const READ_NAMES = ["getById", "find", "findAll", "findByEmail", "query", "count", "load"];

describe("the contract table", () => {
  it("maps every built-in verb and argument shape to its canonical op", () => {
    expect(REPOSITORY_CONTRACT.map((c) => [c.verb, c.args, c.op])).toStrictEqual([
      ["get", "id", "load"],
      ["find", "id", "load-optional"],
      ["find", "criterion", "select-one"],
      ["getBy", "key", "load-by-key"],
      ["findBy", "key", "load-by-key-optional"],
      ["all", "query-or-none", "select-many"],
      ["remove", "entity", "remove"],
    ]);
  });

  it("names each verb and argument shape once", () => {
    const keys = REPOSITORY_CONTRACT.map((c) => `${c.verb}/${c.args}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the IR method names the emitters render", () => {
    expect(REPOSITORY_CONTRACT.map((c) => [c.verb, c.args, c.method])).toStrictEqual([
      ["get", "id", "getById"],
      ["find", "id", "findById"],
      ["find", "criterion", "find"],
      ["getBy", "key", ""],
      ["findBy", "key", ""],
      ["all", "query-or-none", "findAll"],
      ["remove", "entity", ""],
    ]);
  });

  it("gives each op one result shape", () => {
    for (const c of REPOSITORY_CONTRACT) {
      if (c.op === "unknown-read") continue;
      expect(repoOpResult(c.op), c.verb).toBe(c.result);
    }
    expect(repoOpResult("load")).toBe("row");
    expect(repoOpResult("load-optional")).toBe("optional-row");
    expect(repoOpResult("load-by-key")).toBe("row");
    expect(repoOpResult("load-by-key-optional")).toBe("optional-row");
    expect(repoOpResult("select-one")).toBe("optional-row");
    expect(repoOpResult("select-many")).toBe("rows");
    expect(repoOpResult("remove")).toBe("none");
  });

  it("only the write ops are the write face", () => {
    for (const c of REPOSITORY_CONTRACT) {
      expect(c.face === "write", c.verb).toBe(c.op === "remove");
    }
  });

  it("spells an op back to its surface verb", () => {
    expect(repoOpVerb("load")).toBe("get");
    expect(repoOpVerb("load-optional")).toBe("find");
    expect(repoOpVerb("select-one", "criterion")).toBe("find");
    expect(repoOpVerb("select-many")).toBe("all");
    expect(repoOpVerb("remove")).toBe("remove");
    expect(() => repoOpVerb("unknown-read")).toThrow();
  });

  it("looks a verb up by its exact spelling", () => {
    expect(repositoryVerb("get")?.op).toBe("load");
    expect(repositoryVerb("find")?.op).toBe("load-optional");
    expect(repoVerbOp("Get")).toBeUndefined();
    expect(repoVerbOp("byCode")).toBeUndefined();
  });

  it("does not resolve a retired verb", () => {
    for (const old of ["getById", "findById", "findAll", "run", "delete"]) {
      expect(repositoryVerb(old), old).toBeUndefined();
    }
  });

  it("accepts in a context integration test only the by-name reads it renders", () => {
    expect(
      [...new Set(REPOSITORY_CONTRACT.map((c) => c.verb))].filter((v) =>
        isRepoVerbAt(v, "integration-test"),
      ),
    ).toStrictEqual(["get", "find", "all"]);
  });
});

describe("named repository calls", () => {
  it("a name no contract verb spells resolves to nothing", () => {
    expect(namedRepoCallOp("byCode")).toBeUndefined();
  });

  it("a by-name contract verb resolves to its value-argument op", () => {
    expect(namedRepoCallOp("get")).toBe("load");
    expect(namedRepoCallOp("find")).toBe("load-optional");
    expect(namedRepoCallOp("all")).toBe("select-many");
  });

  it("a natural-key verb is not resolved by name alone (its tuple decides the method)", () => {
    expect(namedRepoCallOp("getBy")).toBeUndefined();
    expect(namedRepoCallOp("findBy")).toBeUndefined();
  });
});

describe("natural-key tuple resolution", () => {
  const tuples = [["sku"], ["region", "name"]];

  it("matches a tuple exactly, in any argument order, in declared column order", () => {
    expect(resolveKeyTuple(["sku"], tuples)).toEqual({ kind: "match", tuple: ["sku"] });
    expect(resolveKeyTuple(["name", "region"], tuples)).toEqual({
      kind: "match",
      tuple: ["region", "name"],
    });
  });

  it("reports a partial tuple with its missing columns", () => {
    expect(resolveKeyTuple(["name"], tuples)).toEqual({
      kind: "incomplete",
      tuple: ["region", "name"],
      missing: ["region"],
    });
  });

  it("reports a positional argument, and a name set no tuple covers", () => {
    expect(resolveKeyTuple([undefined], tuples)).toEqual({ kind: "positional" });
    expect(resolveKeyTuple(["sku", "name"], tuples)).toEqual({ kind: "not-unique" });
    expect(resolveKeyTuple(["sku"], [])).toEqual({ kind: "not-unique" });
  });
});

describe("repository write classification", () => {
  it("treats the persistence names as writes", () => {
    for (const name of WRITE_NAMES) expect(isRepoWriteName(name), name).toBe(true);
  });

  it("treats every other named method as a read", () => {
    for (const name of READ_NAMES) expect(isRepoWriteName(name), name).toBe(false);
  });

  it("is case-sensitive — `Save`/`SAVE` are reads, not the `save` write", () => {
    expect(isRepoWriteName("Save")).toBe(false);
    expect(isRepoWriteName("SAVE")).toBe(false);
  });

  it("does not treat write-name prefixes/suffixes as writes", () => {
    // Guards against a naive substring check creeping in.
    for (const near of ["saveAll", "updated", "deletion", "addable", "removeMany"]) {
      expect(isRepoWriteName(near), near).toBe(false);
    }
  });
});
