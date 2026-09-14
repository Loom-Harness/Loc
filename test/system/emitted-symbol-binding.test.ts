// The BINDING floor for the emitted node backend: every symbol an emitted file
// names must be one it imports, declares, or gets from the platform — decided
// by a real TypeScript BINDER rather than by a scan.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS ALONGSIDE `emitted-unbound-symbols.test.ts`
// ---------------------------------------------------------------------------
//
// That gate asks the same question with a regex heuristic, and it is the right
// tool for its reach: it runs over the WHOLE corpus (48 backend trees, ~1200
// files) in the time this one takes on a handful of projects, and it fires on
// shapes a binder could only see if someone wrote the fixture.
//
// But it collects references with `/(^|[^.\w$])([A-Z][A-Za-z0-9_]*)/` — only
// CAPITALISED names.  That is deliberate and load-bearing over there (a
// lowercase scan over emitted text is unusably noisy), and it is also a hole
// with a shape: every lowercase free symbol is invisible to it.  One of the two
// defects fixed in this PR lives exactly in that hole —
//
//     .where(ne(schema.tickets.status, "Closed"))
//     import { and, asc, count, desc, eq, inArray } from "drizzle-orm";  // no `ne`
//
// `ne` is lowercase, so the corpus scan reports zero names on a project that
// does not compile.  drizzle's entire predicate vocabulary — `eq`, `gt`, `or`,
// `not`, `isNull`, `between`, `like`, `asc`, `count`, `sql` — is lowercase, and
// so is every helper the emitters import from their own runtime.
//
// The second defect, `new Decimal("0.00")` in a routes file with no
// `decimal.js` import, is capitalised and WOULD have been caught over
// there — had a fixture with a money field carrying a literal default ever been
// generated.  Neither existed.  So the two gates fail in opposite directions
// and that is the point of having both: the scan is broad and lossy, this is
// narrow and exact.
//
// Not reachable by the two cheaper oracles already in the tree either:
//
//   - A TEXT assertion needs to know the bad string in advance.  The whole
//     shape of this class is that nobody knew: `ne` is one of six comparison
//     spellings, `Decimal` follows from a modifier (`money = money("0.00")`)
//     nobody connected to the import header.  You cannot grep for a symbol
//     whose absence is the bug.
//
//   - A PARSE gate (`test/generator/_packs/tsx-parse-gate.test.ts`) runs the
//     scanner and parser only.  `ne(x, y)` is perfectly well-formed TypeScript;
//     an undefined identifier is a BINDER fact, one layer above syntax.  That
//     gate is the right floor for its own class (a pack template emitting
//     `{{{`), and it is structurally blind to this one.
//
// ---------------------------------------------------------------------------
// WHY IT IS AFFORDABLE IN THE FAST TIER
// ---------------------------------------------------------------------------
//
// It needs NO `node_modules` for the generated project, no `npm install` and no
// network: an unresolvable module specifier still DECLARES its imported names
// (TypeScript reports `TS2307` for the module and types the bindings as `any`),
// so `import { eq } from "drizzle-orm"` puts `eq` in scope whether or not
// drizzle is on disk.  A name that is never imported at all has nothing to be
// typed as, and that is exactly the defect.  See `_helpers/emitted-binding.ts`
// for why the kept diagnostic codes are the ones a binder alone decides.
import { describe, expect, it } from "vitest";
import { trackedDddFiles } from "../_helpers/ddd-corpus.js";
import {
  assertNodeTypesAvailable,
  formatUnbound,
  honoProjectDirs,
  unboundSymbols,
} from "../_helpers/emitted-binding.js";
import { generateSystemFiles, loadExample } from "../_helpers/index.js";

/** A query-time projection whose `where` uses `!=`.
 *
 *  The projection synthesises a repository read rendered by the same
 *  `findQueryMethod` as a declared find, so it reaches a render site the
 *  repository builder's old candidate walk never enumerated.  `!=` lowers to
 *  drizzle's `ne`, which is not in the always-seeded `eq/and/inArray` set. */
const PROJECTION_NE = `
system BindNe {
  context C {
    enum Status { Open, Closed }
    aggregate Ticket {
      status: Status
      derived display: string = \`t {status}\`
    }
    repository Tickets for Ticket { }
    projection OpenTickets {
      status: Status
      n: int
      from Ticket as t
      where t.status != Closed
      group by t.status
      select status = t.status, n = count()
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}
`;

/** A `money` field carrying a literal default.
 *
 *  `money("0.00")` renders into the create-request zod schema as
 *  `.default(new Decimal("0.00"))`, naming a class the routes file's header
 *  explicitly assumed it would never name. */
const MONEY_DEFAULT = `
system BindMoney {
  context C {
    aggregate Item with crudish {
      label:  string
      weight: money = money("0.00")
      derived display: string = label
    }
    repository Items for Item { }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}
`;

/** Both defects at once, plus the shapes either fix could plausibly break:
 *  a money field with a default AND a projection `!=` AND a paged find (whose
 *  `count`/`asc`/`desc` the old candidate seed supplied and the derivation must
 *  now find in the body on its own). */
const COMBINED = `
system BindBoth {
  context C {
    enum Status { Open, Closed }
    aggregate Ticket with crudish {
      status: Status
      fee: money = money("1.50")
      derived display: string = \`t {status}\`
    }
    repository Tickets for Ticket {
      find openPage(): Ticket paged where status != Closed
    }
    projection OpenTickets {
      status: Status
      n: int
      from Ticket as t
      where t.status != Closed
      group by t.status
      select status = t.status, n = count()
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node contexts: [C] dataSources: [st] port: 3000 }
}
`;

const FIXTURES: ReadonlyArray<{ label: string; source: string; spells: RegExp; file: RegExp }> = [
  {
    label: "a projection `where … != …` (F-009 — drizzle `ne`)",
    source: PROJECTION_NE,
    spells: /(?<![.\w$])ne\(/,
    file: /\/db\/repositories\/.*-repository\.ts$/,
  },
  {
    label: "a `money` field with a literal default (F-030 — `Decimal`)",
    source: MONEY_DEFAULT,
    spells: /new Decimal\(/,
    file: /\/http\/.*\.routes\.ts$/,
  },
  {
    label: "both, plus a paged find",
    source: COMBINED,
    spells: /(?<![.\w$])ne\(/,
    file: /\/db\/repositories\/.*-repository\.ts$/,
  },
];

describe("the emitted node backend binds every symbol it names", () => {
  it("the probe's own prerequisite holds", () => {
    // Without `@types/node` every `process.env` in the emitted project reads as
    // a defect and the gate is all false positives.  Fail loudly on the setup
    // rather than quietly on 200 phantom findings.
    assertNodeTypesAvailable();
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.label}: no unbound symbol`, async () => {
      const files = await generateSystemFiles(fixture.source);

      // VACUITY GUARD, and the reason each fixture carries a `spells`/`file`
      // pair.  An empty finding list means "clean" only once we know the
      // emitter still REACHES the render site under test.  If a refactor stops
      // emitting `ne(` / `new Decimal(` here at all, this fixture would pass
      // forever while guarding nothing — the §59/§63 failure shape.
      const reaching = [...files].filter(
        ([p, c]) => fixture.file.test(p) && fixture.spells.test(c),
      );
      expect(
        reaching.map(([p]) => p),
        "fixture no longer reaches its render site — it now guards nothing, " +
          "so fix the fixture rather than trusting the green",
      ).not.toEqual([]);

      const projects = honoProjectDirs(files);
      expect(projects, "no hono project in the emitted tree").not.toEqual([]);

      for (const dir of projects) {
        const found = unboundSymbols(files, dir);
        expect(found, `unbound symbols in "${dir}":\n${formatUnbound(found)}`).toEqual([]);
      }
    });
  }
});

describe("the shipped example corpus binds every symbol it names", () => {
  // Not a formality — it is the measurement that makes the fixtures above
  // credible.  `emitted-unbound-symbols.test.ts` reports zero names over this
  // same corpus with its capitalised-only scan, which is exactly why the two
  // defects fixed here survived: the corpus contains no projection with a `!=`
  // where-clause and no money field with a literal default, so a broader oracle
  // over the same inputs would still have said nothing.  Running the BINDER
  // over the corpus closes the other half — a lowercase name going unbound
  // anywhere in the shipped examples now fails here rather than at some
  // generated project's `tsc`.
  //
  // Affordable because the binder needs no `node_modules` for the generated
  // projects: measured ~17s for the whole corpus, in-process.
  const examples = trackedDddFiles().filter((f) => f.startsWith("examples/"));

  it("every shipped example emits a node backend with no unbound symbol", async () => {
    expect(examples.length, "the example corpus went empty").toBeGreaterThan(5);

    const offenders: string[] = [];
    let projectsScanned = 0;
    for (const file of examples) {
      let files: ReadonlyMap<string, string>;
      try {
        files = await generateSystemFiles(loadExample(file));
      } catch {
        continue; // legacy single-context examples emit no system tree
      }
      for (const dir of honoProjectDirs(files)) {
        projectsScanned++;
        offenders.push(
          ...unboundSymbols(files, dir).map((f) => `${file} → ${dir}/${f.file}: TS${f.code}: ${f.message}`),
        );
      }
    }

    // The vacuity guard.  An empty offender list means "clean" only when the
    // sweep actually compiled something; a harness that silently generated no
    // hono project would otherwise report a comforting green.
    expect(projectsScanned, "no example produced a node backend — the sweep is vacuous").toBeGreaterThan(5);
    expect(offenders, "an unbound symbol in a shipped example").toEqual([]);
  }, 300_000);
});
