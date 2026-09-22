import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Feliz client-side invariant validation (M-T1.16 — ledger row
// `M-T1.16-invariant-validation-feliz-flutter`, the feliz half).
//
// The four static-bundle frontends fold an aggregate's wire-translatable
// `invariant`s into per-field rules — React/Vue/Svelte through the zod schema,
// Angular through `Validators.*`.  Feliz enforced "Required" and "is this text
// a number" and NOTHING else, so `invariant qty >= 1` let `0` through to a
// server 422 while every other frontend caught it in the browser.
//
// Admission goes through the SHARED `takeSingleFieldChain` gate (the one the
// zod emitter and `angularValidatorMap` use), so Feliz admits a constraint iff
// the others do — money / `now()` / cross-field rules stay server-only here
// too, which the negative cases below pin.
// ---------------------------------------------------------------------------

const SYS = (aggBody: string, pageBody: string, route = "/") => `
system InvApp {
  subdomain S {
    context C {
      aggregate Product {
${aggBody}
      }
      repository Products for Product { }
      aggregate Other { label: string }
      repository Others for Other { }
    }
  }
  storage db { type: postgres }
  resource cState { for: C, kind: state, use: db }
  ui WebApp {
    page Home {
      route: "${route}"
      body: Stack { ${pageBody} }
    }
  }
  deployable api { platform: node contexts: [C] dataSources: [cState] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}`;

async function appFs(source: string): Promise<string> {
  const files = await generateSystemFiles(source);
  return [...files.entries()].find(([p]) => p.endsWith("web/src/App.fs"))![1];
}

const CREATE = "CreateForm { of: Product }";

describe("feliz invariant validation — numeric bounds", () => {
  it("renders a `>=` bound as a rule-specific message, not `Required`", async () => {
    const fs = await appFs(SYS("        qty: int\n        invariant qty >= 1", CREATE));
    expect(fs).toContain(
      'elif (match System.Decimal.TryParse form.qty with | true, v -> v < 1m | _ -> false) then Some "Must be at least 1"',
    );
    // …and it gates submit, exactly as the required / parse terms do.
    expect(fs).toContain(
      "not (match System.Decimal.TryParse form.qty with | true, v -> v < 1m | _ -> false)",
    );
  });

  it("renders a `<=` bound and folds a two-sided range into ONE `between` message", async () => {
    const fs = await appFs(
      SYS(
        "        qty: int\n        ratio: decimal\n        invariant qty <= 99\n        invariant ratio >= 0.5 && ratio <= 2.5",
        CREATE,
      ),
    );
    expect(fs).toContain('then Some "Must be at most 99"');
    expect(fs).toContain('then Some "Must be between 0.5 and 2.5"');
  });

  it("a numeric rule is blank- and unparseable-TOLERANT, so it never shadows a better message", async () => {
    // `TryParse … | _ -> false` is the whole point: an empty cell is
    // `Required`'s business and `"abc"` is the parse guard's, each with its own
    // message.  The rungs are ordered so those fire first.
    const fs = await appFs(SYS("        qty: int\n        invariant qty >= 1", CREATE));
    const line = fs.split("\n").find((l) => l.includes("productCreateFormQtyError"));
    const body = fs.split("\n")[fs.split("\n").indexOf(line!) + 1]!;
    expect(body.indexOf('Some "Required"')).toBeLessThan(
      body.indexOf('Some "Must be a whole number"'),
    );
    expect(body.indexOf('Some "Must be a whole number"')).toBeLessThan(
      body.indexOf('Some "Must be at least 1"'),
    );
  });
});

describe("feliz invariant validation — length and regex", () => {
  it("counts CODE POINTS, not UTF-16 units, for a length bound", async () => {
    const fs = await appFs(SYS("        name: string\n        invariant name.length >= 3", CREATE));
    // The helper is the JS spread — the same definition `tsCodePointLength`
    // emits for the JS frontends and the one the server's JSON Schema
    // `minLength` publishes.  `Seq.length` over an F# string would count units.
    expect(fs).toContain('[<Fable.Core.Emit("[...$0].length")>]');
    expect(fs).toContain("let private cpLength (s: string) : int = jsNative");
    expect(fs).toContain(
      'elif (not (System.String.IsNullOrEmpty form.name) && cpLength form.name < 3) then Some "Must be at least 3 characters"',
    );
  });

  it("renders a regex invariant through Fable's Regex, with a verbatim pattern", async () => {
    const fs = await appFs(
      SYS('        code: string\n        invariant code.matches("^[A-Z]{3}-[0-9]{4}$")', CREATE),
    );
    // `@"…"` — the backslash-safe F# literal; the JS frontends pass the same
    // source to `z.string().regex(…)`, and Fable compiles `Regex.IsMatch` to
    // the same engine.
    expect(fs).toContain(
      'System.Text.RegularExpressions.Regex.IsMatch(form.code, @"^[A-Z]{3}-[0-9]{4}$")',
    );
    expect(fs).toContain('then Some "Does not match the required format"');
  });

  it("gives an OPTIONAL field a rule — and the view its inline error", async () => {
    // The case the field/form split exists for: `note` is neither required nor
    // numeric, so before M-T1.16 it was not message-bearing at all.  Without
    // the union, the submit guard would refuse with no visible reason.
    const fs = await appFs(
      SYS("        note: string?\n        invariant note.length <= 10", CREATE),
    );
    expect(fs).toContain('then Some "Must be at most 10 characters"');
    // The view seam agrees — onBlur, aria, and the inline error element.
    expect(fs).toContain('dispatch (TouchProductCreateForm "note")');
    expect(fs).toContain("Validation.productCreateFormNoteError model.ProductCreateForm");
    // An empty optional cell is a legitimate omission: the rule skips it.
    expect(fs).toContain("not (System.String.IsNullOrEmpty form.note) && cpLength form.note > 10");
  });
});

describe("feliz invariant validation — the operation form", () => {
  it("folds the op's own `precondition`s, narrowed to the op's params", async () => {
    const fs = await appFs(
      SYS(
        "        name: string\n" +
          "        operation rename(newName: string) {\n" +
          "          precondition newName.length >= 3\n" +
          "          name := newName\n" +
          "        }",
        "OperationForm { of: Product, op: rename }",
        // An `OperationForm` targets the record at the page's route `:id`
        // (`loom.op-form-needs-route-id`), so it must be hosted on a detail
        // route — the same rule on every frontend.
        "/p/:id",
      ),
    );
    expect(fs).toContain(
      'elif (not (System.String.IsNullOrEmpty form.newName) && cpLength form.newName < 3) then Some "Must be at least 3 characters"',
    );
  });
});

describe("feliz invariant validation — what it must NOT admit", () => {
  it("leaves a MONEY bound server-only — the shared gate refuses it", async () => {
    const fs = await appFs(SYS("        price: money\n        invariant price >= 1", CREATE));
    expect(fs).not.toContain("Must be at least 1");
    // The pre-existing numeric parse guard is untouched.
    expect(fs).toContain("isNumberText form.price");
  });

  it("leaves a CROSS-FIELD rule server-only", async () => {
    const fs = await appFs(
      SYS("        lo: int\n        hi: int\n        invariant lo <= hi", CREATE),
    );
    expect(fs).not.toContain("Must be at most");
    expect(fs).not.toContain("cpLength");
  });

  it("BYTE-IDENTICAL control: a form with no translatable invariant is unchanged", async () => {
    // The whole feature is additive — an aggregate with no invariant emits the
    // exact `Validation` module it emitted before, `cpLength` helper included
    // (i.e. NOT included).
    const fs = await appFs(SYS("        name: string\n        rank: int?", CREATE));
    expect(fs).not.toContain("cpLength");
    expect(fs).toContain(
      '    if System.String.IsNullOrWhiteSpace form.name then Some "Required" else None',
    );
    expect(fs).toContain(
      '    if isWholeText form.rank then None else Some "Must be a whole number"',
    );
  });
});
