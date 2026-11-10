// Lowering reads only the typing pass, and a model with an expression the
// pass could not type never reaches codegen: lowering records every such read
// on the model, and `validateLoomModel` refuses it with `loom.unresolved-type`
// — unless another diagnostic already does (`unresolved-type-checks.ts`).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateUnresolvedTypes } from "../../src/ir/validate/checks/unresolved-type-checks.js";
import { type LoomDiagnostic, validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

/** A model whose only defect is a `let` bound from a name nothing declares:
 *  the AST layer reports the name, the pass types it `unknown`, and lowering
 *  reads that type for the binding. */
const SRC = `system S {
  subdomain D {
    context C {
      aggregate Order with crudish {
        qty: int
        operation bump() { let n = nope  qty := qty + 1 }
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: node contexts: [C] dataSources: [st] serves: A port: 3000 }
}`;

describe("an unresolved type never reaches codegen", () => {
  it("lowering records each read of an expression the pass left unresolved", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const sites = lowerModel(model).unresolvedTypes ?? [];
    expect(sites.map((s) => [s.text, s.cause])).toContainEqual(["nope", "unresolved-name"]);
    expect(sites.find((s) => s.text === "nope")?.origin).toBeDefined();
  });

  it("a model that validates records none", async () => {
    const { model } = await parseString(SRC.replace("let n = nope", "let n = qty"), {
      validate: false,
    });
    expect(lowerModel(model).unresolvedTypes).toBeUndefined();
  });

  it("the IR layer refuses the model when nothing else does", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const codes = validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code);
    expect(codes).toContain("loom.unresolved-type");
  });

  it("stays silent when another error already refuses the model", async () => {
    const { model } = await parseString(SRC, { validate: false });
    const diags: LoomDiagnostic[] = [
      { severity: "error", message: "x", source: "s", code: "loom.other" },
    ];
    validateUnresolvedTypes(enrichLoomModel(lowerModel(model)), diags);
    expect(diags.map((d) => d.code)).toEqual(["loom.other"]);
  });

  it("a host holding the AST layer's error reports that one, not the backstop", async () => {
    const codes = (await validate(SRC)).diagnostics.map((d) => d.code);
    expect(codes.some((c) => c && c !== "loom.unresolved-type")).toBe(true);
    expect(codes).not.toContain("loom.unresolved-type");
  });

  it("`.not` before a matcher is the value under assertion, not an unresolved member", async () => {
    const src = readFileSync("test/fixtures/corpus/managed-seeds.ddd", "utf8").replaceAll(
      "__PLATFORM__",
      "node",
    );
    expect(src).toContain(".not.toBeNull()");
    const { model } = await parseString(src, { validate: false });
    expect(lowerModel(model).unresolvedTypes).toBeUndefined();
  });
});
