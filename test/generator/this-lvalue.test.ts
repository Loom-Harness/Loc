// G3 — `this.` on the left of `:=`.
//
// `docs/language.md` has always described `:=` as "assignment to a property
// reachable from `this`", but `this` was not admissible in the `LValue` head,
// so the natural factory and the natural setter were unwritable:
//
//   operation rename(name: string) { this.name := name }   // parse error
//   operation rename(newName: string) { name := newName }  // the only spelling
//
// Every setter parameter therefore had to be renamed away from the field it
// fills.  `LValue` now takes an optional `(thisRef?='this' '.')?` prefix.
//
// The prefix is NOT cosmetic.  It changes how the head resolves, in two places
// that both used to consult locals first:
//
//   - `pathType` (phase ⑤) — the assignment's TARGET TYPE, which is what drives
//     contextual literal elaboration (a bare `0.50` lowers as money only when
//     the target is money-typed).  Under a shadowing parameter the un-prefixed
//     spelling picks up the PARAMETER's type instead of the field's.
//   - `lvalueType` (phase ④) — the AST type-check, for the same reason.
//
// And `lowerStatement`'s lvalue dispatch gains an early `thisRef` branch that
// is the ONLY arm a this-rooted lvalue can reach: the arms below it resolve the
// head as a FREE name (sibling action / store action / domain service / ambient
// resource verb), and `this.` is exactly the spelling that says it is not free.

import { beforeAll, describe, expect, it } from "vitest";
import { isAggregate } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/index.js";
import { generateSystemFiles, parseString } from "../_helpers/index.js";

/** The whole point: the parameter and the field share a name. */
const SHADOWED = `
system Shop {
  subdomain Sales {
    context Catalog {
      aggregate Product {
        name: string
        total: money
        operation rename(name: string) {
          this.name := name
        }
        operation adjust(total: decimal) {
          this.total := 0.50
        }
      }
      repository Products for Product { }
    }
  }
  api ShopApi from Sales
  storage db { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: db }
  deployable honoApi   { platform: node   contexts: [Catalog] dataSources: [catalogState] serves: ShopApi port: 3000 }
  deployable dotnetApi { platform: dotnet contexts: [Catalog] dataSources: [catalogState] serves: ShopApi port: 8080 }
  deployable javaApi   { platform: java   contexts: [Catalog] dataSources: [catalogState] serves: ShopApi port: 8081 }
  deployable pyApi     { platform: python contexts: [Catalog] dataSources: [catalogState] serves: ShopApi port: 8082 }
}
`;

/** The same model spelled the only way that worked before this change. */
const RENAMED = SHADOWED.replace("rename(name: string)", "rename(newName: string)").replace(
  "this.name := name",
  "name := newName",
);

/** ... and the same model with the `this.` dropped, parameter shadow intact. */
const UNPREFIXED = SHADOWED.replace("this.name := name", "name := name").replace(
  "this.total := 0.50",
  "total := 0.50",
);

function fileAt(files: Map<string, string>, path: string): string {
  const v = files.get(path);
  if (v === undefined) throw new Error(`no emitted file at ${path}`);
  return v;
}

/** The per-backend aggregate class, where an operation body lands. */
const PRODUCT = {
  node: "hono_api/domain/product.ts",
  dotnet: "dotnet_api/Domain/Products/Product.cs",
  java: "java_api/src/main/java/com/loom/javaapi/features/products/Product.java",
  python: "py_api/app/domain/product.py",
} as const;

/** The money elaboration a money-typed assignment target produces on node. */
const MONEY_LITERAL = 'new Decimal("0.50")';

/** Everything after the operation's signature, up to the next blank-line gap. */
function bodyOf(src: string, marker: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`no '${marker}' in:\n${src}`);
  return src.slice(at, src.indexOf("\n\n", at));
}

describe("G3 — `this.` on the left of `:=`", () => {
  let shadowed: Map<string, string>;
  let renamed: Map<string, string>;
  let unprefixed: Map<string, string>;

  beforeAll(async () => {
    [shadowed, renamed, unprefixed] = await Promise.all([
      generateSystemFiles(SHADOWED),
      generateSystemFiles(RENAMED),
      generateSystemFiles(UNPREFIXED),
    ]);
  }, 120_000);

  it("parses, where it used to be `Expecting token of type '}' but found `this``", async () => {
    const { errors } = await parseString(SHADOWED, { validate: true });
    expect(errors, `unexpected: ${errors.join("\n")}`).toEqual([]);
  });

  it("still parses the un-prefixed spelling (unchanged)", async () => {
    const { errors } = await parseString(UNPREFIXED, { validate: true });
    expect(errors, `unexpected: ${errors.join("\n")}`).toEqual([]);
  });

  // ---- the shadowing case, on four backends ------------------------------
  //
  // In each: the FIELD is written and the PARAMETER is read.  The two are
  // spelled differently enough per backend that a swap could not slip past.

  it("node writes the field and reads the parameter", () => {
    expect(bodyOf(fileAt(shadowed, PRODUCT.node), "public rename(")).toBe(
      [
        "public rename(name: string): void {",
        "    this._name = name;",
        "    this._assertInvariants();",
        "  }",
      ].join("\n"),
    );
  });

  it("dotnet writes the field and reads the parameter", () => {
    const body = bodyOf(fileAt(shadowed, PRODUCT.dotnet), "public void Rename(");
    expect(body).toContain("Name = name;");
  });

  it("java writes the field and reads the parameter", () => {
    const body = bodyOf(fileAt(shadowed, PRODUCT.java), "public void rename(");
    expect(body).toContain("this.name = name;");
  });

  it("python writes the field and reads the parameter", () => {
    const body = bodyOf(fileAt(shadowed, PRODUCT.python), "def rename(");
    expect(body).toContain("self._name = name");
  });

  // ---- the prefixed spelling is not a DIFFERENT program -------------------

  it("emits exactly what the renamed-parameter workaround emits", () => {
    // The identifier is the only thing that may differ: `this.name := name`
    // with a `name` parameter must lower to the same statement as
    // `name := newName` with a `newName` parameter, on every backend here.
    for (const path of Object.values(PRODUCT)) {
      expect(fileAt(shadowed, path), path).toBe(
        fileAt(renamed, path)
          .replaceAll("newName", "name")
          .replaceAll("NewName", "Name")
          // python snake-cases parameter names on the way out.
          .replaceAll("new_name", "name"),
      );
    }
  });

  // ---- the target type comes from the FIELD, not the parameter ------------

  it("takes the target type from the FIELD, not from the shadowing parameter", () => {
    // `adjust(total: decimal) { this.total := 0.50 }` — the FIELD is `money`.
    // The head must resolve against the field, so the literal elaborates for a
    // money target; resolving it against the shadowing `decimal` parameter
    // would elaborate for a decimal one.  This is the observable half of
    // `pathType(..., thisRooted)` — and the contrast below is what proves the
    // flag is load-bearing rather than inert.
    const prefixed = bodyOf(fileAt(shadowed, PRODUCT.node), "public adjust(");
    const implicit = bodyOf(fileAt(unprefixed, PRODUCT.node), "public adjust(");
    expect(prefixed).toContain(MONEY_LITERAL);
    // ... and the implicit spelling, under the same shadow, does not — it
    // takes the parameter's `decimal` and writes a bare `0.50` into a field
    // the constructor holds as a `Decimal`.
    expect(implicit).not.toContain(MONEY_LITERAL);
    expect(implicit).toContain("this._total = 0.50;");
  });

  // ---- the printer keeps the prefix ---------------------------------------

  it("prints `this.` back, so `unfold` ejects the source that was written", async () => {
    const { model } = await parseString(SHADOWED, { validate: true });
    const { AstUtils } = await import("langium");
    const agg = [...AstUtils.streamAst(model)].find(isAggregate);
    const printed = printStructural(agg!);
    expect(printed).toContain("this.name := name");
    expect(printed).toContain("this.total := 0.50");
  });
});

// ---------------------------------------------------------------------------
// The early branch in `lowerStatement`'s lvalue dispatch.
//
// Admitting `this.` at the head of an `LValue` also admits it on the CALL
// forms, and those are where the arms below matter: each resolves the head as a
// FREE name.  A `domainService` and an aggregate field may legitimately share a
// name, and without the early branch `this.rate.scaled(…)` — a member call on the
// FIELD — is claimed by the domain-service arm (`lv.call && lv.tail.length === 1
// && !env.locals.has(head)`) and lowers to an infrastructure-shaped
// `callKind: "domain-service"` call against a service the source never named.
// ---------------------------------------------------------------------------

describe("G3 — a this-rooted call is never resolved as a free name", () => {
  const COLLIDING = `
  context Pricing {
    valueobject Rate {
      pct: decimal
      function scaled(n: int): decimal { return pct * n }
    }
    aggregate Quote {
      rate: Rate
      operation refresh() {
        this.rate.scaled(2)
      }
    }
    repository Quotes for Quote { }
    // Same name as the aggregate's rate FIELD -- legal, and exactly the
    // collision the early branch exists to survive.
    domainService rate {
      operation scaled(n: int): decimal { return 1.0 }
    }
  }
`;

  it("lowers `this.rate.scaled(2)` against `this`, not against the same-named service", async () => {
    const { buildLoomModel } = await import("../_helpers/index.js");
    const { allContexts } = await import("../../src/ir/types/loom-ir.js");
    const loom = await buildLoomModel(COLLIDING);
    const quote = allContexts(loom)
      .flatMap((c) => c.aggregates)
      .find((a) => a.name === "Quote")!;
    const body = quote.operations.find((o) => o.name === "refresh")!.statements;
    expect(body).toHaveLength(1);
    const stmt = body[0]!;
    expect(stmt.kind).toBe("expression");
    const expr = stmt.kind === "expression" ? stmt.expr : undefined;
    // A member call whose receiver is the this-prop `rate` — the receiver
    // chain is rooted in `this`, NOT a `callKind: "domain-service"` call.
    expect(expr?.kind).toBe("method-call");
    const recv = expr && "receiver" in expr ? expr.receiver : undefined;
    expect(recv?.kind).toBe("member");
    expect(recv && recv.kind === "member" ? recv.member : undefined).toBe("rate");
    expect(recv && recv.kind === "member" ? recv.receiver.kind : undefined).toBe("this");
    expect(JSON.stringify(expr)).not.toContain("domain-service");
  });
});
