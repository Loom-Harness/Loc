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

const WRITE_NAMES = ["save", "insert", "update", "delete", "add", "remove", "commit"];
const READ_NAMES = ["getById", "find", "findAll", "findByEmail", "query", "count", "load"];

describe("the contract table", () => {
  it("maps every built-in verb to its canonical op", () => {
    expect(Object.fromEntries(REPOSITORY_CONTRACT.map((c) => [c.verb, c.op]))).toStrictEqual({
      getById: "load",
      findById: "load-optional",
      getBy: "load-by-key",
      findBy: "load-by-key-optional",
      find: "select-one",
      findAll: "select-many",
      all: "select-many",
      run: "select-many",
      delete: "remove",
      remove: "remove",
    });
  });

  it("names each verb once", () => {
    const verbs = REPOSITORY_CONTRACT.map((c) => c.verb);
    expect(new Set(verbs).size).toBe(verbs.length);
  });

  it("gives each op one result shape", () => {
    for (const c of REPOSITORY_CONTRACT) {
      if (c.op === "declared-find") continue;
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
    expect(repoOpVerb("load")).toBe("getById");
    expect(repoOpVerb("load-optional")).toBe("findById");
    expect(repoOpVerb("select-many", "retrieval-or-criterion")).toBe("run");
    expect(() => repoOpVerb("declared-find")).toThrow();
  });

  it("looks a verb up by its exact spelling", () => {
    expect(repositoryVerb("getById")?.op).toBe("load");
    expect(repoVerbOp("GetById")).toBeUndefined();
    expect(repoVerbOp("byCode")).toBeUndefined();
  });

  it("accepts in a context integration test only the by-name reads it renders", () => {
    expect(
      REPOSITORY_CONTRACT.filter((c) => isRepoVerbAt(c.verb, "integration-test")).map(
        (c) => c.verb,
      ),
    ).toStrictEqual(["getById", "findById", "findAll"]);
  });
});

describe("named repository calls", () => {
  it("a declared find wins over a contract verb of the same name", () => {
    expect(namedRepoCallOp("all", true)).toBe("declared-find");
    expect(namedRepoCallOp("byCode", true)).toBe("declared-find");
  });

  it("a by-name contract verb resolves to its op", () => {
    expect(namedRepoCallOp("getById", false)).toBe("load");
    expect(namedRepoCallOp("findById", false)).toBe("load-optional");
    expect(namedRepoCallOp("findAll", false)).toBe("select-many");
    expect(namedRepoCallOp("all", false)).toBe("select-many");
  });

  it("a reference-taking verb is not resolved by name alone", () => {
    expect(namedRepoCallOp("find", false)).toBeUndefined();
    expect(namedRepoCallOp("run", false)).toBeUndefined();
  });

  it("a natural-key verb is not resolved by name alone (its tuple decides the method)", () => {
    expect(namedRepoCallOp("getBy", false)).toBeUndefined();
    expect(namedRepoCallOp("findBy", false)).toBeUndefined();
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
