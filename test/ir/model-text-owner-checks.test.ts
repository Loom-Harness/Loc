// The implicit model-text owner and the explicit `label(X)` agree: a context
// that references a type it does not declare while two others do is reported
// (`loom.model-text-implicit-ambiguous`); the neighbouring spellings stay legal.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CODE = "loom.model-text-implicit-ambiguous";

async function codes(source: string): Promise<{ code?: string; message: string }[]> {
  const { model } = await parseString(source, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model))).filter((d) => d.code === CODE);
}

const system = (home: string, ui = "ui WebApp with scaffold(subdomains: [D]) { }") => `
system S {
  subdomain D {
    context Alpha { aggregate Widget with crudish { n: int } enum Status { On, Off } }
    context Beta { aggregate Gadget with crudish { n: int } enum Status { Up, Down } }
    ${home}
  }
  ${ui}
}`;

describe("implicit model-text owner ambiguity", () => {
  it("a context referencing a type two other contexts declare is reported once, naming them", async () => {
    const d = await codes(system("context Home { aggregate Hub with crudish { s: Status } }"));
    expect(d).toHaveLength(1);
    expect(d[0]!.message).toContain("'Home'");
    expect(d[0]!.message).toContain("Alpha, Beta");
  });

  it("the home context declaring the type settles it", async () => {
    const d = await codes(
      system("context Home { aggregate Hub with crudish { s: Status } enum Status { Lo, Hi } }"),
    );
    expect(d).toEqual([]);
  });

  it("a type only one other context declares is not ambiguous", async () => {
    const d = await codes(`
system S {
  subdomain D {
    context Alpha { aggregate Widget with crudish { n: int } enum Status { On, Off } }
    context Home { aggregate Hub with crudish { s: Status } }
  }
  ui WebApp with scaffold(subdomains: [D]) { }
}`);
    expect(d).toEqual([]);
  });

  it("a system without a ui renders no implicit label", async () => {
    const d = await codes(system("context Home { aggregate Hub with crudish { s: Status } }", ""));
    expect(d).toEqual([]);
  });
});
