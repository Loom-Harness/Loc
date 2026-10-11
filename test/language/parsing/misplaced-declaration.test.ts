import { describe, expect, it } from "vitest";
import { renderStarter } from "../../../src/cli/new-templates.js";
import { scopesDeclaring } from "../../../src/language/misplaced-declaration.js";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// Newcomer trial (fleet slice F) — a declaration written one scope off.
//
// `migration "x" { … }` inside `system Library { … }` used to report
//
//     main.ddd:54:3 error: Expecting token of type '}' but found `migration`.
//
// which reads as an unbalanced brace in a file whose braces are fine.  The
// rewrite (`src/language/misplaced-declaration.ts`) names the scope the
// declaration belongs in and how to move it there, at the same position.
// One test per misplacement family, both directions.
// ---------------------------------------------------------------------------

async function onlyError(src: string): Promise<string> {
  const { errors } = await parseString(src);
  expect(errors, "exactly one parse diagnostic").toHaveLength(1);
  return errors[0]!;
}

describe("a declaration in the wrong scope says where it belongs", () => {
  it("the repro: `migration` inside the `ddd new --template crud` system", async () => {
    const starter = renderStarter({
      name: "library",
      template: "crud",
      platform: "node",
      design: "mantine",
      invocation: "ddd",
    });
    // Insert the migration block as the system's first member.
    const src = starter.replace(/^(system \w+ \{\n)/m, `$1  migration "x" { Task.done = false }\n`);
    const line = src.split("\n").findIndex((l) => l.includes("migration")) + 1;
    expect(await onlyError(src)).toBe(
      `${line}:3 'migration' declarations belong at the top level of the file, ` +
        "not inside `system Library { … }` — move it above `system Library {`.",
    );
  });

  describe("top-level-only declarations nested in a block", () => {
    it("`migration` inside a context", async () => {
      expect(
        await onlyError(
          `context Lib {\n  aggregate Task { done: bool }\n  migration "x" { Task.done = false }\n}`,
        ),
      ).toBe(
        "3:3 'migration' declarations belong at the top level of the file, not inside " +
          "`context Lib { … }` — move it above `context Lib {`.",
      );
    });

    it("`migration` inside a subdomain points above the outermost block", async () => {
      const err = await onlyError(
        `system S {\n  subdomain D {\n    context Lib { aggregate Task { done: bool } }\n    migration "x" { Task.done = false }\n  }\n}`,
      );
      expect(err).toContain("4:5 'migration' declarations belong at the top level of the file");
      expect(err).toContain("move it above `system S {`");
    });
  });

  describe("context-level declarations outside a context", () => {
    it("`aggregate` straight in a system", async () => {
      expect(await onlyError(`system S {\n  aggregate Task { done: bool }\n}`)).toBe(
        "2:3 'aggregate' declarations belong inside `context { … }`, not inside " +
          "`system S { … }` — put it in a `context <Name> { … }` block.",
      );
    });

    it("`aggregate` at the top level of the file", async () => {
      expect(await onlyError("aggregate Task { done: bool }")).toBe(
        "1:1 'aggregate' declarations belong inside `context { … }`, not at the top level " +
          "of the file — put it in a `context <Name> { … }` block.",
      );
    });

    it("`criterion` in a system", async () => {
      expect(await onlyError(`system S {\n  criterion Done() of Task = done\n}`)).toContain(
        "2:3 'criterion' declarations belong inside `context { … }`",
      );
    });
  });

  describe("context-level declarations inside an aggregate", () => {
    for (const [word, decl] of [
      ["repository", "repository Tasks for Task { }"],
      ["enum", "enum Color { Red }"],
      ["retrieval", "retrieval Open of Task = done"],
    ] as const) {
      it(`\`${word}\` moves out to the enclosing context`, async () => {
        const err = await onlyError(
          `context Lib {\n  aggregate Task {\n    done: bool\n    ${decl}\n  }\n}`,
        );
        expect(err).toMatch(new RegExp(`^4:5 '${word}' declarations belong `));
        expect(err).toContain(
          "move it out of `aggregate Task { … }` into the enclosing `context Lib { … }`",
        );
      });
    }

    it("a SOFT keyword (`valueobject`) is reported on the keyword, not the name after it", async () => {
      // `valueobject` is a legal field name, so the parser reads it as one and
      // trips on `Money` wanting a `:` — the cause is the word before it.
      expect(
        await onlyError(
          `context Lib {\n  aggregate Task {\n    done: bool\n    valueobject Money { a: int }\n  }\n}`,
        ),
      ).toBe(
        "4:5 'valueobject' declarations belong at the top level of the file or inside " +
          "`context { … }`, not inside `aggregate Task { … }` — move it out of " +
          "`aggregate Task { … }` into the enclosing `context Lib { … }`.",
      );
    });
  });

  describe("aggregate-level declarations outside an aggregate", () => {
    it("`operation` in a context", async () => {
      expect(
        await onlyError(
          `context Lib {\n  aggregate Task { done: bool }\n  operation finish() { done := true }\n}`,
        ),
      ).toBe(
        "3:3 'operation' declarations belong inside `aggregate { … }`, not inside " +
          "`context Lib { … }` — put it in an `aggregate <Name> { … }` block.",
      );
    });
  });

  describe("system-level declarations inside a context", () => {
    for (const [word, decl] of [
      ["deployable", "deployable api { platform: node }"],
      ["storage", "storage db { type: postgres }"],
      ["resource", "resource st { for: Lib, kind: state, use: db }"],
      ["ui", "ui Web { }"],
      ["api", "api Tasks { }"],
      ["auth", "auth { }"],
      ["user", "user { }"],
    ] as const) {
      it(`\`${word}\` in a top-level context moves above it`, async () => {
        expect(
          await onlyError(`context Lib {\n  aggregate Task { done: bool }\n  ${decl}\n}`),
        ).toBe(
          `3:3 '${word}' declarations belong at the top level of the file or inside ` +
            "`system { … }`, not inside `context Lib { … }` — move it above `context Lib {`.",
        );
      });
    }

    it("`deployable` in a context nested in a system moves out to the system", async () => {
      const err = await onlyError(
        `system S {\n  subdomain D {\n    context Lib {\n      aggregate Task { done: bool }\n      deployable api { platform: node }\n    }\n  }\n}`,
      );
      expect(err).toContain("5:7 'deployable' declarations belong");
      expect(err).toContain(
        "move it out of `context Lib { … }` into the enclosing `system S { … }`",
      );
    });
  });

  describe("only ever replaces a message, never invents one", () => {
    it("a keyword valid in its scope keeps chevrotain's message", async () => {
      // `aggregate` IS a context member — the failure is inside it.
      const { errors } = await parseString(`context Lib {\n  aggregate Task { done: }\n}`);
      expect(errors.join("\n")).not.toContain("declarations belong");
    });

    it("inside a non-scope block (a deployable body) nothing is rewritten", async () => {
      const { errors } = await parseString(
        `context Lib { aggregate Task { done: bool } }\nsystem S {\n  deployable api {\n    migration "x" { }\n  }\n}`,
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.join("\n")).not.toContain("declarations belong");
    });

    it("braces inside strings and comments are not structure", async () => {
      const err = await onlyError(
        `// a { stray brace\ncontext Lib {\n  aggregate Task { title: string = "{" }\n  deployable api { platform: node }\n}`,
      );
      expect(err).toContain("4:3 'deployable' declarations belong");
      expect(err).toContain("move it above `context Lib {`");
    });
  });
});

describe("the keyword → scope table is derived from the grammar", () => {
  it.each([
    ["migration", ["top"]],
    ["aggregate", ["context"]],
    ["repository", ["context"]],
    ["criterion", ["context"]],
    ["retrieval", ["context"]],
    ["enum", ["top", "context"]],
    ["valueobject", ["top", "context"]],
    ["deployable", ["top", "system"]],
    ["storage", ["top", "system"]],
    ["resource", ["top", "system"]],
    ["ui", ["top", "system"]],
    ["api", ["top", "system"]],
    ["auth", ["top", "system"]],
    ["user", ["top", "system"]],
    ["tenancy", ["system"]],
    ["context", ["top", "system", "subdomain"]],
    ["permissions", ["subdomain"]],
    ["operation", ["aggregate"]],
    ["invariant", ["aggregate"]],
  ])("`%s` heads a declaration in %j", (word, scopes) => {
    expect(scopesDeclaring(word)).toEqual(scopes);
  });
});
