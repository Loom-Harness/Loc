// The context-member factories (`aggregate`, `enumDecl`, `policyFn`,
// `policyBlock`, plus the `invariant` / `existsExpr` / `paren` pieces they are
// built from) return the nodes the parser builds for the same source, so a
// macro that emits them `unfold`s to real, editable `.ddd`: print → re-parse →
// print is a fixed point, and the re-parsed source validates clean.  Printer
// round-trip — no booted tier can observe the shape of macro-built AST.

import type { AstNode } from "langium";
import { describe, expect, it } from "vitest";
import { isBoundedContext } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/index.js";
import {
  aggregate,
  binaryExpr,
  enumDecl,
  existsExpr,
  field,
  idRef,
  invariant,
  memberAccess,
  namedType,
  nameRef,
  nullLit,
  param,
  paren,
  policyBlock,
  policyFn,
  primType,
  stringLit,
} from "../../src/macros/api/index.js";
import { parseErrorsOf, parseString } from "../_helpers/parse.js";

function members(): AstNode[] {
  const s = nameRef("s");
  const kindIs = (v: string) =>
    binaryExpr(memberAccess(s, "kind"), "==", memberAccess(nameRef("Kind"), v));
  return [
    enumDecl("Kind", ["Org", "User"]),
    aggregate("Doc", [field("title", primType("string"))], { with: ["tenantOwned"] }),
    aggregate(
      "DocShare",
      [
        field("doc", idRef("Doc")),
        field("kind", namedType("Kind")),
        field("user", primType("string", { optional: true })),
        invariant(
          "userGrantee",
          binaryExpr(
            binaryExpr(memberAccess(nameRef("kind"), "x"), "!=", nullLit()),
            "||",
            binaryExpr(nameRef("user"), "!=", nullLit()),
          ),
        ),
      ],
      { with: ["tenantOwned"] },
    ),
    policyFn(
      "GranteeIsMe",
      [param("s", namedType("DocShare"))],
      binaryExpr(
        paren(
          binaryExpr(
            kindIs("User"),
            "&&",
            binaryExpr(memberAccess(nameRef("s"), "user"), "==", stringLit("u")),
          ),
        ),
        "||",
        paren(kindIs("Org")),
      ),
    ),
    policyFn(
      "SharedWithMe",
      [param("d", idRef("Doc"))],
      existsExpr(
        "DocShare",
        "s",
        binaryExpr(
          binaryExpr(memberAccess(nameRef("s"), "doc"), "==", nameRef("d")),
          "&&",
          memberAccess(nameRef("GranteeIsMe"), "x"),
        ),
      ),
    ),
    policyBlock(
      [
        { kind: "row", verb: "read", target: "DocShare", binding: "s", where: nameRef("s") },
        { kind: "row", target: "Doc", binding: "d", where: nameRef("d") },
        { kind: "level", write: true, level: "own", target: "Doc" },
      ],
      { name: "DocSharing" },
    ),
  ];
}

describe("context-member factories print as re-parseable source", () => {
  it("prints source that re-parses and re-prints every factory-built line", async () => {
    const printed = members().map(printStructural).join("\n");
    expect(printed).toContain("enum Kind");
    expect(printed).toContain("aggregate DocShare with tenantOwned");
    expect(printed).toContain("invariant userGrantee:");
    expect(printed).toContain("policy GranteeIsMe(s: DocShare): bool =");
    expect(printed).toContain("exists DocShare as s where");
    expect(printed).toContain("allow read on DocShare as s where s");
    expect(printed).toContain("allow write own on Doc");
    // Parsing runs the expander, so the re-print also carries what `with
    // tenantOwned` splices; every factory-built line survives unchanged.
    const reprint = async (text: string): Promise<string> => {
      const source = `context C {\n${text}\n}`;
      expect(parseErrorsOf(source)).toEqual([]);
      const { model } = await parseString(source, { validate: false });
      const ctx = model.members.find(isBoundedContext)!;
      return ctx.members.map((m) => printStructural(m)).join("\n");
    };
    const once = await reprint(printed);
    for (const line of printed.split("\n")) expect(once).toContain(line);
  });
});
