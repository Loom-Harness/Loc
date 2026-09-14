import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Derived-property wire projection on the vanilla (plain Ecto/Phoenix) backend
// (`renderWireSerialize`, wire-serialize.ts).
//
// A derived property is COMPUTED, not a stored Ecto column.  The other four
// backends compute + emit it, and the served OpenAPI marks it required — but the
// vanilla `serialize/1` used to SKIP every derived wire field, so the response
// omitted a required key (the audit's self-contradicting contract + structural
// parity break).  It now renders each derived's expression against the loaded
// `record` via the shared Elixir expression renderer, exactly the value the
// domain would compute.  A derived that isn't `record`-evaluable (references
// another derived, a helper, `currentUser`, …) stays skipped — no
// KeyError-raising `record.<derived>` read, no codegen crash.
// ---------------------------------------------------------------------------

const SOURCE = `
system DerivedWire {
  subdomain Sales {
    context Sales {
      aggregate Customer with crudish {
        firstName: string
        lastName: string
        score: int
        derived fullName: string = firstName + " " + lastName
        derived doubleScore: int = score * 2
        // Derived-of-derived — not a stored column, must stay skipped.
        derived quadScore: int = doubleScore * 2
      }
      repository Customers for Customer { }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Sales]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
}
`;

function ctrlOf(files: Map<string, string>): string {
  const key = [...files.keys()].find((k) => k.endsWith("/controllers/customer_controller.ex"))!;
  expect(key, "customer controller not emitted").toBeDefined();
  return files.get(key)!;
}

describe("vanilla wireShape-driven serialize — derived projection", () => {
  it("computes a record-evaluable derived into serialize/1 (not skipped)", async () => {
    const ctrl = ctrlOf(await generateSystemFiles(SOURCE));
    // Concatenation derived → Elixir `<>` over the two struct columns.
    expect(ctrl).toContain('"fullName" => record.first_name <> " " <> record.last_name');
    // Arithmetic derived → native operator over the column.
    expect(ctrl).toContain('"doubleScore" => record.score * 2');
  });

  it("PROJECTS a derived-of-derived by inlining it (M-T6.56 / audit F60)", async () => {
    // This used to assert the opposite — the field was SKIPPED, while the
    // emitted OpenAPI schema declared it and listed it in `required:`, so every
    // response violated the contract the app publishes.  `derivedRenderable`
    // now resolves the referenced derived, which is what `render-expr.ts` had
    // been doing all along (an Elixir struct carries no computed field, so
    // `record.<name>` would raise `KeyError` — #1765).
    const ctrl = ctrlOf(await generateSystemFiles(SOURCE));
    expect(ctrl).toContain('"quadScore" => (record.score * 2) * 2');
    // Still never a struct read of the derived name itself — the inline goes
    // all the way down to stored columns.
    expect(ctrl).not.toContain("record.double_score");
  });
});
