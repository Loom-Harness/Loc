// One source for what a generated test's assertions compare and who it runs
// as (`src/ir/plan/test-assertion.ts`, `src/ir/plan/test-principal.ts`).
//
// Each backend's test emitter used to decide on its own how `toBe` and the
// ordering matchers compare a `money`, a `datetime`, a value object, a list or
// an `X id`, and which synthetic user a `currentUser`-reading operation runs
// as.  The five answers disagreed: the same `.ddd` test passed on one backend,
// failed on another and did not compile on a third.  The decisions now live in
// the plan and every test framework renders them from a leaf table
// (`src/generator/_test/assertion-target.ts`, `principal-target.ts`).
//
// This census holds that shape:
//   - no test emitter re-derives a comparison: it does not dispatch on a
//     matcher's name, read a matcher's subject type, or sniff a primitive type
//     name;
//   - no test emitter builds a principal from its own value table: the dev-stub
//     tables of the app's auth layer are not read, and no claim value is
//     spelled outside the principal leaf table;
//   - every test emitter that renders an assertion or a principal reaches the
//     shared renderer.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "../..");

/** The emitters that render a generated unit or context-integration test. */
const TEST_EMITTERS = [
  "src/generator/typescript/emit/tests.ts",
  "src/generator/typescript/emit/integration-tests.ts",
  "src/generator/dotnet/emit/tests.ts",
  "src/generator/dotnet/emit/integration-tests.ts",
  "src/generator/java/emit/tests.ts",
  "src/generator/java/emit/integration-tests.ts",
  "src/generator/python/emit/tests.ts",
  "src/generator/python/emit/integration-tests.ts",
  "src/generator/elixir/vanilla/tests-emit.ts",
  "src/generator/elixir/vanilla/integration-tests-emit.ts",
  "src/generator/elixir/tests-emit.ts",
] as const;

/** A file's code with comments stripped. */
function code(file: string): string {
  return fs
    .readFileSync(path.join(repo, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The lines of `file` matching `re`, as `file:line: text`. */
function hits(file: string, re: RegExp): string[] {
  return code(file)
    .split("\n")
    .flatMap((l, i) => (re.test(l) ? [`${file}:${i + 1}: ${l.trim()}`] : []));
}

/** Re-deriving what an assertion compares. */
const ASSERTION_REDERIVATION: Readonly<Record<string, RegExp>> = {
  "dispatches on a matcher's name": /\.member\s*[!=]==?\s*"to[A-Z]/,
  "reads a matcher's subject type or coerces its expected value itself":
    /\b(matcherSubjectType|coerceMatcherExpected|decideLiteralCoercion)\b/,
  "sniffs a primitive type name": /\.name\s*[!=]==?\s*"(money|decimal|datetime|date)"/,
};

/** Building a principal outside the plan. */
const PRINCIPAL_REDERIVATION: Readonly<Record<string, RegExp>> = {
  "reads an auth layer's dev-stub value table":
    /\b(stubUserValue|renderPyStubUserKwargs|elixirStubValueFor|renderCsDevStubUserArgs|devStubClaims|DEV_STUB_ID_GUID)\b/,
  "spells a dev-stub claim value": /"admin"|00000000-0000-0000-0000-000000000000/,
};

describe("generated-test plan census", () => {
  it("every listed emitter exists", () => {
    for (const f of TEST_EMITTERS) expect(fs.existsSync(path.join(repo, f)), f).toBe(true);
  });

  for (const [what, re] of Object.entries(ASSERTION_REDERIVATION)) {
    it(`no test emitter ${what}`, () => {
      expect(TEST_EMITTERS.flatMap((f) => hits(f, re))).toEqual([]);
    });
  }

  for (const [what, re] of Object.entries(PRINCIPAL_REDERIVATION)) {
    it(`no test emitter ${what}`, () => {
      expect(TEST_EMITTERS.flatMap((f) => hits(f, re))).toEqual([]);
    });
  }

  it("each backend renders assertions and principals through the shared renderers", () => {
    const backends = ["typescript", "dotnet", "java", "python", "elixir"];
    for (const b of backends) {
      const files = TEST_EMITTERS.filter((f) => f.includes(`/${b}/`))
        .map(code)
        .join("\n");
      expect(files, `${b}: assertions`).toMatch(/\brenderAssertion(Plan)?\(/);
      expect(files, `${b}: principal`).toMatch(/\brenderTestPrincipal\(/);
    }
  });
});
