// The ratchet on `ADAPTER_ONLY_CASES` (registers.mjs) — corpus cases armed on
// one persistence adapter's behavioural leg beyond the manifest's backend set.
//
// An entry adds a gate; it must not outlive its reason.  So each entry has to
// name a real corpus case that carries an e2e block, must NOT already be covered
// by the manifest for the clause's backend (then the exit has landed and the
// entry is dead weight), and must name the mission / PR that retires it.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import { ADAPTER_ONLY_CASES, declaresE2e } from "./registers.mjs";

const CORPUS_DIR = path.join(import.meta.dirname, "..", "fixtures", "corpus");

/** The manifest backend key each adapter clause's runner hands `featureCases`. */
const BACKEND_OF_CLAUSE: Record<string, string> = {
  "dotnet { persistence: dapper }": "dotnet",
};

const entries = Object.entries(ADAPTER_ONLY_CASES).flatMap(([clause, cases]) =>
  Object.entries(cases).map(([id, reason]) => ({ clause, id, reason })),
);

describe("ADAPTER_ONLY_CASES stays live and small", () => {
  it("every clause is a known adapter runner clause", () => {
    expect(Object.keys(ADAPTER_ONLY_CASES).filter((c) => !(c in BACKEND_OF_CLAUSE))).toEqual([]);
  });

  it("every entry names a corpus case with an e2e block", () => {
    const bad = entries.filter(({ id }) => {
      const file = path.join(CORPUS_DIR, `${id}.ddd`);
      return (
        !CORPUS.some((f) => f.id === id) ||
        !fs.existsSync(file) ||
        !declaresE2e(fs.readFileSync(file, "utf8"))
      );
    });
    expect(bad.map((e) => `${e.clause} / ${e.id}`)).toEqual([]);
  });

  it("no entry is already declared for its backend by the manifest (stale — delete it)", () => {
    const stale = entries.filter(({ clause, id }) =>
      CORPUS.find((f) => f.id === id)?.backends.includes(BACKEND_OF_CLAUSE[clause] as never),
    );
    expect(stale.map((e) => `${e.clause} / ${e.id}`)).toEqual([]);
  });

  it("every reason names the mission or PR that retires it", () => {
    expect(entries.filter((e) => !/M-T\d+\.\d+|#\d+/.test(e.reason)).map((e) => e.id)).toEqual([]);
  });
});
