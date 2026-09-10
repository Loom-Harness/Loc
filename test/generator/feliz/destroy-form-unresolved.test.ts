// The Feliz half of M-T1.31 (audit findings F11 / F62) — defence in depth
// behind `loom.destroy-form-of-unresolved`.
//
// `renderDestroyForm` (`feliz/feliz-target.ts`) used to accept ANY `ref` as its
// `of:` arg and interpolate the raw NAME into a `Delete<Name> id` dispatch.  The
// `Msg` cases, though, are collected by `formOfAggs` (`feliz/wire.ts`), which
// FILTERS by `aggregatesByName` — so an `of:` naming anything but a declared
// aggregate emitted a dispatch of a union case that does not exist:
//
//     type Msg = | UrlChanged of string list       // no DeleteGadget
//     …
//     prop.onClick (fun _ -> dispatch (DeleteGadget id))
//
// → `dotnet fable` FS0039, from a `.ddd` that reported `0 error(s)`.  The seam's
// own comment claimed it "falls through to the shared comment path when the
// `of:` arg isn't a plain aggregate ref" — false, because a plain ref never fell
// through.  It resolves through `ctx.aggregatesByName` now, so the claim is true.
//
// The phase-⑦ gate makes this unreachable from valid source, which is why the
// fixture below must be generated UNCHECKED: emitting from a rejected model is
// the subject.

import { describe, expect, it } from "vitest";
import { generateSystemFilesUnchecked } from "../../_helpers/generate.js";

/** `Gadget` is a value object — a name that resolves, but not to an aggregate. */
const UNRESOLVED_OF = `
system Shop {
  api ShopApi from Catalog
  subdomain Catalog {
    context Cat {
      valueobject Gadget { label: string }
      aggregate Product with crudish { name: string }
      repository Products for Product { }
    }
  }
  storage db { type: postgres }
  resource catState { for: Cat, kind: state, use: db }
  ui WebApp {
    api Shop: ShopApi
    page ProductDetail {
      route: "/products/:id"
      body: Stack {
        Heading { "Product", level: 1 },
        DestroyForm { of: Gadget }
      }
    }
  }
  deployable api { platform: node contexts: [Cat] dataSources: [catState] serves: ShopApi port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp { Shop: api } port: 3005 }
}
`;

describe("feliz DestroyForm with an unresolved `of:`", () => {
  it("falls through to the give-up path instead of dispatching a Msg case that does not exist", async () => {
    const files = await generateSystemFilesUnchecked(
      UNRESOLVED_OF,
      "the subject is what the emitter does with an `of:` that loom.destroy-form-of-unresolved now rejects",
    );
    const app = [...files.entries()].find(([p]) => p.endsWith("src/App.fs"))![1];
    // The defect: a dispatch of a `Msg` case nothing ever declares.
    expect(app).not.toContain("DeleteGadget");
    // …and the Msg union genuinely has no delete case to dispatch, which is
    // what made the old emission an FS0039 rather than merely a dead button.
    expect(app).not.toMatch(/\|\s*Delete\w+ of string/);
  });
});
