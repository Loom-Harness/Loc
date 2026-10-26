import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BACKENDS } from "../fixtures/corpus/backends.js";
import { CORPUS } from "../fixtures/corpus/manifest.js";
import { OUTCOMES, settle } from "./case-loop.mjs";
import {
  ADAPTER_ONLY_CASES,
  BEHAVIOURAL_SKIP,
  BEHAVIOURAL_XFAIL,
  type ExpectedFailure,
  hasBehaviouralBlock,
  LEG_BACKEND,
  LEGS,
  RACE_PROBE_TEST,
} from "./registers.mjs";

// ---------------------------------------------------------------------------
// The expected-failure register's own gate (#3595), plus the rule it exists for:
// EVERY behavioural corpus fixture runs on ALL FIVE backends.
//
// Before the register, a backend that got a fixture wrong left the fixture's
// manifest row (`backends: ALL.filter(...)`) and its behavioural leg simply
// never booted it — the debt was a comment beside an alias.  Now a cell is
// either booted green, or booted as a tracked expected failure whose entry
// names the issue that fixes it and fails the leg the day it passes.  This
// file holds that without booting anything: the settling rule the seven legs
// share, the register's shape, and the matrix.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = path.join(HERE, "..", "fixtures", "corpus");

type Entry = ExpectedFailure;
const XFAIL = BEHAVIOURAL_XFAIL;
const SKIP = BEHAVIOURAL_SKIP as Record<string, Record<string, string>>;
const ADAPTER_ONLY = ADAPTER_ONLY_CASES as Record<string, Record<string, string>>;

/** The platform clause each leg's skip / adapter-only registers are keyed by. */
const LEG_CLAUSE: Record<string, string> = {
  node: "node",
  mikroorm: "node",
  dotnet: "dotnet",
  dapper: "dotnet { persistence: dapper }",
  java: "java",
  python: "python",
  elixir: "elixir",
};

const behaviouralFeatures = CORPUS.filter((f) =>
  hasBehaviouralBlock(fs.readFileSync(path.join(CORPUS_DIR, `${f.id}.ddd`), "utf8")),
);

describe("settle — the rule every runner leg judges an expected failure by", () => {
  const failEntry: Entry = {
    issue: "#1",
    expect: "fail",
    tests: { "block A": "boom", "block B": "bang" },
    reason: "r",
  };
  const failures = (...fs: [string, string][]) => ({
    kind: "fail",
    failures: fs.map(([name, error]) => ({ name, error })),
  });

  it("a case with no entry is the leg's ordinary business", () => {
    expect(settle(null, { kind: "fail", failures: [] }).verdict).toBe("ok");
  });

  it("the recorded failing set, failing the recorded way, is an expected failure", () => {
    expect(
      settle(
        failEntry,
        failures(["block A against d", "it went boom"], ["block B against d", "bang!"]),
      ).verdict,
    ).toBe("xfail");
  });

  it("a PASS is the ratchet: the entry must be deleted", () => {
    const v = settle(failEntry, { kind: "pass" });
    expect(v.verdict).toBe("xpass");
    expect(v.detail).toContain("delete its BEHAVIOURAL_XFAIL entry");
  });

  it("a recorded block that passes again narrows the entry rather than hiding behind it", () => {
    const v = settle(failEntry, failures(["block A against d", "boom"]));
    expect(v.verdict).toBe("mismatch");
    expect(v.detail).toContain('"block B" (#1) no longer fails');
  });

  it("a NEW failing block is never absorbed by an entry written for others", () => {
    const v = settle(
      failEntry,
      failures(["block A", "boom"], ["block B", "bang"], ["block C", "boom"]),
    );
    expect(v.verdict).toBe("mismatch");
    expect(v.detail).toContain("UNRECORDED failure");
  });

  it("a recorded block failing for a different reason is a mismatch", () => {
    expect(
      settle(failEntry, failures(["block A", "boom"], ["block B", "a 500 instead"])).verdict,
    ).toBe("mismatch");
  });

  it("another outcome kind is a mismatch — a build break is not the runtime defect", () => {
    const v = settle(failEntry, { kind: "error", message: "Command failed: dotnet build" });
    expect(v.verdict).toBe("mismatch");
    expect(v.detail).toContain("failed as `error`");
  });

  it("an error entry pins its message", () => {
    const e: Entry = {
      issue: "#2",
      expect: "error",
      match: "loom\\.example-refusal",
      reason: "r",
    };
    expect(settle(e, { kind: "error", message: "… loom.example-refusal …" }).verdict).toBe("xfail");
    expect(settle(e, { kind: "error", message: "ECONNREFUSED" }).verdict).toBe("mismatch");
  });

  describe("a `race` entry — a defect only overlapping requests can show", () => {
    const race: Entry = {
      issue: "#3",
      expect: "fail",
      tests: { [RACE_PROBE_TEST]: "pair \\d+: 204, 204" },
      race: "r",
      reason: "r",
    };
    const probe = `${RACE_PROBE_TEST}: exactly one 409 per pair (/api/docs/{id}/rename)`;

    it("settles a run where the race overlapped as expected", () => {
      expect(settle(race, failures([probe, "pair 1: 204, 204"])).verdict).toBe("xfail");
    });

    it("settles a run where the race did NOT overlap as expected too — not as the ratchet", () => {
      expect(settle(race, { kind: "pass" }).verdict).toBe("xfail");
    });

    it("still refuses every failure it does not pin, and every other outcome kind", () => {
      expect(
        settle(race, failures([probe, "pair 1: 204, 204"], ["the e2e block", "boom"])).verdict,
      ).toBe("mismatch");
      expect(settle(race, failures([probe, "pair 1: 200, 500"])).verdict).toBe("mismatch");
      expect(settle(race, { kind: "wire" }).verdict).toBe("mismatch");
    });

    it("is the only kind of entry that forgives a pass", () => {
      const { race: _r, ...strict } = race;
      expect(settle(strict, { kind: "pass" }).verdict).toBe("xpass");
    });
  });
});

describe("BEHAVIOURAL_XFAIL — the register's shape", () => {
  const entries = Object.entries(XFAIL).flatMap(([leg, cases]) =>
    Object.entries(cases).map(([name, e]) => ({ leg, name, e })),
  );

  it("is keyed by the seven runner legs exactly", () => {
    expect(Object.keys(XFAIL).sort()).toEqual([...LEGS].sort());
  });

  it("names real corpus cases only", () => {
    const ids = new Set(CORPUS.map((f) => f.id));
    expect(entries.filter((x) => !ids.has(x.name)).map((x) => `${x.leg}/${x.name}`)).toEqual([]);
  });

  it("links every entry to an issue and gives it a reason", () => {
    const bad = entries.filter((x) => !/^#\d+(, #\d+)*$/.test(x.e.issue) || !x.e.reason?.trim());
    expect(bad.map((x) => `${x.leg}/${x.name}: ${JSON.stringify(x.e.issue)}`)).toEqual([]);
  });

  it("pins every entry in the form its outcome kind needs", () => {
    const bad = entries.filter(({ e }) => {
      if (!OUTCOMES.includes(e.expect)) return true;
      if (e.expect === "error") return !e.match;
      if (e.expect === "fail") return !e.tests || Object.keys(e.tests).length === 0;
      return false;
    });
    expect(bad.map((x) => `${x.leg}/${x.name}`)).toEqual([]);
    // A pin that does not compile would throw on the booted leg instead of
    // judging anything.
    for (const { e } of entries) {
      for (const re of [e.match, ...Object.values(e.tests ?? {})])
        if (re) expect(() => new RegExp(re)).not.toThrow();
    }
  });

  it("a `race` entry pins only the two-writer probe, so no deterministic failure can hide behind it", () => {
    const bad = entries.filter(
      ({ e }) =>
        e.race !== undefined &&
        (e.expect !== "fail" ||
          !e.race.trim() ||
          Object.keys(e.tests ?? {}).some((name) => name !== RACE_PROBE_TEST)),
    );
    expect(bad.map((x) => `${x.leg}/${x.name}`)).toEqual([]);
  });

  it("the two-writer case forgives a non-overlapping run on java (#3521) only; every other leg stays strict", () => {
    const java = XFAIL.java?.["concurrency-two-writers"] ?? null;
    expect(java?.race).toBeTruthy();
    expect(settle(java, { kind: "pass" }).verdict).toBe("xfail");
    for (const leg of LEGS.filter((l) => l !== "java")) {
      expect(XFAIL[leg]?.["concurrency-two-writers"]?.race, leg).toBeUndefined();
    }
  });

  it("the probe's test name is the one a `race` entry pins", () => {
    const preamble = fs.readFileSync(path.join(HERE, "wire-differential.mjs"), "utf8");
    expect(preamble).toContain(`const name = "${RACE_PROBE_TEST}: `);
  });

  it("only boots cases that carry a behavioural block", () => {
    const behavioural = new Set(behaviouralFeatures.map((f) => f.id));
    expect(
      entries.filter((x) => !behavioural.has(x.name)).map((x) => `${x.leg}/${x.name}`),
    ).toEqual([]);
  });

  it("never names a cell a skip register also drops — one cell, one disposition", () => {
    const both = entries.filter((x) => x.name in (SKIP[LEG_CLAUSE[x.leg]] ?? {}));
    expect(both.map((x) => `${x.leg}/${x.name}`)).toEqual([]);
  });
});

describe("every behavioural corpus fixture runs on all five backends (#3595)", () => {
  /** The leg that boots a backend's DEFAULT adapter. */
  const DEFAULT_LEG = Object.fromEntries(
    LEGS.filter((l) => l !== "mikroorm" && l !== "dapper").map((l) => [
      (LEG_BACKEND as Record<string, string>)[l],
      l,
    ]),
  ) as Record<string, string>;

  const boots = (leg: string, f: (typeof CORPUS)[number]) => {
    const backend = (LEG_BACKEND as Record<string, string>)[leg];
    const declared = (f.backends as readonly string[]).includes(backend);
    const clause = LEG_CLAUSE[leg];
    return (
      ((declared || f.id in (ADAPTER_ONLY[clause] ?? {})) && !(f.id in (SKIP[clause] ?? {}))) ||
      f.id in (XFAIL[leg] ?? {})
    );
  };

  it("derives a non-trivial fixture set", () => {
    expect(behaviouralFeatures.length).toBeGreaterThan(60);
  });

  it("every default-adapter leg boots every behavioural fixture", () => {
    expect(Object.keys(DEFAULT_LEG).sort()).toEqual([...BACKENDS].sort());
    const missing = behaviouralFeatures.flatMap((f) =>
      BACKENDS.filter((b) => !boots(DEFAULT_LEG[b], f)).map((b) => `${f.id} × ${b}`),
    );
    expect(
      missing,
      "\nThese cells are never booted: the manifest row does not declare the backend (or a\n" +
        "BEHAVIOURAL_SKIP entry drops it) and no BEHAVIOURAL_XFAIL entry boots it as a\n" +
        "tracked expected failure.  Boot the cell — declare the backend if it passes, or add\n" +
        "an entry to test/behavioral/registers.mjs linked to the issue that fixes it.\n",
    ).toEqual([]);
  });

  it("the persistence-adapter legs boot every fixture their backend owes", () => {
    const missing = behaviouralFeatures.flatMap((f) =>
      ["mikroorm", "dapper"].filter((leg) => !boots(leg, f)).map((leg) => `${f.id} × ${leg}`),
    );
    expect(missing).toEqual([]);
  });
});
