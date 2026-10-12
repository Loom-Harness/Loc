// Every `serialize_<name>/1` a vanilla controller CALLS is DEFINED in that same
// controller.
//
// A controller's wire serializer follows the aggregate's wire shape, and the
// wire shape spans contexts: an aggregate in `Billing` can hold a value object
// declared in `Directory`.  The helper for that value object must be emitted in
// the consuming controller too, or the call names an undefined function:
//
//   ** (CompileError) lib/d_web/controllers/receipt_controller.ex:
//      undefined function serialize_addr/1
//
// so `mix compile --warnings-as-errors` fails on ordinary shared-type modelling.
// `Addr.geo: Geo` keeps the NESTING in play — a lookup that resolves the first
// level and misses the second is the likelier regression.
//
// The assertion is the general invariant (calls ⊆ definitions, per file), not a
// spot check on `Addr`, so it also covers a helper this model happens to reach
// through some other route.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `
system VoCrossContext {
  subdomain Commerce {
    context Directory {
      valueobject Geo {
        lat: decimal
        lng: decimal
      }
      valueobject Addr {
        line1: string
        geo: Geo
      }
      aggregate Person with crudish {
        name: string
        home: Addr
      }
      repository Persons for Person { }
    }
    context Billing {
      aggregate Receipt with crudish {
        reference: string
        shipTo: Addr
      }
      repository Receipts for Receipt { }
    }
  }
  api CommerceApi from Commerce
  storage primary { type: postgres }
  resource directoryState { for: Directory, kind: state, use: primary }
  resource billingState { for: Billing, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Directory, Billing]
    dataSources: [directoryState, billingState]
    serves: CommerceApi
    port: 4000
  }
}
`;

const called = (src: string): Set<string> =>
  new Set([...src.matchAll(/\bserialize_(\w+)\(/g)].map((m) => m[1]!));
const defined = (src: string): Set<string> =>
  new Set([...src.matchAll(/\bdefp?\s+serialize_(\w+)\b/g)].map((m) => m[1]!));

describe("elixir controllers define every wire serializer they call", () => {
  it("including a value object declared in a sibling context, and the VO nested in it", async () => {
    const files = await generateSystemFiles(SRC);
    const receipt = [...files.keys()].find((k) => k.endsWith("controllers/receipt_controller.ex"));
    expect(receipt, "no receipt controller was emitted").toBeDefined();

    // Vacuity guard: the consuming context's controller really serializes the
    // sibling VO and the one nested in it.  If the shape stopped reaching these
    // calls, the invariant below would hold for the wrong reason.
    const receiptCalls = called(files.get(receipt!)!);
    expect([...receiptCalls], "receipt controller should serialize the sibling VO").toContain(
      "addr",
    );

    const controllers = [...files.keys()].filter((k) => k.endsWith("_controller.ex"));
    for (const k of controllers) {
      const src = files.get(k)!;
      const missing = [...called(src)].filter((n) => !defined(src).has(n));
      expect(missing, `${k} calls serialize_<name>/1 it never defines`).toEqual([]);
    }
  });
});
