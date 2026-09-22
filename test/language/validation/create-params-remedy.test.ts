// `loom.create-params-not-wire` must name a remedy that actually parses.
//
// The warning fires when a canonical `create`'s parameter list is narrower than
// the field-derived create input, and it offered two ways out: list every
// field, or "drop the parameter list".  `docs/language-reference/06-behavior-
// and-statements.md` said the same thing as "omitting the parens".
//
// Both descriptions have one obvious spelling — `create { … }` — and it is a
// PARSE ERROR:
//
//     main.ddd:3:12 error: Expecting token of type '(' but found `{`.
//
// `Create` requires its parens while `Destroy` does not (a deliberate
// asymmetry, recorded in `ddd.langium`), so the executable remedy is
// `create() { … }`.  A user who follows the advice literally gets a raw parser
// dump from a message that was trying to help.
//
// Both halves are pinned here, because fixing the wording without pinning the
// grammar would let a later widening quietly make the text wrong again in the
// other direction.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { toLoomModel } from "../../_helpers/ir.js";
import { extractErrors, parseString } from "../../_helpers/parse.js";

/** Parse + run the IR validator, the phase this diagnostic is raised in. */
async function check(source: string) {
  const { model, doc } = await parseString(source);
  const errors = extractErrors(doc.diagnostics);
  if (errors.length > 0) return { errors, warnings: [] as string[] };
  const diags = validateLoomModel(toLoomModel(model));
  return {
    errors: diags.filter((d) => d.severity !== "warning").map((d) => d.message),
    warnings: diags.filter((d) => d.severity === "warning").map((d) => d.message),
  };
}

const AGG = (create: string) => `system F7 {
  subdomain S { context C {
    aggregate Doc {
      title: string
      body: string
      derived display: string = title
      ${create}
    }
    repository Docs for Doc { }
  } }
  storage p { type: postgres }  resource r { for: C, kind: state, use: p }
  deployable api { platform: node, contexts: [C], dataSources: [r], port: 3000 }
}`;

describe("loom.create-params-not-wire names a remedy that parses", () => {
  it("fires on a narrowed parameter list, and spells the remedy `create()`", async () => {
    const { errors, warnings } = await check(AGG("create(title: string) { }"));
    expect(errors).toEqual([]);
    const w = warnings.find((x) => x.includes("parameter list is not the"));
    expect(w, warnings.join("\n")).toBeDefined();
    // The exact spelling, not a paraphrase: this is the string a user copies.
    expect(w).toContain("`create() { … }`");
    // The old wording, which had no parsing spelling.
    expect(w).not.toContain("drop the parameter list");
  });

  it("the remedy it names is accepted, and silences the warning", async () => {
    const { errors, warnings } = await check(AGG("create() { }"));
    expect(errors).toEqual([]);
    expect(warnings.filter((x) => x.includes("parameter list is not the"))).toEqual([]);
  });

  it("the spelling the OLD wording implied is still a parse error", async () => {
    // Not a regression to fix here — `Create` requires parens by decision — but
    // the reason the message may not say "omit the parens".  If a later change
    // legalises this form, THIS is the test that says the wording may relax.
    const { errors } = await check(AGG("create { }"));
    expect(errors.join("\n")).toContain("Expecting token of type '('");
  });

  it("`destroy` is the one that may omit them — the asymmetry the message names", async () => {
    const { errors } = await check(AGG("create() { }  destroy { }"));
    expect(errors).toEqual([]);
  });
});
