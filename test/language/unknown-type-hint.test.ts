// The "Did you mean …?" hint on an unknown TYPE (`src/language/ddd-linker.ts`).
//
// The hint's candidate set used to be `streamAllContents(root)` — every named
// node in the document.  That walk runs over the MACRO-EXPANDED tree, so it
// also swept up the operations `with crudish` synthesises and the page state
// `with scaffold` synthesises.  The result was a confidently wrong suggestion
// pointing at something that can never stand in a type position:
//
//   aggregate A with crudish { occurredOn: date }
//     → Unknown type 'date'. Did you mean 'update'?     (a crudish operation)
//   … plus a scaffolded `ui`
//     → Unknown type 'date'. Did you mean 'data'?       (a page state variable)
//
// Following either replaces one error with another.  The candidates are now
// declared TYPES only.  Both halves matter and are asserted here: no
// non-type may be suggested, and a real near-miss on the user's own
// `valueobject` / `enum` must still be suggested (the reason the walk existed).

import { describe, expect, it } from "vitest";
import { parseString } from "../_helpers/parse.js";

const hintFor = (errors: string[]): string | undefined =>
  errors.find((e) => e.includes("Unknown type"));

describe("unknown-type hint candidates are declared types, not every named node", () => {
  it("does not suggest a macro-synthesised operation (`with crudish` → 'update')", async () => {
    const { errors } = await parseString(`
      context C {
        aggregate A with crudish { occurredOn: date }
        repository As for A { }
      }
    `);
    const msg = hintFor(errors);
    expect(msg, "expected the unknown-type diagnostic").toBeDefined();
    expect(msg).not.toContain("Did you mean 'update'");
    expect(msg).not.toContain("Did you mean 'create'");
    expect(msg).not.toContain("Did you mean 'destroy'");
  });

  it("does not suggest a scaffold-synthesised page state variable ('data')", async () => {
    const { errors } = await parseString(`
      system S {
        context C {
          aggregate A with crudish { occurredOn: date  name: string }
          repository As for A { }
        }
        ui U with scaffold(contexts: [C]) { }
        storage primary { type: postgres }
        resource st { for: C, kind: state, use: primary }
        deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
      }
    `);
    const msg = hintFor(errors);
    expect(msg, "expected the unknown-type diagnostic").toBeDefined();
    expect(msg).not.toContain("Did you mean 'data'");
  });

  it("still suggests the user's own value object on a near miss", async () => {
    const { errors } = await parseString(`
      context C {
        valueobject Money { amount: decimal }
        aggregate A with crudish { m: Monye  name: string }
        repository As for A { }
      }
    `);
    expect(hintFor(errors)).toContain("Did you mean 'Money'");
  });

  it("still suggests the user's own enum on a near miss", async () => {
    const { errors } = await parseString(`
      context C {
        enum Status { Open, Closed }
        aggregate A with crudish { s: Staus  name: string }
        repository As for A { }
      }
    `);
    expect(hintFor(errors)).toContain("Did you mean 'Status'");
  });

  it("still suggests a primitive on a near miss", async () => {
    const { errors } = await parseString(`
      context C {
        aggregate A with crudish { n: strng  name: string }
        repository As for A { }
      }
    `);
    expect(hintFor(errors)).toContain("Did you mean 'string'");
  });
});
