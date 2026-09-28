// The AST-side `astProjectionReadShape` (`src/ir/lower/lower-expr.ts`) mirrors
// `isFrontendReadableProjection` + `projectionReadShape`
// (`src/ir/util/projection-read.ts`).  Two copies of one rule is exactly what
// that module's header warns against — "they are deliberately not allowed to
// hold three copies of this rule" — so the copies are PINNED here to agree,
// the same device `adapter-metadata-consistency.test.ts` uses for its
// pure-data mirror of the adapter menus.
//
// The AST copy exists because lowering needs the answer BEFORE any
// `ProjectionIR` exists: a page body's `QueryView { of: <handle>.<Proj>,
// data: s => … }` binds its lambda param during lowering, and reaching the IR
// predicates from there would mean lowering the projection twice.
//
// This runs both over every projection the shipped corpus declares, so a new
// clause added to one side and not the other fails here rather than in a
// generated frontend six merges later.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { astProjectionReadShape } from "../../src/ir/lower/lower-expr.js";
import {
  isFrontendReadableProjection,
  projectionReadShape,
} from "../../src/ir/util/projection-read.js";
import { parseString } from "../_helpers/index.js";

const CORPUS = "test/fixtures/corpus";

/** Every corpus `.ddd`, with the platform placeholder resolved so it parses. */
function corpusSources(): { file: string; text: string }[] {
  return readdirSync(CORPUS)
    .filter((f) => f.endsWith(".ddd"))
    .map((f) => ({
      file: f,
      text: readFileSync(join(CORPUS, f), "utf8").replaceAll("__PLATFORM__", "node"),
    }));
}

/** One model per projection FLAVOR, added because the corpus does not reach
 *  every clause on its own — measured: with the corpus alone, mutations that
 *  drop the `keyed by` narrowing or the SHORTHAND arm both stay green,
 *  because every keyed projection the corpus declares is also FOLDED and so
 *  is already excluded one clause earlier.  A parity gate that cannot go red
 *  for two of its four clauses is not pinning them. */
const FLAVORS: { file: string; text: string }[] = [
  {
    file: "<inline:keyed-query-time>",
    text: model(`      projection ByRef keyed by ref {
        ref: string
        gross: money
        from Claim as c
        select ref = c.reference, gross = sum(c.claimedTotal)
      }`),
  },
  {
    file: "<inline:shorthand>",
    text: model(`      criterion Big of Claim = claimedTotal > 100.00
      projection BigOnes {
        from Claim as c
        where Big
      }`),
  },
  {
    file: "<inline:grouped>",
    text: model(`      projection PerRef {
        ref: string
        gross: money
        from Claim as c
        group by c.reference
        select ref = c.reference, gross = sum(c.claimedTotal)
      }`),
  },
  {
    // FOLDED: `on(e)` handlers and no `from` — materialized into a table and
    // read by key, which is a different route shape and a different binding.
    // Reaches the query-time clause, which the corpus alone leaves green.
    file: "<inline:folded>",
    text: model(`      projection Ledger keyed by claimId {
        claimId: Claim id
        total: money
        on(e: Filed) by e.claimId { total := total + e.amount }
      }`).replace(
      "      repository Claims for Claim { }",
      "      repository Claims for Claim { }\n      event Filed { claimId: Claim id, amount: money }",
    ),
  },
  {
    // FOLDED and UNKEYED — a running total with no correlation column.  This
    // is the one flavor that reaches the QUERY-TIME clause on its own: the
    // keyed folded model above is already excluded by the `keyed by`
    // narrowing one line later, so without this row that clause could be
    // deleted and the gate would stay green.
    file: "<inline:folded-singleton>",
    text: model(`      projection RunningTotal {
        total: money
        on(e: Filed) { total := total + e.amount }
      }`).replace(
      "      repository Claims for Claim { }",
      "      repository Claims for Claim { }\n      event Filed { claimId: Claim id, amount: money }",
    ),
  },
  {
    file: "<inline:singleton-aggregation>",
    text: model(`      projection Totals {
        gross: money
        from Claim as c
        select gross = sum(c.claimedTotal)
      }`),
  },
];

function model(projection: string): string {
  return `
system S {
  subdomain Ops {
    context Ap {
      aggregate Claim with crudish {
        reference: string
        claimedTotal: money
        derived display: string = reference
      }
      repository Claims for Claim { }
${projection}
    }
  }
  api ApApi from Ops
  storage pg { type: postgres }
  resource apState { for: Ap, kind: state, use: pg }
  deployable api {
    platform: node
    contexts: [Ap]
    dataSources: [apState]
    serves: ApApi
    port: 4000
  }
}`;
}

describe("projection read shape — the AST mirror agrees with the IR predicates", () => {
  it("answers identically for every projection in the shipped corpus", async () => {
    const disagreements: string[] = [];
    let compared = 0;

    for (const { file, text } of [...corpusSources(), ...FLAVORS]) {
      let model: Awaited<ReturnType<typeof parseString>>["model"];
      try {
        ({ model } = await parseString(text, { validate: false }));
      } catch {
        continue;
      }
      let loom: ReturnType<typeof lowerModel>;
      try {
        loom = lowerModel(model);
      } catch {
        continue;
      }

      // Index the AST projections by name so each IR projection can be paired
      // with the declaration it came from.
      const astByName = new Map<string, ReturnType<typeof astProjectionReadShape>>();
      // `streamAllContents`, not a hand-rolled object walk: an AST node carries
      // a `$container` back-reference, so a naive recursion never terminates.
      for (const n of AstUtils.streamAllContents(model)) {
        if (n.$type !== "Projection") continue;
        const proj = n as Parameters<typeof astProjectionReadShape>[0];
        astByName.set(proj.name, astProjectionReadShape(proj));
      }

      const contexts = [
        ...loom.systems.flatMap((s) => s.subdomains.flatMap((d) => d.contexts)),
        ...loom.contexts,
      ];
      for (const ctx of contexts) {
        for (const p of ctx.projections ?? []) {
          if (!astByName.has(p.name)) continue;
          compared++;
          const ir = isFrontendReadableProjection(p) ? projectionReadShape(p) : undefined;
          const ast = astByName.get(p.name);
          if (ir !== ast) {
            disagreements.push(`${file} ${p.name}: IR=${String(ir)} AST=${String(ast)}`);
          }
        }
      }
    }

    // Non-vacuity: a corpus that stopped declaring projections would make the
    // agreement assertion pass by having nothing to compare.
    expect(compared, "the corpus must still declare projections to compare").toBeGreaterThan(5);
    expect(disagreements).toEqual([]);
  });
});
