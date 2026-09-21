// Cross-backend acceptance for the OPTIONAL leaf in the synthesized `inspect`
// derived — the sibling of `inspect-redaction-cross-backend.test.ts`, over the
// same five backends and the same one DSL source.
//
// `inspect` is what `toString()` / `Inspect` / `__str__` delegate to, i.e. the
// string a developer reads out of an exception, a log line or a debugger.  Its
// `stringifyLeaf` (`src/ir/enrich/enrichments.ts`) handled `string` / primitive
// / `id` / `enum` and fell through to a TYPE SHORTHAND for everything else, so
// an optional scalar printed the literal text `[string?]` on every backend —
// never its value, and never even "absent".  An optional scalar is a leaf: it
// has a value or it does not, and both are printable.
//
// The shorthand stays correct for arrays, entity refs and containments (they
// are unbounded or cyclic — that is what it is for), and this file pins that
// too, so the narrowing cannot quietly widen.
//
// The ABSENT branch is a literal the emitter controls, deliberately: letting a
// null ride the `convert`-to-string arm renders `"null"` on node/java, `"None"`
// on python and `""` on .NET/elixir, so the five backends would disagree on the
// same model.  Every backend must print exactly `null`.
//
// Scope note: in-process, like its sibling — this asserts the EMITTED SOURCE.
// That the emitted source COMPILES is a separate and load-bearing claim on
// .NET, where `Nullable<T>` forwards `ToString()` but not
// `ToString(IFormatProvider)`; `renderCsConvert`'s `.Value` unwrap is covered
// below and by `dotnet build /warnaserror` in the LOOM_DOTNET_BUILD tier.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const OPTIONAL_SOURCE = `
  system Directory {
    subdomain M {
      context People {
        enum Tier { free, paid }
        aggregate Person {
          fullName: string
          nickname: string?
          score: int?
          tier: Tier?
          tags: string[]
          derived display: string = fullName
        }
        repository People for Person { }
      }
    }
    api PeopleApi from M
    storage primary { type: postgres }
    resource peopleState { for: People, kind: state, use: primary }
    deployable honoApi { platform: node, contexts: [People], dataSources: [peopleState], port: 3000 }
    deployable dotnetApi { platform: dotnet, contexts: [People], dataSources: [peopleState], port: 3001 }
    deployable javaApi { platform: java, contexts: [People], dataSources: [peopleState], port: 3003 }
    deployable pythonApi { platform: python, contexts: [People], dataSources: [peopleState], port: 3004 }
  }
`;

/** The one line carrying the synthesized structural debug form. */
function inspectLine(source: string, marker: string): string {
  const line = source.split("\n").find((l) => l.includes(marker));
  expect(line, `inspect body not emitted (looking for \`${marker}\`)`).toBeDefined();
  return line!;
}

describe("cross-backend inspect: an optional scalar prints its VALUE, not `[string?]`", () => {
  it("node: guards each optional leaf and never falls back to the type shorthand", async () => {
    const files = await generateSystemFiles(OPTIONAL_SOURCE);
    const person = files.get("hono_api/domain/person.ts")!;
    const line = inspectLine(person, "get inspect()");

    // The defect: the literal type shorthand, for ANY of the three optionals.
    expect(line).not.toContain("[string?]");
    expect(line).not.toContain("[int?]");
    expect(line).not.toContain("[Tier?]");

    // Present branch reaches the value; absent branch is the shared literal.
    expect(line).toContain("this._nickname === null");
    expect(line).toContain('"null"');
    expect(line).toMatch(/this\._nickname\b/);
    expect(line).toMatch(/this\._score\b/);
    expect(line).toMatch(/this\._tier\b/);

    // A required field is untouched — no guard, no parentheses around it.
    expect(line).toContain('"\'" + this._fullName + "\'"');

    // An ARRAY keeps the shorthand: unbounded, which is what it is for.
    expect(line).toContain("[string[]]");
    expect(line).not.toMatch(/this\._tags\b/);
  });

  it(".NET: unwraps the nullable before a culture-aware ToString (CS1501 guard)", async () => {
    const files = await generateSystemFiles(OPTIONAL_SOURCE);
    const person = files.get("dotnet_api/Domain/Persons/Person.cs")!;
    const line = inspectLine(person, "public string Inspect");

    expect(line).not.toContain("[string?]");
    expect(line).not.toContain("[int?]");

    // `Nullable<T>` forwards `ToString()` but NOT `ToString(IFormatProvider)`,
    // so the culture-aware arm must unwrap first — otherwise the emitted
    // project does not build:
    //   error CS1501: No overload for method 'ToString' takes 1 arguments
    expect(line).toContain("this.Score.Value.ToString(");
    // A reference-typed optional has no `.Value` and must NOT be unwrapped.
    expect(line).not.toContain("this.Nickname.Value");
    expect(line).toContain("this.Nickname == null");
    // A required numeric is unaffected (no `.Value` splice on a plain int).
    expect(line).not.toContain("this.Version.Value.ToString(");

    expect(line).toContain("[string[]]");
  });

  it("java: guards each optional leaf", async () => {
    const files = await generateSystemFiles(OPTIONAL_SOURCE);
    const person = files.get(
      "java_api/src/main/java/com/loom/javaapi/features/persons/Person.java",
    )!;
    expect(person, "java Person.java missing — system emission shape changed").toBeDefined();
    const line = inspectLine(person, 'return "Person(');

    expect(line).not.toContain("[string?]");
    expect(line).not.toContain("[int?]");
    expect(line).toContain("this.nickname == null");
    expect(line).toContain("this.score == null");
    expect(line).toContain('"null"');
    expect(line).toContain("[string[]]");
  });

  it("python: guards each optional leaf with `is None`", async () => {
    const files = await generateSystemFiles(OPTIONAL_SOURCE);
    const person = files.get("python_api/app/domain/person.py")!;
    expect(person, "python person.py missing — system emission shape changed").toBeDefined();
    const line = inspectLine(person, 'return "Person(');

    expect(line).not.toContain("[string?]");
    expect(line).not.toContain("[int?]");
    expect(line).toContain("self._nickname is None");
    expect(line).toContain("self._score is None");
    expect(line).toContain('"null"');
    expect(line).toContain("[string[]]");
  });

  it("elixir: guards each optional leaf with `is_nil`", async () => {
    // Elixir emits the `defimpl Inspect` block only for an aggregate carrying a
    // SENSITIVE leaf (it exists to redact), so this case needs one.
    const files = await generateSystemFiles(`
      system Directory {
        subdomain M {
          context People {
            aggregate Person {
              fullName: string
              ssn: string sensitive(pii)
              nickname: string?
              score: int?
              derived display: string = fullName
            }
            repository People for Person { }
          }
        }
        api PeopleApi from M
        storage primary { type: postgres }
        resource peopleState { for: People, kind: state, use: primary }
        deployable elixirApi {
          platform: elixir
          contexts: [People]
          dataSources: [peopleState]
          serves: PeopleApi
          port: 3002
        }
      }
    `);
    const person = files.get("elixir_api/lib/elixir_api/people/person.ex")!;
    expect(person, "Elixir Person.ex missing — system emission shape changed").toBeDefined();
    const line = inspectLine(person, "string(");

    expect(line).not.toContain("[string?]");
    expect(line).not.toContain("[int?]");
    expect(line).toContain("is_nil(record.nickname)");
    expect(line).toContain("is_nil(record.score)");
    expect(line).toContain('"null"');
    // The redaction contract is untouched.
    expect(line).toContain('"<redacted>"');
    expect(line).not.toMatch(/\brecord\.ssn\b/);
  });
});
