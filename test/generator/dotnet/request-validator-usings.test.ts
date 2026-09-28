// `validator-emit.ts` has TWO file-header sites, and only one of them collected
// the namespaces its rendered predicates reach into.
//
//   renderValidatorFile   (Commands)  → collects `usings` from buildFluentRules
//   renderRequestValidators (Requests) → hardcoded `using FluentValidation;`
//
// `buildFluentRules` returns `{ ruleLines, usings }`; the Requests site
// destructured only `ruleLines` and dropped the rest.  A value object whose
// invariant uses `.matches(...)` renders `Regex.IsMatch(...)` there, so the
// emitted file named `Regex` under a bare `using FluentValidation;`:
//
//   /src/Application/Things/Requests/ThingRequestValidators.cs(10,35):
//     error CS0103: The name 'Regex' does not exist in the current context
//
// and `dotnet build` failed on a model that reported `0 error(s), 0 warning(s)`.
//
// The trigger is narrow, which is why it survived: a single-field VO invariant
// normally lowers to FluentValidation's own `.Matches(...)` chain (no `Regex`
// symbol). It only reaches the `.Must(x => Regex.IsMatch(...))` form in the
// Requests file when the VO rides an OPERATION PARAMETER, which is what mints a
// standalone `<Vo>RequestValidator` there.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system RS2 {
  subdomain S {
    context C {
      valueobject Code {
        value: string
        invariant value.matches("^[A-Z]{5}$") message "five caps"
      }
      aggregate Thing with crudish {
        name: string
        operation relocate(spot: Code) { name := spot.value }
      }
      repository R for Thing { }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: dotnet
    contexts: [C]
    dataSources: [st]
    port: 8080
  }
}
`;

describe("dotnet Requests validators declare the usings their predicates need", () => {
  it("emits System.Text.RegularExpressions beside a Regex.IsMatch rule", async () => {
    const files = await generateSystemFiles(SRC);
    const key = [...files.keys()].find((k) => k.endsWith("Requests/ThingRequestValidators.cs"));
    expect(key, "no Requests validator file was emitted").toBeDefined();
    const src = files.get(key!)!;

    // Vacuity guard: without the `Regex.IsMatch` call there is no using to
    // need, and the assertion below would pass for the wrong reason.
    expect(src, "the VO regex invariant should render as Regex.IsMatch here").toContain(
      "Regex.IsMatch(",
    );
    expect(src, "Regex.IsMatch is emitted without its namespace (CS0103)").toContain(
      "using System.Text.RegularExpressions;",
    );
  });
});
