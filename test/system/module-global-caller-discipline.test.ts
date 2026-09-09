// The CALLER half of the module-global census.
//
// `module-global-state-census.test.ts` proves every module global in `src/`
// HAS a discipline.  It cannot prove any given test file HONOURS it — a
// `test-reset-hook` entry is satisfied by the hook merely existing, so a file
// that calls the mutator and never the restorer passes that census untouched.
// This one closes that: for every mutator of a pinned global, the file calling
// it must dispose of what it wrote.
//
// Three dispositions count as disposal, and the third is why this is a table
// rather than a rule:
//
//   teardown-restore    the paired restorer runs in `afterEach`/`afterAll`, so
//                       it covers every `it` in the file, not just the one that
//                       happened to call it last.
//   snapshot-replay     the file snapshots the global before and replays it
//                       after — the only correct shape when the mutation is a
//                       WIPE, since there is nothing for a restorer to restore.
//   additive-permanent  a uniquely-named entry, registered idempotently behind
//                       a `lookupMacro` guard and deliberately never removed.
//                       Sound only while no reader asserts an EXACT global set;
//                       the reason field has to say why that holds.
//
// Anything else fails.  A new mutation site in a new file fails as UNDISPOSED
// until it is given one of the three — and a site that disappears fails as
// STALE, so the table cannot accumulate entries for code that is gone.
//
// Why this is worth its own gate: file execution inside a worker does not
// interleave, so an unrestored write is usually harmless *today* and becomes a
// failure only when someone later adds a reader that enumerates the whole
// registry — or extends the leaked entry so an existing enumerator trips on it.
// That is the shape that produced the `clickhouseCloud` red: the write and the
// assertion that caught it were added years apart, in files that never
// reference each other.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/** Mutator of a pinned module global → the restorer that undoes it, or `null`
 *  when the toolchain exposes no undo for it.
 *
 *  `registerMacro` is deliberately `null`, and getting that wrong is how this
 *  file was first written: `_resetRegistryForTests` looks like its restorer and
 *  is not — it WIPES the registry, so it is a second mutator.  Treating it as a
 *  restorer made "calls `_resetRegistryForTests` in a teardown" count as
 *  disposal, which would have passed a file that emptied the shared registry on
 *  its way out and left every later file in the worker with nothing.  A
 *  `null` restorer means the site MUST carry a waiver naming a real shape. */
const PAIRS: Record<string, string | null> = {
  registerSourceType: "_unregisterSourceTypeForTests",
  discoverSourceTypePlugins: "_unregisterSourceTypeForTests",
  bootSourceTypePlugins: "_unregisterSourceTypeForTests",
  setBackendSource: "resetBackendSource",
  setBackendVersionSource: "resetBackendVersionSource",
  registerMacro: null,
};

const TEARDOWN_HOOKS = new Set(["afterEach", "afterAll"]);

type Disposition = "teardown-restore" | "snapshot-replay" | "additive-permanent";

interface Waiver {
  disposition: Exclude<Disposition, "teardown-restore">;
  reason: string;
}

/** Sites whose disposal is NOT a paired restorer in a teardown.  key = "<file>:<mutator>". */
const WAIVED: Record<string, Waiver> = {
  "test/macro/expander-unit.test.ts:registerMacro": {
    disposition: "additive-permanent",
    reason:
      "`ensure()` registers `__unitTest_*` macros behind a `lookupMacro` guard, so the " +
      "call is idempotent across repeat imports and the names cannot collide with the " +
      "stdlib or another file's fixtures.  Sound because no reader asserts an exact " +
      "registry set: `registry-unit.test.ts` snapshots `allMacros()` itself and compares " +
      "against its own snapshot, so an extra entry registered before it is carried " +
      "through the replay rather than tripping it.",
  },
  "test/macro/misbehaving-macro-diagnostics.test.ts:registerMacro": {
    disposition: "additive-permanent",
    reason:
      "Same `ensure()` shape, for the `loomTestMacroThatThrows` family.  These must " +
      "outlive the file: the diagnostics under test are raised by the EXPANDER when it " +
      "looks the macro up during a later `validate()`, so removing them in a teardown " +
      "would make the fixtures unresolvable.",
  },
  "test/macro/registry-unit.test.ts:registerMacro": {
    disposition: "snapshot-replay",
    reason:
      "This file WIPES the registry (`_resetRegistryForTests`), so a restorer cannot " +
      "restore it — nothing remembers the contents.  It instead snapshots `allMacros()` " +
      "in `beforeAll` and replays it in `afterAll`, in order, because `lookupMacro` " +
      "collision behaviour depends on registration order.  A following `it` re-asserts " +
      "the registry is whole, so the replay is proven to have run rather than assumed.",
  },
};

// ---------------------------------------------------------------------------

interface Site {
  file: string;
  mutator: string;
  restorer: string | null;
  restorerInTeardown: boolean;
}

function testFiles(): string[] {
  return execFileSync("find", ["test", "-name", "*.test.ts", "-not", "-path", "test/fixtures/*"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

function scan(): Site[] {
  const sites: Site[] = [];
  const restorers = new Set(Object.values(PAIRS).filter((r): r is string => r !== null));

  for (const file of testFiles()) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    const mutators = new Set<string>();
    const restorersInTeardown = new Set<string>();

    const walk = (node: ts.Node, inTeardown: boolean): void => {
      let teardown = inTeardown;
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        TEARDOWN_HOOKS.has(node.expression.text)
      ) {
        teardown = true;
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name in PAIRS) mutators.add(name);
        if (restorers.has(name) && teardown) restorersInTeardown.add(name);
      }
      ts.forEachChild(node, (child) => walk(child, teardown));
    };
    ts.forEachChild(sf, (child) => walk(child, false));

    for (const mutator of [...mutators].sort()) {
      const restorer = PAIRS[mutator];
      sites.push({
        file,
        mutator,
        restorer,
        restorerInTeardown: restorer !== null && restorersInTeardown.has(restorer),
      });
    }
  }
  return sites;
}

describe("callers of module-global mutators dispose of what they write", () => {
  const sites = scan();

  it("finds at least the known mutation sites — the scan is not silently empty", () => {
    // A scan that matches nothing passes every other assertion in this file.
    // This is the control: without it, renaming a mutator (or breaking the
    // walker) turns the whole gate green while it checks nothing.
    expect(sites.length).toBeGreaterThanOrEqual(6);
    expect(sites.map((s) => s.mutator).filter((m) => m === "registerMacro").length).toBe(3);
  });

  it("leaves nothing undisposed", () => {
    const undisposed = sites
      .filter((s) => !s.restorerInTeardown && !(`${s.file}:${s.mutator}` in WAIVED))
      .map((s) =>
        s.restorer === null
          ? `${s.file}: ${s.mutator}() writes shared state and has NO restorer — it needs a waiver`
          : `${s.file}: ${s.mutator}() writes shared state; ${s.restorer}() is not in a teardown`,
      );
    expect(
      undisposed,
      undisposed.length === 0
        ? ""
        : `${undisposed.length} mutation site(s) leave module-global state behind.\n` +
            `Under \`isolate: false\` that outlives the file.  Either call ` +
            `the paired restorer from \`afterEach\`/\`afterAll\`, or add a WAIVED entry ` +
            `stating which of snapshot-replay / additive-permanent applies and why:\n  ` +
            undisposed.join("\n  "),
    ).toEqual([]);
  });

  it("has no stale waivers — a waiver dies with the site it covers", () => {
    const live = new Set(sites.map((s) => `${s.file}:${s.mutator}`));
    const stale = Object.keys(WAIVED).filter((k) => !live.has(k));
    expect(
      stale,
      stale.length === 0
        ? ""
        : `${stale.length} waiver(s) cover a site that no longer exists.  Delete them in ` +
            `the same change that removed the call:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("never waives a site that already restores properly", () => {
    // A waiver over a site with a real teardown is dead weight that outlives
    // its reason — the next reader trusts the waiver's prose over the code.
    const redundant = sites
      .filter((s) => s.restorerInTeardown && `${s.file}:${s.mutator}` in WAIVED)
      .map((s) => `${s.file}:${s.mutator}`);
    expect(redundant, `waived but already restored in a teardown: ${redundant.join(", ")}`).toEqual(
      [],
    );
  });

  it("every `snapshot-replay` waiver names a file that really snapshots and replays", () => {
    // Otherwise the disposition is a word.  The shape is a read of the global
    // before and a re-registration after — assert both are present.
    const broken: string[] = [];
    for (const [key, waiver] of Object.entries(WAIVED)) {
      if (waiver.disposition !== "snapshot-replay") continue;
      const src = readFileSync(key.split(":")[0], "utf8");
      if (!/before(All|Each)\s*\(/.test(src)) broken.push(`${key}: no before* hook to snapshot in`);
      if (!/after(All|Each)\s*\(/.test(src)) broken.push(`${key}: no after* hook to replay in`);
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });
});
