// ---------------------------------------------------------------------------
// `loom.page-primitive-unknown-arg-value` — the VALUE twin of
// `loom.page-primitive-unknown-arg`.
//
// The name gate catches an argument nobody reads, and its symptom is content
// going MISSING.  This one catches an argument everybody reads and nobody
// recognises, whose symptom is worse: something still renders.  Every pack
// template is an `{{#if (eq variant "primary")}}…{{else if (eq variant
// "secondary")}}…{{else}}ghost{{/if}}` chain, so an unrecognised value falls
// off the end into the last arm.
//
// Measured on `main` before this gate, all five of these emitted 0 diagnostics
// and built green on every pack:
//
//     Button { "Primary",   variant: "primary"   }  →  <Button variant="default">
//     Button { "Secondary", variant: "secondary" }  →  <Button variant="outline">
//     Button { "Ghost",     variant: "ghost"     }  →  <Button variant="ghost">
//     Button { "Filled",    variant: "filled"    }  →  <Button variant="ghost">
//     Button { "Nonsense",  variant: "wombat"    }  →  <Button variant="ghost">
//
// `"filled"` is not a hypothetical misspelling: it is the value this repo's
// own primitive reference used, with `<Button variant="subtle">` printed
// underneath as the expected output.  Copy the documented example and your
// primary action ships looking like plain text — which is how a silent
// fallback survives review, because the wrong answer looks like an answer.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.page-primitive-unknown-arg-value";

const wrap = (uiBody: string) => `
system Demo {
  subdomain S {
    context C {
      aggregate Customer {
        name: string
      }
      repository Customers for Customer { }
    }
  }
  api A from S
  ui Web {
    framework: react
    api Shop: A
    ${uiBody}
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  serves: A  port: 3000 }
  deployable web { platform: static  targets: api  port: 3001  ui: Web { Shop: api } }
}`;

async function diagnostics(uiBody: string) {
  const { model, errors } = await parseString(wrap(uiBody));
  if (errors.length) throw new Error(`unexpected parse/validation errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
}

// `LoomDiagnostic.code` is optional, so the mapped list carries `undefined`.
// Kept in the type rather than filtered out: `toContain` / `toEqual([])` read
// the same either way, and dropping the code-less diagnostics would quietly
// narrow what these assertions are looking at.
const codes = async (uiBody: string): Promise<(string | undefined)[]> =>
  (await diagnostics(uiBody)).map((d) => d.code);

const page = (body: string) => `page X { route: "/x"  body: ${body} }`;

describe("loom.page-primitive-unknown-arg-value — the gate", () => {
  it("flags the value the repo's own primitive reference used", async () => {
    expect(await codes(page(`Button { "Save", variant: "filled" }`))).toContain(CODE);
  });

  it("flags an invented value", async () => {
    expect(await codes(page(`Button { "Save", variant: "wombat" }`))).toContain(CODE);
  });

  it("flags a `Card`'s variant and a `Button`'s iconPosition on the same rule", async () => {
    expect(await codes(page(`Card { "T", variant: "elevated" }`))).toContain(CODE);
    expect(await codes(page(`Button { "Save", icon: "check", iconPosition: "top" }`))).toContain(
      CODE,
    );
  });

  it("accepts every value in the vocabulary", async () => {
    for (const v of ["primary", "secondary", "ghost"]) {
      expect(await codes(page(`Button { "Save", variant: "${v}" }`)), v).not.toContain(CODE);
    }
    for (const v of ["raised", "flat", "outline"]) {
      expect(await codes(page(`Card { "T", variant: "${v}" }`)), v).not.toContain(CODE);
    }
  });

  it("leaves an OPEN-vocabulary argument on the same primitive alone", async () => {
    // The gate is opt-in per ARGUMENT, not per primitive: `label:` on the very
    // primitive whose `variant:` is closed takes any string.
    expect(await codes(page(`Button { "Save", label: "Save the thing" }`))).not.toContain(CODE);
  });

  it("says nothing about a non-literal value it cannot evaluate", async () => {
    // Refusing a dynamic value would reject a legal page over an expression
    // this layer cannot see through.  The escape hatch is deliberate and this
    // pins it, so a later "tighten the gate" does not quietly close it.
    expect(
      await codes(
        `page X { route: "/x"  state { rank: string = "primary" }  body: Button { "Save", variant: rank } }`,
      ),
    ).not.toContain(CODE);
  });

  it("reports each (primitive, argument, value) once, however many sites repeat it", async () => {
    const diags = (
      await diagnostics(
        page(`Stack { Button { "a", variant: "filled" }, Button { "b", variant: "filled" } }`),
      )
    ).filter((d) => d.code === CODE);
    expect(diags).toHaveLength(1);
  });

  it("names the accepted values AND the default the user actually got", async () => {
    const d = (await diagnostics(page(`Button { "Save", variant: "filled" }`))).find(
      (x) => x.code === CODE,
    );
    expect(d?.message).toContain('`"primary"`');
    expect(d?.message).toContain('`"secondary"`');
    expect(d?.message).toContain('`"ghost"`');
    // The observation that sends someone looking — not derivable from the list.
    expect(d?.message).toContain("renders its `ghost` default");
  });
});
