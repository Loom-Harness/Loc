import { describe, expect, it } from "vitest";
import { BACKENDS } from "../fixtures/corpus/backends.js";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

// ---------------------------------------------------------------------------
// Ledger row F2-XB-4 — the folded-projection fold body renders its WHOLE pure
// statement vocabulary on every backend.
//
// `checkProjections` (`src/ir/validate/checks/projection-checks.ts`,
// `foldImpurity`) admits exactly four `StmtIR` kinds inside a `projection …
// on(e) { }` body: `assign`, `let`, `add` (`+=`) and `remove` (`-=`).  Only
// hono rendered all four.  .NET / java / elixir filtered the body down to
// `kind === "assign"` and python delegated the rest to the EVENT-SOURCED
// applier renderer — so the SAME model produced, on four of five backends, a
// handler that either named an identifier nothing bound or silently never wrote
// the column the model says accumulates.  Neither failure has a diagnostic:
// generation succeeds, `ddd parse` is clean, and three of the four shapes do
// not even fail to compile.
//
// THE AXIS THE BUG TRAVELS ON (rule 11) is the STATEMENT KIND, so this gate
// sweeps every admitted kind × every backend rather than spot-checking one: a
// backend that learns `let` but keeps dropping `+=` still goes red here.  Each
// arm asserts on the read-model WRITE the statement must produce, never on the
// emitter's spelling of it — the expected VALUE comes from the fixture's own
// `.ddd` (`entries += e.amount`), not from the emitter under test.
//
// The fold handler bodies live in different files per backend (one class per
// fold on .NET, one dispatcher for the whole context on java/python/elixir, one
// `projections.ts` module on node), so each arm reads the whole emitted tree and
// asserts over the file that carries the fold — with a VACUITY GUARD first, so a
// fixture rename or a dropped handler fails as a missing fold rather than
// passing as a satisfied `not.toContain`.
// ---------------------------------------------------------------------------

const FIXTURE = "projection-fold-statements";

/** The emitted file(s) carrying the `AccountBoard` folds, per backend.  node /
 *  java / python pool both folds into one module; .NET and elixir emit one file
 *  PER fold, so the predicate matches a SET and the arms read the concatenation
 *  — the fixture splits its statement kinds across the two folds on purpose (the
 *  `-=` arms fold `AccountClosed`, the `+=`-only arms fold `AccountOpened`). */
const FOLD_FILES: Record<string, (p: string) => boolean> = {
  node: (p) => p.endsWith("/http/projections.ts"),
  dotnet: (p) => /AccountBoardOnAccount(Opened|Closed)Handler\.cs$/.test(p),
  java: (p) => p.endsWith("LedgerDispatcher.java"),
  python: (p) => p.endsWith("/app/dispatch.py"),
  vanilla: (p) => /on_account_(opened|closed)\.ex$/.test(p),
};

/** Every emitted fold body for the fixture, concatenated in path order. */
function foldBodies(files: Map<string, string>, backend: string): string {
  return [...files.keys()]
    .filter(FOLD_FILES[backend]!)
    .sort()
    .map((k) => files.get(k)!)
    .join("\n");
}

/** What each backend's fold must contain, per admitted statement kind.  The
 *  regexes are anchored on the WRITE (the row field being set / accumulated),
 *  not on incidental syntax, so a legitimate respelling of the surrounding
 *  handler does not fail them while a dropped statement does. */
const ARMS: Record<string, Record<string, RegExp>> = {
  node: {
    // `let stamped = e.at` — bound, and the assignment that reads it resolves.
    let: /const stamped = e\.at;[\s\S]*state\.at = stamped;/,
    "add (int)": /state\.entries = \(state\.entries \?\? 0\) \+ e\.amount/,
    "add (money)": /state\.charged = new Decimal\(state\.charged \?\? 0\)\.plus\(e\.fee\)/,
    "remove (int)": /state\.entries = \(state\.entries \?\? 0\) - e\.amount/,
    "remove (collection)": /state\.tags = \(state\.tags \?\? \[\]\)\.filter\(/,
  },
  dotnet: {
    let: /var stamped = notification\.At;[\s\S]*state\.At = stamped;/,
    "add (int)": /state\.Entries = \(state\.Entries \?\? 0\) \+ notification\.Amount/,
    "add (money)": /state\.Charged = \(state\.Charged \?\? 0\) \+ notification\.Fee/,
    "remove (int)": /state\.Entries = \(state\.Entries \?\? 0\) - notification\.Amount/,
    "remove (collection)": /state\.Tags\.Remove\(notification\.Tag\)/,
  },
  java: {
    let: /var stamped = e\.at\(\);[\s\S]*state\.setAt\(stamped\);/,
    "add (int)": /state\.setEntries\(state\.entries\(\) \+ e\.amount\(\)\)/,
    // BigDecimal has no `+` — the money arm must reach `.add`, null-guarded.
    "add (money)":
      /state\.setCharged\(\(state\.charged\(\) == null \? [\w.]*BigDecimal\.ZERO : state\.charged\(\)\)\.add\(e\.fee\(\)\)\)/,
    "remove (int)": /state\.setEntries\(state\.entries\(\) - e\.amount\(\)\)/,
    "remove (collection)": /state\.tags\(\)\.remove\(e\.tag\(\)\)/,
  },
  python: {
    let: /\n {4}stamped = e\.at\n[\s\S]*state\.at = stamped/,
    "add (int)": /state\.entries = \(state\.entries or 0\) \+ e\.amount/,
    "add (money)": /state\.charged = \(state\.charged or 0\) \+ e\.fee/,
    "remove (int)": /state\.entries = \(state\.entries or 0\) - e\.amount/,
    "remove (collection)":
      /state\.tags = \[__e for __e in \(state\.tags or \[\]\) if __e != \(e\.tag\)\]/,
  },
  vanilla: {
    // The `let` is a real local BEFORE the changeset, not a change entry.
    let: /\n {4}stamped = event\.at\n[\s\S]*at: \(stamped\)/,
    "add (int)": /entries: \(state\.entries \|\| 0\) \+ event\.amount/,
    // Decimal structs have no `+` — the money arm must reach `Decimal.add/2`.
    "add (money)": /charged: Decimal\.add\(state\.charged \|\| Decimal\.new\(0\), event\.fee\)/,
    "remove (int)": /entries: \(state\.entries \|\| 0\) - event\.amount/,
    "remove (collection)": /tags: List\.delete\(state\.tags \|\| \[\], event\.tag\)/,
  },
};

describe("F2-XB-4 — a folded projection renders every admitted fold statement", () => {
  for (const backend of BACKENDS) {
    describe(backend, () => {
      it(`emits the ${FIXTURE} folds at all (vacuity guard)`, async () => {
        const files = await generateCorpusCase(FIXTURE, backend);
        const matches = [...files.keys()].filter(FOLD_FILES[backend]!);
        expect(
          matches.length,
          `no emitted file carries the AccountBoard folds on ${backend} — the arms below would pass vacuously`,
        ).toBeGreaterThan(0);
        // BOTH folds must be reached — the fixture splits its statement kinds
        // across them, so a tree carrying only one would pass half the arms
        // vacuously.
        const body = foldBodies(files, backend);
        expect(body).toMatch(/AccountOpened/);
        expect(body).toMatch(/AccountClosed/);
      });

      for (const [kind, pattern] of Object.entries(ARMS[backend]!)) {
        it(`renders the fold's \`${kind}\` statement`, async () => {
          const files = await generateCorpusCase(FIXTURE, backend);
          expect(foldBodies(files, backend)).toMatch(pattern);
        });
      }
    });
  }
});
