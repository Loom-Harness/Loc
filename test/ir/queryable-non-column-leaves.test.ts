// Three ExprIR leaves the queryable gate ADMITTED and no query renderer emits
// — wave CR1 packet CR1-f, audit row P0-2b.
//
// THE CRASH THIS CLOSES.  `firstNonQueryableNode` is the oracle every
// find / criterion / projection predicate passes before a backend renders it,
// and it listed `this` and `id` beside `literal` as unconditionally queryable
// and let a `duration` node through on its own amount.  None of the five query
// renderers has an arm for any of them.  Measured on the pre-fix HEAD, each of
// the three fixtures below printed
//
//   0 error(s), 0 warning(s).
//
// from `ddd parse` and then aborted `ddd generate system` with
//
//   QueryEmissionRefusal: drizzle-predicate: where-clause for find 'byId2' on
//   'Customer' is outside the declared query-emission vocabulary — the IR
//   validator should have rejected this filter before codegen reached it.
//     { code: 'loom.query-emission-invalid', mode: 'drizzle-predicate' }
//
// — the code whose own doc comment says reaching it "is a validator gap or a
// compiler bug, never a user mistake".  So the gap was in this oracle, and the
// fix is a refusal there rather than five new renderer arms: `where id == q`
// is a feature nobody has built (the primary key is not addressable in a
// predicate on ANY backend), and `where this == q` / `where days(7) ==
// days(3)` are not predicates a SQL dialect can express at all.
//
// MUTATION PROOF (CLAUDE.md — a green first run proves nothing): restore any
// one of the three arms in `src/ir/validate/checks/shared.ts` to its pre-fix
// shape and the matching `it(...)` below fails with
//
//   AssertionError: expected [] to contain 'loom.find-where-not-queryable'
//
// The CONTROL is the other half: `this.dueDate < q + days(2)` — the A5
// temporal shape the `duration` arm exists for — must still validate AND still
// generate, or the refusal would have closed a crash by deleting a working
// feature.  It is exercised through the emitter, not just the validator,
// because that is where the crash lived.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

function sys(finds: string): string {
  return `
system Shop {
  subdomain S { context Sales {
    aggregate Customer with crudish {
      name: string
      dueDate: datetime
    }
    repository Customers for Customer {
      ${finds}
    }
  } }
  api SalesApi from S
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable d {
    platform: node
    contexts: [Sales]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
}
`;
}

async function errorCodes(source: string): Promise<string[]> {
  const { model, errors } = await parseString(source, { validate: false });
  if (errors.length > 0) throw new Error(`fixture has parse errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? "<no code>");
}

/** The three shapes, each with the leaf it is here for. */
const REFUSED: ReadonlyArray<{ leaf: string; find: string; says: RegExp }> = [
  {
    leaf: "bare `this`",
    find: "find byThis(q: Customer): Customer[] where this == q",
    says: /compares COLUMNS/,
  },
  {
    leaf: "bare `id`",
    find: "find byId2(q: Customer id): Customer[] where id == q",
    says: /primary-key column/,
  },
  {
    leaf: "a standalone `duration` constructor",
    find: "find byDur(): Customer[] where days(7) == days(3)",
    says: /outside a 'datetime ± days\(n\)' comparison/,
  },
];

describe("queryable gate — leaves no query renderer emits are refused, not crashed on", () => {
  for (const { leaf, find, says } of REFUSED) {
    it(`${leaf} in a find where is refused by loom.find-where-not-queryable`, async () => {
      expect(await errorCodes(sys(find))).toContain("loom.find-where-not-queryable");
    });

    it(`${leaf}: the message names WHY, not just "not queryable"`, async () => {
      const { model } = await parseString(sys(find), { validate: false });
      const text = validateLoomModel(enrichLoomModel(lowerModel(model)))
        .filter((d) => d.code === "loom.find-where-not-queryable")
        .map((d) => d.message)
        .join("\n");
      expect(text).toMatch(says);
    });
  }

  // CONTROL — the A5 temporal shape the `duration` arm was written for. The
  // duration node rides the `binary` arm's destructuring (which recurses into
  // its AMOUNT, never the node), so narrowing the standalone arm must leave it
  // untouched: still queryable, still emitted.
  const TEMPORAL = "find dueBefore(q: datetime): Customer[] where this.dueDate < q + days(2)";

  it("control: datetime ± days(n) is still queryable", async () => {
    expect(await errorCodes(sys(TEMPORAL))).not.toContain("loom.find-where-not-queryable");
  });

  it("control: datetime ± days(n) still generates a repository on node", async () => {
    const files = await generateSystemFiles(sys(TEMPORAL));
    const key = [...files.keys()].find((k) => k.endsWith("db/repositories/customer-repository.ts"));
    expect(key, "customer-repository.ts not emitted").toBeDefined();
    expect(files.get(key!)).toContain("dueBefore");
  });
});
